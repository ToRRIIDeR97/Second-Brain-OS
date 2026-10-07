# ACP harness driver and agent registration

> Superseded in part (2026-10-07): the `harness_register` tool and the approval
> step (AC-7 approval, AC-8) were removed. Harnesses are now added in Settings;
> see [harness-settings-page](../harness-settings-page/implementation.md). The
> AC-7 and AC-8 tests in this package no longer apply.

## Problem

Second Brain OS runs agent turns through Harnesses. Only two drivers can
execute: `opencode` (in-process) and `codex` (Codex app-server). A config
entry with any other driver shows "Driver '…' is not installed"
(`opencode/packages/core/src/harness.ts`). Adding another agent CLI, such as
Gemini CLI or a local tool, needs code changes. An agent can't add one either,
even when the user asks.

Expected behavior, similar to T3 Code:

- Before: "I have `my-agent` installed, add it as a harness." The agent can't
  do this. A hand-written config entry with `driver: "acp"` is unavailable.
- After: the agent calls `harness_register`. The user approves the exact
  command. The app checks that the command speaks the Agent Client Protocol
  (ACP), then records it. The new harness appears in the harness picker
  without restarting the app, and its turns stream text, reasoning, and tool
  activity. Its permission requests go through Second Brain approvals.

A CLI that doesn't speak ACP is rejected with a clear message. For example,
Codetonomy 2026-10 has no ACP mode. It can be registered only after it gains
one, or after someone writes a dedicated driver.

## Scope

In scope, all paths under `opencode/packages/`:

- `schema/src/harness.ts`: add the `acp` driver kind.
- `core/src/config/harness.ts`: add the ACP settings schema: `command`,
  optional `args`, `env`, and `models`.
- `core/src/harness/codex-app-server.ts`: generalize the JSON-RPC stdio
  client with options for the `jsonrpc: "2.0"` field, a label for error text,
  and ordered notification delivery. Codex defaults stay unchanged.
- `core/src/harness/acp.ts` (new): ACP client, availability probe, session
  open/load, turn streaming, permission mapping.
- `core/src/harness/registry.ts` (new): the `harnesses.json` registry in the
  global config directory, with validation, approval, probe, and atomic write.
- `core/src/harness.ts`:
  - Add an `acp` branch.
  - Merge registry entries on every list and stream call.
  - Give Codex the `harness_register` dynamic tool.
- `core/src/tool/harness-register.ts` (new), registered in
  `core/src/tool/builtins.ts`: the same action for OpenCode-harness sessions.
- `core/src/plugin/agent.ts`: add a default `harness_register` ask rule.
- `docs/architecture/README.md` and `docs/security/threat-model.md`.

Existing interfaces to reuse:

- `HarnessRuntime.Driver`, `StreamInput`, and `LLMEvent`.
- `AppProcess.spawn`.
- `PermissionV2.assert`.
- `SessionEvent.HarnessContinuationSet` and `readContinuation`.
- `renderCodexPrompt`, which also handles history handoff.
- `Global.Service.config`.

Exclusions:

- Installing binaries. The agent uses its normal shell tool and approvals.
- ACP client file-system, terminal, MCP passthrough, and elicitation
  capabilities.
- Settings UI for editing harnesses.
- Exposing `harness_register` to ACP harnesses.
- Codetonomy-specific support.

Invariants:

- Never run a user- or agent-supplied command before the user approves it.
- `harness_register` always asks under the default agent and never offers a
  saved "always allow" for itself.
- Built-in instance IDs `opencode` and `codex` can't be registered or
  overridden through the registry. Config-file entries win over registry
  entries with the same ID.
- The registry never stores environment variables supplied by an agent.
- The Codex and OpenCode drivers behave as before.

## Acceptance criteria

- **AC-1 Probe.** An instance `{ driver: "acp", config: { command, args } }`
  is checked with ACP `initialize` (protocol version 1, within 8 seconds).
  - On success it reports `status: "available"`, the agent's version when
    given, and the configured `models`.
  - If the command is missing, exits early, sends invalid output, or times
    out, it reports `status: "unavailable"` with a non-empty `error`, and the
    list call still succeeds.
