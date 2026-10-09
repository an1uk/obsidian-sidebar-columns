import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.ok(process.argv.includes('--run'), 'Pass --run to launch isolated v0.1.2 acceptance.');
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(PROJECT, 'scripts', 'runtime-full-columns.mjs'), 'utf8').replaceAll('\r\n', '\n');
const boundary = source.indexOf('let savedWhole;');
const finalizer = source.lastIndexOf('\nfinally {');
assert.ok(boundary > 0 && finalizer > boundary, 'Guarded ownership boundaries changed.');
let prelude = source.slice(0, boundary)
  .replaceAll('runtime-full-columns-support.mjs', 'runtime-layout-controls-support.mjs')
  .replaceAll('"full-columns-"', '"layout-controls-"')
  .replaceAll('sidebar-columns-full-columns-', 'sidebar-columns-layout-controls-')
  .replace("assert.equal(manifest.version, '0.1.0')", "assert.equal(manifest.version, '0.1.2')")
  .replace('latestOperation: window.__sidebarWholeLatestOperation', 'latestOperation: window.__layoutLastResult');

async function layoutControlsAcceptance() {
  function nativeLayout(side) {
    const root = side === 'left' ? app.workspace.leftSplit : app.workspace.rightSplit;
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
    const walk = node => ({ id: node.id, type: node.type, direction: node.direction, dimension: node.dimension,
      view: node.view?.getViewType?.(), geometry: rect(node.containerEl), children: (node.children ?? []).map(walk) });
    const controls = [...root.containerEl.querySelectorAll('.sidebar-columns-collapse')].map(button => ({ branchId: button.getAttribute('data-sidebar-columns-branch-id'),
      disabled: button.disabled, ariaDisabled: button.getAttribute('aria-disabled'), ariaExpanded: button.getAttribute('aria-expanded'), label: button.getAttribute('aria-label'),
      title: button.title, geometry: rect(button), visible: button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0 }));
    return { root: walk(root), rows: root.children.map(walk), controls, folds: app.plugins.plugins['sidebar-columns'].adapter.getCollapsedCount() };
  }
  const inspect = side => cdp.run(nativeLayout, side);
  const equivalent = (actual, expected) => { for (const side of ['main', 'left', 'right']) assert.deepEqual(topology(actual[side]), topology(expected[side])); };
  const branchFor = async id => cdp.run(id => {
    let leaf; app.workspace.iterateAllLeaves(item => { if (item.id === id) leaf = item; });
    const root = leaf.getRoot(); let vertical;
    for (let item = leaf.parent; item && item !== root; item = item.parent) if (item.direction === 'vertical') vertical = item;
    if (!vertical) throw Error('No lateral column contains ' + id);
    let branch = leaf.parent; while (branch.parent !== vertical) branch = branch.parent; return branch.id;
  }, id);
  const pointFor = async branchId => cdp.run(branchId => {
    const button = [...document.querySelectorAll('.sidebar-columns-collapse')].find(item => item.getAttribute('data-sidebar-columns-branch-id') === branchId);
    if (!button || button.disabled) throw Error('Actionable native collapse control missing for ' + branchId);
    const r = button.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (!button.contains(document.elementFromPoint(x, y))) throw Error('Native collapse control is occluded for ' + branchId);
    return { x, y };
  }, branchId);
  const clickControl = async id => { const branchId = await branchFor(id); const point = await pointFor(branchId); await pointerClick(point.x, point.y); return branchId; };
  const assertT = (state, rowCount) => {
    assert.equal(state.root.direction, 'horizontal'); assert.equal(state.rows.length, rowCount); const top = state.rows[0];
    assert.equal(top.direction, 'vertical'); assert.equal(top.children.length, 2);
    for (const column of top.children) {
      assert.ok(Math.abs(column.geometry.y - top.geometry.y) <= 2); assert.ok(Math.abs(column.geometry.height - top.geometry.height) <= 2);
    }
    for (const row of state.rows.slice(1)) {
      assert.equal(row.type, 'tabs'); assert.ok(row.geometry.y >= top.geometry.bottom - 2);
      assert.ok(Math.abs(row.geometry.x - top.geometry.x) <= 2); assert.ok(Math.abs(row.geometry.width - top.geometry.width) <= 2);
      assert.ok(!state.controls.some(control => control.branchId === row.id), 'Wide bottom rows must not get column controls.');
    }
    assert.equal(state.controls.length, 2); assert.equal(new Set(state.controls.map(control => control.branchId)).size, 2);
  };
  const dimensionState = () => cdp.run(() => { const walk = node => ({ id: node.id, dimension: node.dimension ?? null, children: (node.children ?? []).map(walk) });
    return { left: walk(app.workspace.leftSplit), right: walk(app.workspace.rightSplit) }; });
  const snapshot = name => h.snapshot(cdp, name);
  const cleanSnapshot = async name => {
    await until(() => cdp.run(() => document.querySelectorAll('.notice').length === 0), 'Transient fixture notices did not expire before the review screenshot.', 70);
    return snapshot(name);
  };
  const hitAllControls = async (name, expected = 4) => {
    await until(() => cdp.run(() => document.querySelectorAll('.notice').length === 0), 'Fixture notices occlude header-control hit testing.', 70);
    const hits = await cdp.run(() => ['left', 'right'].flatMap(side => {
      const root = side === 'left' ? app.workspace.leftSplit : app.workspace.rightSplit;
      return [...root.containerEl.querySelectorAll('.sidebar-columns-collapse')].map(button => {
        const r = button.getBoundingClientRect(), point = { x: r.x + r.width / 2, y: r.y + r.height / 2 }, element = document.elementFromPoint(point.x, point.y), style = getComputedStyle(button.parentElement);
        return { side, branchId: button.getAttribute('data-sidebar-columns-branch-id'), rectangle: r.toJSON(), point,
          headerRectangle: button.parentElement.getBoundingClientRect().toJSON(),
          firstChild: button.parentElement.firstElementChild === button, lastChild: button.parentElement.lastElementChild === button,
          headerChildren: [...button.parentElement.children].map(child => ({ className: child.className, rectangle: child.getBoundingClientRect().toJSON() })),
          headerStyle: { display: style.display, direction: style.direction, flexDirection: style.flexDirection, justifyContent: style.justifyContent },
          hit: button.contains(element), element: element?.outerHTML.slice(0, 500) };
      });
    }));
    h.json(join(EVIDENCE, name + '-control-hits.json'), hits); await snapshot(name);
    assert.equal(hits.length, expected); assert.ok(hits.every(item => item.hit), 'A direct collapse control is obstructed by native window chrome.'); return hits;
  };
  const checkEdgeRails = async () => record('Physical rightmost columns expose native hit-tested rail buttons and reopen by a real pointer click', async () => {
    const results = [];
    for (const side of ['left', 'right']) {
      const state = await inspect(side), edge = [...state.rows[0].children].sort((a, b) => b.geometry.x - a.geometry.x)[0];
      const beforeDims = await dimensionState(), point = await pointFor(edge.id); await pointerClick(point.x, point.y); await idle();
      await cleanSnapshot('controls-13-' + side + '-edge-rail');
      const rail = await cdp.run(branchId => {
        const buttons = [...document.querySelectorAll('.sidebar-columns-restore')], button = buttons.find(button => button.closest('[data-sidebar-columns-folded]')?.getAttribute('data-sidebar-columns-folded') === branchId) ?? buttons[0];
        if (!button) throw Error('No expand rail button after direct edge collapse.'); const r = button.getBoundingClientRect(), point = { x: r.x + r.width / 2, y: r.y + r.height / 2 }, element = document.elementFromPoint(point.x, point.y);
        return { branchId, rectangle: r.toJSON(), point, hit: button.contains(element), element: element?.outerHTML.slice(0, 500) };
      }, edge.id);
      results.push({ side, rail }); h.json(join(EVIDENCE, 'controls-13-' + side + '-edge-rail-hit.json'), rail);
      if (rail.hit) await pointerClick(rail.point.x, rail.point.y); else await h.command(cdp, 'expand-all-columns'); await idle();
      assert.equal((await inspect(side)).folds, 0); assert.deepEqual(await dimensionState(), beforeDims);
    }
    assert.ok(results.every(item => item.rail.hit), 'An owned expand rail button is obstructed by native window chrome.'); return results;
  });
  const checkThirdColumns = async () => record('Third genuine full-height columns retain original views and expose six native hit-tested controls', async () => {
    const before = await cdp.run(() => { window.__layoutBeforeThird = new Map(); const walk = node => { window.__layoutBeforeThird.set(node.id, { node, view: node.view }); for (const child of node.children ?? []) walk(child); }; walk(app.workspace.leftSplit); walk(app.workspace.rightSplit); return window.__layoutBeforeThird.size; });
    for (const side of ['left', 'right']) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = await inspect(side); if (state.rows.length === 1 && state.rows[0].direction === 'vertical' && state.rows[0].children.length === 3) break;
        await focus(cdp, side === 'left' ? 'fixture-explorer' : 'fixture-backlinks'); await h.command(cdp, 'add-column'); await idle();
      }
      const state = await inspect(side); assert.equal(state.rows.length, 1); assert.equal(state.rows[0].children.length, 3);
      for (const branch of state.rows[0].children) { assert.ok(Math.abs(branch.geometry.y - state.rows[0].geometry.y) <= 2); assert.ok(Math.abs(branch.geometry.height - state.rows[0].geometry.height) <= 2); }
    }
    const preserved = await cdp.run(() => { const current = new Map(), walk = node => { current.set(node.id, node); for (const child of node.children ?? []) walk(child); }; walk(app.workspace.leftSplit); walk(app.workspace.rightSplit);
      return [...window.__layoutBeforeThird].every(([id, old]) => current.get(id) === old.node && (!old.view || old.view === current.get(id).view)); }); assert.equal(preserved, true);
    return { before, preserved, hits: await hitAllControls('controls-14-three-columns', 6) };
  });
  let leftBranch, rightBranch;
  if (rtl) await record('Actual Arabic RTL workspace is active before layout-control interaction', async () => {
    const state = await cdp.run(() => ({ direction: getComputedStyle(document.body).direction, classes: document.body.className, arabic: /[\u0600-\u06ff]/.test(document.body.innerText) }));
    assert.ok(state.arabic); assert.ok(state.direction === 'rtl' || state.classes.includes('mod-rtl')); return state;
  });
  await cdp.run(() => { const p = app.plugins.plugins['sidebar-columns']; window.__layoutLastResult = null;
    const original = p.report; p.report = async function (pending) { const result = await pending; window.__layoutLastResult = result; return Reflect.apply(original, this, [Promise.resolve(result)]); };
    window.__layoutOriginal = new Map(); const walk = node => { window.__layoutOriginal.set(node.id, { node, view: node.view }); for (const child of node.children ?? []) walk(child); };
    walk(app.workspace.leftSplit); walk(app.workspace.rightSplit);
  });
  const originalIds = await cdp.run(() => [...window.__layoutOriginal.keys()]);
  await record('Bottom-row consent Cancel preserves the original native layout and creates no backup', async () => {
    const initial = await structural(); await focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-row-below');
    await until(async () => (await h.modalButtons(cdp)).includes('Cancel'), 'Row warning missing.'); await h.clickButton(cdp, 'Cancel'); await idle();
    equivalent(await structural(), initial); assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].settings.acknowledged), false);
    assert.equal((await cdp.run(() => app.plugins.plugins['sidebar-columns'].backups.list())).length, 0);
  });
  await record('Two genuine whole columns on both sidebars receive one guarded top control per column', async () => {
    await focus(cdp, 'fixture-explorer'); await h.command(cdp, 'add-column');
    await until(async () => (await h.modalButtons(cdp)).includes('Enable experimental sidebar columns'), 'Column warning missing.');
    await h.clickButton(cdp, 'Enable experimental sidebar columns'); await idle(); await focus(cdp, 'fixture-backlinks'); await h.command(cdp, 'add-column'); await idle();
    for (const side of ['left', 'right']) { const state = await inspect(side); assert.equal(state.rows.length, 1); assert.equal(state.rows[0].children.length, 2); assert.equal(state.controls.length, 2);
      for (const control of state.controls) { assert.ok(control.visible); assert.ok(!control.disabled); assert.equal(control.ariaExpanded, 'true'); assert.ok(/collapse/i.test(control.label ?? control.title)); }
    }
    leftBranch = await branchFor('fixture-explorer'); rightBranch = await branchFor('fixture-backlinks'); return hitAllControls('controls-01-two-whole-columns');
  });
  if (process.argv.includes('--supplement')) {
    let failure;
    try { await checkEdgeRails(); } catch (error) { failure = error; }
    try { await checkThirdColumns(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
    return;
  }
  await checkEdgeRails();
  await record('Direct collapse icon uses consent and Cancel does not fold or mutate the native tree', async () => {
    await cdp.run(async () => { const p = app.plugins.plugins['sidebar-columns']; p.settings.acknowledged = false; await p.saveData(p.settings); });
    const beforeLayout = await structural(), beforeDims = await dimensionState(), count = (await cdp.run(() => app.plugins.plugins['sidebar-columns'].backups.list())).length;
    await clickControl('fixture-explorer'); await until(async () => (await h.modalButtons(cdp)).includes('Cancel'), 'Direct-control warning missing.'); await h.clickButton(cdp, 'Cancel'); await idle();
    equivalent(await structural(), beforeLayout); assert.deepEqual(await dimensionState(), beforeDims); assert.equal((await inspect('left')).folds, 0);
    assert.equal((await cdp.run(() => app.plugins.plugins['sidebar-columns'].backups.list())).length, count);
    await cdp.run(async () => { const p = app.plugins.plugins['sidebar-columns']; p.settings.acknowledged = true; await p.saveData(p.settings); });
  });
  await record('Direct collapse icon backup failure leaves views, rows and stored dimensions unchanged', async () => {
    const beforeLayout = await structural(), beforeDims = await dimensionState();
    await cdp.run(() => { const backups = app.plugins.plugins['sidebar-columns'].backups; window.__layoutCreateBackup = backups.create;
      backups.create = async () => { throw Error('Isolated fixture backup write failure'); }; window.__layoutLastResult = null; });
    try { await clickControl('fixture-backlinks'); await idle(); await until(() => cdp.run(() => window.__layoutLastResult?.status === 'error'), 'Guarded backup error missing.');
      equivalent(await structural(), beforeLayout); assert.deepEqual(await dimensionState(), beforeDims); assert.equal((await inspect('right')).folds, 0);
    } finally { await cdp.run(() => { app.plugins.plugins['sidebar-columns'].backups.create = window.__layoutCreateBackup; }); }
  });
  await record('Inactive Search menu and right-side command append full-width bottom rows to create native T layouts', async () => {
    await headerMenu('fixture-search-leaf', 'Add full-width bottom row (experimental)'); await focus(cdp, 'fixture-backlinks'); await h.command(cdp, 'add-row-below'); await idle();
    const left = await inspect('left'), right = await inspect('right'); assertT(left, 2); assertT(right, 2);
    for (const state of [left, right]) { assert.ok(Math.abs(state.rows[0].dimension - 50) < 0.001); assert.ok(Math.abs(state.rows[1].dimension - 50) < 0.001); }
    await hitAllControls('controls-02-both-native-T'); return { left, right };
  });
  await record('Splitting the Files row stays inside its top column and keeps the bottom row full width', async () => {
    const previous = await inspect('left'); await focus(cdp, 'fixture-explorer'); await h.command(cdp, 'split-right'); await idle();
    const current = await inspect('left'); assertT(current, 2); assert.equal(current.rows[1].id, previous.rows[1].id);
    const branch = current.rows[0].children.find(item => item.id === leftBranch); assert.equal(branch.direction, 'horizontal'); assert.equal(branch.children[0].direction, 'vertical');
    assert.equal(branch.children[0].children.length, 2); assert.equal(branch.children[1].id, 'fixture-search'); assert.equal(current.controls.length, 2); await snapshot('controls-03-top-row-scope');
  });
  await record('Native row-divider gestures resize both T layouts; repeated append preserves exact 60/40 proportions as 30/20/50', async () => {
    for (const [side, id] of [['left', 'fixture-explorer'], ['right', 'fixture-backlinks']]) {
      const handle = await cdp.run(side => { const root = side === 'left' ? app.workspace.leftSplit : app.workspace.rightSplit, row = root.children[0];
        const h = row.resizeHandleEl.getBoundingClientRect(), r = row.containerEl.getBoundingClientRect();
        const y = h.y + h.height / 2;
        const candidate = [0.25, 0.75, 0.5].map(ratio => h.x + h.width * ratio).find(x => row.resizeHandleEl.contains(document.elementFromPoint(x, y)));
        const x = candidate ?? h.x + h.width / 2;
        return { x, y, height: r.height, delta: root.children.reduce((sum, item) => sum + item.containerEl.getBoundingClientRect().height, 0) * 0.1,
          hit: row.resizeHandleEl.contains(document.elementFromPoint(x, y)) };
      }, side); assert.ok(handle.hit);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y + handle.delta, button: 'left', buttons: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x, y: handle.y + handle.delta, button: 'left', clickCount: 1 }); await h.delay(150);
      const changed = await inspect(side); assert.ok(Math.abs(changed.rows[0].geometry.height - handle.height) > 20);
      await cdp.run(side => { const root = side === 'left' ? app.workspace.leftSplit : app.workspace.rightSplit; root.children[0].setDimension(60); root.children[1].setDimension(40); app.workspace.requestResize(); }, side);
      const prior = await inspect(side); await focus(cdp, id); await h.command(cdp, 'add-row-below'); await idle(); const appended = await inspect(side); assertT(appended, 3);
      assert.deepEqual(appended.rows.slice(0, 2).map(row => row.id), prior.rows.map(row => row.id));
      for (const [index, weight] of [30, 20, 50].entries()) assert.ok(Math.abs(appended.rows[index].dimension - weight) < 0.001);
    }
    await snapshot('controls-04-repeated-row-weights');
  });
  await record('A native top-column divider gesture resizes a column without narrowing any bottom row', async () => {
    const handle = await cdp.run(() => {
      const top = app.workspace.leftSplit.children[0];
      for (const branch of top.children) {
        const h = branch.resizeHandleEl.getBoundingClientRect(), r = branch.containerEl.getBoundingClientRect();
        if (h.width <= 0 || h.height <= 0) continue;
        for (const ratio of [0.25, 0.75, 0.5, 0.15, 0.85]) {
          const x = h.x + h.width / 2, y = h.y + h.height * ratio;
          if (branch.resizeHandleEl.contains(document.elementFromPoint(x, y))) return { id: branch.id, x, y, width: r.width, hit: true };
        }
      }
      throw Error('No unobstructed native top-column divider point.');
    }); assert.ok(handle.hit);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 35, y: handle.y, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 35, y: handle.y, button: 'left', clickCount: 1 }); await h.delay(150);
    const current = await inspect('left'); assertT(current, 3); assert.ok(Math.abs(current.rows[0].children.find(item => item.id === handle.id).geometry.width - handle.width) > 10); await hitAllControls('controls-05-native-column-resize');
  });
  await record('Direct icon folds its whole top column, disables the last open sibling and Enter restores the selected lower pane', async () => {
    await focus(cdp, 'fixture-search-leaf'); const beforeDims = await dimensionState(); await clickControl('fixture-explorer'); await idle();
    const folded = await inspect('left'); assert.equal(folded.folds, 1); const branch = folded.rows[0].children.find(item => item.id === leftBranch);
    assert.ok(branch.geometry.width >= 30 && branch.geometry.width <= 34); assert.deepEqual(await dimensionState(), beforeDims);
    assert.ok(folded.controls.filter(control => control.visible).every(control => control.disabled && control.ariaDisabled === 'true'));
    assert.equal(await cdp.run(() => document.activeElement?.classList.contains('sidebar-columns-restore')), true); await cleanSnapshot('controls-06-T-with-rail');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await h.delay(100);
    const expanded = await inspect('left'); assertT(expanded, 3); assert.equal(expanded.folds, 0);
    assert.equal(await cdp.run(() => app.workspace.activeLeaf.id), 'fixture-search-leaf');
    assert.ok(await cdp.run(() => { const leaf = app.workspace.activeLeaf; return leaf.containerEl.contains(document.activeElement) || leaf.tabHeaderEl.contains(document.activeElement); }));
  });
  await record('First native tab drag with a folded peer moves a loaded native tab into a full-width row', async () => {
    const fixture = await cdp.run(async () => { const root = app.workspace.leftSplit, top = root.children[0], original = top.children.find(branch => branch.type === 'split');
      const source = original.children[0].children.find(group => group.children.some(leaf => leaf.view.getViewType() === 'file-explorer')).children.find(leaf => leaf.view.getViewType() === 'bookmarks');
      if (!source) throw Error('The fixture has no loaded native Bookmarks tab for its first drag.');
      const peer = top.children.find(branch => branch !== original), target = root.children[1]; window.__layoutDrag = { source, target };
      return { sourceId: source.id, sourceView: source.view.getViewType(), peerLeaf: peer.children[0].id, targetId: target.id, oldParent: source.parent.id };
    });
    await focus(cdp, fixture.sourceId);
    await cdp.run(() => { window.__layoutDrag.view = window.__layoutDrag.source.view; });
    await clickControl(fixture.peerLeaf); await idle();
    const nativePoint = await cdp.run(nativeHeaderPoint, fixture.sourceId);
    assert.ok(nativePoint, 'No unobstructed native source-tab point for T-layout dragging.');
    const position = { x: nativePoint.x, y: nativePoint.y };
    const hit = await cdp.run(({ id, point }) => { let source; app.workspace.iterateAllLeaves(leaf => { if (leaf.id === id) source = leaf; });
      const element = document.elementFromPoint(point.x, point.y); return { hit: source.tabHeaderEl.contains(element),
        element: element?.outerHTML.slice(0, 400), header: source.tabHeaderEl.getBoundingClientRect().toJSON(), point }; }, { id: fixture.sourceId, point: position });
    h.json(join(EVIDENCE, 'controls-native-drag-source.json'), hit); assert.equal(hit.hit, true);
    let data; cdp.on('Input.dragIntercepted', event => { data = event.data; }); await cdp.send('Input.setInterceptDrags', { enabled: true }); let target;
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 10 && !data; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x + i * 8, y: position.y + i * 4, button: 'left', buttons: 1 }); await h.delay(30); }
      await until(async () => Boolean(data), 'Native T-layout tab drag was not intercepted.', 10);
      assert.equal((await inspect('left')).folds, 1); await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...position, data }); assert.equal((await inspect('left')).folds, 0);
      target = await cdp.run(() => { const r = window.__layoutDrag.target.containerEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 20 }; });
      for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, ...target, data }); await h.delay(150);
      const result = await cdp.run(() => ({ parent: window.__layoutDrag.source.parent.id, view: window.__layoutDrag.source.view.getViewType(), sameView: window.__layoutDrag.source.view === window.__layoutDrag.view }));
      assert.equal(result.parent, fixture.targetId); assert.equal(result.view, fixture.sourceView); assert.equal(result.sameView, true); assertT(await inspect('left'), 3); await snapshot('controls-07-native-T-drop'); return { fixture, result };
    } finally { await cdp.send('Input.setInterceptDrags', { enabled: false }); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...(target ?? position), button: 'left', clickCount: 1 }); }
  });
  await record('Outer-sidebar close/reopen restores visible controls after animation without needing an unrelated tab action', async () => {
    await cdp.run(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); }); await h.delay(200);
    await cdp.run(() => { app.workspace.leftSplit.expand(); app.workspace.rightSplit.expand(); });
    await until(async () => (await inspect('left')).controls.filter(control => control.visible).length === 2 && (await inspect('right')).controls.filter(control => control.visible).length === 2, 'Direct controls did not return after native sidebar animation.', 30);
    await focus(cdp, 'fixture-search-leaf'); assertT(await inspect('left'), 3); assertT(await inspect('right'), 3);
  });
  await record('T-layout columns, row weights and session-only folds survive saved proportions and a guarded restart', async () => {
    const expected = await structural(), beforeDims = await dimensionState(); await clickControl('fixture-explorer'); await idle(); await flush();
    const disk = JSON.parse(readFileSync(join(VAULT, '.obsidian', 'workspace.json'), 'utf8')); equivalent(disk, expected);
    assert.deepEqual(dimensions(disk.left), dimensions(expected.left)); assert.deepEqual(dimensions(disk.right), dimensions(expected.right));
    await close(); await start(); equivalent(await structural(), expected); assert.deepEqual(await dimensionState(), beforeDims);
    const identities = await cdp.run(ids => { const current = new Map(); const walk = node => { current.set(node.id, node); for (const child of node.children ?? []) walk(child); };
      walk(app.workspace.leftSplit); walk(app.workspace.rightSplit); window.__layoutOriginal = new Map();
      for (const id of ids) { const node = current.get(id); if (!node) throw Error('Original native identity missing after restart: ' + id); window.__layoutOriginal.set(id, { node, view: node.view }); }
      return window.__layoutOriginal.size;
    }, originalIds); assert.equal(identities, originalIds.length);
    assertT(await inspect('left'), 3); assertT(await inspect('right'), 3); assert.equal((await inspect('left')).folds, 0); await snapshot('controls-08-restarted-T');
  });
  for (const asset of report.assets.filter(item => item.kind === 'theme')) await record(asset.name + ' applied stylesheet retains T geometry and clickable column controls', async () => {
    const proof = await cdp.run(async name => { app.customCss.setTheme(name); await app.customCss.loadTheme(); const text = app.customCss.styleEl.textContent, digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return { theme: app.customCss.theme, hash: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }; }, asset.name);
    assert.equal(proof.hash, h.sha(join(VAULT, '.obsidian', 'themes', asset.name, 'theme.css'))); await h.delay(150);
    assertT(await inspect('left'), 3); assertT(await inspect('right'), 3); await hitAllControls('controls-09-theme-' + asset.name.replaceAll(' ', '-')); await clickControl('fixture-backlinks'); await idle();
    const fold = (await inspect('right')).rows[0].children.find(branch => branch.id === rightBranch); assert.ok(fold.geometry.width >= 30 && fold.geometry.width <= 34);
    await h.command(cdp, 'expand-all-columns'); await idle(); await snapshot('controls-09-theme-' + asset.name.replaceAll(' ', '-')); return { asset, proof };
  });
  await cdp.run(async () => { app.customCss.setTheme(''); await app.customCss.loadTheme(); });
  await record('125/150 percent scaling preserves T rows and visible direct controls', async () => {
    try { for (const scale of [1.25, 1.5]) { await cdp.run(value => require('electron').webFrame.setZoomFactor(value), scale); await h.delay(150);
      assertT(await inspect('left'), 3); assertT(await inspect('right'), 3); await hitAllControls('controls-10-scale-' + scale); }
    } finally { await cdp.run(() => require('electron').webFrame.setZoomFactor(1)); }
  });
  await record('A narrow window retains native T topology and widening or closing an outer sidebar recovers the center', async () => {
    await cdp.run(() => window.electronWindow.setSize(900, 700)); await h.delay(150); const narrow = await cdp.run(() => app.workspace.rootSplit.containerEl.getBoundingClientRect().width);
    await cdp.run(() => app.workspace.rightSplit.collapse()); await h.delay(150); const oneSide = await cdp.run(() => app.workspace.rootSplit.containerEl.getBoundingClientRect().width);
    await cdp.run(() => { window.electronWindow.setSize(1600, 1000); app.workspace.rightSplit.expand(); }); await h.delay(200);
    assert.ok(oneSide > 0); assert.ok(await cdp.run(() => app.workspace.rootSplit.containerEl.getBoundingClientRect().width > 0)); assertT(await inspect('left'), 3); assertT(await inspect('right'), 3);
    if (narrow <= 0) report.limitations.push('At 900px with both wide outer sidebars open, native center width can be zero; closing a whole sidebar or widening restores it.'); return { narrow, oneSide };
  });
  await record('Native empty-column group close removes stale controls and preserves all original views', async () => {
    const closed = await cdp.run(async () => { const root = app.workspace.leftSplit, peer = root.children[0].children.find(branch => branch.type === 'tabs' && branch.children[0].view.getViewType() === 'empty');
      if (!peer) throw Error('No empty top column remains.'); const branchId = peer.id; await peer.children[0].detach();
      await new Promise(resolve => setTimeout(resolve, 150)); const current = new Map(); const walk = node => { current.set(node.id, node); for (const child of node.children ?? []) walk(child); }; walk(app.workspace.leftSplit); walk(app.workspace.rightSplit);
      return { branchId, originalViewsPreserved: [...window.__layoutOriginal].every(([id, old]) => current.get(id) === old.node && (!old.view || current.get(id).view === old.view)),
        staleButton: [...document.querySelectorAll('.sidebar-columns-collapse')].some(button => button.getAttribute('data-sidebar-columns-branch-id') === branchId) };
    });
    assert.ok(closed.originalViewsPreserved); assert.equal(closed.staleButton, false); await snapshot('controls-11-group-close-refresh'); return closed;
  });
  await record('Disable removes owned controls/rails; reload preserves native rows and creates no duplicate controls', async () => {
    const expected = await structural(); await clickControl('fixture-backlinks'); await idle(); await cdp.run(async () => await app.plugins.disablePlugin('sidebar-columns'));
    assert.equal(await cdp.run(() => document.querySelectorAll('.sidebar-columns-collapse,.sidebar-columns-rail,.sidebar-columns-collapsed').length), 0); equivalent(await structural(), expected);
    await cdp.run(async () => await app.plugins.enablePlugin('sidebar-columns')); await h.readiness(cdp); await h.assertIsolation(cdp);
    const right = await inspect('right'); assertT(right, 3); assert.equal(right.controls.length, new Set(right.controls.map(control => control.branchId)).size); await snapshot('controls-12-reloaded-controls');
  });
  await checkThirdColumns();
}

const driver = `try {
  h.stage(); for (const file of ['Fixture A.md', 'Fixture B.md', '2026-10-08.md']) noteHashes[file] = h.sha(join(VAULT, file));
  await start(); assert.equal(await cdp.run(() => app.plugins.plugins['sidebar-columns'].manifest.version), '0.1.2');
  await layoutControlsAcceptance();
} catch (error) { report.harnessError = error.stack; process.exitCode = 1; }
`;
let finish = source.slice(finalizer).replaceAll('FULL-COLUMN-TEST-RESULTS.md', 'LAYOUT-CONTROLS-TEST-RESULTS.md')
  .replaceAll('# Full-height column native runtime acceptance', '# v0.1.2 layout-control native acceptance');
const runner = join(PROJECT, '.cache', 'runtime-layout-controls-runner.mjs');
mkdirSync(dirname(runner), { recursive: true }); writeFileSync(runner, prelude + '\n' + layoutControlsAcceptance.toString() + '\n' + driver + finish);
await import(pathToFileURL(runner).href);
