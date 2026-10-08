import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recovery = readFileSync(join(PROJECT, 'scripts', 'runtime-recovery.mjs'), 'utf8');
const boundary = recovery.indexOf('const shape = node =>');
assert.ok(boundary > 0, 'Cannot identify the proven isolated recovery helper boundary');
const base = join(PROJECT, '.cache', 'runtime-workspaces-base.mjs');
mkdirSync(dirname(base), { recursive: true });
const prelude = recovery.slice(0, boundary)
  .replaceAll('runtime-recovery-support.mjs', 'runtime-workspaces-support.mjs')
  .replaceAll('"recovery-"', '"workspaces-"')
  .replace('sidebar-columns-recovery-', 'sidebar-columns-workspaces-');
writeFileSync(base, prelude + '\nexport { h, report, RUN, EVIDENCE, VAULT, PROFILE, before, start, close, flush, idle, record };\n');
const support = await import(pathToFileURL(base).href);
const { h, report, RUN, EVIDENCE, VAULT, before, record } = support;
// The live connection is intentionally obtained only after guarded startup.
let cdp;
async function connection() {
  const launch = report.launches.at(-1);
  const connected = await h.attach(launch.port); await h.assertIsolation(connected); return connected;
}
const shape = node => ({ id: node.id, type: node.type, direction: node.direction, view: node.state?.type,
  file: node.state?.state?.file, children: (node.children ?? []).map(shape) });
