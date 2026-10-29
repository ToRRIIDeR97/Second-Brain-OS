# Threat model for the active desktop app

This document covers the OpenCode Electron fork in `opencode/`. The former
React/Tauri application is retired, so its Rust policy and MCP
sidecar design are not current desktop controls.

![Trust zones (renderer sandbox, Electron main, loopback server, workspace files, harness child processes, external network) with the control at each crossing, sensitive-data flows, and known gaps](../diagrams/trust-boundaries.svg)

Detailed permission and request flows are in
[the UML architecture views](../architecture/uml.md).

## Assets and boundaries

| Boundary                   | Current control and location                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer to native process | The main window uses `contextIsolation`, `sandbox`, and disabled `nodeIntegration`. `opencode/packages/desktop/src/preload/index.ts` exposes specific IPC methods implemented in `opencode/packages/desktop/src/main/ipc.ts`. Packaged builds ignore `ELECTRON_RENDERER_URL`; see Renderer content policy for remote media.                                     |
| Renderer to managed server | Electron starts the OpenCode server on `127.0.0.1` with a generated password. Server authorization checks credentials for protected routes. See `opencode/packages/desktop/src/main/index.ts` and `opencode/packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`.                                                                         |
| Server to workspace files  | Second Brain handlers run in an instance location context. Note and project code resolves targets through `LocationMutation` before reading or writing files. See `opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/second-brain.ts`, `opencode/packages/opencode/src/knowledge/note.ts`, and `opencode/packages/opencode/src/project/brain.ts`. |
| Desktop to Google          | Calendar and Tasks integration uses OAuth in the Electron main process. The service keeps any number of accounts, encrypts each account's client secret and refresh token with Electron `safeStorage`, and disables connection when secure storage is unavailable. Access tokens are cached per account, writes are routed to the account named by the item, and the loopback callback ignores requests without the expected state. See `opencode/packages/desktop/src/main/google-calendar.ts`. |

`POST /second-brain/projects/workspace` takes only an OpenCode project id. The
server looks the id up in its own project table and rejects `global` and the
Brain directory itself; it never accepts a renderer path. The renderer no longer
calls it.

Workspace Projects add three file surfaces:

- `POST /second-brain/projects/scan` writes only under the workspace's
  `.tenon/` (cards and `workspace.json`) through `LocationMutation`, lists
  folders without reading their content, and refuses to overwrite a manifest it
  cannot parse or read (only a missing manifest is created). It also writes
  `workspace-links.json` (linked folder -> workspace) in the server data
  folder; that file is a rebuildable cache. Folders named in a hand-edited
  manifest get the same checks as `link` below before they reach the cards or
  the index, and a folder another workspace already indexes keeps that entry,
  so one workspace's manifest cannot claim `/`, the home folder or another
  workspace's folders for its `AGENTS.md`. A card's `location.path` must stay
  inside the workspace (relative) or be one of those checked linked folders
  (absolute) before threads run there; otherwise threads use the card folder.
- `POST /second-brain/projects/link` is the one Second Brain route that takes
  an absolute renderer path. The server requires an existing directory that
  neither contains nor sits inside the workspace and is not, and does not
  contain, the home or app data folder, and only records it in the manifest; it never reads, moves or writes files in that folder. The renderer
  sends a folder the user picked in the folder dialog. Sessions can already run
  in any directory the renderer names, so this adds no new reach.
- `GET`/`PUT`/`DELETE /second-brain/instructions` read, write (64 KiB cap) and
  remove `AGENTS.md` in the request's directory only, through
  `LocationMutation`. A read refuses an `AGENTS.md` whose real path leaves the
  folder (a symlink) or that is larger than 256 KiB. Session instruction
  lookup applies the same rule: a discovered `AGENTS.md` must really live in
  the workspace, linked folder or project it was found in, and files over
  256 KiB are not injected. `AGENTS.md` is agent instructions: the app injects it
  into sessions in that workspace, and with the link index into linked folders
  too. A workspace's `AGENTS.md` therefore steers agents working in its linked
  folders. The app calls this route only from the Instructions dialog; an
  agent with file-edit permission can still change `AGENTS.md` like any other
  workspace file. The resulting card
stores that Workspace's worktree as `location.displayPath`, and
`GET /second-brain/project-threads` returns absolute thread directories the
same way session responses already return `directory`.

`tenon://open-project` and `tenon://new-session` deep links are validated
first in the Electron main process (`opencode/packages/desktop/src/main/deep-links.ts`):
only those two hosts are accepted, the `directory` must be an existing local
absolute folder (UNC `\\host\share`, protocol-relative `//host`, `file:`,
relative and `..` paths are refused before any filesystem call), and the user
confirms a native dialog that shows the folder. The renderer receives a link
rebuilt from the checked values, and the log records only `tenon://<host>`,
never the query string with its prompt. The app shell's sidebar controller
(`opencode/packages/app/src/components/sidebar/sidebar-controller.ts`) then
handles it, only on a local server. A deep link can open a folder as a workspace (and
select it) and start an unsent draft (a `new-session` prompt is placed in the composer,
never sent). It never runs `git init`; only a folder the user picks in the
folder dialog is initialized when empty.

