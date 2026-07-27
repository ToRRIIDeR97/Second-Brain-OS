# Implementation Checkpoints

This folder turns the master [Agent Operating System implementation plan](../agent-operating-system-implementation-plan.md) into small, implementation-ready units. These documents define work; they do not implement the product.

## How to use this folder

1. Read this index and the checkpoint being assigned.
2. Confirm every prerequisite checkpoint is complete.
3. Recheck the cited master-plan sections before changing a contract or invariant.
4. Keep the implementation inside the checkpoint's scope.
5. Produce the acceptance evidence named in the checkpoint.
6. Record deferred work in the handoff notes rather than silently expanding scope.

A checkpoint is complete only when its behavior, tests, documentation, and acceptance evidence are present. Passing compilation alone is not completion.

## Invariants that apply to every checkpoint

- Canonical knowledge remains in ordinary files; derived database state must be rebuildable.
- The renderer never receives unrestricted filesystem, process, database, provider, or credential access.
- All filesystem operations use a registered workspace ID and a validated relative path.
- Tauri commands stay thin and delegate to domain modules.
- Cross-domain authoritative updates use explicit transactions.
- Provider-specific payloads are converted to internal domain types at adapter boundaries.
- Agent context is bounded, inspectable, and policy-filtered.
- Sensitive, destructive, cross-workspace, and participant-facing actions use the approval model.
- Logs and audit events exclude secrets, hidden reasoning, and full terminal scrollback.
- Existing vertical workflows must remain functional when a checkpoint is merged.

## Dependency waves

Checkpoints within a wave may be parallelized only when their listed prerequisites are satisfied and they do not edit the same contracts, migrations, generated files, or central configuration.

| Wave | Checkpoints | Purpose |
|---|---|---|
| 0 | 01-03 | Repository, contracts, database, events, and test foundation |
| 1 | 04-07 | Desktop shell, workspace model, and safe filesystem kernel |
| 2A | 08-12 | Source viewing and portable Markdown editing |
| 2B | 13-17 | Deterministic index, search, and focused graph |
| 2C | 18-19 | PTY backend and terminal experience |
| 3 | 20-27 | Context, MCP, agents, and Git review |
| 4 | 28-33 | Planner, Google integration, and optional derived retrieval |
| 5 | 34-37 | Recovery, hardening, packaging, and Version 1 acceptance |

## Checkpoint index

