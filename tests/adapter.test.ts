import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window as HappyWindow } from 'happy-dom';
import { App, Menu, WorkspaceLeaf, WorkspaceSidedock, WorkspaceSplit, WorkspaceTabs } from 'obsidian';
import { SidebarAdapter } from '../src/adapter';
import { wrapMethod } from '../src/patch';

type Kind = 'leaf' | 'tabs' | 'split';
interface FakeNode {
  id: string; type: Kind; parent: FakeNode | null; children: FakeNode[];
  containerEl: HTMLElement; resizeHandleEl: HTMLElement; tabHeaderEl: HTMLElement;
  direction: 'vertical' | 'horizontal'; currentTab: number; dimension: number | null;
  size: number; collapsed: boolean; pinned: boolean; sideRoot: boolean;
  view: { getViewType(): string; onTabMenu(menu: Menu): void; closed: number };
  setDimension(value: number | null): void;
  insertChild(index: number, child: FakeNode): void;
  removeChild(child: FakeNode): void;
  replaceChild(index: number, child: FakeNode): void;
  detach(): void;
}
interface Fixture {
  win: Window & typeof globalThis; doc: Document; app: App; adapter: SidebarAdapter;
  left: FakeNode; right: FakeNode; main: FakeNode; leftLeaf: FakeNode; rightLeaf: FakeNode; centralLeaf: FakeNode;
  notices: string[]; calls: { before: boolean[]; drag: number; layout: number };
  ws: {
    containerEl: HTMLElement; rootSplit: FakeNode; leftSplit: FakeNode; rightSplit: FakeNode;
    __createNativeSplit(direction: 'vertical' | 'horizontal'): FakeNode;
    activeLeaf: WorkspaceLeaf | null;
    createLeafBySplit(leaf: WorkspaceLeaf, direction: 'vertical', before: boolean): WorkspaceLeaf;
    setActiveLeaf(leaf: WorkspaceLeaf, options?: { focus?: boolean }): void;
    iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void): void;
    requestResize(): void; onDragLeaf(event: DragEvent, leaf: WorkspaceLeaf): void;
    changeLayout(layout: unknown): Promise<void>;
  };
  node(kind: Kind, direction?: 'vertical' | 'horizontal', sideRoot?: boolean): FakeNode;
  group(...leaves: FakeNode[]): FakeNode;
  layout(): void;
}
let lastMenu: Menu;
Object.defineProperty(WorkspaceLeaf.prototype, 'onOpenTabHeaderMenu', {
  configurable: true, writable: true,
  value: function (this: FakeNode): void {
    lastMenu = new Menu();
    this.view.onTabMenu(lastMenu);
    // The real inactive-tab path skips leaf-menu; the adapter must use onTabMenu.
  },
});
function asLeaf(node: FakeNode): WorkspaceLeaf { return node as unknown as WorkspaceLeaf; }
function items(menu: Menu): { title: string; callback?: () => unknown }[] {
  return (menu as unknown as { items: { title: string; callback?: () => unknown }[] }).items;
}
function fixture(rtl = false): Fixture {
  const win = new HappyWindow() as unknown as Window & typeof globalThis;
  win.requestAnimationFrame = callback => win.setTimeout(() => callback(0), 0);
  const doc = win.document;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  let sequence = 0;
  const node = (kind: Kind, direction: 'vertical' | 'horizontal' = 'horizontal', sideRoot = false): FakeNode => {
    const prototype = kind === 'leaf' ? WorkspaceLeaf.prototype : kind === 'tabs' ? WorkspaceTabs.prototype
      : sideRoot ? WorkspaceSidedock.prototype : WorkspaceSplit.prototype;
    const item = Object.create(prototype) as FakeNode;
    Object.assign(item, {
      id: `native-${++sequence}`, type: kind, parent: null, children: [], direction, currentTab: 0,
      dimension: null, size: 600, collapsed: false, pinned: false, sideRoot,
      containerEl: doc.createElement('div'), resizeHandleEl: doc.createElement('hr'), tabHeaderEl: doc.createElement('button'),
      view: { getViewType: () => 'empty', onTabMenu: (_menu: Menu) => undefined, closed: 0 },
    });
    item.tabHeaderEl.draggable = kind === 'leaf';
    item.containerEl.style.flexDirection = direction === 'vertical' ? 'row' : 'column';
    item.containerEl.style.direction = rtl ? 'rtl' : 'ltr';
    item.containerEl.appendChild(item.resizeHandleEl);
    item.setDimension = value => {
      item.dimension = value !== null && (value <= 0 || value >= 100) ? null : value;
      item.containerEl.style.flexGrow = item.dimension === null ? '' : String(item.dimension);
    };
    item.insertChild = (index, child) => {
      if (index < 0 || index > item.children.length) index = item.children.length;
      item.children.splice(index, 0, child);
      child.parent = item;
      item.containerEl.appendChild(child.containerEl);
      if (child.type === 'leaf') item.containerEl.appendChild(child.tabHeaderEl);
    };
    item.replaceChild = (index, child) => {
      const old = item.children[index]!;
      old.parent = null;
      old.containerEl.remove();
      item.children[index] = child;
      child.parent = item;
      item.containerEl.appendChild(child.containerEl);
    };
    item.removeChild = child => {
      const index = item.children.indexOf(child);
      assert.notEqual(index, -1);
      item.children.splice(index, 1);
      child.parent = null;
      child.containerEl.remove();
      child.tabHeaderEl.remove();
      item.currentTab = Math.max(0, Math.min(item.currentTab, item.children.length - 1));
      const parent = item.parent;
      if (!parent) return;
      if (item.children.length === 0) parent.removeChild(item);
      else if (item.type === 'split' && !item.sideRoot && item.children.length === 1) {
        const remaining = item.children.pop()!;
        remaining.parent = null;
        parent.replaceChild(parent.children.indexOf(item), remaining);
        remaining.setDimension(item.dimension);
      }
    };
    item.detach = () => {
      item.parent?.removeChild(item);
      item.view.closed++;
    };
    return item;
  };
  const group = (...leaves: FakeNode[]): FakeNode => {
    const tabs = node('tabs');
    leaves.forEach(leaf => tabs.insertChild(-1, leaf));
    return tabs;
  };
  const left = node('split', 'horizontal', true);
  const right = node('split', 'horizontal', true);
  const main = node('split', 'vertical');
  const leftLeaf = node('leaf'), rightLeaf = node('leaf'), centralLeaf = node('leaf');
  left.insertChild(0, group(leftLeaf)); right.insertChild(0, group(rightLeaf)); main.insertChild(0, group(centralLeaf));
  [left, main, right].forEach(root => container.appendChild(root.containerEl));
  const notices: string[] = [];
  const calls = { before: [] as boolean[], drag: 0, layout: 0 };
  const walk = (item: FakeNode, callback: (leaf: WorkspaceLeaf) => void): void => {
    if (item.type === 'leaf') callback(asLeaf(item));
    else item.children.forEach(child => walk(child, callback));
  };
  const layout = (): void => {
    const place = (item: FakeNode, x: number, y: number, width: number, height: number): void => {
      item.containerEl.getBoundingClientRect = () => new win.DOMRect(x, y, width, height);
      if (item.type === 'split') {
        const weights = item.children.map(child => child.dimension ?? 1);
        const total = weights.reduce((sum, value) => sum + value, 0);
        let offset = 0;
        item.children.forEach((child, index) => {
          const fraction = weights[index]! / total;
          if (item.direction === 'vertical') {
            const childWidth = width * fraction;
            place(child, rtl ? x + width - offset - childWidth : x + offset, y, childWidth, height);
            offset += childWidth;
          } else {
            const childHeight = height * fraction;
            place(child, x, y + offset, width, childHeight);
            offset += childHeight;
          }
        });
      } else item.children.forEach(child => place(child, x, y, width, height));
    };
    place(left, 0, 0, 600, 600); place(main, 600, 0, 800, 600); place(right, 1400, 0, 600, 600);
  };
  const ws: Fixture['ws'] = {
    __createNativeSplit(direction) { return node('split', direction); },
    containerEl: container, rootSplit: main, leftSplit: left, rightSplit: right, activeLeaf: asLeaf(leftLeaf),
    createLeafBySplit(leaf, _direction, before) {
      calls.before.push(before);
      const original = (leaf as unknown as FakeNode).parent!;
      const parent = original.parent!;
      const created = node('leaf');
      const fresh = group(created);
      const index = parent.children.indexOf(original);
      const dimension = original.dimension;
      if (parent.direction !== 'vertical') {
        const split = node('split', 'vertical');
        original.setDimension(null);
        parent.replaceChild(index, split);
        split.setDimension(dimension);
        (before ? [fresh, original] : [original, fresh]).forEach(child => split.insertChild(-1, child));
      } else {
        if (dimension !== null) { original.setDimension(dimension / 2); fresh.setDimension(dimension / 2); }
        parent.insertChild(index + (before ? 0 : 1), fresh);
      }
      ws.activeLeaf = asLeaf(created);
      layout();
      return asLeaf(created);
    },
    setActiveLeaf(leaf, options) {
      ws.activeLeaf = leaf;
      if (options?.focus) (leaf as unknown as FakeNode).tabHeaderEl.focus();
    },
    iterateAllLeaves(callback) { [main, left, right].forEach(root => walk(root, callback)); },
    requestResize() { layout(); },
    onDragLeaf() { calls.drag++; },
    async changeLayout() { calls.layout++; },
  };
  const app = { workspace: ws } as unknown as App;
  const adapter = new SidebarAdapter(app, text => notices.push(text));
  layout();
  return { win, doc, app, adapter, left, right, main, leftLeaf, rightLeaf, centralLeaf, notices, calls, ws, node, group, layout };
}
async function columns(f: Fixture, side: 'left' | 'right' = 'left'): Promise<FakeNode> {
  const leaf = side === 'left' ? f.leftLeaf : f.rightLeaf;
  await f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(leaf)));
  return (side === 'left' ? f.left : f.right).children[0]!;
}