Markdown front matter in notes, Project cards, skills and agent configs is
parsed through `Frontmatter.parse` (`opencode/packages/core/src/frontmatter.ts`),
which refuses gray-matter's `---js` engine (it would `eval` the block) and any
front matter over 64 KiB. Cards and the manifest over 1 MiB, notes over 5 MiB
and the calendar over 16 MiB are refused after a `stat`, before they are read.
The calendar lives at `.tenon/calendar-v1.json` inside the workspace, resolved
through `LocationMutation` like the other Second Brain files; a file left at the
old `.second-brain/calendar-v1.json` is moved there on the first read.

Workspace notes, projects, calendar files, session data, provider tokens, and
agent tool permissions are sensitive. Treat note contents, provider responses,
workspace files, URL input, and IPC arguments as untrusted. Keep file access
within the selected workspace and use the existing mutation services. Never
log credentials or full private content.

## Credentials, extensions, and recovery

Google token encryption is specific to the desktop integration. It does not
establish encryption for every provider credential store. Each connected Google
account is one entry in the main-owned `second-brain.google` store; the renderer
sees only account IDs, labels, addresses, access levels and write counts, never
tokens. Disconnecting an account revokes its refresh token and deletes its entry
and queued writes. An account ID from the renderer selects an existing account
only; an unknown ID is rejected (`google_account_not_found`). A build may compile
a Google "Desktop app" OAuth client ID and secret into the main process from
the git-ignored `opencode/packages/desktop/.env.local`
(`MAIN_VITE_GOOGLE_CLIENT_ID`, `MAIN_VITE_GOOGLE_CLIENT_SECRET`). Google treats
an installed app's client secret as non-confidential: anyone with the build can
read it, and it grants nothing without the user's consent in the browser. The
renderer only learns whether such a client exists. Keep the values out of git
and logs. Provider
credentials (`auth.json`, `mcp-auth.json`) and the session database
(`opencode.db`) live in the XDG data directory (by default
`~/.local/share/tenon-workbench/`), outside Electron `userData`. `userData` holds
drafts, electron-store files, logs, and server state. Treat both locations as
sensitive and exclude them from source control and release artifacts. Outside
Windows, the server sets the data directory to `0700` and `opencode.db`, its
`-wal`/`-shm` files and its pre-migration backups to `0600`. Failed-query errors
keep the SQL text but replace bound values with `[redacted]`, so logged defects
do not carry credentials or note text.

Configured plugins execute code in the local runtime. Dependency installation
and plugin initialization can therefore affect both access and startup time.
Review plugin origins and package changes, retain the Bun lockfile and local
patches, and do not treat a plugin as sandboxed workspace content. Build and
packaging scripts also download upstream binaries, as described in
[release operations](../release-operations.md). A plugin hook that throws or
runs longer than 30 seconds is logged and skipped, except `tool.execute.before`
and `command.execute.before`, which fail closed so a plugin can still block a
call by throwing. A timed-out hook is not cancelled and may keep running, and
can still change the hook output after the caller has moved on.

Workspace validation and agent tool permissions are different controls.
Keep the existing permission checks on tool execution; a user opening a note
does not authorize instructions embedded inside it. The V2 runner checks the
`doom_loop` permission before a third identical tool call in a row. Built-in
agents add a `doom_loop: ask` rule, but the agent's ruleset decides: an agent
that denies all actions resolves to deny, as in V1. The runner returns the
user's rejection feedback or the deny rule to the model. Destructive recovery
must preserve both canonical workspace files and session/draft profile state.

## Renderer content policy

Rendered Markdown drops every image and media source that is not `data:` or
`blob:` before it reaches the DOM (`session-ui/src/components/markdown-media.ts`),
so a note or model reply cannot beacon to a remote host.

The packaged renderer has no page-wide Content-Security-Policy yet. Design
previews run their own inline scripts in sandboxed `srcdoc` frames, and a
`srcdoc` frame inherits its parent's policy, so a `script-src 'self'` policy on
`index.html` would block them. Adding one needs the previews served from their
own origin first.

`file://` links (terminal output, Markdown) open with the default app only for
documents. Executables (Windows `PATHEXT` plus `.lnk`, `.hta`, `.msi`, `.scr`;
macOS `.app`, `.command`, `.terminal`, `.workflow`; any POSIX file with an
execute bit) and anything that cannot be inspected are revealed in the file
manager instead (`desktop/src/main/local-file-policy.ts`).

Packaged builds set Electron fuses in `desktop/electron-builder.config.ts`:
RunAsNode, `NODE_OPTIONS` and the `--inspect` flags are off, the app loads only
from `app.asar` with embedded integrity validation, and `file://` gets no extra
privileges. The sidecar runs through `utilityProcess`, so nothing needs
RunAsNode.

## Managed server controls

- **Bind guard.** `Server.listen` refuses a non-loopback hostname unless
  `OPENCODE_SERVER_PASSWORD` is set (`server/network-guard.ts`). The WSL
  sidecar listens on `127.0.0.1` inside the distro.

