import {
  App, Menu, WorkspaceLeaf, WorkspaceSidedock, WorkspaceSplit, WorkspaceTabs, setIcon,
} from 'obsidian';
import { wrapMethod } from './patch';

interface NativeItem {
  id: string;
  type: string;
  parent: NativeParent | null;
  containerEl: HTMLElement;
  resizeHandleEl: HTMLElement;
  dimension: number | null;
  setDimension(value: number | null): void;
}
interface NativeParent extends NativeItem {
  children: NativeItem[];
  insertChild(index: number, item: NativeItem): void;
  removeChild(item: NativeItem): void;
  replaceChild(index: number, item: NativeItem): void;
}
interface NativeSplit extends NativeParent {
  direction: 'vertical' | 'horizontal';
}
interface NativeSidebar extends NativeSplit {
  size: number;
  collapsed: boolean;
}
interface NativeTabs extends NativeParent {
  currentTab: number;
}
interface NativeLeaf extends NativeItem {
  tabHeaderEl: HTMLElement;
  view: { onTabMenu(menu: Menu): void; getViewType(): string };
  pinned: boolean;
  detach(): void;
}
interface NativeWorkspace {
  containerEl: HTMLElement;
  rootSplit: NativeSplit;
  leftSplit: NativeSidebar;
  rightSplit: NativeSidebar;
  activeLeaf: WorkspaceLeaf | null;
  createLeafBySplit(leaf: WorkspaceLeaf, direction: 'vertical', before: boolean): WorkspaceLeaf;
  setActiveLeaf(leaf: WorkspaceLeaf, options?: { focus?: boolean }): void;
  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void): void;
  requestResize(): void;
  onDragLeaf(event: DragEvent, leaf: WorkspaceLeaf): void;
  changeLayout(layout: unknown): Promise<void>;
}
interface NativeDomWindow extends Window {
  createDiv: typeof createDiv;
  createEl: typeof createEl;
}
interface NativeCommandRegistry {
  findCommand(id: string): { checkCallback?: (checking: boolean) => boolean | void } | undefined;
}
export interface SidebarTarget {
  leaf: WorkspaceLeaf;
  side: 'left' | 'right';
  root: NativeSidebar;
  group: NativeTabs;
  parent: NativeSplit;
}
interface FoldStyle {
  value: string;
  priority: string;
  appliedValue: string;
  appliedPriority: string;
}
interface Fold {
  branch: NativeItem;
  parent: NativeSplit;
  siblings: NativeItem[];
  root: NativeSidebar;
  rail: HTMLElement;
  restore: HTMLButtonElement;
  target: SidebarTarget;
  inert: Map<HTMLElement, boolean>;
  styles: Map<HTMLElement, Map<string, FoldStyle>>;
  dimensionDispose?: () => void;
}
interface CapturedItem {
  parent: NativeParent | null;
  children?: NativeItem[];
  dimension: number | null;
  direction?: NativeSplit['direction'];
  selected?: number;
  view?: NativeLeaf['view'];
  pinned?: boolean;
}
type CapturedTree = Map<NativeItem, CapturedItem>;
interface Branch {
  branch: NativeItem;
  parent: NativeSplit;
}
const TARGET_MESSAGE = 'Select a tab in the main window’s left or right sidebar, then run this command.';
const MAX_ITEMS = 2000;

function isLeaf(value: unknown): boolean { return value instanceof WorkspaceLeaf; }
function isTabs(value: unknown): boolean { return value instanceof WorkspaceTabs; }
function isSplit(value: unknown): boolean { return value instanceof WorkspaceSplit; }
function isSidebar(value: unknown): boolean { return value instanceof WorkspaceSidedock; }

