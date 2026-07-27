# Checkpoint 17: Focused Graph Workspace

## Outcome

Users can navigate, expand, inspect, and act on a focused knowledge graph with clear authority styling and an accessible list alternative.

## Source plan

- Sections 21.1-21.6 and 29
- Phase 6
- Milestone 5
- Backlog E002-E010

## Prerequisites

- Checkpoints 04 and 16

## Scope

- Add React Flow canvas and custom node/edge components.
- Run ELK layout in a cancellable web worker.
- Implement single-click select/expand, double-click source open, and right-click actions.
- Add inspector, filters, saved lenses, viewport/position persistence, and breadcrumb/history.
- Visually distinguish authority, confidence, stale state, and node type without color alone.
- Add a keyboard-operable relationship list alternative.

## Expected artifacts

- Graph activity mode and reusable embedded graph view.
- Layout worker and cancellation protocol.
- Node/edge design system.
- Inspector and context menus.
- Accessible list representation and graph tests.

## Work items

1. Render only the bounded API response.
2. Preserve selection and viewport across expansions.
3. Cancel obsolete layouts and ignore stale worker results.
4. Wire source open, search, terminal, context, and future agent actions through the command registry.
5. Show truncation and “load more” explicitly.
6. Provide keyboard navigation, focus order, textual relationships, and reduced motion.
7. Save lenses and local positions without modifying authoritative graph records.

## Acceptance evidence

- Click expands one hop; double-click opens the correct source.
- Right-click commands honor command context and permissions.
- The canvas never exceeds the configured hard cap.
- Inferred and stale data are visibly and textually distinct.
- Layout work does not block editing.
- All selected-node relationships are usable through the accessible list.

## Validation focus

- Rapid expansion and stale layout results
- Dense hubs and long labels
- Zoom, high contrast, reduced motion, and screen readers
- Missing/deleted source nodes
- Saved-lens schema migration

## Out of scope

Full-repository graph rendering, inferred link generation, terminal implementation, and agent launch execution.

## Handoff

Register stable graph commands that terminal, context, agent, and planner checkpoints can activate later.
