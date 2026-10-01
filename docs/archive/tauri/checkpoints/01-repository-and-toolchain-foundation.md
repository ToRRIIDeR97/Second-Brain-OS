# Checkpoint 01: Repository and Toolchain Foundation

## Outcome

A minimal modular-monolith repository builds locally and in continuous integration. It contains the desktop app, the thin MCP sidecar crate, fixtures, documentation, and scripts, without prematurely extracting product packages.

## Source plan

- Sections 5-7: architecture, stack, and repository structure
- Section 32: release channels and version compatibility
- Phase 0 and Days 1-3

## Prerequisites

None.

## Scope

- Create the root Rust and pnpm workspaces.
- Scaffold Tauri 2, React, TypeScript strict mode, Vite, and the Rust backend.
- Create broad backend module directories: `workspace`, `knowledge`, `agents`, `planner`, `terminal`, and `platform`.
- Create the single `mcp` sidecar crate as a non-functional executable shell.
- Add formatting, linting, unit-test, dependency-audit, and license-audit commands.
- Add macOS, Windows, and Linux build jobs.
- Establish dependency pinning and update policy.
- Add contributor setup and common-command documentation.

## Expected artifacts

- Repository layout matching Section 7.
- One launchable desktop window.
- One buildable MCP binary that advertises no product capabilities yet.
- Root `README.md`, `AGENTS.md`, and initial `docs/` structure.
- CI configuration and development scripts.
- Toolchain/version files and committed lockfiles.

## Work items

1. Choose and pin supported Node, pnpm, Rust, and Tauri versions.
2. Scaffold the frontend and Tauri backend.
3. Define root build, format, lint, test, and audit commands.
4. Add empty domain modules without artificial service boundaries.
5. Add a smoke test for app startup and a smoke test for the sidecar executable.
6. Configure CI matrices, caches, and artifact retention.
7. Document local prerequisites, especially platform build dependencies.

## Acceptance evidence

- A clean checkout can install dependencies using the documented command.
- Format, lint, unit-test, desktop build, and MCP build commands pass.
- CI runs the relevant build on all three target operating systems.
- The desktop window opens on macOS.
- No renderer code has direct filesystem or shell privileges.
- The repository contains one application backend and one sidecar, not multiple product services.

## Validation focus

- Fresh-machine setup instructions
- Strict TypeScript enforcement
- Rust warnings and formatting
- Lockfile reproducibility
- CI path and platform assumptions

## Out of scope

Workspace registration, production database tables, real MCP tools, editor features, signing, notarization, and auto-update.

## Handoff

Record exact toolchain versions, CI limitations, and any platform-specific setup that later checkpoints must preserve.
