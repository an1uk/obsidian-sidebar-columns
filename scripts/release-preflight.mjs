import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const assetNames = ['main.js', 'manifest.json', 'styles.css'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateMetadata(manifest, pkg, versions, tag) {
  assert.equal(manifest.id, 'sidebar-columns', 'Unexpected plugin identity.');
  assert.equal(pkg.name, manifest.id, 'Package and plugin identities differ.');
  assert.ok(versionPattern.test(manifest.version), 'Manifest version must be x.y.z without a prefix or prerelease suffix.');
  assert.equal(pkg.version, manifest.version, 'Package and manifest versions differ.');
  assert.equal(pkg.license, '0BSD', 'The established 0BSD license must be preserved.');
  assert.equal(manifest.isDesktopOnly, true, 'The plugin must remain desktop-only.');
  assert.ok(versionPattern.test(manifest.minAppVersion), 'The minimum Obsidian version must be x.y.z.');
  assert.equal(versions[manifest.version], manifest.minAppVersion, 'versions.json does not map this release to its minimum Obsidian version.');
  if (tag !== undefined) assert.equal(tag, manifest.version, 'The release tag must exactly match the manifest version.');
  return manifest.version;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function validateReleaseRef(tag, defaultRef, local) {
  assert.ok(versionPattern.test(tag), 'The release tag must be x.y.z.');
  assert.ok(defaultRef?.startsWith('refs/remotes/origin/'), 'Supply the fetched default branch as refs/remotes/origin/<branch>.');
  git('check-ref-format', defaultRef);
  const commit = git('rev-parse', '--verify', 'HEAD^{commit}');
  assert.equal(git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`), commit, 'Checkout HEAD differs from the release tag.');
  git('merge-base', '--is-ancestor', commit, defaultRef);
  const remote = Object.fromEntries(['manifest', 'package', 'versions'].map(name =>
    [name, JSON.parse(git('show', `${defaultRef}:${name}.json`))]));
  validateMetadata(remote.manifest, remote.package, remote.versions, tag);
  assert.equal(remote.manifest.id, local.manifest.id, 'The default-branch plugin identity differs.');
  assert.equal(remote.manifest.minAppVersion, local.manifest.minAppVersion, 'The default-branch minimum Obsidian version differs.');
  return commit;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Packaging uses stored ZIP entries; verify both its allowlist and exact file bytes. */
export function validateDistributionZip(zip, assets, pluginId) {
  const entries = [];
  let offset = 0;
  for (let index = 0; index < assetNames.length; index++) {
    assert.ok(offset + 30 <= zip.length, 'Truncated ZIP local header.');
    assert.equal(zip.readUInt32LE(offset), 0x04034b50, 'Missing ZIP file entry.');
    assert.equal(zip.readUInt16LE(offset + 6), 0x800, 'Unsupported ZIP entry flags.');
    assert.equal(zip.readUInt16LE(offset + 8), 0, 'Release ZIP entries must be stored without compression.');
    const size = zip.readUInt32LE(offset + 18);
    assert.equal(zip.readUInt32LE(offset + 22), size, 'ZIP entry sizes differ.');
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const end = start + size;
    assert.ok(end <= zip.length, 'Truncated ZIP file contents.');
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const asset = assetNames.find(file => name === `${pluginId}/${file}`);
    assert.ok(asset && !entries.some(entry => entry.name === name), 'ZIP includes an unexpected or duplicate file.');
    const bytes = zip.subarray(start, end);
    assert.ok(bytes.equals(assets[asset]), `Packaged ${asset} differs from the attested build file.`);
    assert.equal(zip.readUInt32LE(offset + 14), crc32(bytes), 'ZIP file CRC is invalid.');
    entries.push({ name, offset, size, crc: crc32(bytes) });
    offset = end;
  }
  const centralStart = offset;
  for (const entry of entries) {
    assert.ok(offset + 46 <= zip.length, 'Truncated ZIP directory.');
    assert.equal(zip.readUInt32LE(offset), 0x02014b50, 'ZIP includes extra files or has an invalid directory.');
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    assert.equal(zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'), entry.name, 'ZIP directory name differs.');
    assert.equal(zip.readUInt32LE(offset + 16), entry.crc, 'ZIP directory CRC differs.');
    assert.equal(zip.readUInt32LE(offset + 20), entry.size, 'ZIP directory size differs.');
    assert.equal(zip.readUInt32LE(offset + 24), entry.size, 'ZIP directory uncompressed size differs.');
    assert.equal(zip.readUInt32LE(offset + 42), entry.offset, 'ZIP directory offset differs.');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const centralLength = offset - centralStart;
  assert.equal(offset + 22, zip.length, 'ZIP includes trailing data or a comment.');
  assert.equal(zip.readUInt32LE(offset), 0x06054b50, 'ZIP footer is invalid.');
  assert.equal(zip.readUInt16LE(offset + 4), 0, 'Multi-disk ZIP is unsupported.');
  assert.equal(zip.readUInt16LE(offset + 6), 0, 'Multi-disk ZIP is unsupported.');
  assert.equal(zip.readUInt16LE(offset + 8), assetNames.length, 'ZIP file count differs.');
  assert.equal(zip.readUInt16LE(offset + 10), assetNames.length, 'ZIP file count differs.');
  assert.equal(zip.readUInt32LE(offset + 12), centralLength, 'ZIP directory length differs.');
  assert.equal(zip.readUInt32LE(offset + 16), centralStart, 'ZIP directory location differs.');
  assert.equal(zip.readUInt16LE(offset + 20), 0, 'ZIP comments are unsupported.');
}

export async function validateDistribution(version) {
  const checksums = JSON.parse(await readFile('dist/checksums.json', 'utf8'));
  assert.equal(checksums.version, version, 'Packaged version differs.');
  assert.deepEqual(Object.keys(checksums.files).sort(), assetNames.slice().sort(), 'Checksum asset allowlist differs.');
  const assets = {};
  for (const name of assetNames) {
    assert.ok((await stat(name)).isFile(), `Release asset is not a regular file: ${name}`);
    const bytes = await readFile(name);
    assert.ok(bytes.length > 0, `Release asset is empty: ${name}`);
    assert.equal(checksums.files[name], sha256(bytes), `Release asset checksum differs: ${name}`);
    assets[name] = bytes;
  }
  assert.equal(JSON.parse(assets['manifest.json'].toString('utf8')).version, version, 'Release manifest version differs.');
  const zip = await readFile(`dist/sidebar-columns-${version}.zip`);
  assert.equal(checksums.zipSha256, sha256(zip), 'ZIP checksum differs.');
  validateDistributionZip(zip, assets, 'sidebar-columns');
}

async function main(args) {
  let tag, defaultRef, metadataOnly = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--metadata-only') metadataOnly = true;
    else if (arg === '--tag' || arg === '--default-ref') {
      const value = args[++index];
      assert.ok(value && !value.startsWith('--'), `Missing value for ${arg}.`);
      if (arg === '--tag') tag = value;
      else defaultRef = value;
    } else throw new Error(`Unknown preflight argument: ${arg}`);
  }
  assert.ok(!defaultRef || tag, '--default-ref requires --tag.');
  const local = Object.fromEntries(await Promise.all(['manifest', 'package', 'versions'].map(async name =>
    [name, JSON.parse(await readFile(`${name}.json`, 'utf8'))])));
  const version = validateMetadata(local.manifest, local.package, local.versions, tag);
  const commit = tag === undefined ? undefined : validateReleaseRef(tag, defaultRef, local);
  if (!metadataOnly) await validateDistribution(version);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Release preflight passed for ${version}${commit ? ` at ${commit}` : ''}${metadataOnly ? ' (metadata)' : ' (metadata and distribution)'}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
