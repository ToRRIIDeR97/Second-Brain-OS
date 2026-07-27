# Checkpoint 30: Google Writes, Outbox, and Conflicts

## Outcome

Calendar and Tasks mutations are durable, retryable, idempotent, conflict-aware, approval-gated where necessary, and correctly reflected in local planner state.

## Source plan

- Sections 22.5-22.7
- Phase 13 provider-write portion
- Milestone 11 dependency
- Backlog J010-J017, J020

## Prerequisites

- Checkpoint 29

## Scope

- Implement Calendar event and Google Task create, update, complete, move, and delete.
- Apply the due-time rule: exact time to Calendar, date-only to Tasks, optional linked task plus focus block.
- Route every provider mutation through the durable outbox.
- Add idempotency keys, retry/backoff, offline state, and terminal failure handling.
- Use ETags/base provider payloads for conditional updates and field-level conflicts.
- Preserve local enrichment separately from provider-owned fields.
- Apply default approvals for attendee, shared calendar, recurring, delete, and organizer-sensitive actions.

## Expected artifacts

- Outbox and conflict services/UI.
- Google write adapter.
- Idempotency and retry policy.
- Approval mapping for planner actions.
- Offline, ETag, recurrence, and duplicate-operation tests.

## Work items

1. Persist an outbox operation before attempting a provider call.
2. Reconcile successful provider response and local planner state atomically.
3. Make retried creates safe from duplication.
4. Compare base ETag/payload and create field-level conflicts.
5. Handle recurring-instance versus series scope explicitly.
6. Confirm participant-facing and destructive operations.
7. Trigger read sync after mutations and reconcile provider canonical values.

## Acceptance evidence

- Event and task create/update/complete/delete synchronize in both directions.
- Offline writes remain visible as pending and retry safely.
- Retrying a timed-out create does not produce duplicate provider items.
- ETag conflict creates an inspectable conflict instead of silently overwriting.
- Attendee/shared/recurring/destructive changes request the correct approval.
- Local project/source enrichment survives provider refresh.

## Validation focus

- Network failure before and after provider commit
- Token expiration during outbox processing
- Recurrence scope and organizer ownership
- Rate limiting and backoff
- Delete versus concurrent update

## Out of scope

Public webhooks, arbitrary email/communication, autonomous attendee actions, and planner MCP tools.

## Handoff

Expose provider mutation jobs and conflict/approval states to MCP, agent sessions, diagnostics, and Version 1 E2E tests.
