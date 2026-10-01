# Local backup and recovery

Canonical workspace files remain the source of truth. The SQLite database,
search index, graph, caches, and provider mirrors are local state and may be
rebuilt. Credentials stay in the operating-system credential store and are
never included in backups or support bundles.

## Back up

Create a verified online backup before migrations, rebuilds, and database
replacement. Backups live in the application backup directory, use the
`second-brain-<timestamp>.sqlite` name, and pass SQLite `quick_check` before
they are offered for restore. Retention deletes only regular files matching
that name and always keeps at least one.

## Restore

1. Close the application cleanly so SQLite checkpoints its WAL.
2. Validate the selected backup and refuse it if its schema is newer than the
   application supports.
3. Restore it with `restore_closed_database`. The previous database is kept
   beside it as `database.rollback-<timestamp>.sqlite`.
4. Start the application and confirm database health, provider connections,
   pending outbox operations, and interrupted index or agent work.
5. Keep the rollback file until the restored app has been verified.

Restore refuses an active WAL, corrupt/non-database input, and unsupported
newer schemas before moving the live database.

## Rebuild derived state

If SQLite cannot be restored, move the damaged database aside, open a fresh
database, and run the existing workspace index rebuild for every registered
workspace. This recovers search and graph data from canonical files. Reconnect
provider accounts to recreate credentials and sync mirrors; recreate MCP
clients from the current app connection details. Do not reconstruct canonical
notes from database rows or caches.

## Interrupted work

- Index jobs left pending or running: resume them, or run a workspace rebuild.
- Agent sessions left active or recoverable: reconnect the provider, then
  resume or close them explicitly.
- Planner outbox operations left pending/running/retry-wait: reconnect the
  provider and retry with their existing idempotency keys.
- Terminal processes: start a new terminal. Scrollback is intentionally not
  persisted or exported.

## Support bundle

The JSON support bundle is whitelist-only: aggregate counts, health state,
recovery actions, backup verification metadata, and audit envelope metadata.
It never queries audit payloads and never includes note bodies, environment
variables, credentials, local paths, provider payloads, or terminal scrollback.

## Compatibility evidence

The focused diagnostics tests verify a current-schema online backup, integrity
validation, restore with rollback preservation, corrupt-backup refusal, and
newer-schema refusal without changing the live database. Historical
every-version migration fixtures and crash injection remain release-gate work.