- **Child processes.** Terminals, agent shell commands, MCP stdio servers and
  LSP servers don't inherit `OPENCODE_SERVER_PASSWORD` or
  `OPENCODE_SERVER_USERNAME`. `ChildEnv.from` (`core/src/child-env.ts`) strips
  them in the cross-spawn spawner and `Process.spawn`, which apply it to every
  child environment. All other variables are still inherited.
- **Credential checks.** `ServerAuth.authorized` compares the username and
  password in constant time. `httpapi-route-auth-coverage.test.ts` sends an
  unauthenticated request to every declared HttpApi operation and expects 401.
- **Workspace proxy.** Requests forwarded to a remote workspace lose their
  `authorization` and `cookie` headers and the `auth_token` query parameter.
  Only the target's configured headers supply credentials.
- **CORS.** The allowlist is `oc://renderer` (exact match), numeric-port
  `localhost` and `127.0.0.1` origins for development, and origins passed to
  `Server.listen`. Tauri and `*.opencode.ai` origins are no longer trusted.
- **Body size.** The server rejects a declared request body over 32 MiB with
  413. Effect's `MaxBodySize` stops a streamed body at the same cap. The cap
  matches the session export limit and leaves room for base64 image
  attachments. `POST /log` truncates messages and drops oversized metadata.
- **CodeMode.** The `execute` tool runs with a 10 minute timeout, 100 child
  tool calls and 64 KB of output. The interpreter rejects `repeat` and `pad*`
  results longer than 16M characters.

## Outbound network endpoints

The shipped app, desktop, and server code no longer contacts `opencode.ai`
on its own. Removed in the T3 parity Phase 1 cleanup:

- the hosted UI proxy to `app.opencode.ai` (`server/shared/ui.ts`); without
  a bundled UI the server returns a local 404,
- the release-notes feed (`opencode.ai/changelog.json`),
- remote notification icons and the upstream project avatar (bundled
  `favicon-96x96-v3.png` is used instead),
- upgrade checks and installs in `installation/index.ts` (the service is
  inert; the desktop app owns updates),
- the WSL `curl https://opencode.ai/install | bash` path,
- Go/Zen upsell links in retry actions and the upsell dialogs,
- the `HTTP-Referer: https://opencode.ai/` header sent to providers,
- Help menu, sidebar, and error-page links to docs, Discord, and feedback.