| ID | Checkpoint | Prerequisites | Relative size |
|---|---|---|---|
| 01 | [Repository and toolchain foundation](01-repository-and-toolchain-foundation.md) | None | M |
| 02 | [Architecture, formats, and security contracts](02-architecture-formats-and-security-contracts.md) | 01 | M |
| 03 | [Database, events, audit, and fixture foundation](03-database-events-audit-and-fixtures.md) | 01-02 | L |
| 04 | [Desktop shell and typed IPC](04-desktop-shell-and-typed-ipc.md) | 01-03 | L |
| 05 | [Workspace registry, trust, and persistence](05-workspace-registry-trust-and-persistence.md) | 03-04 | L |
| 06 | [Secure file discovery and reading](06-secure-file-discovery-and-reading.md) | 05 | L |
| 07 | [File mutations, watching, and conflicts](07-file-mutations-watching-and-conflicts.md) | 06 | L |
| 08 | [Source editor and safe save workflow](08-source-editor-and-safe-save-workflow.md) | 07 | L |
| 09 | [Diffs, previewers, and large-file routing](09-diffs-previewers-and-large-file-routing.md) | 06, 08 | M |
| 10 | [Core Markdown codec and rich editor](10-core-markdown-codec-and-rich-editor.md) | 07-08 | XL |
| 11 | [Extended Markdown knowledge syntax](11-extended-markdown-knowledge-syntax.md) | 10 | XL |
| 12 | [Markdown autosave, recovery, and merge](12-markdown-autosave-recovery-and-merge.md) | 07, 10-11 | L |
| 13 | [Knowledge schema, parsing, and stable identities](13-knowledge-schema-parsing-and-identities.md) | 03, 07 | XL |
| 14 | [Incremental indexing, invalidation, and rebuild](14-incremental-indexing-invalidation-and-rebuild.md) | 13 | XL |
| 15 | [Full-text and structured search](15-full-text-and-structured-search.md) | 14 | L |
| 16 | [Graph ontology and query API](16-graph-ontology-and-query-api.md) | 13-15 | L |
| 17 | [Focused graph workspace](17-focused-graph-workspace.md) | 04, 16 | L |
| 18 | [PTY manager and shell integration](18-pty-manager-and-shell-integration.md) | 03, 05-06 | XL |
| 19 | [Terminal UI and workspace actions](19-terminal-ui-and-workspace-actions.md) | 04, 18 | L |
| 20 | [Context retrieval and deterministic ranking](20-context-retrieval-and-ranking.md) | 05, 15-16 | L |
| 21 | [Context packing, snapshots, and inspector](21-context-packing-snapshots-and-inspector.md) | 20 | L |
| 22 | [MCP sidecar transport and read capabilities](22-mcp-sidecar-and-read-capabilities.md) | 02-03, 15, 21 | XL |
| 23 | [MCP writes, capabilities, and approvals](23-mcp-writes-capabilities-and-approvals.md) | 07, 14, 22 | L |
| 24 | [Agent provider and session foundation](24-agent-provider-and-session-foundation.md) | 03-04, 21, 23 | L |
| 25 | [Managed Codex integration](25-managed-codex-integration.md) | 19, 24 | XL |
| 26 | [Claude and visible CLI agent modes](26-claude-and-visible-cli-agent-modes.md) | 19, 22, 24 | L |
| 27 | [Git operations and agent change review](27-git-operations-and-agent-change-review.md) | 07-09, 24 | L |
| 28 | [Local planner domain and UI](28-local-planner-domain-and-ui.md) | 03-04, 13 | L |
| 29 | [Google OAuth and read synchronization](29-google-oauth-and-read-sync.md) | 28 | XL |
| 30 | [Google writes, outbox, and conflicts](30-google-writes-outbox-and-conflicts.md) | 29 | XL |
| 31 | [Planner MCP and agent workflows](31-planner-mcp-and-agent-workflows.md) | 23-25, 30 | L |
| 32 | [Derived summaries, claims, and review](32-derived-summaries-claims-and-review.md) | 14, 16 | L |
| 33 | [Semantic retrieval and hybrid ranking](33-semantic-retrieval-and-hybrid-ranking.md) | 15, 20, 32 | L |
| 34 | [Diagnostics, backup, recovery, and migrations](34-diagnostics-backup-recovery-and-migrations.md) | 14, 22, 25, 29 | XL |
| 35 | [Performance, accessibility, and security hardening](35-performance-accessibility-and-security-hardening.md) | 17, 19, 25-30, 34 | XL |
| 36 | [Packaging, compatibility, and release operations](36-packaging-compatibility-and-release-operations.md) | 34-35 | XL |
| 37 | [Version 1 acceptance and beta gate](37-version-1-acceptance-and-beta-gate.md) | 01-36 | XL |

## Traceability to the master roadmap

| Master-plan phase | Checkpoints |
|---|---|
| Phase 0: Product and architecture foundation | 01-03 |
| Phase 1: Desktop kernel and workspace shell | 03-05 |
| Phase 2: Workspace and file system | 06-07 |
| Phase 3: Source editor and previewers | 08-09 |
| Phase 4: Rich Markdown editor | 10-12 |
| Phase 5: Deterministic index and search | 13-15 |
| Phase 6: Graph workspace | 16-17 |
| Phase 7: Terminal subsystem | 18-19 |
| Phase 8: Context compiler and unified MCP foundation | 20-23 |
| Phase 9: Codex integration | 24-25 |
| Phase 10: Claude Code integration | 24 and 26 |
| Phase 11: Git change review | 27 |
| Phase 12: Google OAuth and read-only planner | 28-29 |
| Phase 13: Google writes and planner tools | 30-31 |
| Phase 14: Derived summaries and semantic retrieval | 32-33 |
| Phase 15: Hardening and beta | 34-37 |

The master plan's twelve milestones are preserved as acceptance landmarks: Milestones 1-11 are completed across Checkpoints 05, 08, 10-12, 15, 17, 19, 21, 25, 22-23, 29, and 30-31; Milestone 12 is Checkpoints 34-37.

## Suggested progress states

Use one of these states in project tracking:

- `not-ready`: one or more prerequisites are incomplete.
- `ready`: scope and prerequisites are confirmed.
- `in-progress`: one implementor owns the checkpoint.
- `in-review`: implementation is complete and acceptance evidence is being checked.
- `blocked`: an identified dependency or decision prevents progress.
- `done`: all acceptance evidence has been reviewed.

## Change-control rule

If implementation evidence shows that a checkpoint boundary or contract is wrong, update the affected checkpoint documents and this index in the same change. Do not let the implementation and its plan silently diverge.
