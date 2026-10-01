# Checkpoint 16: Graph Ontology and Query API

## Outcome

The authoritative graph can answer focused, bounded, provenance-aware neighborhood queries without exposing a full-repository hairball.

## Source plan

- Sections 13 and 21.3
- Phase 6 backend dependency
- Backlog E001

## Prerequisites

- Checkpoints 13-15

## Scope

- Implement focused graph queries by node, document, project, filters, depth, and time.
- Enforce default and hard node/edge caps.
- Return authority, confidence, temporal validity, source counts, and layout hints.
- Add one-hop expansion and paged continuation.
- Add saved-lens persistence contract.
- Add source-navigation and context-action metadata without executing actions in the query layer.

## Expected artifacts

- Graph query types and service.
- Bounded adjacency SQL and indexes.
- Saved lens and position migrations.
- Explainable truncation/continuation metadata.
- Query correctness and performance tests.

## Work items

1. Resolve a centered subgraph from explicit start nodes.
2. Filter expired, deleted, inferred, workspace, project, node, and edge types.
3. Prioritize authoritative/current/high-relevance neighbors when capped.
4. Prevent duplicate nodes and edges across expansions.
5. Return source and provenance references for inspector use.
6. Persist lenses separately from authoritative graph data.
7. Keep graph query latency under the stated target for 300 nodes.

## Acceptance evidence

- A current file or node returns a bounded focused graph.
- One-hop expansion is deterministic and respects hard caps.
- Inferred/derived data can be excluded completely.
- Every visible relationship can be traced to a source or derived artifact.
- Temporal queries do not return superseded state as current.
- Query performance meets target on the graph fixture.

## Validation focus

- Cycles and high-degree hubs
- Deleted/invalidated sources
- Cross-workspace project-card edges
- Pagination and cap stability
- SQL query plans at scale

## Out of scope

React Flow, layout rendering, semantic link generation, and graph-triggered mutations.

## Handoff

Freeze the graph response schema used by the canvas, context compiler, and MCP resources.
