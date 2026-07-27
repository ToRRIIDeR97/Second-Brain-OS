# ADR-006: Use one local MCP server

- Status: accepted
- Date: 2026-07-27
- Supersedes: none

## Decision

Expose brain, planner, and workspace capabilities through one thin
`agent-os-mcp` sidecar. It validates and forwards requests to the running app;
business logic, policy, storage, and path resolution remain in the app.

## Consequences

Authentication, approvals, logging, packaging, and version negotiation have one
boundary. The sidecar must not grow a second database, unrestricted filesystem,
provider, or approval implementation.

## Supersession

Splitting the server requires a demonstrated security or deployment boundary
and a compatibility plan for existing clients.
