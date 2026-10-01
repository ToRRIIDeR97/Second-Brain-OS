# Agent work orchestration: implementation pack

Status: implementation instructions only. No feature in this pack is implemented by these documents.

Source: [feature request](../../docs/product/FEATURE-REQUEST-agent-work-orchestration.md). Repository inspected on 2026-09-17 at `ff5ce7f`, with unrelated local changes present. Recheck the current checkout before editing.

## How to assign the work

Give the implementing AI this README and one numbered plan. Run the plans in order unless the dependency table permits otherwise. Each plan must produce working behavior and its acceptance evidence before it is marked complete. These plans target the current OpenCode application; the older numbered checkpoints in the parent directory describe a different architecture and are not prerequisites.

Copy this prompt and replace `NN-name.md`:

> Implement `implementations/agent-work-orchestration/NN-name.md`. First read that file, this pack's README, the original feature request, and the applicable AGENTS.md files. Verify prerequisites against actual code. Own discovery, implementation, testing, and review. Work only on the assigned plan; preserve unrelated changes. Reuse the existing OpenCode session, tool, permission, event, and UI mechanisms. Produce the smallest complete implementation, with the acceptance evidence specified in the plan. Do not add speculative abstractions, a new service/package, a new test framework, or a second agent execution loop. Do not delegate unless I explicitly authorize it. Report changed behavior, actual commands/results, measured performance where required, and remaining limitations. Do not claim completion if a required runtime path is unsupported.

## Delivery order

| Plan | Deliverable | Depends on | Relative scope |
| --- | --- | --- | --- |
| [01](01-thread-creation.md) | Approved standalone thread creation, initial prompt, navigation, and provenance | None | Medium |
| [02](02-codex-tool-access.md) | Codex access to the same guarded thread-creation tool | 01 | Medium; protocol-sensitive |
| [03](03-v2-subagents.md) | V2 subagent execution with ancestry, inherited restrictions, and bounded results | None; reconcile shared session changes from 01 | Large |
| [04](04-agent-management.md) | Source-aware global/project agent settings and safe reload | 03 for execution acceptance | Medium |
| [05](05-thread-references.md) | Authorized thread references through search, drag/drop, storage, and model input | No product dependency; reconcile shared schemas from 01–04 | Large |
| [06](06-durable-scheduler.md) | Durable local scheduling, occurrence identity, recovery, and permission handling | Reuse 01 target/model validation; current V2 session admission | Large |
| [07](07-automation-ui-and-hooks.md) | Automation management, history, notifications, and durable plugin events | 06; 02 for Codex orchestration-tool coverage | Medium |

Recommended sequence: 01 → 02 → 03 → 04 → 05 → 06 → 07. This is an ordered delivery plan, not an instruction to start parallel agents. Do not split shared schema or migration changes across simultaneous uncoordinated implementations.

## Shared implementation contract

1. Keep production work inside `opencode/`. Preserve Electron, Solid, the managed server, and current navigation. Do not edit the donor runtime in `app/`.
2. Keep behavior in existing broad domains. Thread creation/subagents belong with sessions and agents; automation belongs with planner; host notifications belong with platform. A cohesive domain module is enough. No orchestration framework, DAG engine, service extraction, Redis, external worker, or generic repository layer.
3. Use Schema → Core/Protocol → Server dependencies. Client runtime code must not import Core or Server. Renderer calls use identifiers and validated relative paths; the server resolves real directories. Do not copy the existing raw-directory composer call into a newly agent-accessible tool.
4. Use `SessionV2`, durable prompt admission, the canonical `Tool.make` representation, `ToolRegistry.Materialization.settle`, `PermissionV2`, existing SQLite migrations, and `EventV2`. Do not route new work through the legacy `SessionPrompt.loop` or invoke a model directly.
5. Keep a single authoritative record for each fact. Use existing durable events and projectors for session/automation metadata. Projection rebuilds must preserve definitions, occurrence identities, and outcomes. Do not introduce competing JSON and SQL authorities. Agent definitions remain canonical files.
6. Validate at trust boundaries, bound request/result sizes, and preserve interruption semantics. Translate expected failures; do not swallow defects or cancellation in broad catch handlers.
7. No guessed provider/model names. Resolve against the configured target Location and its connected providers/harnesses, including supported variants/reasoning efforts. Unavailable models produce a useful error/choice, never silent fallback.
8. No generic caches until a measured repeated lookup justifies one. Reuse existing discovery caches and invalidate them with the existing lifecycle. Never add provider/model discovery on every render or keystroke.
9. New UI must use existing controls, typed i18n, keyboard access, focus behavior, and accessible labels. Prefer a list and an editor over a new visual builder.
10. Read nested AGENTS.md files. In particular, the app requires a production performance baseline for session/timeline changes and prohibits restarting the user's running app/server. Use isolated test processes. Read the E2E instructions and official Playwright references before authoring tests.