// Fixtures model native object identity, reparenting, clamping and empty-group collapse;
// they do not establish Obsidian runtime or CSS compatibility.
test('targets real left/right nested tabs and rejects central, detached and cyclic targets', async () => {
  const f = fixture();
  assert.equal(f.adapter.resolveTarget(asLeaf(f.leftLeaf)).side, 'left');
  assert.equal(f.adapter.resolveTarget(asLeaf(f.rightLeaf)).side, 'right');
  assert.throws(() => f.adapter.resolveTarget(asLeaf(f.centralLeaf)), /Select a tab/);
  const split = await columns(f);
  const target = f.adapter.resolveTarget(asLeaf(f.leftLeaf));
  assert.equal(target.parent, split);
  f.leftLeaf.parent = null;
  assert.equal(f.adapter.isCurrent(target), false);
  assert.throws(() => f.adapter.resolveTarget(asLeaf(f.leftLeaf)), /Select a tab/);
  f.leftLeaf.parent = target.group as unknown as FakeNode;
  f.left.children[0]!.parent = f.left.children[0]!;
  assert.throws(() => f.adapter.resolveTarget(asLeaf(f.leftLeaf)), /Select a tab/);
});

test('structural guards reject duplicate IDs and missing methods before the public split runs', async () => {
  const f = fixture();
  f.rightLeaf.id = f.leftLeaf.id;
  await assert.rejects(f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /invalid/);
  assert.deepEqual(f.calls.before, []);
  f.rightLeaf.id = 'distinct';
  (f.ws as unknown as { onDragLeaf?: unknown }).onDragLeaf = undefined;
  assert.throws(() => f.adapter.assertCompatible(), /required sidebar operations/);
});

test('inactive sidebar tab menu targets the right-clicked native leaf and keeps central menus unchanged', () => {
  const f = fixture();
  const inactive = f.node('leaf');
  f.leftLeaf.parent!.insertChild(-1, inactive);
  f.ws.activeLeaf = asLeaf(f.centralLeaf);
  let selected: WorkspaceLeaf | undefined;
  const release = f.adapter.install({ addColumn: () => undefined, split: target => { selected = target.leaf; }, collapse: () => undefined });
  try {
    (inactive as unknown as { onOpenTabHeaderMenu(): void }).onOpenTabHeaderMenu();
    const action = items(lastMenu).find(item => item.title === 'Split this row right (experimental)');
    assert.ok(action);
    action.callback?.();
    assert.equal(selected, inactive);
    assert.equal(f.ws.activeLeaf, f.centralLeaf);
    (f.centralLeaf as unknown as { onOpenTabHeaderMenu(): void }).onOpenTabHeaderMenu();
    assert.deepEqual(items(lastMenu), []);
  } finally { release(); }
});

