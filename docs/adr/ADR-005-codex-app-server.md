# ADR-005: Use Codex App Server for managed Codex sessions

- Status: accepted
- Date: 2026-07-27
- Supersedes: none

## Decision

Managed Codex sessions use Codex App Server for authentication, lifecycle,
streamed events, approvals, history, and change visibility. A visible Codex
terminal remains available as a separate mode.

## Consequences

Provider payloads are normalized at the agent adapter boundary. The local app
stores only the session mirror needed for navigation and audit, not hidden
reasoning or provider secrets.

## Supersession

Changing the managed provider requires an adapter-protocol version and a
session-history migration plan.