## Verified integration traps

- `packages/app/src/components/prompt-input/submit.ts` creates through the V2 API. `packages/opencode/src/tool/task.ts` is a legacy implementation. `packages/core/src/tool/builtins.ts` still lists the V2 task port as pending.
- `packages/core/src/permission.ts` currently resolves agent permissions; simply writing legacy session permission metadata does not enforce inherited V2 restrictions. Plan 03 must address that execution path.
- The current Codex bridge in `packages/core/src/harness.ts` handles approvals and user input, but does not register the new application tools. Model discovery is already present; application-tool access is separate work.
- `packages/core/src/config.ts` exposes ordered config entries, not a complete definition editor. The V2 agent API lists effective registered agents, which excludes disabled definitions and loses editing provenance.
- `packages/core/src/background-job.ts` is expressly process-local. It cannot be the durable scheduler store.
- The V2 prompt types currently contain text, files, and agents. A thread reference must survive both the composer representation and the V2 prompt/message pipeline.
- `packages/app/package.json` points `@opencode-ai/client` at a vendored tarball. Regenerating `packages/client` alone may not update the app. Inspect actual package resolution, then use the existing packaging process if present. If none exists, prefer the local workspace client when API-compatible; otherwise reproducibly refresh the vendored package. Do not bypass this with handwritten generated code or `any` casts. Verify both renderer typechecking and a real new API call.
- Project/workspace names appear in both Second Brain product data and OpenCode session placement. Trace the actual picker-to-server mapping before choosing identifiers. Do not assume a knowledge/planner Project ID is interchangeable with an OpenCode repository Project ID or that a display name authorizes a directory.

## Product defaults for this pack

These settle unspecified behavior so implementation can proceed. They are proposed implementation decisions, not claims that the original request already specified them.

| Area | Default |
| --- | --- |
| Server scope | Same configured server, across registered/authorized Projects. Cross-server execution or transcript federation is outside this release; reject it clearly. |
| New threads | Existing checkout/workspace, explicit initial prompt, selected runtime/model, one-time creation approval, no parent-child relationship. No automatic worktree creation. |
| Custom subagents | OpenCode V2 agents use the existing Markdown/config model. Codex-native subagent configuration is a separate capability and is not implied. |
| References | Immutable, user-previewable bounded snapshots taken at attachment submission; no automatic live transcript subscriptions or LLM-generated summaries. |
| Scheduling | Local server owns one scheduler. Execution needs that server running; no OS wake service or cloud worker. A restart catches up one pending occurrence, then advances to the next future occurrence. |
| Schedule forms | One time, daily, selected weekdays, and fixed intervals of at least one minute. IANA timezone for wall-clock schedules. No free-form cron editor in the first release. |
| Overlap | At most one unresolved occurrence per automation. Different automations targeting the same thread use its existing queue, with no concurrent drain. |
| Recovery | Safe to reclaim work that was never promoted. Promoted work with uncertain external effects becomes `interrupted` and requires explicit user action; do not replay it automatically. |
| Notifications | Default to failure/approval/interruption notifications. Optional all outcomes or none. History is retained regardless. |

