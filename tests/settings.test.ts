import test from "node:test";
import assert from "node:assert/strict";
import { Setting, type App, type Command, type PluginManifest, type PluginSettingTab, type SettingDefinition, type SettingDefinitionItem, type SettingGroup } from "obsidian";
import SidebarColumns from "../src/main";
import type { SidebarTarget } from "../src/adapter";
import { getSettingButtons, getSettingUpdateCount, getTestNotices, setTestApiVersion } from "./obsidian-stub";

async function setup(data: unknown = null): Promise<{ plugin: SidebarColumns; tab: PluginSettingTab; commands: Command[] }> {
  const rawLayout = {
    main: { id: "main", type: "split", direction: "vertical", children: [] },
    left: { id: "left", type: "split", direction: "horizontal", children: [] },
    right: { id: "right", type: "split", direction: "horizontal", children: [] }
  };
  const app = {
    vault: { adapter: {}, configDir: "custom-config" },
    workspace: { onLayoutReady: () => {}, on: () => ({}), getLayout: () => rawLayout }
  } as unknown as App;
  const manifest: PluginManifest = { id: "sidebar-columns", name: "Sidebar Columns", version: "0.1.1", minAppVersion: "1.14.4", description: "test", author: "Alan", isDesktopOnly: true };
  const plugin = new SidebarColumns(app, manifest);
  const commands: Command[] = [];
  let tab: PluginSettingTab | undefined;
  plugin.loadData = async () => data;
  plugin.addCommand = command => { commands.push(command); return command; };
  plugin.addSettingTab = settingTab => { tab = settingTab; settingTab.update(); };
  await plugin.onload();
  assert.ok(tab);
  plugin.adapter.assertCompatible = () => {};
  plugin.adapter.isCurrent = () => true;
  return { plugin, tab, commands };
}

function rows(items: SettingDefinitionItem[]): SettingDefinition[] {
  const group = items[0];
  assert.ok(group && "type" in group && group.type === "group");
  return (group.items ?? []).filter((item): item is SettingDefinition => !("type" in item));
}
function row(items: SettingDefinitionItem[], name: string): SettingDefinition {
  const result = rows(items).find(item => item.name === name);
  assert.ok(result, "Missing searchable setting: " + name);
  return result;
}
function button(tab: PluginSettingTab, name: string) {
  const definition = row(tab.getSettingDefinitions(), name);
  assert.ok("render" in definition && typeof definition.render === "function");
  const setting = new Setting({} as HTMLElement);
  definition.render(setting, {} as SettingGroup);
  const buttons = getSettingButtons(setting);
  assert.equal(buttons.length, 1);
  const result = buttons[0];
  assert.ok(result);
  return result;
}
async function settle(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }

test("settings expose searchable warnings, compatibility and recovery in the actual configuration directory", async () => {
  const { tab, plugin } = await setup({ acknowledged: false, versionOverrides: ["1.15.0"] });
  const definitions = tab.getSettingDefinitions();
  assert.match(String(row(definitions, "Experimental sidebar columns").desc), /unsupported arrangement/);
  assert.match(String(row(definitions, "Experimental sidebar columns").desc), /unsaved plugin input/);
  assert.match(String(row(definitions, "Compatibility and consent").desc), /1\.14\.4.*required before the first change/);
  assert.match(String(row(definitions, "Layout backups").desc), /custom-config\/sidebar-columns-backups\/.*full workspace.*confirmation/);
  assert.equal(row(definitions, "Untested-version overrides").desc, "1.15.0");
  assert.ok(rows(definitions).every(item => item.searchable !== false));
  assert.ok(rows(definitions).every(item => !("control" in item)), "Consent and version overrides cannot be bypassed by a settings toggle");
  plugin.onunload();
});

test("searchable settings actions expand existing columns or open the confirmed restore flow", async () => {
  const { tab, plugin, commands } = await setup();
  let expanded = 0, restored = 0;
  plugin.adapter.expandAll = () => { expanded++; };
  plugin.openRestorePicker = async () => { restored++; };
  button(tab, "Session-only column collapse").click();
  assert.equal(expanded, 1);
  assert.equal(restored, 0);
  button(tab, "Layout backups").click();
  assert.equal(restored, 1);
  assert.equal(expanded, 1);
  assert.equal(commands.find(command => command.id === "expand-all-columns")?.name, "Expand all columns");
  plugin.onunload();
});

