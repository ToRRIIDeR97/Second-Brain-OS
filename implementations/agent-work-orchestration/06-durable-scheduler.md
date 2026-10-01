# Plan 06: durable local scheduler and recovery

Read [README](README.md) first. Reuse the target/model validation delivered in Plan 01. Plan 07 adds the desktop management and plugin-facing experience. This plan delivers a testable server API and scheduler with real persistence; a timer that merely calls `prompt` is not sufficient.

## Outcome

One local server schedules one-time and recurring work, creates one durable occurrence record, admits its prompt once, observes its outcome, and recovers safely after restart. The scheduler never bypasses normal model/agent/permission checks and never automatically repeats provider work whose external effects are uncertain.

## Read and trace

- `opencode/packages/core/src/session.ts`, `session/input.ts`, `session/execution/local.ts`, `session/run-coordinator.ts`, and `session/runner/llm.ts`.
- `opencode/packages/core/src/event.ts`, `event/sql.ts`, `session/projector.ts`, and `session/sql.ts`.
- `opencode/packages/schema/src/durable-event-manifest.ts`, `event-manifest.ts`, session input/events, and permission events.
- `opencode/packages/core/src/background-job.ts`: understand why it is not durable storage.
- `opencode/packages/core/src/effect/app-node.ts`, `location-service-map.ts`, and the server bootstrap/service composition.
- `opencode/packages/core/script/migration.ts`, `drizzle.config.ts`, and current migration fixtures.
- `opencode/packages/core/test/session-prompt.test.ts`, `session-run-coordinator.test.ts`, `event.test.ts`, and permission/runner tests.
- Existing planner modules under `opencode/packages/opencode/src/planner/`; keep the new shared scheduler domain in Core so Server/Client layering remains valid, without migrating unrelated calendar code.

## Product behavior

Support:

- One-time absolute UTC instant, with the user's display timezone retained.
- Fixed interval of at least one minute, anchored to the original start instant.
- Daily wall-clock time and selected weekdays at a wall-clock time, with a validated IANA timezone.
- Either an existing thread or a new standalone thread per occurrence under a registered Project. The target mode is explicit; never silently switch after a thread disappears.
- Prompt, agent/runtime/model, timezone/schedule, enabled state, and notification policy.
- Pause, resume, edit, remove/archive definition, list definitions, and paginated run history through a narrow typed API.

No arbitrary cron strings, monthly/yearly recurrence UI, OS wake daemon, cloud worker, multi-host execution, dependency graph, or calendar integration in this release. Do not claim execution while the local server is stopped. If the desktop keeps its server alive when the window closes, document that actual lifetime.

## Time and missed-occurrence rules

1. Store UTC due instants and IANA timezone separately. Never use the machine's current timezone as a silent fallback.
2. For fixed intervals, compute the next anchored instant arithmetically. Do not loop over all missed intervals.
3. For wall-clock schedules, use an installed timezone-aware library. First inspect the installed Effect date/cron support; if it does not meet the contract, reuse the repository's existing Luxon catalog version as a direct Core dependency. Do not import app code into Core or implement DST offset tables yourself. Verify the selected library's actual local API before coding.
4. Skip nonexistent spring-forward local times. Execute repeated fall-back local times once, at the earlier matching instant. Include explicit tests for these chosen rules; do not accept library behavior without verifying it.
5. On restart or a delayed wake, create one catch-up occurrence at the persisted earliest due instant. Record its lateness/coalesced time range, then advance directly to the next future occurrence. Do not launch one run for every missed interval or compute an exact missed count by unbounded iteration.
6. A due occurrence while this automation already has unresolved work is recorded as skipped/coalesced and next due advances. `needs_approval`, `needs_input`, and `interrupted` count as unresolved until resolved or dismissed. This prevents an unattended automation from piling up work.
7. A one-time overdue automation runs once when the server next becomes available, unless paused/deleted. Validate schedule creation in the past explicitly and preview this behavior.
8. Editing a definition increments its revision. Future occurrences use the new revision. Unpromoted pending work from the old revision is cancelled; already-promoted work retains its immutable definition snapshot. Recheck this rule immediately before prompt admission/promotion so stale claims cannot bypass an edit.

## Minimal durable model

Use existing SQLite/EventV2 infrastructure. Two focused projections are enough unless current tables already provide the required storage:

**Automation definition**: ID, revision, registered target identity and mode, canonical prompt/settings, normalized schedule/timezone, enabled/archived state, next due instant, notification policy, timestamps. The definition revision is authoritative via durable events. Do not treat this data as a disposable cache.

**Automation run**: ID, automation ID/revision, scheduled UTC instant, immutable definition revision reference, status, target session ID, stable prompt message ID, lease token/expiry, retry bookkeeping before admission, outcome/error code, relevant session sequence/message boundary, timestamps.

