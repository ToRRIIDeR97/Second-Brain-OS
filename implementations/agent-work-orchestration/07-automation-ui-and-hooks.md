# Plan 07: automation management, history, notifications, and hooks

Read [README](README.md) first. Prerequisite: [Plan 06](06-durable-scheduler.md) passes its persistence/recovery tests. Use Plan 02 when verifying scheduled Codex sessions that themselves invoke orchestration tools.

## Outcome

Users can create, inspect, edit, pause/resume, and remove Project/thread automations; see their next run and history; and open work needing attention. Meaningful state changes reach existing in-app/desktop notification surfaces and plugin subscribers without duplicate execution or full-transcript payloads.

## Read and trace

- The Plan 06 domain, API, durable event types, and generated client.
- `opencode/packages/app/src/pages/projects.tsx`, current Project/session actions, and the existing settings navigation. Choose one reachable management entry point after tracing current routes.
- `opencode/packages/app/src/components/settings-v2/parts/row.tsx`, `parts/list.tsx`, existing dialogs/forms, and typed i18n patterns.
- `opencode/packages/app/src/context/notification.tsx`, `context/platform.tsx`, `context/server-sdk.tsx`, and global event subscriptions.
- `opencode/packages/core/src/event.ts`, `plugin/internal.ts`, `plugin/host.ts`, and current plugin context construction.
- `opencode/packages/plugin/src/v2/effect/context.ts`, `effect/event.ts`, `promise/context.ts`, and the legacy `src/index.ts` hooks. Verify which contracts are actually used; do not assume a legacy event hook sees new durable events.
- Desktop notification bridge only if needed; keep Electron IPC thin.

## UI design and defaults

Use one Project-scoped Automations list with a session action that opens the same editor prefilled for that thread. Follow current navigation patterns rather than adding a new top-level shell. The list can filter the selected Project; do not fetch all runs from all servers.

The editor contains:

- Name, Project/workspace, and target mode: existing thread or new thread per run.
- Plain-text prompt, selected agent/runtime/model, and valid variant/reasoning effort.
- One time / fixed interval / daily / selected weekdays; native date/time/number controls where suitable.
- An explicit IANA timezone with current timezone as the initial choice, never an implicit stored fallback.
- A server-computed preview of the next three occurrences, showing local date/time and offset so DST is understandable.
- Notification policy: attention/failures (default), all outcomes, or none.
- A concise execution note explaining server availability, one catch-up occurrence after downtime, overlap handling, and normal permission prompts.

Keep schedule values structured. The backend is authoritative for validation and next-time preview; do not duplicate recurrence/DST logic in the renderer. Saving should persist one normalized definition, not natural-language instructions that a model reinterprets on each run.

## Implementation steps

1. **Connect the generated API.** Verify actual app client resolution using the README's vendored-package check. Create small typed query/mutation helpers only where the UI needs them; do not introduce a new state library.
2. **Build the list and editor.** Use existing components, a single local form store, and typed i18n. Show enabled/paused state, target, selected model, next due time, and last outcome. Load model options on demand from existing discovery and preserve invalid saved selections visibly instead of replacing them silently.
3. **Handle draft and revision conflicts.** Keep unsaved form text on validation/network/conflict errors. Save with the server revision; show a clear reload/review choice when someone else edited it. Preview relevant changes before updating a schedule with pending work. The Plan 06 edit/cancellation rules remain authoritative.
4. **Implement actions precisely.** Pause stops future admissions and shows what happens to pending work. Resume recomputes/validates next due according to the engine. Remove archives/disables the definition while retaining its run history; do not delete historical sessions. Active cancellation uses the existing session interruption route and cannot promise to undo completed tools.
5. **Add bounded history and details.** Fetch 50 runs per page. Show scheduled/started/finished times, model, target thread, status, late/coalesced indicator, and a bounded error/attention message. Lazy-load detail when opened. The actual session is the place to inspect its transcript; history rows must not embed it.
6. **Make recovery understandable.** `needs_approval` opens the existing session approval flow; `needs_input` opens the existing question flow. `interrupted` explains that work may have partly completed and offers Open thread and explicit Resume existing work/Dismiss actions supported by the engine. Run again creates a distinct manual occurrence and must not masquerade as retrying the same automatic one.
7. **Subscribe through existing server events.** Update only affected definition/run rows and counters. One shared event subscription per server is enough; no polling per row or per dialog. Reconnect uses durable event identity/cursor and refreshes relevant paginated data if a cursor is invalid.
8. **Route notifications once.** Reuse existing in-app and platform notification APIs. Use `(server, runID, lifecycle eventID, channel)` as delivery identity. Apply policy at presentation time; history is always updated. Avoid duplicate generic “session completed” and automation completion notifications for the same outcome by designating one notification path for automation-owned runs. Clicking opens the exact run/thread and never auto-approves it.
9. **Persist delivery bookkeeping minimally.** Reuse the existing notification store if it can retain event identity across restarts; otherwise add only the small cursor/delivery record needed for this consumer. OS notifications cannot generally be committed atomically with SQLite: prefer no repeat pop-up after restart while the durable in-app history remains recoverable, and document that an OS pop-up may be missed at the crash boundary. Do not claim exactly-once OS delivery.
10. **Expose automation lifecycle events to plugins.** Provide typed queued, started, completed, failed, needs-approval, and interruption/input/cancellation equivalents through the current plugin event mechanism. Scope subscriptions to the plugin's authorized Location/Projects; a generic event stream must not disclose other Projects' metadata. Payloads carry automation/run/session/Project IDs, revision, scheduled instant, status, and safe error codes. They exclude prompt bodies, transcripts, credentials, reasoning, and terminal output. Distinguish execution-data events from the safe plugin-facing projection.
11. **Make plugin delivery recoverable, not magical.** Reuse EventV2 durable cursors/subscriptions and the existing plugin lifecycle. State at-least-once delivery with stable event IDs so consumers can deduplicate. If automatic replay per plugin requires a durable cursor not already present, add a narrow automation subscriber cursor; do not build a universal event delivery platform. Deliver in order per run, advance cursor after successful handling, and isolate slow/failed handlers from scheduler execution with bounded buffering and bounded retry. A hook failure never reruns the agent task.
12. **Verify both plugin styles actually supported.** If the app supports Effect and Promise plugin contexts, expose equivalent typed events through the existing adapter. A legacy generic hook may consume the safe projection if its normal event bridge supports it. Do not redesign plugin boot or silently expose the raw execution-data event stream to legacy hooks.

