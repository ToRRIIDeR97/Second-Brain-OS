# Second Brain OS Handover - Frontend Integration and Native Terminal

**Date tag:** 2026-07-28
**Last updated:** 2026-07-28
**Scope:** Tauri command integration, workspace surfaces, knowledge graph, search, and terminal UX
**Status:** current

## Executive Summary

The checkpoint foundations are now connected to the main Tauri frontend rather
than remaining isolated domain implementations. The application can register
and browse trusted workspaces, read and write notes, refresh the explorer,
search through a modal, render a folder-scoped expandable graph, invoke
workspace-bound Git operations, and run real interactive native PTY sessions.

The terminal no longer renders raw control sequences through a `<pre>` and a
separate command form. It uses xterm.js over the native PTY adapter, accepts
direct keyboard input, reports fitted rows and columns to the backend, supports
tabs, closing and creating sessions, a two-pane split, tab drag-to-split, and a
vertically resizable bottom drawer.

This work is intended for merge into `main`. It does not change the existing
Version 0.1.0 beta `NO-GO`: live Google integrations, managed provider
journeys, signed installers, and other acceptance evidence described in the
checkpoint 31–37 handover remain incomplete.

## Current State

- Base branch before this change: `main` at `2d1cdab` (`Merge pull request #1
  from ToRRIIDeR97/checkpoints-31-37`).
- The desktop application is running through `npm run tauri -- dev`.
- Vite is serving the renderer at `http://localhost:1420/`.
- PR branch: `codex/frontend-integration-terminal-graph`.
- The change set includes the complete frontend integration, native PTY
  adapter, updated dependency locks, tests, and this handover.
- The repository requests Node 22.22.3. Local validation used Node 24.14.0 and
  pnpm 11.9.0, which emits an engine warning but did not fail validation.

## What Changed

### Tauri command and workspace integration

- Added an application runtime managed by Tauri and registered typed commands
  for workspace registration/listing, paginated directory listing, file reads
  and writes, Git status/stage/unstage/discard, knowledge search and graph
  loading, and terminal lifecycle operations.
- Kept renderer requests workspace-scoped with validated relative paths.
- Added frontend IPC contracts and client methods for every wired command.
- Added a data-backed `WorkspaceSurface` that replaces the earlier shell
  placeholders.

### Workspace files, notes, and collections

- Added workspace registration and trust selection.
- Added file browsing and note editing through canonical workspace files.
- Added a 2.5-second refresh loop so new and changed files appear without
  reopening the view.
- Added daily-note creation/opening under `notes/`.
- Added collections backed by registered collection workspaces rather than
  synthetic navigation entries.
- Added file and folder context actions for opening a shell, Codex, or Claude
  terminal at the selected relative path.

### Search

- Removed knowledge search from normal tab navigation.
- Added a centered knowledge-search modal opened with the top-bar Search
  control or `Cmd/Ctrl+K`.
- Added backdrop blur, keyboard Escape handling, query submission, result
  selection, and note opening.
- Moved the command palette shortcut to `Cmd/Ctrl+Shift+P`.

### Knowledge graph

- The initial graph request is scoped to the current workspace folder.
- Selecting a node does not implicitly load descendants.
- The inspector exposes an explicit Expand action that merges the selected
  node's children into the current bounded graph.
- Replaced the rectangular card grid with a deterministic force-directed
  circular-node field.
- Added type-sensitive node color and radius, selected-node glow, subdued
  edges, inferred/stale styling, bounded labels, and a 300-node ceiling.
- Kept node context actions for opening the source, terminal, Codex, or Claude.

### Native terminal and drawer

- Added `portable-pty` and a native adapter that owns real child PTYs, forwards
  output events, supports writes and resize operations, and terminates
  sessions through the existing workspace policy boundary.
- Added xterm.js and its fit addon to interpret VT escape sequences and render
  a normal terminal surface.
- Direct terminal keystrokes are written to the active PTY; there is no
  separate command input or Run button.
- Added terminal tabs with new-session and close controls.
- Added a maximum of two simultaneously visible terminal panes. Other sessions
  remain available as tabs.
- Dragging a terminal tab onto the terminal stage creates a two-pane split; a
  Split control provides a keyboard/pointer fallback.
- Both split panes and the terminal drawer have accessible resize handles.
- Terminal output is retained and replayed when a tab is remounted.
- ResizeObserver fitting is animation-frame scheduled and geometry-deduplicated
  to avoid observer feedback loops.

### Shell and home

- Removed Local Planner, Agents, Search, and Terminal from ordinary document
  tabs and kept the terminal in the bottom drawer.
- Reduced the drawer to the terminal surface.
- Added home cards for Today and Tasks, quick actions for new notes and daily
  notes, and the scoped knowledge graph.
