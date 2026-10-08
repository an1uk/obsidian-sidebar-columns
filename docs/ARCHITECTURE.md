# Architecture and unsupported assumptions

## Modules

- `main.ts`: normal Obsidian plugin lifecycle, commands, accessible consent/version/restore modals, settings and local acknowledgement/overrides.
- `operations.ts`: exclusive asynchronous operation boundary, generation/disposal guards, consent, required backups and stale-workspace rejection.
- `backups.ts` / `layout.ts`: full native JSON validation, immutable raw layout snapshots, separate integrity metadata, protected baseline and bounded rotation.
- `adapter.ts` / `patch.ts`: all undocumented native targeting/menu/tree/resize/drag access, native splitting verification and narrow rollback, session-only folding and cooperative hooks.

## Native column and row mechanisms

The primary action creates a full-height content column beneath the unchanged native sidebar root. The public `Workspace.createLeafBySplit(leaf, "vertical", before)` first creates an owned native EmptyView/tab group. The adapter detaches only that new group and synchronously moves it into the whole-column content split. For an existing stacked sidebar, native split containers retain the original row objects in their original order within one column. Further whole-column actions reuse that content split and insert beside the complete branch containing the selected tab.

Creating and reparenting native containers requires the private, guarded `WorkspaceSplit` constructor and insertion/removal methods. The adapter validates constructors and IDs before mutation; captures original objects, views, tabs, dimensions and the root’s actual content geometry; and verifies them afterward. The root keeps its direction, identity and native footer. The footer is excluded from full-height content measurements. Rollback removes only an unchanged operation-owned empty group, and restores only structure and dimensions still matching the operation’s captured state.

The secondary row action uses the public split API beside the chosen tab group. It wraps only that local row when needed. Neither action clones views, transforms serialized workspace JSON, rewrites the sidebar root direction or reloads the whole workspace.

Vertical means side by side; horizontal means stacked. Computed direction controls insertion order so the result is visually right in both LTR and RTL. Runtime checks verify sidebar ancestry, preserved objects and actual geometry.

## Private adapter assumptions

| Assumption | Reason and guard |
| --- | --- |
| Native leaf parent/group/split identity, children arrays, directions and dimensions | Validate an acyclic parent-child path into the actual main-window sidebar roots; reject central and foreign-document leaves |
| `WorkspaceLeaf.onOpenTabHeaderMenu` and `view.onTabMenu` | Current pane-menu events skip hidden inactive tabs; temporarily bridge the actual clicked view’s menu and restore its descriptor in `finally` |
| Native `containerEl`, `tabHeaderEl` and `resizeHandleEl` | Verify the relevant document and actual objects before targeting, folding or pre-resize expansion |
| `workspace.onDragLeaf` and main-document drag capture | Track the native gesture and expand at drag entry/over/drop before native target measurement, preserving the source header until Chromium establishes its drag |
| Native split constructor, dimensions and detach normalization | Verify the created empty group before success; roll back only operation-owned unchanged objects and proportions |
| Exact command ID `workspace:split-vertical` and check callback | Positive availability is useful only with the actual validated active sidebar target; no translated text or disabled CSS matching |

The outer workspace root and opposite sidebar are not reconstructed during splitting. Inactive tab menus target the clicked leaf rather than `activeLeaf`. Pop-out sidebar support is excluded by root and document identity.

All wrappers preserve receiver, arguments, return values and native errors. Removal restores the captured method only when the wrapper is still directly installed. If another plugin retains it beneath its own wrapper, the old layer becomes inert and delegates unchanged; cleanup does not clobber another plugin’s method.

## Collapse

Obsidian has no native collapse method for individual split children. Native resizing clamps child sizes and later persists rendered proportions. Plugin-owned scoped styling folds a real branch into a 32px rail without changing its native dimension or tree. Version 0.1.1 removes CSS !important rules and records narrow inline presentation overrides for native flex/width and child visibility. Each original value and priority is preserved, legitimate native setDimension updates refresh the saved presentation, and expansion restores only values still owned by the fold. The temporary native wrapper uses the same cooperative, identity-checked cleanup as the other adapter hooks.

A full-height content branch is the preferred collapse target, including its stacked rows and nested row splits. Legacy layouts with only row splits use the nearest local vertical branch. Live views remain loaded. Native content is hidden/inert and a rail button provides recovery. Collapse records are session-only and attached to live objects. Expansion precedes splitter input/reset and native drag/drop target measurement, as well as split, full restore, core workspace replacement and unload. Ordinary tab clicks leave folds intact; expanding during the initial tab-header drag gesture was found to cancel Chromium’s drag, so capture-phase drag events expand synchronously before native bubble-phase geometry reads. Geometry-affecting folds cannot be introduced during an active gesture. This interception is a compatibility requirement, not a promise of stable private APIs.

## Restore and raw snapshot format

Public `changeLayout` reloads the full workspace, including view lifecycles and pop-outs. It is used only after explicit full-restore confirmation and a required pre-restore snapshot. The UI never describes this as a side-only restore.

Raw `.workspace.json` snapshots are native layout objects. Metadata is separate, versioned JSON with SHA-256 integrity and the baseline flag. Unknown JSON fields are preserved; known tree shapes, IDs, view state, dimensions and active references are validated. Backup files never replace the live workspace file during ordinary operation.

## Evidence and limitations

The inspected runtime archive was Obsidian 1.14.4, SHA-256 `146ef8470d8cbb4a6db209bdc19bf2bad13350444186c0fd93c31087b142b92f`. The locally installed launcher is 1.12.7. Static inspection establishes an implementation basis, not live visual acceptance. The results document records actual runtime checks separately.

Supported baseline: 1.14.4. Untested versions require an exact-version opt-in and structural checks; future native-support detection is intentionally conservative. No runtime network service, plugin-specific view cloning or user-note format is introduced.
