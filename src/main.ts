import { apiVersion, App, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, type SettingDefinitionItem } from "obsidian";
import { SidebarAdapter, type SidebarTarget } from "./adapter";
import { BackupStore, type Snapshot } from "./backups";
import { OperationService, type OperationResult } from "./operations";
import { validateLayout, type RawLayout } from "./layout";

interface LocalSettings { acknowledged: boolean; versionOverrides: string[]; }
const TESTED_VERSION = "1.14.4";
const EXPLANATION = "Sidebar columns are experimental. Obsidian intentionally disabled this unsupported arrangement because themes and interactions were designed around single-column sidebars. Visual, resizing, focus and compatibility issues are possible. Updates may break the feature or saved layouts. A layout backup does not back up note contents or unsaved plugin input.";

export default class SidebarColumns extends Plugin {
  settings: LocalSettings = { acknowledged: false, versionOverrides: [] };
  adapter!: SidebarAdapter;
  backups!: BackupStore;
  operations!: OperationService<SidebarTarget>;
  private modals = new Set<Modal>();
  private alive = false;
  private lifecycle = 0;
  private disposeAdapter?: () => void;
  private settingsTab?: SidebarSettings;

  async onload(): Promise<void> {
    const generation = ++this.lifecycle;
    const data: unknown = await this.loadData();
    if (generation !== this.lifecycle) return;
    if (data && typeof data === "object") {
      const saved = data as Record<string, unknown>;
      this.settings = {
        acknowledged: saved.acknowledged === true,
        versionOverrides: Array.isArray(saved.versionOverrides)
          ? saved.versionOverrides.filter((version): version is string => typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version))
          : []
      };
    }
    this.alive = true;
    this.adapter = new SidebarAdapter(this.app, message => new Notice(message));
    this.backups = new BackupStore(this.app.vault.adapter, this.app.vault.configDir, apiVersion, { pluginVersion: this.manifest.version });
    this.operations = new OperationService<SidebarTarget>({
      checkCompatibility: () => this.checkCompatibility(),
      isTargetCurrent: target => this.adapter.isCurrent(target),
      isAcknowledged: () => this.settings.acknowledged,
      requestConsent: () => this.confirm("Enable experimental sidebar columns?", [
        EXPLANATION,
        "The first change requires a protected layout baseline and subsequent changes require recent snapshots. Snapshots remain local and may contain private file paths and plugin state.",
        "New columns start empty. Existing panels are not cloned."
      ], "Enable experimental sidebar columns"),
      persistAcknowledgement: async () => {
        const previous = this.settings.acknowledged;
        this.settings.acknowledged = true;
        try { await this.saveData(this.settings); }
        catch (error) { this.settings.acknowledged = previous; throw error; }
        this.settingsTab?.update();
      },
      captureLayout: () => validateLayout(this.app.workspace.getLayout()),
      captureRevision: () => JSON.stringify(this.app.workspace.getLayout()),
      isRevisionCurrent: token => token === JSON.stringify(this.app.workspace.getLayout()),
      createBackup: (layout, reason) => this.backups.create(layout, reason),
      loadBackup: snapshot => this.backups.load(snapshot),
      confirmFullRestore: snapshot => this.confirm("Restore the full workspace?", [
        "This replaces the central workspace, both sidebars and saved pop-out layouts with the selected snapshot. Current tabs and transient view state, including unsaved plugin input, may be discarded.",
        "A required pre-restore snapshot will be written first. This is not a note-content restore.",
        "Snapshot: " + snapshot.timestamp + " (" + snapshot.reason + "). Saved with Obsidian " + snapshot.appVersion + "."
      ], "Restore full workspace"),
      addColumn: target => this.adapter.addColumn(target),
      split: target => this.adapter.splitRight(target),
      collapse: target => this.adapter.collapse(target),
      applyFullLayout: layout => this.applyFullLayout(layout)
    });
    this.addCommand({id:"add-column", name:"Add full-height sidebar column (experimental)", checkCallback:checking => {
      if (!checking) void this.command("addColumn");
      return this.alive;
    }});
    this.addCommand({id:"split-right", name:"Split focused sidebar row right (experimental)", checkCallback:checking => {
      if (!checking) void this.command("split");
      return this.alive;
    }});
    this.addCommand({id:"collapse-column", name:"Collapse focused sidebar column (experimental)", checkCallback:checking => {
      if (!checking) void this.command("collapse");
      return this.alive;
    }});
    this.addCommand({id:"expand-all-columns", name:"Expand all columns", callback:() => this.adapter.expandAll()});
    this.addCommand({id:"restore-workspace", name:"Restore full workspace from a layout backup", callback:() => { void this.openRestorePicker(); }});
    this.settingsTab = new SidebarSettings(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.app.workspace.onLayoutReady(() => {
      if (!this.alive) return;
      try {
        this.disposeAdapter = this.adapter.install({
          addColumn: target => { void this.report(this.operations.addColumn(target)); },
          split: target => { void this.report(this.operations.split(target)); },
          collapse: target => { void this.report(this.operations.collapse(target)); }
        });
      } catch (error) { new Notice("Sidebar Columns is unavailable: " + errorMessage(error), 12000); }
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      if (this.alive) this.adapter.onLayoutChange();
    }));
  }

  onunload(): void {
    this.lifecycle++;
    this.alive = false;
    this.settingsTab = undefined;
    this.operations?.dispose();
    for (const modal of [...this.modals]) modal.close();
    this.modals.clear();
    this.disposeAdapter?.();
    this.adapter?.expandAll();
  }

  private async command(kind: "addColumn" | "split" | "collapse"): Promise<void> {
    try {
      const target = this.adapter.resolveCommandTarget();
      if (kind === "split" && this.adapter.nativeSplitAvailable(target)) {
        new Notice("Obsidian provides native sidebar splitting here. Use its built-in split action.");
        return;
      }
      await this.report(kind === "addColumn" ? this.operations.addColumn(target) : kind === "split" ? this.operations.split(target) : this.operations.collapse(target));
    } catch (error) { new Notice(errorMessage(error), 8000); }
  }

  async report(pending: Promise<OperationResult>): Promise<void> {
    try {
      const result = await pending;
      if (this.alive && result.status !== "cancelled") new Notice(result.message, result.status === "success" ? 4000 : 10000);
    } catch (error) { if (this.alive) new Notice(errorMessage(error), 10000); }
  }

  async checkCompatibility(): Promise<boolean> {
    if (!this.alive) return false;
    this.adapter.assertCompatible();
    if (apiVersion === TESTED_VERSION || this.settings.versionOverrides.includes(apiVersion)) return true;
    if (!/^\d+\.\d+\.\d+$/.test(apiVersion)) throw new Error("Cannot identify this Obsidian version. Leave the workspace unchanged and check for a compatible Sidebar Columns update.");
    const accepted = await this.confirm("Untested Obsidian version", [
      "Sidebar Columns has an initial compatibility baseline of Obsidian " + TESTED_VERSION + ". You are running " + apiVersion + ".",
      "The plugin uses guarded undocumented menu and layout internals. Structural checks cannot prove visual or runtime compatibility. Check for native sidebar columns before overriding.",
      "This override applies only to " + apiVersion + "; required backups and all structural guards remain in force."
    ], "Allow experimental use on " + apiVersion);
    if (!accepted || !this.alive) return false;
    const previous = [...this.settings.versionOverrides];
    this.settings.versionOverrides.push(apiVersion);
    try { await this.saveData(this.settings); }
    catch (error) { this.settings.versionOverrides = previous; throw error; }
    this.settingsTab?.update();
    return true;
  }

  async openRestorePicker(): Promise<void> {
    if (!this.alive) return;
    try {
      const snapshots = await this.backups.list();
      if (!this.alive) return;
      if (!snapshots.length) { new Notice("No valid layout backups are available."); return; }
      const picker = new BackupPicker(this.app, snapshots, snapshot => { void this.report(this.operations.restore(snapshot)); }, modal => this.modals.delete(modal));
      this.modals.add(picker);
      picker.open();
    } catch (error) { if (this.alive) new Notice("Cannot read layout backups: " + errorMessage(error), 10000); }
  }

  confirm(title: string, paragraphs: string[], acceptLabel: string): Promise<boolean> {
    if (!this.alive) return Promise.resolve(false);
    return new Promise(resolve => {
      const modal = new ChoiceModal(this.app, title, paragraphs, acceptLabel, answer => {
        this.modals.delete(modal);
        resolve(answer && this.alive);
      });
      this.modals.add(modal);
      modal.open();
    });
  }

  private async applyFullLayout(layout: RawLayout): Promise<void> {
    this.adapter.expandAll();
    await this.app.workspace.changeLayout(layout);
    validateLayout(this.app.workspace.getLayout());
    this.app.workspace.requestSaveLayout();
  }

  async clearOverrides(): Promise<void> {
    const previous = [...this.settings.versionOverrides];
    this.settings.versionOverrides = [];
    try { await this.saveData(this.settings); }
    catch (error) { this.settings.versionOverrides = previous; throw error; }
    this.settingsTab?.update();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The operation failed. Your layout has not been automatically restored.";
}

