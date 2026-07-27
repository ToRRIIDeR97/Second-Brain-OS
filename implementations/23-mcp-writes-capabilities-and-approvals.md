# Checkpoint 23: MCP Writes, Capabilities, and Approvals

## Outcome

Approved agents can perform narrowly scoped brain and workspace writes through the existing MCP bridge, with hash checks, policy enforcement, indexing, bounded results, and audit trails.

## Source plan

- Sections 16.2, 16.4-16.7, and 26.5
- Phase 8 write-side MCP work
- Milestone 9
- Backlog I006-I008, I010-I011

## Prerequisites

- Checkpoints 07, 14, and 22

## Scope

- Implement the shared approval engine and decision persistence.
- Add brain note, decision, local task, link, archive, reindex, changes, and patch tools.
- Add restricted workspace read/write/patch/create-directory/validation tools.
- Require current hashes for writes and explicit roots from the app.
- Return changed paths, before/after hashes, revision IDs, job IDs, and audit IDs.
- Deny generic shell execution.
- Enforce cross-workspace, destructive, sensitive, and security-boundary approvals.

## Expected artifacts

- Approval tables, engine, UI prompt, expiry, and policy settings.
- Write tool schemas and handlers in the existing sidecar.
- Capability narrowing and revocation.
- Write-to-index integration tests.
- Adversarial tool-argument suite.

## Work items

1. Classify each tool action by risk, actor, target, reversibility, and side effect.
2. Validate agent arguments independently of model claims.
3. Reuse atomic file mutations and conflict results.
4. Recompile or invalidate knowledge state after writes through the normal event/index path.
5. Gate deletes and cross-workspace writes.
6. Allow only configured validation command IDs with fixed argument templates.
7. Stream long jobs without unbounded tool responses.

## Acceptance evidence

- Creating/updating a note through MCP updates disk, revisions, search, and graph.
- Stale-hash writes return a conflict and do not overwrite.
- Denied or expired approvals cause no side effect.
- A compromised client cannot request an absolute path or unrestricted shell.
- Every mutation returns complete change and audit metadata.
- Approval defaults match the master-plan risk classes.

## Validation focus

- Approval race and replay
- Policy downgrade during a tool call
- Partial multi-file patch failure
- Cross-workspace arguments
- Reindex and validation job cancellation

## Out of scope

Planner tools, managed provider sessions, external provider writes, and arbitrary command execution.

## Handoff

Publish approval-request events and tool-call/change records for agent session UI and Git review.