## Performance constraints

- No transcript fetch when opening the Automations list or rendering a notification.
- Paginated history and narrow event updates; no complete list sort/rebuild on every stream token.
- Compute schedule preview on change with existing debounce utilities, not every render.
- Reuse model selector caching; do not recreate the model-picker lag addressed by unrelated local work.
- Lazy-load the editor/detail content and avoid loading a timezone catalogue or every provider during app startup unless already shared/cached.
- Slow plugins cannot hold a database transaction, block a session drain, or prevent another consumer from receiving events.

## Tests and acceptance

Use one focused UI spec with isolated fixtures and additional targeted unit/integration cases for event delivery:

- Create a one-time schedule from a Project and a recurring schedule from a thread; verify stored target, prompt, model, timezone, next-time preview, and notification policy.
- Edit, pause/resume, revision conflict with retained draft, remove/archive with preserved history, and unavailable model/agent.
- Keyboard-only form flow, labels, focus recovery, translated errors, and validation around daylight-saving examples.
- Due run appears queued/running/completed; permission/input need opens the correct existing flow. No hidden auto-accept occurs.
- Relaunch an isolated test server/renderer and verify persisted definitions, history, exact occurrence identity, catch-up behavior, and an interrupted run's honest recovery UI. Never restart the user's live app/server for this test.
- Notification policy choices, replay deduplication, generic session-notification suppression, click navigation, and persistence across renderer reconnect.
- Plugin fixture receives each required lifecycle event, stable IDs, ordered replay, and safe fields; duplicate delivery can be deduplicated. Inject a handler failure and prove the scheduler still settles once.
- History remains paginated with many runs; opening the list performs no transcript requests. Measure affected UI interaction using existing performance tools.
- End-to-end smoke matrix: OpenCode scheduled run; configured Codex scheduled run; normal permission wait; pre-admission restart; promoted uncertain interruption. Separately verify the Plan 02 `create_thread` action remains guarded if a scheduled Codex run invokes it.

Run affected app unit/E2E checks, app build/typechecks, plugin/Core integration tests, and client checks. Run desktop build/typechecks only if its code changed. Use recorded protocol/fake-provider tests for deterministic coverage and report any live provider check that could not run.

## Final feature acceptance

Review the original request against all seven plans. Confirm:

1. Standalone threads are created only after the specified confirmation, with exact model selection and one initial prompt.
2. Both supported source runtimes can invoke the guarded creation tool.
3. Custom agents persist in canonical files and execute with real V2 inherited restrictions/depth limits.
4. Both thread-reference attachment methods retain authorized, bounded, inspectable context through both model paths.
5. Schedules survive restart, admit once per occurrence, recover uncertain work without automatic replay, and retain accurate history.
6. Hooks and notifications carry durable lifecycle identity and obey their stated delivery guarantees.

Do not run a broad unrelated cleanup or create a new benchmark/test framework to finish this checklist. Report any acceptance gap explicitly; passing compilation is not enough.