The original “at most once” criterion is implemented as one durable admission per occurrence plus no automatic replay of uncertain execution. It is not an exactly-once guarantee for arbitrary external tool side effects. Make that distinction visible in acceptance evidence; do not claim stronger semantics.

## Performance requirements

Optimize the actual hot paths, not the number of files or lines alone:

- Thread creation performs one target/model validation and one admission; it does not enumerate transcripts or rediscover all providers.
- Agent settings discover source files only when opened/refreshed or invalidated, with one reload per successful save. No recursive global scan on each keystroke.
- Thread search returns metadata only, debounced by about 150 ms, with a 25-item page. Initial bounded preview is at most 8 KiB UTF-8 per reference, 5 references and 32 KiB combined per prompt. Enforce both renderer and server limits; use the lower available model-context budget at execution.
- Scheduler queries indexed due timestamps in batches of at most 50 and runs no per-schedule polling timers. Start with two active automation drains server-wide. Waiting for approval should not occupy an execution slot. Keep this limit in one domain constant, not a settings framework.
- History lists use 50-item pages and cursor/event updates; do not load every run or full transcript.
- Use existing performance tooling for the affected interaction. Compare the same fixture/build/machine before and after. Investigate a repeatable median regression above 10% or a new >50 ms main-thread task caused by this feature. These are investigation gates, not fabricated speed claims.

Do not create a permanent benchmark system just for these features. Reuse current fixtures and record measurements. If a genuine simplification has a known ceiling, add a short `ponytail:` comment naming the ceiling and upgrade trigger.

## Verification commands and reporting

All paths below are relative to repository root. Execute tests from their package, never the monorepo root. Resolve the configured Bun executable if it is absent from PATH; do not silently replace the toolchain.

| Work | Commands / checks |
| --- | --- |
| Core logic | In `opencode/packages/core`: `bun test <affected-test-files>` and `bun typecheck` |
| Schema/Protocol/Server/Client | `bun typecheck` in each changed package; run its affected tests |
| Public API changes | In `opencode/packages/client`: `bun run generate`; inspect generated diff and actual app dependency resolution |
| SQL changes | In `opencode/packages/core`: `bun run migration --name <short-name>`, then `bun run migration --check`; test both fresh database and upgrade/replay |
| App unit changes | In `opencode/packages/app`: `bun test --conditions=solid --preload ./happydom.ts <affected-src-tests>` and `bun typecheck` |
| Browser-specific unit changes | In `opencode/packages/app`: `bun test --conditions=browser --preload ./happydom.ts <affected-test-browser-files>` |
| App build | In `opencode/packages/app`: `bun run build` |
| E2E | In `opencode/packages/app`: `bun run test:e2e -- <affected-spec>` against isolated fixtures; `bun run typecheck:e2e` for changed E2E TypeScript |
| Formatting/lint | Use installed Prettier and Oxlint from `opencode/` on changed supported files only. Do not rewrite unrelated files. |
| Desktop changes | Targeted native tests, `bun typecheck`, and `bun run build` from `opencode/packages/desktop`; avoid packaging unless required |

Recheck commands against current package scripts. Placeholder paths above are instructions, not existing tests. Reuse Bun/Playwright and the existing test fixtures. Use real SQLite and temporary files for persistence and authorization tests; a tiny fake provider/protocol peer is appropriate for deterministic model execution. Do not mock away the policy being tested.

Each plan's completion report must contain:

1. Actual changed behavior and files.
2. Acceptance cases exercised, with exact commands and results.
3. Performance evidence where the affected code requires it.
4. Supported runtimes and explicit unsupported cases.
5. Remaining limitations or blocked checks, without labeling them as passed.

No commit, push, PR, or deployment is required merely to finish a plan. Follow later user instructions and the repository's applicable workflow if those actions are requested.
