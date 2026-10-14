# Architecture

Second Brain OS is an OpenCode fork. OpenCode is the runtime base: the
Electron host, the managed local OpenCode server and the session runtime. The
app shell and navigation are Second Brain's own: a sidebar of Home, Notes,
Calendar, Activity and Projects with their threads. New product domains are
added inside the existing OpenCode application rather than beside it.

The previous React/Tauri and Rust implementation is retired. Its database
schemas and remaining migration gaps are recorded in
[the donor archive](../archive/tauri/README.md).

## Active components

![Component view: renderer, preload, Electron main, the bundled OpenCode server (HTTP API, Second Brain domains, location services, agent runtime), stores and external services](../diagrams/component-overview.svg)

Detailed UML views (deployment, class, activity, state machine and sequence)
and a coverage index are in [the UML architecture views](uml.md).

- The Electron main process creates windows, exposes the limited preload API,
  and starts the managed server in a utility process on loopback with a
  generated password.
- The Solid renderer owns the desktop UI, including Brain, notes, projects,
  and calendar pages in `opencode/packages/app/src/pages/`.
- The OpenCode server owns sessions, workspace routing, and Second Brain HTTP
  handlers. `packages/opencode` mounts the native `/api` routes from
  `packages/server` (contracts in `packages/protocol`) next to its legacy
  instance routes; the session and harness runtime lives in `packages/core`. Notes and project records use workspace files through the location
  and file mutation services; calendar data is stored under `.second-brain/`.
- Former Rust policy and release documents are historical requirements, not
  evidence of controls in the active desktop runtime.

The renderer must not gain direct Node or filesystem access. Keep new native
operations behind the preload and main-process boundary, and resolve Second
Brain files through the server's location services. See
[`ADR-010`](../adr/ADR-010-opencode-electron-base.md) for the base-app decision.

## Product entry points and persistence

`opencode/packages/app/src/app.tsx` owns routing: `/`, `/notes`,
`/calendar`, `/activity`, `/projects`, the draft route
`/new-thread?project=<id>&draftId=<id>` and server-scoped threads at
`/server/<server>/session/<id>`. Old `/workspaces`, `/brain`, `/new-session`
and `/<dir>/session[/<id>]` URLs redirect. Settings, model/provider
selection, file panels, and terminals are shared dialogs or session panels
rather than standalone routes. The
[navigation map](../product/NAVIGATION-MAP-V1.md) describes the sidebar,
routes and shortcuts.

`pages/layout-new.tsx` is the only shell: the titlebar (window chrome, back
and forward) and `components/second-brain-sidebar.tsx`. The sidebar's
controller (`components/sidebar/sidebar-controller.ts`) reads
`GET /second-brain/project-threads`, loads each Project's threads with
`serverSync().project.loadSessions(threadDirectory)` (kept live by
`session.created/updated/deleted` events), adds the recent-session index for
threads outside any Project, and groups them with
`features/second-brain/sidebar-threads.ts` into Projects, Brain and Other
threads. The active Project is derived from the route's thread or draft
directory. Sidebar actions (archive, unarchive, pin through `PATCH /session/:id`;
rename; delete through `session.remove`) apply the server's reply to every
loaded directory list and to the recent-session index at once, then offer a
5-second undo from `utils/undo-action.ts` (in memory only; a deferred delete
that has not run when the app closes is dropped). The recent-session index
query uses the shell's QueryClient, so the sidebar binds its own index cache
to that client; `serverSync().homeSessions` writes to the outer client and
its live events do not reach the sidebar's copy. `context/drafts.tsx` holds unsent drafts per window and keeps prompt
state alive across route changes; it replaced the tab store.

| Data                       | Owner and persistence                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Notes                      | `packages/opencode/src/knowledge/note.ts`; workspace Markdown files                                                   |
| Project records            | `packages/opencode/src/project/brain.ts`; workspace `projects/` Markdown cards and project folders                    |
| Project thread directories | Derived, not stored: linked Workspace worktree, else `projects/<id>/`; thread counts read from `opencode.db`          |
| Local events and tasks     | Second Brain HTTP handler and `packages/opencode/src/planner/calendar.ts`; workspace `.second-brain/calendar-v1.json` |
| Sessions and runtime state | `packages/core/src/database/` and runtime session services; `opencode.db` in the XDG data directory                   |
| Unsent desktop drafts      | `packages/desktop/src/main/draft-store.ts`; profile `drafts.sqlite`                                                   |
| Draft list, sidebar state  | `packages/app/src/context/drafts.tsx`, `components/sidebar/sidebar-controller.ts`; per-window `drafts` and `sidebar` keys |
| Google connections         | `packages/desktop/src/main/google-calendar.ts`; encrypted credentials in the desktop profile                          |

Package paths in this table are relative to `opencode/`. Workspace files are
the source of truth for notes, project records, and local planning. Do not
assume the session or draft databases can be reconstructed from those files.

### Projects and thread directories