const delay = h.delay;
async function until(fn, message, attempts = 60) { for (let i = 0; i < attempts; i++) { if (await fn()) return; await delay(200); } throw new Error(message); }
let popout;
try {
  h.stage(); await support.start(); cdp = await connection();
  const discovery = await cdp.run(() => {
    const core = app.internalPlugins.plugins.workspaces.instance;
    const names = new Set(); let prototype = core;
    while (prototype && prototype !== Object.prototype) { for (const name of Object.getOwnPropertyNames(prototype)) if (typeof core[name] === 'function') names.add(name); prototype = Object.getPrototypeOf(prototype); }
    return { methods: [...names], saveWorkspace: core.saveWorkspace?.toString(), loadWorkspace: core.loadWorkspace?.toString(),
      dataKeys: Object.keys(core.data ?? {}), popout: app.workspace.openPopoutLeaf?.toString(), move: app.workspace.moveLeafToPopout?.toString() };
  });
  h.json(join(EVIDENCE, 'core-workspaces-discovery.json'), discovery);
  console.log('DISCOVERY ' + JSON.stringify(discovery));
  await record('Native central split remains functional while Sidebar Columns hooks are installed', async () => {
    await h.focus(cdp, 'fixture-a');
    const result = await cdp.run(() => {
      const original = app.workspace.activeLeaf;
      const created = app.workspace.createLeafBySplit(original, 'vertical', false);
      return { createdId: created.id, oldGroup: original.parent.id, newGroup: created.parent.id,
        bothCentral: original.getRoot() === app.workspace.rootSplit && created.getRoot() === app.workspace.rootSplit };
    });
    assert.ok(result.bothCentral); assert.notEqual(result.oldGroup, result.newGroup);
    await h.snapshot(cdp, 'workspaces-01-central-native-split');
  });
  await record('Core Workspaces saves full-height columns and loading it clears transient rails and restores native branches', async () => {
    await h.focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-column');
    await until(async () => (await h.modalButtons(cdp)).includes('Enable experimental sidebar columns'), 'Consent modal missing');
    await h.clickButton(cdp, 'Enable experimental sidebar columns'); await support.idle();
    await h.focus(cdp, 'fixture-backlinks'); await h.command(cdp, 'add-column'); await support.idle();
    await cdp.run(async () => {
      const core = app.internalPlugins.plugins.workspaces.instance;
      if (typeof core.saveWorkspace !== 'function' || typeof core.loadWorkspace !== 'function') throw Error('Core workspace methods unavailable');
      await core.saveWorkspace('Sidebar Columns runtime fixture');
    });
    const saved = await cdp.run(() => app.internalPlugins.plugins.workspaces.instance.workspaces['Sidebar Columns runtime fixture']);
    assert.ok(saved); assert.ok(JSON.stringify(saved.left).includes('"direction":"vertical"'));
    assert.ok(JSON.stringify(saved.right).includes('"direction":"vertical"'));
    await h.focus(cdp, 'fixture-explorer'); await h.command(cdp, 'collapse-column'); await support.idle();
    assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount()), 1);
    await cdp.run(async () => await app.internalPlugins.plugins.workspaces.instance.loadWorkspace('Sidebar Columns runtime fixture'));
    await delay(350);
    const current = await cdp.run(() => ({ layout: app.workspace.getLayout(), folds: app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount(), rails: document.querySelectorAll('.sidebar-columns-rail').length }));
    assert.equal(current.folds, 0); assert.equal(current.rails, 0);
    for (const side of ['main', 'left', 'right']) assert.deepEqual(shape(current.layout[side]), shape(saved[side]));
    const snapshot = await h.snapshot(cdp, 'workspaces-02-core-layout-restored');
    assert.equal(h.columns(snapshot, 'left'), 2); assert.equal(h.columns(snapshot, 'right'), 2);
    return { coreMethods: 'saveWorkspace/loadWorkspace', savedLayoutName: 'Sidebar Columns runtime fixture', railsCleared: true };
  });
  await record('Native floating pop-out serializes into a validated complete layout backup', async () => {
    await h.focus(cdp, 'fixture-explorer');
    const created = await cdp.run(async () => {
      const leaf = app.workspace.openPopoutLeaf(); await leaf.setViewState({ type: 'empty' });
      const plugin = app.plugins.plugins['sidebar-columns'];
      const snapshot = await plugin.backups.create(app.workspace.getLayout(), 'runtime-popout-serialization');
      const loaded = await plugin.backups.load(snapshot);
      return { id: leaf.id, snapshot, floating: loaded.floating };
    });
    assert.equal(created.floating.type, 'floating');
    assert.ok(created.floating.children.some(window => window.type === 'window'));
    assert.ok(JSON.stringify(created.floating).includes(created.id));
    h.json(join(EVIDENCE, 'native-floating-backup.json'), created);
    await h.snapshot(cdp, 'workspaces-03-main-with-popout');
  });
  await record('Pop-out command cannot split a remembered main-sidebar tab or silently split its own central leaf', async () => {
    // Restore a genuine remembered main-document sidebar focus before activating the pop-out.
    await h.focus(cdp, 'fixture-explorer');
    const launch = report.launches.at(-1);
    await until(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${launch.port}/json/list`)).json();
      h.json(join(EVIDENCE, 'popout-cdp-targets.json'), targets);
      const target = targets.find(target => target.type === 'page' && target.url === 'about:blank' && target.title.startsWith('New tab - vault - Obsidian 1.14.4'));
      if (!target) return false;
      popout = new h.CDP(target.webSocketDebuggerUrl); await popout.ready; await popout.send('Runtime.enable'); return true;
    }, 'Native pop-out target not available');
    const popoutIsolation = await popout.run(() => {
      const shared = window.app ?? window.opener?.app;
      const nativeRequire = window.require ?? window.opener?.require;
      const ipc = nativeRequire('electron').ipcRenderer;
      return { resources: ipc.sendSync('resources'), version: ipc.sendSync('version'), vault: ipc.sendSync('vault'),
        vaults: ipc.sendSync('vault-list'), basePath: shared.vault.adapter.getBasePath(),
        nativeDocument: shared.workspace.floatingSplit.children.some(container => container.doc === document) };
    });
    assert.equal(h.canonical(popoutIsolation.resources), h.canonical(h.ASAR)); assert.equal(popoutIsolation.version, '1.14.4');
    assert.equal(h.canonical(popoutIsolation.vault.path), h.canonical(VAULT)); assert.equal(h.canonical(popoutIsolation.basePath), h.canonical(VAULT));
    assert.deepEqual(Object.keys(popoutIsolation.vaults), [h.FIXTURE_ID]); assert.equal(popoutIsolation.nativeDocument, true);
    h.json(join(EVIDENCE, 'popout-isolation.json'), popoutIsolation);
    const pre = await cdp.run(() => app.workspace.getLayout());
    const attempted = await popout.run(async () => {
      const shared = window.app ?? window.opener?.app;
      const plugin = shared.plugins.plugins['sidebar-columns'];
      const leaf = shared.workspace.floatingSplit.children[0].children[0].children[0];
      shared.workspace.setActiveLeaf(leaf, { focus: true }); window.focus();
      let targetError;
      try { plugin.adapter.resolveCommandTarget(); } catch (error) { targetError = error.message; }
      for (const command of ['add-column', 'split-right', 'collapse-column']) shared.commands.executeCommandById('sidebar-columns:' + command);
      await new Promise(resolve => setTimeout(resolve, 200));
      return { targetError, activeDocumentIsPopout: (typeof activeDocument === 'undefined' ? window.opener?.activeDocument : activeDocument) === document, activeId: shared.workspace.activeLeaf.id,
        notice: [...document.querySelectorAll('.notice')].map(node => node.textContent).join(' | ') };
    });
    assert.ok(attempted.targetError); assert.equal(attempted.activeDocumentIsPopout, true);
    const post = await cdp.run(() => app.workspace.getLayout());
    for (const side of ['main', 'left', 'right', 'floating']) assert.deepEqual(shape(post[side]), shape(pre[side]));
    h.json(join(EVIDENCE, 'popout-target-rejection.json'), attempted);
    const shot = await popout.send('Page.captureScreenshot', { format: 'png' });
    const imagePath = join(EVIDENCE, 'workspaces-04-popout-rejected.png'); h.safeWrite(imagePath);
    writeFileSync(imagePath, Buffer.from(shot.data, 'base64'));
    return { actionableTargetGuidance: attempted.targetError, treeUnchanged: true };
  });
} catch (error) { report.harnessError = error.stack; process.exitCode = 1; }
finally {
  popout?.close(); cdp?.close();
  try { await support.close(); report.ownedClosed = true; }
  catch (error) { report.ownedClosed = false; report.cases.push({ name: 'Close owned isolated runtime', status: 'failed', error: error.stack }); process.exitCode = 1; }
  const after = h.productionSnapshot(); report.productionGuard = { unchanged: JSON.stringify(before) === JSON.stringify(after), before, after };
  if (!report.productionGuard.unchanged) process.exitCode = 1;
  report.finishedAt = new Date().toISOString(); h.json(join(RUN, 'report.json'), report);
  const lines = ['# Core Workspaces and pop-out runtime acceptance', '', 'Final bundle SHA-256: `' + report.bundleSha256 + '`.', '',
    'OS: ' + report.windows.caption + ' ' + report.windows.displayVersion + ' build ' + report.windows.build + '.' + report.windows.updateBuildRevision + ' (' + report.windows.architecture + '); renderer 1.14.4; installer ' + report.installerVersion + '; default theme.', '',
    '| Scenario | Actual result |', '| --- | --- |', ...report.cases.map(item => '| ' + item.name.replaceAll('|', '/') + ' | ' + item.status + ' |'), '',
    'Evidence: `.runtime-tests/' + report.runId + '`. Actual core-method discovery, guarded native launches, screenshots, floating snapshot and targeting rejection are preserved locally.', '',
    'Production configuration/protocol content guard: ' + (report.productionGuard.unchanged ? 'unchanged' : 'failed') + '. Owned process closure: ' + (report.ownedClosed ? 'confirmed' : 'failed') + '.', '',
    'Other platforms/versions, pop-out sidebar splitting, extra themes and arbitrary third-party panels were not run in this subset.', '',
    ...(report.harnessError ? ['Harness failure: ' + report.harnessError.split('\n')[0], 'Scenarios after that failure were not run.', ''] : [])];
  writeFileSync(join(PROJECT, 'docs', 'WORKSPACES-TEST-RESULTS.md'), lines.join('\n'), 'utf8');
  console.log('Workspaces evidence: ' + RUN);
}
