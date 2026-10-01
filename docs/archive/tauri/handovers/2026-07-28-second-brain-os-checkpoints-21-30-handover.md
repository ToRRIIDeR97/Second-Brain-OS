# Second Brain OS Handover - Checkpoints 21–30

**Date tag:** 2026-07-28
**Last updated:** 2026-07-28
**Scope:** implementation foundation for checkpoints 21–30
**Status:** current

## Executive Summary

The `checkpoints-21-30` branch continues the uncommitted checkpoint 11–20
working tree from `checkpoints-11-20`. It adds deterministic context packets,
an authenticated MCP capability boundary and stdio protocol, approvals,
provider-neutral agent sessions, recorded Codex/Claude adapters, safe system
Git operations, a local planner, and Google OAuth/sync/outbox/conflict domain
seams.

This is a runnable, tested foundation slice, not a claim that every live
integration acceptance item is complete. Real app-side MCP IPC, provider
process supervision, native credential/browser adapters, live Google HTTP,
durable repository services, and complete typed IPC wiring remain follow-up
work.

Six explicitly authorized subagents implemented non-overlapping slices. Every
subagent read and applied Ponytail at full intensity. The root session owned
shared migrations, module integration, MCP contracts, app routing, validation,
and final review.

## Current State

- Branch: `checkpoints-21-30`, created from `checkpoints-11-20`.
- Git refs for `checkpoints-11-20` and `checkpoints-21-30` both still point to
  commit `9309cbd`; checkpoint 11–30 work is uncommitted in the shared working
  tree.
- Nothing is staged or committed.
- Database lifecycle now reaches schema version 30 through
  `0030_context_agents_planner.sql`.
- Planner, Agents, and Source Control activities mount their new local
  feature surfaces.
- The pnpm wrapper still runs under Node 24.14.0 and warns that the repository
  requests Node 22.22.3.

## What Changed

### Checkpoint 21 - context packets and inspector

- Added conservative provider-aware token estimation without a tokenizer
  dependency.
- Added fixed deterministic budget buckets, required-item failures, canonical
  serialization, source hashes/scores/reasons/authority/token metadata, index
  generation and stale checks.
- Kept trusted instructions separate from retrieved `is_data` sections.
- Added immutable used-packet behavior, proposal fingerprinting, an inspector
  component, and a golden fixture.

### Checkpoints 22–23 - MCP and approvals

- Replaced the empty MCP shell with bounded stdio JSON-RPC negotiation,
  read/write tool schemas, pagination limits, stable error mapping, and
  identity-bearing calls.
- Added app-owned signed capability grants bound to agent, session, workspace,
  tools, roots, expiry, protocol, and policy revision, with narrowing and
  revocation.
- Added fail-closed approval classification, decisions, expiry, replay
  prevention, policy downgrade invalidation, cross-workspace/destructive
  controls, and explicit generic-shell denial.
- Added the MCP v1 contract and schema tables for packets, items, and approvals.

### Checkpoints 24–26 - agents, Codex, and Claude

- Added provider-neutral profiles, session states, normalized events, explicit
  readable/writable roots, duplicate/late-event handling, cancellation,
  recovery, approval, file-change, validation, and usage models.
- Added a mock provider/session harness.
- Added a recorded Codex adapter with protocol checks, launch/config previews,
  reasoning redaction, and normalized events.
- Added Claude capability detection with a documented structured adapter and
  honest visible-terminal fallback.
- Added an accessible Agent workspace and redacted provider recordings.

### Checkpoint 27 - Git review

- Added a workspace-bound system Git adapter using fixed argument arrays,
  `--` path boundaries, timeouts, bounded output, and no shell.
- Added repository/worktree/nested-repository detection, porcelain v2 parsing,
  status, diffs, history, stage, unstage, commit, confirmation-gated discard,
  and restore-from-commit.
- Added a conservative Source Control surface that does not invent agent
  attribution.

### Checkpoint 28 - local planner

- Added provider-neutral task, milestone, focus-block, calendar, date-only,
  exact-time, all-day, timezone, source-link, project, sync, and conflict
  placeholder models.
- Added local create/update/complete/archive, explicit Markdown task-ID
  reconciliation, and deterministic Today/Agenda/Upcoming/Unscheduled/
  Completed grouping.
- Added an accessible local planner using native date/datetime controls and
  keyboard-operable alternatives.

### Checkpoints 29–30 - Google sync and durable writes

- Added injected credential/provider seams and a PKCE/state-bound OAuth
  lifecycle model that excludes refresh tokens from persistence records.
- Added normalized paginated Calendar/Tasks sync, atomic final cursor
  replacement, and affected-scope HTTP 410 resync behavior.
- Added an idempotent outbox with offline, retry/backoff, terminal, success,
  and conflict states.
