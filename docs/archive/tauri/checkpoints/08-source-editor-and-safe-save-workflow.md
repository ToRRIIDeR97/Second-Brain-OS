# Checkpoint 08: Source Editor and Safe Save Workflow

## Outcome

Text and code files can be opened at a location, edited with Monaco, and saved through the hash-aware filesystem workflow with explicit conflict handling.

## Source plan

- Sections 20.1 and 25
- Phase 3 source-editing portion
- Milestone 2
- Backlog C001

## Prerequisites

- Checkpoint 07

## Scope

- Add a Monaco wrapper and language detection.
- Open files at line/column and preserve selection, scroll, and view state per workspace.
- Track base hash, dirty state, revision ID, and external-change state.
- Save only through the atomic mutation API.
- Present clean auto-merge notices and unresolved conflicts.
- Add save, save-all, revert-buffer, close-dirty-tab, and reopen-closed-editor commands.
- Ensure editor models are disposed and bounded.

## Expected artifacts

- Source editor feature with typed backend integration.
- Editor tab state and dirty indicators.
- Conflict notification and handoff into a merge surface.
- Unit tests for editor state transitions.
- Integration tests for safe save and external edit.

## Work items

1. Route supported text/code types into Monaco.
2. Maintain one model per open resource and update its path on rename.
3. Carry the base hash on every save.
4. Prevent stale async reads from replacing newer editor state.
5. Implement dirty-close confirmation and crash-state hooks.
6. Open search, graph, terminal, and diff locations at an exact line when supplied.
7. Add keyboard-accessible save and navigation commands.

## Acceptance evidence

- Common code files highlight and can open at a requested line.
- Saving returns and stores the new content hash.
- An external edit never gets silently overwritten.
- Rename preserves the editor model and dirty state.
- Restart can restore open clean tabs and their view positions.
- Repeated open/close cycles do not leak Monaco models.

## Validation focus

- CRLF/LF preservation
- Large but supported text files
- Encoding detection and unsupported encodings
- External delete while dirty
- Multiple panes showing one resource

## Out of scope

Rich Markdown, final merge editor, binary previews, semantic code services, and Git diff.

## Handoff

Document the editor resource model and hooks that Checkpoints 09, 10, 12, and 27 will extend.
