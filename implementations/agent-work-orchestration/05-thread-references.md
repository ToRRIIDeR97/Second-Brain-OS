# Plan 05: bounded, authorized thread references

Read [README](README.md) first. Reconcile current prompt/session schema changes before editing. This plan is complete only when `@` selection and drag/drop use the same typed attachment, and the receiving model sees the exact authorized bounded snapshot.

## Outcome

Users can attach a thread from another authorized Project on the same server. The composer card shows Project, thread, optional message/turn, and a preview. The sent message retains an inspectable immutable snapshot. The app never fetches a whole transcript merely to render search results or a card.

## Read and trace

- `opencode/packages/app/src/context/prompt-state.ts`, `context/prompt.tsx`, and `components/prompt-input-v2.tsx`.
- `opencode/packages/app/src/components/prompt-input/build-request-parts.ts`, `submit.ts`, `editor-dom.ts`, `attachments.ts`, `paste.ts`, and `context-items.tsx`.
- Actual mention/popover and sidebar drag handlers found by searching callers, plus `pages/home/home-session-search-controller.ts`.
- `opencode/packages/schema/src/prompt-input.ts`, `prompt.ts`, `session-message.ts`, `session-event.ts`, and any active legacy compatibility adapter.
- `opencode/packages/core/src/session.ts`, `session/input.ts`, `session/history.ts`, `session/runner/to-llm-message.ts`, and `harness.ts`.
- `opencode/packages/protocol/src/groups/session.ts`, `packages/server/src/handlers/session.ts`, and project/workspace authorization code.

## Typed representation

Add a dedicated session-reference attachment to the existing prompt/message algebra. Do not disguise it as a file URL or append opaque prose to the text field.

Use existing branded identity types. The logical source locator contains server identity, Project ID, workspace ID where applicable, session ID, and optional message/turn ID. The server checks every relationship; redundant IDs are assertions to validate, not trusted routing instructions.

Separate the submitted locator from the resolved snapshot. A persisted snapshot includes the verified locator, display metadata, capture time/source boundary, bounded excerpt, exact byte count, truncation indicator, and a content revision/hash. User-submitted snapshot text is never trusted as a server-resolved transcript.

Limits: at most 5 references; at most 8 KiB UTF-8 per excerpt and 32 KiB combined per prompt, including visible metadata overhead. Use a Unicode-safe clipping helper and an explicit truncation marker. Renderer checks improve usability; server checks are authoritative. Apply the receiving model's remaining context budget as a further bound.

## Authorization and snapshot policy

- Search is limited to metadata the current user/session may discover. No transcript, tool output, or preview text is returned in search results.
- Preview and submission resolve the source server-side under the destination session's allowed cross-Project read policy. For a new-thread draft, validate its destination Location without creating a session merely to show a preview; repeat validation against the created session on submission. A registered Project is not automatically permission to disclose its conversations.
- If no suitable read policy exists, add one focused `session_reference.read` action with source/destination Project identities to the existing permission mechanism. Do not invent a global ACL service or treat an arbitrary drag payload as authorization.
- Reject mismatched server/Project/workspace/session/message identity, cross-server references, inaccessible sessions, and recursive expansion. A reference inside a referenced thread is displayed as a label, never recursively followed.
- Build deterministic excerpts from ordinary visible user/assistant text, with source roles and selected boundary. Exclude hidden reasoning, credential fields, attachments, raw tool payloads, and terminal output; reuse existing sensitive-field redaction. The user previews ordinary prose before disclosure: do not claim a regex can identify every secret someone pasted into a message. Prefer a selected message/turn; otherwise take a bounded recent window. Do not invoke an LLM to summarize on each attachment.
- At send time, revalidate source access and snapshot revision. If the preview is stale and would change, update the preview and require resubmission rather than silently sending different content. Persist only the approved bounded snapshot through the normal message path.
- Before later provider delivery/resume, recheck the relevant current access policy. Retained snapshots are data already disclosed to the destination, but new provider delivery must not bypass newly denied access. Display a blocked/stale card and omit or reject delivery according to the existing prompt error pattern; do not silently re-fetch content.
- Quote snapshots as untrusted source material in model input. Never merge their contents into system/developer instructions or interpret text inside them as approval. This reduces instruction confusion; it is not a claim that prompt formatting alone prevents every injection.

