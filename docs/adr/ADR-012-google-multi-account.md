# ADR-012: Keep Google accounts as a list in one store

- Status: proposed
- Date: 2026-10-25
- Supersedes: none

## Context

The desktop Google integration held one connection. The main process stored it
as flat keys in the `second-brain.google` electron-store, cached one access
token keyed only by OAuth client ID, and kept one calendar outbox and one task
outbox. Connecting again overwrote the previous account. The Calendar page
replaced every Google item on each sync, and local item IDs had no account in
them. Users want to connect as many Google accounts as they like.

## Options

### G1: Account list in the existing store (chosen)

`second-brain.google` keeps `accounts: StoredAccount[]` (ID, address, label,
client, access, last sync, encrypted secret and refresh token). The outbox
lists stay shared, and each entry carries `accountId`. One service and one
`busy` flag serve every account. The token cache is a map keyed by account ID.
The flat single-account keys migrate into the first account on first read.

- One file and one migration. Disconnecting all accounts still clears one store.
- The IPC surface grows by one optional argument (`disconnect({ accountId })`)
  and one field per item (`accountId`). Existing aggregate status fields keep
  working for Home and Activity.
- Every account shares the one `busy` flag, so two accounts can't sync in
  parallel. Sync runs them one at a time, which also stays clear of Google's
  per-user rate limits.

### G2: One store file per account

Each account gets `second-brain.google.<id>` with the current flat layout, plus
an index store that lists the accounts.

- The existing per-store code stays almost unchanged. Removing an account
  deletes its file.
- Two sources of truth (index and files) can drift after a crash between
  writes. Store names come from data, so the main-owned store-name rules and
  their test need a new pattern. Status has to open N files.

### G3: One service instance per account

A registry builds a `createGoogleCalendarService(accountId)` per account,
each with its own token cache, outbox and `busy` flag. IPC dispatches by
account.

- Strong isolation, and accounts can sync in parallel.
- The IPC and preload surface gets an account argument on every call. The
  registry duplicates lifecycle code (create on connect, dispose on
  disconnect). It doesn't decide where accounts are stored, so it still needs
  G1 or G2 underneath.

## Decision

Use G1. It changes the least surface for the same behaviour, keeps one
migration and one file, and the shared-flag cost (no parallel sync) doesn't
matter at the expected handful of accounts.

Details:

- An account's ID is a random UUID. Its address comes from the primary
  calendar's ID. Signing in with an address that is already connected renews
  that account.
- The OAuth URL adds `prompt=select_account consent`, so Google shows its
  account chooser instead of reusing the browser's current account.
- Sync never lets one failing account hide another's results. The error is
  kept per account in memory, and sync fails only when every account fails.
- Local item IDs include the account ID. The workspace calendar file stores
  `accountId` on Google items. Items saved before this change are treated as
  the first (migrated) account's items until the next sync replaces them.

## Consequences

Each account keeps its own consent level, so one account can be read-only and
another read-write. "Save to" lists only the write-capable accounts. A
renderer that sends an unknown account ID gets `google_account_not_found`.
Moving to G3 later stays possible: the stored shape already carries everything
a per-account service would need.
