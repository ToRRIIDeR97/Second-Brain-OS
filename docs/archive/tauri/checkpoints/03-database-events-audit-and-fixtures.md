# Checkpoint 03: Database, Events, Audit, and Fixture Foundation

## Outcome

The application has a reliable local-state foundation: SQLite lifecycle and migrations, typed internal events, structured logs, audit storage, deterministic test utilities, and representative fixture workspaces.

## Source plan

- Sections 5.4, 9, 10, 27, and 30
- Phase 0 and Phase 1 backend foundation
- Backlog D001 and L001-L002

## Prerequisites

- Checkpoints 01-02

## Scope

- Resolve platform application-data directories.
- Initialize SQLite with WAL, foreign keys, UTC timestamps, and explicit migrations.
- Implement the database service/write-serialization strategy.
- Add shared transaction helpers, health checks, and schema-version inspection.
- Implement the typed internal event bus and UI event forwarding boundary.
- Implement structured redacted logging and the base `audit_events` store.
- Add injectable clock and ID generation.
- Create small, large, malicious, Unicode, CRLF, Git, and provider-recording fixtures.

## Expected artifacts

- Database bootstrap and migration harness.
- Initial platform, settings, audit, and migration metadata tables.
- Shared event and error plumbing.
- Redaction-aware structured logging.
- Fixture catalogue documenting purpose and expected scale.
- Tests for migration order, rollback behavior, event envelopes, and redaction.

## Work items

1. Configure SQLite pragmas and connection ownership.
2. Define transaction and read-query conventions without a generic repository framework.
3. Add migration checksum/version tracking.
4. Implement event subscription, correlation IDs, and persist-to-audit behavior.
5. Define log destinations, rotation, and diagnostic redaction.
6. Create deterministic ULID/time test adapters.
7. Build fixtures for path escape, symlinks, rapid saves, rich Markdown, large trees, and provider recordings.
8. Add database and event-bus test helpers used by later checkpoints.

## Acceptance evidence

- A new app-data directory produces a healthy migrated database.
- Reopening the app does not rerun completed migrations.
- Concurrent write requests are serialized without `database is locked` failures in the stress test.
- Events retain correlation, actor, schema version, and redaction metadata.
- Audit records exclude secrets and full content unless explicitly required.
- Tests can use deterministic time and IDs.
- Fixture setup is documented and repeatable.

## Validation focus

- Migration failure and restart behavior
- WAL/checkpoint behavior
- Event ordering and subscriber failure isolation
- Secret-pattern redaction
- Fixture portability across platforms

## Out of scope

Complete domain schemas, online backups, diagnostics UI, provider synchronization, and production-scale load tuning.

## Handoff

Document database ownership rules, how domains add migrations, and how tests obtain isolated databases and fixture roots.
