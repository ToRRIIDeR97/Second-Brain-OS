# Checkpoint 32: Derived Summaries, Claims, and Review

## Outcome

The system can generate and review provenance-rich derived summaries, claims, contradictions, and suggested relationships without presenting them as authoritative truth.

## Source plan

- Sections 10.2 derived tables, 12.8-12.9, and 13.3
- Phase 14 non-vector portion
- Backlog reliability/invalidation dependencies

## Prerequisites

- Checkpoints 14 and 16

## Scope

- Implement the derived artifact and dependency lifecycle.
- Add document, project, and area summary hierarchy.
- Add claim, contradiction, duplicate, concept, and relationship suggestions.
- Record source IDs/hashes, generator, model/tool version, prompt version, confidence, status, and invalidation.
- Add lazy background jobs with review/accept/reject flow.
- Promote accepted relationships through an explicit authoritative action, never implicitly.
- Allow derived processing to be disabled.

## Expected artifacts

- Derived job interfaces and artifact services.
- Generator adapter boundary.
- Review queue and provenance UI.
- Invalidation/rebuild integration.
- Recorded generator fixtures and deterministic lifecycle tests.

## Work items

1. Select bounded source packets for generators.
2. Store results separately from authoritative nodes/edges.
3. Eagerly invalidate artifacts when any dependency hash changes.
4. Regenerate lazily by priority.
5. Display confidence, provenance, stale state, and generator version.
6. Add accept, reject, dismiss, and regenerate actions.
7. Prevent derived text from becoming application instructions.

## Acceptance evidence

- Every derived artifact is traceable to immutable source hashes.
- Source edits mark direct and downstream artifacts stale.
- Inferred nodes/edges are visually and structurally distinct.
- Users can accept or reject suggested relationships.
- Disabling derived processing stops new jobs without affecting authoritative index behavior.
- All derived artifacts can be rebuilt.

## Validation focus

- Dependency cycles
- Generator/model version changes
- Partial generator failures
- Stale review decisions
- Prompt injection inside sources

## Out of scope

Embeddings, vector storage, mandatory remote models, and automatic promotion to authoritative facts.

## Handoff

Expose reviewed derived candidates and summaries to optional semantic retrieval while preserving authority metadata.
