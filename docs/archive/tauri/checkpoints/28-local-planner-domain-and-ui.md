# Checkpoint 28: Local Planner Domain and UI

## Outcome

The app has a provider-neutral planner model and useful local task, milestone, focus-block, calendar, and project views before Google behavior is introduced.

## Source plan

- Sections 10.5, 22.1, and 22.8
- Phase 12 planner UI dependency
- Backlog J009, J018-J019

## Prerequisites

- Checkpoints 03-04 and 13

## Scope

- Add planner tables and internal `PlannerItem` domain types.
- Implement local tasks, milestones, focus blocks, provider links, sync/conflict status, and project links.
- Build Today, Week, Month, Agenda, Tasks, Upcoming, Unscheduled, and Completed views.
- Build project task/calendar/milestone/focus/workload views.
- Link planner items to source notes and graph nodes.
- Add tick, drag, schedule, convert, and source-navigation interactions for local items.
- Keep provider payloads out of general UI contracts.

## Expected artifacts

- Planner migrations, domain services, and IPC.
- Global and project planner UI.
- Date/time representation rules.
- Local task extraction/link behavior.
- Accessibility agenda/list alternatives.

## Work items

1. Define date-only, exact-time, timezone, recurrence placeholder, and all-day representations.
2. Reconcile explicit Markdown task IDs with local planner rows.
3. Keep local enrichment separate from future provider-owned fields.
4. Implement local-only create/update/complete/archive.
5. Link tasks to projects and source ranges.
6. Add drag-to-calendar behavior using local focus blocks.
7. Surface provider/sync placeholders without faking connectivity.

## Acceptance evidence

- Local tasks can be created, edited, completed, and linked to a project/note.
- Exact-time and date-only items remain distinct.
- Planner and source note stay consistent for explicitly linked tasks.
- Calendar and agenda views handle timezone boundaries correctly.
- All core interactions have keyboard-accessible alternatives.
- No Google-specific type leaks into general planner components.

## Validation focus

- DST and timezone changes
- Duplicate explicit task IDs
- Deleted source notes
- Drag/drop cancellation
- Large task lists

## Out of scope

OAuth, Google sync, provider writes, MCP planner tools, and recurrence editing.

## Handoff

Publish provider adapter and ownership interfaces so Google synchronization can map into domain records without redesigning the UI.
