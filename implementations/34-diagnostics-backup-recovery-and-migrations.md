# Checkpoint 34: Diagnostics, Backup, Recovery, and Migrations

## Outcome

Users can understand system health, export safe diagnostics, back up local state, recover from failures, rebuild derived state, and migrate without risking canonical files.

## Source plan

- Sections 27, 31, and 32.3
- Phase 15 reliability portion
- Backlog L003-L007

## Prerequisites

- Checkpoints 14, 22, 25, and 29

## Scope

- Build the diagnostics screen and redacted export.
- Add SQLite online backups before migration/rebuild and on a rolling schedule.
- Add database restore, rebuild-from-files, UI-state restore, provider reconnect guidance, MCP recreation, cache/vector rebuild, and audit export.
- Test transactional and large migrations with progress.
- Refuse unsupported newer schemas.
- Verify sidecar/app protocol compatibility.
- Add crash-recovery status for index, agent, terminal, planner, and outbox work.

## Expected artifacts

- Diagnostics service/UI.
- Backup scheduler, retention, restore, and validation.
- Recovery workflows and runbooks.
- Migration compatibility test matrix.
- Redacted support bundle/export.

## Work items

1. Report database, generation, jobs, watcher, counts, FTS, sync, provider, agent, MCP, terminal, disk, cache, and backup status.
2. Perform and verify online backups.
3. Preserve rollback backup before database swap or migration.
4. Separate canonical-file recovery from rebuildable-state recovery.
5. Resume or accurately fail interrupted outbox/index work.
6. Redact credentials, note bodies, environment variables, and terminal scrollback from exports.
7. Test upgrade paths from every supported schema version.

## Acceptance evidence

- A verified backup can be restored into a healthy app state.
- Full database rebuild recovers search/graph from canonical files.
- Failed migration leaves a usable rollback path.
- Newer unsupported schema is refused without mutation.
- Diagnostics show actionable failures and can export a redacted bundle.
- Credential and content leak tests pass against exports/logs.

## Validation focus

- Disk full and corrupt backup
- Crash during migration or restore
- Old sidecar/new app mismatch
- Provider credentials absent after machine migration
- Retention cleanup safety

## Out of scope

Cloud backup service, Git hosting backup, packaging/signing, and final performance tuning.

## Handoff

Provide recovery runbooks and compatibility evidence to release and beta-gate checkpoints.