test('public split leaves existing tabs, pin state, views, center and opposite sidebar in place', async () => {
  const f = fixture();
  const second = f.node('leaf');
  second.pinned = true;
  f.leftLeaf.parent!.insertChild(-1, second);
  f.leftLeaf.parent!.currentTab = 1;
  const group = f.leftLeaf.parent!, views = group.children.map(leaf => leaf.view);
  const central = f.main.children.slice(), opposite = f.right.children.slice();
  const split = await columns(f);
  assert.equal(split.direction, 'vertical');
  assert.equal(f.left.direction, 'horizontal');
  assert.equal(split.children[0], group);
  assert.deepEqual(group.children, [f.leftLeaf, second]);
  assert.equal(group.currentTab, 1);
  assert.equal(second.pinned, true);
  assert.deepEqual(group.children.map(leaf => leaf.view), views);
  assert.equal(split.children[1]!.children[0]!.view.getViewType(), 'empty');
  assert.deepEqual(f.main.children, central);
  assert.deepEqual(f.right.children, opposite);
  assert.ok(views.every(view => view.closed === 0));
  assert.equal(f.left.size, 600);
});

test('physical right splitting uses before=true under RTL native row layout', async () => {
  const f = fixture(true);
  const group = f.leftLeaf.parent!;
  const split = await columns(f);
  assert.deepEqual(f.calls.before, [true]);
  assert.equal(split.children[1], group);
  assert.ok(split.children[0]!.containerEl.getBoundingClientRect().left >= group.containerEl.getBoundingClientRect().right);
});

test('failed rendering rolls back the empty addition and original native ratios without reopening views', async () => {
  const f = fixture();
  const split = await columns(f);
  split.children[0]!.setDimension(60); split.children[1]!.setDimension(40);
  f.layout();
  const before = split.children.slice();
  const native = f.ws.createLeafBySplit;
  f.ws.createLeafBySplit = (...args) => {
    const leaf = native(...args);
    (leaf as unknown as FakeNode).parent!.containerEl.getBoundingClientRect = () => new f.win.DOMRect(0, 0, 10, 10);
    f.ws.requestResize = () => undefined;
    return leaf;
  };
  await assert.rejects(f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /rolled back/);
  assert.deepEqual(split.children, before);
  assert.deepEqual(split.children.map(item => item.dimension), [60, 40]);
  assert.equal(f.leftLeaf.view.closed, 0);
});

test('a native creation exception without a returned owner leaves unidentified additions intact', async () => {
  const f = fixture();
  const group = f.leftLeaf.parent!;
  const center = f.main.children[0], other = f.right.children[0];
  const native = f.ws.createLeafBySplit;
  f.ws.createLeafBySplit = (...args) => { native(...args); throw new Error('native failure after attachment'); };
  await assert.rejects(f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /No safely identified operation-owned tab/);
  assert.equal(f.left.children[0]!.children[0], group);
  assert.equal(group.parent, f.left.children[0]);
  assert.equal(f.main.children[0], center);
  assert.equal(f.right.children[0], other);
  assert.equal(f.leftLeaf.view.closed, 0);
});

test('rollback preserves an added panel that was populated after native creation', async () => {
  const f = fixture();
  const native = f.ws.createLeafBySplit;
  let panel: FakeNode | undefined;
  f.ws.createLeafBySplit = (...args) => {
    const leaf = native(...args);
    panel = leaf as unknown as FakeNode;
    panel.view.getViewType = () => 'community-panel';
    return leaf;
  };
  await assert.rejects(f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /automatic rollback was stopped/);
  assert.equal(panel?.view.closed, 0);
  assert.ok(panel?.parent);
});

test('collapse folds a whole native column with stacked rows and preserves identities and dimensions', async () => {
  const f = fixture();
  const split = await columns(f);
  const group = f.leftLeaf.parent!;
  const rows = f.node('split', 'horizontal');
  split.replaceChild(split.children.indexOf(group), rows);
  rows.insertChild(0, group);
  const lower = f.node('leaf');
  rows.insertChild(1, f.group(lower));
  split.children[0]!.setDimension(65); split.children[1]!.setDimension(35);
  f.layout();
  const view = f.leftLeaf.view, target = f.adapter.resolveTarget(asLeaf(f.leftLeaf));
  f.adapter.collapse(target);
  assert.equal(f.adapter.getCollapsedCount(), 1);
  assert.equal(rows.containerEl.classList.contains('sidebar-columns-collapsed'), true);
  assert.equal(rows.children[0]!.containerEl.inert, true);
  assert.equal(rows.children[1]!.containerEl.inert, true);
  assert.equal(f.leftLeaf.view, view);
  assert.equal(f.leftLeaf.parent, group);
  assert.deepEqual(split.children.map(item => item.dimension), [65, 35]);
  const other = split.children[1]!.children[0]!;
  assert.equal(f.adapter.canCollapse(f.adapter.resolveTarget(asLeaf(other))), false);
  assert.throws(() => f.adapter.resolveCommandTarget(), /Select a tab/);
  f.adapter.expandAll();
  assert.equal(f.adapter.getCollapsedCount(), 0);
  assert.equal(rows.children[0]!.containerEl.inert, false);
  assert.equal(rows.containerEl.querySelector('.sidebar-columns-rail'), null);
  assert.deepEqual(split.children.map(item => item.dimension), [65, 35]);
});

