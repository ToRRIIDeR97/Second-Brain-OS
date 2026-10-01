# MCP bridge contract v2

Version 2 keeps the Version 1 security boundary and adds planner resources and
tools. Clients initialize with `protocolVersion: 2`; mismatches fail before a
tool call.

Planner reads cover Today, calendars, task lists, project schedules, and
bounded availability ranges. Planner writes expose explicit event and task
schemas so exact-time intent cannot silently become a date-only task. Pages
are limited to 100 items and time ranges to 366 days.

Every call still carries an opaque capability token plus agent, session, and
workspace identities. The app owns account/calendar scope, policy, approvals,
outbox idempotency, conflicts, provider access, and audit. The sidecar only
validates and forwards; it has no database, credential, Google, arbitrary
filesystem, or generic shell access.

Automatic planner actions are bounded personal task/focus-block operations.
Participant-facing, destructive, recurring, shared-calendar, and
organizer-sensitive changes require app-owned confirmation. Write responses
include local, provider (when known), outbox, sync, and audit identities.

Version 1 clients must upgrade explicitly; planner capabilities are not
silently negotiated into a Version 1 session.