- **AC-2 Turn streaming.**
  - A turn creates an ACP session with `session/new` (`cwd` set to the
    session directory, `mcpServers: []`) and sends the prompt text with
    `session/prompt`.
  - `agent_message_chunk` maps to text events and `agent_thought_chunk` maps
    to reasoning events.
  - `tool_call` and `tool_call_update` map to provider-executed tool-call and
    tool-result events: one tool-call per tool ID, and a result once the
    status is `completed` or `failed`.
  - Every update that arrives before the `session/prompt` response appears
    before `finish`. The stream ends with `step-finish` and `finish`.
  - Stop reasons map as follows: `end_turn` and `cancelled` to `stop`,
    `max_tokens` and `max_turn_requests` to `length`, `refusal` to
    `content-filter`.
  - Response `usage` maps to input, output, cache-read, and reasoning tokens.
  - A JSON-RPC error on `session/prompt` produces a `provider-error` event and
    an `error` finish.
- **AC-3 Permissions.** For `session/request_permission`, the driver asks
  Second Brain with an action derived from the tool kind:
  `execute` maps to `bash`; `edit`, `delete`, and `move` map to `edit`;
  `read` and `search` map to `read`; `fetch` maps to `webfetch`; anything
  else maps to `acp_tool`.
  - If allowed, it selects an `allow_once` option, or any allow option if
    there is no `allow_once`.
  - If denied, it selects `reject_once`, or any reject option, or returns
    outcome `cancelled` when there are no reject options.
  - `initialize` advertises no `fs` or `terminal` capabilities. Requests for
    `fs/*`, `terminal/*`, or any unknown method get JSON-RPC error `-32601`.
- **AC-4 Continuity.**
  - A second turn in the same Run reuses the ACP session and sends only the
    latest user message.
  - A continuation stored from a previous process is reopened with
    `session/load` when the agent advertises `loadSession`. Updates replayed
    during load aren't emitted.
  - Without `loadSession`, or when load fails, the driver creates a new
    session and sends the canonical history handoff.
  - A requested model that differs from the session's current model is set
    with `session/set_model`. A failure there doesn't fail the turn.
- **AC-5 Cancellation.** Interrupting a turn before the prompt response
  sends `session/cancel` for that session.
- **AC-6 Registry.**
  - `<config dir>/harnesses.json` entries appear in `list()` without a
    restart.
  - A missing or malformed file yields no registry entries and no failure.
  - Config entries override registry entries with the same ID.
  - Registry entries using `opencode` or `codex` are ignored.
- **AC-7 Registration.** `register` takes `{ id, name?, command, args?,
  models? }` and always uses the `acp` driver.
  - It rejects, with a message and without writing or running anything: an
    invalid ID slug, a reserved ID, an ID that already exists, and a command
    that doesn't resolve to an executable file. An absolute path or a
    command on `PATH` both resolve.
  - It then requests approval showing the ID, name, resolved command, and
    arguments. If denied, it returns a denial and nothing is written.
  - After approval it probes with ACP `initialize`. If the probe fails, it
    returns that error and nothing is written.
  - On success it atomically writes the entry, preserving existing entries,
    with file mode `0600`. It returns the registered ID and the probe's agent
    name and version.
- **AC-8 Exposure.**
  - OpenCode-harness sessions have a `harness_register` tool.
  - New Codex threads include a `harness_register` dynamic tool, and
    `item/tool/call` for it runs the registration and answers
    `{ success, contentItems: [{ type: "inputText", text }] }`.
  - An unknown dynamic tool answers `success: false`.
  - Under the default agent, `harness_register` evaluates to `ask`.
- **AC-9 Documentation.** The architecture document describes ACP drivers
  and the registry. The threat model records that a registered harness runs
  as the user, and documents the approval-before-execution control.

## Implementation sequence

1. Generalize the JSON-RPC client (AC-2 ordering, AC-3 error codes). Keep the
   existing Codex client test passing.
2. Add the ACP settings schema and driver kind. Add `acp.ts` with probe,
   session open/load, streaming, cancellation, and permission handling
   (AC-1 to AC-5).
3. Add the registry: read, merge, and register (AC-6, AC-7).
4. Wire the `acp` driver and the registry merge into `HarnessRuntime`
   (AC-1, AC-6).
