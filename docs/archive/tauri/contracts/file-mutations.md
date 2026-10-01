# File mutation contract

This contract is the boundary between a workspace-aware caller and the file
mutation service. Canonical content remains in ordinary workspace files; the
service does not update the index.

## Inputs and results

Every operation receives a `workspaceId` plus a normalized relative path. An
absolute path, parent traversal, alternate separator, or symlink escape is
rejected by the workspace path policy. Mutation metadata carries an actor,
correlation ID, and operation ID.

Text replacement uses optimistic concurrency:

```ts
type WriteTextRequest = {
  path: { workspaceId: string; relativePath: string };
  content: string;
  baseHash?: string;       // required when the destination already exists
  baseContent?: string;    // retained only to calculate a three-way merge
  actor: { actorType: string; actorId: string };
  correlationId: string;
  operationId?: string;
};
```

Success writes to a temporary file in the destination directory, flushes and
syncs it, preserves existing permissions, and atomically renames it over the
destination. It returns a new BLAKE3 content hash, revision ID, operation ID,
and byte count. The old destination remains intact if writing or syncing the
temporary file fails.

The final compare and rename are optimistic: a third-party writer can still
race the portable filesystem API. A changed hash is rejected whenever it is
observed; no operation provides a force-overwrite escape hatch.

## Conflicts

If disk differs from `baseHash`, the service attempts a line-based three-way
merge of base, disk, and editor text. Disjoint edits are atomically saved with
a `mergeNotice`; overlapping edits return `FILE_CONFLICT` with all three
states and do not write either side. Deleted and binary disk files are
unresolved conflicts. A base hash without base content cannot be merged and
therefore remains unresolved.

## Other operations

Create, attachment creation, copy, rename, and move never overwrite an
existing destination implicitly. Same-volume file moves use rename. A
cross-volume file move copies to a durable temporary destination, verifies the
hash, and removes the source only after the destination is committed;
cross-volume directory moves fail closed. Case-only renames should use a
temporary intermediary on case-insensitive filesystems.

Trash is an injected adapter. The default adapter returns
`TRASH_UNAVAILABLE`; the service never falls back to permanent deletion.
Recursive deletion confirmation belongs to the UI/policy layer.

Mutation audit payloads may include actor, operation/correlation IDs, source
and target paths, base/pre/post hashes, revision ID, and result status. They
must not include full file content or secrets. The later knowledge checkpoint
materializes `document_revisions`; this checkpoint does not create a competing
revision table.

