# Second Brain OS Handover - Checkpoints 31–37

**Date tag:** 2026-07-28

**Scope:** implementation foundation and release evidence for checkpoints 31–37
**Status:** current; beta gate is **NO-GO**

## Executive Summary

The `checkpoints-31-37` branch was created from `checkpoints-21-30`. This slice
adds planner MCP v2 workflows, provenance-rich derived artifacts, optional
semantic retrieval, diagnostics and verified recovery backups, focused
hardening evidence, unsigned release operations, and a fail-closed Version
0.1.0 beta gate.

This is a tested foundation, not a production release. The beta gate correctly
returns `NO-GO` because installed-app journeys, signed three-platform
installers, live Google/Codex evidence, full migration/rebuild proof, manual
screen-reader testing, and scale/soak evidence do not exist.

Three explicitly authorized subagents implemented non-overlapping dependency
waves. Every subagent read and applied Ponytail at full intensity. The root
session owned branch creation, schema 37, shared module wiring, compatibility
contracts, integrated validation, audits, and final review.

## Current State

- Branch: `checkpoints-31-37`, based on `checkpoints-21-30`.
- Both refs currently point to commit `731c509`; checkpoint 31–37 work is
  uncommitted in the working tree.
- Nothing is staged or committed.
- Database lifecycle reaches schema version 37 through
  `0037_derived_semantic_release.sql`.
- MCP app and sidecar protocol versions are both 2.
- Tauri bundling is enabled with the repository's existing platform icons.
- The local pnpm wrapper still runs under Node 24.14.0 and warns that the
  repository requests Node 22.22.3.

## Implemented

### Checkpoint 31 - planner MCP and agent workflows

- Added explicit planner resources and bounded task/event/free-time/sync/link
  schemas to MCP v2.
- Added app-owned create-task, create-event/private-focus-block, and
  complete-task workflows using local planner state and idempotent outbox
  operations.
- Kept date-only task intent separate from exact-time event intent.
- Added session, packet, project, source-note, outbox, and audit link records.
- Participant-facing and other sensitive event changes fail closed with an
  approval preview.

### Checkpoint 32 - derived artifacts and review

- Added bounded data-only source packets and generator/model/prompt provenance.
- Added summary, claim, contradiction, duplicate, concept, and relationship
  suggestion lifecycle state.
- Added direct/downstream invalidation with dependency-cycle termination,
  generator-version invalidation, partial failure handling, and processing
  disablement.
- Added stale-safe accept/reject/dismiss/regenerate behavior and an explicit
  relationship promotion command that does not mutate authoritative graph
  state implicitly.
- Added an accessible derived review queue component.

### Checkpoint 33 - semantic retrieval

- Added provider-neutral embedding and vector-index traits.
- Added a deterministic local token-hash baseline and validated in-memory
  vector cache.
- Added privacy filtering before remote calls, source/provider invalidation,
  dimension/corruption fallback, stable lexical-semantic fusion, diversity,
  deduplication, and inspector explanations.
- Added a versioned two-case retrieval fixture; observed hybrid recall@1 is
  1.0 for that intentionally small fixture.
- Core deterministic search remains functional when semantics are disabled or
  unavailable.

### Checkpoint 34 - diagnostics, backup, and recovery

- Added aggregate diagnostics and interrupted index/agent/outbox recovery
  status.
- Added verified SQLite online backups using native `VACUUM INTO`.
- Added corrupt/newer-backup refusal, rollback-preserving closed-database
  restore, owned-file-only retention, and whitelist-only support exports.
- Added a pre-migration newer-schema guard that refuses without creating the
  migration table or changing schema metadata.
- Added a recovery and support runbook.

### Checkpoint 35 - hardening evidence

- Added adversarial path, MCP capability, approval, and redaction regression
  coverage.
- Added repeatable 10,000-operation policy smoke measurements.
- Added keyboard/focus/landmark, graph-list-alternative, and native-planner
  accessibility checks.
- Added threat dispositions and explicit untested manual/scale gaps.

### Checkpoint 36 - release operations

- Added developer/alpha/beta/stable channel identifiers and fail-closed risky
  feature defaults.
- Added a release smoke script that verifies application versions, MCP
  protocol agreement, bundle enablement, and icon presence.
