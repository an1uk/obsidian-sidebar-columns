import test from "node:test";
import assert from "node:assert/strict";
import type { App, PluginManifest } from "obsidian";
import SidebarColumns from "../src/main";

test("unload during deferred settings load prevents resource resurrection", async () => {
 let resolve!: (value: unknown) => void;
 const load = new Promise<unknown>(done => { resolve = done; });
 const plugin = new SidebarColumns({} as App, {id:"sidebar-columns",name:"Sidebar Columns",version:"0.1.0",minAppVersion:"1.14.4",description:"test",author:"Alan",isDesktopOnly:true} as PluginManifest);
 let commands=0, settingTabs=0;
 plugin.loadData = () => load;
 plugin.addCommand = (() => {commands++;}) as unknown as typeof plugin.addCommand;
 plugin.addSettingTab = (() => {settingTabs++;}) as typeof plugin.addSettingTab;
 const pending = plugin.onload();
 plugin.onunload();
 resolve({acknowledged:true,versionOverrides:["1.15.0"]});
 await pending;
 assert.equal(commands,0);
 assert.equal(settingTabs,0);
 assert.equal(plugin.adapter,undefined);
 assert.equal(plugin.settings.acknowledged,false);
});
