# Verification results

Sidebar Columns 0.1.0 acceptance recorded on 8 October 2026 before initial GitHub publication. Tests used isolated fixture vaults. These results do not imply community-directory approval.

## Build and automated checks

- Node 24.19.0; pnpm 11.25.0. Frozen-lockfile install, strict TypeScript, production build and ZIP packaging passed.
- Automated tests: **83 passed, 0 failed, 0 skipped**.
- Final main.js SHA-256: `de5cff62e9475dd58d6374f2f58da44e07cc68047c7962cafa3a3f296c54c329`.
- ZIP contains exactly sidebar-columns/manifest.json, sidebar-columns/main.js and sidebar-columns/styles.css.

## Full-height action acceptance

The primary action now creates a full-height column; local row splitting is secondary. See [full-height runtime results](FULL-COLUMN-TEST-RESULTS.md) for acceptance of the final bundle above. The historical tables below cover the earlier row-splitting implementation and shared recovery/hooks on bundle `8b78b5ee0cea4adda34c29b6f50c195d03ecb6e1c8cdfa20ec032f6fdefff904`; they are retained as foundation evidence, not presented as final full-height acceptance.

## Earlier row-split runtime acceptance

Windows 11 Home Insider Preview 25H2, 64-bit, OS build 26220.9587. Renderer 1.14.4 on installer 1.12.7.
Earlier row-split interaction run: `2026-10-08T16-03-20-931Z-33ea1a84`; actual Arabic RTL workspace and native pointer/drag inputs were exercised.
Core panels: File explorer, Search, Outline and Backlinks. Calendar 1.5.10. Theme stylesheet hashes were checked against the staged assets.
Theme geometry smoke checks: default, Minimal 9.1.4, Blue Topaz 2026081501, AnuPpuccin 1.5.0. This does not establish every theme option or visual interaction.

| Scenario | Actual result |
| --- | --- |
| Actual Arabic RTL workspace boots and flips | passed |
| Central focus explains sidebar target without mutation | passed |
| Consent Cancel preserves native sidebar structure | passed |
| Consent Enable permits a native left column split | passed |
| Left sidebar supports three and four visible columns | passed |
| Right sidebar splits independently | passed |
| Original native leaves, groups and central editors survive splits | passed |
| Collapse preserves native views; Expand all restores columns | passed |
| Sidebar close/reopen preserves split structure | passed |
| Minimal theme displays distinct sidebar columns | passed |
| Blue Topaz theme displays distinct sidebar columns | passed |
| AnuPpuccin theme displays distinct sidebar columns | passed |
| Default theme restores after community theme checks | passed |
| 125 and 150 percent scaling retain sidebar columns | passed |
| Inactive native header menu: file-backed Markdown | passed |
| Inactive native header menu: core Search panel | passed |
| Inactive native header menu: Calendar panel | passed |
| Collapse rail is 32px and native proportions remain unchanged | passed |
| Native pointer divider drag changes column width | passed |
| Native tab drag moves a sidebar Markdown tab and clears collapse rails | passed |
| 900px window retains a usable central editor | failed |

## Observed narrow-window limitation

The usable-center assertion failed: at a 900px window, both 440px sidebars remained open and the native center measured 0px. The workspace tree stayed valid. This is an observed native width constraint, not a lost-tab or note-corruption result.
Widening to 1600px restored a 676px center; closing the whole right sidebar restored 416px. Both recovery paths were exercised. The runtime harness keeps this visibility assertion as a failure and therefore exits nonzero for this known limit.

## Final recovery, Workspaces and pop-outs

- [Recovery acceptance](RECOVERY-TEST-RESULTS.md): **7 passed**; actual restore Cancel/Confirm, protected baseline/checksum, pre-restore backup, disable/re-enable cleanup, restart, offline raw recovery and default rebuilding.
- [Workspaces/pop-out acceptance](WORKSPACES-TEST-RESULTS.md): **4 passed**; native central splitting, core Workspaces save/load, floating backup validation and actionable pop-out command rejection.
- These separate suites ran on the final bundle above; production configuration/protocol guards were unchanged and owned test processes were confirmed closed. Recovery and Workspaces suites captured zero renderer errors. The full-height results separately record the RTL fixture’s core appearance-file read error.

## Acceptance limits

macOS/Linux, other runtime/installer versions, exhaustive theme permutations, Properties panel acceptance, every keyboard/screen-reader flow and full-workspace restoration with an open floating window remain unverified. Pop-out sidebar splitting is outside v0.1.
Native empty-group removal was exercised through WorkspaceLeaf.detach(), with surviving views and a reloadable layout verified. Pointer-driven close buttons, arbitrary external-file drops and every cross-window drag permutation remain on the [manual checklist](MANUAL-TESTS.md).
Mock tests and builds were not treated as runtime proof. Earlier fixture failures (a central close-button misclick, wrong leaf resize handle, unfocused Notice document) were corrected in the harness; their original evidence is retained.

Earlier row-split evidence: `.runtime-tests/2026-10-08T16-03-20-931Z-33ea1a84`, plus the separate recovery and Workspaces evidence directories linked in their reports.
Native snapshots and personal production-content hashes are local evidence and are excluded from the installable ZIP.
