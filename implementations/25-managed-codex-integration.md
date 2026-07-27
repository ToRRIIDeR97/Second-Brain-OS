# Checkpoint 25: Managed Codex Integration

## Outcome

Users can start, monitor, approve, cancel, recover, and resume managed Codex sessions with inspectable context, sandbox roots, tool activity, and file changes.

## Source plan

- Sections 17.3-17.4 and 17.6
- Phase 9
- Milestone 8
- Backlog H002-H006

## Prerequisites

- Checkpoints 19 and 24

## Scope

- Implement Codex App Server discovery, authentication handoff, launch, supervision, and compatibility checks.
- Parse structured Codex events into the provider-neutral model.
- Attach context packets and project-scoped MCP configuration.
- Bridge approvals and cancellation.
- Link file changes, validation results, and recoverable process state.
- Support visible Codex terminal mode through terminal presets.
- Support start and resume without depending on private reasoning.

## Expected artifacts

- Codex provider adapter and process manager.
- Recorded protocol fixtures.
- Managed-session UI refinements.
- Visible Codex terminal preset.
- Crash, auth-expiry, approval, and version-mismatch tests.

## Work items

1. Verify supported App Server protocol before session start.
2. Generate or preview scoped configuration without overwriting user-managed config silently.
3. Attach immutable packet and explicit roots.
4. Normalize streams, tool events, approval requests, patches, completion, and usage.
5. Mark process crash as recoverable or terminal based on provider capability.
6. Associate post-start file changes with the session using operation/correlation data.
7. Keep raw terminal output and hidden reasoning out of authoritative knowledge.

## Acceptance evidence

- Users can start, resume where supported, cancel, and observe managed Codex.
- Approval requests appear in-app and decisions reach the correct session.
- The session displays its context packet and actual sandbox roots.
- File changes and validation results are linked.
- App Server crash produces an accurate recoverable/failed state.
- Workspace sandbox tests prevent unrelated project access.

## Validation focus

- Authentication expiry
- App Server version changes
- Duplicate or malformed events
- Cancellation during tool execution
- Project-local configuration in untrusted workspaces

## Out of scope

Claude managed mode, Git staging/commit, planner actions, and automatic knowledge promotion.

## Handoff

Record the supported Codex protocol/version range and fixture-update process for release compatibility checks.
