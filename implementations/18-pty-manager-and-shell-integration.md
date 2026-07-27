# Checkpoint 18: PTY Manager and Shell Integration

## Outcome

The Rust backend can securely create, supervise, communicate with, resize, and terminate workspace-scoped PTY sessions with reliable current-directory reporting and bounded output.

## Source plan

- Sections 18.1-18.5 and 18.8-18.9
- Phase 7 backend tasks
- Backlog F001-F003, F006-F010, F013-F014

## Prerequisites

- Checkpoints 03, 05, and 06

## Scope

- Implement `TerminalManager` and terminal-session persistence metadata.
- Spawn approved shells and visible preset commands through argument arrays.
- Implement binary-safe read/write, resize, ring buffers, backpressure, status, and exit events.
- Add managed shell integration for Zsh, Bash, Fish, and PowerShell using OSC 7.
- Implement CWD reliability state and inheritance rules.
- Enforce six terminals per application workspace and strict workspace isolation.
- Add busy-process and child-process-aware termination protection.

## Expected artifacts

- PTY abstraction and platform adapters.
- Terminal session/status migrations.
- Shell integration scripts and installer/detector.
- Event stream and bounded buffer protocol.
- Mock PTY tests plus platform integration tests.

## Work items

1. Resolve initial CWD through the path-policy service.
2. Filter environment metadata and avoid persisting secrets.
3. Parse only trusted OSC sequences needed for CWD/title state.
4. Bound buffers and pause/drop according to an explicit backpressure policy.
5. Track process tree, exit code, last output, and restore metadata.
6. Require explicit confirmation before terminating protected process trees.
7. Clean up sessions on workspace close and application shutdown.

## Acceptance evidence

- Spawn, input, output, resize, and exit work on supported shells.
- Six-tab limit is enforced per workspace, not globally.
- CWD reports as reliable only when shell integration confirms it.
- High-output fixtures do not freeze the app or grow memory without bound.
- One workspace cannot attach to another workspace's PTY.
- Presets use visible, fixed argument arrays and never renderer-supplied shell interpolation.

## Validation focus

- PTY process crash and orphan cleanup
- Invalid/hostile escape sequences
- Shell integration disabled or unavailable
- CWD containing spaces or Unicode
- Backpressure under sustained output

## Out of scope

xterm rendering, terminal file links, managed agent protocols, persistent remote terminals, and terminal output indexing.

## Handoff

Document session lifecycle, output protocol, CWD trust semantics, and safe preset registration for the terminal UI and agent adapters.
