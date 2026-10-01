# Checkpoint 04: Desktop Shell and Typed IPC

## Outcome

The app presents the persistent IDE shell and a generated, typed, error-aware IPC layer that all later frontend features can use.

## Source plan

- Sections 24-25
- Phase 1 frontend tasks
- Backlog A005-A006

## Prerequisites

- Checkpoints 01-03

## Scope

- Build the activity bar, navigator region, tab strip, main workspace, inspector, and optional bottom drawer.
- Add resizable panes, error boundaries, empty states, and basic design tokens.
- Establish route/activity-mode and command-palette foundations.
- Implement generated or mechanically checked TypeScript bindings for Rust IPC schemas.
- Support result envelopes, stable error display, correlation IDs, job IDs, and streaming events.
- Persist shell-level state through backend commands.

## Expected artifacts

- Accessible main shell and application providers.
- Typed IPC client with domain command groups.
- Command registry with context predicates and permission classifications.
- Layout/pane persistence types and UI.
- Frontend test utilities for mocked IPC and events.

## Work items

1. Create application providers and global error handling.
2. Build keyboard-operable shell regions and resizers.
3. Implement tabs, split-pane model, inspector toggle, and drawer toggle.
4. Generate frontend types from backend schemas.
5. Map stable backend errors to user-visible recovery actions.
6. Add long-job progress and cancellation primitives.
7. Add command registry, palette search, shortcuts, and context predicates.
8. Persist and restore a sample shell layout.

## Acceptance evidence

- A typed sample command succeeds and a typed sample error renders with its correlation ID.
- Resizable shell regions work with keyboard and pointer input.
- Restart restores the sample layout.
- An unhandled feature error does not blank the entire window.
- The frontend cannot bypass typed IPC to access privileged capabilities.
- Streaming events unsubscribe cleanly when views unmount.

## Validation focus

- Type generation drift
- Keyboard navigation and focus restoration
- Multiple-window event scoping
- Job cancellation and stale response handling
- UI state schema evolution

## Out of scope

Real workspace CRUD, file tree data, editors, graph, terminal, planner, and agent screens.

## Handoff

Document how later features register commands, consume events, persist view state, and add IPC schemas without creating untyped escape hatches.