class ChoiceModal extends Modal {
  private answer = false;
  private settled = false;
  constructor(app: App, private title: string, private paragraphs: string[], private acceptLabel: string, private complete: (answer: boolean) => void) { super(app); }
  onOpen(): void {
    this.setTitle(this.title);
    for (const paragraph of this.paragraphs) this.contentEl.createEl("p", {text: paragraph});
    const buttons = new Setting(this.contentEl);
    buttons.addButton(button => button.setButtonText("Cancel").onClick(() => this.close()));
    buttons.addButton(button => button.setButtonText(this.acceptLabel).setCta().onClick(() => { this.answer = true; this.close(); }));
  }
  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) { this.settled = true; this.complete(this.answer); }
  }
}

class BackupPicker extends SuggestModal<Snapshot> {
  constructor(app: App, private snapshots: Snapshot[], private choose: (snapshot: Snapshot) => void, private closed: (modal: Modal) => void) {
    super(app); this.setPlaceholder("Choose a full-workspace layout backup");
  }
  getSuggestions(query: string): Snapshot[] {
    return this.snapshots.filter(snapshot => this.label(snapshot).toLowerCase().includes(query.toLowerCase()));
  }
  renderSuggestion(snapshot: Snapshot, element: HTMLElement): void { element.setText(this.label(snapshot)); }
  onChooseSuggestion(snapshot: Snapshot): void { this.choose(snapshot); }
  onClose(): void { this.closed(this); }
  private label(snapshot: Snapshot): string { return (snapshot.baseline ? "Protected baseline · " : "") + snapshot.timestamp + " · " + snapshot.reason; }
}

