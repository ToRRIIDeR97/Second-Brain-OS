# Second Brain OS v1 product brief

- Status: product direction for the v1 reset
- Audience: product, design, and engineering
- Implementation plan: [`IMPLEMENTATION-PLAN-V1.md`](./IMPLEMENTATION-PLAN-V1.md)
- Updated: 2026-08-22

This document defines what Second Brain OS should become. It supersedes the
product positioning and information architecture in
[`product-designer-handoff.md`](../product-designer-handoff.md). That document
remains useful as an inventory of existing behavior, states, and unfinished
surfaces.

## Product definition

Second Brain OS is a personal operating system for projects, commitments,
knowledge, and delegated work. It gives one person a reliable view of what is
happening and a safe way to act, either directly or through an agent.

The product is not a knowledge graph with extra tools attached. It is not a
file browser with a dashboard. It is a control center whose main unit is the
project.

## Primary user

The v1 user is one technically capable person working across personal notes,
software projects, research, tasks, and calendar commitments. Multi-user
collaboration is outside v1.

## User outcomes

The user should be able to:

- understand today's commitments and blockers without opening several tools;
- create a project with an outcome, location, plan, and agent instructions;
- resume recent work in one or two actions;
- edit notes and source code without leaving the application;
- manage local tasks alongside Google Tasks and Google Calendar;
- ask an agent to investigate or act in the current context;
- inspect what an agent read, changed, and requested approval to do;
- review project history without relying on the graph.

## Product rules

### Projects organize work

A Project joins an outcome, status, milestones, tasks, calendar items, notes,
files, instructions, and activity. A local folder or repository can support a
Project, but the folder is not the Project.

### Home shows attention, not structure

Home answers four questions:

1. What needs attention today?
2. Which projects are moving or blocked?
3. What work can be resumed?
4. What can the agent handle?

Home must not use the graph as its main content.

### The agent uses product actions

The agent does not control the interface through clicks or coordinates. The UI
and the agent call the same typed application actions. Second Brain OS owns the
permissions, approvals, audit record, and resulting state.

### Local files remain canonical

Notes and project files remain ordinary local files. Indexes, graph records,
and local database projections must be rebuildable.

### Provider data keeps its identity

Google Tasks and Google Calendar items show their source and sync state. Local
enrichment must not overwrite provider-owned fields.

### The graph is contextual

The graph appears inside a Project as a Map view or a temporary pull-out
panel. It visualizes relationships and live work. It is not a primary section
of the application.

## V1 product areas

### Home

Home contains:

- an "Ask Second Brain" composer;
- Today, including events, due tasks, overdue work, and approvals;
- Active Projects with progress, next milestone, blocker, and latest activity;
- Resume with recently edited resources and interrupted work;
- Running work with active agent runs and results that need review.

The initial state teaches the user to create a Project, connect a calendar, or
open an existing folder. Empty cards should not occupy the screen.

### Projects

Projects has Active, Paused, and Archived views. The default Project page has:

- Overview for outcome, health, progress, and next action;
- Plan for milestones, timeline, and dependencies;
- Work for tasks and scheduled focus blocks;
- Files for notes, documents, and source code;
- Activity for user, agent, file, Git, task, and provider events;
- Map for a bounded relationship and live-work view.

Project settings hold its location, instructions, access rules, connections,
templates, and archive controls.

### Project creation

The basic flow asks for:

1. project name and intended outcome;
2. an existing folder, a new folder, or no local folder yet;
3. an optional starting template.

An Advanced section adds agent instructions, read and write access, calendar
association, tags, and automation. Trust and permissions must be clear, but
they should not make the basic flow feel like infrastructure setup.

### Calendar and tasks

Calendar provides Today, Week, Month, and Agenda. Tasks provides Today,
Upcoming, Unscheduled, and Completed. They share one planning model so a task
can be scheduled without losing its identity.

