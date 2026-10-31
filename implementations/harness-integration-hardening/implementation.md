# Harness integration hardening

Tenon Workbench runs Codex (`codex app-server`), Claude Code
(`claude-agent-acp`), OpenCode (`opencode acp`), user-registered ACP agents and
the built-in OpenCode loop in one thread model. A review on 2026-10-30 (four
read-only passes over credentials, rendering, session state, and files and
processes) found about 40 ways the combination breaks. This package fixes the
highest-impact ones in five phases, one pull request each.

The plan author also implements the code. Both test sets exist, but the
verification set is a separately designed set of checks, not independently
authored or hidden.

## Problem and expected behavior

| # | Before | After |
| - | ------ | ----- |
| 1 | A thread that ran Codex or Claude Code tools, then switched to the built-in agent on Anthropic, OpenAI Chat or Gemini, fails every request: "Anthropic Messages does not know how to round-trip server tool result for command_execution". | The earlier harness tool calls reach the new model as plain text; the request goes through. |
| 2 | A Codex or Claude Code process that exits while the thread is idle makes the next message spin forever. | The next message fails at once with "… exited." and the one after it starts a fresh process. |
| 3 | A Codex resume that fails with an unrecognised error, or a 60 s timeout, fails every later turn on that thread. | Any failed resume falls back to a fresh Codex thread with the conversation handed over. |
| 4 | While an ACP harness's model list is still loading, the thread's chosen model is reset to nothing. | The chosen model is kept until the harness reports a non-empty list that lacks it. |

Phases 2–5 follow the same pattern; their before/after rows are in each
phase section.

## Scope

All paths are under `opencode/packages/` unless noted.

Phase 1 (thread breakers):

- `core/src/session/runner/to-llm-message.ts`: `assistant()` replays
  provider-executed tool calls as provider parts only to the same provider.
- `core/src/harness/codex-app-server.ts`: the shared JSON-RPC client (Codex and
  ACP) records that it is closed, fails later requests at once, and exposes
  `closed`.
- `core/src/harness/acp.ts`: `Session.closed`.
- `core/src/harness.ts`: `getRuntime` and `getAcpRuntime` replace a cached
  runtime whose client is closed; Codex thread setup (`openCodexThread`) falls
  back to `thread/start` after any failed resume.
- `app/src/components/prompt-input/harness-controller.ts`: model
  reconciliation (`reconcileHarnessModel`) skips empty model lists and running
  turns.

Phases 2–5: listed in their sections.

Exclusions: no new dependencies, no change to the stored session schema, no
change to how the built-in agent talks to providers beyond history replay.

Invariants:

- A tool call that the same provider executed is still replayed as a
  provider-executed part to that provider (server tools such as Anthropic web
  search keep round-tripping).
- File references and paths stay confined to the thread folder.
- Codex's sandbox and approval settings are unchanged.

## Feature map

```text
Composer (harness-controller) ──selects harness+model──▶ session.harnessModel
Runner (session/runner/llm.ts) ──usesHostModel?──▶ built-in: toLLMMessages(history) ─▶ llm protocols
                                             └──▶ harness: HarnessRuntime.stream
HarnessRuntime (harness.ts)
  ├─ Codex: getRuntime ─▶ makeRuntime ─▶ codex app-server (JSON-RPC client) ─▶ thread/resume|start
  └─ ACP:   getAcpRuntime ─▶ AcpHarness.open ─▶ agent CLI (JSON-RPC client) ─▶ session/load|new
History: harness turns are published with providerID = harness instance ID and
providerExecuted tool calls (publish-llm-event.ts:385).
```

Affected consumers: every thread that switches between the built-in agent and
an external harness; every external-harness thread whose process exits; Codex
threads with stored continuations; the composer's model picker.

![Current: five failure points across composer, runner, history replay and the harness runtime](diagrams/current.svg)

![Proposed: cross-provider replay as text, closed-client detection, resume fallback, model kept while loading](diagrams/proposed.svg)

