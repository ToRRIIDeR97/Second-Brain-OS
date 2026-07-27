# ADR-007: Render bounded focused graph queries

- Status: accepted
- Date: 2026-07-27
- Supersedes: none

## Decision

The renderer receives a bounded subgraph around a selected root, result,
project, or lens rather than a full-repository graph. The default is 100 nodes,
with a soft warning at 300 and a hard focused-view cap of 750.

## Consequences

Graph views stay understandable and responsive. Larger analyses return clusters
or summaries, and every graph request must carry its boundary and limit.

## Supersession

Changing limits requires performance evidence and an updated graph/context
contract.