5. Expose registration as a core tool and as a Codex dynamic tool, and add
   the default ask rule (AC-8).
6. Update documentation (AC-9).

## Verification

Setup, once per checkout, from the repository root. The link is git-ignored:

```sh
ln -s ../../opencode/packages/core/node_modules implementations/acp-harness-driver/node_modules
```

The fake ACP agent at `fixtures/fake-acp-agent.ts` is a deterministic
stdio script. Its behavior is selected by `FAKE_ACP_SCENARIO`, and it records
received messages to `FAKE_ACP_LOG`. Tests run it with the current Bun
executable. They make no network calls and use no live providers.

Run from `opencode/packages/core`:

```sh
bun test ../../../implementations/acp-harness-driver/acceptance
bun test ../../../implementations/acp-harness-driver/verification
bun test test/codex-app-server.test.ts test/harness.test.ts
```

| Criterion | Acceptance | Verification | Manual |
| --- | --- | --- | --- |
| AC-1 | probe available / missing command | non-ACP output, timeout, early exit | |
| AC-2 | text, reasoning, tools, finish, usage | burst ordering, prompt error, stop reasons | |
| AC-3 | allow and deny mapping, no fs capability | missing options, fs/terminal request errors | |
| AC-4 | reuse within a Run | load with replay suppression, load fallback, set_model failure | |
| AC-5 | | cancel on interrupt | |
| AC-6 | registry entry listed, config wins | malformed file, reserved IDs | |
| AC-7 | approve and write, deny and no write | invalid ID, duplicate, missing command, probe fails after approval, file mode, preserve entries | |
| AC-8 | Codex dynamic tool round trip | unknown dynamic tool | OpenCode tool in a desktop session; default rule asks |
| AC-9 | | | document review |

Also run the repository checks from the root: `bun run typecheck`,
`bun run lint`, `bun run test`, `bun run test:engine`, and `bun run build`.

Live check: register `opencode acp` from a desktop session, approve it, and
send one prompt. The upstream OpenCode CLI is installed at
`~/.opencode/bin/opencode`.

## Completion evidence

The same agent authored this plan and both test sets and also implemented
them. The verification set is a separately designed set, not an independently
authored or hidden one.

Baseline before implementation (2026-10-02): all four test files failed to
load because `core/src/harness/acp.ts` and `core/src/harness/registry.ts` did
not exist. The behavior was entirely missing, so no assertion could run.

Results on the final tree (2026-10-02, macOS, Bun 1.3.14, Node 22.22.3):

| Check | Result |
| --- | --- |
| Acceptance set | 11 pass, 0 fail |
| Verification set | 17 pass, 0 fail |
| `bun test` in `opencode/packages/core` | 1110 pass, 0 fail, including the new `test/harness-acp.test.ts` |
| `bun run test:engine` | core 1110 pass; server 3323 pass |
| `bun run typecheck`, server package `tsgo --noEmit` | pass |
| `bun run lint` | 0 errors, 4350 warnings (unchanged baseline) |
| `bun run build` | pass |
| `bun run test:second-brain` | 10 pass |
| `bun run test` | desktop 77 pass; renderer 757 pass, 1 fail |

The renderer failure is `desktop-native.test.ts` (`pa-PK` locale). It fails
the same way on `main` and depends on the environment.

The first engine run found five `SessionRunnerLLM` regressions, caused by
reading the registry file before every stream. They were fixed by streaming
known instances from the cached list. It also caught the expected change to
the built-in tool list in `location-layer.test.ts`, which was updated.

Live checks:

- The ACP handshake succeeded with OpenCode 1.17.13 (`opencode acp`) and
  Gemini CLI 0.42.0 (`gemini --experimental-acp`).
- Codetonomy was rejected ("ACP agent exited") because it has no ACP mode.
- Codex CLI 0.147.0 accepted `thread/start` with the `harness_register`
  dynamic tool. The thread was ephemeral and no turn was sent.

Not yet verified manually:

- A full prompt turn against a real ACP agent.
- The approval prompt and harness-picker refresh in the desktop app.
- An end-to-end Codex `item/tool/call` with a real model.
