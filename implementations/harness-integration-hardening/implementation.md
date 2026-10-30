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

Phase 2 (safety), Phase 3 (lost information), Phase 4 (environment and
sign-in) and Phase 5 (housekeeping) add AC-6 onward in their sections when
they start; earlier criteria are not renumbered.

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
