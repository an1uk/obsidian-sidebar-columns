# Core Workspaces and pop-out runtime acceptance

Final bundle SHA-256: `de5cff62e9475dd58d6374f2f58da44e07cc68047c7962cafa3a3f296c54c329`.

OS: Microsoft Windows 11 Home Insider Preview 25H2 build 26220.9587 (64-bit); renderer 1.14.4; installer 1.12.7; default theme.

| Scenario | Actual result |
| --- | --- |
| Native central split remains functional while Sidebar Columns hooks are installed | passed |
| Core Workspaces saves full-height columns and loading it clears transient rails and restores native branches | passed |
| Native floating pop-out serializes into a validated complete layout backup | passed |
| Pop-out command cannot split a remembered main-sidebar tab or silently split its own central leaf | passed |

Evidence: `.runtime-tests/workspaces-2026-10-08T17-56-41-932Z-ae1e4498`. Actual core-method discovery, guarded native launches, screenshots, floating snapshot and targeting rejection are preserved locally.

Production configuration/protocol content guard: unchanged. Owned process closure: confirmed.

Other platforms/versions, pop-out sidebar splitting, extra themes and arbitrary third-party panels were not run in this subset.
