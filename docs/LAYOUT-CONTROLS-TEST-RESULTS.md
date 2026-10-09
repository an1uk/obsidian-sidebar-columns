# v0.1.2 layout-control native acceptance

The final v0.1.2 build passed **21/21 English LTR cases and 22/22 actual Arabic RTL cases** on 9 October 2026. Both runs exercised the real native sidebar tree in fresh isolated profiles.

Create two full-height columns, then choose **Add full-width bottom row (experimental)** to form a T layout. The top header icons collapse individual columns; the wide bottom rows have no column icon.

## Tested artifacts and environment

| Artifact | SHA-256 |
| --- | --- |
| main.js | `9f90512ab41dbe008d3c1f9593561c573e3db5b677d13e35ef79a72011f649aa` |
| styles.css | `fed62319641ab74ac5bab2946d74ec17a4776b396da7bad48e2465ead5b594f9` |
| manifest.json | `94f36d3670216074ad298c05668e03c37b3946f4bb580f189145c2e192eb62eb` |
| Installable ZIP, 98,201 bytes | `0bbc996afd6b62fb35ce134dd3333a9b3cb8b563f1159de928913a2451c4fb24` |

Obsidian renderer **1.14.4**, installer **1.12.7**; Microsoft Windows 11 Home Insider Preview **25H2, build 26220.9587**, 64-bit. The default theme and copied Minimal **9.1.4**, Blue Topaz **2026081501**, and AnuPpuccin **1.5.0** assets used clean fixture settings. Calendar **1.5.10** was loaded as a fixture asset; this run did not interact with its view.

The release preflight passed strict TypeScript, 120 automated tests, official plugin ESLint with zero warnings, production build, packaging and artifact metadata checks. These local checks do not establish release-workflow or attestation completion.

## Final native results

| Scenario | LTR | Arabic RTL |
| --- | --- | --- |
| Bottom-row consent Cancel preserves the original native layout and creates no backup | passed | passed |
| Two full-height columns on each sidebar have four reachable native header controls | passed | passed |
| Physical rightmost columns collapse and reopen through real pointer clicks on reachable rails | passed | passed |
| Direct icon consent Cancel preserves tree, dimensions and backup count | passed | passed |
| Injected backup-write failure from the direct icon preserves views, rows and dimensions | passed | passed |
| Inactive Search menu and right-side command create native T layouts with full-width bottom rows | passed | passed |
| Secondary Files row splitting stays within its top column and keeps bottom rows full width | passed | passed |
| Native row-divider gestures resize both sidebars; repeated append preserves 60/40 weights as 30/20/50 | passed | passed |
| Native top-column divider gesture retains full-width bottom rows | passed | passed |
| Direct icon collapses the whole top branch including stacked rows; last open sibling is disabled | passed | passed |
| Enter on the focused expand rail restores the selected lower Search pane | passed with preceding case | passed with preceding case |
| First real sidebar Bookmarks drag into a wide bottom row expands folds and preserves the loaded view object | passed | passed |
| Native whole-sidebar close/reopen restores controls after animation without an unrelated tab action | passed | passed |
| Saved native proportions and T topology survive a guarded restart; folds restart expanded | passed | passed |
| Minimal stylesheet hash, T geometry, all four control hit points and direct collapse | passed | passed |
| Blue Topaz stylesheet hash, T geometry, all four control hit points and direct collapse | passed | passed |
| AnuPpuccin stylesheet hash, T geometry, all four control hit points and direct collapse | passed | passed |
| 125% and 150% zoom preserve T geometry and all four control hit points | passed | passed |
| Narrow-window topology survives; closing a whole sidebar or widening recovers the center | passed | passed |
| Native detach of an empty-column leaf removes the stale control and preserves remaining original views | passed | passed |
| Disable expands folds and removes owned controls/rails; reload retains rows without duplicates | passed | passed |
| Three genuine full-height columns on both sides preserve current views and expose six reachable controls | passed | passed |

The keyboard restore assertion shares its collapse scenario, giving 21 LTR cases. RTL includes one additional guard confirming Arabic text and actual RTL workspace direction before interaction, giving 22 cases. Control checks use `elementFromPoint` before pointer dispatch. Transient native notices expire before reachability measurements.

Each final run launched twice, including its restart: **four guarded launches, all owned processes closed, zero captured renderer errors**. Native IPC verified the isolated resources, renderer version and fixture vault before trust or interaction. Production configuration/protocol content and fixture-note hashes remained unchanged. Native objects were compared within a renderer; persistent IDs and layout were checked across restart, then new native references were captured.

## Evidence and reproduction

Run [the dedicated harness](../scripts/runtime-layout-controls.mjs) with `pnpm test:layout-controls --expected-build-hash <main.js SHA-256>`; add `--rtl` for Arabic RTL. Provide the read-only asset source through `SIDEBAR_COLUMNS_SOURCE_VAULT`. No production session, global CLI forwarding or URI forwarding is used.

Ignored local evidence contains raw case details, tree/dimension snapshots, exact header order and styles, native identity checks and screenshots:

- LTR: `.runtime-tests/layout-controls-2026-10-09T01-03-39-359Z-ff476097`.
- Arabic RTL: `.runtime-tests/layout-controls-2026-10-09T01-05-17-577Z-0fb75dc3`.
- Review images in each run: `evidence/controls-02-both-native-T.png`, `controls-06-T-with-rail.png`, `controls-13-right-edge-rail.png`, and `controls-14-three-columns.png`.

Pre-release acceptance found and fixed three control issues: a right-column icon beneath native Close, an edge expand rail beneath native Close, and an AnuPpuccin RTL icon packed beneath native Minimize when the theme hid native spacers. Their excluded evidence remains under runs `00-44-48-279Z-4b6d1914`, `00-54-54-426Z-f75f1b42`, and `00-49-50-223Z-d67fcc98` respectively, all with the `layout-controls-2026-10-09T` prefix. A private fixture-only margin proof (`00-57-18-727Z-2212e7e6`) established the AnuPpuccin remedy; final acceptance uses the unmodified production build.

Earlier excluded fixtures also needed divider hit-point correction, Bookmarks view capture after native deferred hydration, and notice clearance before rail hit testing. Complete prior logs remain private; they are not counted as final passes.

## Acceptance limits

- Native acceptance covers the stated Windows renderer/installer only; macOS, Linux and other app versions were not run.
- An earlier Arabic RTL fixture exposed a native nested tab header behind the window controls at the physical right edge of a 1600×1000 logical window with 440px sidebars. Pointer dragging from that particular header was inaccessible. The final drag used the visible Bookmarks header; all tested plugin collapse and expand controls are reachable. Native tab-header reachability in every layout is not established.
- At 900px with both wide outer sidebars open, the native center can have zero width. Closing a whole sidebar or widening restores it.
- Arbitrary external file drops, pop-outs, core Workspaces/full-workspace restoration and Calendar interaction were not rerun for this patch. [Earlier full-column evidence](FULL-COLUMN-TEST-RESULTS.md) and [v0.1.1 evidence](REVIEW-FIX-TEST-RESULTS.md) retain their original build scopes.
- Theme results apply to the exact copied stylesheets with clean settings; other custom CSS and plugin combinations were not accepted.
