# Source editor resource model

The source editor owns presentation state; the workspace mutation service owns
filesystem policy and durable writes. A tab is keyed by a stable resource ID,
not by its current path, so a rename can update the path without replacing the
editor model.

```ts
type EditorResource = {
  resourceId: string;
  workspaceId: string;
  relativePath: string;
  modelUri: string;       // agent-os://workspace/<id>/resource/<resourceId>
  language: string;
  encoding: "utf8" | "utf8Bom" | "unsupported";
  eol: "lf" | "crlf" | "mixed";
};

type EditorTabState = EditorResource & {
  baseHash: string;
  baseRevisionId: string;
  baseContent?: string;
  dirty: boolean;
  externalChange: "none" | "modified" | "deleted" | "renamed" | "permissionChanged";
  openRequest: number;
  viewState?: unknown;
};
```

There is one Monaco model per `resourceId`; multiple panes may attach to that
model while retaining separate view state. The app-owned registry disposes a
model after its last tab closes. The model URI is resource-based rather than
path-based, so a watcher rename updates `relativePath`, dirty state, and the
tab without recreating the model.

Opening a file records `baseHash`, `baseRevisionId`, the original EOL, and a
request sequence. A late read is ignored when its sequence is no longer the
latest for that resource. Save always sends the current `baseHash` through the
atomic mutation API. A clean save replaces the base hash/revision; a clean
three-way merge reports a non-blocking notice; an unresolved conflict leaves
the model dirty and hands its base/disk/editor states to the future diff/merge
surface.

The editor supports save, save-all, revert-buffer, close-dirty-tab, and
reopen-closed-editor commands. Save-all deduplicates resources shared by
multiple panes. Revert is explicit and reloads disk; closing a dirty tab asks
for confirmation. Only clean tabs and view positions are persisted through the
workspace UI state in this checkpoint. A dirty-state hook is exposed for the
later recovery journal; unsaved content is not silently persisted here.

UTF-8 and UTF-8-with-BOM are the supported source encodings. Unsupported
encodings are read-only with a stable error. The original LF/CRLF mode is
preserved on save; mixed line endings are reported rather than silently
rewritten by the editor.