- Added ETag/base field-level conflicts, local-enrichment preservation,
  due-time routing, and approval-risk mapping.
- Added security and compatibility documentation. No live credentials,
  browser, keychain, or Google requests are enabled.

## Verification

```sh
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all -- --check
CI=true pnpm --filter @second-brain-os/app test
CI=true pnpm --filter @second-brain-os/app build
CI=true pnpm --filter @second-brain-os/app lint
CI=true pnpm --filter @second-brain-os/app format
git diff --check
```

Observed results:

- Rust: 90 application/library tests and 2 MCP sidecar tests passed.
- Frontend: 17 test files and 47 tests passed.
- Strict Clippy, Rustfmt, TypeScript/Vite build, ESLint, Prettier, and
  whitespace checks passed.

## Important Outputs

- `app/src-tauri/src/knowledge/context_packet.rs`
- `app/src-tauri/src/mcp.rs`
- `mcp/src/protocol.rs`
- `app/src-tauri/src/agents/`
- `app/src-tauri/src/workspace/git.rs`
- `app/src-tauri/src/planner/`
- `app/src/features/context/`
- `app/src/features/agents/`
- `app/src/features/source-control/`
- `app/src/features/planner/`
- `app/migrations/0030_context_agents_planner.sql`
- `docs/contracts/mcp-v1.md`
- `docs/compatibility/agent-providers.md`
- `docs/security/google-planner.md`
- `fixtures/context/`
- `fixtures/foundation/provider-recordings/`

## Known Issues

1. The MCP sidecar protocol and app capability verifier are implemented, but
   the private app-side transport lifecycle is not; tool calls fail honestly
   while the app gateway is unavailable.
2. Context, approval, session, planner, provider, outbox, and conflict tables
   exist, but repositories and typed Tauri command wiring are not complete.
3. Codex and Claude adapters are exercised through redacted recordings and
   mock supervision, not live authenticated provider processes.
4. Google behavior is implemented through injected seams and fake-provider
   tests; no live OAuth browser, OS keychain, or Google HTTP adapter is enabled.
5. Git hunk review, agent attribution, and provider conflict-resolution UI are
   foundations rather than complete end-to-end workflows.
6. The current working tree contains uncommitted checkpoint 11–30 work, so
   ordinary `git diff` does not include every untracked implementation file.

## Next Steps

1. Persist and query context packets, approvals, sessions, planner items,
   provider cursors, outbox rows, and conflicts through repositories over the
   new schema.
2. Start a private authenticated app-side MCP transport and connect sidecar
   read/write calls to policy-filtered search, context, workspace mutations,
   indexing, and audit. The sidecar currently fails honestly when the running
   app gateway is unavailable.
3. Add thin typed Tauri commands and frontend IPC methods for context, MCP
   approvals, agents, Git, and planner domains.
4. Implement real documented Codex App Server discovery/auth/process
   supervision and link visible terminal sessions. Keep managed Claude disabled
   unless a stable documented structured protocol is confirmed.
5. Add platform browser, OS credential-store, and Google HTTP adapters; then
   validate with a dedicated test account and recorded API fixtures.
6. Mount live data in the current feature surfaces; add complete context
   inspector integration, Git diff/hunk review, planner project/calendar views,
   provider sync status, and conflict resolution.
7. Connect mutations to the normal parser/indexer event path and conservative
   agent change attribution.
8. Run manual Tauri desktop smoke tests after the live IPC adapters exist.

## Practical Caveats

- Do not edit applied migrations; add a higher checksummed migration.
- Do not treat the schema version as proof that live provider integrations are
  complete.
- Never put refresh/access tokens in SQLite, logs, packets, fixtures, or crash
  exports.
- Keep the sidecar thin: no direct database, provider, policy, or arbitrary
  filesystem access.
- Provider recordings contain only redacted structured fields; raw terminal
  output and hidden reasoning are not authoritative knowledge.
- Preserve the uncommitted checkpoint 11–20 work when staging or committing.

## Files To Start With

1. `implementations/21-context-packing-snapshots-and-inspector.md`
2. `implementations/22-mcp-sidecar-and-read-capabilities.md`
3. `implementations/23-mcp-writes-capabilities-and-approvals.md`
4. `app/src-tauri/src/knowledge/context_packet.rs`
5. `app/src-tauri/src/mcp.rs`
6. `mcp/src/protocol.rs`
7. `app/src-tauri/src/agents/mod.rs`
8. `app/src-tauri/src/planner/mod.rs`
9. `app/src-tauri/src/workspace/git.rs`
10. `app/migrations/0030_context_agents_planner.sql`
11. `app/src/components/layout/AppShell.tsx`
12. `docs/contracts/mcp-v1.md`
