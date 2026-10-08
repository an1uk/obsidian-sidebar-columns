import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.ok(process.argv.includes('--run'), 'Pass --run explicitly for isolated v0.1.1 native acceptance.');
assert.ok(!process.argv.includes('--supplement'), 'This runner verifies the full suite and focused review fixes.');
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let source = readFileSync(join(PROJECT, 'scripts', 'runtime-full-columns.mjs'), 'utf8').replaceAll('\r\n', '\n');
const insertion = 'let savedWhole;';
const ending = "  }\n} catch (error) { report.harnessError = error.stack; process.exitCode = 1; }";
assert.equal(source.split(insertion).length, 2, 'Full-suite insertion boundary changed.');
assert.equal(source.split(ending).length, 2, 'Full-suite completion boundary changed.');

async function verifyReviewFixSettings() {
  let settingsCdp;
  const settingsConnection = async () => {
    const owner = await cdp.run(() => ({ sameDocument: app.setting.modalEl.ownerDocument === document,
      connected: app.setting.modalEl.isConnected, url: app.setting.modalEl.ownerDocument.URL }));
    if (owner.sameDocument) return cdp;
    if (settingsCdp) return settingsCdp;
    await until(async () => {
      const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      for (const target of targets.filter(item => item.type === 'page')) {
        const candidate = new h.CDP(target.webSocketDebuggerUrl); await candidate.ready;
        let state;
        try { state = await candidate.run(() => {
          const shared = window.app ?? window.opener?.app, nativeRequire = window.require ?? window.opener?.require;
          if (!shared?.setting || !nativeRequire || shared.setting.modalEl.ownerDocument !== document) return null;
          const ipc = nativeRequire('electron').ipcRenderer;
          return { resources: ipc.sendSync('resources'), version: ipc.sendSync('version'), vault: ipc.sendSync('vault'), vaults: ipc.sendSync('vault-list'),
            basePath: shared.vault.adapter.getBasePath(), isSettingsDocument: shared.setting.modalEl.ownerDocument === document };
        }); } catch {}
        if (!state) { candidate.close(); continue; }
        assert.equal(h.canonical(state.resources), h.canonical(h.ASAR)); assert.equal(state.version, h.VERSION);
        assert.equal(h.canonical(state.vault.path), h.canonical(VAULT)); assert.equal(h.canonical(state.basePath), h.canonical(VAULT));
        assert.deepEqual(Object.keys(state.vaults), [h.FIXTURE_ID]); assert.equal(state.isSettingsDocument, true);
        ownedProcess(); settingsCdp = candidate; report.settingsWindowIsolation = state; return true;
      }
      return false;
    }, 'Cannot identify the native settings window inside the owned fixture.', 30);
    return settingsCdp;
  };
  const settingsClick = async point => {
    const connection = await settingsConnection(); await connection.send('Page.bringToFront');
    await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const settingsScreenshot = async name => {
    const connection = await settingsConnection(), shot = await connection.send('Page.captureScreenshot', { format: 'png' });
    const path = join(EVIDENCE, name + '.png'); h.safeWrite(path); writeFileSync(path, Buffer.from(shot.data, 'base64'));
  };
  const buttonPoint = async label => cdp.run(label => {
    const tab = app.plugins.plugins['sidebar-columns'].settingsTab;
    const button = [...tab.containerEl.querySelectorAll('button')].find(item => item.textContent.trim() === label || (label === 'Restore full workspace' && item.textContent.trim().startsWith(label)));
    if (!button || button.disabled) throw Error('Actionable native settings button missing: ' + label);
    button.scrollIntoView({ block: 'center' }); const r = button.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  const open = async () => {
    await cdp.run(() => { app.setting.open(); app.setting.openTabById('sidebar-columns'); });
    await until(() => cdp.run(() => app.plugins.plugins['sidebar-columns'].settingsTab.containerEl.innerText.includes('Session-only column collapse')), 'Native declarative settings did not render.');
    await settingsConnection();
  };
  await record('Native declarative settings heading, controls and search-index definitions render on Obsidian 1.14.4', async () => {
    await open();
    const detail = await cdp.run(() => {
      const plugin = app.plugins.plugins['sidebar-columns'], tab = plugin.settingsTab;
      const definitions = tab.settingItems;
      return { pluginVersion: plugin.manifest.version, ownDisplayOverride: Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(tab), 'display'),
        heading: definitions[0]?.heading, names: definitions[0]?.items?.map(item => item.name),
        aliases: definitions[0]?.items?.flatMap(item => item.aliases ?? []),
        renderedText: tab.containerEl.innerText, nativeDocument: { sameDocument: tab.containerEl.ownerDocument === document, connected: tab.containerEl.isConnected, url: tab.containerEl.ownerDocument.URL },
        buttons: [...tab.containerEl.querySelectorAll('button')].map(item => item.textContent.trim()),
        headings: [...tab.containerEl.querySelectorAll('h1,h2,h3,.setting-item-heading,.setting-group-heading')].map(item => item.textContent.trim()) };
    });
    assert.equal(detail.pluginVersion, '0.1.1'); assert.equal(detail.ownDisplayOverride, false); assert.equal(detail.heading, 'Sidebar columns');
    assert.equal(detail.names.length, 7); assert.ok(detail.aliases.includes('clear overrides')); assert.ok(detail.aliases.includes('restore full workspace'));
    assert.ok(detail.renderedText.includes('Sidebar columns')); assert.ok(detail.buttons.includes('Expand all columns'));
    assert.ok(detail.buttons.includes('Clear overrides')); assert.ok(detail.buttons.some(value => value.startsWith('Restore full workspace')));
    await h.snapshot(cdp, 'review-01-native-settings'); await settingsScreenshot('review-01-settings-window'); return detail;
  });
  await record('Native settings search locates the indexed overrides action', async () => {
    const input = await cdp.run(() => {
      const modal = app.setting.modalEl;
      const element = [...modal.querySelectorAll('input')].find(item => (item.type === 'search' || /search|بحث/i.test(item.placeholder)) && item.getBoundingClientRect().width > 0);
      if (!element) return { available: false, inputs: [...modal.querySelectorAll('input')].map(item => ({ type: item.type, placeholder: item.placeholder })) };
      element.focus(); window.__reviewSettingsSearch = element; return { available: true, placeholder: element.placeholder };
    });
    assert.equal(input.available, true, 'Native settings search input was not available.');
    const searchConnection = await settingsConnection(); await searchConnection.send('Page.bringToFront');
    await searchConnection.send('Input.insertText', { text: 'clear overrides' });
    await until(() => cdp.run(() => {
      const modal = app.setting.modalEl; return modal.innerText.includes('Untested-version overrides') && modal.innerText.includes('Clear overrides');
    }), 'Indexed overrides setting did not appear in native search.');
    const detail = await cdp.run(() => ({ query: window.__reviewSettingsSearch.value,
      rows: [...app.setting.modalEl.querySelectorAll('.setting-item-name')].map(item => item.textContent.trim()),
      matchingNodes: [...app.setting.modalEl.querySelectorAll('[class*="search"]')].filter(item => item.textContent.includes('Untested-version overrides')).map(item => ({ className: item.className, text: item.innerText.slice(0, 1500) })) }));
    assert.equal(detail.query, 'clear overrides'); assert.ok(detail.rows.includes('Untested-version overrides') || detail.matchingNodes.length > 0);
    await h.snapshot(cdp, 'review-02-settings-search'); await settingsScreenshot('review-02-settings-search-window');
    await cdp.run(() => { const input = window.__reviewSettingsSearch; input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); app.setting.openTabById('sidebar-columns'); });
    await h.delay(150); return { ...input, ...detail };
  });
  await record('Native dimension refresh keeps a 32px rail and settings Expand restores owned inline styles', async () => {
    await cdp.run(() => app.setting.close()); settingsCdp?.close(); settingsCdp = undefined; await focus(cdp, 'fixture-explorer');
    const baseline = await cdp.run(() => {
      let leaf; app.workspace.iterateAllLeaves(item => { if (item.id === 'fixture-explorer') leaf = item; });
      const root = app.workspace.leftSplit; let split;
      for (let item = leaf.parent; item && item !== root; item = item.parent) if (item.direction === 'vertical') split = item;
      let branch = leaf.parent; while (branch.parent !== split) branch = branch.parent;
      const properties = ['flex-grow', 'flex-shrink', 'flex-basis', 'width', 'min-width', 'max-width'];
      window.__reviewFoldBranch = branch; window.__reviewFoldSetter = branch.setDimension;
      return { id: branch.id, dimension: branch.dimension, properties: Object.fromEntries(properties.map(property => [property, { value: branch.containerEl.style.getPropertyValue(property), priority: branch.containerEl.style.getPropertyPriority(property) }])) };
    });
    await h.command(cdp, 'collapse-column'); await idle();
    const refreshed = await cdp.run(() => { const branch = window.__reviewFoldBranch; const dimension = branch.dimension;
      const wrapped = branch.setDimension !== window.__reviewFoldSetter; branch.setDimension(dimension);
      return { wrapped, dimension: branch.dimension, width: branch.containerEl.getBoundingClientRect().width, priority: branch.containerEl.style.getPropertyPriority('width'),
        collapsed: app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount() };
    });
    assert.equal(refreshed.wrapped, true); assert.equal(refreshed.dimension, baseline.dimension); assert.equal(refreshed.collapsed, 1);
    assert.ok(refreshed.width >= 30 && refreshed.width <= 34); assert.equal(refreshed.priority, '');
    await open(); const point = await buttonPoint('Expand all columns'); await settingsClick(point); await h.delay(100);
    const expanded = await cdp.run(properties => { const branch = window.__reviewFoldBranch;
      return { collapsed: app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount(), dimension: branch.dimension,
        setterRestored: branch.setDimension === window.__reviewFoldSetter,
        properties: Object.fromEntries(properties.map(property => [property, { value: branch.containerEl.style.getPropertyValue(property), priority: branch.containerEl.style.getPropertyPriority(property) }])) };
    }, Object.keys(baseline.properties));
    assert.equal(expanded.collapsed, 0); assert.equal(expanded.dimension, baseline.dimension); assert.equal(expanded.setterRestored, true);
    assert.deepEqual(expanded.properties, baseline.properties); await h.snapshot(cdp, 'review-03-native-dimension-expand'); return { baseline, refreshed, expanded };
  });
  await record('Clear overrides updates native definitions, DOM and persisted state without recalling display', async () => {
    await cdp.run(async () => {
      const plugin = app.plugins.plugins['sidebar-columns'], tab = plugin.settingsTab;
      plugin.settings.versionOverrides = ['99.99.99']; await plugin.saveData(plugin.settings); tab.update();
      window.__reviewSettingsCalls = { update: 0, display: 0 }; const update = tab.update, display = tab.display;
      tab.update = function (...args) { window.__reviewSettingsCalls.update++; return Reflect.apply(update, this, args); };
      tab.display = function (...args) { window.__reviewSettingsCalls.display++; return Reflect.apply(display, this, args); };
    });
    await until(() => cdp.run(() => app.plugins.plugins['sidebar-columns'].settingsTab.containerEl.innerText.includes('99.99.99')), 'Override fixture was not rendered.');
    const point = await buttonPoint('Clear overrides'); await settingsClick(point);
    await until(() => cdp.run(() => app.plugins.plugins['sidebar-columns'].settings.versionOverrides.length === 0 && app.plugins.plugins['sidebar-columns'].settingsTab.containerEl.innerText.includes('None.')), 'Clear action did not update state and rendered description.');
    const detail = await cdp.run(async () => { const plugin = app.plugins.plugins['sidebar-columns'], tab = plugin.settingsTab;
      return { calls: window.__reviewSettingsCalls, persisted: await plugin.loadData(), indexedDescription: tab.settingItems[0].items.find(item => item.name === 'Untested-version overrides').desc,
        rendered: tab.containerEl.innerText.includes('None.') };
    });
    assert.ok(detail.calls.update >= 1); assert.equal(detail.calls.display, 0); assert.deepEqual(detail.persisted.versionOverrides, []);
    assert.ok(detail.indexedDescription.startsWith('None.')); assert.ok(detail.rendered); await h.snapshot(cdp, 'review-04-clear-overrides'); await settingsScreenshot('review-04-cleared-settings-window'); return detail;
  });
  await record('Native settings Restore control opens the guarded backup chooser', async () => {
    const point = await buttonPoint('Restore full workspace'); await settingsClick(point);
    await until(() => cdp.run(() => [...app.plugins.plugins['sidebar-columns'].modals].some(modal => [...modal.modalEl.querySelectorAll('input')].some(input => input.placeholder === 'Choose a full-workspace layout backup'))), 'Backup chooser did not open from native settings.');
    await h.snapshot(cdp, 'review-05-restore-control');
    const connection = await settingsConnection();
    await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await h.delay(100); await cdp.run(() => { for (const modal of [...app.plugins.plugins['sidebar-columns'].modals]) modal.close(); app.setting.close(); });
    settingsCdp?.close(); settingsCdp = undefined; return { chooserOpened: true, restoreNotApplied: true };
  });
}

source = source.replaceAll('runtime-full-columns-support.mjs', 'runtime-review-fix-support.mjs')
  .replaceAll('"full-columns-"', '"review-fix-"')
  .replaceAll('sidebar-columns-full-columns-', 'sidebar-columns-review-fix-')
  .replace("assert.equal(manifest.version, '0.1.0')", "assert.equal(manifest.version, '0.1.1')")
  .replaceAll('FULL-COLUMN-TEST-RESULTS.md', 'REVIEW-FIX-TEST-RESULTS.md')
  .replaceAll('# Full-height column native runtime acceptance', '# v0.1.1 review-fix native acceptance')
  .replace(insertion, verifyReviewFixSettings.toString() + '\n' + insertion)
  .replace(ending, "  await verifyReviewFixSettings();\n" + ending);
if (process.argv.includes('--focused')) {
  const firstMain = source.indexOf(insertion);
  const finalizer = source.lastIndexOf('\nfinally {');
  assert.ok(firstMain > 0 && finalizer > firstMain, 'Focused ownership boundaries changed.');
  source = source.slice(0, firstMain) + `try {
    h.stage(); for (const file of ['Fixture A.md', 'Fixture B.md', '2026-10-08.md']) noteHashes[file] = h.sha(join(VAULT, file));
    await start(); await focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-column');
    await until(async () => (await h.modalButtons(cdp)).includes('Enable experimental sidebar columns'), 'Focused fixture consent missing.');
    await h.clickButton(cdp, 'Enable experimental sidebar columns'); await idle();
    await verifyReviewFixSettings();
  } catch (error) { report.harnessError = error.stack; process.exitCode = 1; }
  ` + source.slice(finalizer);
}
const runner = join(PROJECT, '.cache', 'runtime-review-fix-runner.mjs');
mkdirSync(dirname(runner), { recursive: true }); writeFileSync(runner, source);
await import(pathToFileURL(runner).href);
