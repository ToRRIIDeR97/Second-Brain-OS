# Checkpoint 24: Agent Provider and Session Foundation

## Outcome

The app has one provider-neutral model for profiles, sessions, events, approvals, cancellation, context attachment, status, and change-set linkage.

## Source plan

- Sections 17.1-17.2, 17.6-17.7
- Phase 9/10 shared foundation
- Backlog H001, H009-H012

## Prerequisites

- Checkpoints 03-04, 21, and 23

## Scope

- Define the internal `AgentProvider` trait and normalized domain events.
- Add configurable profiles without hard-coded provider model catalogs.
- Add session, event, approval-link, context-link, and change-set persistence.
- Build agent activity mode, session list, event stream, status, and cancellation UI.
- Implement the provider process-supervision abstraction and protocol-version checks.
- Define cross-project readable/writable root resolution.

## Expected artifacts

- Provider trait and normalized types.
- Agent/profile/session migrations.
- Session state machine.
- Agent workspace UI.
- Mock provider and recorded-session test harness.

## Work items

1. Model created, starting, running, waiting, canceling, completed, failed, and recoverable states.
2. Normalize assistant text, tool, approval, file-change, usage, error, and lifecycle events.
3. Link each session to one immutable context packet and explicit permission profile.
4. Default cross-project work to one writable project.
5. Persist only the minimum provider mirror needed for navigation and audit.
6. Handle malformed, late, duplicate, and out-of-order provider events.
7. Redact hidden reasoning and secrets.

## Acceptance evidence

- The mock provider can start, stream, request approval, cancel, fail, and resume.
- Session history restores after restart without pretending an unknown process is live.
- Context packet and readable/writable roots are visible before launch.
- Provider errors cannot corrupt other sessions or application state.
- Duplicate events are idempotently handled.
- Model names, reasoning modes, and profiles are configurable.

## Validation focus

- Crash during startup
- App restart during a session
- Approval after cancellation
- Provider protocol mismatch
- Cross-project permission expansion

## Out of scope

Real Codex/Claude process adapters, terminal rendering, Git commands, and planner actions.

## Handoff

Provider adapters must translate into these domain events rather than leaking provider payloads into the UI.
