# Native acceptance checklist

Use a fresh test vault and a separate Obsidian profile. Keep the personal vault out of the test session. The runtime harness copies only distributable Calendar and theme files; it does not copy their saved settings.

Run the harness after building with the documented Node runtime:

    node scripts/runtime-layout-controls.mjs --run --expected-build-hash <main.js SHA-256>

The layout-controls harness requires --run and an exact expected build hash before launching. Evidence is retained under .runtime-tests/<run-id>/; LAYOUT-CONTROLS-TEST-RESULTS.md identifies the v0.1.2 acceptance runs. Earlier full-column and review-fix drivers retain their historical results. Run the harness from a host context that permits writing the external project, launching Obsidian and connecting to its loopback debugging endpoint.

## Functional acceptance

| Scenario | Required observation |
| --- | --- |
| Consent | Cancel leaves native tabs unchanged. Enable acknowledges the unsupported-sidebar warning and performs only the requested operation. |
| Commands with central focus | Executing a sidebar command with central or ambiguous focus explains how to select a sidebar tab and makes no layout change. Focusing an eligible sidebar allows the action. |
| Inactive context-menu tab | Keep a central tab or another sidebar tab active; open a different sidebar tab's header menu and split it. The menu's tab receives the split. |
| Native split fallback | With the built-in sidebar Split right disabled, the plugin exposes its own action. When native support is available, the plugin does not duplicate it. |
| Full-height default | From a sidebar containing stacked Files/Search or Outline/Backlinks, add a whole column. All original rows remain together and the new column spans their complete content height. Add a third column beside the selected complete column. |
| Secondary row action | Split only one group within a full-height column. Other stacked rows retain their width and position; the top-level full-height columns stay intact. |
| Two above one | Add a full-width bottom row below two upper columns; it spans both columns on left/right sidebars and in RTL. Repeated appends preserve relative prior row heights and nested column widths. |
| Header controls | Each outer column has one collapse icon in its top native tab bar; the wide bottom row has none. Cancel/failed backups keep layout unchanged, the last open column stays expanded, and rail expansion returns keyboard focus. |
| Left/right layout | Create two, three and four columns on each side. Keep multiple native tab groups stacked inside at least one column. |
| Stateful third-party view | Put Calendar beside core panels; interact with it, move its tab and split around it. Existing view instances and state remain usable. |
| Native tab dragging | Move tabs within a column, between columns, between sidebars and the center. No hidden leaf, duplicated panel or unreachable tab remains. |
| Divider resizing | Drag each internal native divider and the outer sidebar boundary. Adjacent columns resize correctly without breaking stacked groups. |
| Focus | Focus each column and its tabs. Commands operate on the focused eligible group. Clicking a restore rail returns keyboard focus to the restored column. |
| Collapse | Hide one whole column including its stacked rows and nested row splits behind its rail, expand it, and hide several columns. The last visible column remains open. Native leaves persist throughout. |
| Sidebar toggles | Close/reopen both sidebars repeatedly with collapsed columns and ordinary columns. Check collapse buttons, headers, title bar and ribbon. |
| Backup | Each topology-changing operation creates the required backup before mutation. Failed backup creation leaves topology unchanged. |
| Restore | Restore a known backup through the actual modal. Verify stored sidebar tab order, persisted view state, center tabs and geometry. Full restore recreates views; transient input/cursor state not contained in the snapshot may be lost. Cancel makes no change. |
| Invalid restore | Reject corrupt or incompatible backups with a clear error; do not partially replace the workspace. |
| Popout | Create a native popout. Commands outside the main sidebar explain the target requirement and do not change layout; sidebar menu actions are not added to foreign roots. Global layout backup/restore follows the documented popout guard. |
| Workspaces | Save two different layouts with the core Workspaces plugin and switch repeatedly. Session collapse rails clear/reconcile correctly. |
| Disable/update | Disable and re-enable Sidebar Columns. The plugin removes its listeners, menu hooks, styling and rails, and keeps native leaves intact. |
| Restart | Close only the isolated instance and restart the same isolated profile. Native sidebar topology survives; session-only collapse state clears. |

## Presentation acceptance

Check default light/dark themes plus the copied versions of Minimal, Blue Topaz and AnuPpuccin. Compare narrow and wide windows at 100%, 125% and 150% scaling. Verify that tabs, status control, focus indicators, native dividers and collapse rails stay reachable. Geometry assertions alone do not establish usability.

Test an actual RTL Obsidian language, not only a CSS direction attribute. On 1.14.4 the workspace itself flips, so side-specific actions must follow the documented visual-side behavior.

On macOS, test all applicable window-frame/ribbon settings and collapse/reopen cycles. In particular verify that traffic lights do not overlap sidebar icons and the sidebar-collapse control does not move into the center. On Linux, test supported window manager/theme combinations.

## Recording results

For every scenario record the runtime and installer versions, operating system, theme version, fixture setup, actual action, observation and supporting screenshot/tree snapshot. Mark each scenario Passed, Failed or Not run. Do not infer macOS/Linux, pointer interactions, popout behavior or full theme compatibility from mock tests or screenshots of another scenario.

The unsupported native sidebar configuration and internal API usage must remain explicit in release documentation. Repeat focused native acceptance whenever the tested Obsidian version changes.


For actual Arabic RTL acceptance: `pnpm test:runtime --rtl`. The isolated renderer preference is changed through its own local storage/native IPC and reloaded; no production language preference is changed.
