# Architecture

Tenon Workbench (formerly Second Brain OS) is an OpenCode fork. OpenCode is the runtime base: the
Electron host, the managed local OpenCode server and the session runtime. The
app shell and navigation are Tenon Workbench's own: a navigation rail of Home,
Notes, Calendar and Activity beside a Projects panel with their threads. New product domains are
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
and forward) and `components/second-brain-sidebar.tsx` (navigation rail plus
collapsible Projects panel). Pages sit on one rounded panel built from
`components/page.tsx` (`PageFrame`, `PageHeader`, `PageSection`, and
`PageEmpty` for centred empty states); page titles carry no descriptive subtitle. Shape and motion follow Material 3: radius,
easing and duration tokens (`--v2-radius-*`, `--v2-ease-*`,
`--v2-duration-*`) and the accent-container colors live in
`packages/ui/src/v2/styles/theme.css` and `packages/ui/src/theme/v2/mapping.ts`,
and the v2 components (pill buttons, circular icon buttons) use them. The sidebar's
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
that has not run when the app closes is dropped). The renderer has one
QueryClient (from `AppBaseProviders`); the router shell does not create its
own. `serverSync().homeSessions` applies every session event to the
recent-session index in that client, and both the sidebar and Home read it,
so a thread created, archived, unarchived or pinned anywhere, including in a
Project that is not open, updates both lists without a reload. A directory
list contributes only threads that run in that directory, because events
reach only their own directory's list. `context/drafts.tsx` holds unsent drafts per window and keeps prompt
state alive across route changes; it replaced the tab store.

| Data                       | Owner and persistence                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Notes                      | `packages/opencode/src/knowledge/note.ts`; workspace Markdown files                                                   |
| Project records            | `packages/opencode/src/project/brain.ts`; workspace `projects/` Markdown cards and project folders                    |
| Project thread directories | Derived, not stored: linked Workspace worktree, else `projects/<id>/`; thread counts read from `opencode.db`          |
| Local events and tasks     | Second Brain HTTP handler and `packages/opencode/src/planner/calendar.ts`; workspace `.second-brain/calendar-v1.json` |
| Sessions and runtime state | `packages/core/src/database/` and runtime session services; `opencode.db` in `$XDG_DATA_HOME/tenon-workbench`            |
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
  never moves files, and logs counts only. A pass with any failure runs again
  on the next listing. The server has no other way to
  know which Workspace is the Brain, so the migration does not run at
  bootstrap.
- `POST /second-brain/projects/workspace` with `{ workspaceId }` returns the
  Project linked to that OpenCode project id, creating one named after the
  folder when none exists. The renderer calls it from `context/layout.tsx`
  for folders opened during the app session, and from the sidebar's
  open-folder flow (`mod+shift+n`, Home's Open Workspace, and
  `tenon://open-project` deep links).

## Home navigation

Home is the sidebar's first item and the fallback for unknown routes. Its
Open Workspace buttons run the sidebar's open-folder flow. Home renders its shell independently of dashboard requests. Panel content,
metrics, and the harness selector have local loading boundaries. Harness
availability uses the renderer query cache, keyed by server and workspace
directory, with 30 seconds of freshness and background refresh on stale
re-entry. Projects and calendar data still reload on each visit.

Home's composer starts a Run in one step. It renders the thread composer's
`PromptInputHarnessControls`, so an external harness offers its model, effort
and service tier there too; the default model comes from `defaultModel`
(`components/prompt-input/harness-controller.ts`). `startSession` in
`pages/brain-home.tsx` creates a draft with the prompt, the chosen harness, its
model selection (`harnessModel`) and `send: true`, then opens it. The harness
query suspends while it loads, so the controls sit in their own `Suspense`
boundary and the rest of Home stays on screen. `context/drafts.tsx` keeps that request in memory
only, so a reload never sends twice. Once the draft's prompt and harness list
have loaded, `new-session-draft-controller.ts` submits through the normal
composer path. If the chosen harness is no longer available, the prompt stays
in the composer instead (`canSendOnOpen`).

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
except that neither the registry nor config files can replace a built-in. The
registry is re-read on each list and stream call, so new entries appear
without a restart.

`configuredInstances()` in `harness.ts` defines three built-in instances. The
reserved IDs are listed in `packages/core/src/harness/registry.ts`.

