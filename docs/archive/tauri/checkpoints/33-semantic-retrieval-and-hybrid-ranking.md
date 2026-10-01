# Checkpoint 33: Semantic Retrieval and Hybrid Ranking

## Outcome

Users may opt into a pluggable semantic index that improves retrieval while deterministic FTS/graph search remains available, inspectable, and fully functional when semantics are disabled.

## Source plan

- Sections 6.6, 14.2-14.3, and Phase 14
- Backlog semantic extension to D/G

## Prerequisites

- Checkpoints 15, 20, and 32

## Scope

- Define embeddings-provider and vector-index interfaces.
- Support an initial local provider/index and optional remote provider only with explicit privacy settings.
- Chunk, enqueue, store, invalidate, and rebuild vectors by source hash and provider version.
- Add semantic candidates and documented hybrid ranking weights.
- Show semantic reason, provider, privacy status, and score contribution.
- Add enable/disable, rebuild, storage, and health controls.
- Keep packet policy and sensitive-file exclusion ahead of remote embedding calls.

## Expected artifacts

- Provider-neutral embedding/vector interfaces.
- Vector cache/index implementation.
- Background jobs and invalidation.
- Hybrid ranking and inspector explanations.
- Feature flag, privacy settings, diagnostics, and quality fixtures.

## Work items

1. Fingerprint vectors by source hash, model, normalization, and chunking version.
2. Never send denied or sensitive content to a remote provider.
3. Merge semantic and deterministic candidates with stable tie-breaking.
4. Maintain result diversity.
5. Make vector corruption/rebuild independent of authoritative SQLite recovery.
6. Compare retrieval quality on a versioned evaluation set.
7. Fall back cleanly when provider/index is unavailable.

## Acceptance evidence

- Semantic retrieval can be disabled with no loss of core search/context functionality.
- Source edits invalidate affected vectors.
- Rebuild reproduces a healthy index for the configured provider/version.
- Context inspector identifies semantic contribution and provider.
- Remote embedding use requires explicit consent and honors exclusions.
- Hybrid retrieval meets its stated performance target or reports the limitation.

## Validation focus

- Provider/model change
- Dimension mismatch and corrupt index
- Offline mode
- Privacy policy downgrade
- Duplicate semantic/lexical candidates

## Out of scope

A custom vector database, mandatory cloud embedding, and semantic results presented as authoritative relationships.

## Handoff

Document the evaluation set, observed retrieval tradeoffs, provider costs/privacy, and safe fallback behavior.