- Added an unsigned manual macOS/Windows/Linux workflow with pinned toolchains,
  locked dependencies, channel overrides, and SHA-256 manifests.
- Added install, upgrade, rollback, recovery, privacy, and troubleshooting
  guidance.
- Auto-update remains disabled. Signing secrets are not configured or exposed.

### Checkpoint 37 - acceptance and beta gate

- Added a machine-readable fixed-ID evidence manifest.
- Added a gate that cannot become `GO` by deleting missing evidence.
- Added the acceptance matrix, risk register, beta checklist, and unsigned
  `NO-GO` decision record.
- Missing critical journeys and untested automatic no-go conditions correctly
  cause a non-zero gate exit.

## Validation Actually Run

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
CI=true pnpm --filter @second-brain-os/app test
CI=true pnpm --filter @second-brain-os/app build
CI=true pnpm --filter @second-brain-os/app lint
CI=true pnpm --filter @second-brain-os/app format
node scripts/release-smoke.mjs
CI=true pnpm --filter @second-brain-os/app tauri build --no-bundle
pnpm audit --audit-level high
cargo audit
git diff --check
node scripts/beta-gate.mjs
```

Observed results:

- Rust: 95 application/library unit tests, 3 MCP tests, and 7 integration
  tests passed (105 total).
- Frontend: 19 test files and 51 tests passed.
- Strict Clippy, Rustfmt, TypeScript/Vite build, ESLint, Prettier, release
  smoke, whitespace checks, and current-host optimized Tauri build passed.
- `pnpm audit --audit-level high` exited successfully with 2 low and 1
  moderate finding.
- `cargo audit` exited successfully with no vulnerability failure and 17
  allowed transitive maintenance/soundness warnings.
- `cargo deny check licenses` was not run because `cargo-deny` is not installed
  locally; CI installs and runs the pinned version.
- `node scripts/beta-gate.mjs` exited 1 as designed and recorded `NO-GO`.

## Important Outputs

- `app/src-tauri/src/planner/agent_workflow.rs`
- `mcp/src/protocol.rs`
- `app/src-tauri/src/knowledge/derived.rs`
- `app/src-tauri/src/knowledge/semantic.rs`
- `app/src-tauri/src/diagnostics/mod.rs`
- `app/src-tauri/src/platform/release.rs`
- `app/migrations/0037_derived_semantic_release.sql`
- `app/src-tauri/tests/`
- `app/src/features/knowledge/derived/`
- `fixtures/semantic/retrieval-v1.json`
- `scripts/release-smoke.mjs`
- `scripts/beta-gate.mjs`
- `.github/workflows/release.yml`
- `docs/recovery.md`
- `docs/hardening-checkpoint-35.md`
- `docs/release-operations.md`
- `docs/beta-acceptance-v0.1.0.md`
- `docs/beta-evidence-v0.1.0.json`

## Known Limitations and Required Next Work

1. Live app-sidecar transport, complete planner tool handlers, approval resume,
   provider dispatch, and durable planner-link repositories remain unwired.
2. Derived and semantic runtime services are in-memory foundations; durable
   repositories, background orchestration, IPC, and live UI routing remain.
3. Automatic pre-migration/daily backup scheduling, canonical-file full
   rebuild, historical migration matrices, and diagnostics UI wiring remain.
4. The channel registry is not selected by application startup.
5. The MCP sidecar is not packaged as a target-specific, signature-bound Tauri
   external binary.
6. No signed/notarized installer, deployed update feed, clean-machine install,
   uninstall, upgrade interruption, or rollback test exists.
7. Live Google and managed Codex journeys are not validated.
8. Manual screen-reader/high-contrast/zoom checks and specified large-scale,
   terminal-output, planner, index, and long-session fixtures remain.
9. Beta release stays blocked until every fixed evidence item passes and an
   authorized approver signs the archived record.

## Practical Caveats

- Do not edit applied migrations; add a higher checksummed migration.
- Do not turn the current `NO-GO` into `GO` by weakening required evidence.
- Do not enable auto-update before signed feeds and interruption-tested
  rollback exist.
- Keep canonical workspace files outside database restore/migration targets.
- Keep the sidecar thin and deny direct database, credential, provider,
  arbitrary filesystem, and generic shell access.
- Preserve the current uncommitted working tree when staging or committing.
