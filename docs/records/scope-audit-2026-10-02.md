# Scope audit, 2026-10-02

The active Electron app was compared against
[the product brief](../product/PRODUCT-BRIEF-V1.md),
[the navigation map](../product/NAVIGATION-MAP-V1.md), and
[the agent orchestration request](../product/FEATURE-REQUEST-agent-work-orchestration.md).
The audit read the source and did not run the app. Paths are relative to
`opencode/packages/`.

## Summary

| Area | Status | Main gaps |
| --- | --- | --- |
| Rail and primary routes | Mostly built | Rail has no badges. `/workspaces` and location pickers remain in normal navigation. |
| Top bar | Mostly missing | Back and Forward exist. There is no breadcrumb, Create menu, Ask button, or attention indicator. `mod+k` and `mod+shift+p` open one palette (`app/src/context/command.tsx:14`). |
| Home | Partial | Today, Active Projects, Resume, and Running exist. Resume lists sessions only. Empty panels always render. Approvals are not routed to a review view. |
| Projects | Partial | Active, Paused, and Archived lists, and Overview editing, work. Plan has no milestone entity, timeline, or dependencies. Work, Files, and Activity are link-out cards. Map shows notes only. |
| Project creation | Partial | Name, outcome, existing location, instructions, and tags work. There is no new-folder option or template; `templateId` exists in `opencode/src/project/brain.ts` but the UI never uses it. |
| Calendar and tasks | Largely built | All views, local planner, project links, Google read/write consent split, and an outbox work. There are no milestones or conflict-resolution UI, and only the primary Google calendar syncs. |
| Knowledge | Partial | Markdown notes, editor, wiki-links, and backlinks work. There are no Daily notes, Collections, or Saved views. Search is a full scan without source labels. Notes do not open as workbench tabs. |
| Activity | Partial | Built around sessions. It has no records of planner, note, or sync mutations, no Project filter, and no recovery items. |
| Settings | Diverges | Settings keep OpenCode's General, Shortcuts, Providers, and Models tabs. Connections, Permissions, Project locations, Data and recovery, and Diagnostics are missing. Google setup lives on the Calendar page. |
| Agent layer | Partial | Harness instances, OpenCode/Codex selection, handoff, and permissions work. There is no Run model, global Ask panel, context preview, product-action tools, app-owned MCP server, or audit record. |
| Agent orchestration slices 1–7 | Not started | Only the plan exists in `implementations/agent-work-orchestration/`. |

None of the brief's "Outside v1" items were found in Second Brain code.

## Highest-impact gaps

1. Agents cannot act through product actions. Notes, planner, and Projects are
   HTTP routes for the UI only, so Runs cannot be traced to Projects and
   approvals.
2. The global top bar is missing: Create, Ask, attention, and breadcrumb.
3. The Project Plan, Work, Files, and Activity views are placeholders.
4. The Settings hierarchy and Connections area are missing.
5. Activity has no durable audit trail.

## Documentation drift

- ADR-004, ADR-005, ADR-006, and ADR-009 are still marked accepted but
  describe the Tauri-era design. ADR-006's MCP sidecar and ADR-004's single
  rebuildable app database do not exist in the active app. ADR-005's Codex
  App Server runtime is implemented in `core/src/harness.ts`.
- The Google planner, data-classification, and approval-risk documents now
  carry Tauri-era status notes.
- The security gaps found are listed in the
  [threat model](../security/threat-model.md#known-gaps).
