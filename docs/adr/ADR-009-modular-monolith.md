# ADR-009: Start as a modular monolith

- Status: accepted
- Date: 2026-07-27
- Supersedes: none

## Decision

Build one desktop executable with broad Rust modules: `workspace`, `knowledge`,
`agents`, `planner`, `terminal`, and `platform`. Keep one frontend with feature
folders and one MCP sidecar.

## Consequences

Cross-domain transactions, policy checks, debugging, and ownership stay local
while the product is changing. A package or crate is extracted only after at
least two independent-lifecycle, reuse, security-boundary, dependency,
scale/compile, ownership-conflict, or standalone-test criteria are evidenced.

## Supersession

Extraction is a versioned architecture change; it must not duplicate authority,
policy, or event semantics.
