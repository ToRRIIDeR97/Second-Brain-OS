# Second Brain OS Handover - Checkpoints 11–20

**Date tag:** 2026-07-28
**Scope:** implementation foundation for checkpoints 11–20
**Status:** current

## Executive Summary

The `checkpoints-11-20` branch now contains the next broad implementation
slice: portable extended Markdown and recovery logic, deterministic knowledge
parsing and indexing, structured search, bounded graph and context retrieval,
an accessible focused-graph surface, and terminal backend/frontend domain
boundaries.

This is not a claim that every checkpoint acceptance item is complete. The
implemented seams are runnable and tested, while native PTY integration,
background indexing, complete persistence/IPC wiring, production graph layout,
and editor recovery persistence remain explicit follow-up work.

Six subagents contributed non-overlapping slices. Each read and applied the
Ponytail skill at full intensity before implementation; the root session
integrated and validated the combined result.

## Current State

- Branch: `checkpoints-11-20`.
- Nothing is staged or committed.
- The default database lifecycle applies the foundation and knowledge
  migrations and reports schema version 13.
- The frontend production build succeeds.
- The Rust workspace tests, strict Clippy, Rustfmt, TypeScript, ESLint,
  Prettier, and Vitest checks pass.
- The local pnpm wrapper still runs under Node 24.14.0 and warns that the
  repository requests Node 22.22.3.

## Implemented

### Checkpoints 11–12: Markdown extensions and recovery

- Added balanced nested directive parsing and deterministic serialization for
  the documented visual/knowledge directives.
- Preserved unknown directives byte-for-byte as protected source.
- Added safe, source-visible rich fallbacks and Mermaid active-content checks.
- Added workspace-relative attachment validation, including encoded traversal
  rejection.
- Added a pure autosave/recovery state machine, versioned journal entries,
  stale-save protection, and conservative three-way merge behavior.
- Added directive and recovery tests plus a representative fixture.

### Checkpoints 13–14: parsing, identities, and indexing

- Added a versioned Markdown/code parser registry with deterministic document,
  revision, durable-block, chunk, node, and edge identities.
- Added localized parser diagnostics, authority/confidence metadata, source
  ranges, duplicate-ID handling, and lightweight Rust/JavaScript/TypeScript/
  Python metadata extraction.
- Added migration `0013_knowledge.sql` for documents, revisions, chunks, FTS,
  nodes, edges, sources, generations, jobs, and invalidations.
- Added an atomic SQLite index replacement/delete path with no-op hash
  detection, rename handling, generation updates, and a deduplicating
  retry/cancel job coordinator.

### Checkpoints 15–17: search and graph

- Added structured query parsing with quoting, escaping, Unicode handling,
  validation, deterministic normalized ranking, reason codes, hard limits,
  pagination, and result diversity.
- Added bounded graph traversal with authority, temporal, inferred, workspace,
  project, node, and edge filters; deterministic continuation; provenance; and
  truncation metadata.
- Added a native React/SVG focused graph with deterministic bounded layout,
  expansion race guards, command callbacks, source navigation, textual
  authority/stale state, and a keyboard-operable relationship list.
- Added a thin accessible search-results surface for the future IPC adapter.

### Checkpoints 18–19: terminal

- Added a testable `TerminalManager` with a PTY adapter seam, workspace
  isolation, six-session cap, fixed-argument presets, canonical CWD policy,
  bounded binary ring buffers, lifecycle events, restore metadata, and
  protected termination decisions.
- Added trusted OSC 7 CWD handling with size limits, percent decoding,
  containment checks, and reliability state.
- Added accessible terminal tab/session state, CWD inheritance, view-mode
  preservation, presets, status badges, keyboard management, and safe
  workspace file-link parsing for `path:line[:column]` and `path#Lline`.

### Checkpoint 20: context retrieval

- Added request and read-policy types plus policy-first candidate filtering.
- Added project-card-only secondary-project boundaries, explicit-selection
  priority without policy bypass, deterministic authority/current-state
  ranking, contradiction retention, source diversity, and non-leaking
  exclusion reason codes.

## Validation Actually Run

```sh
CI=true pnpm --filter @second-brain-os/app test
CI=true pnpm --filter @second-brain-os/app build
CI=true pnpm --filter @second-brain-os/app lint
CI=true pnpm --filter @second-brain-os/app format
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all -- --check
git diff --check
```

Observed results:

- Vitest: 13 files and 37 tests passed.
- Rust: 53 application/library tests and 1 MCP sidecar test passed.
- TypeScript and Vite production build passed.
- ESLint and Prettier passed.
- Rustfmt and strict workspace Clippy passed.

## Important Remaining Work

1. Persist recovery journals in application data and connect debounce,
   focus-loss save, startup discovery, restore/discard UI, and atomic-save IPC.
2. Run the index coordinator as a durable background service with queue
   rehydration, leases, progress/events, watcher-overflow reconciliation, and
   full temporary-database rebuild/swap/rollback.
3. Replace line-oriented parsing with richer syntax support only where fixtures
   demonstrate a gap; preserve parser-version determinism.
4. Execute search and graph queries against SQLite/FTS and expose thin typed
   Tauri commands; mount search and graph surfaces in the application shell.
5. Add saved graph lenses/positions and, when needed, React Flow plus
   cancellable ELK worker layout.
6. Implement the native PTY adapter, shell-hook installer/detector, Tauri state
   and event wiring, terminal persistence migration, xterm rendering, resize,
   clipboard, and separate-window lifecycle.
7. Connect context retrieval to indexed search/graph repositories. Token
   packing, serialized packets, snapshots, and the inspector belong to
   Checkpoint 21.

## Key Files

- `app/src/features/editor/markdown/knowledge.ts`
- `app/src/features/editor/markdown/recovery.ts`
- `app/migrations/0013_knowledge.sql`
- `app/src-tauri/src/knowledge/`
- `app/src/features/search/`
- `app/src/features/graph/`
- `app/src-tauri/src/terminal/mod.rs`
- `app/src/features/terminal/`
- `fixtures/markdown/knowledge/directives.md`
