# Session view: continuing the implementation

This picks up [implementation.md](implementation.md) after steps 1 and 2. Read
that file first: it has the contract, the acceptance criteria (AC-1 to AC-9),
the diagrams and the exact test commands. This file covers only what is left
and what the next person needs to know.

Branch: `continue-implementation`. It contains everything from
`codex/session-view-plan` (plan `a7e7ad8`, steps 1–2 `104f9f4`).

Design reference: the approved direction A boards, "A · Live turn + Session
tab" and "A · Finished turn, failure, approval", on the
[session view canvas](https://claude.ai/artifact/Rn8tzEfHpLHAnK83hrAcY8). The
visual system comes from the remaster canvas's `Thread.dc.html`
(https://claude.ai/artifact/UENpgzHk645jk31WC8H5bs):

- neutral greys and one blue accent `#3b5cf6`;
- tonal `--l1` rows with a 16px radius;
- pill tabs, with `--ac`/`--onac` for the selected or current item;
- colour only for diffs, errors and approval prompts.

Don't colour-code step kinds. Use an icon and a verb.

## Done

| Step | Criteria | Commit | Evidence |
|---|---|---|---|
| 1. ACP usage and runner cost | AC-7 | `104f9f4` | acceptance `harness-usage` 6/6, verification 5/5, `core/test/harness-acp.test.ts` 7/7, core typecheck clean, `bun run test:engine` (core 1,136 pass, opencode 2,796 pass, 0 fail) |
| 2. `step-kind.ts` | AC-1, AC-2, AC-4 (mapping) | `104f9f4` | acceptance `step-kind` 8/8, verification 11/11, `session-ui/src/components/step-kind.test.ts` 3/3, session-ui typecheck clean |

All of these were run by the plan author, who also implemented the steps. They
aren't independent verification.

What changed:

- `core/src/harness/acp.ts`:
  - `acpState(previousCost?)`.
  - `usage_update` is stored on the turn state.
  - `harnessUsage()` puts `{ contextUsed, contextSize, cost?, sessionCost? }`
    in `usage.providerMetadata.harness`.
  - `normalizeUsage` detects whether `inputTokens` excludes cache reads.
  - `open()` carries `sessionCost` from one turn to the next.
- `core/src/session/runner/publish-llm-event.ts`: `stepSettlement()` gains
  `cost`, taken from `providerMetadata.harness.cost`.
- `runner/llm.ts`: publishes it on `Step.Ended`.
- `session-ui/src/components/step-kind.ts`: `stepOf`, `summarizeTurn`.

## Remaining steps

Paths are under `opencode/packages/`.

### 3. Tool rows from `stepOf` (AC-4)

- Unregistered tools fall through to `GenericTool` (`session-ui/src/components/basic-tool.tsx:323-343`). It renders `ui.basicTool.called` = "Called `{{tool}}`" (`ui/src/i18n/en.ts:168`) plus key=value args. Replace that fallback with a row showing an icon, a verb and a target from `stepOf`. Keep the expanded detail (input/output).
- `ToolRegistry` is at `message-part.tsx:1514-1534`, and `getTool` aliases at 1528. `getToolInfo` (466–569) picks the icon and title; its `default` uses the `mcp` icon and the raw name. Route Codex names (`command_execution`, `file_change`, `mcp_tool_call`, `web_search`) and `acp_*` names through `stepOf` so they get the same icon and verb as the built-in tool of the same kind.
- `toolGroupCounts` (`part-group.ts:107-118`) only knows built-in names. Base it on `stepOf` kinds so Codex and ACP runs count too. That changes the existing "Ran N tools" / "Explored" copy inputs, so check `message-part.test.ts`.
- MCP server names for `stepOf(…, { mcpServers })`: the legacy server names MCP tools `sanitize(client) + "_" + sanitize(tool)` (`opencode/src/mcp/catalog.ts:119`). Pass the configured server names from wherever the app already lists MCP status. Without them, MCP calls show as "other", which is acceptable for now.
- Verbs, as new i18n keys: Read, Searched, Edited, Ran / Running, Fetched, Called (MCP), Loaded skill, Thought. Subagent rows show the agent name.

### 4. Folded turn rows (AC-3)

Record the timeline benchmark baseline before touching rows (app `AGENTS.md`):

```powershell
cd opencode/packages/app; $env:PLAYWRIGHT_WORKERS="1"; bun run test:bench
```

Keep the `BENCHMARK` lines for comparison.

- `app/src/pages/session/timeline/rows.ts:102-233` builds the rows:
  - it merges a turn's assistant messages (124–128);
  - it runs `groupParts`, split at interrupts (129–146);
  - it emits one `AssistantPart` row per group (184–190);
  - it adds a `Thinking` row while busy (194–206).
- Row types live in `timeline-row.ts`.
- Add a turn-steps row type that wraps the turn's tool and reasoning groups. Text parts stay outside it, in order. Keep group keys stable while streaming (`tools:`/`context:` use the first part ID).
- Rendering is in `message-timeline.tsx`. `renderAssistantPartGroup` is at 875–947, open state is in `toolOpen`, cached per session (538), and `workingTurn` is at 839.
- Open state:
  - expanded while `workingTurn`;
  - folded when the turn ends;
  - open by default when `summarizeTurn(...).failed > 0`;
  - a user toggle wins.
- Summary line: "Worked {duration} · {counts}". Use `turnDurationMs` (`message-timeline.tsx:841-856`) for the duration, and build the counts phrase from `summarizeTurn` counts with `language.plural`. Never assemble English fragments in code (both package `AGENTS.md` files).
- The virtualizer is `@tanstack/solid-virtual` (`message-timeline.tsx:409`). Collapsed rows change measured heights, so re-run `measure.test.ts` and `bun run test:stability`.
- E2E specs to update for the new structure: `app/e2e/regression/session-timeline-{tool-projection,tool-state,collapse-state,reasoning-projection,lifecycle-state,projection}.spec.ts`, `subagent-child-navigation.spec.ts`, and `e2e/smoke/session-timeline.spec.ts`.

### 5. Session tab (AC-5, AC-6)

- New `app/src/components/session/session-usage.ts`, with `getSessionUsage(messages, { harness? })` as specified in implementation.md. The tests are already in `implementations/session-view/{acceptance,verification}/session-usage*.ts` and currently fail because the module is missing.
- Tabs are in `app/src/pages/session/session-side-panel.tsx`:
  - the Context trigger is at 298–303 (`session.tab.context`, with the `SessionContextUsage` indicator);
  - its content is at 353–358;
  - the Review trigger is at 419/526;
  - tab state is in `pages/session/helpers.ts:35-89`.
  Rename Context to Session with a new key. Keep `session.tab.context` unchanged if it's used elsewhere.
- Rebuild `components/session/session-context-tab.tsx` to board A's Session layout:
  - harness · model · message count, keeping the existing harness selector (141–154);
  - 2×2 tiles: Input, Output, Cache hit, Cost, with "Not reported" when `cost` is undefined;
  - context window from `getSessionContext` (unchanged), or "Not reported" when it has no limit;
  - subagents from `task` parts (child session via `metadata.sessionId`, see `message-part.tsx:588-602`);
  - tool counts from `summarizeTurn` over all parts;
  - the existing breakdown and Raw messages.
- `session.cost` also feeds the tab trigger indicator and Home. ACP costs are now non-zero there.

### 6. Status line, i18n, docs, checks (AC-8, AC-9)

- Status line above the composer (`app/src/pages/session/composer/session-composer-region.tsx`): the first running step's verb + target from `stepOf`, plus "N subagents working". Hide it when the session is idle (`sync().data.session_status[id]`).
- i18n: new keys only. Don't change existing English text. Strings go in `ui/src/i18n/en.ts` for session-ui and `app/src/i18n/en.ts` for the app.
- Docs:
  - `docs/architecture/README.md`: the session view and harness usage flow;
  - `docs/architecture/uml.md`: the coverage index;
  - `docs/product/NAVIGATION-MAP-V1.md`: side-panel tabs.
- Required checks from the repository root: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`, `bun run test:engine`, `bun run test:routes`. Then the benchmark again and `bun run test:stability`. Fill in "Completion evidence" in implementation.md.

## Things to watch

- **Parallel branch touching `acp.ts`.** The OpenCode model-list fix (session branch `claude/serene-tharp-23f8db`, commit `bac26d4`) also edits `core/src/harness/acp.ts` around `probe`/`discover` and model selection. Step 1 changed `AcpState`, `parseAcpNotification`, `finishAcpTurn`, `normalizeUsage` and `open()`'s turn loop. Expect a small merge conflict in `open()`. Keep both changes.
- **Resumed ACP sessions.** After `session/load`, `previousCost` starts at 0, so the first turn records the whole cumulative cost so far. Fixing this needs a cost reading taken before the first prompt, which isn't done.
- **Free models.** A real cost of 0 reads "Not reported". The contract accepts this.
- **Input-token heuristic.** `normalizeUsage` treats `inputTokens` as excluding cache reads when it is smaller than `cachedReadTokens`, or when `totalTokens ≥ input + cacheRead + cacheWrite + output`. This was checked against OpenCode 1.2.27 only.
- **Test setup.** The core tests in `implementations/session-view` need the gitignored `node_modules` junction described in implementation.md.
