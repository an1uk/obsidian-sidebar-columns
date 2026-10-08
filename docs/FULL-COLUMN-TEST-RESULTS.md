# Full-height columns: native acceptance

Final bundle SHA-256: `de5cff62e9475dd58d6374f2f58da44e07cc68047c7962cafa3a3f296c54c329`.

English LTR: **25/25 passed**. Actual Arabic RTL: **26/26 passed**. Each run used a fresh guarded vault/profile and two owned launches, including a real restart. No fixture shim changed plugin behavior in these final runs.

Environment: Microsoft Windows 11 Home Insider Preview 25H2, build **26220.9587**, 64-bit; Obsidian renderer **1.14.4**, installer **1.12.7**. Theme assets: default, Minimal **9.1.4**, Blue Topaz **2026081501**, AnuPpuccin **1.5.0**. Calendar **1.5.10**. Only distributable assets were copied; fixture settings were clean.

| Scenario | English LTR | Arabic RTL |
| --- | --- | --- |
| Actual Arabic language and RTL workspace direction | Not applicable | Passed |
| Central command guidance; consent Cancel preserves layout | Passed | Passed |
| Whole second/third columns on both sidebars; stacked rows preserved | Passed | Passed |
| Physical-right insertion and native empty sibling | Passed | Passed |
| Inactive Search and Calendar primary header menus | Passed | Passed |
| Secondary Files row splitting inside its whole column | Passed | Passed |
| Original native objects, IDs and loaded views preserved | Passed | Passed |
| Whole stacked/nested branches fold to 32px; contents hidden and inert | Passed | Passed |
| Stored dimensions preserved; ordinary sibling click retains folds | Passed | Passed |
| Keyboard Enter expands the focused rail | Passed | Passed |
| Native divider press expands rails; actual pointer drag resizes | Passed | Passed |
| First sidebar-origin and central-origin native tab drags | Passed | Passed |
| Real drag data created before reflow; capture entry expands before native target/drop | Passed | Passed |
| Native central split remains functional | Passed | Passed |
| Core Workspaces restores full columns and mixed rows | Passed | Passed |
| Checksum-validated raw backup and confirmed full-workspace restore | Passed | Passed |
| Disable/re-enable removes presentation and preserves columns | Passed | Passed |
| Saved native proportions exclude rail widths; restart begins expanded | Passed | Passed |
| Three copied theme stylesheets applied and column geometry retained | Passed | Passed |
| 125% and 150% scaling retain full-height geometry | Passed | Passed |
| Closing/reopening outer sidebars preserves native topology | Passed | Passed |
| Narrow-window limit recovers by closing a sidebar or widening | Passed | Passed |

Supplemental native checks on the same bundle: `WorkspaceLeaf.detach()` removed an operation-owned empty group; surviving original leaves/views remained the same objects, and the saved layout reloaded through Core Workspaces. A trusted CDP external-format drag entry reached document capture with zero folded branches before native target handlers. These checks used native API closing and CDP input; no pointer close-button or real external-file import is claimed.

Chromium rejected the unrecognized fixture MIME before emitting `drop`. Arbitrary external-file and direct-drop native acceptance remain **not run**. The direct-drop implementation has automated regression coverage; actual native tab drop passed in both full runs. The supplemental session closed cleanly; a separate trusted native drag-cancel event was not established.

All owned processes closed. Production configuration/protocol content and fixture-note hashes were unchanged. LTR captured zero renderer errors. RTL captured one Obsidian-core console error reading `appearance.json` during fixture theme/settings writes; every stylesheet hash and scenario check passed, and the final file parses correctly with default `cssTheme`.

Local ignored evidence:

- LTR: `.runtime-tests/full-columns-2026-10-08T17-40-04-594Z-477dae19`.
- RTL: `.runtime-tests/full-columns-2026-10-08T17-46-37-462Z-c0146abd`.
- Native group close and external entry: `.runtime-tests/full-columns-2026-10-08T17-53-34-566Z-58f3d7d5`. Its original fixture report retains the rejected-drop assertion; the observed entry and close facts above come from its recorded events and detail.

## Discoveries and fixture corrections

The implementation was corrected for the left sidedock's vault-profile footer and Chromium's first-drag cancellation when source headers moved during drag creation. The final build compares the original native content area and expands folds in capture-phase target events after Chrome owns the drag data. The temporary source-grounded proof is retained at `.runtime-tests/full-columns-2026-10-08T17-34-54-732Z-e9180695`; the final full runs use the production correction without that shim.

Harness corrections supplied the real Enter character, accepted verified owned-process exit when CDP shutdown lacked acknowledgement, hit-tested Arabic headers rather than overlapping sidebar toggles, and allowed core backlink/outline context to follow focus while still checking topology, Markdown files and exact native dimensions. The supplemental leaf iterator returns void so Obsidian does not stop traversal early. Earlier private attempts remain preserved; they are not final acceptance claims.

## Acceptance limits

- At a 900px window width with both 440px sidebars open, the native central editor can be hidden. Closing a whole sidebar or widening restores it.
- Theme results establish loaded assets and column geometry, not exhaustive visual acceptance of every theme setting.
- macOS/Linux, newer installers, other renderer versions and arbitrary third-party panels were not tested.
- [Recovery acceptance](RECOVERY-TEST-RESULTS.md) and [Core Workspaces/pop-out acceptance](WORKSPACES-TEST-RESULTS.md) record their separate final-bundle checks.