test('ordinary sidebar clicks and native dragstart keep folds until browser-owned dragenter precedes geometry reads', async () => {
  const f = fixture();
  const split = await columns(f);
  let startedFolded = false;
  f.ws.onDragLeaf = () => { startedFolded = f.adapter.getCollapsedCount() === 1; };
  const release = f.adapter.install({ addColumn: () => undefined, split: () => undefined, collapse: () => undefined });
  try {
    f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
    const other = split.children[1]!.children[0]!;
    other.tabHeaderEl.dispatchEvent(new f.win.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    assert.equal(f.adapter.getCollapsedCount(), 1);
    f.ws.onDragLeaf(new f.win.DragEvent('dragstart'), asLeaf(other));
    assert.equal(startedFolded, true);
    assert.equal(f.adapter.getCollapsedCount(), 1);
    assert.equal(f.adapter.isBusyGesture(), true);
    other.containerEl.dispatchEvent(new f.win.DragEvent('dragenter', { bubbles: true }));
    assert.equal(f.adapter.getCollapsedCount(), 0);
    f.doc.dispatchEvent(new f.win.Event('dragend', { bubbles: true }));
    assert.equal(f.adapter.isBusyGesture(), false);
  } finally { release(); }
});

test('splitter capture expands before native handlers; external drop and workspace replacement also normalize folds', async () => {
  const f = fixture();
  const split = await columns(f);
  const release = f.adapter.install({ addColumn: () => undefined, split: () => undefined, collapse: () => undefined });
  try {
    f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
    let expandedAtNativePointer = false;
    split.children[1]!.resizeHandleEl.addEventListener('pointerdown', () => { expandedAtNativePointer = f.adapter.getCollapsedCount() === 0; });
    split.children[1]!.resizeHandleEl.dispatchEvent(new f.win.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    assert.equal(expandedAtNativePointer, true);
    f.doc.dispatchEvent(new f.win.Event('pointerup', { bubbles: true }));
    f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
    split.children[1]!.containerEl.dispatchEvent(new f.win.DragEvent('dragenter', { bubbles: true }));
    assert.equal(f.adapter.getCollapsedCount(), 0);
    f.doc.dispatchEvent(new f.win.Event('drop', { bubbles: true }));
    f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
    await f.ws.changeLayout({});
    assert.equal(f.adapter.getCollapsedCount(), 0);
    assert.equal(f.calls.layout, 1);
  } finally { release(); }
});

test('command targeting requires focused sidebar and active leaf to agree and rejects settings focus', () => {
  const f = fixture();
  f.centralLeaf.tabHeaderEl.focus();
  assert.throws(() => f.adapter.resolveCommandTarget(), /Select a tab/);
  f.ws.activeLeaf = asLeaf(f.centralLeaf);
  f.leftLeaf.tabHeaderEl.focus();
  assert.throws(() => f.adapter.resolveCommandTarget(), /Select a tab/);
  f.ws.activeLeaf = asLeaf(f.leftLeaf);
  assert.equal(f.adapter.resolveCommandTarget().leaf, f.leftLeaf);
  const settings = f.doc.createElement('input'); f.doc.body.appendChild(settings); settings.focus();
  f.ws.activeLeaf = asLeaf(f.leftLeaf);
  assert.throws(() => f.adapter.resolveCommandTarget(), /Select a tab/);
});

test('native support is checked only against a current active sidebar and suppresses duplicate split menus', () => {
  const f = fixture();
  let checks = 0;
  (f.app as unknown as { commands: unknown }).commands = {
    findCommand: (id: string) => { assert.equal(id, 'workspace:split-vertical'); return { checkCallback: (checking: boolean) => { assert.equal(checking, true); checks++; return true; } }; },
  };
  const target = f.adapter.resolveTarget(asLeaf(f.leftLeaf));
  f.ws.activeLeaf = asLeaf(f.centralLeaf);
  assert.equal(f.adapter.nativeSplitAvailable(target), false);
  assert.equal(checks, 0);
  f.ws.activeLeaf = asLeaf(f.leftLeaf);
  assert.equal(f.adapter.nativeSplitAvailable(target), true);
  const release = f.adapter.install({ addColumn: () => undefined, split: () => undefined, collapse: () => undefined });
  try {
    (f.leftLeaf as unknown as { onOpenTabHeaderMenu(): void }).onOpenTabHeaderMenu();
    assert.equal(items(lastMenu).some(item => item.title === 'Split this row right (experimental)'), false);
  } finally { release(); }
});

test('cooperative wrapper preserves receiver/arguments/return and becomes inert beneath a later plugin', () => {
  const source = { amount: 3, method(this: { amount: number }, value: number) { return this.amount + value; } };
  const descriptor = Object.getOwnPropertyDescriptor(source, 'method');
  let calls = 0;
  const dispose = wrapMethod(source, 'method', (original, receiver, args) => { calls++; return Reflect.apply(original, receiver, args); });
  assert.equal(source.method(4), 7);
  const retained = source.method;
  source.method = function (value: number) { return retained.call(this, value) * 2; };
  const later = source.method;
  dispose();
  assert.equal(source.method, later);
  assert.equal(source.method(4), 14);
  assert.equal(calls, 1);
  const own = { method() { return 1; } };
  const releaseOwn = wrapMethod(own, 'method', () => 2);
  releaseOwn();
  assert.equal(own.method(), 1);
  assert.equal(Object.getOwnPropertyDescriptor(source, 'amount')?.value, descriptor ? 3 : 0);
});

test('unloading removes rails and leaves a later workspace wrapper installed', async () => {
  const f = fixture();
  await columns(f);
  const release = f.adapter.install({ addColumn: () => undefined, split: () => undefined, collapse: () => undefined });
  f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
  const ours = f.ws.changeLayout;
  let laterCalls = 0;
  f.ws.changeLayout = async value => { laterCalls++; await ours(value); };
  const later = f.ws.changeLayout;
  release();
  assert.equal(f.adapter.getCollapsedCount(), 0);
  assert.equal(f.doc.querySelector('.sidebar-columns-rail'), null);
  assert.equal(f.ws.changeLayout, later);
  await f.ws.changeLayout({});
  assert.equal(laterCalls, 1);
  assert.equal(f.calls.layout, 1);
});


test('an unreturned exception never deletes an unrelated new empty tab', async () => {
  const f = fixture();
  let unrelated: FakeNode | undefined;
  const originalGroup = f.leftLeaf.parent;
  f.ws.createLeafBySplit = () => {
    unrelated = f.node('leaf');
    f.right.insertChild(-1, f.group(unrelated));
    throw new Error('provider failed before returning its tab');
  };
  await assert.rejects(f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /No safely identified operation-owned tab/);
  assert.equal(unrelated?.view.closed, 0);
  assert.ok(unrelated?.parent);
  assert.equal(f.leftLeaf.parent, originalGroup);
});

test('rollback leaves a returned new group alone after it was moved to the other sidebar', async () => {
  const f = fixture();
  const native = f.ws.createLeafBySplit;
  let addition: FakeNode | undefined;
  f.ws.createLeafBySplit = (...args) => {
    const leaf = native(...args);
    addition = leaf as unknown as FakeNode;
    return leaf;
  };
  f.win.requestAnimationFrame = callback => f.win.setTimeout(() => {
    const tabs = addition!.parent!;
    tabs.parent!.removeChild(tabs);
    f.right.insertChild(-1, tabs);
    f.layout();
    callback(0);
  }, 0);
  await assert.rejects(f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /automatic rollback was stopped/);
  assert.equal(addition!.parent!.parent, f.right);
  assert.equal(addition!.view.closed, 0);
});

test('rollback removes its unchanged empty addition but preserves newer resize ratios', async () => {
  const f = fixture();
  const split = await columns(f);
  const original = f.leftLeaf.parent!;
  original.setDimension(60); split.children[1]!.setDimension(40); f.layout();
  const native = f.ws.createLeafBySplit;
  let addition: FakeNode | undefined;
  f.ws.createLeafBySplit = (...args) => {
    const leaf = native(...args);
    addition = leaf as unknown as FakeNode;
    return leaf;
  };
  f.win.requestAnimationFrame = callback => f.win.setTimeout(() => {
    original.setDimension(50);
    addition!.parent!.setDimension(10);
    addition!.parent!.containerEl.getBoundingClientRect = () => new f.win.DOMRect(0, 0, 10, 10);
    callback(0);
  }, 0);
  await assert.rejects(f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /rolled back/);
  assert.equal(original.dimension, 50);
  assert.equal(split.children[1]!.dimension, 40);
  assert.equal(addition!.view.closed, 1);
});

test('rollback preserves a newer source-tab selection and central focus', async () => {
  const f = fixture();
  const other = f.node('leaf');
  const group = f.leftLeaf.parent!;
  group.insertChild(-1, other);
  f.win.requestAnimationFrame = callback => f.win.setTimeout(() => {
    group.currentTab = 1;
    f.ws.activeLeaf = asLeaf(f.centralLeaf);
    f.centralLeaf.tabHeaderEl.focus();
    callback(0);
  }, 0);
  await assert.rejects(f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /rolled back/);
  assert.equal(group.currentTab, 1);
  assert.equal(f.ws.activeLeaf, f.centralLeaf);
  assert.equal(f.doc.activeElement, f.centralLeaf.tabHeaderEl);
  assert.equal(other.view.closed, 0);
});

test('a focused pop-out document cannot reuse the main document’s retained sidebar focus', () => {
  const f = fixture();
  f.leftLeaf.tabHeaderEl.focus();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'activeDocument');
  const popout = new HappyWindow() as unknown as Window;
  Object.defineProperty(globalThis, 'activeDocument', { configurable: true, writable: true, value: popout.document });
  try { assert.throws(() => f.adapter.resolveCommandTarget(), /Select a tab/); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'activeDocument', descriptor);
    else Reflect.deleteProperty(globalThis, 'activeDocument');
  }
  f.left.collapsed = true;
  assert.throws(() => f.adapter.resolveCommandTarget(), /Select a tab/);
});

