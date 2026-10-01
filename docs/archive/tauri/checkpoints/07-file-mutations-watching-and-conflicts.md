# Checkpoint 07: File Mutations, Watching, and Conflicts

## Outcome

Users and later agent tools can mutate workspace files safely, while external edits, renames, deletes, and save conflicts are detected and never silently overwritten.

## Source plan

- Sections 11.3-11.5 and 12.2-12.4
- Phase 2
- Milestone 2 filesystem portion
- Backlog B005-B009, B012-B013, B016

## Prerequisites

- Checkpoint 06

## Scope

- Implement create, atomic text write, rename, move, copy, attachment creation, and Trash.
- Require base hashes for overwriting existing text.
- Add filesystem watching, debounce/deduplication, operation IDs, and rename detection signals.
- Preserve open-resource identity across rename.
- Add three-way conflict calculation and a conflict result contract.
- Audit file mutations and emit typed file events.
- Add drag-and-drop and write-side file-tree context actions.

## Expected artifacts

- Mutation service with stable revision IDs and hashes.
- Watcher and per-path debounce queue.
- Conflict model returning base, disk, and editor states.
- Trash adapter and recursive-delete confirmation UI.
- Integration tests using external filesystem mutations.

## Work items

1. Write temporary files in the destination directory, flush, preserve permissions, and atomically rename.
2. Compare the caller's base hash with current disk content before replacement.
3. Deduplicate the application's own watcher event by hash and operation ID.
4. Correlate rename events using provider event, identity, file ID, hash, and time window.
5. Move deletions to OS Trash where supported; define a safe fallback.
6. Keep delete events distinct in debounce logic.
7. Surface clean auto-merges separately from unresolved conflicts.
8. Update open tabs and selections when paths change.

## Acceptance evidence

- A save either atomically succeeds with a new hash/revision or returns a conflict.
- Simulated interruption never leaves a partially written destination.
- External edits appear in the UI after debounce.
- Rename preserves the open tab and stable resource association.
- Duplicate watcher events do not create duplicate revisions.
- Recursive deletion requires confirmation and uses Trash.
- Every mutation records actor, path, hashes, correlation, and audit ID without full-content logging.

## Validation focus

- Rapid save storms
- Cross-volume moves
- Case-only renames
- Watcher overflow/recovery
- Permission changes during save
- Conflict behavior for deleted or binary files

## Out of scope

Editor UI, index updates, Git restore, and MCP file tools.

## Handoff

Publish the mutation, conflict, and file-event contracts used by editors, indexer, Git review, MCP, and agents.
