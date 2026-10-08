# v0.1.1 review-fix verification

Plugin version: **0.1.1**. Exact tested `main.js` SHA-256: `09c621f7759607ae81d5848ba0b906677c0ec33f45c27e48c1cb6ad855b363ce`.

Focused native review checks: **5/5 passed**. Full English LTR plus review checks: **30/30 passed**. Actual Arabic RTL plus review checks: **31/31 passed**. These runs used the same frozen production build; no fixture shim changed plugin behavior.

Environment: Microsoft Windows 11 Home Insider Preview **25H2 build 26220.9587**, 64-bit; Obsidian renderer **1.14.4**, installer **1.12.7**. Default theme and clean copies of Minimal **9.1.4**, Blue Topaz **2026081501**, AnuPpuccin **1.5.0**; Calendar **1.5.10**.

## Native results

| Verified behavior | English LTR | Arabic RTL |
| --- | --- | --- |
| Full-height second/third columns on both sides; existing stacked rows and native views preserved | Passed | Passed |
| Physical-right insertion, inactive Search/Calendar menus and secondary row splitting | Passed | Passed |
| Native footer preserved; nested whole-column collapse is 32px, hidden and inert | Passed | Passed |
| Ordinary tab clicks retain folds; keyboard rail expansion works | Passed | Passed |
| Native divider resize and first sidebar/central-origin tab drags | Passed | Passed |
| Raw backup/checksum, confirmed full-workspace restoration and Core Workspaces restoration | Passed | Passed |
| Disable/re-enable, saved native proportions and real restart expanded | Passed | Passed |
| Three applied theme assets, 125/150% scaling and outer-sidebar reopen | Passed | Passed |
| Declarative settings heading, seven indexed definitions and actionable controls | Passed | Passed |
| Actual native settings search finds the overrides action | Passed | Passed |
| Native setDimension(current value) keeps the 32px inline rail without important priority | Passed | Passed |
| Settings Expand restores all six owned inline properties and the original native setter | Passed | Passed |
| Clear overrides persists, refreshes indexed/rendered text and calls update once/display zero times | Passed | Passed |
| Settings Restore opens the guarded backup chooser without applying a restore | Passed | Passed |

The five focused checks passed independently before the full suites. Obsidian opened Settings in a separate native window: its resources, renderer version, vault/profile identity and settings-document ownership were verified before input. Actual settings-window screenshots accompany the full runs.

All **five owned launches** closed. Every production configuration/protocol guard and fixture-note hash check remained unchanged. Captured renderer errors: **focused 0; LTR 0; RTL 0**.

## Local checks and release boundary

Root verification passed: **96 automated tests**, strict TypeScript check, frozen dependency installation, official Obsidian ESLint with **zero warnings**, and package/metadata/ZIP preflight. The native checks above concern the exact local production bundle.

These native results were recorded before tag publication. Release workflow execution and binary attestations are verified separately; the final provenance receipt is recorded in the GitHub release notes and linked workflow run. Native checks alone do not establish attestation or Obsidian-directory approval.

## Evidence and limits

Ignored local evidence:

- Focused: `.runtime-tests/review-fix-2026-10-08T19-27-29-743Z-a1e185ee`.
- Full LTR: `.runtime-tests/review-fix-2026-10-08T19-28-43-743Z-42631f8f`.
- Actual Arabic RTL: `.runtime-tests/review-fix-2026-10-08T19-30-05-172Z-16ce6314`.

The first focused attempt targeted the main renderer for a Settings-window input. The corrected harness identified and independently guarded the native Settings document; the original attempt remains private. No plugin defect was attributed to that fixture targeting error.

At 900px with both 440px sidebars open, the native central editor can be hidden; closing a whole sidebar or widening restores it. Theme checks establish applied assets and geometry, not every theme configuration. macOS/Linux, newer installers/renderers, arbitrary third-party panels and real external-file/direct-drop behavior were not newly accepted in this v0.1.1 run. Earlier broad results remain historical v0.1.0 evidence.
