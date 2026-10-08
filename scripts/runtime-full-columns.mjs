import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

assert.ok(process.argv.includes('--run'), 'Pass --run to launch isolated native full-column acceptance.');
const hashIndex = process.argv.indexOf('--expected-build-hash');
const EXPECTED_BUNDLE = hashIndex >= 0 ? process.argv[hashIndex + 1] : null;
assert.ok(EXPECTED_BUNDLE && /^[a-f0-9]{64}$/.test(EXPECTED_BUNDLE), 'Provide the immutable main.js SHA-256 with --expected-build-hash.');
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(PROJECT, 'scripts', 'runtime-test.mjs'), 'utf8');
const boundary = source.indexOf('async function acceptance(cdp)');
assert.ok(boundary > 0, 'Cannot identify the guarded runtime helper prelude.');
const helperPath = join(PROJECT, '.cache', 'runtime-full-columns-support.mjs');
mkdirSync(dirname(helperPath), { recursive: true });
const prelude = source.slice(0, boundary)
  .replace('from "./asar.mjs"', 'from "../scripts/asar.mjs"')
  .replace('const RUN_ID = new Date()', 'const RUN_ID = "full-columns-" + new Date()');
assert.ok(prelude.includes('"full-columns-"'));
writeFileSync(helperPath, prelude + '\nexport { PROJECT, EXE, ASAR, PROFILE, VAULT, EVIDENCE, RUN, FIXTURE_ID, VERSION, report, stage, sha, json, safeWrite, assertProtocol, canonical, productionSnapshot, freePort, attach, CDP, readiness, assertIsolation, delay, focus, command, modalButtons, clickButton, snapshot };\n');
const h = await import(pathToFileURL(helperPath).href);
const { report, RUN, EVIDENCE, VAULT, PROFILE } = h;
const rtl = process.argv.includes('--rtl');
report.bundleSha256 = h.sha(join(PROJECT, 'main.js'));
assert.equal(report.bundleSha256, EXPECTED_BUNDLE, 'Build changed before fixture staging.');
report.helperSourceSha256 = createHash('sha256').update(source).digest('hex');
report.windows = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$fixtureOsInfo=Get-CimInstance Win32_OperatingSystem; $fixtureVersion=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'; [pscustomobject]@{caption=$fixtureOsInfo.Caption; version=$fixtureOsInfo.Version; build=$fixtureOsInfo.BuildNumber; updateBuildRevision=$fixtureVersion.UBR; displayVersion=$fixtureVersion.DisplayVersion; architecture=$fixtureOsInfo.OSArchitecture} | ConvertTo-Json -Compress"],
{ encoding: 'utf8', windowsHide: true }).trim());
report.limitations = ['Windows native acceptance only; other platforms and application versions were not run.', 'Only recorded cases establish acceptance; copied theme assets use clean fixture settings.', 'The working vault supplied read-only distributable assets and was never an interaction target.'];
const sentinel = `sidebar-columns-full-columns-${h.FIXTURE_ID}`;
const quote = value => "'" + value.replaceAll("'", "''") + "'";
let cdp, pid, port;
const before = h.productionSnapshot();
const noteHashes = {};
async function until(fn, message, attempts = 80) {
  for (let i = 0; i < attempts; i++) { if (await fn()) return; await h.delay(200); }
  throw new Error(message);
}
function processInfo() {
  if (!pid) return null;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){$p | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress}`], { encoding: 'utf8', windowsHide: true }).trim();
  return output ? JSON.parse(output) : null;
}
function ownedProcess() {
  const current = processInfo();
  assert.ok(current, 'Owned fixture process is missing.');
  assert.equal(h.canonical(current.ExecutablePath), h.canonical(h.EXE));
  assert.ok(current.CommandLine.includes(PROFILE) && current.CommandLine.includes(sentinel)
    && current.CommandLine.includes(`--remote-debugging-port=${port}`), 'Refusing interaction with an unowned process.');
  return current;
}
async function nativeGuard() {
  const native = await cdp.run(() => {
    const ipc = require('electron').ipcRenderer;
    return { resources: ipc.sendSync('resources'), version: ipc.sendSync('version'),
      vault: ipc.sendSync('vault'), vaults: ipc.sendSync('vault-list') };
  });
  assert.equal(h.canonical(native.resources), h.canonical(h.ASAR)); assert.equal(native.version, h.VERSION);
  assert.equal(h.canonical(native.vault.path), h.canonical(VAULT));
  assert.deepEqual(Object.keys(native.vaults), [h.FIXTURE_ID]);
  assert.equal(h.canonical(native.vaults[h.FIXTURE_ID].path), h.canonical(VAULT));
  ownedProcess(); h.assertProtocol(); return native;
}
async function start() {
  assert.ok(!pid || !processInfo(), 'Refusing a second launch while the owned process exists.');
  h.assertProtocol(); port = await h.freePort();
  const args = [`--user-data-dir="${PROFILE}"`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `session=${sentinel}`];
  const command = `$p=Start-Process -FilePath ${quote(h.EXE)} -ArgumentList @(${args.map(quote).join(',')}) -WorkingDirectory ${quote(RUN)} -WindowStyle Hidden -PassThru; $p.Id`;
  pid = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim());
  ownedProcess(); cdp = await h.attach(port);
  const native = await nativeGuard();
  await until(async () => {
    if (!await cdp.run(() => Boolean(window.app?.vault?.adapter?.getBasePath))) return false;
    await h.assertIsolation(cdp); return true;
  }, 'Cannot establish native fixture identity before the trust prompt.');
  report.launches ??= []; report.launches.push({ pid, port, sentinel, native, isolation: report.isolation });
  try { await h.readiness(cdp); }
  catch (error) {
    await nativeGuard(); await h.assertIsolation(cdp);
    const state = await cdp.run(() => ({ safeMode: app.plugins.safeMode, isSafeMode: typeof app.plugins.isSafeMode === 'function' ? app.plugins.isSafeMode() : null,
      enabled: [...(app.plugins.enabledPlugins ?? [])], loaded: Object.keys(app.plugins.plugins ?? {}),
      manifests: Object.fromEntries(['sidebar-columns', 'calendar'].map(id => [id, app.plugins.manifests?.[id] ?? null])),
      modal: [...document.querySelectorAll('.modal')].map(element => element.innerText) }));
    h.json(join(EVIDENCE, 'fixture-plugin-activation-state.json'), state);
    if (state.modal.length) throw error;
    const manifest = JSON.parse(readFileSync(join(VAULT, '.obsidian', 'plugins', 'sidebar-columns', 'manifest.json'), 'utf8'));
    assert.equal(manifest.id, 'sidebar-columns'); assert.equal(manifest.version, '0.1.0'); assert.equal(manifest.minAppVersion, h.VERSION);
    assert.equal(h.sha(join(VAULT, '.obsidian', 'plugins', 'sidebar-columns', 'main.js')), EXPECTED_BUNDLE);
    const ids = ['sidebar-columns', ...(report.assets.some(item => item.name === 'Calendar' && item.kind === 'plugin') ? ['calendar'] : [])];
    await cdp.run(async ids => { for (const id of ids) await app.plugins.enablePlugin(id); }, ids);
    report.fixturePluginActivation ??= []; report.fixturePluginActivation.push({ state, enabledExplicitly: ids });
    await h.readiness(cdp);
  }
  await h.assertIsolation(cdp);
  assert.equal(h.sha(join(VAULT, '.obsidian', 'plugins', 'sidebar-columns', 'main.js')), EXPECTED_BUNDLE);
  if (rtl) {
    await cdp.run(() => { localStorage.setItem('language', 'ar'); require('electron').ipcRenderer.sendSync('set-language', 'ar'); });
    await cdp.send('Page.reload'); await h.delay(350); await nativeGuard(); await h.assertIsolation(cdp); await h.readiness(cdp);
  }
  await cdp.send('Page.bringToFront');
  await cdp.run(() => { window.electronWindow.setSize(1600, 1000); window.electronWindow.focus(); window.electronWindow.webContents.focus(); });
  await h.delay(200);
}
async function close() {
  if (!pid || !processInfo()) { cdp?.close(); cdp = undefined; return; }
  ownedProcess(); if (cdp) await nativeGuard();
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = new h.CDP(info.webSocketDebuggerUrl); await browser.ready;
  try { await browser.send('Browser.close'); }
  catch (error) { if (!error.message.includes('closed') && processInfo()) throw error; }
  finally { browser.close(); cdp?.close(); cdp = undefined; }
  await until(async () => !processInfo(), 'Owned fixture did not exit after Browser.close.', 30);
}
async function idle() { await until(() => cdp.run(() => !app.plugins.plugins['sidebar-columns'].operations.busy), 'Sidebar operation did not settle.'); await h.delay(100); }
async function flush() { await cdp.run(async () => { app.workspace.requestSaveLayout(); await app.workspace.requestSaveLayout.run(); }); await h.delay(200); }
async function record(name, fn) {
  try { const detail = await fn(); report.cases.push({ name, status: 'passed', detail: detail ?? null }); console.log(`PASS ${name}`); }
  catch (error) {
    let diagnostic;
    try {
      await h.snapshot(cdp, 'failure-' + report.cases.length);
      diagnostic = await cdp.run(() => ({ notices: [...document.querySelectorAll('.notice')].map(element => element.textContent),
        latestOperation: window.__sidebarWholeLatestOperation, postFrameGeometry: window.__sidebarWholePostFrame,
        busy: app.plugins.plugins['sidebar-columns']?.operations.busy }));
    } catch (diagnosticError) { diagnostic = { error: diagnosticError.message }; }
    report.cases.push({ name, status: 'failed', error: error.stack, diagnostic });
    const conciseDiagnostic = diagnostic?.postFrameGeometry ? { ...diagnostic, postFrameGeometry: {
      left: diagnostic.postFrameGeometry.left?.rect, right: diagnostic.postFrameGeometry.right?.rect,
    } } : diagnostic;
    console.error(`FAIL ${name}: ${error.message}\nDIAGNOSTIC ${JSON.stringify(conciseDiagnostic)}`); throw error;
  }
}
const shape = node => ({ id: node.id, type: node.type, direction: node.direction, view: node.state?.type,
  file: node.state?.state?.file, children: (node.children ?? []).map(shape) });
const topology = node => ({ id: node.id, type: node.type, direction: node.direction, view: node.state?.type,
  file: node.state?.type === 'markdown' ? node.state?.state?.file : undefined, children: (node.children ?? []).map(topology) });
function sameLayout(actual, expected) { for (const side of ['main', 'left', 'right']) assert.deepEqual(shape(actual[side]), shape(expected[side])); }
const dimensions = node => ({ id: node.id, dimension: node.dimension ?? null, children: (node.children ?? []).map(dimensions) });
async function structural() { return cdp.run(() => app.workspace.getLayout()); }
function rendererColumn(side, leafId) {
  const root = side === 'left' ? app.workspace.leftSplit : app.workspace.rightSplit;
  let leaf; app.workspace.iterateAllLeaves(item => { if (item.id === leafId) leaf = item; });
  if (!leaf) throw Error('Original native leaf missing: ' + leafId);
  let full = null;
  for (let item = leaf.parent; item && item !== root; item = item.parent) if (item.direction === 'vertical') full = item;
  if (!full) throw Error('Full-height native column split missing.');
  let branch = leaf.parent; while (branch.parent !== full) branch = branch.parent;
  const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const walk = node => ({ id: node.id, type: node.type, direction: node.direction, viewType: node.view?.getViewType?.(),
    geometry: rect(node.containerEl), children: (node.children ?? []).map(walk) });
  return { rootId: root.id, rootDirection: root.direction, rootGeometry: rect(root.containerEl),
    full: walk(full), branch: walk(branch), leafId: leaf.id, parentId: leaf.parent.id,
    collapsedCount: app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount() };
}
async function column(side, leafId) { return cdp.run(rendererColumn, side, leafId); }
function assertFullHeight(value, count) {
  assert.equal(value.rootDirection, 'horizontal'); assert.equal(value.full.direction, 'vertical');
  assert.equal(value.full.children.length, count);
  for (const child of value.full.children) {
    assert.ok(Math.abs(child.geometry.y - value.full.geometry.y) <= 3, 'Every column must start at the common top.');
    assert.ok(Math.abs(child.geometry.height - value.full.geometry.height) <= 3, 'Every column must occupy the full common height.');
  }
  assert.ok(value.full.geometry.height > 500, 'The whole column cannot merely cover the original top row.');
}
async function pointerClick(x, y, button = 'left') {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
}
function nativeHeaderPoint(id) {
  let leaf; app.workspace.iterateAllLeaves(item => { if (item.id === id) leaf = item; });
  if (!leaf) throw Error('Native fixture leaf missing: ' + id);
  const header = leaf.tabHeaderEl, r = header.getBoundingClientRect(), icon = header.querySelector('.workspace-tab-header-inner-icon');
  const iconRect = icon?.getBoundingClientRect(); const candidates = [];
  if (iconRect?.width > 0 && iconRect.height > 0) candidates.push({ x: iconRect.x + iconRect.width / 2, y: iconRect.y + iconRect.height / 2 });
  for (const ratio of [0.75, 0.5, 0.25, 0.9, 0.1]) candidates.push({ x: r.x + r.width * ratio, y: r.y + r.height / 2 });
  const point = candidates.find(candidate => header.contains(document.elementFromPoint(candidate.x, candidate.y)));
  return point ? { ...point, active: app.workspace.activeLeaf.id } : null;
}
async function focus(cdp, id) {
  await cdp.run(id => { let leaf; app.workspace.iterateAllLeaves(item => { if (item.id === id) leaf = item; });
    if (!leaf) throw Error('Native fixture leaf missing: ' + id); app.workspace.setActiveLeaf(leaf, { focus: true });
    if (!['fixture-a', 'fixture-b'].includes(id)) leaf.tabHeaderEl.focus();
  }, id);
  const point = await cdp.run(nativeHeaderPoint, id);
  if (!['fixture-a', 'fixture-b'].includes(id) && point) await pointerClick(point.x, point.y);
  await h.delay(100);
}
async function headerMenu(id, action) {
  await focus(cdp, 'fixture-a');
  const position = await cdp.run(nativeHeaderPoint, id);
  assert.ok(position, 'The selected native header has no hit-tested visible point.');
  assert.equal(position.active, 'fixture-a'); await pointerClick(position.x, position.y, 'right');
  let items;
  await until(async () => { items = await cdp.run(() => [...document.querySelectorAll('.menu-item-title')].map(item => item.textContent.trim())); return items.includes(action); }, 'Revised tab-menu action is missing.');
  assert.equal(items.filter(item => item === action).length, 1);
  await cdp.run(action => { const element = [...document.querySelectorAll('.menu-item-title')].find(item => item.textContent.trim() === action); element.closest('.menu-item').click(); }, action);
  await idle(); return items;
}
async function add(side, id, expectedCount) {
  const previous = await column(side, id).catch(() => null);
  await focus(cdp, id); await h.command(cdp, 'add-column'); await idle();
  const after = await column(side, id); assertFullHeight(after, expectedCount);
  if (previous) {
    const oldIds = new Set(previous.full.children.map(item => item.id));
    const added = after.full.children.find(item => !oldIds.has(item.id));
    assert.ok(added, 'A new native sibling was not created.');
    assert.ok(added.geometry.x > after.branch.geometry.x, 'New whole column must be visually right of the selected column.');
  }
  return after;
}
async function collapse(id) { await focus(cdp, id); await h.command(cdp, 'collapse-column'); await idle(); }
async function expandAll() { await h.command(cdp, 'expand-all-columns'); await idle(); }
async function supplementalAcceptance() {
  await record('Native empty-leaf detach closes its group while preserving existing views and a reloadable full-column layout', async () => {
    await focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-column');
    await until(async () => (await h.modalButtons(cdp)).includes('Enable experimental sidebar columns'), 'Supplement consent missing.');
    await h.clickButton(cdp, 'Enable experimental sidebar columns'); await idle(); await add('left', 'fixture-explorer', 3);
    const closed = await cdp.run(async () => {
      const root = app.workspace.leftSplit, originals = new Map();
      app.workspace.iterateAllLeaves(leaf => { if (leaf.view.getViewType() !== 'empty') originals.set(leaf.id, { leaf, view: leaf.view }); });
      const group = root.children[0].children.find(branch => branch.type === 'tabs' && branch.children.length === 1 && branch.children[0].view.getViewType() === 'empty');
      if (!group) throw Error('No operation-owned empty native group remains.');
      const leaf = group.children[0], removed = { leafId: leaf.id, groupId: group.id }; await leaf.detach(); await new Promise(resolve => setTimeout(resolve, 200));
      const live = new Map(); app.workspace.iterateAllLeaves(item => { live.set(item.id, item); });
      const mismatches = [...originals].filter(([id, original]) => live.get(id) !== original.leaf || live.get(id)?.view !== original.view)
        .map(([id, original]) => ({ id, sameLeaf: live.get(id) === original.leaf, oldViewType: original.view.getViewType(), newViewType: live.get(id)?.view.getViewType() }));
      return { ...removed, leafRemoved: !live.has(removed.leafId), originalViewsPreserved: mismatches.length === 0, mismatches };
    });
    h.json(join(EVIDENCE, 'native-group-close-detail.json'), closed);
    assert.ok(closed.leafRemoved && closed.originalViewsPreserved); assertFullHeight(await column('left', 'fixture-explorer'), 2); await flush();
    const saved = await structural(), disk = JSON.parse(readFileSync(join(VAULT, '.obsidian', 'workspace.json'), 'utf8'));
    for (const side of ['main', 'left', 'right']) assert.deepEqual(topology(disk[side]), topology(saved[side]));
    await cdp.run(async () => { const core = app.internalPlugins.plugins.workspaces.instance;
      await core.saveWorkspace('Native empty-group close fixture'); await core.loadWorkspace('Native empty-group close fixture'); }); await h.delay(200);
    const reloaded = await structural(); for (const side of ['main', 'left', 'right']) assert.deepEqual(topology(reloaded[side]), topology(saved[side]));
    assertFullHeight(await column('left', 'fixture-explorer'), 2); await h.snapshot(cdp, 'supplement-01-native-group-close');
    return { ...closed, nativeAction: 'WorkspaceLeaf.detach()', serializedAndCoreReloaded: true };
  });
  const externalData = { items: [{ mimeType: 'application/x-sidebar-columns-fixture', data: 'isolated fixture only' }], dragOperationsMask: 1 };
  await cdp.run(() => { window.__sidebarSupplementDrop = [];
    for (const type of ['dragenter', 'drop']) document.addEventListener(type, event => window.__sidebarSupplementDrop.push({ type, trusted: event.isTrusted,
      foldsBeforeNativeTarget: app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount(), busyBeforeNativeTarget: app.plugins.plugins['sidebar-columns'].adapter.isBusyGesture() }), true);
  });
  await record('Trusted CDP external-format entry expands rails before native target handlers and preserves stored dimensions', async () => {
    await collapse('fixture-explorer'); const previous = await structural();
    const position = await cdp.run(() => { const group = app.workspace.leftSplit.children[0].children.find(branch => branch.type === 'tabs');
      const r = group.containerEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    for (const type of ['dragEnter', 'dragOver']) await cdp.send('Input.dispatchDragEvent', { type, ...position, data: externalData });
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...position, data: externalData }); await h.delay(150);
    const events = await cdp.run(() => window.__sidebarSupplementDrop.splice(0));
    h.json(join(EVIDENCE, 'external-entry-events.json'), events);
    assert.ok(events.some(event => event.type === 'dragenter' && event.trusted && event.foldsBeforeNativeTarget === 0));
    const drop = events.find(event => event.type === 'drop');
    if (drop) {
      assert.ok(drop.trusted && drop.foldsBeforeNativeTarget === 0);
      assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.isBusyGesture()), false);
    } else report.limitations.push('Native external-file/direct-drop acceptance was not run: Chromium rejected the unrecognized fixture MIME before delivering drop. Trusted external entry was observed; the owned-session shutdown cleans up the unfinished fixture gesture.');
    const current = await structural(); assert.deepEqual(dimensions(current.left), dimensions(previous.left));
    assertFullHeight(await column('left', 'fixture-explorer'), 2); await h.snapshot(cdp, 'supplement-02-external-entry');
    return { payload: 'Unrecognized fixture MIME; no external file imported', events, dimensionsPreserved: true,
      externalFileDropAcceptance: 'not run', dropDelivered: Boolean(drop), cancellationAcceptance: 'owned-session cleanup only; no separately observed native dragCancel' };
  });
}
let savedWhole;
let leftWholeCount = 4;
let rightWholeCount = 3;
try {
  h.stage(); for (const file of ['Fixture A.md', 'Fixture B.md', '2026-10-08.md']) noteHashes[file] = h.sha(join(VAULT, file));
  await start();
  if (process.argv.includes('--supplement')) {
    await supplementalAcceptance();
  } else {
  await cdp.run(() => {
    const operations = app.plugins.plugins['sidebar-columns'].operations;
    for (const name of ['addColumn', 'split', 'collapse']) {
      const original = operations[name];
      operations[name] = async function (...args) { const result = await Reflect.apply(original, this, args); window.__sidebarWholeLatestOperation = { name, result }; return result; };
    }
    const adapter = app.plugins.plugins['sidebar-columns'].adapter;
    const frame = adapter.nextFrame;
    adapter.nextFrame = async function (...args) {
      const result = await Reflect.apply(frame, this, args);
      const walk = node => { const bounds = node.containerEl.getBoundingClientRect(), style = getComputedStyle(node.containerEl); return {
        id: node.id, type: node.type, direction: node.direction, dimension: node.dimension,
        rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
        style: { display: style.display, flexDirection: style.flexDirection, direction: style.direction, padding: style.padding, border: style.border, height: style.height },
        children: (node.children ?? []).map(walk) }; };
      window.__sidebarWholePostFrame = { left: walk(app.workspace.leftSplit), right: walk(app.workspace.rightSplit) }; return result;
    };
  });
  if (rtl) await record('Actual Arabic native workspace loads with RTL layout direction', async () => {
    const value = await cdp.run(() => ({ classes: document.body.className, direction: getComputedStyle(document.body).direction,
      flexDirection: getComputedStyle(app.workspace.containerEl).flexDirection, arabicText: /[\u0600-\u06ff]/.test(document.body.innerText) }));
    assert.ok(value.arabicText); assert.ok(value.direction === 'rtl' || value.classes.includes('mod-rtl')); return value;
  });
  const initial = await structural();
  await cdp.run(() => {
    const original = new Map(); const walk = node => { original.set(node.id, { node, parent: node.parent, view: node.view }); for (const child of node.children ?? []) walk(child); };
    walk(app.workspace.leftSplit); walk(app.workspace.rightSplit); window.__sidebarWholeOriginal = original;
  });
  await record('Central command gives sidebar-target guidance without consent or layout mutation', async () => {
    await cdp.run(() => { window.electronWindow.focus(); window.electronWindow.webContents.focus(); });
    await focus(cdp, 'fixture-a'); await h.command(cdp, 'add-column'); await h.delay(150);
    sameLayout(await structural(), initial);
    assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].settings.acknowledged), false);
    let guidance;
    await until(async () => { guidance = await cdp.run(() => [...document.querySelectorAll('.notice')].map(element => element.textContent).join(' | ')); return /sidebar/i.test(guidance); }, 'Sidebar targeting notice was not rendered.', 15);
    assert.ok(/sidebar/i.test(guidance)); return { guidance };
  });
  await record('First full-column consent Cancel preserves both sidebars and stacked rows', async () => {
    await focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-column');
    await until(async () => (await h.modalButtons(cdp)).includes('Cancel'), 'Consent warning was not displayed.');
    await h.clickButton(cdp, 'Cancel'); await idle(); sameLayout(await structural(), initial);
    assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].settings.acknowledged), false);
  });
  await record('Default action creates a whole left column while Files and Search remain stacked together', async () => {
    await focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-column');
    await until(async () => (await h.modalButtons(cdp)).includes('Enable experimental sidebar columns'), 'Consent enable action missing.');
    await h.clickButton(cdp, 'Enable experimental sidebar columns'); await idle();
    const value = await column('left', 'fixture-explorer'); assertFullHeight(value, 2);
    assert.equal(value.branch.direction, 'horizontal');
    assert.deepEqual(value.branch.children.map(child => child.id), ['fixture-files', 'fixture-search']);
    const added = value.full.children.find(item => item.id !== value.branch.id);
    assert.equal(added.type, 'tabs'); assert.equal(added.children[0].viewType, 'empty'); assert.ok(added.geometry.x > value.branch.geometry.x);
    await h.snapshot(cdp, 'full-01-left-two-whole'); return value;
  });
  await record('Third left column reuses the same whole-height container and inserts visually right', async () => {
    const value = await add('left', 'fixture-explorer', 3); await h.snapshot(cdp, 'full-02-left-three-whole'); return value;
  });
  await record('Default right action preserves Links and Tools rows and supports a third whole column', async () => {
    const first = await add('right', 'fixture-backlinks', 2);
    assert.equal(first.branch.direction, 'horizontal'); assert.deepEqual(first.branch.children.map(child => child.id), ['fixture-links', 'fixture-tools']);
    const added = first.full.children.find(child => child.id !== first.branch.id); assert.ok(added.geometry.x > first.branch.geometry.x);
    const third = await add('right', 'fixture-backlinks', 3); await h.snapshot(cdp, 'full-03-both-sidebars'); return { first, third };
  });
  await record('Inactive Search header primary action adds a whole column beside its containing stack', async () => {
    const items = await headerMenu('fixture-search-leaf', 'Add full-height column (experimental)');
    const value = await column('left', 'fixture-search-leaf'); assertFullHeight(value, 4);
    assert.deepEqual(value.branch.children.map(child => child.id), ['fixture-files', 'fixture-search']);
    assert.ok(items.includes('Split this row right (experimental)')); await h.snapshot(cdp, 'full-04-inactive-primary-menu'); return { items, fullColumnCount: 4 };
  });
  if (report.assets.some(item => item.kind === 'plugin' && item.name === 'Calendar')) {
    await record('Inactive Calendar header primary action adds a whole right column and keeps the Calendar view loaded', async () => {
      const beforeCalendar = await cdp.run(() => { let leaf; app.workspace.iterateAllLeaves(item => { if (item.id === 'fixture-calendar') leaf = item; }); window.__sidebarWholeCalendarView = leaf.view; return leaf.view.getViewType(); });
      assert.equal(beforeCalendar, 'calendar'); const items = await headerMenu('fixture-calendar', 'Add full-height column (experimental)');
      const value = await column('right', 'fixture-calendar'); assertFullHeight(value, 4); rightWholeCount = 4;
      assert.deepEqual(value.branch.children.map(child => child.id), ['fixture-links', 'fixture-tools']);
      assert.ok(await cdp.run(() => { let leaf; app.workspace.iterateAllLeaves(item => { if (item.id === 'fixture-calendar') leaf = item; }); return leaf.view === window.__sidebarWholeCalendarView; }));
      await h.snapshot(cdp, 'full-04-calendar-primary-menu'); return { items, version: report.assets.find(item => item.name === 'Calendar').version };
    });
  } else report.limitations.push('Calendar distributable assets were unavailable; its dedicated menu scenario was skipped.');
  await record('Secondary row action splits only the Files row inside its full-height column', async () => {
    const beforeRow = await column('left', 'fixture-explorer');
    const items = await headerMenu('fixture-explorer', 'Split this row right (experimental)');
    const value = await column('left', 'fixture-explorer'); assertFullHeight(value, 4); assert.equal(value.branch.id, beforeRow.branch.id);
    const top = value.branch.children[0], bottom = value.branch.children[1];
    assert.equal(top.direction, 'vertical'); assert.equal(top.children.length, 2); assert.equal(bottom.id, 'fixture-search');
    assert.ok(Math.abs(top.geometry.width - bottom.geometry.width) < 3); assert.ok(bottom.geometry.y > top.geometry.y);
    assert.ok(top.geometry.height < value.full.geometry.height - 100); await h.snapshot(cdp, 'full-05-secondary-row'); return { items, value };
  });
  await record('All original native objects, views and group IDs survive whole-column wrapping and row splitting', async () => {
    const result = await cdp.run(() => {
      const current = new Map(); const walk = node => { current.set(node.id, node); for (const child of node.children ?? []) walk(child); };
      walk(app.workspace.leftSplit); walk(app.workspace.rightSplit);
      const mismatches = [];
      for (const [id, original] of window.__sidebarWholeOriginal) { const node = current.get(id); if (node !== original.node || node?.view !== original.view) mismatches.push(id); }
      return { originalCount: window.__sidebarWholeOriginal.size, mismatches };
    });
    assert.deepEqual(result.mismatches, []); assert.deepEqual(shape((await structural()).main), shape(initial.main)); return result;
  });
  await record('Whole-column collapse includes nested rows, retains loaded panels and preserves native dimensions', async () => {
    const beforeFold = await structural(); const nativeBefore = await cdp.run(() => { const walk = node => ({ id: node.id, dimension: node.dimension ?? null, children: (node.children ?? []).map(walk) }); return { left: walk(app.workspace.leftSplit), right: walk(app.workspace.rightSplit) }; });
    await collapse('fixture-explorer'); await collapse('fixture-backlinks');
    const folded = await cdp.run(() => {
      const check = node => ({ id: node.id, dimension: node.dimension ?? null, children: (node.children ?? []).map(check) });
      const containers = new Map(); const collect = node => { containers.set(node.containerEl, node); for (const child of node.children ?? []) collect(child); };
      collect(app.workspace.leftSplit); collect(app.workspace.rightSplit);
      const rails = [...document.querySelectorAll('.sidebar-columns-collapsed')].map(element => {
        const children = containers.get(element)?.children ?? [];
        return { width: element.getBoundingClientRect().width, childCount: children.length,
          inert: children.every(child => child.containerEl.inert), hidden: children.every(child => getComputedStyle(child.containerEl).display === 'none'),
          accessibleButton: Boolean(element.querySelector('button[aria-label="Expand sidebar column"][aria-expanded="false"]')) };
      });
      return { count: app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount(), rails, left: check(app.workspace.leftSplit), right: check(app.workspace.rightSplit),
        originalsLoaded: [...window.__sidebarWholeOriginal].every(([id, original]) => !original.view || original.node.view === original.view) };
    });
    assert.equal(folded.count, 2); assert.deepEqual({ left: folded.left, right: folded.right }, nativeBefore);
    assert.ok(folded.originalsLoaded); for (const rail of folded.rails) { assert.ok(rail.width >= 30 && rail.width <= 34); assert.ok(rail.inert); assert.ok(rail.hidden); assert.ok(rail.accessibleButton); assert.equal(rail.childCount, 2); }
    sameLayout(await structural(), beforeFold);
    const other = await cdp.run(() => { let leaf; app.workspace.iterateAllLeaves(item => {
      if (!leaf && item.view.getViewType() === 'empty' && item.getRoot() === app.workspace.leftSplit
        && !item.containerEl.closest('.sidebar-columns-collapsed') && item.tabHeaderEl.getBoundingClientRect().width > 0) leaf = item;
    }); if (!leaf) throw Error('No visible expanded sibling tab remains.'); return leaf.id; });
    await focus(cdp, other); assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount()), 2);
    await h.snapshot(cdp, 'full-06-whole-folds'); return { railWidths: folded.rails.map(item => item.width), ordinaryTabPreservesFolds: true, dimensionsPreserved: true };
  });
  await record('Keyboard Enter expands the focused rail and restores the entire nested column', async () => {
    await cdp.send('Page.bringToFront');
    const focus = await cdp.run(() => { window.electronWindow.focus(); window.electronWindow.webContents.focus();
      const button = document.querySelector('.sidebar-columns-restore'); button.focus(); return { focused: document.activeElement === button, documentFocused: document.hasFocus() }; });
    assert.equal(focus.focused, true); assert.equal(focus.documentFocused, true);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await h.delay(100);
    assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount()), 1);
    await expandAll(); assertFullHeight(await column('left', 'fixture-explorer'), 4); await h.snapshot(cdp, 'full-07-keyboard-expand');
  });
  await record('Native column-divider press synchronously expands rails and drag changes width', async () => {
    await collapse('fixture-explorer');
    const handle = await cdp.run(() => {
      const root = app.workspace.leftSplit; const full = root.children[0];
      const branch = full.children.find(item => { const r = item.resizeHandleEl.getBoundingClientRect(); return r.width > 0 && r.height > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === item.resizeHandleEl; });
      if (!branch) throw Error('No hit-tested native full-column divider.');
      const r = branch.resizeHandleEl.getBoundingClientRect(), b = branch.containerEl.getBoundingClientRect(); return { id: branch.id, x: r.x + r.width / 2, y: r.y + r.height / 2, width: b.width };
    });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 });
    assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount()), 0);
    const expandedWidth = await cdp.run(id => { let found; const walk = node => { if (node.id === id) found = node; for (const child of node.children ?? []) walk(child); }; walk(app.workspace.leftSplit); return found.containerEl.getBoundingClientRect().width; }, handle.id);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 45, y: handle.y, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 45, y: handle.y, button: 'left', clickCount: 1 }); await h.delay(200);
    const width = await cdp.run(id => { let found; const walk = node => { if (node.id === id) found = node; for (const child of node.children ?? []) walk(child); }; walk(app.workspace.leftSplit); return found.containerEl.getBoundingClientRect().width; }, handle.id);
    assert.ok(Math.abs(width - expandedWidth) > 10, 'The native drag must change width after synchronous rail expansion.'); await h.snapshot(cdp, 'full-08-native-resize'); return { before: handle, expandedWidth, afterWidth: width };
  });
  await record('A genuine native Markdown tab drag clears folds and moves into another whole column', async () => {
    const dragFixture = await cdp.run(async () => {
      const root = app.workspace.leftSplit, full = root.children[0]; const candidates = full.children.filter(branch => branch.type === 'tabs');
      const source = candidates.at(-1).children[0], target = candidates[0];
      await source.setViewState({ type: 'markdown', state: { file: 'Fixture B.md', mode: 'source' } });
      window.__sidebarWholeDrag = { source, target }; return { sourceId: source.id, targetId: target.id, oldParent: source.parent.id };
    });
    await collapse('fixture-explorer');
    await cdp.send('Page.bringToFront');
    const position = await cdp.run(() => {
      window.electronWindow.focus(); window.electronWindow.webContents.focus(); window.__sidebarWholeDragEvents = [];
      for (const type of ['dragstart', 'dragend', 'drop']) document.addEventListener(type, event => {
        const sample = { type, trusted: event.isTrusted, x: event.clientX, y: event.clientY, target: event.target?.className };
        window.__sidebarWholeDragEvents.push(sample);
        if (type === 'dragstart') queueMicrotask(() => { sample.prevented = event.defaultPrevented;
          sample.effectAllowed = event.dataTransfer.effectAllowed;
          sample.items = [...event.dataTransfer.types].map(mimeType => ({ mimeType, data: event.dataTransfer.getData(mimeType) }));
        });
      }, { capture: true });
      const source = window.__sidebarWholeDrag.source;
      const icon = source.tabHeaderEl.querySelector('.workspace-tab-header-inner-icon');
      const candidate = icon && icon.getBoundingClientRect().width > 0 ? icon : source.tabHeaderEl;
      const r = candidate.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, hitSourceHeader: source.tabHeaderEl.contains(document.elementFromPoint(x, y)), width: r.width, height: r.height };
    });
    assert.ok(position.hitSourceHeader); assert.ok(position.width > 0 && position.height > 0);
    let data; cdp.on('Input.dragIntercepted', event => { data = event.data; }); await cdp.send('Input.setInterceptDrags', { enabled: true });
    let target;
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 10 && !data; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x + i * 8, y: position.y + i * 4, button: 'left', buttons: 1 }); await h.delay(30); }
      await until(async () => Boolean(data), 'Native tab drag was not intercepted.', 10).catch(async error => {
        const events = await cdp.run(() => window.__sidebarWholeDragEvents); h.json(join(EVIDENCE, 'native-drag-events.json'), { position, events });
        throw new Error(error.message + ' Events: ' + JSON.stringify(events));
      });
      const foldedAtNativeStart = await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount());
      assert.equal(foldedAtNativeStart, 1, 'Creating native drag data must preserve the source header until Chrome owns the drag.');
      await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: position.x, y: position.y, data });
      assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount()), 0);
      target = await cdp.run(() => { const r = window.__sidebarWholeDrag.target.containerEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 20 }; });
      for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, ...target, data }); await h.delay(250);
      const result = await cdp.run(() => ({ parent: window.__sidebarWholeDrag.source.parent.id, type: window.__sidebarWholeDrag.source.view.getViewType(), folds: app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount() }));
      assert.notEqual(result.parent, dragFixture.oldParent); assert.equal(result.parent, dragFixture.targetId); assert.equal(result.type, 'markdown'); assert.equal(result.folds, 0);
      leftWholeCount = 3;
      await h.snapshot(cdp, 'full-09-native-drop'); return { ...dragFixture, foldedAtNativeStart, expandedBeforeNativeTarget: true, result };
    } finally {
      await cdp.send('Input.setInterceptDrags', { enabled: false });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...(target ?? position), button: 'left', clickCount: 1 });
    }
  }).catch(() => { process.exitCode = 1; });
  await record('A genuine first-gesture central tab drag expands folded sidebar columns before native drop', async () => {
    const fixture = await cdp.run(() => {
      let source; app.workspace.iterateAllLeaves(leaf => { if (leaf.id === 'fixture-b') source = leaf; });
      const target = app.workspace.leftSplit.children[0].children.find(branch => branch.type === 'tabs');
      if (!source || !target) throw Error('Central native drag fixture unavailable.');
      window.__sidebarWholeCentralDrag = { source, target };
      return { sourceId: source.id, oldParent: source.parent.id, targetId: target.id };
    });
    await collapse('fixture-explorer'); await cdp.send('Page.bringToFront');
    const position = await cdp.run(() => {
      window.electronWindow.focus(); window.electronWindow.webContents.focus(); window.__sidebarWholeDragEvents = [];
      const source = window.__sidebarWholeCentralDrag.source, icon = source.tabHeaderEl.querySelector('.workspace-tab-header-inner-icon');
      const element = icon && icon.getBoundingClientRect().width > 0 ? icon : source.tabHeaderEl;
      const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, hit: source.tabHeaderEl.contains(document.elementFromPoint(x, y)) };
    });
    assert.ok(position.hit); let data;
    cdp.on('Input.dragIntercepted', event => { data = event.data; }); await cdp.send('Input.setInterceptDrags', { enabled: true });
    let target;
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 10 && !data; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x + i * 8, y: position.y + i * 4, button: 'left', buttons: 1 }); await h.delay(30); }
      await until(async () => Boolean(data), 'Native central drag was not intercepted.', 10);
      const foldedAtNativeStart = await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount());
      assert.equal(foldedAtNativeStart, 1);
      await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: position.x, y: position.y, data });
      assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount()), 0);
      target = await cdp.run(() => { const r = window.__sidebarWholeCentralDrag.target.containerEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 20 }; });
      for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, ...target, data }); await h.delay(200);
      const result = await cdp.run(() => ({ parent: window.__sidebarWholeCentralDrag.source.parent.id,
        type: window.__sidebarWholeCentralDrag.source.view.getViewType(), folds: app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount() }));
      assert.equal(result.parent, fixture.targetId); assert.notEqual(result.parent, fixture.oldParent); assert.equal(result.type, 'markdown'); assert.equal(result.folds, 0);
      await h.snapshot(cdp, 'full-09-central-native-drop'); return { ...fixture, foldedAtNativeStart, expandedBeforeNativeTarget: true, result };
    } finally {
      await cdp.send('Input.setInterceptDrags', { enabled: false });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...(target ?? position), button: 'left', clickCount: 1 });
    }
  }).catch(() => { process.exitCode = 1; });
  await record('Native central splitting still works alongside full-height sidebar columns', async () => {
    await focus(cdp, 'fixture-a'); const result = await cdp.run(() => { const old = app.workspace.activeLeaf; const created = app.workspace.createLeafBySplit(old, 'vertical', false); return { oldRoot: old.getRoot().id, newRoot: created.getRoot().id, centralRoot: app.workspace.rootSplit.id, distinctGroups: old.parent !== created.parent }; });
    assert.equal(result.oldRoot, result.centralRoot); assert.equal(result.newRoot, result.centralRoot); assert.ok(result.distinctGroups); return result;
  });
  await record('Core Workspaces saves and restores the real full-column and mixed-row topology', async () => {
    await cdp.run(async () => await app.internalPlugins.plugins.workspaces.instance.saveWorkspace('Full-height sidebar runtime fixture'));
    savedWhole = await cdp.run(() => app.internalPlugins.plugins.workspaces.instance.workspaces['Full-height sidebar runtime fixture']);
    assert.ok(savedWhole); await collapse('fixture-explorer'); await collapse('fixture-backlinks');
    await cdp.run(async () => await app.internalPlugins.plugins.workspaces.instance.loadWorkspace('Full-height sidebar runtime fixture')); await h.delay(250); await idle();
    sameLayout(await structural(), savedWhole); assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount()), 0);
    assertFullHeight(await column('left', 'fixture-explorer'), leftWholeCount); assertFullHeight(await column('right', 'fixture-backlinks'), rightWholeCount);
    await h.snapshot(cdp, 'full-10-core-workspace-restore');
  });
  await record('Full-workspace backup validates raw mixed layout and restores whole columns after explicit confirmation', async () => {
    const snapshot = await cdp.run(() => app.plugins.plugins['sidebar-columns'].backups.create(app.workspace.getLayout(), 'full-column-runtime'));
    const raw = readFileSync(join(VAULT, snapshot.rawPath), 'utf8'); const metadata = JSON.parse(readFileSync(join(VAULT, snapshot.metadataPath), 'utf8'));
    assert.equal(createHash('sha256').update(raw).digest('hex'), metadata.sha256); sameLayout(JSON.parse(raw), savedWhole);
    await collapse('fixture-explorer'); await cdp.run(snapshot => { window.__sidebarWholeRestore = app.plugins.plugins['sidebar-columns'].operations.restore(snapshot); }, snapshot);
    await until(async () => (await h.modalButtons(cdp)).includes('Restore full workspace'), 'Full-workspace restore confirmation missing.');
    await h.clickButton(cdp, 'Restore full workspace'); await idle(); const result = await cdp.run(async () => await window.__sidebarWholeRestore);
    assert.equal(result.status, 'success'); sameLayout(await structural(), savedWhole); assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount()), 0);
    await h.snapshot(cdp, 'full-11-plugin-workspace-restore'); return { rawValidated: true, checksumValidated: true, result };
  });
  await record('Disabling and re-enabling removes presentation but preserves full native columns', async () => {
    await collapse('fixture-explorer'); const layout = await structural();
    await cdp.run(async () => await app.plugins.disablePlugin('sidebar-columns'));
    const disabled = await cdp.run(() => ({ plugin: Boolean(app.plugins.plugins['sidebar-columns']), command: Boolean(app.commands.findCommand('sidebar-columns:add-column')), rails: document.querySelectorAll('.sidebar-columns-rail,.sidebar-columns-collapsed').length }));
    assert.deepEqual(disabled, { plugin: false, command: false, rails: 0 }); sameLayout(await structural(), layout);
    await cdp.run(async () => await app.plugins.enablePlugin('sidebar-columns')); await h.readiness(cdp); await h.assertIsolation(cdp);
    assert.ok(await cdp.run(() => Boolean(app.commands.findCommand('sidebar-columns:add-column')))); await h.snapshot(cdp, 'full-12-plugin-reloaded'); return disabled;
  });
  await record('Saved proportions ignore 32px rails and a guarded restart retains whole columns expanded', async () => {
    const expanded = await structural(); await collapse('fixture-explorer'); await collapse('fixture-backlinks'); await flush();
    const serialized = JSON.parse(readFileSync(join(VAULT, '.obsidian', 'workspace.json'), 'utf8'));
    for (const side of ['main', 'left', 'right']) assert.deepEqual(topology(serialized[side]), topology(expanded[side]));
    assert.deepEqual(dimensions(serialized.left), dimensions(expanded.left)); assert.deepEqual(dimensions(serialized.right), dimensions(expanded.right));
    await close(); await start(); const restarted = await structural();
    for (const side of ['main', 'left', 'right']) assert.deepEqual(topology(restarted[side]), topology(expanded[side]));
    assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount()), 0);
    assertFullHeight(await column('left', 'fixture-explorer'), leftWholeCount); assertFullHeight(await column('right', 'fixture-backlinks'), rightWholeCount);
    await h.snapshot(cdp, 'full-13-restarted'); return { nativeSerializationPreserved: true, restartExpanded: true, launches: report.launches.length };
  });
  for (const asset of report.assets.filter(item => item.kind === 'theme')) await record(asset.name + ' theme retains full-height columns with clean fixture settings', async () => {
    const proof = await cdp.run(async name => { app.customCss.setTheme(name); await app.customCss.loadTheme(); const text = app.customCss.styleEl.textContent; const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return { name: app.customCss.theme, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }; }, asset.name);
    assert.equal(proof.sha256, h.sha(join(VAULT, '.obsidian', 'themes', asset.name, 'theme.css'))); await h.delay(200);
    assertFullHeight(await column('left', 'fixture-explorer'), leftWholeCount); assertFullHeight(await column('right', 'fixture-backlinks'), rightWholeCount);
    await h.snapshot(cdp, 'full-14-theme-' + asset.name.replaceAll(' ', '-')); return { ...asset, stylesheetApplied: proof, geometryOnly: true };
  });
  await cdp.run(async () => { app.customCss.setTheme(''); await app.customCss.loadTheme(); });
  await record('Full-height columns persist at 125 and 150 percent scaling', async () => {
    try { for (const factor of [1.25, 1.5]) { await cdp.run(value => require('electron').webFrame.setZoomFactor(value), factor); await h.delay(200);
      const left = await column('left', 'fixture-explorer'), right = await column('right', 'fixture-backlinks');
      for (const [value, count] of [[left, leftWholeCount], [right, rightWholeCount]]) { assert.equal(value.full.children.length, count); for (const child of value.full.children) assert.ok(Math.abs(child.geometry.height - value.full.geometry.height) <= 3); }
      await h.snapshot(cdp, 'full-15-scale-' + factor); }
    } finally { await cdp.run(() => require('electron').webFrame.setZoomFactor(1)); }
  });
  await record('Closing and reopening both outer sidebars preserves full native columns', async () => {
    const previous = await structural(); await cdp.run(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); }); await h.delay(100);
    await cdp.run(() => { app.workspace.leftSplit.expand(); app.workspace.rightSplit.expand(); }); await h.delay(200);
    const reopened = await structural();
    for (const side of ['main', 'left', 'right']) assert.deepEqual(topology(reopened[side]), topology(previous[side]));
    assertFullHeight(await column('left', 'fixture-explorer'), leftWholeCount); assertFullHeight(await column('right', 'fixture-backlinks'), rightWholeCount);
  });
  await record('Narrow-window native width limit remains recoverable by closing a sidebar or widening', async () => {
    await cdp.run(() => window.electronWindow.setSize(900, 700)); await h.delay(200);
    const narrow = await cdp.run(() => ({ innerWidth, center: app.workspace.rootSplit.containerEl.getBoundingClientRect().width }));
    await cdp.run(() => app.workspace.rightSplit.collapse()); await h.delay(100);
    const oneSidebar = await cdp.run(() => app.workspace.rootSplit.containerEl.getBoundingClientRect().width);
    await cdp.run(() => { window.electronWindow.setSize(1600, 1000); app.workspace.rightSplit.expand(); }); await h.delay(100);
    const widened = await cdp.run(() => app.workspace.rootSplit.containerEl.getBoundingClientRect().width);
    assert.ok(oneSidebar > 0); assert.ok(widened > 0); if (narrow.center <= 0) report.limitations.push('At 900px with both 440px sidebars open, the native central editor can be hidden. Closing one whole sidebar or widening restores it.');
    await h.snapshot(cdp, 'full-16-narrow-recovery'); return { narrow, oneSidebar, widened, nativeLimitObserved: narrow.center <= 0 };
  });
  }
} catch (error) { report.harnessError = error.stack; process.exitCode = 1; }
finally {
  try { await close(); report.ownedClosed = !pid || !processInfo(); } catch (error) { report.ownedClosed = false; report.cases.push({ name: 'Close owned isolated runtime', status: 'failed', error: error.stack }); process.exitCode = 1; }
  const after = h.productionSnapshot(); report.productionGuard = { unchanged: JSON.stringify(before) === JSON.stringify(after), before, after };
  if (!report.productionGuard.unchanged) process.exitCode = 1;
  report.fixtureNotesUnchanged = Object.entries(noteHashes).every(([file, hash]) => h.sha(join(VAULT, file)) === hash);
  if (!report.fixtureNotesUnchanged) process.exitCode = 1;
  report.finishedAt = new Date().toISOString(); h.json(join(RUN, 'report.json'), report);
  const relativeEvidence = '.runtime-tests/' + basename(RUN);
  const lines = ['# Full-height column native runtime acceptance', '', 'Run: `' + report.runId + '`. Bundle SHA-256: `' + report.bundleSha256 + '`.', '',
    'OS: ' + report.windows.caption + ' ' + report.windows.displayVersion + ' build ' + report.windows.build + '.' + report.windows.updateBuildRevision + ' (' + report.windows.architecture + '). Renderer: ' + h.VERSION + '. Installer: ' + report.installerVersion + '. Locale: ' + (rtl ? 'Arabic RTL' : 'English LTR') + '.', '',
    'Theme assets: default; ' + report.assets.filter(item => item.kind === 'theme').map(item => item.name + ' ' + item.version).join('; ') + '. Calendar: ' + (report.assets.find(item => item.name === 'Calendar')?.version ?? 'not available') + '. Clean fixture settings were used.', '',
    '| Scenario | Actual result |', '| --- | --- |', ...report.cases.map(item => '| ' + item.name.replaceAll('|', '/') + ' | ' + item.status + ' |'), '',
    'Guarded launches: ' + (report.launches?.length ?? 0) + '. Captured renderer errors: ' + report.consoleErrors.length + '. Owned process closure: ' + (report.ownedClosed ? 'confirmed' : 'failed') + '.', '',
    'Production configuration and protocol content guard: ' + (report.productionGuard.unchanged ? 'unchanged' : 'failed') + '. Fixture notes: ' + (report.fixtureNotesUnchanged ? 'unchanged' : 'changed') + '.', '',
    'Local ignored evidence: `' + relativeEvidence + '`. Raw snapshots, screenshots, native identity, build hashes and case details are retained in its report.', '',
    '## Acceptance limits', '', ...report.limitations.map(value => '- ' + value), '',
    ...(report.harnessError ? ['Harness failure: ' + report.harnessError.split('\n')[0], 'Scenarios after that failure were not run.', ''] : [])];
  const document = join(PROJECT, 'docs', 'FULL-COLUMN-TEST-RESULTS.md');
  writeFileSync(document, lines.join('\n'), 'utf8');
  console.log('Full-column evidence: ' + relativeEvidence);
}
