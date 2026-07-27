# Checkpoint 37: Version 1 Acceptance and Beta Gate

## Outcome

Version 1 is accepted only after the complete local-first workflow, security boundaries, recovery paths, and cross-platform beta installers are demonstrated with traceable evidence.

## Source plan

- Sections 30.7, 36-37, and Appendix H
- Phase 15 acceptance criteria
- Milestone 12

## Prerequisites

- Checkpoints 01-36

## Scope

- Run the four critical journeys: Note to Graph, Note to Codex, Terminal, and Planner.
- Run the complete executive-summary vertical slice from workspace creation through linked Google Task.
- Verify every Version 1 definition-of-done category.
- Perform final regression, migration, recovery, security, accessibility, performance, and platform smoke checks.
- Triage all failures and explicitly disposition known limitations.
- Produce the beta release evidence and go/no-go decision record.

## Expected artifacts

- Versioned acceptance matrix linked to automated/manual evidence.
- Critical E2E recordings/logs without secrets.
- Cross-platform smoke report.
- Final risk register and known-limitations document.
- Beta release checklist and signed go/no-go record.

## Required journeys

1. Register a workspace, create a rich note, save atomically, index it, search it, expand its graph node, and reopen its source.
2. Right-click a note, inspect a bounded context packet, start managed Codex, approve a write, run validation, review the diff, and accept or revert it.
3. Open a folder in a terminal, change directory, create an inheriting tab, launch a visible agent, and open a file link at the correct line.
4. Connect Google, sync events/tasks, create and complete a task, create a linked focus block, handle a conflict, and verify audit/outbox state.
5. Back up, simulate recoverable failure, restore or rebuild, and confirm canonical files remain authoritative.

## Acceptance evidence

- Every item in Section 37 of the master plan is marked pass with evidence or blocks release.
- Critical E2E journeys pass on the primary macOS target.
- Supported Windows and Linux builds pass the defined smoke suite.
- No known critical/high security issue remains.
- Backup, restore, database rebuild, migration, and diagnostics export are demonstrated.
- Performance and accessibility gates pass or have an approved non-critical exception.
- Beta installer, documentation, checksums, and known limitations are ready.

## Go/no-go rules

- Any canonical-file loss, silent overwrite, workspace escape, secret leak, approval bypass, unrecoverable migration, or participant-facing action without confirmation is an automatic no-go.
- Flaky critical E2E tests are failures, not passes.
- Environmental failures must be identified and rerun in a valid target environment.
- Deferred non-goals do not block release unless the shipped UI claims to support them.

## Out of scope

Stable-channel launch, new feature development, mobile, collaboration, cloud repository sync, and all other Version 1 non-goals.

## Handoff

After a go decision, archive the exact acceptance evidence with the beta version and open follow-up work for every accepted limitation.
