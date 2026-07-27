# Checkpoint 27: Git Operations and Agent Change Review

## Outcome

Users can inspect repository state and agent-attributed changes, selectively stage or revert them, create commits, and recover files through argument-safe system Git operations.

## Source plan

- Section 23
- Phase 11
- Backlog K001-K010

## Prerequisites

- Checkpoints 07-09 and 24

## Scope

- Detect repositories and current branches.
- Add status, staged/unstaged diff, file history, and commit history.
- Add stage, unstage, commit, selected-change discard, and restore-from-commit.
- Use fixed argument arrays, timeouts, streaming, workspace CWD, and audit for destructive actions.
- Build source-control activity and agent change-review views.
- Link change sets to agent session, packet, task, and validation result where available.

## Expected artifacts

- Workspace Git adapter and typed command results.
- Source-control and agent-review UI.
- Safe diff/revert integration.
- Command timeout/error handling.
- Git fixture and integration tests.

## Work items

1. Detect no-repository, nested-repository, worktree, and dirty states.
2. Parse porcelain output without locale-sensitive assumptions.
3. Keep stage/unstage and commit explicit user actions.
4. Require confirmation before discarding or restoring content.
5. Reuse file hashes and events to attribute changes conservatively.
6. Never claim attribution when concurrent external changes make it uncertain.
7. Refresh status after filesystem and agent events.

## Acceptance evidence

- Status and diff match system Git on fixture repositories.
- Selected hunks/files can be reviewed and safely staged or reverted.
- Destructive actions are confirmed and audited.
- Commit messages/metadata may link to a session without being mandatory.
- Dirty repository warnings appear before agent work.
- Git arguments cannot be shell-injected through filenames or messages.

## Validation focus

- Renames, binary files, submodules, worktrees, and merge conflicts
- Huge diffs and command timeouts
- Concurrent external Git operations
- Partial agent attribution
- Restore of dirty files

## Out of scope

Custom Git implementation, remote push/pull, hosting-provider PRs, and automatic commits.

## Handoff

Expose change-review status to managed-agent completion and Version 1 journey tests.