![Phase 1 detail: functions changed and the acceptance criteria each one serves](diagrams/detail.svg)

## Acceptance criteria

Phase 1:

- **AC-1** Given an assistant message whose `model.providerID` differs from the
  target model's provider and that contains a completed provider-executed tool
  call, `toLLMMessages` returns no tool-call or tool-result parts for it; the
  assistant message instead contains a text part naming the tool and its
  status. A completed call's text output is included, capped at 2,000
  characters. For a message from the same provider, provider-executed calls
  are still replayed as tool-call plus tool-result parts.
- **AC-2** After the connection's stdout ends, the JSON-RPC client's `closed`
  is true, and a request made afterwards fails within one scheduler turn with
  a `ProtocolError` whose message contains "exited", instead of waiting. Before
  stdout ends, `closed` is false.
- **AC-3** `getRuntime` and `getAcpRuntime` never return a cached runtime whose
  client is closed; they close it and open a new one. (Code review and AC-2;
  no automated test.)
- **AC-4** Codex thread setup with a stored continuation: when `thread/resume`
  fails with any error, it requests `thread/start` with the same parameters
  and reports `resumed: false`. A successful resume reports `resumed: true`
  and does not call `thread/start`. With no continuation it calls only
  `thread/start`.
- **AC-5** Model reconciliation for an available external harness keeps the
  current model when the harness reports no models, and when a turn is
  running. It resets to the harness default only when the harness lists
  models and none matches the current one. The built-in loop still clears the
  harness model.

Phase 2 (safety):

| Before | After |
| ------ | ----- |
| A cloned repo's `opencode.json` or `.opencode/` could define a harness whose command the app ran on its availability check. | Only global config (and the Settings registry) can define harnesses. |
| OpenCode ran edits and commands without asking (its default is allow); Codex asks. | OpenCode asks before edits and commands, unless the user set OpenCode permissions in their own global config. |
| A Claude Code session started in `bypassPermissions` ran every tool without a Tenon approval. | The app switches it to `default`. |
| A stored Anthropic key in Claude Code's environment reached every command it ran. | Claude Code scrubs credentials from its subprocess environment when the app injects a key. |

- **AC-6** `configuredInstances` and `settingsEntries` take the global config
  folder and read `harnesses` only from config documents inside it. A
  harness defined in a project document is absent from both. Built-in IDs stay
  protected as before.
- **AC-7** `openCodeLaunchEnv(userConfig)` returns
  `OPENCODE_CONFIG_CONTENT` with `permission.edit` and `permission.bash` set to
  `ask` when the user's global OpenCode config text has no `permission` key
  (or there is no such file); it returns nothing when the user set
  `permission`. The OpenCode harness's launch environment includes it unless
  its configured `env` already sets `OPENCODE_CONFIG_CONTENT`.
- **AC-8** `safeAcpMode(modes)` returns `"default"` when the agent reports
  current mode `bypassPermissions` and lists a `default` mode; otherwise it
  returns nothing. After opening a session the app requests
  `session/set_mode` with that mode.
- **AC-9** `keyEnvironment` for Claude Code with a stored Anthropic key
  returns the key and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`; other harnesses'
  key environments are unchanged.

Phase 3 (lost information):

| Before | After |
| ------ | ----- |
| An image attached to a Codex or Claude Code turn arrived as the text `[Attached x.png]`. | Images go to Codex as `image`/`localImage` input and to ACP agents that accept images as `image` blocks; local files go to ACP agents as `resource_link`. |
| A Claude Code edit showed "Edited path" and raw JSON. | The edit view shows the before/after diff. |
| Claude Code's todo list and Codex plans were invisible. | They show as the todo list the built-in agent uses. |
| Claude's `Task`/`Agent` calls were generic rows, and their inner tools spilled into the parent turn. | They are subagent rows; their tools stay inside. |
| Codex and ACP command output rendered as Markdown and lost everything after 32,000 characters. | It uses the shell view (plain text, ANSI stripped) and keeps the start and the end. |
| A Codex file change showed escaped JSON. | It shows each file's diff as text. |

- **AC-10** `codexInputItems(prompt, media)` returns the text item followed by
  `{ type: "image", url }` for each `data:image/…` attachment and
  `{ type: "localImage", path }` for each `file://` image. `acpPromptBlocks(text,
  media, capabilities)` returns the text block, then `{ type: "image",
  mimeType, data }` for `data:image/…` attachments when
  `capabilities.image` is true, and `{ type: "resource_link", uri, name,
  mimeType }` for `file://` attachments. Attachments a target can't take are
  left out (the text still names them). Codex and ACP turns send the
  latest user message's attachments this way.