Every thread belongs to a Project. `BrainProject.threadDirectory` resolves a
Project's directory: the worktree of the OpenCode project named by
`location.workspaceId`, otherwise the Project folder `projects/<id>/` in the
Brain directory. Sessions keep their exact `directory`, so
`GET /api/session?directory=<threadDirectory>` (or `project` plus `subpath`)
returns only that Project's threads; sibling Project folders in the same Brain
repository do not mix.

Entry points (legacy instance routes, scoped to the Brain directory through
workspace routing):

- `GET /second-brain/project-threads` lists Projects with `threadDirectory`,
  `threadDirectoryKind` (`workspace` or `folder`), the linked Workspace, and
  root thread count and last activity. The first call per Brain directory in a
  server process runs the Workspace migration: every OpenCode project with
  root threads, other than `global` and the Brain itself, gets a Project
  through `BrainProject.ensureForWorkspace`. It only creates Markdown cards,
  never moves files, and logs counts only. The server has no other way to
  know which Workspace is the Brain, so the migration does not run at
  bootstrap.
- `POST /second-brain/projects/workspace` with `{ workspaceId }` returns the
  Project linked to that OpenCode project id, creating one named after the
  folder when none exists. The renderer calls it from `context/layout.tsx`
  for folders opened during the app session, and from the sidebar's
  open-folder flow (`mod+shift+n`, Home's Open Workspace, and
  `opencode://open-project` deep links).

## Home navigation

Home is the sidebar's first item and the fallback for unknown routes. Its
Open Workspace buttons run the sidebar's open-folder flow. Home renders its shell independently of dashboard requests. Panel content,
metrics, and the harness selector have local loading boundaries. Harness
availability uses the renderer query cache, keyed by server and workspace
directory, with 30 seconds of freshness and background refresh on stale
re-entry. Projects and calendar data still reload on each visit.

## Startup and request flow

1. Electron starts the bundled server in a utility process and gives the
   renderer its loopback URL and generated credentials through preload IPC.
2. The renderer detects server capabilities. The managed server combines
   current session routes with legacy project and MCP routes; compatibility
   lives in `packages/app/src/utils/server-protocol.ts` and `server-compat.ts`.
3. Workspace bootstrap loads configuration, initializes plugins, and then
   starts workspace services. Server readiness precedes this work. Startup
   phase logs in `packages/opencode/src/project/bootstrap.ts` distinguish it
   from initial server launch.
4. Notes, projects, and local calendar requests resolve the selected location
   before reading or mutating files. Google operations use the desktop bridge.

The packaged desktop disables embedded web UI fallback. The server serves only
a UI bundled into its binary; without one, and for missing `/api` routes, it
returns a local 404. There is no hosted UI proxy. The
optional upstream CLI is a separate runtime from the fork's bundled server;
see [release operations](../release-operations.md). The fork has no terminal
UI. `packages/opencode/src/index.ts` is a headless developer CLI (`serve`,
`generate`, and inspection commands) that runs from source and isn't
shipped.

## Harness drivers and registration

`packages/core/src/harness.ts` runs each Run turn through a Harness instance.
Three drivers execute: `opencode` (in-process provider calls), `codex`
(Codex app-server JSON-RPC), and `acp` (any agent that speaks the Agent Client
Protocol over stdio, in `packages/core/src/harness/acp.ts`). Instances come
from built-ins, then the app-owned `harnesses.json` registry in the global
config directory, then `harnesses` entries in config files. Later sources win,
except that the registry can't replace `opencode` or `codex`. The registry is
re-read on each list and stream call, so new entries appear without a restart.

ACP sessions are created with `session/new`, or reopened with `session/load`
when the agent supports it. The ACP session ID is stored as the Run's harness
continuation. The client advertises no file-system or terminal capability;
the agent uses its own tools and asks permission through
`session/request_permission`, which maps to Second Brain approvals. ACP agents
receive no Second Brain system prompt. An agent reports its models either in
the legacy `models` field or as a `configOptions` select of category `model`.
The driver switches models with `session/set_model` or
`session/set_config_option` to match.

### Harness handoff

The `opencode` driver reads the Run's native messages, so it needs no
handoff. Codex and ACP keep their own native thread or session, so
`renderCodexPrompt` in `harness.ts` decides what text to send with each turn:

- Each instance has its own continuation in the session's
  `metadata.harnessContinuations[instanceID]`: `{ nativeID, lastSeenMessageID }`.
  `HarnessContinuationSet` writes one entry and leaves the others alone, so
  switching harnesses no longer discards another instance's thread. A new
  `nativeID` clears `lastSeenMessageID`. After a turn ends without an error,
  the driver records the ID of the user message it answered as
  `lastSeenMessageID`.
- A fresh thread, or one whose resume failed, gets the bounded full history.
- A resumed thread gets only the messages after its `lastSeenMessageID`,
  skipping its own reply to that message. If that message is no longer in the
  request (for example after compaction), it gets the bounded full history.
  If nothing new happened, it gets only the new user message.
