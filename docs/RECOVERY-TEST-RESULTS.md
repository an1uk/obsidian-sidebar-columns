# Recovery runtime acceptance

Final bundle SHA-256: `de5cff62e9475dd58d6374f2f58da44e07cc68047c7962cafa3a3f296c54c329`.

OS: Microsoft Windows 11 Home Insider Preview 25H2 build 26220.9587 (64-bit). Renderer: 1.14.4. Installer: 1.12.7. Theme: default.

| Scenario | Actual result |
| --- | --- |
| Real first full-height column creates a protected persistent raw-layout baseline and checksum metadata | passed |
| Full-workspace restore Cancel preserves current columns and creates no pre-restore snapshot | passed |
| Full-workspace restore Confirm restores baseline and retains a pre-restore snapshot of the split layout | passed |
| Disable removes commands, hooks and collapse rail while preserving native columns; re-enable installs working actions | passed |
| Restart same isolated profile preserves native columns, durable acknowledgement and backups; collapse begins expanded | passed |
| Offline raw snapshot replacement restores the documented baseline without copying a metadata wrapper | passed |
| Closing Obsidian and preserving/removing workspace.json rebuilds a usable native default layout without changing notes | passed |

Guarded isolated launches: 4. Captured renderer errors: 0. Owned process closure: confirmed.

Production configuration and protocol content guard: unchanged.

Evidence: `.runtime-tests/recovery-2026-10-08T17-55-33-802Z-e526071e`; `report.json` records guarded launches, checks and actual failures. Screenshots accompany each completed recovery stage.

The working vault was never an interaction target. Only this fresh fixture profile/vault and its owned PIDs were changed.

## Acceptance limits

- Default theme only for recovery scenarios; separate runtime results cover additional interactions.
- Windows renderer 1.14.4 on installer 1.12.7; macOS/Linux and other application versions were not run.
- Only the isolated fixture and owned process were operated.
