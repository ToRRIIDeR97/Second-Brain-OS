# Checkpoint 05: Workspace Registry, Trust, and Persistence

## Outcome

Users can register, open, switch, remove, and restore multiple isolated workspaces, with explicit trust and project-card boundaries.

## Source plan

- Sections 8.1-8.5
- Phase 1
- Milestone 1
- Backlog A001-A010

## Prerequisites

- Checkpoints 03-04

## Scope

- Add workspace, workspace-settings, project, UI-state, and recent-item migrations.
- Implement workspace CRUD and canonical root identity.
- Parse and validate `brain.workspace.yaml`.
- Implement brain, project, and collection workspace kinds.
- Implement trust levels and visible capability summaries.
- Persist per-workspace window, pane, tab, selection, and recent state.
- Link project cards to project roots without automatically mounting those roots.
- Support opening a workspace in a separate window.

## Expected artifacts

- Workspace domain service and thin IPC handlers.
- Workspace switcher, trust UI, recent menu, and settings surface.
- Manifest parser and policy evaluator.
- Project-card linker.
- State persistence and migration tests.

## Work items

1. Register only existing, canonicalizable roots and prevent duplicate aliases.
2. Store display and canonical paths separately.
3. Define remove-registration behavior without deleting user files.
4. Evaluate effective policy from trust level, manifest, and application settings.
5. Restore workspace-specific UI independently in multiple windows.
6. Create and validate lightweight project-card references.
7. Emit workspace lifecycle and permission-change audit events.
8. Add trust upgrade/downgrade confirmations.

## Acceptance evidence

- Multiple workspaces can be registered and switched without losing state.
- Restart restores registered workspaces and each workspace's UI state.
- Opening one workspace in a new window does not leak state from another.
- Duplicate paths reached through aliases are rejected or resolved to one registration.
- Untrusted restrictions are visible before terminals, agents, or external programs are available.
- Removing a registration leaves the root and its files untouched.
- A project card does not grant access to its linked project root.

## Validation focus

- Path casing and normalization across platforms
- Missing, moved, or unavailable roots
- Manifest version mismatch
- Concurrent window updates
- Trust downgrade while sessions exist

## Out of scope

Recursive file browsing, file writes, indexing, project creation automation, and agents.

## Handoff

Expose stable workspace IDs and one effective-policy query for filesystem, terminal, MCP, context, and agent checkpoints.
