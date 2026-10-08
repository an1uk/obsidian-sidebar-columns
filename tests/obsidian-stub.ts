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


export let apiVersion = '1.14.4';
export function setTestApiVersion(version: string): void { apiVersion = version; }
export class Plugin {
 constructor(public app: unknown, public manifest: unknown) {}
 loadData(): Promise<unknown> { return Promise.resolve(null); }
 saveData(_value: unknown): Promise<void> { return Promise.resolve(); }
 addCommand(_command: unknown): void {}
 addSettingTab(tab: PluginSettingTab): void { tab.update(); }
 registerEvent(_event: unknown): void {}
}
export class Modal {}
export class PluginSettingTab {
 settingItems: import('obsidian').SettingDefinitionItem[] = [];
 updateCount = 0;
 constructor(public app: unknown, public plugin: unknown) {}
 getSettingDefinitions(): import('obsidian').SettingDefinitionItem[] { return []; }
 update(): void { this.updateCount++; this.settingItems = this.getSettingDefinitions(); }
}
class TestButton {
 text = "";
 private callback?: () => unknown;
 setButtonText(text: string): this { this.text = text; return this; }
 setCta(): this { return this; }
 onClick(callback: () => unknown): this { this.callback = callback; return this; }
 click(): unknown { return this.callback?.(); }
}
export class Setting {
 buttons: TestButton[] = [];
 constructor(_containerEl?: HTMLElement) {}
 addButton(callback: (button: TestButton) => unknown): this {
  const button = new TestButton();
  callback(button);
  this.buttons.push(button);
  return this;
 }
}
export function getSettingButtons(setting: unknown): TestButton[] {
 if (!(setting instanceof Setting)) throw new Error("Expected the test Setting instance");
 return setting.buttons;
}
export function getSettingUpdateCount(tab: unknown): number {
 if (!(tab instanceof PluginSettingTab)) throw new Error("Expected the test PluginSettingTab instance");
 return tab.updateCount;
}
export class SuggestModal<T> { protected item?: T; }
const notices: string[] = [];
export class Notice { constructor(message: string) { notices.push(message); } }
export function getTestNotices(): readonly string[] { return notices; }
