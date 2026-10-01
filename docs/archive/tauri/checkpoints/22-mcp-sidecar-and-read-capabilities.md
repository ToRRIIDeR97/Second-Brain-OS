# Checkpoint 22: MCP Sidecar Transport and Read Capabilities

## Outcome

Local agents can use a version-matched, authenticated, bounded MCP sidecar to read approved brain and workspace resources without the sidecar duplicating application business logic.

## Source plan

- Sections 16.1-16.4 and 16.6-16.7
- Phase 8 read-side MCP work
- Milestone 9 read portion
- Backlog I001-I005, I012-I013

## Prerequisites

- Checkpoints 02-03, 15, and 21

## Scope

- Implement stdio MCP transport and schema/version negotiation.
- Connect to the running app through private authenticated local IPC.
- Issue short-lived per-session capability tokens.
- Add `brain.*` resources and read tools.
- Add restricted workspace manifest, changes, and allowed-roots resources.
- Attach agent/session identity, bound and paginate outputs, and return job IDs for long operations.
- Audit tool calls and redact results through app policy.

## Expected artifacts

- Functional sidecar with client, permission, and brain modules.
- Authenticated app-side MCP gateway.
- Versioned tool/resource schemas.
- Capability-token lifecycle.
- Protocol recordings and adversarial tests.

## Work items

1. Keep SQLite, filesystem path resolution, index, and policy logic inside the app.
2. Authenticate each sidecar instance and bind tokens to agent, session, workspace, tools, and expiry.
3. Implement project card/brief, node, document section, context packet, search, and status reads.
4. Reject oversized requests and paginate bounded results.
5. Convert stable app errors into MCP errors without leaking internals.
6. Reject sidecar/app protocol mismatches.
7. Record audit events without logging sensitive arguments or content.

## Acceptance evidence

- An agent can search and read a context packet through stdio MCP.
- The sidecar has no direct database, Google, or arbitrary filesystem access.
- A token cannot expand its own roots, tools, or lifetime.
- Outputs are bounded, paginated, and redacted according to current policy.
- Version mismatch fails safely with an actionable message.
- Tool calls carry agent/session identity and audit IDs.

## Validation focus

- Forged, expired, replayed, and cross-session tokens
- Malformed MCP messages
- App restart during a request
- Pagination consistency
- Sidecar binary replacement/version mismatch

## Out of scope

Write tools, planner tools, agent process management, and a listening network port.

## Handoff

Document capability issuance and schema-version rules. Checkpoint 23 must extend this server rather than create another MCP service.
