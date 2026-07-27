# ADR-008: Separate provider data from local enrichment

- Status: accepted
- Date: 2026-07-27
- Supersedes: none

## Decision

Google Calendar and Google Tasks data are provider-shadow records. Local project
links, provenance, importance, context policy, and private annotations remain
local and are never written into provider-owned payload fields without an
explicit contract.

## Consequences

Sync can preserve provider authority while the local graph adds useful context.
Provider types stop at their adapter boundary and do not leak into general UI
contracts.

## Supersession

Any ownership change requires a sync/conflict migration and a review of
participant-facing side effects.