Still outbound: the configured LLM providers (including the `opencode` Zen
provider when the user selects it), the `models.dev` catalog, Google APIs,
`api.anthropic.com/api/oauth/usage` for Claude Code usage limits (see
[Harness usage limits](#harness-usage-limits)), and links the user opens. `$schema` URLs in config files are identifiers, not
fetches. Known remaining references: upstream agent prompts that point the
model at `opencode.ai/docs`, the MCP OAuth `client_uri` metadata value, and
two help-text links printed by the developer-only `providers login` command.

Phase 8 removed the TUI and the upstream CLI commands that reached GitHub,
the OpenCode console, and share or install endpoints (`github`, `pr`,
`account`, `upgrade`, `uninstall`, `web`, `acp`, `attach`, `stats`, `plug`,
`export`, `import`). The remaining CLI in `packages/opencode/src/index.ts`
runs only from source for development (`serve`, `generate`, `mcp`, `debug`,
`providers`, `agent`, `models`, `session`, `db`) and isn't shipped.

## Harness CLI updates

Checking and installing harness CLI updates adds two capabilities:

- **Outbound calls.** The server fetches `<registry>/<pkg>/latest` from the
  user's configured npm registry, or runs `brew info`, for each enabled Codex
  or ACP harness, about once every six hours.
- **Package-manager runs.** The server runs `npm`, `bun`, or `brew` as the user.

The renderer sends only a harness ID to `POST /api/harness/upgrade/:id`. The
server derives the package name, prefix, and package manager from the resolved
path of that harness's configured command, and validates the name against npm
or Homebrew naming rules. Arguments are passed as an array with no shell.
Updates run only when the user clicks Update, and agents have no tool for them.

The package manager gets the app's full environment, not the harness allowlist,
because npm and brew need the user's proxy and registry settings. It runs
outside any workspace (cwd is the home directory). Output is not logged. A
failure shows the exit code and the last three lines of stderr.

Known gap: an update trusts the user's package registry and Homebrew taps the
same way a manual `npm install -g` or `brew upgrade` would. A harness whose
command path points into a `node_modules` folder the user doesn't control would
be updated from that package's registry entry.

## Built-in harness setup

The setup dialog ([ADR-013](../adr/ADR-013-built-in-harness-setup.md),
`opencode/packages/core/src/harness/setup.ts`) adds these surfaces:

- **Install.** `POST /api/harness/setup/:id/install` takes only a harness ID.
  - The npm package comes from a fixed recipe for the three built-ins, so no
    renderer string reaches npm.
  - npm runs as the user with the app's full environment (proxy and registry
    settings), from the home directory, with arguments as an array and no
    shell.
  - It trusts the user's npm registry, like a manual `npm install -g`.
- **Sign in.** Codex's browser login runs inside `codex app-server`, which
  holds the OAuth callback and stores the result in its own home. The app sees
  only the returned link. Claude Code and OpenCode log in through their own
  CLI in an app terminal, the same PTY capability the terminal panel already
  has. The app never stores their tokens; setup only checks that their
  login files exist (`oauthAccount` in `~/.claude.json`, a non-empty OpenCode
  `auth.json`). The usage route below reads Claude Code's OAuth token.
- **API keys.**
  - Codex keys go straight to Codex.
  - Claude Code and OpenCode keys are stored in plain text in
    `harness-credentials.json` (`0600`, atomic write) in the data folder, like
    provider keys in `auth.json`.
  - A key is added only to its own harness's environment, under one fixed
    variable name. No other harness or child process receives it.
  - The settings and setup routes never return a key, only which key option is
    stored.
  - Keys aren't validated when saved.

Known gap: anyone who can read the user's data folder can read stored harness
keys. That is the same exposure as `auth.json`; OS-keychain storage would need
the desktop main process.

## Harness usage limits

`GET /api/harness/usage` (`opencode/packages/core/src/harness/usage.ts`,
`HarnessRuntime.usage`) reports plan usage windows. It takes no input beyond
the location query and has the same auth as the other harness routes.

- **Claude credential read.** The server reads `claudeAiOauth.accessToken` and
  `expiresAt` from `$CLAUDE_CONFIG_DIR/.credentials.json` or
  `~/.claude/.credentials.json` on each uncached call. The token stays in the
  server process. It is never returned to the renderer, logged, written to disk
  or put in a URL; it is sent only in the `Authorization` header of the usage
  request. Expired tokens are not refreshed, and the app never writes the file.
- **Outbound call.** `GET https://api.anthropic.com/api/oauth/usage` with
  `anthropic-beta: oauth-2025-04-20`, at most once a minute per location
  runtime (the server caches each report for 60 s; the sheet asks at most once
  a minute while open). The response is parsed into percentages and reset
  times only.
- **Codex.** `account/read` and `account/rateLimits/read` go to the user's own
  `codex app-server`, which holds its own credentials; no token reaches the app.
- **Reports.** Error reasons are fixed strings or a short protocol message from
  the harness, never a token or response body.

Known gap: anything that can read the user's home folder can read the same
Claude credentials file. The app adds no new copy of it.

## Harness registration

A registered harness is a command that the app later runs as the user, with
the workspace as its working directory. Harnesses are registered only by the
user in Settings → Harnesses, through the authenticated local HTTP API
(`/api/harness/discover` and `/api/harness/registry`). Agents have no
registration tool, so workspace content or model output can't add a harness.

Test and Save run the typed command. The local API already lets authenticated
clients start processes through its PTY routes, so this adds no new kind of
capability. The following limits still apply:

- The ID is validated, and the command must resolve to an absolute executable
  file.
- Arguments are passed as an array with no shell.
- The process gets the filtered harness environment described below.
- The handshake times out and the process is stopped afterwards.

Test also calls `session/new` to list models, so some agents record an empty
session in their own history. The picker's first availability check after each
launch does the same once per harness.

The setup assistant's functional test (`/api/harness/verify`) also sends one
short prompt to the proposed agent. That costs one model call on the agent's
own credentials, and the test refuses every tool permission request. The
assistant's proposal is model output, possibly steered by text the assistant
read: the dialog shows the exact command and arguments and runs it only after
the user clicks "Test this command". Only a command the user already approved
is retested on its own. Shells, script interpreters, `env`, `sudo` and download
tools are refused outright (`harness-assistant-behavior.ts`). Second Brain runs
an approved command only through the verify route's limits above, and saving
still needs the user's Save click. Save runs the ACP `initialize` handshake again.
It writes `harnesses.json` (mode `0600`, atomic rename, serialized within the
process) only when the handshake succeeds. Enable/disable and remove change
only `harnesses.json` entries under the same lock. A malformed file is
reported and never overwritten, and built-in or config-file harnesses are
refused.

Thread titles send the thread's first user message to the title agent: the
thread's own harness, or the harness chosen in Settings → Harnesses. A chosen
harness may belong to a different provider than the thread, so that message
crosses to it; the choice is the user's, stored in `harness-preferences.json`
(atomic write) and read only from `/api/harness/title-agent`. The one-off
session gets no delegation endpoint and no thread history. Codex runs it as an
ephemeral, read-only thread with approvals off; ACP agents have every tool
request refused. An ACP agent may still keep that session in its own history
(for example Claude Code's session list).

The registry stores commands, arguments, and model IDs only. Agents can't
store environment variables or secrets in it, and it can't replace the
built-in `opencode`, `codex`, `opencode-acp` and `claude-code` instances. ACP agents get no client
file-system or terminal capability. Their own tool approvals arrive as
`session/request_permission` and use Second Brain permissions. Treat output
from an ACP agent as untrusted model output.

Known gap (partially closed): ACP and Codex harness processes no longer inherit
the app's full environment; they get a small launch allowlist (`PATH`, `HOME`,
locale, temp and terminal variables, `XDG_*`, Windows system variables) plus the
`env` set in user configuration for that harness. However, any API key or token
the user puts in that per-harness `env` is still visible to that harness, and
agent CLIs often need their own credentials that way. Register only agents
you'd trust with the credentials you configure for them.

### Cross-harness delegation

Agents can start work in another harness through the delegation endpoint
([ADR-011](../adr/ADR-011-cross-harness-delegation.md),
`opencode/packages/core/src/harness/delegation.ts`). Controls:

- The endpoint listens on `127.0.0.1` only, on its own port. Every request
  needs a bearer token (32 random bytes, compared in constant time). Each
  Codex or ACP runtime gets its own token, bound to the Run that owns the
  runtime, and the token is revoked when the runtime closes. A token can
  only act as that Run: list harnesses, and start, read or stop that Run's
  own child tasks.
- Requests that carry an `Origin` header get 403, so a web page can't drive
  the endpoint through the user's browser. Bodies are capped at 1 MB, and
  only `POST /mcp` is served.
- ACP agents get the token in the `session/new` request over their stdio.
  Codex gets it in the `TENON_DELEGATION_TOKEN` environment variable, so it
  stays out of the process arguments. A harness process can read its own
  token, as with any credential in its environment.
- A delegated task runs as a normal child Run on the target harness with that
  harness's usual approval flow. Delegation grants no permission the target
  wouldn't ask for anyway. Its approvals reach the delegating Run's composer.
- The built-in loop asks permission `delegate` before starting or stopping a
  task. Codex and ACP agents apply their own MCP tool policy to the call.
- A delegated agent may delegate once more (depth 2), and a Run may have at
  most four delegated tasks running, which bounds runaway fan-out and cost.
- The delegated agent receives only the task text the caller wrote, framed as
  a delegated task. The reply returns to the caller as tool output: it is
  untrusted model output and may carry text from workspace files.

The endpoint also serves `ask_user` and is now attached to every Codex and
ACP runtime, not only when delegation is on. With delegation off it lists
only `ask_user`. The same token rules apply: a token can only ask in its own
Run's session. `ask_user` has no permission check of its own (the native
`question` tool asks permission `question`); the harness's MCP tool policy
applies instead. Questions and options are model output shown as text in the
dock. Each runtime has at most one open question; a new question withdraws the
old one, and the end of the harness turn (finished, failed or stopped) or
closing the runtime withdraws what is still open. An answer the agent didn't
collect in that turn is dropped, so it can't answer a later turn's question.

