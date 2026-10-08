import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

assert.ok(process.argv.includes('--run'), 'Pass --run explicitly to launch isolated recovery acceptance.');
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedHashIndex = process.argv.indexOf('--expected-build-hash');
assert.ok(expectedHashIndex >= 0, 'Pass --expected-build-hash to pin the bundle under acceptance.');
const EXPECTED_BUNDLE = process.argv[expectedHashIndex + 1];
assert.match(EXPECTED_BUNDLE ?? '', /^[a-f0-9]{64}$/i, 'Expected build hash must be a SHA-256 hex digest.');
const sourcePath = join(PROJECT, 'scripts', 'runtime-test.mjs');
const source = readFileSync(sourcePath, 'utf8');
const boundary = source.indexOf('async function acceptance(cdp)');
assert.ok(boundary > 0, 'Cannot identify the safe helper prelude');
const helperPath = join(PROJECT, '.cache', 'runtime-recovery-support.mjs');
mkdirSync(dirname(helperPath), { recursive: true });
const prelude = source.slice(0, boundary)
  .replace('from "./asar.mjs"', 'from "../scripts/asar.mjs"')
  .replace('const RUN_ID = new Date()', 'const RUN_ID = "recovery-" + new Date()');
assert.ok(prelude.includes('"recovery-"'), 'The fixture directory must be independent');
writeFileSync(helperPath, prelude + '\nexport { PROJECT, EXE, ASAR, PROFILE, VAULT, EVIDENCE, RUN, FIXTURE_ID, VERSION, report, stage, sha, json, safeWrite, protocolCommand, assertProtocol, canonical, productionSnapshot, freePort, attach, CDP, readiness, assertIsolation, delay, focus, command, modalButtons, clickButton, snapshot, columns };\n');
const h = await import(pathToFileURL(helperPath).href);
const { report, RUN, EVIDENCE, VAULT, PROFILE } = h;
report.bundleSha256 = createHash('sha256').update(readFileSync(join(PROJECT, 'main.js'))).digest('hex');
assert.equal(report.bundleSha256, EXPECTED_BUNDLE, 'Recovery acceptance requires the final immutable bundle');
report.helperSourceSha256 = createHash('sha256').update(source).digest('hex');
report.windows = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$fixtureOsInfo=Get-CimInstance Win32_OperatingSystem; $fixtureVersion=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'; [pscustomobject]@{caption=$fixtureOsInfo.Caption; version=$fixtureOsInfo.Version; build=$fixtureOsInfo.BuildNumber; updateBuildRevision=$fixtureVersion.UBR; displayVersion=$fixtureVersion.DisplayVersion; architecture=$fixtureOsInfo.OSArchitecture} | ConvertTo-Json -Compress"],
{ encoding: 'utf8', windowsHide: true }).trim());
report.limitations = ['Default theme only for recovery scenarios; separate runtime results cover additional interactions.', 'Windows renderer 1.14.4 on installer 1.12.7; macOS/Linux and other application versions were not run.', 'Only the isolated fixture and owned process were operated.'];
const sentinel = `sidebar-columns-recovery-${h.FIXTURE_ID}`;
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
let cdp, pid, port;
const before = h.productionSnapshot();
const noteHash = {};
function processInfo() {
  if (!pid) return null;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){$p | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress}`], { encoding: 'utf8', windowsHide: true }).trim();
  return output ? JSON.parse(output) : null;
}
function ownedProcess() {
  const process = processInfo();
  assert.ok(process, 'Owned runtime process is missing');
  assert.equal(h.canonical(process.ExecutablePath), h.canonical(h.EXE));
  assert.ok(process.CommandLine.includes(PROFILE) && process.CommandLine.includes(sentinel)
    && process.CommandLine.includes(`--remote-debugging-port=${port}`), 'Refusing interaction with an unowned process');
  return process;
}
async function until(fn, message, attempts = 80) {
  for (let i = 0; i < attempts; i++) { if (await fn()) return; await h.delay(200); }
  throw new Error(message);
}
async function start() {
  assert.ok(!pid || !processInfo(), 'Refusing a second launch while the owned session exists');
  h.assertProtocol(); port = await h.freePort();
  const args = [`--user-data-dir="${PROFILE}"`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `session=${sentinel}`];
  const command = `$p=Start-Process -FilePath ${psQuote(h.EXE)} -ArgumentList @(${args.map(psQuote).join(',')}) -WorkingDirectory ${psQuote(RUN)} -WindowStyle Hidden -PassThru; $p.Id`;
  pid = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim());
  ownedProcess(); cdp = await h.attach(port);
  // This read-only guard precedes every trust click or plugin interaction.
  await until(async () => {
    const ready = await cdp.run(() => Boolean(window.app?.vault?.adapter?.getBasePath));
    if (!ready) return false;
    await h.assertIsolation(cdp); ownedProcess(); h.assertProtocol(); return true;
  }, 'Isolation cannot be established before interaction');
  report.launches ??= []; report.launches.push({ pid, port, sentinel, isolation: report.isolation });
  await h.readiness(cdp); await h.assertIsolation(cdp);
  assert.equal(h.sha(join(VAULT, '.obsidian', 'plugins', 'sidebar-columns', 'main.js')), EXPECTED_BUNDLE);
}
async function close() {
  if (!pid || !processInfo()) { cdp?.close(); cdp = undefined; return; }
  ownedProcess();
  if (cdp) await h.assertIsolation(cdp);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = new h.CDP(version.webSocketDebuggerUrl); await browser.ready;
  try { await browser.send('Browser.close'); }
  catch (error) { if (processInfo() && !error.message.includes('closed')) throw error; }
  finally { browser.close(); cdp?.close(); cdp = undefined; }
  await until(async () => !processInfo(), 'Owned runtime did not exit after Browser.close', 30);
}
async function flush() {
  await cdp.run(async () => { app.workspace.requestSaveLayout(); await app.workspace.requestSaveLayout.run(); });
  await h.delay(300);
}
async function idle() { await until(() => cdp.run(() => !app.plugins.plugins['sidebar-columns'].operations.busy), 'Plugin operation did not finish'); }
async function record(name, fn) {
  try { const detail = await fn(); report.cases.push({ name, status: 'passed', detail: detail ?? null }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, status: 'failed', error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
}
async function restore(baseline, accept) {
  await cdp.run(selected => { window.__sidebarRecovery = app.plugins.plugins['sidebar-columns'].operations.restore(selected); }, baseline);
  await until(async () => (await h.modalButtons(cdp)).includes('Restore full workspace'), 'The full-workspace confirmation was not displayed');
  await h.clickButton(cdp, accept ? 'Restore full workspace' : 'Cancel');
  await idle(); return cdp.run(async () => await window.__sidebarRecovery);
}
const shape = node => ({ id: node.id, type: node.type, direction: node.direction, view: node.state?.type, file: node.state?.state?.file, children: (node.children ?? []).map(shape) });
function sameBranches(actual, expected) { for (const side of ['main', 'left', 'right']) assert.deepEqual(shape(actual[side]), shape(expected[side])); }
try {
  h.stage();
  for (const name of ['Fixture A.md', 'Fixture B.md', '2026-10-08.md']) noteHash[name] = h.sha(join(VAULT, name));
  await start();
  let baseline, savedBaseline;
  await record('Real first full-height column creates a protected persistent raw-layout baseline and checksum metadata', async () => {
    await h.focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-column');
    await until(async () => (await h.modalButtons(cdp)).includes('Enable experimental sidebar columns'), 'Consent modal missing');
    await h.clickButton(cdp, 'Enable experimental sidebar columns'); await idle();
    const snapshots = await cdp.run(() => app.plugins.plugins['sidebar-columns'].backups.list());
    assert.equal(snapshots.length, 1); baseline = snapshots[0]; assert.equal(baseline.baseline, true);
    savedBaseline = await cdp.run(snapshot => app.plugins.plugins['sidebar-columns'].backups.load(snapshot), baseline);
    const raw = readFileSync(join(VAULT, baseline.rawPath), 'utf8');
    const metadata = JSON.parse(readFileSync(join(VAULT, baseline.metadataPath), 'utf8'));
    assert.equal(createHash('sha256').update(raw).digest('hex'), metadata.sha256);
    assert.ok(JSON.parse(raw).main && !('formatVersion' in JSON.parse(raw)));
    assert.equal(h.columns(await h.snapshot(cdp, 'recovery-01-real-backup'), 'left'), 2);
    return { rawPath: baseline.rawPath, metadataPath: baseline.metadataPath, integrityVerified: true };
  });
  await record('Full-workspace restore Cancel preserves current columns and creates no pre-restore snapshot', async () => {
    const previous = await cdp.run(() => app.workspace.getLayout());
    const result = await restore(baseline, false); assert.equal(result.status, 'cancelled');
    sameBranches(await cdp.run(() => app.workspace.getLayout()), previous);
    assert.equal((await cdp.run(() => app.plugins.plugins['sidebar-columns'].backups.list())).length, 1);
    await h.snapshot(cdp, 'recovery-02-restore-cancel');
  });
  await record('Full-workspace restore Confirm restores baseline and retains a pre-restore snapshot of the split layout', async () => {
    const result = await restore(baseline, true); assert.equal(result.status, 'success');
    sameBranches(await cdp.run(() => app.workspace.getLayout()), savedBaseline);
    const snapshots = await cdp.run(() => app.plugins.plugins['sidebar-columns'].backups.list());
    assert.equal(snapshots.length, 2); assert.ok(snapshots.some(snapshot => snapshot.reason === 'pre-restore' && !snapshot.baseline));
    const old = await cdp.run(snapshot => app.plugins.plugins['sidebar-columns'].backups.load(snapshot), snapshots.find(snapshot => snapshot.reason === 'pre-restore'));
    assert.ok(JSON.stringify(old.left).includes('"direction":"vertical"'));
    assert.equal(h.columns(await h.snapshot(cdp, 'recovery-03-restored'), 'left'), 1);
  });
  await record('Disable removes commands, hooks and collapse rail while preserving native columns; re-enable installs working actions', async () => {
    await h.focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-column'); await idle();
    await h.focus(cdp, 'fixture-explorer'); await h.command(cdp, 'collapse-column'); await idle();
    assert.equal((await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount())), 1);
    const previous = await cdp.run(() => app.workspace.getLayout());
    const disabled = await cdp.run(async () => {
      const adapter = app.plugins.plugins['sidebar-columns'].adapter;
      const nativeLeaf = app.workspace.activeLeaf; const wrapped = nativeLeaf.onOpenTabHeaderMenu;
      await app.plugins.disablePlugin('sidebar-columns');
      return { loaded: Boolean(app.plugins.plugins['sidebar-columns']), command: Boolean(app.commands.findCommand('sidebar-columns:add-column')),
        rail: document.querySelectorAll('.sidebar-columns-rail').length, style: document.querySelectorAll('.sidebar-columns-collapsed').length,
        hookRemoved: nativeLeaf.onOpenTabHeaderMenu !== wrapped, adapterInstalled: adapter.installed };
    });
    assert.deepEqual(disabled, { loaded: false, command: false, rail: 0, style: 0, hookRemoved: true, adapterInstalled: false });
    sameBranches(await cdp.run(() => app.workspace.getLayout()), previous);
    await cdp.run(async () => await app.plugins.enablePlugin('sidebar-columns'));
    await h.readiness(cdp);
    await h.focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-column'); await idle();
    assert.equal(h.columns(await h.snapshot(cdp, 'recovery-04-reenabled'), 'left'), 3);
  });
  await record('Restart same isolated profile preserves native columns, durable acknowledgement and backups; collapse begins expanded', async () => {
    await flush(); await close(); await start();
    const state = await h.snapshot(cdp, 'recovery-05-restarted');
    assert.equal(h.columns(state, 'left'), 3); assert.equal(state.collapsed, 0); assert.equal(state.acknowledged, true);
    assert.ok((await cdp.run(() => app.plugins.plugins['sidebar-columns'].backups.list())).some(snapshot => snapshot.baseline));
  });
  await record('Offline raw snapshot replacement restores the documented baseline without copying a metadata wrapper', async () => {
    await flush(); await close(); assert.ok(!processInfo());
    const workspace = join(VAULT, '.obsidian', 'workspace.json');
    h.safeWrite(join(EVIDENCE, 'before-offline-replace.workspace.json'));
    copyFileSync(workspace, join(EVIDENCE, 'before-offline-replace.workspace.json'));
    copyFileSync(join(VAULT, baseline.rawPath), workspace);
    assert.equal(h.sha(workspace), h.sha(join(VAULT, baseline.rawPath)));
    await start(); sameBranches(await cdp.run(() => app.workspace.getLayout()), savedBaseline);
    assert.equal(h.columns(await h.snapshot(cdp, 'recovery-06-offline-raw-restored'), 'left'), 1);
  });
  await record('Closing Obsidian and preserving/removing workspace.json rebuilds a usable native default layout without changing notes', async () => {
    await flush(); await close(); assert.ok(!processInfo());
    const workspace = join(VAULT, '.obsidian', 'workspace.json');
    const preserved = join(EVIDENCE, 'before-default-rebuild.workspace.json'); h.safeWrite(preserved);
    renameSync(workspace, preserved); assert.ok(!existsSync(workspace));
    await start();
    const raw = await cdp.run(() => app.workspace.getLayout());
    assert.equal(raw.main.type, 'split'); assert.equal(raw.main.direction, 'vertical');
    assert.equal(raw.left.direction, 'horizontal'); assert.equal(raw.right.direction, 'horizontal');
    await h.snapshot(cdp, 'recovery-07-default-rebuild');
    await flush(); assert.ok(existsSync(workspace));
    for (const [name, hash] of Object.entries(noteHash)) assert.equal(h.sha(join(VAULT, name)), hash);
    return { originalWorkspacePreserved: true, defaultWorkspaceWritten: true, fixtureNotesUnchanged: true };
  });
} catch (error) { report.harnessError = error.stack; process.exitCode = 1; }
finally {
  try { await close(); report.ownedClosed = !pid || !processInfo(); } catch (error) { report.ownedClosed = false; report.cases.push({ name: 'Close owned isolated runtime', status: 'failed', error: error.stack }); process.exitCode = 1; }
  const after = h.productionSnapshot(); report.productionGuard = { unchanged: JSON.stringify(before) === JSON.stringify(after), before, after };
  if (!report.productionGuard.unchanged) process.exitCode = 1;
  report.finishedAt = new Date().toISOString(); h.json(join(RUN, 'report.json'), report);
  const lines = ['# Recovery runtime acceptance', '', 'Final bundle SHA-256: `' + report.bundleSha256 + '`.', '',
    'OS: ' + report.windows.caption + ' ' + report.windows.displayVersion + ' build ' + report.windows.build + '.' + report.windows.updateBuildRevision + ' (' + report.windows.architecture + '). Renderer: 1.14.4. Installer: ' + report.installerVersion + '. Theme: default.', '',
    '| Scenario | Actual result |', '| --- | --- |', ...report.cases.map(item => '| ' + item.name.replaceAll('|', '/') + ' | ' + item.status + ' |'), '',
    'Guarded isolated launches: ' + (report.launches?.length ?? 0) + '. Captured renderer errors: ' + report.consoleErrors.length + '. Owned process closure: ' + (report.ownedClosed ? 'confirmed' : 'failed; inspect evidence') + '.', '',
    'Production configuration and protocol content guard: ' + (report.productionGuard.unchanged ? 'unchanged' : 'failed; inspect evidence') + '.', '',
    'Evidence: `.runtime-tests/' + report.runId + '`; `report.json` records guarded launches, checks and actual failures. Screenshots accompany each completed recovery stage.', '',
    'The working vault was never an interaction target. Only this fresh fixture profile/vault and its owned PIDs were changed.', '',
    '## Acceptance limits', '', ...report.limitations.map(value => '- ' + value), '',
    ...(report.harnessError ? ['Harness failure: ' + report.harnessError.split('\n')[0], 'Later scenarios after that failure were not run.', ''] : [])];
  writeFileSync(join(PROJECT, 'docs', 'RECOVERY-TEST-RESULTS.md'), lines.join('\n'), 'utf8');
  console.log('Recovery evidence: ' + RUN);
}