test("clearing exact-version overrides refreshes indexed definitions after persistence completes", async () => {
  const { tab, plugin } = await setup({ acknowledged: true, versionOverrides: ["1.15.0", "1.16.2"] });
  let finish!: () => void;
  const pendingSave = new Promise<void>(resolve => { finish = resolve; });
  let saved: unknown;
  plugin.saveData = async data => { saved = structuredClone(data); await pendingSave; };
  const before = getSettingUpdateCount(tab);
  button(tab, "Untested-version overrides").click();
  assert.deepEqual(plugin.settings.versionOverrides, []);
  assert.equal(getSettingUpdateCount(tab), before);
  assert.equal(row(tab.settingItems, "Untested-version overrides").desc, "1.15.0, 1.16.2");
  finish();
  await settle();
  assert.deepEqual(saved, { acknowledged: true, versionOverrides: [] });
  assert.equal(getSettingUpdateCount(tab), before + 1);
  assert.match(String(row(tab.settingItems, "Untested-version overrides").desc), /explicit per-version choice/);
  plugin.onunload();
});

test("failed override persistence preserves existing consent and overrides without a misleading refresh", async () => {
  const { tab, plugin } = await setup({ acknowledged: true, versionOverrides: ["1.15.0"] });
  plugin.saveData = async () => { throw new Error("The settings disk is unavailable."); };
  const before = getSettingUpdateCount(tab);
  button(tab, "Untested-version overrides").click();
  await settle();
  assert.deepEqual(plugin.settings, { acknowledged: true, versionOverrides: ["1.15.0"] });
  assert.equal(getSettingUpdateCount(tab), before);
  assert.equal(getTestNotices().at(-1), "The settings disk is unavailable.");
  plugin.onunload();
});

test("a confirmed version override remains exact and updates searchable compatibility state", async t => {
  setTestApiVersion("1.15.0");
  t.after(() => setTestApiVersion("1.14.4"));
  const { tab, plugin } = await setup();
  let prompt = "", choice = true;
  plugin.confirm = async (_title, paragraphs, label) => { prompt = paragraphs.join(" ") + " " + label; return choice; };
  let saves = 0;
  plugin.saveData = async () => { saves++; };
  const before = getSettingUpdateCount(tab);
  assert.equal(await plugin.checkCompatibility(), true);
  assert.match(prompt, /applies only to 1\.15\.0/);
  assert.deepEqual(plugin.settings, { acknowledged: false, versionOverrides: ["1.15.0"] });
  assert.equal(getSettingUpdateCount(tab), before + 1);
  assert.equal(row(tab.settingItems, "Untested-version overrides").desc, "1.15.0");
  setTestApiVersion("1.15.1");
  choice = false;
  assert.equal(await plugin.checkCompatibility(), false);
  assert.match(prompt, /applies only to 1\.15\.1/);
  assert.deepEqual(plugin.settings.versionOverrides, ["1.15.0"]);
  assert.equal(saves, 1);
  plugin.onunload();
});

test("experimental consent cancellation preserves layout and acknowledgement; acceptance refreshes indexed status", async () => {
  const { tab, plugin } = await setup();
  let accept = false, saves = 0, mutations = 0, backups = 0;
  let warning = "";
  plugin.confirm = async (_title, paragraphs, label) => { warning = paragraphs.join(" ") + " " + label; return accept; };
  plugin.saveData = async () => { saves++; };
  plugin.adapter.collapse = async () => { mutations++; };
  plugin.backups.create = async (_layout, reason) => {
    backups++;
    return { id: "baseline-test", rawPath: "raw.workspace.json", metadataPath: "raw.metadata.json", timestamp: "2026-10-08T12:00:00.000Z", baseline: true, reason, appVersion: "1.14.4" };
  };
  const target = {} as SidebarTarget;
  assert.equal((await plugin.operations.collapse(target)).status, "cancelled");
  assert.equal(saves, 0);
  assert.equal(backups, 0);
  assert.equal(mutations, 0);
  assert.equal(plugin.settings.acknowledged, false);
  assert.match(warning, /unsupported arrangement.*unsaved plugin input.*Enable experimental sidebar columns/);
  const before = getSettingUpdateCount(tab);
  accept = true;
  assert.equal((await plugin.operations.collapse(target)).status, "success");
  assert.equal(saves, 1);
  assert.equal(backups, 1);
  assert.equal(mutations, 1);
  assert.equal(plugin.settings.acknowledged, true);
  assert.equal(getSettingUpdateCount(tab), before + 1);
  assert.match(String(row(tab.settingItems, "Compatibility and consent").desc), /acknowledgement: saved/);
  plugin.onunload();
});

test("pending override persistence cannot refresh a removed settings tab after unload", async () => {
  const { tab, plugin } = await setup({ acknowledged: true, versionOverrides: ["1.15.0"] });
  let finish!: () => void;
  plugin.saveData = () => new Promise<void>(resolve => { finish = resolve; });
  const before = getSettingUpdateCount(tab);
  const pending = plugin.clearOverrides();
  plugin.onunload();
  finish();
  await pending;
  assert.equal(getSettingUpdateCount(tab), before);
});
