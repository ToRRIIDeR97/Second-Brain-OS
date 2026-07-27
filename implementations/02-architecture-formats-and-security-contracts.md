# Checkpoint 02: Architecture, Formats, and Security Contracts

## Outcome

The contracts that later implementation depends on are versioned, reviewed, and testable before feature code begins.

## Source plan

- Section 4: ADRs
- Sections 5.3-5.4: module boundaries and events
- Sections 8.2-8.5: manifests, project cards, context boundaries, and access policy
- Sections 13, 19, 25-26, and 32.3
- Phase 0 tasks 9-15

## Prerequisites

- Checkpoint 01

## Scope

- Record the nine architectural decisions from the master plan as durable ADRs.
- Define version 1 schemas for workspace manifests, project cards, Markdown extensions, graph ontology, events, IPC results, approvals, and context packets.
- Define stable error-code ownership and naming rules.
- Write the threat model and data-classification policy.
- Define compatibility and migration expectations for every serialized format.
- Define trust levels and default capability matrices.

## Expected artifacts

- ADR directory with accepted/proposed status.
- Human-readable format specifications with examples.
- Machine-readable schemas or Rust source types suitable for schema generation.
- Error-code registry.
- Threat-model and data-classification documents.
- Approval risk-class table.
- Compatibility/version matrix.

## Work items

1. Convert master-plan ADRs into individual records with consequences and supersession rules.
2. Specify required and optional workspace-manifest fields.
3. Specify canonical Markdown extension syntax and unknown-syntax preservation.
4. Freeze initial authoritative node and edge names.
5. Define event envelope fields, versioning, redaction, and persistence flags.
6. Define typed IPC success/error envelopes and job/event conventions.
7. Define approval inputs, risk classes, decisions, expiry, and audit requirements.
8. Model threats across renderer, filesystem, sidecar, terminals, agents, Google, and provider content.
9. Add schema conformance tests for valid and invalid examples.

## Acceptance evidence

- Every contract has an explicit version field or documented version carrier.
- Every trust level maps to readable roots, writable roots, process permissions, MCP behavior, and HTML behavior.
- The renderer-to-backend boundary accepts workspace IDs and relative paths, not arbitrary absolute paths.
- Retrieved note content is explicitly classified as data rather than instructions.
- Sensitive data and secret-handling rules are concrete enough to test.
- Example payloads pass schema validation; intentionally invalid payloads fail predictably.

## Validation focus

- Backward/forward compatibility assumptions
- Ambiguous approval classifications
- Cross-workspace and symlink threat cases
- Unknown Markdown syntax behavior
- Error and event schema stability

## Out of scope

Implementing the database, approval engine, parser, agent adapters, or provider integration.

## Handoff

List unresolved ADRs as explicit blockers. Later checkpoints may extend a contract only through a versioned change and migration note.