- History is bounded to 16,000 estimated tokens (`util/token.ts`, four
  characters per token). The first user message and the latest user and
  assistant messages are always kept, each clipped to a quarter of the budget.
  Other messages fill newest to oldest. A message that doesn't fit is left out
  whole, and the block states how many were left out. Tool calls and results
  become one-line summaries (tool name, command or path, status, exit code).
- The history sits inside `<handoff-history>` with a notice that it is context
  only, not a new request, and carries no instructions. The new user message
  follows after a `---` separator.

`metadata.harnessRevision` still increases on every switch to a different
instance. It keys the in-memory runtimes, so a harness that is switched back
in reopens its thread and gets the delta. The old single-slot
`metadata.harnessContinuation` is read only when it matches the current
revision (resumed with no history, as before) and is dropped on the next
`HarnessContinuationSet`. That event's `revision` field is now ignored.

Users manage ACP harnesses in Settings → Harnesses. The page calls
`/api/harness/settings`, `/api/harness/discover`, and
`/api/harness/registry[/:id]`. Their thin handlers in
`packages/server/src/handlers/harness.ts` delegate to `HarnessRuntime`, which
uses `packages/core/src/harness/registry.ts`:

- Test runs the ACP handshake and `session/new` to list models, and writes
  nothing.
- Save checks the command again and appends the entry.
- Enable/disable and remove change only `harnesses.json` entries.

Built-ins and config-file entries are read-only. After each change the runtime
refreshes its cached instance list, so the next turn and the picker see it.
Agents have no tool for registering harnesses.

The page also offers a setup assistant
(`app/src/components/settings-v2/harness-assistant.tsx`). It is an ordinary
session on a harness and model the user picks, created in the app state
directory so it stays out of project lists. Because ACP agents get no Second
Brain system prompt, the task instructions travel in the first user message.

1. The assistant investigates with its own tools and replies with a
   ```` ```harness ```` JSON block.
2. When the session goes idle, the page parses the block and calls
   `POST /api/harness/verify`. That runs the handshake, `session/new`, and one
   short prompt in the proposed agent, refusing tool permissions.
3. A failed test is sent back to the chat, up to three times automatically.
4. A passed test enables Save. The assistant can't save anything itself.

## Session compatibility and review

The managed server uses native `/api/session` execution and history alongside
legacy project, file, Git, rename, archive, and PTY connection routes. The
renderer selects those supported routes through capability detection rather
than assuming that every operation uses one API generation. PTY sockets use
short-lived tickets from the legacy connection endpoint on managed servers
and the native `/api/pty` endpoints on servers using only the current API.

Archive, unarchive, and pin go through the legacy
`PATCH /session/:sessionID` route. `time.archived: <ms>` archives and
`time.archived: null` clears the `time_archived` column. `pinned: true`
stores the pin time as `metadata.pinned` (epoch ms) and `pinned: false`
removes that key, leaving other metadata intact, so pins need no migration.
Legacy session info returns `metadata.pinned`; native `SessionV2.Info`
derives `time.pinned` from it. Each change publishes `session.updated`, and
the renderer reducer drops archived sessions and re-inserts unarchived ones.
The renderer helpers are `unarchiveSession` and `setSessionPinned` in
`app/src/pages/session/session-archive.ts` and `sessionPinnedAt` in
`app/src/utils/session.ts`.

Native forks copy the selected history into a new session through durable
`session.next.message.imported` events. Forks receive new message IDs and do
not inherit provider continuation handles or filesystem snapshots. The
native `POST /api/session/:sessionID/fork` endpoint preserves the selected
harness and model.

`GET /api/session/:sessionID/diff` compares the first and last assistant
snapshots after the selected user prompt, stopping at the next user prompt.
Snapshot capture discovers Git initialized after a workspace is already open.
Renderer Last turn review uses this endpoint; working-tree and branch review
use the managed server's legacy Git routes. File search refreshes the
ripgrep fallback on each query so newly written files are discoverable.

"Edit from here" on a user message stages a revert at that message
(`POST /api/session/:sessionID/revert/stage`) and loads the message into the
composer. The user picks "Messages only" (`files: false`, workspace files
untouched) or "Messages and files". For the second choice the renderer first
unions `GET /api/session/:sessionID/diff` across the selected turn and every
later turn, and asks for confirmation with that file list before staging.
Redoing a messages-only rewind keeps `files: false`. V1 servers always restore
files, so the compatibility layer rejects `files: false` for them.

The session timeline collapses runs of two or more completed tool calls into
one "Ran N tools" summary row (`session-ui/src/components/part-group.ts`).
File edits, questions, subagent tasks, errored tools and running tools stay as
their own rows. Read-only runs keep the "Explored" context group.

Desktop session export reads all native history pages, projects the existing
CLI JSON format, and invokes the narrow preload save operation. Main owns the
native destination picker and completes the file write before reporting
success. Browser downloads cannot confirm saving and do not show that toast.