test('external drag cancellation over a nested target releases its gesture without affecting native drag tracking', async () => {
  const f = fixture();
  const split = await columns(f);
  const release = f.adapter.install({ addColumn: () => undefined, split: () => undefined, collapse: () => undefined });
  try {
    f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
    const target = split.children[1]!.containerEl;
    target.dispatchEvent(new f.win.DragEvent('dragenter', { bubbles: true, clientX: 400, clientY: 100 }));
    assert.equal(f.adapter.isBusyGesture(), true);
    target.dispatchEvent(new f.win.MouseEvent('dragleave', { bubbles: true, relatedTarget: null, clientX: 450, clientY: 100 }));
    assert.equal(f.adapter.isBusyGesture(), true);
    target.dispatchEvent(new f.win.MouseEvent('dragleave', { bubbles: true, relatedTarget: null, clientX: -10, clientY: 100 }));
    assert.equal(f.adapter.isBusyGesture(), false);
    f.ws.onDragLeaf(new f.win.DragEvent('dragstart'), asLeaf(f.leftLeaf));
    target.dispatchEvent(new f.win.MouseEvent('dragleave', { bubbles: true, relatedTarget: null, clientX: -10, clientY: 100 }));
    assert.equal(f.adapter.isBusyGesture(), true);
    f.doc.dispatchEvent(new f.win.Event('dragend'));
    assert.equal(f.adapter.isBusyGesture(), false);
  } finally { release(); }
});


test('a returned empty central addition is rejected and rolled back without reopening central views', async () => {
  const f = fixture();
  const centralGroup = f.centralLeaf.parent!;
  const sidebarGroup = f.leftLeaf.parent!;
  const native = f.ws.createLeafBySplit;
  f.ws.createLeafBySplit = (_leaf, direction, before) => native(asLeaf(f.centralLeaf), direction, before);
  await assert.rejects(f.adapter.splitRight(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /rolled back/);
  assert.deepEqual(f.main.children, [centralGroup]);
  assert.equal(f.centralLeaf.view.closed, 0);
  assert.deepEqual(f.left.children, [sidebarGroup]);
  assert.equal(f.leftLeaf.view.closed, 0);
});

async function wholeColumn(f: Fixture, leaf: FakeNode = f.leftLeaf): Promise<FakeNode> {
  await f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(leaf)));
  return (f.adapter.resolveTarget(asLeaf(leaf)).root as unknown as FakeNode).children[0]!;
}

test('whole-column menu targets an inactive clicked sidebar tab independently of the secondary row action', () => {
  const f = fixture();
  const inactive = f.node('leaf');
  f.leftLeaf.parent!.insertChild(-1, inactive);
  f.ws.activeLeaf = asLeaf(f.centralLeaf);
  let whole: WorkspaceLeaf | undefined, row: WorkspaceLeaf | undefined;
  const release = f.adapter.install({ addColumn: target => { whole = target.leaf; }, split: target => { row = target.leaf; }, collapse: () => undefined });
  try {
    (inactive as unknown as { onOpenTabHeaderMenu(): void }).onOpenTabHeaderMenu();
    const entries = items(lastMenu);
    assert.equal(entries[0]?.title, 'Add full-height column (experimental)');
    entries[0]?.callback?.();
    entries.find(item => item.title === 'Split this row right (experimental)')?.callback?.();
    assert.equal(whole, inactive);
    assert.equal(row, inactive);
    assert.equal(f.ws.activeLeaf, f.centralLeaf);
  } finally { release(); }
});

test('full-height addition preserves all initial stacked native rows, dimensions, selected tabs and views', async () => {
  const f = fixture();
  const upper = f.leftLeaf.parent!, lowerLeaf = f.node('leaf'), pinned = f.node('leaf');
  pinned.pinned = true;
  upper.insertChild(-1, pinned); upper.currentTab = 1;
  const lower = f.group(lowerLeaf);
  f.left.insertChild(-1, lower); upper.setDimension(35); lower.setDimension(65); f.layout();
  const central = f.main.children.slice(), opposite = f.right.children.slice();
  const oldViews = [f.leftLeaf.view, lowerLeaf.view, pinned.view];
  const content = await wholeColumn(f);
  assert.equal(f.left.direction, 'horizontal');
  assert.equal(f.left.size, 600);
  assert.equal(content.direction, 'vertical');
  const stack = content.children[0]!;
  assert.equal(stack.direction, 'horizontal');
  assert.deepEqual(stack.children, [upper, lower]);
  assert.deepEqual(stack.children.map(row => row.dimension), [35, 65]);
  assert.equal(upper.currentTab, 1);
  assert.equal(pinned.pinned, true);
  assert.deepEqual([f.leftLeaf.view, lowerLeaf.view, pinned.view], oldViews);
  assert.ok(oldViews.every(view => view.closed === 0));
  assert.deepEqual(f.main.children, central); assert.deepEqual(f.right.children, opposite);
  const empty = content.children[1]!;
  assert.equal(empty.children[0]!.view.getViewType(), 'empty');
  assert.equal(empty.containerEl.getBoundingClientRect().height, 600);
  assert.equal(stack.containerEl.getBoundingClientRect().height, 600);
  assert.equal(lower.containerEl.getBoundingClientRect().height, 390);
});