- **AC-11** An ACP tool update whose content holds `diff` items produces a
  result with `providerMetadata.acp.diffs` `[{ path, oldText, newText }]`. In
  the app, an `acp_edit` tool with one diff renders through the `edit`
  renderer with `input.filePath` and `metadata.filediff` `{ file, before,
  after }`.
- **AC-12** An ACP `plan` update and a Codex `turn/plan/updated`
  notification each produce a provider-executed `todowrite` tool call and
  result whose input is `{ todos: [{ content, status }] }` (Codex
  `inProgress` becomes `in_progress`).
- **AC-13** An ACP tool call named `Task` or `Agent` (any case) is
  `acp_subagent`. An update whose `_meta.claudeCode.parentToolUseId` names
  a known subagent call is recorded as that subagent's step and emits no
  top-level tool event.
- **AC-14** In the app, `command_execution` and `acp_execute` render with the
  `shell` renderer. Harness tool output longer than 32,000 characters keeps
  the first 8,000 and the last 24,000 characters with a marker naming how
  many were left out.
- **AC-15** A Codex `fileChange` item's output lists each change as
  `<path> (<kind>)` followed by its diff text, with no JSON escaping.

Phase 4 (environment and sign-in):

| Before | After |
| ------ | ----- |
| Behind a proxy or TLS-inspecting firewall, harnesses couldn't connect: proxy and CA variables were dropped. | Proxy and CA variables pass through, and loopback is added to `NO_PROXY` so the app's own MCP endpoint is never proxied. |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, Bedrock/Vertex and base-URL settings from the shell were dropped, so a harness read a different login or provider than the terminal. | They pass through. |
| `git push` over SSH and shell selection broke in harness threads (`SSH_AUTH_SOCK`, `SHELL` dropped). | They pass through. |
| A signed-out ACP agent failed with a raw protocol error. | The error says the agent needs a sign-in and where to do it. |
| A slow `.zshrc` (over 5 s) left the app with the bare system PATH, so every harness looked "not installed". | A timed-out interactive probe falls back to a login probe, and when both fail, common install folders are added to PATH. |