## Implementation steps

1. **Add paginated metadata search.** Extend the current session search/list path, scoped to authorized Projects. Support a normalized title query and cursor with 25 results. Reuse existing session indexes/search where possible. Do not add embeddings, a new search engine, or transcript FTS for title lookup. Inspect the query plan before adding a focused index.
2. **Implement bounded resolution in Core.** Fetch only a bounded page/selected turn from authorized history. Prefer current projected visible messages; do not replay every durable event for each preview. Bound both returned content and database work. Very large single messages must be clipped without an unbounded intermediate transcript allocation.
3. **Extend canonical schemas end to end.** Input locator, resolved prompt, durable user-message event, projector, stored message, retry equivalence, export/restore, and compatibility conversions must retain the new type. Old messages without references remain valid. When retrying the same prompt ID, compare canonical submitted identity and reuse the persisted snapshot; do not re-resolve live content and falsely create a retry conflict.
4. **Project to all supported model paths.** OpenCode provider input and Codex harness message rendering both receive the bounded attributed data. Ensure context compaction does not lose the source identity or duplicate the excerpt. Any unsupported consumer must reject explicitly rather than silently drop the attachment.
5. **Extend composer state and persistence.** Add a real reference card/part, stable identity, removal, preview, draft restore, history restore, and optimistic rendering. Update equality and serialization helpers so a failed send preserves the draft and successful send clears it correctly.
6. **Add `@` selection.** Reuse the mention popover with a Threads group/filter and origin labels. Debounce about 150 ms, cancel obsolete requests or ignore them by sequence, and load another page only on demand. The same short title in two Projects must remain distinguishable. Do not request source history until the user selects/previews an item.
7. **Add drag/drop through the same function.** Use a versioned internal MIME payload containing IDs only, then validate it as untrusted input. Invalid/external payloads do not become arbitrary file fetches. Preserve existing file/image drop behavior. Keyboard users can accomplish the same task through `@`.
8. **Render persisted cards and navigation.** Show origin, boundary, truncation, and exact captured excerpt. Open the source only on explicit user action. Deleted/archived/unavailable sources keep an honest snapshot/status; do not throw away the destination message.
9. **Regenerate the client and verify the renderer consumes it.** Include every affected schema/client consumer in typechecking. Avoid a legacy-only SDK change that leaves the actual V2 submission path unchanged.

## Tests and acceptance

Use a table-driven Core suite for authorization/limits and existing composer tests for serialization:

- Same-Project and authorized cross-Project reference; denied Project search/preview/send; revoked permission before send and before provider delivery.
- Forged server/workspace/Project/session/message combinations, malformed drag data, deleted source, and cross-server rejection.
- Maximum count, combined cap, UTF-8 multibyte boundaries, long title, huge source message, and truncation marker accuracy.
- Hidden reasoning/tool/terminal payloads absent; adversarial source text remains quoted data; nested references do not expand.
- Snapshot remains unchanged after later source edits; stale preview requires resubmission; exact prompt retry retains its original snapshot and admits once.
- Schema round trip, durable replay, draft/history restore, failed submit, optimistic display, export/restore, and old messages with no reference.
- OpenCode and Codex model-input fixtures contain the same bounded reference and source identity exactly once.
- One targeted UI flow covers `@` attach and another covers drag/drop, card inspection/removal, keyboard access, origin distinction, and source navigation.

Performance evidence: seed 10,000 session metadata rows and at least one large source thread in an isolated fixture. Show that search returns only 25 metadata rows, opening the popover issues no transcript reads, and preview memory/output remains bounded as source length grows. Reuse existing session UI benchmarks for latency/regression checks; do not invent an absolute latency claim from a single run.

## Completion boundary

Deliver both attachment entry methods and both model paths. Skip cross-server federation, live transcript subscriptions, semantic search, recursive references, and automatic summarization. Do not skip server-side authorization, persisted provenance, or retry-safe snapshot semantics to make the diff smaller.
