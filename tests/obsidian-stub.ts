export function setIcon(element: HTMLElement, icon: string): void { element.dataset.icon = icon; }
export class WorkspaceLeaf {}
export class WorkspaceSplit {
 constructor(workspace?: unknown, direction?: 'vertical'|'horizontal') {
  const factory=(workspace as {__createNativeSplit?:(direction:'vertical'|'horizontal')=>WorkspaceSplit}|undefined)?.__createNativeSplit;
  if(factory && direction) return factory(direction);
 }
}
export class WorkspaceTabs {}
export class WorkspaceSidedock extends WorkspaceSplit {}
export class Menu { items: unknown[] = []; addItem(callback: (item: MenuItem) => unknown): this { const item = new MenuItem(); callback(item); this.items.push(item); return this; } }
export class MenuItem { title=""; disabled=false; callback?:()=>unknown; setTitle(value:string):this {this.title=value;return this;} setIcon(_value:string):this{return this;} setDisabled(value:boolean):this{this.disabled=value;return this;} onClick(value:()=>unknown):this{this.callback=value;return this;} }


export const apiVersion = '1.14.4';
export class Plugin { constructor(public app: unknown, public manifest: unknown) {} loadData(): Promise<unknown> { return Promise.resolve(null); } }
export class Modal {}
export class PluginSettingTab {}
export class Setting {}
export class SuggestModal<T> { protected item?: T; }
export class Notice {}