- **AC-16** `harnessEnvironment` passes, when set: `HTTP_PROXY`,
  `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (either case), `NODE_EXTRA_CA_CERTS`,
  `SSL_CERT_FILE`, `SSL_CERT_DIR`, `REQUESTS_CA_BUNDLE`, `GIT_SSL_CAINFO`,
  `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `ANTHROPIC_BASE_URL`,
  `OPENAI_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`,
  `AWS_PROFILE`, `AWS_REGION`, `AWS_DEFAULT_REGION`, `CLOUD_ML_REGION`,
  `ANTHROPIC_VERTEX_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `SHELL`,
  `SSH_AUTH_SOCK`, `EDITOR`, `VISUAL`, `COLORTERM`, `LC_CTYPE`. API keys and
  tokens (`*_API_KEY`, `*_TOKEN`, `AWS_SECRET_ACCESS_KEY`) are still not
  passed from the app's environment. When a proxy variable is set, the
  result's `NO_PROXY` and `no_proxy` include `127.0.0.1`, `localhost` and
  `::1`.
- **AC-17** An ACP turn that fails with error code `-32000`, or with a message
  saying authentication is required or the agent is not signed or logged in,
  reports an error that says the agent needs a sign-in and names Settings →
  Harnesses. Other failures keep their message.
- **AC-18** `loadShellEnv` tries `-l` after an `-il` probe times out.
  `fallbackPath(path, home)` returns the path with `/opt/homebrew/bin`,
  `/usr/local/bin`, `~/.local/bin`, `~/.bun/bin` and `~/.opencode/bin`
  appended when missing (existing entries keep their order); the desktop app
  applies it when no shell environment loaded.

Phase 5 (housekeeping):

| Before | After |
| ------ | ----- |
| Every thread that used Codex or an ACP harness kept its CLI process until the app quit. | A runtime idle for 30 minutes with no turn running is closed; its next message reconnects. |
| ACP model discovery opened a session in the user's project folder every 10 minutes, filling the CLI's own history. | Discovery runs in the app's state folder. |
| After the app reopened a Claude Code session, its next turn recorded the session's whole lifetime cost. | The cost replayed by `session/load` is the baseline. |
| Codex got AGENTS.md twice (developer instructions and `<tenon-context>`) plus instructions for a skill tool it doesn't have. | AGENTS.md once, in developer instructions; no skill or reference guidance. |

- **AC-19** `idleRuntimeKeys(activity, now, ttl)` returns the keys whose last
  use is more than `ttl` ago and that have no turn running. The harness layer
  marks a runtime used when a turn starts and ends, and every minute closes
  the runtimes `idleRuntimeKeys` returns for a 30-minute `ttl`.
- **AC-20** ACP model discovery runs with the working directory
  `<state>/harness-discovery`, not the thread folder. (Code review.)
- **AC-21** `replayedCost(notifications)` returns the USD cost of the last
  `usage_update` among replayed `session/update` notifications, or
  undefined. A loaded session starts with that as its cost baseline.
- **AC-22** `renderCodexInstructions` drops the skill guidance block
  ("Skills provide specialized instructions…" through `</available_skills>`
  or "No skills are currently available.") and the project reference block
  (through `</available_references>`), and keeps everything else, AGENTS.md
  included. A Codex handoff's `<tenon-context>` has no `<agents-md>`
  elements and says the instructions are in the developer instructions. ACP
  handoffs are unchanged.

Phase 6 (remaining review items):

| Before | After |
| ------ | ----- |
| After Stop, a Codex or ACP approval prompt stayed in the dock; answering it replied to a request the agent had abandoned. | The turn's end withdraws the prompt and answers the agent with a denial (ACP: cancelled). |
| A failed ACP model switch was ignored; the turn ran on another model while the thread recorded the chosen one. | The turn fails and names the model it could not switch to. |
| Codex turns counted only their last model call's tokens; the context ring mixed turn totals and context size. | Codex usage is the turn's share of the thread total; harness messages store the context in use, and the ring uses it. |
| Signing in to a harness in the terminal didn't reach threads already open; their next message still failed. | When a harness changes from signed out to signed in, its open runtimes are closed and reconnect signed in. |
| On Windows, an npm-installed harness (a `.cmd` shim) was reported as "not installed with npm". | The shim maps to `<npm folder>/node_modules/<package>`. |
| Harness processes are started detached; after a sidecar crash they kept running. | The app records each harness PID and ends leftover ones at the next start. |
| Folders that aren't git repositories had no undo and no live Files updates. | They get snapshots in a private git folder and a file watcher, except the home folder or a filesystem root. |
| Reverting one thread could overwrite edits another thread made later to the same file. | A file changed since the thread's last step that touched it is left alone. |

- **AC-23** `turnGate()` gives `guard(effect, fallback)`: while the turn runs it
  returns the effect's result; when `end` runs first it returns `fallback` and
  interrupts the effect. Codex and ACP approvals run through their runtime's
  gate, which each turn begins and ends. `PermissionV2.assert` interrupted
  while waiting publishes a `reject` reply for its request.
- **AC-24** When an ACP agent rejects `set_config_option` or `set_model` for the
  requested model, the turn fails with an error naming that model. (Code
  review.)
- **AC-25** Codex usage for a turn is the increase of `tokenUsage.total` over
  the turn (the first update's `total` minus its `last` is the starting
  point); `usage.providerMetadata.harness.contextUsed` is the last call's input
  plus output tokens. A harness step's `contextUsed` is stored on the assistant
  message; the app's context meter divides it by the window when present,
  otherwise the token total as before.
- **AC-26** `newlySignedIn(previous, current)` returns the harness IDs whose
  auth went from anything else to `signed-in` or `api-key` between two setup
  reads (none on the first read). The setup read closes those harnesses'
  runtimes and clears their cached checks.
- **AC-27** `sourceFromPath(file, packageName)` returns an npm source with
  `packageDir` `<dir>/node_modules/<packageName>` when `file` is a `.cmd`,
  `.ps1` or extensionless shim in a folder named `npm` or `nodejs`.
- **AC-28** The harness PID ledger records a spawned harness's PID and
  command and removes it when the process closes. `reap(entries, running,
  kill)` ends each recorded PID still running its recorded command and
  returns them; others are dropped from the ledger without a kill.
- **AC-29** `isBroadFolder(dir, home)` is true for the home folder and a
  filesystem root. A thread folder that isn't in a git repository and isn't
  broad gets snapshots (capture and restore work) and a file watcher.
- **AC-30** Before a revert restores files, any file whose current content
  differs from the end snapshot of the latest step in this thread that touched
  it is left out (`withoutChangedFiles`), and a warning names them.

## Implementation sequence (Phase 1)

1. Client `closed` (AC-2), then `Session.closed` and the runtime caches (AC-3).
2. `openCodexThread` with unconditional fallback (AC-4); remove the
   error-text matcher if nothing else uses it.
3. `toLLMMessages` cross-provider text replay (AC-1).
4. `reconcileHarnessModel` and its use in the controller effect (AC-5).

Steps are independent; each has its own tests.

## Verification

Run from the repository root.

Core sets:

```sh
cd opencode/packages/core && bun test ../../../Implementations/harness-integration-hardening/acceptance/core
cd opencode/packages/core && bun test ../../../Implementations/harness-integration-hardening/verification/core
```

App sets:

```sh
cd opencode/packages/app && bun test --conditions=solid --preload ./happydom.ts ../../../Implementations/harness-integration-hardening/acceptance/app
cd opencode/packages/app && bun test --conditions=solid --preload ./happydom.ts ../../../Implementations/harness-integration-hardening/verification/app
```

The `node_modules` links in each set folder point at the package's own
`node_modules`; they are local and not committed.

Repository checks: `bun run typecheck`, `bun run lint`, `bun run test`,
`bun run test:engine` (core changes), `bun run build`. Known failures on
`main` before this work, not regressions: `app` i18n parity (`hr.ts`
invalid), `opencode` knowledge note tag round-trip, `core` FileMutation rename
retry.

Manual checks: rebuild and install the Mac app; confirm no server or renderer
errors at launch.

## Completion evidence

### Phase 1 (thread breakers), 2026-10-30

Plan author and implementer are the same agent, so "verified" below means
the checks were run against the change, not that someone else ran them.

| Criterion | Evidence | Result |
| --------- | -------- | ------ |
| AC-1 | `acceptance/core/ac1-cross-provider-replay.test.ts`, `verification/core/replay.verify.test.ts`; existing `test/session-runner-message.test.ts` (same-provider replay) | pass |
| AC-2 | `acceptance/core/ac2-closed-client.test.ts`, `verification/core/client.verify.test.ts`; existing `test/codex-app-server.test.ts` | pass |
| AC-3 | Code review: `getRuntime`/`getAcpRuntime` check `client.closed` / `session.closed`; the existing prefix loop closes the stale runtime before reopening | reviewed, not automated |
| AC-4 | `acceptance/core/ac4-codex-resume.test.ts`, `verification/core/resume.verify.test.ts` | pass |
| AC-5 | `acceptance/app/ac5-model-reconcile.test.ts`, `verification/app/model.verify.test.ts`; existing `src/components/prompt-input` tests (81 pass) | pass |

Baseline before implementation: every new test failed for the missing
behavior (AC-1 on its assertion "tool parts present"; AC-2 on the missing
`closed`; AC-4 and AC-5 on the missing exports).

Corrections during implementation:

- `openCodexThread` built its `thread/start` request eagerly; the AC-4 fake
  client recorded the call before the resume. Fixed in code (`Effect.suspend`).
- `replay.verify.test.ts` counted the letter `x`, which also appears in the
  tool name `command_execution`, so it measured more than the output the
  2,000-character cap applies to. The test now counts `q`; the assertion is
  unchanged. This is the only test file that differs from the recorded
  baseline checksums.

Repository checks (from the repository root): `bun run typecheck`, `lint`,
`check:generated`, `build` pass. `bun run test`, `test:second-brain` and
`test:engine` fail only on the three failures known on `main` (i18n parity
`hr.ts`, knowledge note tag round-trip, FileMutation rename retry).

Manual: rebuilt and installed the Mac app; no server `ERROR` lines and no
renderer error log at launch. Not exercised live: a harness process exiting
mid-thread, a real Codex resume failure, and a built-in turn after a
harness turn against a live provider; these are covered only by the tests
above.

Diagrams: the shipped change matches `proposed.svg` and `detail.svg`; the one
addition is the second closed check after a request registers (a race the
first check alone left open), inside the AC-2 box.

### Phase 2 (safety), 2026-10-30

| Criterion | Evidence | Result |
| --------- | -------- | ------ |
| AC-6 | `acceptance/core/ac6-project-harnesses.test.ts`, `verification/core/safety.verify.test.ts` (`.opencode` inside a repo, a look-alike sibling of the global folder, registry unaffected) | pass |
| AC-7 | `acceptance/core/ac7-ac9-launch-env.test.ts`, verification JSONC case with a commented-out `permission` | pass |
| AC-8 | same files; checked against the installed claude-agent-acp: `buildAvailableModes` always offers `default` and lists `bypassPermissions` only when allowed | pass |
| AC-9 | same files; OpenCode keys unchanged, no key gives no env | pass |

Baseline: AC-6 and AC-9 failed on their assertions (project harness present;
scrub flag missing); AC-7 and AC-8 on missing functions; the two checks of
unchanged behavior passed.

Existing test adapted to the new contract: `test/harness-acp.test.ts` now
passes the global config folder to `configuredInstances` and gives its
config document a path inside it; its assertions are unchanged. Plan test
files match their recorded checksums.

Path-less config documents (inline `OPENCODE_CONFIG_CONTENT` the user set)
still count as global. The installed `opencode` v2.2.0 binary reads
`OPENCODE_CONFIG_CONTENT` but not `OPENCODE_PERMISSION`, so the former is
used.

Repository checks: typecheck, lint, check:generated, build pass; `test`,
`test:second-brain`, `test:engine` fail only on the three known failures.
Not exercised live: an OpenCode harness edit prompting in Tenon, and a
Claude Code session leaving bypass mode.

### Phase 3 (lost information), 2026-10-30

| Criterion | Evidence | Result |
| --------- | -------- | ------ |
| AC-10 | `acceptance/core/ac10-15-lost-info.test.ts`; verification: agent without image support, non-image data, Codex non-image file | pass |
| AC-11 | core: `providerMetadata.acp.diffs`; app: `acceptance/app/ac11-ac14-render.test.ts` (filePath, filediff, `acp_edit` → `edit`), `verification/app/render.verify.test.ts` (two diffs keep the generic input; a running edit has no diff) | pass |
| AC-12 | ACP `plan` and Codex `turn/plan/updated` → `todowrite`; verification: two updates are two calls | pass |
| AC-13 | `Task` with a child carrying `parentToolUseId` → one top-level call; verification: lowercase `agent`, unknown parent stays top-level | pass |
| AC-14 | `toolRendererName` maps both command tools to `shell`; head/tail clipping for ACP and Codex | pass |
| AC-15 | Codex `fileChange` path/kind/diff text, including a change without diff text | pass |

Baseline: core files failed on the missing `codexInputItems` export; the app
acceptance file on the missing `tool-alias` module. The app verification
file passed on the baseline (it checks the edit mapping is not over-applied).

Test design change before implementation: the app acceptance test first
imported `message-part.tsx`, which imports a Vite worker URL bun cannot load
(a setup failure, not a behavior failure). The renderer choice moved into
`session-ui/src/components/tool-alias.ts`, which `getTool` uses, and the test
imports that; its assertions cover the same mapping.

Additional change found while implementing: `acp_edit` joins `edit` and
`write` in the `path` → `filePath` input normalization, so the edit view has a
file name while an edit runs or when it reports several diffs.

Repository checks: typecheck, lint, check:generated, build pass; the test
suites fail only on the three known failures. Plan test files match their
recorded checksums. Not exercised live: a real image reaching Codex or
Claude Code, a Claude Code TodoWrite plan, a Claude `Task` subagent, and an
ACP edit diff rendered in the running app.

### Phase 4 (environment and sign-in), 2026-10-30

| Criterion | Evidence | Result |
| --------- | -------- | ------ |
| AC-16 | `acceptance/core/ac16-17-env-auth.test.ts` (variables pass, keys and tokens don't, loopback in `NO_PROXY`); verification: lowercase proxy, no invented `NO_PROXY`, per-harness config still wins; existing `test/harness-env.test.ts` | pass |
| AC-17 | `-32000` → sign-in message naming Settings; verification: "Not logged in · Please run /login" without a code, other errors unchanged; existing ACP tests | pass |
| AC-18 | `acceptance/desktop/ac18-path.test.ts`, `verification/desktop/path.verify.test.ts`; existing `src/main/shell-env.test.ts` | pass |

Desktop set command: `cd opencode/packages/desktop && bun test ../../../Implementations/harness-integration-hardening/<set>/desktop`.

Baseline: core tests failed on their assertions; desktop tests on the missing
`fallbackPath`; the per-harness override check passed (existing behavior).

Not automated: the `-l` retry after an `-il` timeout inside `loadShellEnv`
(it spawns real shells) and applying `fallbackPath` in `preferAppEnv`
(Electron `app`); both are covered by code review. A timed-out interactive
probe can now add up to 5 s more before the server starts.

Repository checks: typecheck, lint, check:generated, build pass; the test
suites fail only on the three known failures. Plan test files match their
recorded checksums. Not exercised live: a proxy, Bedrock/Vertex, or
`CLAUDE_CONFIG_DIR` setup, and a signed-out ACP agent.

### Phase 5 (housekeeping), 2026-10-30

| Criterion | Evidence | Result |
| --------- | -------- | ------ |
| AC-19 | `acceptance/core/ac19-22-housekeeping.test.ts` (`idleRuntimeKeys`); verification: exactly at the limit, empty map. The sweep and the per-turn `tracked` wrapper: code review | pass |
| AC-20 | Code review: discovery uses `<state>/harness-discovery`, created at layer start | reviewed, not automated |
| AC-21 | `replayedCost`; verification: no usage, non-USD, empty | pass |
| AC-22 | skill block dropped, AGENTS.md kept in developer instructions, Codex block without `<agents-md>`, ACP block unchanged; verification: empty skill list and reference block, surrounding text kept; existing `test/harness.test.ts` Codex instructions test unchanged and passing | pass |

Baseline: both files failed on the missing `idleRuntimeKeys` export, which
also hid the AC-22 assertions from the baseline run.

Design choice recorded: the review suggested removing AGENTS.md from Codex's
developer instructions; this keeps it there (it persists with the Codex
thread, and an existing test requires it) and removes the `<tenon-context>`
copy instead. Codex's own native AGENTS.md loading still applies and is not
changed here.

Repository checks: typecheck, lint, check:generated, build pass; the test
suites fail only on the three known failures. Plan test files match their
recorded checksums.

### Final verification across all phases

All plan tests on the final branch: core 50 pass, app 9 pass, desktop 3
pass, 0 fail. Installed Mac app from the final branch: no server `ERROR`
lines and no renderer error log at launch; Codex, Claude Code and OpenCode
checks report `available`.

Open items from the review not addressed in this package: pending approval
prompts are not withdrawn when a turn is stopped; a failed ACP model switch
is still ignored; Codex token totals use the last call only and the context
ring doesn't use `contextUsed`; terminal logins don't restart open
runtimes; Windows `.cmd` shim update detection; harness processes are
spawned detached; undo and the file watcher still need a git repository;
concurrent threads in one folder can revert each other's edits.

### Phase 6 (remaining review items and pre-existing failures), 2026-10-31

| Criterion | Evidence | Result |
| --------- | -------- | ------ |
| AC-23 | `acceptance/core/ac23-30-remaining.test.ts` (`turnGate` interrupts and returns the fallback); verification: answered approvals keep their answer, a new turn isn't ended by the old one; `test/permission.test.ts` "withdraws an interrupted request with a reject reply" | pass |
| AC-24 | Code review: a refused `set_config_option`/`set_model` ends the turn through `finishAcpTurn` with the model named | reviewed, not automated |
| AC-25 | core: Codex usage is the growth of `total`, `contextUsed` the last call; app: `acceptance/app/ac25-context-used.test.ts`, `verification/app/context.verify.test.ts`; schema, updater and generated client carry `contextUsed` | pass |
| AC-26 | `newlySignedIn`; verification: first read, unchanged, API key | pass |
| AC-27 | `.cmd` shim in the npm folder; verification: extensionless shim beside node.exe, `.cmd` elsewhere is not npm; existing update tests | pass |
| AC-28 | `HarnessPids.reap`; verification: empty ledger, failing check. Ledger writes, owner filtering, once-per-run reaping and the kill: code review | pass |
| AC-29 | `isBroadFolder`; `acceptance/core/ac29-standalone-snapshot.test.ts` captures and restores a plain folder; watcher test now asserts a plain folder is watched | pass |
| AC-30 | `withoutChangedFiles`; the diff against each file's latest end snapshot in `stage`: code review | pass |

Baseline: the standalone snapshot and app context tests failed on their
assertions; the other new files failed on missing modules; the app
verification test passed (existing behavior). Plan test files match their
recorded checksums.

Existing tests changed to the new contract (assertions about old behavior,
not weakened checks): `test/snapshot.test.ts` (a folder outside git now
captures) and `test/filesystem/watcher.test.ts` (a plain folder is now
watched).

Corrections made while implementing: the PID reap first ran at every
location start and would have ended another workspace's live harnesses;
entries now record their owning server and only earlier runs are reaped, once
per run. The fallback `kill` is guarded against exited processes.

Pre-existing failures fixed in the same change:

- i18n parity: `hr`, `is`, `hu` and `lt` map desktop labels by position and
  lacked the six deep-link strings added later; translations appended.
- `FileMutation` rename retry: `Effect.retry` re-ran one already-built
  `rename` effect; the call is now `Effect.suspend`ed so each retry renames
  again.
- Knowledge note tags: `gray-matter` bundles js-yaml 3, which quotes
  `work, home`; the test now checks the scalar stays a scalar and round-trips,
  in either quote style.
- `test/sqlite-node.test.ts`: the pinned Bun 1.3.14 has no `node:sqlite`; the
  suite is skipped when the module is missing instead of erroring.

Repository checks on the final code: typecheck, lint, check:generated,
`test`, `test:second-brain`, build pass with no failures. `test:engine` had
1308 passing tests and only the `node:sqlite` load error, which the skip
above removes (verified by running that file: 2 skipped, 0 failed); the full
engine suite was not rerun after that last change. The Mac app was not
rebuilt or reinstalled for this phase.
