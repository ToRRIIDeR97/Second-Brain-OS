# Checkpoint 21: Context Packing, Snapshots, and Inspector

## Outcome

Candidate context is packed into an immutable, bounded, deterministic packet that users can inspect and adjust before any agent uses it.

## Source plan

- Sections 15.3 stages 5-7 and 15.4-15.5
- Phase 8
- Milestone 7
- Backlog G007-G012

## Prerequisites

- Checkpoint 20

## Scope

- Implement provider-aware token estimation.
- Reserve and pack documented budget buckets.
- Serialize fixed packet sections with clear instruction/data boundaries.
- Store generation, request, scores, items, hashes, token counts, policy, approval state, and session links.
- Cache unused packet proposals by the documented fingerprint.
- Keep packets used by agents immutable.
- Build the context inspector with add/remove, depth, budget, exclusion, stale-state, and raw-preview controls.

## Expected artifacts

- Token estimator and budget packer.
- Versioned deterministic serializer.
- Context packet/item migrations.
- Context inspector UI.
- Cache and dependency invalidation.
- Golden packet fixtures and budget property tests.

## Work items

1. Reserve space for objective/policy, project, decisions, tasks, sources, relationships, changes, and manifest.
2. Prefer summaries before raw files while retaining source drill-down.
3. Guarantee required items or return an explicit budget failure.
4. Record source hashes and index generation.
5. Separate operating instructions from untrusted retrieved content.
6. Invalidate proposals when dependencies change but preserve used snapshots.
7. Let user adjustments re-run policy and budget validation.

## Acceptance evidence

- Serialized packets stay within budget tolerance.
- Every included source shows score, reason, authority, hash, and token estimate.
- Sensitive exclusions are visible without revealing content.
- A used packet cannot be mutated; edits create a new packet ID.
- A stale packet is clearly marked after source generation changes.
- Deterministic FTS/graph packets meet the performance target.

## Validation focus

- Tiny and impossible budgets
- Tokenizer/model mismatch
- Multibyte and code-heavy content
- Cache invalidation
- User re-adding denied sources

## Out of scope

MCP transport, agent providers, semantic retrieval, and automatic external actions.

## Handoff

Expose packet resources and immutable identifiers for MCP, agents, audit, and change review.