function nativeItem(value: unknown): NativeItem {
  return value as NativeItem;
}
function sameItems(a: readonly NativeItem[], b: readonly NativeItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
function isInside(item: NativeItem, ancestor: NativeItem): boolean {
  const visited = new Set<NativeItem>();
  let current: NativeItem | null = item;
  while (current && !visited.has(current)) {
    if (current === ancestor) return true;
    visited.add(current);
    current = current.parent;
  }
  return false;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The native sidebar operation failed.';
}

/** All undocumented Obsidian fields and hooks are confined to this adapter. */
export class SidebarAdapter {
  private readonly workspace: NativeWorkspace;
  private readonly folds = new Map<NativeItem, Fold>();
  private readonly disposers: (() => void)[] = [];
  private readonly gestureEnds = new Set<() => void>();
  private activeGestures = 0;
  private externalGestureEnd: (() => void) | null = null;
  private operationRunning = false;
  private installed = false;
  private nativeDetected = false;

  constructor(private readonly app: App, private readonly notice: (message: string) => void) {
    this.workspace = app.workspace as unknown as NativeWorkspace;
  }

  assertCompatible(): void {
    const ws = this.workspace;
    if (!ws.containerEl?.ownerDocument || typeof ws.createLeafBySplit !== 'function'
      || typeof ws.setActiveLeaf !== 'function' || typeof ws.iterateAllLeaves !== 'function'
      || typeof ws.onDragLeaf !== 'function' || typeof ws.changeLayout !== 'function'
      || typeof ws.requestResize !== 'function') {
      throw new Error('This Obsidian workspace does not expose the required sidebar operations. The layout was not changed.');
    }
    const prototype = WorkspaceLeaf.prototype as unknown as { onOpenTabHeaderMenu?: unknown };
    if (typeof prototype.onOpenTabHeaderMenu !== 'function') {
      throw new Error('This Obsidian version has an incompatible tab menu hook. The layout was not changed.');
    }
    if (!(isSplit(ws.rootSplit)) || ws.rootSplit.type !== 'split'
      || ws.rootSplit.direction !== 'vertical' || !Array.isArray(ws.rootSplit.children)) {
      throw new Error('The main workspace structure is incompatible. The layout was not changed.');
    }
    const ids = new Set<string>();
    this.validateSidebar(ws.leftSplit, ids);
    this.validateSidebar(ws.rightSplit, ids);
    if (ws.leftSplit === ws.rightSplit || ws.leftSplit === ws.rootSplit || ws.rightSplit === ws.rootSplit) {
      throw new Error('The sidebar roots are not distinct. The layout was not changed.');
    }
  }

  private validateSidebar(root: NativeSidebar, ids = new Set<string>()): void {
    const doc = this.workspace.containerEl.ownerDocument;
    if (!(isSidebar(root)) || root.type !== 'split' || root.direction !== 'horizontal'
      || root.parent !== null || typeof root.collapsed !== 'boolean'
      || !Number.isFinite(root.size) || root.size <= 0) {
      throw new Error('The native desktop sidebar root is incompatible. The layout was not changed.');
    }
    const seen = new Set<NativeItem>();
    const walk = (item: NativeItem, parent: NativeParent | null): void => {
      if (!item || seen.has(item) || seen.size >= MAX_ITEMS || item.parent !== parent
        || typeof item.id !== 'string' || !item.id || ids.has(item.id)
        || item.containerEl?.ownerDocument !== doc || item.resizeHandleEl?.ownerDocument !== doc
        || typeof item.setDimension !== 'function'
        || !(item.dimension === null || (Number.isFinite(item.dimension) && item.dimension > 0 && item.dimension < 100))) {
        throw new Error('The sidebar contains an invalid, detached or cyclic native branch. The layout was not changed.');
      }
      seen.add(item);
      ids.add(item.id);
      if (isLeaf(item)) {
        const leaf = item as NativeLeaf;
        if (!(isTabs(parent)) || leaf.type !== 'leaf'
          || leaf.tabHeaderEl?.ownerDocument !== doc || !leaf.view
          || typeof leaf.view.getViewType !== 'function' || typeof leaf.view.onTabMenu !== 'function'
          || typeof leaf.detach !== 'function') {
          throw new Error('A sidebar tab is incompatible. The layout was not changed.');
        }
        return;
      }
      if (!(isTabs(item)) && !(isSplit(item))) {
        throw new Error('An unsupported sidebar item was found. The layout was not changed.');
      }
      const group = item as NativeParent;
      if (!Array.isArray(group.children) || typeof group.insertChild !== 'function'
        || typeof group.removeChild !== 'function' || typeof group.replaceChild !== 'function'
        || (item !== root && group.children.length === 0)) {
        throw new Error('A native sidebar parent cannot preserve its children safely. The layout was not changed.');
      }
      if (isTabs(item)) {
        const tabs = item as NativeTabs;
        if (tabs.type !== 'tabs' || !Number.isInteger(tabs.currentTab)
          || tabs.currentTab < 0 || tabs.currentTab >= tabs.children.length) {
          throw new Error('A sidebar tab group has an invalid selected tab. The layout was not changed.');
        }
      } else if (item.type !== 'split' || !['horizontal', 'vertical'].includes((item as NativeSplit).direction)) {
        throw new Error('A sidebar split has an unsupported orientation. The layout was not changed.');
      }
      for (const child of group.children) walk(child, group);
    };
    walk(root, null);
  }

  resolveTarget(leaf: WorkspaceLeaf): SidebarTarget {
    if (!(isLeaf(leaf))) throw new Error(TARGET_MESSAGE);
    const item = nativeItem(leaf);
    const ws = this.workspace;
    let root: NativeItem = item;
    const seen = new Set<NativeItem>();
    while (root.parent) {
      if (seen.has(root) || seen.size >= MAX_ITEMS) throw new Error(TARGET_MESSAGE);
      seen.add(root);
      if (!Array.isArray(root.parent.children) || !root.parent.children.includes(root)) throw new Error(TARGET_MESSAGE);
      root = root.parent;
    }
    const side = root === ws.leftSplit ? 'left' : root === ws.rightSplit ? 'right' : null;
    if (!side || item.containerEl?.ownerDocument !== ws.containerEl.ownerDocument) throw new Error(TARGET_MESSAGE);
    this.validateSidebar(root as NativeSidebar);
    const group = item.parent;
    const parent = group?.parent;
    if (!(isTabs(group)) || !(isSplit(parent))) throw new Error(TARGET_MESSAGE);
    return { leaf, side, root: root as NativeSidebar, group: group as NativeTabs, parent: parent as NativeSplit };
  }

  resolveCommandTarget(): SidebarTarget {
    const ws = this.workspace;
    const doc = ws.containerEl.ownerDocument;
    const currentDocument = typeof activeDocument === 'undefined' ? doc : activeDocument;
    if (currentDocument !== doc || !ws.activeLeaf) throw new Error(TARGET_MESSAGE);
    const current = this.resolveTarget(ws.activeLeaf);
    if (current.root.collapsed || current.group.containerEl.getBoundingClientRect().width <= 0
      || this.foldContaining(nativeItem(current.leaf))) throw new Error(TARGET_MESSAGE);
    const activeElement = doc.activeElement;
    if (activeElement && [...this.folds.values()].some(fold => fold.rail.contains(activeElement))) {
      throw new Error(TARGET_MESSAGE);
    }
    const focused: WorkspaceLeaf[] = [];
    if (activeElement && activeElement !== doc.body) {
      ws.iterateAllLeaves(leaf => {
        const item = nativeItem(leaf) as NativeLeaf;
        if (item.containerEl?.contains(activeElement) || item.tabHeaderEl?.contains(activeElement)) focused.push(leaf);
      });
    }
    if (focused.length > 1) throw new Error(TARGET_MESSAGE);
    if (focused.length === 1) {
      if (focused[0] !== ws.activeLeaf) throw new Error(TARGET_MESSAGE);
      return this.resolveTarget(focused[0]);
    }
    if (activeElement && activeElement !== doc.body) throw new Error(TARGET_MESSAGE);
    if (!ws.activeLeaf) throw new Error(TARGET_MESSAGE);
    const target = this.resolveTarget(ws.activeLeaf);
    if (this.foldContaining(nativeItem(target.leaf))) throw new Error(TARGET_MESSAGE);
    return target;
  }

  isCurrent(target: SidebarTarget): boolean {
    try {
      const current = this.resolveTarget(target.leaf);
      return current.root === target.root && current.side === target.side
        && current.group === target.group && current.parent === target.parent;
    } catch { return false; }
  }

  nativeSplitAvailable(target: SidebarTarget): boolean {
    if (this.nativeDetected) return true;
    if (!this.isCurrent(target) || this.workspace.activeLeaf !== target.leaf) return false;
    const commands = (this.app as unknown as { commands?: NativeCommandRegistry }).commands;
    try {
      const command = commands?.findCommand?.('workspace:split-vertical');
      if (typeof command?.checkCallback === 'function' && command.checkCallback(true) === true) {
        this.nativeDetected = true;
        return true;
      }
    } catch { /* An unavailable check is not a compatibility assertion. */ }
    return false;
  }

  install(actions: { addColumn: (target: SidebarTarget) => void; split: (target: SidebarTarget) => void; collapse: (target: SidebarTarget) => void }): () => void {
    if (this.installed) throw new Error('The sidebar adapter is already installed.');
    this.assertCompatible();
    this.installed = true;
    try {
      this.disposers.push(wrapMethod(WorkspaceLeaf.prototype, 'onOpenTabHeaderMenu', (original, receiver, args) => {
        let target: SidebarTarget;
        try { target = this.resolveTarget(receiver as WorkspaceLeaf); }
        catch { return Reflect.apply(original, receiver, args); }
        const view = (nativeItem(target.leaf) as NativeLeaf).view;
        const seenMenus = new Set<Menu>();
        let release: (() => void) | undefined;
        try {
          release = wrapMethod(view, 'onTabMenu', (originalMenu, menuReceiver, menuArgs) => {
            const result = Reflect.apply(originalMenu, menuReceiver, menuArgs);
            const menu = menuArgs[0] as Menu;
            if (menu && typeof menu.addItem === 'function' && !seenMenus.has(menu)) {
              seenMenus.add(menu);
              menu.addItem(item => item.setTitle('Add full-height column (experimental)').setIcon('columns-2')
                .onClick(() => actions.addColumn(target)));
              if (!this.nativeSplitAvailable(target)) {
                menu.addItem(item => item.setTitle('Split this row right (experimental)').setIcon('separator-vertical')
                  .onClick(() => actions.split(target)));
              }
              if (this.canCollapse(target)) {
                menu.addItem(item => item.setTitle('Collapse this column (experimental)').setIcon('panel-left-close')
                  .onClick(() => actions.collapse(target)));
              }
            }
            return result;
          });
        } catch {
          this.notice('The native tab menu could not be extended safely. Use the command palette after selecting a sidebar tab.');
        }
        try { return Reflect.apply(original, receiver, args); }
        finally { release?.(); }
      }));
      this.disposers.push(wrapMethod(this.workspace, 'onDragLeaf', (original, receiver, args) => {
        // Moving the source header before Chromium owns its drag cancels it.
        // Capture-phase dragenter/over/drop normalizes folds before native geometry reads.
        const event = args[0] as DragEvent;
        const doc = (event?.target as Node | null)?.ownerDocument ?? this.workspace.containerEl.ownerDocument;
        const end = this.startGesture(doc, 'drag');
        try { return Reflect.apply(original, receiver, args); }
        catch (error) { end(); throw error; }
      }));
      this.disposers.push(wrapMethod(this.workspace, 'changeLayout', (original, receiver, args) => {
        this.expandAll();
        return Reflect.apply(original, receiver, args);
      }));
      const container = this.workspace.containerEl;
      this.listen(container, 'pointerdown', event => {
        const pointer = event as PointerEvent;
        if (pointer.button !== 0) return;
        if (this.isResizeHandle(event.target)) {
          this.expandAll();
          this.startGesture(container.ownerDocument, 'resize');
        }
      }, true);
      this.listen(container, 'dblclick', event => {
        if (this.isResizeHandle(event.target)) this.expandAll();
      }, true);
      const externalDrag = (event: Event): void => {
        if (this.folds.size === 0) return;
        this.expandAll();
        this.externalGestureEnd?.();
        // Direct external drops may have no dragend. Never start a gesture during
        // drop, after its document cleanup could already have run.
        if (event.type !== 'drop') this.externalGestureEnd = this.startGesture(container.ownerDocument, 'drag');
      };
      this.listen(container.ownerDocument, 'dragenter', externalDrag, true);
      this.listen(container.ownerDocument, 'dragover', externalDrag, true);
      this.listen(container.ownerDocument, 'drop', externalDrag, true);
      this.listen(container.ownerDocument, 'dragleave', event => {
        const drag = event as DragEvent;
        if (!this.externalGestureEnd) return;
        const related = drag.relatedTarget as Node | null;
        const roots = [this.workspace.leftSplit.containerEl, this.workspace.rightSplit.containerEl];
        if (related && roots.some(root => root.contains(related))) return;
        if (!related && drag.target !== container.ownerDocument.body && drag.target !== container.ownerDocument.documentElement
          && roots.some(root => {
            const rect = root.getBoundingClientRect();
            return drag.clientX >= rect.left && drag.clientX < rect.right && drag.clientY >= rect.top && drag.clientY < rect.bottom;
          })) return;
        this.externalGestureEnd();
      }, true);
    } catch (error) {
      this.dispose();
      throw error;
    }
    return () => this.dispose();
  }

  private listen(target: EventTarget, type: string, callback: (event: Event) => void, capture = false): void {
    target.addEventListener(type, callback, capture);
    this.disposers.push(() => target.removeEventListener(type, callback, capture));
  }

  private startGesture(doc: Document, kind: 'resize' | 'drag'): () => void {
    this.activeGestures++;
    let active = true;
    const events = kind === 'resize' ? ['pointerup', 'pointercancel'] : ['drop', 'dragend'];
    const end = (): void => {
      if (!active) return;
      active = false;
      this.activeGestures--;
      for (const name of events) doc.removeEventListener(name, end, true);
      doc.defaultView?.removeEventListener('blur', end);
      this.gestureEnds.delete(end);
      if (this.externalGestureEnd === end) this.externalGestureEnd = null;
    };
    this.gestureEnds.add(end);
    for (const name of events) doc.addEventListener(name, end, true);
    doc.defaultView?.addEventListener('blur', end);
    return end;
  }

  isBusyGesture(): boolean { return this.activeGestures > 0; }
  getCollapsedCount(): number { return this.folds.size; }

  private isResizeHandle(target: EventTarget | null): boolean {
    const win = this.workspace.containerEl.ownerDocument.defaultView;
    if (!win || !(target instanceof win.Node)) return false;
    const seen = new Set<NativeItem>();
    const walk = (item: NativeItem): boolean => {
      if (!item || seen.has(item) || seen.size >= MAX_ITEMS) return false;
      seen.add(item);
      if (item.resizeHandleEl === target || item.resizeHandleEl?.contains(target)) return true;
      return Array.isArray((item as NativeParent).children) && (item as NativeParent).children.some(walk);
    };
    return walk(this.workspace.leftSplit) || walk(this.workspace.rightSplit);
  }

  private dispose(): void {
    this.expandAll();
    for (const end of [...this.gestureEnds]) end();
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.installed = false;
  }

  private fullHeightContent(root: NativeSidebar): NativeSplit | null {
    let parent: NativeSplit = root;
    const seen = new Set<NativeItem>();
    while (parent.children.length === 1 && !seen.has(parent)) {
      seen.add(parent);
      const child = parent.children[0];
      if (!isSplit(child) || isSidebar(child)) return null;
      const split = child as NativeSplit;
      if (split.direction === 'vertical') return split;
      parent = split;
    }
    return null;
  }

  private branchIn(item: NativeItem, parent: NativeSplit): NativeItem | null {
    const seen = new Set<NativeItem>();
    while (item.parent && !seen.has(item)) {
      seen.add(item);
      if (item.parent === parent) return item;
      item = item.parent;
    }
    return null;
  }

  private column(target: SidebarTarget): Branch | null {
    if (!this.isCurrent(target)) return null;
    const fullHeight = this.fullHeightContent(target.root);
    const wholeBranch = fullHeight && this.branchIn(target.group, fullHeight);
    if (fullHeight && wholeBranch) return { branch: wholeBranch, parent: fullHeight };
    let branch: NativeItem = target.group;
    const seen = new Set<NativeItem>();
    while (branch.parent && branch.parent !== target.root && !seen.has(branch)) {
      seen.add(branch);
      const parent = branch.parent;
      if (isSplit(parent) && (parent as NativeSplit).direction === 'vertical') {
        return { branch, parent: parent as NativeSplit };
      }
      branch = parent;
    }
    return null;
  }

  private foldWindow(doc: Document): NativeDomWindow | null {
    const win = doc.win as NativeDomWindow | undefined;
    return win && typeof win.createDiv === 'function' && typeof win.createEl === 'function' ? win : null;
  }

  canCollapse(target: SidebarTarget): boolean {
    if (!this.foldWindow(target.root.containerEl.ownerDocument)) return false;
    if (this.operationRunning || this.isBusyGesture() || target.root.collapsed) return false;
    const column = this.column(target);
    if (!column || this.folds.has(column.branch) || this.foldContaining(column.parent)) return false;
    return column.parent.children.length >= 2
      && column.parent.children.some(sibling => sibling !== column.branch && !this.folds.has(sibling));
  }

  collapse(target: SidebarTarget): void {
    this.assertCompatible();
    const nativeWindow = this.foldWindow(target.root.containerEl.ownerDocument);
    if (!nativeWindow) throw new Error('The native window cannot create sidebar controls safely. Column collapse is unavailable; splitting remains available.');
    if (!this.canCollapse(target)) throw new Error('This tab has no collapsible sidebar column, or it is the last open column.');
    const { branch, parent } = this.column(target)!;
    for (const fold of [...this.folds.values()]) {
      if (isInside(fold.branch, branch)) this.expandFold(fold, false);
    }
    const doc = branch.containerEl.ownerDocument;
    const rail = nativeWindow.createDiv();
    rail.className = 'sidebar-columns-rail';
    const restore = nativeWindow.createEl('button');
    if (rail.ownerDocument !== doc || restore.ownerDocument !== doc) {
      throw new Error('The sidebar controls belong to a different window. Column collapse is unavailable; splitting remains available.');
    }
    restore.type = 'button';
    restore.className = 'clickable-icon sidebar-columns-restore';
    restore.setAttribute('aria-label', 'Expand sidebar column');
    restore.title = 'Expand column';
    restore.setAttribute('aria-expanded', 'false');
    setIcon(restore, 'panel-left-open');
    rail.appendChild(restore);
    const fold: Fold = { branch, parent, siblings: parent.children.slice(), root: target.root, rail, restore, target,
      inert: new Map(), styles: new Map() };
    // The native dimension remains authoritative. This wrapper keeps only the
    // folded presentation fixed when native code refreshes inline dimensions.
    fold.dimensionDispose = wrapMethod(branch, 'setDimension', (original, receiver, args) => {
      try { return Reflect.apply(original, receiver, args); }
      finally {
        if (this.folds.get(branch) === fold) this.refreshFoldStyles(fold, branch.containerEl);
      }
    });
    const children = (branch as NativeParent).children;
    if (Array.isArray(children)) {
      for (const child of children) {
        fold.inert.set(child.containerEl, child.containerEl.inert);
        child.containerEl.inert = true;
      }
    }
    restore.addEventListener('click', () => this.expandFold(fold, true));
    this.folds.set(branch, fold);
    this.setFoldStyles(fold, branch.containerEl, {
      'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': '32px',
      'width': '32px', 'min-width': '32px', 'max-width': '32px',
    });
    const win = doc.defaultView;
    for (const child of Array.from(branch.containerEl.children)) {
      if (win && child.instanceOf(win.HTMLElement)) this.setFoldStyles(fold, child, { display: 'none' });
    }
    branch.containerEl.appendChild(rail);
    branch.containerEl.classList.add('sidebar-columns-collapsed');
    const active = this.workspace.activeLeaf;
    if (active && isInside(nativeItem(active), branch)) {
      const alternate = parent.children.filter(child => child !== branch && !this.folds.has(child))
        .map(child => this.firstLeaf(child)).find(leaf => leaf !== null);
      if (alternate) this.workspace.setActiveLeaf(alternate, { focus: false });
    }
    restore.focus({ preventScroll: true });
    this.workspace.requestResize();
  }

  private setFoldStyles(fold: Fold, element: HTMLElement, values: Record<string, string>): void {
    const entries = fold.styles.get(element) ?? new Map<string, FoldStyle>();
    fold.styles.set(element, entries);
    for (const [property, value] of Object.entries(values)) {
      const entry: FoldStyle = {
        value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property),
        appliedValue: '', appliedPriority: '',
      };
      element.style.setProperty(property, value);
      entry.appliedValue = element.style.getPropertyValue(property);
      entry.appliedPriority = element.style.getPropertyPriority(property);
      entries.set(property, entry);
    }
  }

  private refreshFoldStyles(fold: Fold, element: HTMLElement): void {
    for (const [property, entry] of fold.styles.get(element) ?? []) {
      const value = element.style.getPropertyValue(property), priority = element.style.getPropertyPriority(property);
      if (value === entry.appliedValue && priority === entry.appliedPriority) continue;
      // Retain legitimate newer native inline values for expansion, then restore
      // the scoped rail presentation without touching the stored dimension.
      entry.value = value;
      entry.priority = priority;
      element.style.setProperty(property, entry.appliedValue, entry.appliedPriority);
    }
  }

  private restoreFoldStyles(fold: Fold): void {
    for (const [element, entries] of fold.styles) {
      for (const [property, entry] of entries) {
        // A later plugin may own a newer value. Restore only our unchanged value.
        if (element.style.getPropertyValue(property) !== entry.appliedValue
          || element.style.getPropertyPriority(property) !== entry.appliedPriority) continue;
        if (entry.value) element.style.setProperty(property, entry.value, entry.priority);
        else element.style.removeProperty(property);
      }
    }
  }

  private firstLeaf(item: NativeItem): WorkspaceLeaf | null {
    if (isLeaf(item)) return item as unknown as WorkspaceLeaf;
    const children = (item as NativeParent).children;
    if (!Array.isArray(children)) return null;
    if (isTabs(item)) {
      const current = children[(item as NativeTabs).currentTab];
      if (isLeaf(current)) return current as unknown as WorkspaceLeaf;
    }
    for (const child of children) {
      if (this.folds.has(child)) continue;
      const leaf = this.firstLeaf(child);
      if (leaf) return leaf;
    }
    return null;
  }

  private foldContaining(item: NativeItem): Fold | null {
    for (const fold of this.folds.values()) if (isInside(item, fold.branch)) return fold;
    return null;
  }

  private expandFold(fold: Fold, focus: boolean): void {
    if (this.folds.get(fold.branch) !== fold) return;
    this.folds.delete(fold.branch);
    fold.branch.containerEl.classList.remove('sidebar-columns-collapsed');
    fold.rail.remove();
    fold.dimensionDispose?.();
    this.restoreFoldStyles(fold);
    for (const [element, original] of fold.inert) element.inert = original;
    this.workspace.requestResize();
    if (focus) {
      try {
        const target = this.resolveTarget(fold.target.leaf);
        if (target.root === fold.root) this.workspace.setActiveLeaf(target.leaf, { focus: true });
      } catch { this.notice(TARGET_MESSAGE); }
    }
  }

  expandAll(): void {
    for (const fold of [...this.folds.values()]) this.expandFold(fold, false);
  }

  onLayoutChange(): void {
    for (const fold of [...this.folds.values()]) {
      const stillAttached = isInside(fold.branch, fold.root)
        && (fold.root === this.workspace.leftSplit || fold.root === this.workspace.rightSplit);
      if (!stillAttached || fold.branch.parent !== fold.parent || !sameItems(fold.parent.children, fold.siblings)
        || (this.workspace.activeLeaf && isInside(nativeItem(this.workspace.activeLeaf), fold.branch))) {
        this.expandFold(fold, false);
      }
    }
  }

  private captureTree(root: NativeItem): CapturedTree {
    const tree: CapturedTree = new Map();
    const walk = (item: NativeItem): void => {
      if (tree.has(item) || tree.size >= MAX_ITEMS) throw new Error('The native sidebar tree cannot be captured safely.');
      const children = isSplit(item) || isTabs(item) ? (item as NativeParent).children.slice() : undefined;
      tree.set(item, {
        parent: item.parent, children, dimension: item.dimension,
        direction: isSplit(item) ? (item as NativeSplit).direction : undefined,
        selected: isTabs(item) ? (item as NativeTabs).currentTab : undefined,
        view: isLeaf(item) ? (item as NativeLeaf).view : undefined,
        pinned: isLeaf(item) ? (item as NativeLeaf).pinned : undefined,
      });
      children?.forEach(walk);
    };
    walk(root);
    return tree;
  }

  private structureMatches(tree: CapturedTree): boolean {
    return [...tree].every(([item, saved]) => item.parent === saved.parent
      && (!saved.children || sameItems((item as NativeParent).children, saved.children))
      && (saved.direction === undefined || (item as NativeSplit).direction === saved.direction));
  }

  private createNativeSplit(direction: NativeSplit['direction'], existing: CapturedTree): NativeSplit {
    // These exported constructors have undocumented arguments. Keep them behind
    // the version gate and check every required native invariant before attachment.
    const split = Reflect.construct(WorkspaceSplit, [this.workspace, direction]) as NativeSplit;
    const doc = this.workspace.containerEl.ownerDocument;
    if (!isSplit(split) || isSidebar(split) || split.type !== 'split' || split.direction !== direction
      || split.parent !== null || !Array.isArray(split.children) || split.children.length !== 0
      || typeof split.id !== 'string' || !split.id || [...existing.keys()].some(item => item.id === split.id)
      || split.containerEl?.ownerDocument !== doc || split.resizeHandleEl?.ownerDocument !== doc
      || typeof split.setDimension !== 'function' || typeof split.insertChild !== 'function'
      || typeof split.removeChild !== 'function' || typeof split.replaceChild !== 'function') {
      throw new Error('This Obsidian version cannot construct a guarded native sidebar column. The layout was not changed.');
    }
    return split;
  }

  async addColumn(target: SidebarTarget): Promise<void> {
    if (this.operationRunning || this.isBusyGesture()) throw new Error('Finish the current sidebar operation or drag first.');
    this.assertCompatible();
    if (!this.isCurrent(target)) throw new Error('The selected sidebar tab moved or closed. Select it again.');
    if (target.root.collapsed) throw new Error('Open the selected sidebar before adding a column.');
    this.expandAll();
    const root = target.root;
    const win = root.containerEl.ownerDocument.defaultView;
    if (!win) throw new Error('The sidebar window is unavailable.');
    const fullHeight = this.fullHeightContent(root);
    const branch = fullHeight ? this.branchIn(target.group, fullHeight) : null;
    if (fullHeight && !branch) throw new Error('The selected tab is outside the full-height sidebar columns.');
    const style = win.getComputedStyle((fullHeight ?? root).containerEl);
    if (style.flexDirection !== (fullHeight ? 'row' : 'column')) {
      throw new Error('The theme changes the native split orientation. Restore native sidebar styling before adding a column.');
    }
    const before = style.direction === 'rtl';
    const bounds = root.containerEl.getBoundingClientRect();
    const visible = target.group.containerEl.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || visible.width <= 0 || visible.height <= 0) {
      throw new Error('The selected sidebar tab group is not visible.');
    }
    const rootChildren = root.children.slice();
    // A sidedock can also contain native controls such as its vault-profile
    // footer. The tree children occupy the usable panel area, not the whole root.
    const contentRects = rootChildren.map(child => child.containerEl.getBoundingClientRect());
    if (contentRects.some(rect => rect.width <= 0 || rect.height <= 0)) {
      throw new Error('The native sidebar content is not visible.');
    }
    const contentBounds = {
      top: Math.min(...contentRects.map(rect => rect.top)),
      bottom: Math.max(...contentRects.map(rect => rect.bottom)),
    };
    const original = this.captureTree(root);
    const originalSize = root.size, originalCollapsed = root.collapsed;
    const originalActive = this.workspace.activeLeaf;
    const originalLeaves = new Set<WorkspaceLeaf>();
    this.workspace.iterateAllLeaves(leaf => originalLeaves.add(leaf));
    // Allocate and validate detached splits before asking the public API to mutate.
    const content = fullHeight ?? this.createNativeSplit('vertical', original);
    const stack = !fullHeight && rootChildren.length > 1 ? this.createNativeSplit('horizontal', original) : null;
    if (stack?.id === content.id) throw new Error('The native split constructors returned duplicate identities.');
    let created: WorkspaceLeaf | undefined;
    let createdGroup: NativeTabs | null = null;
    let extracted = false, assembled = false;
    let post: CapturedTree | null = null;
    let postActive: WorkspaceLeaf | null = null;
    let postGroup: CapturedTree | null = null;
    let existingColumn: NativeItem | null = branch;
    this.operationRunning = true;
    try {
      created = this.workspace.createLeafBySplit(target.leaf, 'vertical', before);
      if (!isLeaf(created) || originalLeaves.has(created)) throw new Error('The native split did not return a new tab.');
      const item = nativeItem(created) as NativeLeaf;
      if (!isTabs(item.parent) || !isSplit(item.parent?.parent)) throw new Error('The returned tab has no safely supported native group.');
      createdGroup = item.parent as NativeTabs;
      post = this.captureTree(root);
      postGroup = this.captureTree(createdGroup);
      postActive = this.workspace.activeLeaf;
      if (original.has(createdGroup) || createdGroup.children.length !== 1 || createdGroup.children[0] !== item
        || item.view.getViewType() !== 'empty' || item.pinned || !isInside(item, root)) {
        throw new Error('The native split did not return an owned empty sidebar group.');
      }
      // Move the returned group without detaching its leaf: native views stay open.
      createdGroup.parent!.removeChild(createdGroup);
      extracted = true;
      postGroup = this.captureTree(createdGroup);
      post = this.captureTree(root);
      if (!this.structureMatches(original)) throw new Error('The existing sidebar changed while preparing its new column.');
      for (const [node, saved] of original) node.setDimension(saved.dimension);
      createdGroup.setDimension(null);
      if (fullHeight) {
        const index = fullHeight.children.indexOf(branch!);
        if (index < 0) throw new Error('The selected full-height column moved.');
        const dimension = branch!.dimension;
        if (dimension !== null) {
          branch!.setDimension(dimension / 2);
          createdGroup.setDimension(dimension / 2);
        }
        fullHeight.insertChild(index + (before ? 0 : 1), createdGroup);
      } else {
        // Inserting the wrapper first keeps the sidedock nonempty. Root children
        // are moved as objects, with their original vertical proportions intact.
        root.insertChild(0, content);
        if (stack) {
          for (const child of rootChildren) {
            root.removeChild(child);
            stack.insertChild(-1, child);
          }
          existingColumn = stack;
        } else {
          existingColumn = rootChildren[0]!;
          root.removeChild(existingColumn);
        }
        existingColumn.setDimension(50);
        createdGroup.setDimension(50);
        (before ? [createdGroup, existingColumn] : [existingColumn, createdGroup])
          .forEach(child => content.insertChild(-1, child));
      }
      assembled = true;
      this.workspace.requestResize();
      post = this.captureTree(root);
      postGroup = this.captureTree(createdGroup);
      postActive = this.workspace.activeLeaf;
      await this.nextFrame(win);
      if ((target.side === 'left' ? this.workspace.leftSplit : this.workspace.rightSplit) !== root) {
        throw new Error('The sidebar workspace was replaced while adding its column.');
      }
      const next = this.resolveTarget(created);
      if (next.root !== root || next.group !== createdGroup || next.parent !== content) {
        throw new Error('The new column is no longer attached to the selected sidebar.');
      }
      this.validateSidebar(root);
      const preserved = [...original].every(([node, saved]) =>
        (!saved.view || ((node as NativeLeaf).view === saved.view && (node as NativeLeaf).pinned === saved.pinned))
        && (saved.selected === undefined || (node as NativeTabs).currentTab === saved.selected)
        && (node === branch || (!fullHeight && !stack && node === existingColumn) || node.dimension === saved.dimension));
      if (!this.structureMatches(post) || !preserved || root.size !== originalSize || root.collapsed !== originalCollapsed
        || createdGroup.children.length !== 1 || createdGroup.children[0] !== item || item.view.getViewType() !== 'empty'
        || createdGroup.parent !== content || existingColumn?.parent !== content) {
        throw new Error('Obsidian did not preserve the existing native sidebar while adding its full-height column.');
      }
      const oldIndex = content.children.indexOf(existingColumn);
      if (content.children.indexOf(createdGroup) !== oldIndex + (before ? -1 : 1)) {
        throw new Error('The new full-height column is in an unexpected native tree position.');
      }
      const contentRect = content.containerEl.getBoundingClientRect();
      const oldRect = existingColumn.containerEl.getBoundingClientRect();
      const newRect = createdGroup.containerEl.getBoundingClientRect();
      if (oldRect.width <= 0 || newRect.width <= 0 || newRect.left < oldRect.right - 1
        || Math.abs(contentRect.top - contentBounds.top) > 1 || Math.abs(contentRect.bottom - contentBounds.bottom) > 1
        || Math.abs(newRect.top - contentRect.top) > 1 || Math.abs(newRect.bottom - contentRect.bottom) > 1
        || Math.abs(oldRect.top - contentRect.top) > 1 || Math.abs(oldRect.bottom - contentRect.bottom) > 1) {
        throw new Error('The new native sidebar column did not render full height to the right. The theme may be incompatible.');
      }
    } catch (error) {
      let rollbackError: unknown;
      try {
        if (!created || originalLeaves.has(created) || !createdGroup || !post || !postGroup) {
          throw new Error('No safely identified operation-owned tab was returned; the layout was not automatically rewritten.');
        }
        const item = nativeItem(created) as NativeLeaf;
        if ((target.side === 'left' ? this.workspace.leftSplit : this.workspace.rightSplit) !== root
          || !this.structureMatches(post) || !this.structureMatches(postGroup)
          || item.parent !== createdGroup || item.view.getViewType() !== 'empty' || item.pinned
          || createdGroup.children.length !== 1 || createdGroup.children[0] !== item) {
          throw new Error('The added tab moved, changed, or its branch was edited; automatic rollback was stopped.');
        }
        const ratiosUnchanged = [...post, ...postGroup].every(([node, saved]) => node.dimension === saved.dimension);
        const focusUnchanged = this.workspace.activeLeaf === postActive;
        if (assembled && !fullHeight) {
          // Let the native two-child wrapper flatten to its owned empty group.
          // Its retained branch is now detached and can safely yield old rows.
          content.removeChild(existingColumn!);
          if (stack) {
            for (const child of rootChildren) {
              stack.removeChild(child);
              root.insertChild(root.children.indexOf(createdGroup), child);
            }
          } else root.insertChild(root.children.indexOf(createdGroup), existingColumn!);
        } else if (!assembled && extracted && !this.structureMatches(original)) {
          throw new Error('The sidebar changed during preparation; automatic rollback was stopped.');
        }
        item.detach();
        if (!this.structureMatches(original)) {
          throw new Error('The sidebar changed during removal; automatic rollback was stopped.');
        }
        if (ratiosUnchanged) for (const [node, saved] of original) node.setDimension(saved.dimension);
        if (focusUnchanged && this.workspace.activeLeaf === postActive && originalActive) {
          let attached = false;
          this.workspace.iterateAllLeaves(leaf => { if (leaf === originalActive) attached = true; });
          if (attached) this.workspace.setActiveLeaf(originalActive, { focus: false });
        }
        this.workspace.requestResize();
      } catch (rollback) { rollbackError = rollback; }
      throw new Error(`${message(error)}${rollbackError ? ` ${message(rollbackError)} Use the layout backup if needed.` : ' The added column was rolled back.'}`);
    } finally { this.operationRunning = false; }
  }

  async splitRight(target: SidebarTarget): Promise<void> {
    if (this.operationRunning || this.isBusyGesture()) throw new Error('Finish the current sidebar operation or drag first.');
    this.assertCompatible();
    if (!this.isCurrent(target)) throw new Error('The selected sidebar tab moved or closed. Select it again.');
    if (this.nativeSplitAvailable(target)) throw new Error('Obsidian already enables its native sidebar split command. Use that command.');
    if (target.root.collapsed) throw new Error('Open the selected sidebar before adding a column.');
    this.expandAll();
    const win = target.root.containerEl.ownerDocument.defaultView;
    if (!win) throw new Error('The sidebar window is unavailable.');
    const style = win.getComputedStyle(target.parent.containerEl);
    if (style.flexDirection !== 'row' && style.flexDirection !== 'column') {
      throw new Error('The theme changes the native split orientation. Restore native sidebar styling before splitting.');
    }
    const before = style.direction === 'rtl';
    const originalRect = target.group.containerEl.getBoundingClientRect();
    if (originalRect.width <= 0 || originalRect.height <= 0) throw new Error('The selected sidebar tab group is not visible.');
    const parent = target.parent;
    const siblings = parent.children.slice();
    const dimensions = siblings.map(item => item.dimension);
    const groupLeaves = target.group.children.slice();
    const views = groupLeaves.map(item => (item as NativeLeaf).view);
    const pinned = groupLeaves.map(item => (item as NativeLeaf).pinned);
    const selectedTab = target.group.currentTab;
    const active = this.workspace.activeLeaf;
    const originalLeaves = new Set<WorkspaceLeaf>();
    this.workspace.iterateAllLeaves(leaf => originalLeaves.add(leaf));
    let created: WorkspaceLeaf | undefined;
    let createdGroup: NativeTabs | null = null;
    let createdParent: NativeSplit | null = null;
    let createdRoot: NativeItem | null = null;
    const postChildren = new Map<NativeParent, NativeItem[]>();
    const postDimensions = new Map<NativeItem, number | null>();
    let postActive: WorkspaceLeaf | null = null;
    let postSelectedTab = selectedTab;
    this.operationRunning = true;
    try {
      created = this.workspace.createLeafBySplit(target.leaf, 'vertical', before);
      // Ownership is established only by the native operation's returned fresh leaf.
      // Never infer an operation-owned tab from a global before/after leaf count.
      if (!isLeaf(created) || originalLeaves.has(created)) throw new Error('The native split did not return a new tab.');
      const returned = nativeItem(created);
      if (!isTabs(returned.parent) || !isSplit(returned.parent?.parent)) {
        throw new Error('The returned tab has no safely supported native group.');
      }
      createdGroup = returned.parent as NativeTabs;
      createdParent = createdGroup.parent as NativeSplit;
      let immediateRoot: NativeItem = returned;
      const immediatePath = new Set<NativeItem>();
      while (immediateRoot.parent) {
        if (immediatePath.has(immediateRoot) || immediatePath.size >= MAX_ITEMS
          || !Array.isArray(immediateRoot.parent.children) || !immediateRoot.parent.children.includes(immediateRoot)) {
          throw new Error('The returned tab has an invalid native attachment.');
        }
        immediatePath.add(immediateRoot);
        immediateRoot = immediateRoot.parent;
      }
      if (![this.workspace.leftSplit, this.workspace.rightSplit, this.workspace.rootSplit].includes(immediateRoot as NativeSidebar)) {
        throw new Error('The returned tab belongs to an unsupported window.');
      }
      createdRoot = immediateRoot;
      postChildren.set(parent, parent.children.slice());
      postChildren.set(createdParent, createdParent.children.slice());
      postChildren.set(createdGroup, createdGroup.children.slice());
      postChildren.set(target.group, target.group.children.slice());
      for (const owner of postChildren.keys()) {
        postDimensions.set(owner, owner.dimension);
        for (const child of owner.children) postDimensions.set(child, child.dimension);
      }
      postActive = this.workspace.activeLeaf;
      postSelectedTab = target.group.currentTab;
      await this.nextFrame(win);
      const next = this.resolveTarget(created);
      if (next.root !== target.root || next.group !== createdGroup || next.parent !== createdParent
        || next.group === target.group || next.group.children.length !== 1
        || next.group.children[0] !== nativeItem(created) || (nativeItem(created) as NativeLeaf).view.getViewType() !== 'empty'
        || nativeItem(target.leaf).parent !== target.group || !sameItems(target.group.children, groupLeaves)
        || groupLeaves.some((leaf, index) => (leaf as NativeLeaf).view !== views[index] || (leaf as NativeLeaf).pinned !== pinned[index])
        || target.group.currentTab !== selectedTab || next.parent.direction !== 'vertical'
        || target.group.parent !== next.parent) {
        throw new Error('Obsidian did not create an empty native column beside the selected sidebar group.');
      }
      const oldIndex = next.parent.children.indexOf(target.group);
      const newIndex = next.parent.children.indexOf(next.group);
      if (newIndex !== oldIndex + (before ? -1 : 1)) throw new Error('The new column is in an unexpected native tree position.');
      const left = target.group.containerEl.getBoundingClientRect();
      const right = next.group.containerEl.getBoundingClientRect();
      if (left.width <= 0 || right.width <= 0 || right.left < left.right - 1 || right.height <= 0) {
        throw new Error('The new native column did not render to the right. The theme may be incompatible.');
      }
    } catch (error) {
      let rollbackError: unknown;
      try {
        if (!created || originalLeaves.has(created) || !createdGroup || !createdParent || !createdRoot) {
          throw new Error('No safely identified operation-owned tab was returned; the layout was not automatically rewritten.');
        }
        const item = nativeItem(created) as NativeLeaf;
        const rootStillCurrent = createdRoot === this.workspace.leftSplit || createdRoot === this.workspace.rightSplit || createdRoot === this.workspace.rootSplit;
        if (!rootStillCurrent || item.parent !== createdGroup || createdGroup.parent !== createdParent
          || !isInside(item, createdRoot) || item.view.getViewType() !== 'empty' || item.pinned
          || createdGroup.children.length !== 1 || createdGroup.children[0] !== item
          || [...postChildren].some(([owner, children]) => !sameItems(owner.children, children))) {
          throw new Error('The added tab moved, changed, or its branch was edited; automatic rollback was stopped.');
        }
        const ratiosUnchanged = [...postDimensions].every(([node, dimension]) => node.dimension === dimension);
        const selectionUnchanged = target.group.currentTab === postSelectedTab;
        const focusUnchanged = this.workspace.activeLeaf === postActive;
        item.detach();
        if (!sameItems(parent.children, siblings) || target.group.parent !== parent
          || !sameItems(target.group.children, groupLeaves)) {
          throw new Error('The sidebar changed during removal; automatic rollback was stopped.');
        }
        // Ratios and focus may have been changed by a user/plugin while the frame was pending.
        if (ratiosUnchanged) siblings.forEach((node, index) => node.setDimension(dimensions[index]));
        if (selectionUnchanged && postSelectedTab === selectedTab) target.group.currentTab = selectedTab;
        if (focusUnchanged && this.workspace.activeLeaf === postActive && active) {
          let stillAttached = false;
          this.workspace.iterateAllLeaves(leaf => { if (leaf === active) stillAttached = true; });
          if (stillAttached) this.workspace.setActiveLeaf(active, { focus: false });
        }
        this.workspace.requestResize();
      } catch (rollback) { rollbackError = rollback; }
      throw new Error(`${message(error)}${rollbackError ? ` ${message(rollbackError)} Use the layout backup if needed.` : ' The added column was rolled back.'}`);
    } finally { this.operationRunning = false; }
  }
  private nextFrame(win: Window): Promise<void> {
    return new Promise(resolve => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        win.clearTimeout(timer);
        resolve();
      };
      const timer = win.setTimeout(finish, 250);
      win.requestAnimationFrame(finish);
    });
  }
}