class SidebarSettings extends PluginSettingTab {
  constructor(app: App, private owner: SidebarColumns) { super(app, owner); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: "group",
      heading: "Sidebar columns",
      items: [
        {
          name: "Experimental sidebar columns",
          desc: EXPLANATION,
          aliases: ["warning", "unsupported layouts", "visual risks"]
        },
        {
          name: "Compatibility and consent",
          desc: "Initial compatibility baseline: " + TESTED_VERSION + ". Current version: " + apiVersion + ". Experimental acknowledgement: " + (this.owner.settings.acknowledged ? "saved" : "required before the first change") + ".",
          aliases: ["Obsidian version", "experimental acknowledgement"]
        },
        {
          name: "Session-only column collapse",
          desc: "Each native column can fold into a 32px expand rail. Tabs stay loaded. Restarting, native drag/resizing, workspace replacement or disabling the plugin expands folded columns.",
          aliases: ["expand all columns", "fold", "rail"],
          render: setting => {
            setting.addButton(button => button.setButtonText("Expand all columns").onClick(() => this.owner.adapter.expandAll()));
          }
        },
        {
          name: "Layout backups",
          desc: "Protected baseline and five recent snapshots in " + this.app.vault.configDir + "/sidebar-columns-backups/. Raw .workspace.json files are suitable for documented manual recovery; .metadata.json files are not. Restoring replaces the full workspace and requires confirmation.",
          aliases: ["restore full workspace", "recovery", "snapshots"],
          render: setting => {
            setting.addButton(button => button.setButtonText("Restore full workspace...").onClick(() => { void this.owner.openRestorePicker(); }));
          }
        },
        {
          name: "Untested-version overrides",
          desc: this.owner.settings.versionOverrides.length ? this.owner.settings.versionOverrides.join(", ") : "None. Untested versions require an explicit per-version choice.",
          aliases: ["compatibility", "clear overrides"],
          render: setting => {
            setting.addButton(button => button.setButtonText("Clear overrides").onClick(() => {
              void this.owner.clearOverrides().catch(error => new Notice(errorMessage(error)));
            }));
          }
        },
        {
          name: "Plugin removal and recovery",
          desc: "Removing the plugin and reversing its native columns are separate actions. Existing columns can remain after removal. Backups contain layout information, not copies of notes."
        },
        {
          name: "Why sidebar splitting is experimental",
          desc: "Historical explanation of the deliberately disabled feature.",
          aliases: ["unsupported layouts", "Obsidian developer reasoning"],
          render: setting => {
            setting.descEl.createEl("a", {text: "Read the developer's explanation", href: "https://forum.obsidian.md/t/unable-to-perform-split-right-in-a-left-leaf/84130/4"});
          }
        }
      ]
    }];
  }
}