Known gaps: interrupting a Run doesn't stop the tasks it delegated. An ACP
agent without HTTP MCP support gets neither delegation nor `ask_user`.

### Harness skill catalog

`GET /api/skill/catalog` reads `SKILL.md` frontmatter from fixed folders under
the user's home (`~/.codex/skills`, `~/.claude/skills`, `~/.agents/skills`,
`~/.config/opencode/skill(s)`), from `/etc/codex/skills`, and from the project
equivalents at each level from the request's location directory up to its
repository root. The location is the same validated scope the other location
routes use, and the walk never goes above the first directory holding `.git`.
Controls:

- Read-only. No shell runs and no harness process starts; the harness list
  comes from settings.
- Only skill names, descriptions and absolute paths reach the renderer. Skill
  bodies are read to parse frontmatter and are never returned or logged.
- Commands an ACP agent reports through `available_commands_update` are kept
  in memory per harness and shown as data. They are agent output: the app
  never runs them.
- Missing or unreadable folders are skipped. Folder scans follow symlinks, the
  same as Tenon's own skill loading, so a symlinked skill folder can expose
  the frontmatter of files outside these folders.

`POST /api/skill/enabled` is the only write. It accepts a skill name and a
boolean, refuses names that aren't one of Tenon's loaded skills, and writes
only `skills.json` in the Tenon config directory (mode `0600`, atomic rename,
serialized, never overwriting a malformed file). Harness skill folders are
never written. Switching a skill off only hides it from Tenon's agent; it isn't
a security control, since the skill file stays readable on disk.

### ACP subagent transcripts

An ACP agent's subagent text, reasoning and tool output are now stored on the
subagent's tool call (`provider.resultMetadata.acp.transcript`) and shown in
the agent tab. Treat it as untrusted model output: the tab renders text as
Markdown through the same sanitizing renderer as chat, and tool output as
plain text. Each subagent's transcript is capped at 100,000 characters, and
live checkpoints carry at most 50 entries without tool output, which bounds
what an agent can make the app store per subagent call.

### Upstream OpenCode harness

The built-in `opencode-acp` instance starts upstream OpenCode from `PATH` as
`opencode acp`, through the same ACP driver as registered agents. It is a
separate child process running as the user, and it gets the same treatment:

- It receives only the launch allowlist from `core/src/harness/env.ts`. No
  `OPENCODE_*` variables and no provider keys from the app reach it.
- It uses its own credentials, set up with `opencode auth login`.
- The client advertises no file-system or terminal capability. Its tool
  approvals arrive as `session/request_permission` and go through
  `PermissionV2`, so the user approves them in Tenon Workbench.
