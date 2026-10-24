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
the sign-in. Writes go through an outbox; timeouts, rate limits (including a
403 `rateLimitExceeded`) and server errors stay queued until the attempt cap.
When Google rejects the grant, the status reports `needsReconnect` and
`reconnect` signs in again with the stored client, keeping the outbox and
Project links. Disconnect revokes the token and clears the store; the planner
keeps Google items as stale copies so their Project links survive a later
reconnect. Recorded API compatibility tests are still missing; domain logic is
covered by `google-calendar-domain.test.ts`.