| ID             | Driver     | Shown as     | Runs                                                                 |
| -------------- | ---------- | ------------ | -------------------------------------------------------------------- |
| `opencode`     | `opencode` | Tenon Workbench | Tenon Workbench's own in-process LLM loop                               |
| `codex`        | `codex`    | Codex        | `codex app-server`                                                   |
| `opencode-acp` | `acp`      | OpenCode     | Upstream OpenCode from `PATH` as `opencode acp`, via the ACP driver |

The `opencode` ID is kept for the Tenon Workbench loop so stored sessions keep
routing to it. `Harness.OpenCodeAcp` in `packages/schema/src/harness.ts` names
the new instance, and the app's fallback list (`fallbackHarnesses` in
`app/src/utils/server.ts`) shows it as unavailable until the server reports
otherwise. The upstream child gets only the harness environment allowlist from
`core/src/harness/env.ts`, so no `OPENCODE_*` variables or app provider keys
reach it. It uses its own credentials from `opencode auth login`.

Both harness pickers (Home in `pages/brain-home.tsx` and the session composer in
`components/prompt-input/harness-controls.tsx`) list the built-in loop, named
"Default agent", first, then every other instance under one "External agents" group: Codex,
OpenCode, and any `harnesses.json` or config-file agents. The group always ends
with "Add harness", which opens Settings > Harnesses to register a new ACP agent.

Tenon Workbench's core `Global` paths use the app name `tenon-workbench`
(`core/src/global.ts`), so they no longer overlap with upstream OpenCode's
`opencode` folders. Data is in `$XDG_DATA_HOME/tenon-workbench` (default
`~/.local/share/tenon-workbench`), config in `$XDG_CONFIG_HOME/tenon-workbench`
(`opencode.json`, `harnesses.json`, skills, `AGENTS.md`), state in
`$XDG_STATE_HOME/tenon-workbench` (the desktop app sets `XDG_STATE_HOME` to
Electron `userData`), cache in `$XDG_CACHE_HOME/tenon-workbench`, and temp files
in `os.tmpdir()/tenon-workbench`. Database filenames are unchanged (`opencode.db`
on latest, beta and prod, `opencode-<channel>.db` otherwise; `path()` in
`core/src/database/database.ts`).

