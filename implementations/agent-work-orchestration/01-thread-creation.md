# Plan 01: guarded standalone thread creation

Read [README](README.md) first. Implement this plan only. Plan 02 adds invocation from Codex; this plan must already support creating a destination thread using either a valid OpenCode model or a valid configured harness model.

## Outcome

An OpenCode agent can act on an explicit user request to create a user-owned thread in an authorized Project. The user sees the exact destination, model, and starting task before approving. Approval creates one standalone session, admits the initial prompt once, and opens it. A failed or repeated response cannot silently create another session.

## Read and trace

- `opencode/packages/app/src/components/prompt-input/submit.ts`: existing create, seed, promote, and navigate behavior.
- `opencode/packages/core/src/session.ts`, `session/input.ts`, `session/projector.ts`, `session/info.ts`: creation, prompt identity, durable metadata, and projection.
- `opencode/packages/core/src/project.ts`, `location-service-map.ts`, and `harness.ts`: target and harness resolution.
- `opencode/packages/core/src/catalog.ts`, `session/runner/model.ts`: target model availability and selection.
- `opencode/packages/core/src/tool/question.ts`, `tool/registry.ts`, and `tool/AGENTS.md`: canonical tool registration and invocation identity.
- `opencode/packages/core/src/permission.ts`: actual allow/ask/deny behavior.
- `opencode/packages/protocol/src/groups/session.ts`, `packages/server/src/handlers/session.ts`, and `packages/client/README.md`.
- `opencode/packages/app/src/context/tabs.tsx`, `server-session.ts`, and `pages/session/session-lineage.ts`: verify current paths and navigation ownership.

## Contract

Use the current casing/types from Schema. These are conceptual fields, not permission to duplicate branded IDs:

- Target: server identity, registered Project ID, workspace ID when applicable, and an optional validated relative checkout path. Resolve directory server-side. An omitted target means the source session's registered Project, never an arbitrary cwd supplied by the model.
- Runtime selection: a discriminated choice between OpenCode `{agentID, providerID, modelID, variant?}` and harness `{instanceID, modelID, reasoningEffort?, serviceTier?}`. Do not accept contradictory OpenCode and harness fields.
- Content: title (1–200 characters), initial prompt (nonempty; at most 64 KiB UTF-8), and source request/message ID. Start with plain text; do not silently copy the source transcript or attachments.
- Identity: derive the operation key from trusted source session, assistant message, and tool call IDs. The model does not choose the operation key. Store a canonical payload fingerprint.
- Result: operation ID, session ID, resolved target/model, and explicit creation/admission state. If creation succeeded but admission failed, return the existing session ID and actionable failure; do not report total failure that invites duplication.

Use exact provider/model IDs when supplied. For friendly names, compare normalized IDs/display names within available target models. Accept one unambiguous exact match; otherwise return a short bounded candidate list for clarification. Do not select the first fuzzy match. Invalid reasoning effort is an error, not a downgrade.

## Implementation steps

1. **Add one domain operation.** Put it beside session/agent behavior, with a thin canonical `create_thread` tool leaf. Reuse target/model resolution in place; extract a helper only where another plan will actually call the same validation. Do not add a generic command bus.
2. **Resolve before confirmation.** Validate source session, trusted source message, destination membership/trust, runtime, agent mode, model, limits, and permission. Any explicit deny stops before creation. A source message ID is audit linkage, not proof that arbitrary model text is authorized.
3. **Require one-time user confirmation.** Show Project/workspace, runtime/model/variant, title, and initial prompt using the existing approval surface. The feature request explicitly requires approval. Existing broad auto-allow or saved `always` permissions must not bypass it. Inspect `PermissionV2`: if it cannot express a non-rememberable confirmation, add the smallest opt-in extension with deny precedence and unchanged defaults for all current callers. Do not build another approval subsystem or use a model-generated `approved: true` flag.
4. **Bind the decision to the exact payload.** Changing destination, prompt, runtime, or model requires a new confirmation. Revalidate availability and destination access after approval and before mutation. A stale Project or disconnected model produces no session.
5. **Persist operation identity before side effects.** Use one durable operation event/projection or existing equivalent, with a unique operation key, payload fingerprint, allocated session/message IDs, approval provenance, and status. Exact retries reconcile the stored operation; differing payloads conflict. Reuse these IDs on every retry. The existing create method adopts a reused session ID, so explicitly verify that an adopted session belongs to this operation and target.
6. **Create without `parentID`.** Record source session/message/tool IDs as provenance, not ancestry. Preserve existing harness metadata. Add the smallest typed metadata/event projection needed so creator, Project, model, and source request survive replay. Do not duplicate the full source prompt into audit logs.
7. **Admit the initial prompt through `SessionV2.prompt`.** Use the allocated message ID and normal execution/permission path. Return once admission is durable; do not wait for model completion. Handle a crash between creation and admission by reconciling the same operation and IDs. Before an approved but unadmitted operation resumes after restart, recheck authorization and exact payload/model validity; never persist a general permission grant.
8. **Navigate from structured results.** Extend existing tool-result/event handling and tab/session seeding. Only the initiating visible window opens the returned thread once; background windows and historical event replay must not steal focus. Keep a clickable result card for later navigation. Never parse an ID from prose or trust a model-generated URL as a navigation command.
9. **Regenerate and connect the client.** If the public API changes, follow the README's generation and vendored-client instructions. Verify the renderer calls the new contract without casts.

## Minimal storage and security

An operation record is justified by approval binding and crash-safe deduplication. Reuse the event log and a small projection; do not create a general workflow state machine. Distinguish unapproved, approved/pending admission, admitted, rejected, and failed only where recovery needs it.

Subagents may not use this tool to evade nesting restrictions. Default to denying `create_thread` from child sessions; a later explicit product decision can change that. All permissions in the destination are resolved there. Source permission grants must not turn into unrestricted cross-Project access.

## Tests and acceptance

Add focused cases to existing session/tool fixtures, with a small new `tool-create-thread.test.ts` or equivalent:

- Exact ID selection, unique display-name selection, ambiguous name, unavailable model, invalid variant/effort, and mismatched runtime fields.
- Valid cross-Project target, unknown target, forged workspace identity, escaped/symlinked relative path, and cross-server rejection.
- Deny beats confirmation; broad allow still requires this one-time confirmation; rejection/cancellation creates nothing; changed payload cannot reuse approval.
- Exact retry, concurrent duplicate calls, conflicting retry, and injected crash after creation before admission. Assert exactly one session and one admitted message.
- Created session has no parent, but durable provenance identifies its source after replay.
- Destination model/harness and initial task match the approved values. Missing provider credentials do not fall back to another model.
- UI acceptance: approve → destination opens → starting prompt appears once; decline leaves source selected; historical replay does not navigate.

Run targeted Core tests/typecheck, changed API package checks, app checks/build, and the focused UI test. Record the required session UI performance baseline and result. Creation should not load source transcripts or discover unrelated providers.

## Completion boundary

Complete only when an OpenCode source session creates and starts the approved standalone thread through the real UI/server path. A destination Codex thread is supported via existing harness execution; a Codex source invoking this new tool is completed in Plan 02. Skip worktree creation, cross-server dispatch, transcript cloning, bulk creation, and automatic model routing.
