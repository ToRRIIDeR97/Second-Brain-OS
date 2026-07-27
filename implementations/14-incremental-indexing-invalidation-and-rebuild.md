# Checkpoint 14: Incremental Indexing, Invalidation, and Rebuild

## Outcome

Filesystem changes update the authoritative knowledge index atomically and idempotently; rebuilds reproduce incremental state and can recover from corruption or missed events.

## Source plan

- Sections 12.1-12.4 and 12.8-12.11
- Phase 5
- Backlog D008-D012

## Prerequisites

- Checkpoint 13

## Scope

- Implement per-path debounced index jobs with dedupe, retry, priority, and observable status.
- Process one file update in one SQLite transaction.
- Update documents, revisions, chunks, FTS, authoritative graph records, source mappings, jobs, and generation together.
- Detect no-op hashes and renames.
- Eagerly invalidate dependent artifacts and context caches.
- Support file, folder, workspace, derived-only, and full database rebuilds.
- Add diagnostics and cancellation/progress for long work.

## Expected artifacts

- Index coordinator and durable job queue.
- Generation tracking and invalidation graph.
- Reindex/rebuild commands and progress events.
- Incremental-versus-rebuild comparison tooling.
- Rapid-change and failure-recovery tests.

## Work items

1. Feed validated file events into a deduplicated job queue.
2. Calculate BLAKE3 before parsing and discard unchanged work.
3. Commit all authoritative changes and the generation increment atomically.
4. Retry transient failures and preserve actionable terminal errors.
5. Mark derived dependencies stale without blocking authoritative updates.
6. Build a new temporary database for full rebuild, validate it, and swap with rollback backup.
7. Preserve safe UI/provider state during full rebuild.

## Acceptance evidence

- Incremental and full-rebuild authoritative state match for fixtures.
- A small note change appears in indexed state within the performance target after debounce.
- The UI never observes half-updated chunks/graph/FTS state.
- Duplicate file events create no duplicate records or revisions.
- Failed jobs are visible, retryable, and do not stop unrelated work.
- Rebuild supports progress, cancellation before swap, validation, and rollback.

## Validation focus

- Save storms and rename/delete races
- Crash at each transaction stage
- Watcher overflow reconciliation
- Job dedupe after restart
- Database swap failure

## Out of scope

Search UI, graph rendering, LLM-derived artifacts, and semantic vectors.

## Handoff

Publish generation and job-status APIs for search, context, diagnostics, and UI status surfaces.