On first start, `LegacyStorage.migrate` (`core/src/legacy-storage.ts`, called
from `global.ts` before folders are created; skipped when `NODE_ENV=test`)
copies each legacy `opencode` data, config and state folder to its
`tenon-workbench` path. Each root runs once: a `.legacy-storage-migrated` marker
file, written last, records completion (a fresh install with no legacy folder
is marked too). The copy goes to `<target>.migrating-<uuid>` and is renamed
into place; if the target already exists without the marker (tests and early
startup can create empty folders), files are moved in one by one and existing
files are kept. It skips `snapshot`, `bin`, `log`,
`repos`, `tool-output` and `worktree` (data), `node_modules` (config), `locks`
(state) and any `*.tmp` entry. Legacy folders are never modified. A failed copy
stops startup. After migration the two apps have separate credentials and
databases; a shared `opencode.db` that held upstream OpenCode sessions is
copied with them. Snapshot history for past turns is not copied, existing
worktrees stay at their legacy paths, and new ones go under
`tenon-workbench/worktree`. Upgrade and rollback steps are in
[release operations](../release-operations.md#storage-migration-opencode--tenon-workbench).
Per-project `.opencode/` folders and the `.git/opencode` project ID file are
still shared with upstream OpenCode by design.

The Electron app IDs are `io.github.torriider97.tenonworkbench[.dev|.beta]`
(`APP_IDS` in `desktop/src/main/index.ts` and `electron-builder.config.ts`),
separate from upstream OpenCode Desktop's `ai.opencode.desktop[.dev|.beta]`.
The ID sets Electron `userData` (electron-store files and `XDG_STATE_HOME`),
the Windows AppUserModelId and NSIS install GUID, and the Linux executable,
desktop file and metainfo ID. Package names are `tenon-workbench[-beta|-dev]`
and the deep-link scheme is `tenon://`. On the dev channel only,
`desktop/src/main/user-data-migration.ts` copies the old
`ai.opencode.desktop.dev` `userData` once before `app.setPath("userData")`,
skipping caches, logs and lock files; beta and prod start fresh because their
old folders belong to upstream OpenCode Desktop. The copied state folders then
go through the `opencode` to `tenon-workbench` migration above. Upgrade and
rollback steps are in
[release operations](../release-operations.md#desktop-identity-change).

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

### Harness model lists

The picker shows the models each harness reports, not a list saved when the
harness was added. `HarnessRuntime` in `core/src/harness.ts` keeps two
in-memory caches per instance configuration:

- An availability check, reused for 30 seconds, or 5 seconds after a failure.
- The last model list the harness reported, kept until the server stops, so
  every app launch reads it again.

On the first check for an ACP harness, `AcpHarness.probe` runs the handshake
and `session/new` and reads the agent's models. Later checks run only the
handshake. If `session/new` fails (for example before sign-in), the probe falls
back to the handshake. Codex checks call `model/list` each time, with a
15-second timeout for a cold start. A failed check keeps the last model list.
Each ACP session that opens for a Run also updates the list. Saved model IDs in
`harnesses.json` are used only when an agent reports none, and Settings no
longer saves them when adding a harness.

`POST /api/harness/refresh` (`{ id? }`) clears both caches for one harness or
all, then lists again. The composer's refresh button and Settings → Harnesses
→ Refresh models call it. Settings also lists each harness's models with an
on/off switch. Hidden model IDs are stored per harness in the renderer's
`settings.v3` (`harnesses.hiddenModels`). `createPromptHarnessController` leaves
them out of the picker and the default-model choice. New models show by
default.

### Harness CLI updates

`core/src/harness/update.ts` finds where a harness CLI was installed from by
resolving its command on `PATH` to a real path:

- `<prefix>/lib/node_modules/<pkg>` (or `npm\node_modules`, `nodejs\node_modules`
  on Windows) is a global npm package.
- `~/.bun/install/global/node_modules/<pkg>` is a global Bun package.
- `<brew>/Cellar/<formula>/<version>` or `Caskroom/<cask>/<version>` is
  Homebrew.

Other installs, such as a standalone binary or a curl-script copy, show their
version only and are updated outside the app. The latest version comes from
the npm registry configured in the user's `.npmrc` (`/<pkg>/latest`) or from
`brew info --json=v2`. Results are cached for six hours per executable.

`GET /api/harness/updates` lists installed and latest versions for enabled
Codex and ACP harnesses. The renderer's `HarnessUpdateNotifier` (mounted in the
app shell) checks once per server connection. It shows a toast for each
available update with Update and Later. Later hides that version until a newer
one comes out (`harness-updates` global key). Settings → Harnesses shows the
version, an update badge, and an Update button.

`POST /api/harness/upgrade/:id` runs `npm install --global --prefix <prefix>
<pkg>@latest`, `bun add --global <pkg>@latest`, or `brew upgrade [--cask]
<name>`, with a 5-minute timeout. It then closes that harness's open runtimes
and clears its caches, so the next turn and the picker start the new version.
A turn in progress on that harness stops, and its thread reconnects on the next
message.

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

### Composer delivery, background send and stash

While a thread is working, the composer sends each message with a `delivery`
from Settings → General ("While the agent is working, new messages"): `steer`
(default) joins the current drain at its next provider-turn boundary, and
`queue` waits until the session would otherwise go idle. `mod+Enter` sends one
message with the opposite delivery. Idle sessions send without `delivery`
(server default `steer`). The renderer passes `delivery` through
`POST /api/session/:sessionID/prompt` and the harness prompt route. V1 servers
have no durable inbox: the compatibility layer drops `delivery` and reports
every V1 prompt as a steer.

Queued inputs stay out of the transcript. The renderer reducer skips
`session.next.prompt.admitted` events whose `delivery` is `queue` and appends
the message on `session.next.prompted`. `serverSync.session.data.session_queue`
holds the pending list: it is loaded from `GET /api/session/:sessionID/queued`
(unpromoted `queue` rows of `session_input`, oldest first) when a thread syncs,
then kept current from the same two events. The follow-up dock above the
composer lists these items, each with "Send now" and "Remove":

- Remove calls `DELETE /api/session/:sessionID/queued/:messageID`. The server
  publishes durable `session.next.prompt.withdrawn`
  (`{ sessionID, messageID, timestamp }`); the projector settles the
  `session_input` row by setting `promoted_seq` to the withdrawal sequence
  without a transcript message. Repeating it is a no-op.
- Send now calls `POST /api/session/:sessionID/queued/:messageID/steer`. The
  server publishes durable `session.next.prompt.steered` (same fields); the
  projector switches the row's delivery to `steer` and the session is woken, so
  the input joins the current drain at its next steer point or starts a run
  when idle.
- Both projectors update only a row that is still unpromoted with `queue`
  delivery, inside the event transaction. If the runner promoted it first, the
  event is not stored and the route answers 409 `ConflictError` ("Queued
  message already started"); an unknown or withdrawn input answers 404
  `MessageNotFoundError`. A runner that selected an input before it was
  withdrawn skips it (its `session.next.prompted` projection conflicts and is
  dropped, and a queue turn that promoted nothing ends without a model call);
  one steered after selection is still promoted once.

The renderer drops an item from `session_queue` on either event. The actions
go through the workspace SDK (`client.v2.session.queuedRemove/queuedSteer`)
in `utils/server-compat.ts`: V1 servers, and V2 servers whose unmatched-route
404 shows the routes are missing, raise `QueuedActionsUnsupportedError`, and
the dock then hides the buttons for that thread with a toast. One action runs
at a time (`pages/session/composer/queued-actions.ts`); other failures show an
error toast. Servers without the list route (V1 and older V2) report an empty
queue. The earlier client-side
queue (`followup.v1` per-workspace store) is removed; any items still in that
key are no longer read.

`mod+alt+Enter` sends in the background. From a new-thread draft it creates the
thread through the normal new-session path, sends, and keeps the user on the
same, now empty draft instead of promoting it. From an existing thread it sends
the message into a new thread in the same Project (same directory and Harness)
and leaves the current thread untouched. The new thread is seeded into the
sidebar with an optimistic busy status, and a toast offers "Open".

`mod+S` in the composer stashes the prompt (text, mentions and image
attachments; comment context stays in the composer) into the global
`prompt-stash` key (newest first, at most 20) and clears the composer. The
stash menu in the composer toolbar restores an entry (the current unsent prompt
is stashed in its place) or deletes it. Composer keys are handled in the
editor's keydown (`session-ui/src/v2/components/prompt-input/machine.ts`,
`promptInputV2KeyIntent`), not as global commands, because the global command
listener runs in capture phase. Settings → Shortcuts lists them read-only.

The session timeline collapses runs of two or more completed tool calls into
one "Ran N tools" summary row (`session-ui/src/components/part-group.ts`).
File edits, questions, subagent tasks, errored tools and running tools stay as
their own rows. Read-only runs keep the "Explored" context group.

Each assistant turn also gets a `TurnSteps` header row
(`app/src/pages/session/timeline/rows.ts`, one per segment when an interrupt
splits the turn). It is inserted before the turn's first tool or reasoning
group, and those group rows carry `step: true`. Text and other parts stay
visible in their original order. `foldTimelineRows`
(`timeline/row-reconciliation.ts`) removes a folded turn's step rows from the
virtual list after row reuse, so group keys stay stable. A turn is folded
unless one of its tools failed. `rows.ts` computes the `failed` flag on the
header, so the fold check doesn't read parts. A user toggle wins and is cached
per session in `toolOpen` under `turn:<userMessageID>:<segment>`. The header
(`app/src/components/session/turn-steps-summary.tsx`) builds its "Worked
{duration}" line and per-kind count phrases from `summarizeTurn`
(`session-ui/src/components/step-kind.ts`). Each phrase is a complete i18n
plural. While the turn works and is folded, the header shows a live ticker
instead of the step rows: a running "Working {duration}" timer, the latest
in-progress step (spinner, present-tense verb from `stepVerbKey`, target and
its own timer) and the two steps before it (`tickerSteps`), plus "Show all N",
which opens the turn. The ticker has a fixed height, so steps starting and
finishing don't move the rows below; one 1-second clock drives both timers.

The side panel's Session tab (`components/session/session-context-tab.tsx`,
which replaced the Context tab) sums usage over every assistant message of the
selected harness with `getSessionUsage` (`components/session/session-usage.ts`).
Cache hit is `cacheRead / (input + cacheRead + cacheWrite)`. Cost is the sum
of reported costs, and it reads "Not reported" when no message reported one
above 0. ACP turns get a per-turn cost from `usage_update`
(`core/src/harness/acp.ts`), which the runner publishes on `Step.Ended`. The
context window still comes from `getSessionContext` (last message, provider
limit). Subagents are built-in `task` parts. Tool counts come from
`summarizeTurn` over the harness's parts.

Desktop session export reads all native history pages, projects the existing
CLI JSON format, and invokes the narrow preload save operation. Main owns the
native destination picker and completes the file write before reporting
success. Browser downloads cannot confirm saving and do not show that toast.
