# Checkpoint 31: Planner MCP and Agent Workflows

## Outcome

Agents can read and update planner data through the existing MCP server, with the same outbox, conflict, permission, approval, and audit behavior as direct UI actions.

## Source plan

- Sections 16.3, 16.5, and 22
- Phase 13 MCP portion
- Milestone 11
- Backlog I009 and planner integration items

## Prerequisites

- Checkpoints 23-25 and 30

## Scope

- Add `planner.*` resources and tools to `agent-os-mcp`.
- Add Today, calendar, task list, project schedule, and availability resources.
- Add event/task list, get, create, update, complete, move, delete, link, free-time, and sync tools.
- Resolve exact-time versus date-only intent through explicit tool schemas.
- Reuse planner domain services, outbox, approvals, conflicts, and audit.
- Link planner actions to agent session, packet, project, and source note.
- Add agent launch/completion prompts for recording tasks or scheduling focus blocks.

## Expected artifacts

- Planner MCP schemas and handlers.
- Version negotiation update.
- Agent-to-planner linkage records and UI.
- Approval previews with provider targets.
- Recorded end-to-end MCP/provider tests.

## Work items

1. Keep all Google access in the application core.
2. Bind planner capabilities to account, calendars/task lists, session, and expiry.
3. Make write responses return local ID, provider ID when known, outbox ID, sync state, and audit ID.
4. Confirm participant-facing and destructive actions.
5. Support private task/focus-block defaults according to policy.
6. Bound date ranges and result pages.
7. Surface conflicts and asynchronous provider completion to the originating session.

## Acceptance evidence

- An agent can list planner state and create a personal task.
- Exact-time requests create an event/focus block; date-only requests create a task.
- Participant-facing changes cannot bypass approval.
- MCP writes use the outbox and remain idempotent.
- Task completion through MCP synchronizes locally and remotely.
- Every action is linked to its agent session and audit record.

## Validation focus

- Ambiguous timezones and date phrases
- Capability expiry while outbox is pending
- Large availability ranges
- Conflict after agent session ends
- Account/calendar scope escalation

## Out of scope

Sending email, fully autonomous external communication, and calendar administration beyond selected event scopes.

## Handoff

Add the complete planner journey to acceptance tests and document default policy customization.