test('full-height addition retains mixed nested rows as exact existing objects rather than splitting only the clicked row', async () => {
  const f = fixture();
  const nestedColumns = await columns(f);
  const lowerLeaf = f.node('leaf'), lower = f.group(lowerLeaf);
  f.left.insertChild(-1, lower);
  nestedColumns.setDimension(40); lower.setDimension(60);
  const inside = nestedColumns.children[0]!;
  const rows = f.node('split', 'horizontal');
  nestedColumns.replaceChild(0, rows); rows.insertChild(0, inside);
  const bottomLeaf = f.node('leaf'); rows.insertChild(-1, f.group(bottomLeaf));
  rows.children[0]!.setDimension(25); rows.children[1]!.setDimension(75); f.layout();
  const old = [nestedColumns, lower], nested = nestedColumns.children.slice(), stacked = rows.children.slice();
  const content = await wholeColumn(f, bottomLeaf);
  const existing = content.children[0]!;
  assert.deepEqual(existing.children, old);
  assert.deepEqual(existing.children.map(child => child.dimension), [40, 60]);
  assert.deepEqual(nestedColumns.children, nested);
  assert.deepEqual(rows.children, stacked);
  assert.deepEqual(rows.children.map(child => child.dimension), [25, 75]);
  assert.equal(content.children[1]!.containerEl.getBoundingClientRect().height, 600);
  assert.equal(f.leftLeaf.view.closed, 0); assert.equal(bottomLeaf.view.closed, 0);
  f.adapter.collapse(f.adapter.resolveTarget(asLeaf(bottomLeaf)));
  assert.equal(existing.containerEl.classList.contains('sidebar-columns-collapsed'), true);
  assert.equal(rows.containerEl.classList.contains('sidebar-columns-collapsed'), false);
  assert.equal(nestedColumns.containerEl.inert, true);
  assert.equal(lower.containerEl.inert, true);
  f.adapter.expandAll();
});

test('a third full-height column reuses the outer split beside the clicked column and preserves nested rows', async () => {
  const f = fixture();
  const lower = f.group(f.node('leaf')); f.left.insertChild(-1, lower); f.layout();
  const content = await wholeColumn(f);
  const preservedStack = content.children[0]!, second = content.children[1]!;
  const lowerLeaf = lower.children[0]!;
  await f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(lowerLeaf)));
  assert.equal(f.left.children[0], content);
  assert.equal(content.children.length, 3);
  assert.equal(content.children[0], preservedStack); assert.equal(content.children[2], second);
  assert.equal(lower.parent, preservedStack);
  assert.equal(content.children[1]!.containerEl.getBoundingClientRect().height, 600);
  assert.equal(lowerLeaf.view.closed, 0);
});

test('full-height column insertion is physically right in RTL, including a third column', async () => {
  const f = fixture(true);
  const lower = f.group(f.node('leaf')); f.right.insertChild(-1, lower); f.layout();
  const content = await wholeColumn(f, f.rightLeaf);
  const stack = content.children[1]!, second = content.children[0]!;
  assert.equal(stack.direction, 'horizontal');
  await f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.rightLeaf)));
  assert.deepEqual(f.calls.before, [true, true]);
  assert.equal(content.children[2], stack); assert.equal(content.children[0], second);
  const fresh = content.children[1]!;
  assert.ok(fresh.containerEl.getBoundingClientRect().left >= stack.containerEl.getBoundingClientRect().right);
  assert.equal(fresh.containerEl.getBoundingClientRect().height, 600);
});

test('full-height content below a singleton horizontal wrapper is reused for adding and collapsing', async () => {
  const f = fixture();
  const content = await wholeColumn(f), wrapper = f.node('split', 'horizontal');
  f.left.replaceChild(0, wrapper); wrapper.insertChild(0, content); f.layout();
  const first = content.children[0]!;
  await f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
  assert.equal(f.left.children[0], wrapper); assert.equal(wrapper.children[0], content);
  assert.equal(content.children.length, 3);
  f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
  assert.equal(first.containerEl.classList.contains('sidebar-columns-collapsed'), true);
  f.adapter.expandAll();
});

test('failed full-height rendering rolls back only the owned empty group and restores original rows and ratios', async () => {
  const f = fixture();
  const upper = f.leftLeaf.parent!, lowerLeaf = f.node('leaf'), lower = f.group(lowerLeaf);
  f.left.insertChild(-1, lower); upper.setDimension(30); lower.setDimension(70); f.layout();
  const native = f.ws.createLeafBySplit;
  let added: FakeNode | undefined;
  f.ws.createLeafBySplit = (...args) => { const leaf = native(...args); added = leaf as unknown as FakeNode; return leaf; };
  f.win.requestAnimationFrame = callback => f.win.setTimeout(() => {
    added!.parent!.containerEl.getBoundingClientRect = () => new f.win.DOMRect(0, 0, 10, 10);
    callback(0);
  }, 0);
  await assert.rejects(f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /rolled back/);
  assert.deepEqual(f.left.children, [upper, lower]);
  assert.deepEqual(f.left.children.map(row => row.dimension), [30, 70]);
  assert.equal(added?.view.closed, 1);
  assert.equal(f.leftLeaf.view.closed, 0); assert.equal(lowerLeaf.view.closed, 0);
  assert.equal(f.ws.activeLeaf, f.leftLeaf); assert.equal(f.left.direction, 'horizontal');
});