- Which binary runs depends on `PATH`. A different `opencode` earlier on
  `PATH` would run instead.
- Setup installs it from npm as `opencode-ai` (see
  [Built-in harness setup](#built-in-harness-setup)).

The built-in `claude-code` instance runs `claude-agent-acp` from `PATH` under
the same rules: allowlisted environment only, its own Claude Code login in
`~/.claude`, and tool approvals through `session/request_permission`. A
different `claude-agent-acp` earlier on `PATH` would run instead.

Resolved: Tenon Workbench's core `Global` paths now use the app name
`tenon-workbench` (`core/src/global.ts`), so Tenon Workbench and upstream OpenCode
no longer share `~/.config/opencode` and `~/.local/share/opencode`. On first
start, `core/src/legacy-storage.ts` copies the legacy folders once, including
`auth.json`, `account.json`, `mcp-auth.json` and the database. That copy
duplicates the credentials into the `tenon-workbench` folder; after it, each app
reads and writes only its own copy. The legacy folders are left unchanged and
still hold the original credentials. If the shared `opencode.db` contained
upstream OpenCode sessions, Tenon Workbench's copy contains them too.
Per-project `.opencode/` folders and `.git/opencode` are still shared by
design.

Resolved: the Electron app IDs are `io.github.torriider97.tenonworkbench[.dev|.beta]`
(`APP_IDS` in `desktop/src/main/index.ts`), separate from upstream OpenCode
Desktop's `ai.opencode.desktop[.dev|.beta]`. Electron `userData`
(electron-store files, logs, and server state via `XDG_STATE_HOME`) and the
Windows install identity no longer collide with an upstream install. Related
changes:

- The deep-link scheme is `tenon://`, so Tenon Workbench no longer
  registers for, or takes over, upstream's `opencode://` handler.
- Background CLI discovery (`desktop/src/main/background-cli.ts`) checks only
  Tenon Workbench's own `userData` folders and cannot attach to upstream OpenCode
  Desktop's background service.
- The upstream Tauri `.dat` import (`desktop/src/main/migrate.ts`), which read
  upstream OpenCode app data from `ai.opencode.desktop*` folders, was removed.
- Only the dev channel copies the old `ai.opencode.desktop.dev` `userData`
  (`desktop/src/main/user-data-migration.ts`). Beta and prod do not read the
  `ai.opencode.desktop` and `ai.opencode.desktop.beta` folders, which belong to
  upstream OpenCode Desktop. The copy leaves the old folder unchanged.

The in-window DOM event name `opencode:deep-link` is internal and unchanged.

### Harness handoff text

When a Codex or ACP harness takes over a Run, or returns to one, it gets earlier
messages as text (`renderCodexPrompt` in `packages/core/src/harness.ts`). That
text can include workspace content, other harnesses' output and tool results,
so it is treated as untrusted data:

- It sits inside a `<handoff-history>` block that says it is context only, not
  a new request, and carries no instructions. The new user message comes after
  the block. Any `</handoff-history>` inside a message is escaped so the
  content can't close the block early.
- It is bounded to 16,000 estimated tokens. Messages that don't fit are left
  out whole and counted.
- Tool calls and results become one-line summaries (name, command or path,
  status, exit code). Raw tool input and output, which may hold file contents
  or command output, aren't forwarded.
- A returning harness gets only the messages since it last took part.

The first prompt of a runtime also carries a `<tenon-context trust="data">`
block (`core/src/tenon-context.ts`). It sends workspace content that
previously stayed in Tenon's own system context to the external agent:

- The workspace, Project and thread folder paths, and the text of the AGENTS.md
  files in effect, taken from the request's system context. OpenCode's own
  agent prompt, skill and reference guidance, environment and date are left
  out.
- The block opens with a line saying the quoted folders and files are data:
  each AGENTS.md is the user's project conventions, not commands that override
  the user's messages or part of the block.
- Each AGENTS.md sits in its own `<agents-md path="…">` element (a `"` in the
  path becomes `&quot;`), so headings such as `## Abilities` in a cloned
  repository's file stay inside that file's element instead of reading as
  Tenon's sections.
- Instructions are bounded to 4,000 estimated tokens, most specific file
  first; a clipped file is marked truncated and files that don't fit are
  marked omitted. The marker is Tenon's, last inside the file's element.
- `<tenon-context`, `</tenon-context`, `<agents-md` and `</agents-md` (any
  letter case) in the content get a backslash after `<` before clipping, so
  the content can't open or close the block or an element, and clipping can't
  produce a tag.
- The abilities name `ask_user` only when the `tenon` MCP server is attached.
  An ACP agent that doesn't advertise `mcpCapabilities.http` gets no server,
  so it is told to ask in its reply instead.

Codex also receives the request's system context as `developerInstructions`
(`renderCodexInstructions`), which includes the AGENTS.md text, environment
and date. The `core/chat-display` entry, written for native agents and their
`question` tool, is cut out there so Codex gets one way to ask.

The wrappers are a prompt-level signal, not an enforcement boundary. A model may
still act on instructions in the history or the instructions text, so the
permission checks on its tools remain the control.

Availability probes start each enabled harness command for an `initialize`
handshake. Results are cached per instance configuration for 30 seconds so
picker refreshes don't relaunch every agent. The model lists harnesses report
and the last availability checks are also kept in `harness-models.json` and
`harness-probes.json` (without the CLI's error text) in the server data folder,
rebuildable caches. Their keys are SHA-256 hashes of the instance configuration,
which can carry API keys, so the files hold harness names, status and model
names but no configuration or keys; a file that doesn't decode is ignored. The renderer keeps the last harness list
per server and folder in its own storage (`harness.instances.v1`).

## Agent-authored SVG in chat

Agents can draw diagrams by writing a fenced code block tagged `svg`. Once the
fence is closed, `session-ui/src/components/svg-window.ts` shows it as a
diagram window in place of the code. The markup is model output and may
include workspace content, so it is untrusted:

- DOMPurify's SVG profile sanitizes it first. Scripts, event handlers,
  `<a>`, `<foreignObject>` and `<use>` are removed, and URL-valued attributes
  keep only fragment references (`#id`) and inline `data:` images.
- The result is shown in an `<iframe sandbox="">` (no scripts, opaque origin,
  no navigation, forms or popups) whose `srcdoc` carries the CSP
  `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`.
  No request leaves the frame. The SVG's own `<style>` rules apply only inside
  it.
- The renderer reads nothing back from the frame. Download saves the
  sanitized markup as `diagram.svg` through the browser download flow.

The guidance that tells agents about this, the design blocks and file
references (`core/src/chat-display.ts`) is fixed text with no workspace
content. It goes into the native system context and, inside
`<tenon-context>`, at the start of each harness runtime's first prompt.

## Agent-authored HTML designs in chat

Agents can show designs by writing a fenced block tagged `html` (an inline
window) or `html canvas` (an artboard in the Canvas tab). Unlike SVG, the page
keeps its scripts so designs can animate and respond, so the frame, not
sanitizing, is the control (`session-ui/src/components/design-fence.ts`,
`html-window.ts`, `app/src/pages/session/canvas-tab.tsx`):

- Frames get `sandbox="allow-scripts"` only (`DESIGN_SANDBOX`), set before the
  document and before the frame joins the page. No `allow-same-origin`, so the
  frame has an opaque origin and can't reach the renderer, its storage or
  `window.api`; no top navigation, popups, forms or modals.
- The `srcdoc` starts with the CSP `default-src 'none'; style-src
  'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src
  data:` (`DESIGN_CSP`), ahead of anything from the page, so the frame can't
  fetch, load remote resources or submit. After it come
  `x-dns-prefetch-control: off` and a guard script that makes
  `RTCPeerConnection`, `webkitRTCPeerConnection` and `RTCDataChannel`
  undefined, non-writable and non-configurable before any page script runs.
- Electron main sets `disable_non_proxied_udp` as the WebRTC IP handling
  policy of every app window (`desktop/src/main/windows.ts`); the app doesn't
  use WebRTC, and without a proxy this stops all UDP STUN/ICE traffic, also
  from frames nested inside a design.
- Only assistant text parts render `html` blocks as designs; tool output, user
  text, reasoning, subagent tabs and the note preview show them as code.
- Designs over 512 KB (UTF-8) show a notice instead of a frame.
- Inline windows post their content height. The renderer accepts a message
  only from a design frame's own window, with origin `"null"` and a finite
  number, clamps it to 48–720 px and sends nothing back. Canvas frames send
  nothing.
- The main window keeps `contextIsolation`, `sandbox` and no
  `nodeIntegrationInSubFrames`, so the preload never runs in frames. Electron
  main's `will-frame-navigate` handler drops any subframe navigation other than
  `about:srcdoc` and `about:blank` (`isSubframeDocumentURL` in
  `desktop/src/main/external-url.ts`), so a frame can't navigate itself to a
  page outside its CSP. It logs only the redacted URL and never opens it. This
  also covers the SVG frames.
- The existing permission handlers deny subframe origins (camera,
  notifications and so on), because they aren't the trusted renderer URL.

Known gap: the in-frame WebRTC guard is defence in depth only, because a page
can reach the constructors again through a nested frame it creates. There the
UDP policy still blocks STUN, but TURN over TCP (and the DNS lookup of its
host) could in theory leak what the page contains, which is model output that
may quote workspace content.

## File references in chat

Inline-code file and folder references in assistant text open files, or
reveal folders in the Files tree, in the right panel
(`session-ui/src/components/markdown-file-reference.ts`,
`app/src/pages/session/file-reference.tsx`). The reference is model output, so
the path is checked twice, the same way for files and folders, when the chip
is marked and again in the app handler before any read or listing: no `..`
segment, no leading `~`, no control
characters, no Windows drive-relative path (`D:x.ts`, which resolves against
that drive's current folder), and an absolute path only when it is inside the thread folder
(converted to relative; Windows paths compare case-insensitively). Reads go
through the existing file read, list and search APIs with relative paths, so
the server's own containment check (`FSUtil.contains`) still applies. Peeks
show at most 12 lines; a folder peek shows only its item count. Whether an
extensionless path is a file or a folder comes from the parent folder's
listing, never from the model's text; it is plain code until that listing (of
a top-level folder named by its first segment, then its parent) finds it, and
a missing entry opens nothing.

## Checks

From the repository root, `bun run typecheck` checks every workspace package
through turbo. `bun run test` runs every package suite except the engine
(core, server) and the client and schema suites, then the Second Brain
domains; `bun run test:engine` runs core and server suites. `bun run lint`
checks `opencode/`, and `bun run check:generated` fails when the generated
client is stale. These commands are defined in the root `package.json`.
Relevant focused tests include
`opencode/packages/desktop/src/main/google-calendar-domain.test.ts`,
`opencode/packages/opencode/test/project/brain.test.ts`,
`opencode/packages/session-ui/src/components/svg-window.test.ts`, and the note tests
under `opencode/packages/opencode/test/knowledge/`. Run server tests from
`opencode/packages/opencode` with Bun when changing those paths. These checks
run locally; GitHub Actions workflows are disabled. Local test results do not
establish cross-platform installer or signed-update safety.

Focused commands from `opencode/packages/opencode`:

```sh
bun run test ./test/knowledge ./test/planner ./test/project/brain.test.ts
bun run test ./test/server/httpapi-instance-route-auth.test.ts ./test/server/httpapi-ui.test.ts
```

From `opencode/packages/desktop`:

```sh
bun test src/main/google-calendar-domain.test.ts src/main/attachment-picker.test.ts src/main/external-url.test.ts
```

This is a source-level map of the controls found during setup, not a security
audit. Recheck the implementation and its tests before changing a boundary.

## Session export boundary

`save-session-export` accepts a JSON string and a basename, not a renderer
filesystem path. Main validates the basename, JSON syntax, and a 32 MiB size
limit, then asks the user to choose the destination with Electron's native
save dialog. Cancellation returns false; success follows the completed write.
This operation does not grant general renderer write access. Exports contain
private session content and are written only to the destination chosen by
the user. The IPC handler delegates validation and writing to
`packages/desktop/src/main/session-export.ts`.

Native session fork and diff endpoints use the existing session-location
middleware and authenticated HTTP boundary. Forks receive new message IDs;
opaque provider continuations and assistant filesystem snapshots are excluded
from the copied history. Review snapshots remain scoped to the session's
location and canonical Git worktree.

## Known gaps

Found during the 2026-10-02 scope audit. Paths are relative to
`opencode/packages/desktop/src/main/`. Entries move back into the model once a
fix lands.

- `open-path` (`ipc.ts`) opens any renderer-supplied absolute path.
  `reveal-path` reveals any existing absolute path. Neither uses a workspace ID
  or validated relative path. As of the 2026-10 batch-1 hardening, `open-path` no longer
  executes renderer-supplied application paths (main resolves an application
  name through the registered-application lookup), and both handlers require
  absolute paths. Arbitrary-path opening from a compromised main-frame renderer
  remains open until the workspace-ID contract lands.
- `store-*` handlers accept only the renderer's own store files, `default.dat`
  and `opencode.<scope>.dat` (`store-name.ts`). Renderer input can't create or
  escape files under `userData`, and can't read or write main-owned stores
  such as `opencode.settings`, `opencode.updater`, `second-brain.google` or
  Chromium `Preferences`.
- Every IPC handler, including the WSL handlers in `wsl/ipc.ts`, checks
  `event.senderFrame` against the trusted main frame through the shared
  `trustedHandle`/`trustedOn` wrappers in `ipc.ts`. Before the 2026-10
  desktop IPC hardening, the WSL handlers used raw `ipcMain.handle`.
- WSL distro names from the renderer must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`
  (`wsl/policy.ts`); probe lists skip names that don't. The "open terminal" action still goes through
  `cmd.exe /c start` to get its own console window, so the allowlist is what
  keeps cmd metacharacters out of that command line.
- Draft IPC accepts only string keys and values and caps one attachment blob
  at 64 MiB (`draft-store.ts`).
- Server authorization also accepts an `auth_token` query parameter, so the
  credential can appear in URLs. Desktop main-process logs record only the
  scheme and host of blocked and rejected URLs, never the query string. The
  parameter is not yet restricted to SSE and WebSocket routes. The
  desktop no longer records a Chromium NetLog, which captured full URLs, and
  the debug-log export skips any `.netlog` file. Packaged builds don't copy
  renderer console output into the log files, and no terminal console
  messages are written to `pty.log`.
- Renderer sourcemaps are built as hidden maps and excluded from the packaged
  app. The macOS entitlements no longer request microphone access. They still
  include `allow-jit`, `allow-unsigned-executable-memory`,
  `disable-executable-page-protection`, `allow-dyld-environment-variables` and
  `disable-library-validation`; check which ones the runtime and native modules
  need before removing any.
- `drafts.sqlite` stores unsent draft content unencrypted in the profile.