- Calendar and task cards are local placeholders until live Google
  Calendar/Tasks adapters and authentication are wired.

## Verification

The following checks were run against the integrated working tree:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm --filter @second-brain-os/app test
pnpm --filter @second-brain-os/app build
pnpm --filter @second-brain-os/app lint
pnpm --filter @second-brain-os/app format
git diff --check
```

Observed results during PR preparation:

- Rust: 3 MCP tests, 97 application/library tests, and 7 integration tests
  passed (107 total).
- 22 test files passed.
- 59 tests passed.
- Strict Clippy and Rustfmt passed.
- TypeScript and the Vite production build passed.
- ESLint passed with zero warnings.
- Prettier passed.
- `git diff --check` passed.
- The production build reports a non-failing large-chunk warning for the main
  renderer bundle; xterm itself is dynamically split into its own chunk.
- A clean Tauri development restart completed and the live renderer log stayed
  free of new runtime errors after startup.

## Important Outputs

- `app/src-tauri/src/commands.rs`
- `app/src-tauri/src/terminal/native.rs`
- `app/src-tauri/src/terminal/mod.rs`
- `app/src-tauri/src/app.rs`
- `app/src/app/WorkspaceSurface.tsx`
- `app/src/components/layout/AppShell.tsx`
- `app/src/components/layout/Drawer.tsx`
- `app/src/components/layout/Navigator.tsx`
- `app/src/features/search/KnowledgeSearchModal.tsx`
- `app/src/features/graph/FocusedGraph.tsx`
- `app/src/features/graph/model.ts`
- `app/src/features/terminal/TerminalWorkspace.tsx`
- `app/src/lib/ipc/client.ts`
- `app/src/lib/ipc/types.ts`
- `app/src/styles/app.css`
- `app/src/app/WorkspaceSurface.test.tsx`
- `app/src/features/search/KnowledgeSearchModal.test.tsx`
- `app/src/features/graph/graph.test.tsx`
- `app/src/features/terminal/terminal.test.tsx`
- `app/tests/layout.test.tsx`

## Known Issues

1. Google Calendar and Google Tasks are represented on Home, but live OAuth,
   keychain, provider HTTP, and synchronization are not connected to those
   cards.
2. Codex and Claude launches use terminal presets from explicit file, folder,
   or graph-node context actions; authenticated provider availability still
   depends on the local environment.
3. The terminal retains up to roughly 1 MB of raw output history per frontend
   session for tab restoration. Long-running high-output sessions should be
   profiled before raising that ceiling.
4. The force-directed graph uses a bounded quadratic simulation. The existing
   300-node product cap makes this deliberate; profile before adding a
   Barnes-Hut or WebGL dependency.
5. The production build's main renderer chunk remains larger than Vite's
   default 500 kB advisory threshold.
6. The repository still has the broader beta evidence gaps documented in
   `handover files/2026-07-28-second-brain-os-checkpoints-31-37-handover.md`.

## Next Steps

1. Perform manual installed-app checks for terminal text selection, IME input,
   split dragging, drawer resizing, graph interaction, and narrow-window
   behavior.
2. Connect the existing Google Calendar/Tasks domain seams to native
   credentials, live provider adapters, and the Home cards.
3. Add terminal session restoration across application restarts if required;
   the current tabs persist only for the running frontend.
4. Profile the graph near the 300-node cap and terminal output under sustained
   load.
5. Continue satisfying the fixed beta evidence manifest without weakening the
   existing fail-closed gate.

## Practical Caveats

- Do not expose generic filesystem paths or arbitrary shell access to the
  renderer. Continue passing workspace IDs and validated relative paths.
- Keep search and graph indexes rebuildable from canonical workspace files.
- Keep Codex and Claude launch actions behind explicit context menus.
- Do not silently expand graph descendants on selection.
- Do not replace the PTY adapter with ordinary process pipes; interactive
  terminal control sequences and resize behavior require a real PTY.
- Preserve the two-visible-pane terminal ceiling unless profiling and product
  requirements justify a more complex layout manager.

## Files To Start With

1. `app/src/app/WorkspaceSurface.tsx`
2. `app/src/components/layout/AppShell.tsx`
3. `app/src/features/terminal/TerminalWorkspace.tsx`
4. `app/src-tauri/src/commands.rs`
5. `app/src-tauri/src/terminal/native.rs`
6. `app/src/features/graph/FocusedGraph.tsx`
7. `app/src/features/graph/model.ts`
8. `app/src/features/search/KnowledgeSearchModal.tsx`
9. `app/src/lib/ipc/client.ts`
10. `app/src/lib/ipc/types.ts`