test('failed third-column rendering removes its empty addition without replacing the existing content split', async () => {
  const f = fixture();
  const content = await wholeColumn(f), existing = content.children.slice();
  existing[0]!.setDimension(60); existing[1]!.setDimension(40); f.layout();
  const native = f.ws.createLeafBySplit; let added: FakeNode | undefined;
  f.ws.createLeafBySplit = (...args) => { const leaf = native(...args); added = leaf as unknown as FakeNode; return leaf; };
  f.win.requestAnimationFrame = callback => f.win.setTimeout(() => {
    added!.parent!.containerEl.getBoundingClientRect = () => new f.win.DOMRect(0, 0, 10, 10);
    callback(0);
  }, 0);
  await assert.rejects(f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /rolled back/);
  assert.equal(f.left.children[0], content); assert.deepEqual(content.children, existing);
  assert.deepEqual(existing.map(child => child.dimension), [60, 40]);
  assert.equal(added?.view.closed, 1); assert.equal(f.leftLeaf.view.closed, 0);
});

test('whole-column rollback preserves a populated or externally moved addition', async () => {
  for (const change of ['populate', 'move'] as const) {
    const f = fixture();
    const lower = f.group(f.node('leaf')); f.left.insertChild(-1, lower); f.layout();
    const native = f.ws.createLeafBySplit; let added: FakeNode | undefined;
    f.ws.createLeafBySplit = (...args) => { const leaf = native(...args); added = leaf as unknown as FakeNode; return leaf; };
    f.win.requestAnimationFrame = callback => f.win.setTimeout(() => {
      if (change === 'populate') added!.view.getViewType = () => 'community-panel';
      else { const group = added!.parent!; group.parent!.removeChild(group); f.right.insertChild(-1, group); f.layout(); }
      callback(0);
    }, 0);
    await assert.rejects(f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /automatic rollback was stopped/);
    assert.equal(added?.view.closed, 0); assert.ok(added?.parent);
    assert.equal(f.leftLeaf.view.closed, 0); assert.equal(lower.children[0]!.view.closed, 0);
  }
});

test('whole-column rollback retains newer row proportions, selected tab and central focus', async () => {
  const f = fixture();
  const upper = f.leftLeaf.parent!, extra = f.node('leaf'); upper.insertChild(-1, extra);
  const lower = f.group(f.node('leaf')); f.left.insertChild(-1, lower);
  upper.setDimension(30); lower.setDimension(70); f.layout();
  const native = f.ws.createLeafBySplit; let added: FakeNode | undefined;
  f.ws.createLeafBySplit = (...args) => { const leaf = native(...args); added = leaf as unknown as FakeNode; return leaf; };
  f.win.requestAnimationFrame = callback => f.win.setTimeout(() => {
    upper.setDimension(45); lower.setDimension(55); upper.currentTab = 1;
    f.ws.activeLeaf = asLeaf(f.centralLeaf); f.centralLeaf.tabHeaderEl.focus();
    added!.parent!.containerEl.getBoundingClientRect = () => new f.win.DOMRect(0, 0, 10, 10);
    callback(0);
  }, 0);
  await assert.rejects(f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /rolled back/);
  assert.deepEqual(f.left.children, [upper, lower]);
  assert.deepEqual(f.left.children.map(row => row.dimension), [45, 55]);
  assert.equal(upper.currentTab, 1); assert.equal(f.ws.activeLeaf, f.centralLeaf);
  assert.equal(f.doc.activeElement, f.centralLeaf.tabHeaderEl);
});

test('constructor incompatibility, stale targets and concurrent whole-column operations fail before unsafe mutation', async () => {
  const f = fixture();
  f.ws.__createNativeSplit = () => f.node('split', 'horizontal');
  await assert.rejects(f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /cannot construct/);
  assert.deepEqual(f.calls.before, []);
  f.ws.__createNativeSplit = direction => f.node('split', direction);
  const target = f.adapter.resolveTarget(asLeaf(f.leftLeaf));
  const pending = f.adapter.addColumn(target);
  await assert.rejects(f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.rightLeaf))), /Finish the current/);
  await pending;
  await assert.rejects(f.adapter.addColumn(target), /moved or closed/);
});

test('a whole-column provider exception without returned ownership leaves unidentified additions intact', async () => {
  const f = fixture(); const native = f.ws.createLeafBySplit;
  f.ws.createLeafBySplit = (...args) => { native(...args); throw new Error('failed after creation'); };
  await assert.rejects(f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /No safely identified operation-owned tab/);
  assert.equal(f.leftLeaf.view.closed, 0);
  assert.equal(f.left.children[0]!.children.length, 2);
});

test('workspace replacement during whole-column rendering never rewrites the detached old sidebar', async () => {
  const f = fixture(); const old = f.left;
  const native = f.ws.createLeafBySplit; let added: FakeNode | undefined;
  f.ws.createLeafBySplit = (...args) => { const leaf = native(...args); added = leaf as unknown as FakeNode; return leaf; };
  f.win.requestAnimationFrame = callback => f.win.setTimeout(() => {
    const replacement = f.node('split', 'horizontal', true);
    replacement.insertChild(0, f.group(f.node('leaf')));
    f.ws.leftSplit = replacement;
    callback(0);
  }, 0);
  await assert.rejects(f.adapter.addColumn(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), /workspace was replaced.*automatic rollback was stopped/);
  assert.equal(added?.view.closed, 0);
  assert.equal(old.children[0]!.direction, 'vertical');
  assert.equal(f.ws.leftSplit.children[0]!.children.length, 1);
});

test('full-height geometry uses the native panel area and retains a sidedock footer outside its tree children', async () => {
  const f = fixture();
  const upper = f.leftLeaf.parent!, lower = f.group(f.node('leaf'));
  f.left.insertChild(-1, lower);
  upper.setDimension(40); lower.setDimension(60);
  const footer = f.doc.createElement('div'); footer.className = 'workspace-vault-profile';
  footer.textContent = 'Native vault controls'; f.left.containerEl.appendChild(footer);
  const render = (): void => {
    f.layout();
    // Fixture native tree occupies 600px; the root additionally includes a 42px footer.
    f.left.containerEl.getBoundingClientRect = () => new f.win.DOMRect(0, 0, 600, 642);
    footer.getBoundingClientRect = () => new f.win.DOMRect(0, 600, 600, 42);
  };
  f.ws.requestResize = render; render();
  const content = await wholeColumn(f);
  assert.equal(content.containerEl.getBoundingClientRect().height, 600);
  assert.equal(content.children[0]!.containerEl.getBoundingClientRect().height, 600);
  assert.equal(content.children[1]!.containerEl.getBoundingClientRect().height, 600);
  assert.equal(f.left.containerEl.getBoundingClientRect().height, 642);
  assert.equal(footer.parentElement, f.left.containerEl);
  assert.equal(footer.textContent, 'Native vault controls');
  assert.deepEqual(content.children[0]!.children, [upper, lower]);
  assert.deepEqual(content.children[0]!.children.map(row => row.dimension), [40, 60]);
});

