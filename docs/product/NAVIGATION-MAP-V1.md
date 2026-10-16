# Tenon Workbench v1 navigation map

- Status: implemented (sidebar-only navigation, roadmap Phase 4)
- Companion: [`PRODUCT-BRIEF-V1.md`](./PRODUCT-BRIEF-V1.md)
- Roadmap: [`t3-parity-roadmap`](../../implementations/t3-parity-roadmap/implementation.md)
- Updated: 2026-10-14

## Navigation model

Tenon Workbench has one Brain: the Workspace selected on Home, where notes,
Project cards and the calendar live. Every thread belongs to a Project, and
every Project owns a thread directory (its linked Workspace, otherwise its
Project folder). The left sidebar is the only navigation. There is no tab
strip and no separate workspace page.

```mermaid
flowchart LR
    Sidebar[Sidebar] --> Home[Home]
    Sidebar --> Notes[Notes]
    Sidebar --> Calendar[Calendar]
    Sidebar --> Activity[Activity]
    Sidebar --> Projects[Projects section]
    Sidebar --> Settings[Settings dialog]

    Projects --> Project[Project row]
    Project --> NewThread[New thread draft]
    Project --> Thread[Root thread]
    Thread --> Child[Child threads, shown while their lineage is open]
    Projects --> Brain[Brain group]
    Projects --> Other[Other threads]
    Projects --> Cards[Projects page: cards and management]
```

## Sidebar

The sidebar has two columns: a navigation rail that is always shown and a
Projects panel beside it.

1. **Rail**, from top to bottom: a **New thread** button (same as `mod+n`),
   then **Home**, **Notes** (labelled Knowledge), **Calendar** and
   **Activity** as icons with a label underneath (the current page gets a
   pill highlight), and **Settings** at the bottom.
2. **Projects** panel. The heading opens `/projects`, the card management
   page. The folder button opens a folder as a Project.
   - One row per active Project, sorted by name, expandable. Expanding shows
     **New thread** and the Project's root threads: pinned threads first (most
     recently pinned first, with a pin icon), then the rest newest first. A
     running thread shows an accent dot. Child threads (`parentID`) nest under their
     parent while that parent or one of its children is open.
   - **Brain**: threads that run in the Brain folder itself and belong to no
     Project.
   - **Other threads**: threads in any other folder, such as non-git folders
     (OpenCode project `global`) or Workspaces no Project links to. Shows the
     50 most recent. Nothing is hidden because it lacks a Project.
3. **Settings** at the bottom opens the settings dialog.

Row actions:

| Row | Actions |
|---|---|
| Project | New thread, open project card (`/projects?project=<id>`), archived threads, archive project |
| Thread | Rename (also double-click), pin / unpin, fork, archive, delete |

Pins are stored on the thread (`metadata.pinned`, the pin time) so they survive
restarts. Pinned threads sort first inside their own group (Project, Brain or
Other threads); pinning a child thread does not move it out of its parent.

**Archived threads** opens a dialog listing the Project's archived threads
(threads in its thread directory, up to the 500 most recently updated), each
with **Unarchive**.

### Undo

Archive thread, rename thread, delete thread and archive Project show a toast
with **Undo** for 5 seconds. While such a toast is open, `mod+z` undoes the most
recent one, unless focus is in a text field or editor, which keeps its own undo.

- Archive and rename happen at once; undo unarchives the thread or restores
  the previous title. Archive Project undo restores the previous status.
- Delete is deferred: the row (and its child threads) hides at once, and the
  hard delete (`session.remove`) runs only when the toast expires. If the app
  closes before then, the thread is not deleted.

`mod+b` or the titlebar button hides and shows the Projects panel; the rail
stays. The current Project and the
expanded Projects are remembered per window.

## Titlebar

The titlebar is window chrome only: the sidebar toggle, back and forward
(when enabled in Settings), the update pill, and the native window controls.

## Routes

