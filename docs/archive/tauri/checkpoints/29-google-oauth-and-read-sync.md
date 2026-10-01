# Checkpoint 29: Google OAuth and Read Synchronization

## Outcome

Users can securely connect Google in read-only or write-capable mode and view incrementally synchronized Calendar and Tasks data offline with clear provider provenance.

## Source plan

- Sections 22.2-22.5
- Phase 12
- Milestone 10
- Backlog J001-J008

## Prerequisites

- Checkpoint 28

## Scope

- Implement system-browser OAuth desktop flow with PKCE, loopback redirect, state validation, and narrow scopes.
- Store refresh tokens in the OS credential store and keep access tokens out of SQLite.
- Add connect, scope upgrade, disconnect, and revoke flows.
- Implement Calendar list/full/incremental sync with sync-token persistence and HTTP 410 recovery.
- Implement Tasks list/poll/reconciliation using update timestamps and ETags.
- Cache normalized provider data for offline planner views.
- Create/update provider graph nodes only after provider rows are current.

## Expected artifacts

- Credential-store and OAuth adapters.
- Google provider mapping layer.
- Provider account, sync cursor/run, calendar, event, task-list, and task behavior.
- Read-only sync status UI.
- Recorded API fixtures and dedicated-account test plan.

## Work items

1. Separate read-only and write-enabled consent modes.
2. Validate callback state and bind it to the initiating window/account.
3. Store normalized fields plus diagnostic payload shadows.
4. Paginate all list/sync endpoints.
5. Replace expired Calendar sync tokens through scoped full resync.
6. Poll Tasks on startup, focus, interval, manual refresh, and after future mutations.
7. Make disconnect remove credentials and accurately mark cached data.

## Acceptance evidence

- Users can connect and disconnect an account.
- Refresh tokens never appear in SQLite, logs, context packets, or crash exports.
- Calendar incremental sync applies changes/deletions and replaces the sync token atomically.
- HTTP 410 performs a safe affected-scope resync.
- Task polling includes completed/deleted states as configured.
- Offline cached views identify their provider and last sync time.

## Validation focus

- OAuth cancellation, state mismatch, port conflict, and expired credentials
- Pagination and rate limits
- Multiple calendars/task lists
- Timezones, all-day, and recurring instances
- Disconnect while syncing

## Out of scope

Provider writes, outbox, conflict editing, public webhooks, and planner MCP.

## Handoff

Document scopes, credential keys, provider ownership rules, and sync state transitions for write operations and diagnostics.