function headerPointer(f: Fixture, leaf: FakeNode, type: string, x = 20, y = 20, extra: PointerEventInit = {}): void {
  leaf.tabHeaderEl.dispatchEvent(new f.win.PointerEvent(type, {
    bubbles: true, button: 0, buttons: 1, pointerId: 7, pointerType: 'mouse', isPrimary: true,
    clientX: x, clientY: y, ...extra,
  }));
}


test('browser-owned sidebar drags expand folds in document capture before native target geometry, then release gestures', async () => {
  const f = fixture(), content = await wholeColumn(f), moving = content.children[1]!.children[0]!;
  let foldsAtNativeStart = -1;
  f.ws.onDragLeaf = () => { foldsAtNativeStart = f.adapter.getCollapsedCount(); };
  const release = f.adapter.install({ addColumn: () => undefined, split: () => undefined, collapse: () => undefined });
  try {
    f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
    headerPointer(f, moving, 'pointerdown'); headerPointer(f, moving, 'pointermove', 30);
    assert.equal(f.adapter.getCollapsedCount(), 1); assert.equal(f.adapter.isBusyGesture(), false);
    f.ws.onDragLeaf(new f.win.DragEvent('dragstart'), asLeaf(moving));
    assert.equal(foldsAtNativeStart, 1); assert.equal(f.adapter.isBusyGesture(), true);
    assert.equal(f.adapter.canCollapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf))), false);
    let expandedAtTarget = false;
    moving.containerEl.addEventListener('dragenter', () => {
      expandedAtTarget = f.adapter.getCollapsedCount() === 0;
      moving.parent!.containerEl.getBoundingClientRect();
    });
    moving.containerEl.dispatchEvent(new f.win.DragEvent('dragenter', { bubbles: true }));
    assert.equal(expandedAtTarget, true); assert.equal(f.adapter.isBusyGesture(), true);
    moving.containerEl.dispatchEvent(new f.win.DragEvent('drop', { bubbles: true }));
    assert.equal(f.adapter.isBusyGesture(), false);
    f.doc.dispatchEvent(new f.win.Event('dragend')); assert.equal(f.adapter.isBusyGesture(), false);
  } finally { release(); }
});

test('central-origin browser drags preserve the source during dragstart and normalize folds outside the workspace container', async () => {
  const f = fixture(); await wholeColumn(f);
  const view = f.centralLeaf.view, group = f.centralLeaf.parent;
  let startedFolded = false;
  f.ws.onDragLeaf = () => { startedFolded = f.adapter.getCollapsedCount() === 1; };
  const release = f.adapter.install({ addColumn: () => undefined, split: () => undefined, collapse: () => undefined });
  try {
    f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
    headerPointer(f, f.centralLeaf, 'pointerdown'); headerPointer(f, f.centralLeaf, 'pointermove', 30);
    assert.equal(f.adapter.getCollapsedCount(), 1);
    f.ws.onDragLeaf(new f.win.DragEvent('dragstart'), asLeaf(f.centralLeaf));
    assert.equal(startedFolded, true);
    let beforeNativeMeasurement = false;
    f.doc.body.addEventListener('dragover', () => { beforeNativeMeasurement = f.adapter.getCollapsedCount() === 0; });
    f.doc.body.dispatchEvent(new f.win.DragEvent('dragover', { bubbles: true }));
    assert.equal(beforeNativeMeasurement, true); assert.equal(f.adapter.isBusyGesture(), true);
    assert.equal(f.centralLeaf.view, view); assert.equal(f.centralLeaf.parent, group);
    assert.equal(view.closed, 0);
    f.doc.body.dispatchEvent(new f.win.DragEvent('drop', { bubbles: true }));
    assert.equal(f.adapter.isBusyGesture(), false);
  } finally { release(); }
});

test('a direct external drop expands before native target measurement and starts no stranded busy gesture', async () => {
  const f = fixture(); await wholeColumn(f);
  const release = f.adapter.install({ addColumn: () => undefined, split: () => undefined, collapse: () => undefined });
  try {
    f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
    assert.equal(f.adapter.isBusyGesture(), false);
    let expandedAtDrop = false;
    f.doc.body.addEventListener('drop', () => {
      expandedAtDrop = f.adapter.getCollapsedCount() === 0;
      f.leftLeaf.parent!.containerEl.getBoundingClientRect();
    });
    f.doc.body.dispatchEvent(new f.win.DragEvent('drop', { bubbles: true }));
    assert.equal(expandedAtDrop, true); assert.equal(f.adapter.isBusyGesture(), false);
    // No dragend is supplied by this external direct-drop fixture.
    f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
    f.doc.body.dispatchEvent(new f.win.DragEvent('dragenter', { bubbles: true }));
    assert.equal(f.adapter.isBusyGesture(), true);
    f.doc.body.dispatchEvent(new f.win.DragEvent('drop', { bubbles: true }));
    assert.equal(f.adapter.isBusyGesture(), false);
    f.doc.body.dispatchEvent(new f.win.DragEvent('dragover', { bubbles: true }));
    assert.equal(f.adapter.isBusyGesture(), false);
  } finally { release(); }
});

test('ordinary clicks preserve collapsed columns and disposal removes document drag boundary listeners', async () => {
  const f = fixture(), content = await wholeColumn(f), other = content.children[1]!.children[0]!;
  const release = f.adapter.install({ addColumn: () => undefined, split: () => undefined, collapse: () => undefined });
  f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
  headerPointer(f, other, 'pointerdown'); headerPointer(f, other, 'pointerup', 20, 20, { buttons: 0 });
  other.tabHeaderEl.dispatchEvent(new f.win.MouseEvent('click', { bubbles: true }));
  assert.equal(f.adapter.getCollapsedCount(), 1); assert.equal(f.adapter.isBusyGesture(), false);
  release();
  assert.equal(f.adapter.getCollapsedCount(), 0);
  f.adapter.collapse(f.adapter.resolveTarget(asLeaf(f.leftLeaf)));
  f.doc.body.dispatchEvent(new f.win.DragEvent('dragenter', { bubbles: true }));
  f.doc.body.dispatchEvent(new f.win.DragEvent('drop', { bubbles: true }));
  assert.equal(f.adapter.getCollapsedCount(), 1); assert.equal(f.adapter.isBusyGesture(), false);
  f.adapter.expandAll();
});
