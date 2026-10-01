# Plan 02: expose guarded orchestration tools to Codex

Read [README](README.md) first. Prerequisite: [Plan 01](01-thread-creation.md) is complete. This plan closes one concrete runtime gap: a Codex source session must be able to invoke the same `create_thread` operation as an OpenCode source.

## Outcome

The configured Codex harness advertises the guarded application tool through its supported app-server protocol. A call reaches the canonical tool registry with trusted session/message/call identity, shows the same approval, and returns the same bounded result. Native Codex tools and approvals keep their existing behavior.

## Read and trace

- `opencode/packages/core/src/harness.ts`: runtime creation/resumption, request parameters, `handleCodexRequest`, streamed events, and model discovery.
- `opencode/packages/core/src/harness/codex-app-server.ts`: JSON-RPC request/response transport and interruption.
- `opencode/packages/core/src/session/runner/llm.ts`, `runner/publish-llm-event.ts`, and `session/message-updater.ts`: assistant message and recorded tool identity.
- `opencode/packages/core/src/tool/registry.ts`, `tool/tool.ts`, and `tool/AGENTS.md`: materialized definitions, execution, stale registration detection, and output bounding.
- `opencode/packages/core/test/harness.test.ts`, `codex-app-server.test.ts`, and `session-runner-tool-events.test.ts`.

## Verify the installed protocol first

Inspect the configured Codex binary version and its supported app-server schema generation/help commands. Generate schemas into a temporary directory if supported. Use official OpenAI protocol documentation only as a fallback and record the actual binary/version tested. Do not guess a tool-registration field or callback shape from memory.

Confirm all of these before wiring production behavior:

1. The protocol can advertise host-executed tool definitions.
2. It issues callbacks with stable call identity and accepts bounded success/error results.
3. Registration behavior on both new threads and resumed threads is understood.
4. Cancellation, reconnects, and duplicate callbacks are observable.

If the installed supported version lacks the necessary mechanism, report the exact missing capability and compatible-version requirement. Keep native harness execution working, show the feature as unavailable, and do not claim this plan complete. Do not silently substitute shell scripts or an unrestricted local HTTP/MCP server.

## Implementation steps

1. **Advertise the smallest tool set.** Initially expose only `create_thread`. Use its existing canonical schema/definition. A short explicit allowlist is enough; do not forward every OpenCode tool, which could duplicate native shell/file tools or change security behavior.
2. **Carry the existing materialization through the harness boundary.** The runner already materializes tools. Pass only the narrow invocation/definition capability the bridge needs. Keep `ToolRegistry` Location-scoped. Do not add another executable tool type, registry, or permission evaluator.
3. **Bind protocol callbacks to the active turn.** Obtain trusted source session, selected agent, assistant message, and external tool-call IDs from runtime state. Reject callbacks for another thread, unknown turn, completed turn, missing tool, or stale registration. Never take source session IDs from tool arguments.
4. **Record a single tool lifecycle.** Project the call once into the existing session event/message path, settle through `Materialization.settle`, then return the protocol result. Determine whether the provider emits a matching tool event and reconcile it by stable call ID so the timeline does not show duplicate calls or results.
5. **Use the leaf's real approval.** Plan 01 remains responsible for validation and confirmation. Catalog visibility is not execution authorization. Native Codex approval callbacks continue using their existing route.
6. **Handle duplicate delivery safely.** Reuse the Plan 01 operation key across callback retries. Within a running turn, join an in-flight call by stable ID and reject a duplicate ID with a different argument fingerprint. After a process crash, reconcile from the durable operation record rather than replaying creation. Do not persist arbitrary raw protocol frames.
7. **Bound output once.** Canonical settlement owns generic bounding. Encode its bounded text/error result into the protocol-supported response. Do not truncate independently in several layers or return secrets, hidden reasoning, or terminal output.
8. **Handle cancellation and resumption.** Declining approval returns a meaningful tool error. Interrupting the turn cancels outstanding callbacks and removes in-memory waiters. Resuming a thread restores tool availability according to the verified protocol; reject stale callbacks from an old runtime generation.
9. **Keep capability failure explicit.** Unsupported protocol versions produce a targeted explanation for this tool, while ordinary Codex conversations keep working. Do not silently claim a thread was created.

## Performance constraints

Register tools at the appropriate runtime/thread lifecycle boundary, not on every stream token. Keep callback lookup in a per-runtime map and clean it at turn settlement/disposal. Do not introduce a second process, local listener, periodic polling, or a JSON-RPC library when the existing transport already covers the protocol.

## Tests and acceptance

Use the existing fake app-server transport for deterministic tests, backed by the real tool registry and operation logic:

- Correct advertised schema and callback response shape for the verified protocol version.
- Success, one-time approval, rejection, and explicit permission deny.
- Unknown tool, forged source identity, wrong thread/turn, stale runtime generation, and schema-invalid arguments.
- Duplicate callback joins/reconciles once; changed arguments under the same call ID fail.
- One timeline call/result despite provider echoes.
- Cancellation while approval is pending and while an approved operation is admitting its prompt.
- New thread and resumed thread both expose the capability.
- Existing native command/file approvals and model discovery still pass their affected tests.

Finally run one live smoke check using a supported configured Codex harness and an isolated test Project: explicitly request a new thread, approve the preview, and verify the selected destination model, single starting prompt, and navigation. If credentials or the binary prevent this check, report that limitation and retain protocol test evidence without inventing a live pass.

## Completion boundary

Both source runtimes can now invoke the same Plan 01 action. Do not port Codex-native subagent settings, build a universal provider-tool adapter, or expose all local tools as part of this plan. Future orchestration tools may join the same narrow bridge after their own permission and retry contracts exist.
