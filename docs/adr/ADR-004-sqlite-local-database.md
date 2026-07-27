# ADR-004: Use one local SQLite database

- Status: accepted
- Date: 2026-07-27
- Supersedes: none

## Decision

Use one application SQLite database in the platform application-data directory.
It stores identities, policy, UI state, events, and rebuildable derived state;
canonical workspace files stay outside the database.

## Consequences

Local deployment, transactions, FTS5, migrations, and deterministic rebuilds
are straightforward. Database state must remain disposable and every schema
change must carry a migration and compatibility note.

## Supersession

Splitting or replacing the database requires preserving canonical-file
authority, migration rollback, and cross-domain transaction guarantees.
