# Checkpoint 20: Context Retrieval and Deterministic Ranking

## Outcome

A task objective resolves to a policy-safe, explainable set of candidate project, decision, task, file, chunk, graph, and history items without loading an entire repository.

## Source plan

- Sections 8.4, 14.2-14.4, and 15.1-15.3 stages 1-4
- Phase 8 retrieval tasks
- Backlog G001-G006

## Prerequisites

- Checkpoints 05, 15, and 16

## Scope

- Define and validate `ContextRequest`.
- Resolve effective read policy before retrieval.
- Resolve primary/secondary projects, intent, requested action, and expected output.
- Reuse search candidate generation and graph adjacency.
- Add project card, current decision, active task, selected item, recent change, and prior-session-summary candidates.
- Resolve current versus historical versions and surface unresolved contradictions.
- Produce deterministic scores, reason codes, required/optional status, and exclusion reasons.

## Expected artifacts

- Context request and candidate types.
- Policy, project, intent, retrieval, and version-resolution stages.
- Explainable ranking/reason-code catalogue.
- Cross-project boundary tests.
- Retrieval quality fixtures.

## Work items

1. Apply workspace, ignore, sensitivity, provider-data, and inferred-data policy first.
2. Start cross-project requests with project cards only.
3. Give explicit selections deterministic priority without bypassing policy.
4. Prefer current explicit decisions and file content over inferred or historical data.
5. Include unresolved contradictions as data rather than choosing silently.
6. Apply diversity so one source cannot occupy the candidate pool.
7. Return exclusions without leaking sensitive content.

## Acceptance evidence

- A project-scoped objective retrieves relevant material without attaching unrelated project roots.
- Every candidate and exclusion has a stable reason code.
- Sensitive or agent-ignored files never enter readable candidate content.
- Current explicit state outranks inferred and historical state.
- Repeating against the same generation and policy produces the same ordered candidates.
- Cross-project writes are not implied by cross-project reads.

## Validation focus

- Ambiguous project names
- Selected-but-denied items
- Contradictory decisions
- Deleted or stale chunks
- Prompt-like text inside retrieved notes

## Out of scope

Token packing, serialized packets, MCP, model-based intent inference, and agent launch.

## Handoff

Publish candidate and reason-code schemas for the packer, inspector, audit log, and MCP.
