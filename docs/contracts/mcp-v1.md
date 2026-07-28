# MCP bridge contract v1

`agent-os-mcp` is one stdio JSON-RPC sidecar. It owns transport and schema
translation only; the running app owns workspace resolution, storage, policy,
redaction, approvals, indexing, and audit.

Clients initialize with `protocolVersion: 1`. A mismatch fails before any tool
call. Each call carries an opaque short-lived capability token plus agent,
session, and workspace IDs. The app binds grants to those identities, an
expiry, a policy revision, explicit tools, and validated relative roots.
Grants may be narrowed or revoked but never expanded.

Read tools are `brain.search`, `brain.get_context_packet`,
`brain.get_document_section`, `brain.get_node`, `brain.status`,
`workspace.get_manifest`, `workspace.get_changes`, and
`workspace.get_allowed_roots`. Checkpoint 23 extends the same bridge with
bounded note, task, archive, reindex, workspace write, patch, directory, and
configured-validation tools. Generic shell execution is not a capability.

Messages are limited to 256 KiB and pages to 100 items. Stable app errors map
to redacted JSON-RPC errors. Tool audit records include the token audit ID,
agent, session, workspace, tool, and correlation identity, never secret
arguments or returned content. There is no listening network port and the
sidecar has no direct database, Google, or arbitrary filesystem access.
