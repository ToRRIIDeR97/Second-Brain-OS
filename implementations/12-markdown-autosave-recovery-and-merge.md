# Checkpoint 12: Markdown Autosave, Recovery, and Merge

## Outcome

Rich notes autosave safely, recover after a crash, and resolve external edits without losing either the user's rich changes or canonical Markdown source.

## Source plan

- Sections 19.10 and 11.3-11.4
- Phase 4 implementation order 13-14
- Backlog C014-C016

## Prerequisites

- Checkpoints 07 and 10-11

## Scope

- Add debounced autosave through the atomic save contract.
- Add a recovery journal for unsaved editor state.
- Add rich/source-aware three-way conflict handling.
- Reuse the diff surface for unresolved merges.
- Add recovery discovery, preview, restore, discard, and cleanup flows.
- Define behavior for rename, delete, and permission loss while dirty.

## Expected artifacts

- Autosave state machine.
- Versioned recovery-journal format in application data.
- Merge editor integration.
- Startup recovery UI.
- Failure, crash, and conflict tests.

## Work items

1. Journal dirty state before or alongside debounced save.
2. Bind journal entries to workspace, path, base hash, and codec version.
3. Remove journal entries only after durable save confirmation.
4. Attempt source-level three-way merge before presenting conflicts.
5. Protect unsupported/unknown syntax during merge.
6. Prevent autosave loops caused by watcher events.
7. Handle codec-version mismatch during recovery conservatively.

## Acceptance evidence

- Forced termination with a dirty note produces a recoverable draft on restart.
- Successful durable save clears the relevant recovery entry.
- External edits yield a clean merge notice or an explicit merge UI.
- No conflict path silently overwrites disk or editor content.
- Recovery works after a file rename or reports a safe manual choice.
- Autosave remains responsive on the large-note fixture.

## Validation focus

- Crash between journal write and atomic rename
- Multiple windows editing the same note
- Disk-full and permission failures
- Conflict within unknown directives
- Stale journal retention

## Out of scope

Git-based history UI, index revision history, and cloud collaboration.

## Handoff

Expose recovery status to diagnostics and document how future codec migrations preserve old journal entries.
