# Sidebar Columns

Experimental native columns for the actual left and right Obsidian sidebars. Desktop only. Version 0.1.0.

**This reintroduces a deliberately disabled, unsupported layout arrangement.** Sidebar column splitting became accessible when central-workspace tab-management code was reused for sidebar tabs. Obsidian intentionally removed the sidebar “Split right” action in [1.6.4 on 20 June 2024](https://obsidian.md/changelog/2024-06-20-desktop-v1.6.4/). [WhiteNoise’s explanation](https://forum.obsidian.md/t/unable-to-perform-split-right-in-a-left-leaf/84130/4) states that multiple sidebar columns were never officially supported or considered when designing themes and interactions.

The underlying layout engine and official support are separate questions. A [later community example](https://forum.obsidian.md/t/sidebar-split-right-vertical/106053) demonstrated manually nested sidebar splits on 1.9.12. That is evidence for that workaround and version, not a guarantee for later releases.

## Risks and compatibility

[Historical reports](https://forum.obsidian.md/t/visual-bugs-when-splitting-sidebar-vertically/83247) describe overlapping macOS window controls and displaced sidebar controls. Those reports do not establish the same defects on Windows.

Potential risks include theme incompatibilities, awkward resizing or drag/drop, panels expecting a single-column sidebar, focus problems, and layouts failing to restore after updates or workspace changes. There is no established claim here that columns corrupt or delete notes, and there is no promise of zero risk or universal compatibility.

An observed width limit in the isolated 1.14.4 test: a 900px window with both sidebars set to 440px squeezed the central workspace to zero usable width while its native tree stayed valid. Widening to 1600px restored the center. Widen the window, reduce sidebar widths, or use a native whole-sidebar toggle to recover; the plugin does not automatically change your layout to compensate.

The initial compatibility baseline is **Obsidian 1.14.4**. Other versions require an explicit override saved separately for each exact version. Runtime shape checks and backups remain mandatory after an override. The plugin avoids its custom split action when native sidebar splitting can reliably be detected for the actual focused target.

Read [full-height column acceptance](docs/FULL-COLUMN-TEST-RESULTS.md) and [test results](docs/TEST-RESULTS.md) for the renderer, installer, OS, themes and limitations tested. A typecheck, mocked test or extracted native fixture is not live Obsidian acceptance. macOS and Linux are unverified unless that results document explicitly says otherwise. Pop-out sidebar support is outside v0.1; main-window target guards reject pop-out leaves.

## Install

1. Start in a disposable test vault and preserve your current workspace.
2. Download [sidebar-columns-0.1.0.zip](https://github.com/an1uk/obsidian-sidebar-columns/releases/download/0.1.0/sidebar-columns-0.1.0.zip) from the [experimental 0.1.0 release](https://github.com/an1uk/obsidian-sidebar-columns/releases/tag/0.1.0), or build locally.
3. Extract its `sidebar-columns` folder into `<vault configuration directory>/plugins/`. The default configuration directory is `.obsidian`; use the actual directory if you changed it.
4. The folder contains `main.js`, `manifest.json` and `styles.css`.
5. Enable Sidebar Columns in Community plugins. Its first layout change asks for experimental consent and writes a protected layout baseline.

Installation does not itself create columns. GitHub releases are experimental prereleases. The plugin has not been submitted to or accepted by the official community directory.

## Use

Right-click an actual sidebar tab and choose **Add full-height column (experimental)**. A new **empty native column** appears visually to the right of the complete column containing that tab, including in RTL layouts. On a sidebar with stacked panels, the original rows stay together in one full-height column. Repeating the action adds another whole column. Existing views stay loaded and are not cloned. Drag existing tabs into the new column.

The secondary action **Split this row right (experimental)** divides only the clicked tab group into side-by-side groups. Use it to arrange panels within one row of a column. Whole columns can contain stacked rows and nested row splits.

Palette commands are **Add full-height sidebar column (experimental)** and **Split focused sidebar row right (experimental)**. Select a sidebar tab first. Central, hidden, ambiguous and pop-out targets produce an explanation without a layout change. A tab menu targets the clicked tab even if another tab or the central editor has focus.

To collapse a column, right-click one of its tabs and choose **Collapse this column (experimental)**, or use the equivalent focused-column command. All stacked rows and nested row splits in that whole column fold into a **32px expand rail**. In older layouts containing only row splits, collapse targets the local column branch. Views stay loaded, including transient plugin input. Use the rail’s keyboard-accessible button or **Expand all sidebar columns** to reopen it. At least one sibling column remains open.

Collapse is session-only. Native resizing, drag/drop, splitting, restoration, workspace replacement and disabling the plugin expand folded columns before native geometry is measured. Ordinary clicks on another tab leave folds in place. Restarting starts expanded; rail widths are never intentionally saved as native column dimensions.

If an update’s hooks cannot safely support collapse, collapse is declined with an explanation rather than changing layout data.

## Backups and restore

The plugin uses `vault.configDir` and keeps backups in:

`<vault configuration directory>/sidebar-columns-backups/`

The first successful snapshot is a protected, timestamped baseline. Five recent pre-operation snapshots are retained separately. Every required snapshot is validated, written, read back and checked before layout mutation. A required backup failure blocks the operation.

Each snapshot has two separate files:

| File | Purpose |
| --- | --- |
| `baseline-<timestamp>-<random>.workspace.json` or `snapshot-<timestamp>-<random>.workspace.json` | Raw native workspace layout suitable for manual desktop recovery |
| Matching `.metadata.json` | Timestamp, baseline flag, version, reason and SHA-256 integrity metadata; **not** a workspace replacement |

Snapshots may include private file paths and plugin state. The plugin writes them locally and never uploads or logs their contents. Your existing vault sync or backup software may copy this directory. They are **not backups of notes or unsaved plugin input**. Corrupt or incomplete backup records block further changes and rotation, protecting the original baseline; preserve the directory for review.

Use **Restore full workspace from a layout backup** or the settings button. Restoration validates the selected backup, asks for confirmation, writes a pre-restore snapshot, then applies the full layout. It can replace both sidebars, central tabs and pop-out layouts and discard transient view state. v0.1 does not claim to restore one sidebar while preserving the other views’ transient state. A failed restore never automatically applies another old full-workspace snapshot.

## Offline recovery

Use this when the plugin or a saved layout will not load:

1. Close Obsidian fully, including pop-out windows. Do not rewrite workspace files while it is running.
2. Preserve the current `<configuration directory>/workspace.json`, the backup directory and, if changing plugin enablement, `community-plugins.json`.
3. Select a raw `.workspace.json` snapshot from `sidebar-columns-backups`. Prefer the protected baseline to undo all plugin-created columns. Verify that it is a native object containing `main`, `left` and `right`; where possible, verify its SHA-256 against the matching metadata.
4. Copy that **raw layout file** over `<configuration directory>/workspace.json`. Never copy `.metadata.json` over the workspace file.
5. To stop the plugin loading, remove only `"sidebar-columns"` from the preserved copy of `community-plugins.json`, keeping valid JSON. Alternatively, move the plugin’s folder out of `plugins` while Obsidian is closed. Neither operation deletes notes.
6. Restart Obsidian and inspect the recovered layout.

If the old snapshot is itself incompatible, close Obsidian, preserve/rename `workspace.json` out of the way, disable this plugin, and restart so Obsidian rebuilds its default workspace. Keep the old files for reference and manually reopen panels. Consult the results document for the isolated recovery checks actually completed.

## Disable or remove

Disable through Community plugins. Commands, listeners, menu hooks and plugin-owned fold rails are removed. Folded columns expand in place, but native columns are not flattened and no old workspace is automatically restored.

Removing the plugin and reversing its native layout changes are separate actions. Existing columns may remain if Obsidian continues to load that layout. Backups are outside the plugin folder so removal does not discard them. Restore an explicit backup when you want to reverse the arrangement.

## Build and verify

Node 24 or later; pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm package
```

The Obsidian 1.14.4 API definitions are pinned to official source commit `9abd9605ce081383674aae1ed111c456edde0688`. That API version was not available on npm at implementation time (npm’s latest was 1.13.1), so the lockfile uses the official source archive without substituting older definitions. Only esbuild’s required dependency setup script is allowed.

`pnpm package` writes `dist/sidebar-columns-0.1.0.zip` and checksums. The ZIP contains only the three distributable plugin files, inside `sidebar-columns/`; it contains no notes, credentials, test profiles or workspace backups.

Runtime acceptance harnesses are Windows-only developer tools. Set `SIDEBAR_COLUMNS_SOURCE_VAULT` to an explicit, read-only asset-source vault; the harness copies only distributable Calendar/theme files and hashes configuration content. It never copies notes or saved plugin settings. Set `SIDEBAR_COLUMNS_SOURCE_CONFIG_DIR` if that source vault uses a custom configuration directory. Optional `SIDEBAR_COLUMNS_OBSIDIAN_EXE` and `SIDEBAR_COLUMNS_ASAR` override the normal per-user Windows installation paths. These environment inputs are not needed to build or install the plugin.

`pnpm test:runtime` runs the isolated desktop acceptance harness when the installed executable and the 1.14.4 update archive are available. It uses a separate profile and fixture vault, validates isolation through native IPC before interactions, and records evidence. It does not use global Obsidian CLI or URI forwarding to control the working session. Its usable-center assertion returns nonzero for the documented 900px-window width limit; this is retained as an observed limitation, rather than reported as a pass. Use `pnpm test:runtime --rtl` for actual Arabic RTL acceptance.

Use `pnpm test:full-columns --expected-build-hash <main.js SHA-256>` for full-height default, secondary row splitting and whole-stack collapse acceptance. Use `pnpm test:recovery --expected-build-hash <main.js SHA-256>` for the separate guarded restore, restart and offline recovery harness. Use `pnpm test:workspaces --expected-build-hash <main.js SHA-256>` for core Workspaces, native central splitting and pop-out targeting acceptance.

See [full-height results](docs/FULL-COLUMN-TEST-RESULTS.md), [architecture](docs/ARCHITECTURE.md), [manual checklist](docs/MANUAL-TESTS.md), [interaction results](docs/TEST-RESULTS.md) and [recovery results](docs/RECOVERY-TEST-RESULTS.md) and [Workspaces/pop-out results](docs/WORKSPACES-TEST-RESULTS.md).

## Publication status and privacy

The name and ID were absent from the official directory when checked on 8 October 2026; this is not a reservation. Review the current [developer policies](https://docs.obsidian.md/community-directory/developer-policies), [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) and [submission workflow](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) before any future community-directory submission.

No telemetry, runtime network requests, external accounts, self-updating code or workspace uploads. Author: Alan ([an1uk](https://github.com/an1uk)). Source license: 0-BSD.
