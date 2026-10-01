# Plan 03: complete the V2 subagent execution path

Read [README](README.md) first. This is a prerequisite for claiming that the Agents settings page can launch managed OpenCode subagents. Reconcile shared session/schema changes from Plan 01 before editing them.

## Outcome

The current V2 OpenCode runner exposes `task` for configured subagents, creates a real child session, runs it through normal durable admission, enforces inherited restrictions and nesting limits, and returns a bounded result. Foreground and the existing opt-in background behavior work without delegating execution to the legacy loop.

## Read and trace

- `opencode/packages/opencode/src/tool/task.ts`, `agent/subagent-permissions.ts`, and relevant legacy task/agent tests: behavioral reference, not the new execution route.
- `opencode/packages/core/src/tool/builtins.ts`, `tool/registry.ts`, and `tool/AGENTS.md`.
- `opencode/packages/core/src/session.ts`, `session/execution/local.ts`, `session/run-coordinator.ts`, `session/input.ts`, and `session/runner/llm.ts`.
- `opencode/packages/core/src/permission.ts`, `config/agent.ts`, `config.ts`, and `agent.ts`.
- `opencode/packages/schema/src/session.ts`, `session-message.ts`, and `permission.ts`; Core session SQL/info/projector.
- `opencode/packages/core/src/background-job.ts` and its owning lifetime.
- `opencode/packages/app/e2e/regression/subagent-child-navigation.spec.ts` and session lineage/sidebar helpers.

The V2 public session creation input currently does not expose all legacy child-session fields. The V2 permission resolver currently reads agent permissions rather than enforcing legacy `SessionTable.permission`. Copying the old tool and setting `parentID`/permission metadata alone is insufficient.

## Contract and defaults

- Keep the existing task argument meanings: description, prompt, subagent type, optional task ID for continuation, and optional background flag. Preserve valid existing callers where possible.
- Execute custom subagents on the OpenCode runtime. Do not reinterpret these definitions as Codex-native agents. Plan 02 does not automatically expose `task` to Codex; that would need an explicit capability decision.
- Resolve only enabled agents with mode `subagent` or `all`. A primary-only agent is not a task target. Hidden affects picker visibility; it is not a permission boundary.
- A child stays in its parent's authorized Location. Cross-Project standalone work uses `create_thread`, not `task`.
- Preserve the configured nesting limit and existing default. If V2 config does not yet carry the legacy setting, migrate that one setting and its validation; do not invent a parallel configuration system.
- Return child session ID and bounded final visible assistant text, plus error/status. Never copy reasoning or full tool output into the parent.

## Implementation steps

1. **Port the smallest leaf.** Add a canonical V2 `task` tool using existing `Tool.make`, Location registration, and captured services. Keep legacy task code intact for its remaining callers. Reuse pure validation/permission helpers only if their policy representation matches; otherwise implement the small V2 equivalent and test it against the same intended behavior.
2. **Add durable child creation support.** Extend the internal V2 create path and typed events with parent identity and the minimum inherited permission metadata. Preserve standalone semantics from Plan 01. All child creation validates parent existence and Location. Update schema, SQL projection if needed, and read normalization together.
3. **Enforce ancestry and depth.** Count real stored ancestry, reject cycles/corrupt ancestry, and check the limit before creation or resumption. Resuming an arbitrary session ID is forbidden: require that it belongs to the invoking parent and allowed Location. Reject a different agent/runtime instead of silently retargeting a task.
4. **Make inherited policy effective.** Capture the parent's applicable restriction ceiling at delegation and combine it with child/global policy in `PermissionV2`'s actual authorization path. Evaluate ceilings separately so a child's broad allow or a saved approval cannot override a parent deny. Preserve `ask` requirements; do not inherit unrelated remembered approval grants as blanket authority. Reuse the same effective policy for tool catalog filtering where practical, while retaining leaf checks as the security boundary.
5. **Close escape paths.** Enforce this ceiling for shell, file mutation, external directories, nested tasks, and any exposed application tools. Deny standalone thread creation from child sessions by default. Check the real V2 tool paths rather than adding UI-only guards. A focused shared permission change is smaller and safer than per-tool patches.
6. **Select and persist the model.** Use the configured child model/variant, otherwise inherit the parent's compatible OpenCode model/variant. Reject unavailable or incompatible choices. Do not inherit a harness model as if it were an OpenCode provider model.
7. **Use stable call identity.** Allocate child and initial prompt IDs once per parent tool call; persist enough linkage to reconcile duplicate settlement. Exact retries do not create another child or duplicate the initial task. A later valid continuation uses a new prompt ID under its own call identity.
8. **Admit and run through V2.** Submit the prompt to `SessionV2.prompt` and use the existing session coordinator. Foreground waits for the child's actual terminal outcome. The child is a different session, so the waiting parent must not hold a process-wide lock or deadlock the execution coordinator.
9. **Preserve cancellation and failures.** Parent cancellation interrupts its owned active child chain using the existing ownership model. A child model/tool failure is reported as failure with a navigation target, not converted into an empty success. Pending approval is visible on the child and remains reachable from the parent.
10. **Add opt-in background parity.** Reuse `BackgroundJob` only for in-process observation/waiting, not durable scheduling. A normal end of the parent's turn does not cancel a deliberately backgrounded child; explicit cancellation follows the existing ownership policy. Deliver completion back to the parent through one durable V2 input with a stable completion identity. Document that app/server exit interrupts background execution and does not automatically rerun provider work. If no background feature flag is active, reject the argument clearly.
11. **Keep navigation distinct.** Existing child-session UI should show ancestry and open the child. Standalone threads from Plan 01 must remain top-level. Preserve existing timeline/subagent behavior without rebuilding it.

## Keep the design small

No subagent pool, work queue, generic agent router, separate context database, or new model execution loop. Use stored ancestry and a short traversal rather than a graph service. The durable child session and prompt already represent the work; do not add another parallel job identity unless the existing background observation API requires one.

Do not add a global semaphore around all tasks. If a proven fan-out resource problem requires a cap, use the existing execution controls and report the measured reason. Nesting enforcement and cancellation are required regardless.

## Tests and acceptance

Use real session persistence, actual permission resolution, and a tiny fake provider:

- Enabled subagent/all agent works; primary-only, disabled, unknown, and unauthorized target fail before child creation.
- Child has durable ancestry after replay; standalone thread has none.
- Parent deny plus child allow remains denied; parent ask plus saved child allow still cannot bypass the inherited ceiling; child stricter deny remains denied.
- Exercise actual shell/file/external-directory and nested-task authorization with harmless temporary fixtures, rather than testing only a policy-merging helper.
- Depth limit at its boundary, ancestry corruption/cycle, wrong-parent task ID, wrong Location, and child-to-standalone escape attempts.
- Model/variant inheritance, configured override, unavailable model, and incompatible harness parent selection.
- Duplicate tool settlement creates one child and one initial input. Explicit continuation targets the same child once.
- Foreground success, model failure, tool failure, approval wait/rejection, and cancellation propagation.
- Opt-in background immediate return and exactly one parent completion input; disabled background flag fails clearly. Simulated restart does not claim durable background recovery.
- UI child navigation remains distinguishable from the Plan 01 standalone thread.

Run affected Core session/tool/permission tests and typechecks, schema/client generation when required, and the existing targeted subagent UI coverage. Record session/timeline performance before and after. Finish this runtime path before treating Plan 04's agent execution acceptance as satisfied.
