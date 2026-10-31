# Google planner security boundary

> Status: Tauri-era requirements. The active integration in
> `opencode/packages/desktop/src/main/google-calendar.ts` encrypts its client
> secret and refresh token with Electron `safeStorage` in the profile, not the
> OS credential store, and keeps sync state in JSON/Electron stores rather than
> SQLite. The [threat model](threat-model.md) describes the current control.

Google integration is an adapter behind the provider-neutral planner domain.
Read and write consent are separate. The desktop OAuth flow must use the system
browser, PKCE, a loopback redirect, and state bound to the initiating app
window and account attempt.

Refresh tokens belong only in the operating-system credential store under an
opaque credential key. Access and refresh tokens must never enter SQLite,
logs, audit payloads, context packets, crash exports, fixtures, or provider
payload shadows. SQLite may store account identity, consent mode, the opaque
credential key, normalized provider data, cursors, ETags, and redacted
diagnostic fields.

Calendar and Tasks reads use the narrow scopes selected during consent.
Participant-facing, shared-calendar, recurring-series, destructive, and
organizer-sensitive writes require the approval class defined by the action's
actual effect. Every write is persisted to the outbox before a provider call,
uses an idempotency key and base ETag, and preserves local enrichment outside
provider-owned fields.

The Electron adapter in `opencode/packages/desktop/src/main/google-calendar.ts`
is live: it uses the system browser, PKCE and a loopback redirect whose state
check ignores (400) any request without the expected state instead of ending
the sign-in. It keeps any number of accounts. Writes go through an outbox;
timeouts, rate limits and server errors stay queued until the attempt cap,
while a disabled API or a missing scope fails at once. When Google rejects an
account's grant, that account reports `google_reconnect_required`; signing in
again to the same address renews the account and keeps its outbox.
Disconnecting an account revokes its token and removes its items from the
planner. Recorded API compatibility tests are still missing; domain logic is
covered by `google-calendar-domain.test.ts`.

## Sync state lifecycle

Events and tasks carry a `syncState`. The server stores the calendar document
and checks only invariants (`opencode/packages/opencode/src/planner/calendar.ts`):
local items stay `local`, Google items are never `local`, and a `synced` item
has no outbox reference. It does not enforce transitions, because it does not
own sync. The renderer and the desktop outbox do:

| State | Set by | Meaning |
| --- | --- | --- |
| `local` | renderer | A local-only item. It never changes state. |
| `pending` | renderer | A Google item edited locally and queued in the outbox. |
| `synced` | renderer, after a read sync or an outbox success | Matches the provider copy. |
| `offline` | desktop outbox (`outboxFailureState`) | A retryable failure, such as no network or a token error. |
| `failed` | desktop outbox | A permanent failure, such as a missing scope or a disabled API. |
| `conflict` | desktop outbox | The provider copy changed since the base ETag. |
| `stale` | nothing yet | Reserved; the calendar shows it if a document carries it. |

Any writer of the calendar document can set any state the invariants allow.
That is accepted: the document lives in the workspace, so a client that can
write it could edit the file directly anyway.