Required database constraints/indexes:

- Unique `(automation_id, revision, scheduled_at)` for scheduled occurrences.
- Unique stable admitted message identity per run; use existing session input uniqueness too.
- Index enabled next-due lookup, pending claim/retry lookup, and `(automation_id, scheduled_at, id)` history pagination as warranted by actual queries.
- Enforce at most one unresolved run per automation using a transactional condition or a supported partial unique index. Do not rely only on a JavaScript map.

Use one authoritative durable event stream with projections and existing transactional publication. Definition/run changes and lifecycle events must not diverge on a crash. Existing `EventV2.publish` supports an operational `commit` callback; verify its transaction boundaries before using it. Authoritative fields must be rebuildable by replayable projectors, not only that non-replayed callback. Lease tokens are operational: clear them during projection rebuild and reconcile durable work before resuming.

Store prompts as required execution data in the definition/session path. Audit, hook, and notification payloads carry IDs/status/bounded error codes, not duplicate prompt text, secrets, hidden reasoning, or terminal output. Prefer a definition revision reference over copying its full prompt into each audit transition.

## State transitions

Use a discriminated status with the minimum fields required for each state. These names are conceptual; align with existing naming where equivalent.

| State | Meaning | Safe automatic next action |
| --- | --- | --- |
| `queued` | Durable occurrence exists; no admission yet | Validate, claim, and admit |
| `claimed` | One scheduler token owns pre-admission work | Reconcile/create target and admit using stored IDs |
| `admitted` | Exact input is durable but not yet promoted | Wake normal queue, or reclaim observation after restart |
| `running` | The input has been promoted and execution has begun | Observe; do not submit again |
| `needs_approval` | Normal permission path is waiting | Notify; resume the same live continuation only after decision |
| `needs_input` | Agent awaits user clarification | Notify; preserve normal question flow |
| `completed` | Its admitted work reached a confirmed terminal success boundary | No execution; publish outcome |
| `failed` | Confirmed failure | No automatic provider replay |
| `interrupted` | Promoted execution outcome is uncertain after loss of owner | User reviews/resumes or dismisses; no automatic replay |
| `cancelled` | Unstarted work cancelled, or cancellation confirmed | No execution |
| `skipped` | Due time coalesced by overlap/missed-work rule | Advance schedule without execution |

Do not mark a run completed when `SessionV2.prompt` returns or merely when an HTTP request succeeds. Admission is not execution.

## Implementation sequence

1. **Pure schedule functions.** Validate inputs and compute next due/catch-up decisions using an explicit `now` argument. Keep recurrence parsing and scheduling calculation independent from provider execution so tests do not wait on wall-clock timers.
2. **Schema, events, projection, migrations.** Add domain types and the two storage projections. Register durable event definitions in the current manifest. Implement CRUD/history with revision checks, bounded fields, and target authorization. Create migration artifacts through the existing script, with fresh/upgrade/replay checks.
3. **One server-owned scheduler.** Register one process-global service in the managed server lifecycle, not one per renderer, Project, or Location. At startup reconcile durable pending work, query the earliest due item, and arm one cancellable wake timer. Schedule edits and run outcomes re-arm it. Use a capped wake delay (for example 60 seconds) to re-read wall clock after sleep/time jumps; do not scan all definitions every second. An empty scheduler can await changes without a recurring poll.
4. **Bound each pass.** Fetch at most 50 due rows, process them in short transactions, and yield/re-arm if more work is due. Keep database transactions closed before network calls or approval waits. Use two active automation execution slots initially; lease observation/approval waits do not consume provider execution capacity. Reacquire a slot before continuing an automation after approval/input. This is a local resource limit, not a new distributed worker pool.
5. **Claim with compare-and-set.** Use an opaque owner token and expiry; every mutation checks the current token. If renewing a live claim is needed, use the same scheduler's nearest-deadline wake logic. Stale owners cannot advance status, admit, or settle work. A lease only controls scheduler bookkeeping; it does not make the existing process-local session runner distributed.
6. **Protect the single-server execution boundary.** Confirm the managed-server singleton/DB ownership behavior. If a second process can target the same database, prevent a second scheduler from executing there with the existing ownership mechanism or one narrow durable owner guard. Never recover a promoted run merely because its lease expired while its old provider execution may still be alive. Multi-process claim tests verify deduplication, not clustered provider execution support.
7. **Validate at execution time.** Re-resolve target, trust, definition revision, current enabled state, agent, credentials, model/harness and variant before admission. If unavailable, record a clear failure/attention requirement; do not fall back. A stored schedule is authorization to attempt its configured task through ordinary permissions, not permission to bypass tool approvals.
8. **Use the stored session/message identities.** For new-thread mode, allocate both once when the occurrence is created and reconcile the same standalone session. For existing-thread mode, verify it still belongs to the authorized target. Submit with `delivery: queue`; never interrupt or steer the user's active work. Use `resume: false` if needed to commit association before advisory wake, then wake through the existing execution service.
9. **Make admission retry-safe.** A crash between input admission and updating the run row must reconcile the exact existing message via `SessionInput`. Conflicting payload/session/revision reuse is an error. Recheck paused/deleted state for unpromoted automation inputs at the normal promotion boundary, or remove them through an existing safe inbox-cancellation operation. Do not rely solely on checking before an asynchronous create call.
10. **Observe real outcomes.** Associate the occurrence with its admitted message and recorded sequence. Reuse durable session events and add only a small boundary event/hook if required. Track it from promotion through confirmed completion/failure/approval/input. At most one automation continuation owns an active outcome boundary in a thread; user steering may extend that continuation, so document that completion waits for its safe terminal/idle boundary. A status change from unrelated prior work must not settle a queued occurrence. Catch up events after reconnect from the saved boundary rather than repeatedly reading full history.
11. **Persist approval/input state without persisting grants.** A live approval reply resumes the same waiting continuation. On restart, reconcile whether the original continuation/decision is recoverable. An orphaned in-memory approval does not become approval: mark interrupted/attention-required and show an explicit recovery action. Never re-submit the entire prompt just to recreate an approval dialog.
12. **Implement safe retry/cancel.** Retry only transient failures proven to occur before promotion, using the same occurrence/session/message identity and bounded delays (for example 1, 5, 30 seconds, then fail). After uncertain promoted execution, user recovery resumes/reconciles the existing thread; it does not create a second automatic occurrence. A deliberate Run again is a new manual occurrence with separate identity and provenance. Pausing stops future admissions; cancelling active work uses normal session interruption and reports that already-completed external effects are not undone.