| Route | Shows | Sidebar highlight |
|---|---|---|
| `/` | Home | Home |
| `/notes`, `/calendar`, `/activity` | That page | That item |
| `/projects`, `/projects?project=<id>` | Project cards; a selected card | Projects heading |
| `/new-thread?project=<id>&draftId=<id>` | Draft composer in the Project's thread directory | The Project |
| `/server/<server>/session/<id>` | A thread | The Project whose thread directory equals the thread's directory, else Brain |

Redirects keep old links working: `/brain` and `/workspaces` go to `/`,
`/new-session?draftId=<id>` goes to the new-thread route, `/<dir>/session/<id>`
goes to the server-scoped thread URL on the selected server, and
`/<dir>/session` opens a new draft in that folder. Any other path goes to `/`.

## Drafts

A draft is an unsent thread. It is stored per window with its server, thread
directory and Project, and its composer content is kept in `drafts.sqlite`.
Sending a draft replaces it with the new thread and opens it, except
`mod+alt+Enter`, which sends in the background and leaves the draft open and
empty. On the first
start after upgrading, drafts from the retired tab strip are imported and the
per-window `tabs`, `tabs.recent`, `tabs.info` and `tabs.closed` keys are
deleted.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `mod+n` | New thread in the current Project (else in the Brain) |
| `mod+shift+n` | Open a folder as a Project |
| `mod+b` | Toggle the sidebar |
| `alt+up` / `alt+down` | Previous / next visible thread in the sidebar |
| `mod+shift+[` / `mod+shift+]` | Previous / next Project |
| `mod+[` / `mod+]` | Back / forward |
| `mod+k` | Command palette |
| `mod+z` | Undo the last sidebar action while its undo toast is open (not in text fields) |

Composer keys (handled inside the prompt editor, listed read-only in Settings →
Shortcuts):

| Key | Action |
|---|---|
| `Enter` | Send (while the agent works: steer or queue per Settings → General) |
| `shift+Enter` | New line |
| `mod+Enter` | Send with the opposite delivery for this message |
| `mod+alt+Enter` | Send into a new thread in the same Project, in the background |
| `mod+s` | Stash the prompt; restore or delete from the composer's stash menu |
| `ArrowUp` | Previous prompt from history (empty composer) |

The desktop File menu uses `Cmd+N` for a new thread, `Cmd+Shift+N` to open a
folder as a Project and `Cmd+Alt+N` for a new window. `mod+t`, `mod+shift+t`
and tab-closing `mod+w` were removed with the tab strip. In-session panels
keep their own `mod+w`.

## Deep links

The app shell handles `tenon://open-project?directory=<path>` (opens the
folder as a Project) and `tenon://new-session?directory=<path>&prompt=<text>`
(opens a draft in that folder's Project, or in the folder itself).

## Pages

- **Home** is a dashboard: start a Run, today's events and tasks, active
  Projects, resume and running threads.
- **Projects** lists Project cards by status and opens a card with Overview,
  Plan, Work, Files, Activity and Map views.
- **Calendar** shows events and tasks; account setup lives in Settings.
- **Notes** holds global notes and Project notes.
- **Activity** lists threads needing attention, agent runs, changes and
  history. Agent runs shows recent threads with active runs first and a
  Running, Waiting for approval or Retrying status; finished and failed runs
  both read as idle, so they carry no status. History is the full searchable
  thread list.
- **Settings** contains General, Shortcuts, Servers, Providers, Models and
  Harnesses.
- **Thread** shows the timeline and composer. Each finished agent turn folds
  its tool and reasoning steps into one "Worked {duration}" row. The row stays
  open while the turn or one of its steps runs, or when a step failed. The
  side panel has **Review** and **Session** tabs, plus open files. Session
  replaced the Context tab. It shows the session's totals per harness: input, output, cache
  hit, cost, context window, subagents and tool counts. It also keeps the
  context breakdown and raw messages. A value the harness doesn't report reads
  "Not reported".