Local items work without a Google account. Google connection adds provider
items, source labels, sync state, and conflict handling. Read consent and write
consent remain separate.

### Knowledge and workbench

Knowledge holds notes and references that are useful across Projects. Project
files stay inside their Project but remain discoverable through global search.

Markdown and source files open as resource tabs in the central workbench.
Diffs, previews, and terminal sessions use the same tab model. Primary product
areas do not create permanent tabs each time the user visits them.

### Agent layer

"Ask Second Brain" is available from Home, a Project, a selected resource, and
the global utility panel. The current context is shown before a run begins.

Each Run exposes:

- objective and status;
- Project and selected resources;
- readable and writable roots;
- tools and external connections;
- streamed work grouped into meaningful events;
- pending approvals;
- changed files, tasks, events, and notes;
- result, validation, and next action.

Codex App Server is the first managed runtime, as accepted in
[`ADR-005`](../adr/ADR-005-codex-app-server.md). The provider boundary remains
so the product is not defined by one model vendor.

The application exposes its actions through the single app-owned MCP boundary
defined in [`ADR-006`](../adr/ADR-006-single-mcp-server.md).

### Project map

Map starts from the current Project, resource, task, or Run and renders a
bounded subgraph as required by [`ADR-007`](../adr/ADR-007-focused-graph.md).

It should show useful state, including:

- files currently being read or changed;
- agent activity tied to resources;
- blocked tasks and dependencies;
- notes, decisions, and source links;
- recent changes and their authors.

Animation represents real events. Labels remain crisp at every supported zoom
level. A clear 2D view is preferable to 3D depth that makes text harder to
read.

## Key journeys

### Start a new project

Home or Projects opens Create Project. The user enters an outcome and location,
reviews access, creates the Project, and lands on its Overview with a suggested
first milestone.

### Resume work

Home shows the most relevant recent resource and next Project action. Opening
it restores the Project context, workbench tab, and useful utility panels.

### Delegate work

The user asks from the current Project or resource. The application previews
context and permissions, starts a Run, streams structured activity, pauses for
consequential approvals, and returns changes to the relevant Project views.

### Plan time

The user opens Calendar, selects a task or Project milestone, and schedules it.
The item keeps its Project and source relationships. Provider writes show
pending, synced, offline, or conflict state.

## Trust and recovery

- Reads and writes use the narrowest registered roots.
- External and destructive actions require approval based on effect.
- Every consequential action appears in Activity.
- Failed writes keep enough information to retry or repair safely.
- Unsaved editor work and interrupted Runs have visible recovery paths.
- Hidden reasoning, credentials, and raw terminal history do not enter the
  audit record.

## Outside v1

- real-time multi-user editing;
- team roles and shared approval queues;
- autonomous control of arbitrary desktop applications;
- a general visual programming system for agent workflows;
- full Notion database parity;
- an unbounded global graph;
- multi-agent swarms as a default interaction.

## V1 success criteria

- Home reveals the next meaningful action within ten seconds.
- A basic Project can be created in under two minutes.
- Recent work can be resumed from Home in no more than two interactions.
- Every agent change can be traced to a Run, Project, and approval decision.
- Local notes, tasks, and editing still work when Google is disconnected.
- Search, Projects, and Activity provide normal navigation without requiring
  the graph.
- The main shell contains one clear primary navigation and no competing
  workspace strip.

## Delivery order

1. Adopt the canonical language and navigation model.
2. Replace Home and build Create Project.
3. Build Project Overview, Plan, Work, Files, and Activity.
4. Unify local planning with Google connection and sync.
5. Finish the shared action layer and Codex App Server integration.
6. Reintroduce Map as a contextual Project view.

## Existing foundations

V1 should build on the current source and Markdown editors, planner, agent event
model, capability checks, workspace root policies, MCP sidecar, and focused
graph query contract. The reset changes how these parts are organized. It does
not justify replacing working domain logic.