## Crash recovery matrix

| Crash point | Required recovery |
| --- | --- |
| Before occurrence transaction commits | Due query may create it later |
| After occurrence exists, before claim | Reclaim the same occurrence |
| After claim, before target creation | Expired pre-admission claim reuses allocated IDs |
| After target creation, before input admission | Reuse target session; admit stored message ID |
| After admission, before run projection update | Locate the exact input and mark admitted; no second message |
| After admission, before promotion | Wake the durable input when policy/revision remains valid |
| After promotion/provider start | Reconcile confirmed durable terminal evidence; otherwise mark interrupted |
| After external effect, before recorded tool result | Mark interrupted; do not rerun automatically |
| After terminal result, before automation outcome | Derive outcome from durable session boundary and persist once |
| After outcome, before notification/hook delivery | Replay the lifecycle event; delivery consumers deduplicate |

## Tests and acceptance

Use real SQLite and controllable clock/provider fixtures. Add a small cohesive scheduler test suite rather than one mock-heavy suite per function.

- One-time, interval anchor, daily, selected weekdays, invalid/unknown zones, leap day, spring gap, fall repeat, and machine timezone changes.
- Multi-day downtime coalesces to one catch-up run without iterating every missed minute; next due is strictly future.
- Two racing claimers produce one occurrence/admission; expired pre-admission lease recovers; stale token cannot settle; promoted lease expiry does not rerun a provider.
- Inject interruption at every matrix boundary and reopen persistence in a fresh service/process. Assert exact session/message counts and accurate status.
- Busy target receives one queued input; unrelated session idle event cannot complete it; user steering and two schedules targeting one thread remain serialized.
- Permission ask/deny, user question, approval after waiting, app exit during approval, missing credentials/model, deleted target, disabled agent, revoked Project trust.
- Pause/edit/delete while queued, claimed, admitted-unpromoted, and running; no old revision starts after an effective cancellation boundary.
- Rebuild automation projections from durable events and recover definition revisions, occurrence uniqueness, and terminal outcomes without re-execution.
- Fresh database, migration from current schema, API revision conflicts, and bounded history pagination.

Performance check: seed 10,000 mostly future/disabled definitions. Verify due lookup uses the intended index, returns bounded rows, and causes no transcript reads. Verify one timer/service instance and bounded active execution with isolated fixtures. Measure scheduler work separately from provider latency. Run affected Core/API tests and typechecks, migration generation/check, and client generation; Plan 07 owns the UI acceptance.

## Completion boundary

The API, durable engine, normal permissions, and recovery matrix must work before UI code relies on them. Do not mark the feature complete with only persistence tests and a happy-path timer. Do not build cross-host execution, exactly-once external effects, a second event bus, or generic workflow orchestration.
