# Checkpoint 15: Full-Text and Structured Search

## Outcome

Users can quickly open files and search indexed knowledge with deterministic ranking, inspectable filters, useful previews, and result diversity.

## Source plan

- Section 14
- Phase 5 search tasks
- Milestone 4
- Backlog D013-D014

## Prerequisites

- Checkpoint 14

## Scope

- Add quick-open and full-text search.
- Implement the version 1 structured query grammar and filter planner.
- Add deterministic candidate generation and ranking.
- Apply per-document, per-project, heading, and source-type diversity.
- Show snippets, paths, authority, status, project, and indexing state.
- Add natural-language-to-structured-plan interface behind an optional adapter, with plan inspection.
- Meet bounded output and pagination requirements.

## Expected artifacts

- Search service and query parser.
- Stable ranking implementation with deterministic tie-breaks.
- Search and quick-open UI.
- Query syntax reference and examples.
- Ranking, diversity, and performance fixtures.

## Work items

1. Implement exact ID/path, title prefix, FTS/BM25, metadata, project, graph-adjacent, recency, and pinned candidates.
2. Normalize component scores before applying documented weights.
3. Apply authority and deterministic tie-breaking.
4. Limit repeated chunks from one document or project.
5. Make accepted decisions and active tasks eligible for mandatory inclusion when relevant.
6. Highlight terms without corrupting Unicode or source offsets.
7. Explain parse errors and expose the translated structured plan.

## Acceptance evidence

- Search supports the documented type, project, workspace, status, date, tag, and inferred filters.
- Repeating the same query against the same generation returns the same order.
- A long document cannot monopolize the result page.
- Search result navigation opens the correct file and source range.
- FTS p95 meets the target on the 100,000-chunk fixture.
- Results identify stale or failed index state.

## Validation focus

- Quoting, escaping, invalid syntax, and Unicode tokenization
- Very common terms and empty queries
- Deleted or temporally invalid records
- Pagination stability
- Snippet content redaction

## Out of scope

Embeddings, semantic reranking, context budget packing, and graph canvas.

## Handoff

Expose candidate scores and reason codes so the context compiler can reuse search without duplicating ranking logic.
