# Second Brain OS Handover - Integrated Home Graph and Workbench UX

**Date tag:** 2026-08-04
**Last updated:** 2026-08-04
**Scope:** Tauri/React workbench shell, Home graph, terminal utility, and shared UI
**Status:** current

## Executive Summary

The current delivery consolidates the knowledge graph into Home, upgrades the graph to an interactive 3D viewport, and simplifies the surrounding workbench. Home now contains a compact action strip above an immersive graph canvas; the separate Graph navigation destination and dashboard summary cards are gone.

The same branch also contains the related shell, tab, modal, navigator, terminal, and desktop-window changes completed during this UI pass. The branch is `codex/frontend-integration-terminal-graph`, based on `main`.

## Current State

- Home is the default activity and owns the knowledge graph.
- The primary rail and new-tab menu expose Home, Files, Tasks, and Agents; Graph is no longer a standalone destination.
- The graph uses `react-force-graph-3d` with automatic sparse-graph framing, middle-mouse panning, zoom/fit controls, and expand-all/collapse-to-first-level controls.
- The left navigator can close and resize horizontally without showing the old `Navigator` label.
- The utility panel uses bounded pixel sizing and stays mounted when hidden, preserving terminal sessions during panel resize/collapse.
- Closing a terminal tab or terminal utility tab always asks for confirmation before termination. Cancel leaves the process running.
- Desktop bridge diagnostics live in Settings rather than the main top bar.
- The application window can be dragged from non-interactive top-bar regions.
- Resource, utility, terminal, editor, planner, and inspector tabs share the same compact visual language; modal focus trapping and restoration are implemented.

## What Changed

### Home and navigation

- Deleted Home's workspace overview, recent items, task summary, graph-card wrapper, and empty derived-review section.
- Moved Today’s note, New note, and Commands into a compact Home action strip.
- Made the existing `FocusedGraph` fill all remaining Home workspace height.
- Removed Graph from the activity rail, new-tab chooser, and workspace shortcuts.
- Renamed the user-facing Knowledge activity to Files.

### Graph

- Added `GraphViewport3D.tsx` and its focused regression test.
- Added direct `react-force-graph-3d`, `three`, and `@types/three` dependencies.
- Preserved graph selection, expansion, source actions, inspector context, and accessible fallback content.
- Added delayed `zoomToFit(350, 55)` framing for sparse graphs.
- Bound middle mouse to pan and right mouse to dolly.
- Added expand-all and collapse-all controls; collapse keeps the first level below the root visible.

### Terminal and desktop shell

- Kept the terminal mounted while the utility panel is hidden or another utility tab is active.
- Suppressed PTY resize calls during separator drags, then performs one settled resize after dragging.
- Bounded the utility panel to 320–640 px and the main panel to a safe minimum.
- Added unconditional terminal-close confirmation and terminates only after confirmation.
- Added Tauri start-dragging permission and top-bar drag behavior.
- Removed desktop bridge status from the main chrome and added it to the Settings debugging group.

### Shared UI

- Added Home-default tab creation with a hover/focus activity chooser.
- Normalized tab styling and Lucide close/add icons across the workbench.
- Improved Knowledge search, command palette, shared dialog, planner, and terminal presentation.
- Added modal focus containment, Escape handling, and focus restoration.
- Fixed callback refs so they update in effects and pass the React hooks lint rules.

## Verification

Run from the repository root on 2026-08-04:

```text
pnpm --filter @second-brain-os/app format
pnpm --filter @second-brain-os/app lint
pnpm --filter @second-brain-os/app test
pnpm --filter @second-brain-os/app build
```

Results:

- Formatting passed.
- Full ESLint passed with zero warnings.
- Vitest passed: 27 files, 108 tests.
- TypeScript and Vite production build passed.
- All commands warned that the repository requests Node `22.22.3` while validation used Node `24.14.0` with pnpm `11.9.0`.
- Vite reported existing large-chunk warnings for the graph and Markdown bundles; the build still succeeded.

## Important Outputs

- `design-qa.md` records the tab and overlay visual comparison.
- `handover files/2026-08-03-second-brain-os-3d-graph-runtime-issue-handover.md` records the resolved Tauri/WKWebView blank-graph investigation and live visual verification.
- This document consolidates the later shell, Home integration, graph controls, and terminal behavior.

## Known Issues

- The terminal environment currently copies a parent `TERM` value when present. If the desktop app inherits `TERM=dumb`, child programs disable color. `app/src-tauri/src/terminal/native.rs` should override `dumb` with `xterm-256color` (and optionally set `COLORTERM=truecolor`).
- JSDOM tests cannot prove that WebGL pixels render. Keep a real Tauri/WKWebView visual smoke check for graph releases.
- `Activity` retains the legacy `graph` value for compatibility. New UI entry points are removed, but an old persisted Graph tab may remain until its saved layout is replaced; add a small restore migration if this is observed.
- The close confirmation protects terminal-tab termination. Closing the entire native application window does not yet aggregate and warn about every running terminal or agent process.
- `docs/product-designer-handoff.md` is an unrelated pre-existing untracked file and is intentionally excluded from this delivery.

## Next Steps

1. Override inherited `TERM=dumb` in the native PTY environment and add one focused backend check.
2. Smoke-test Home graph sizing at narrow window widths and with the utility panel at both bounds.
3. If legacy Graph tabs appear after upgrade, normalize persisted `activity: "graph"` tabs to Home during shell restore.
4. Consider graph/Markdown chunk splitting only if startup profiling shows a user-visible cost.

## Practical Caveats

- Do not unmount the terminal merely to hide the utility panel; unmount cleanup intentionally terminates sessions.
- Keep the utility panel bounds in pixels. Percentage sizing previously drove the terminal through unstable near-zero resize states.
- The graph is now a Home surface, not a card. Avoid reintroducing fixed graph heights or max-width wrappers around it.
- Keep `GraphViewport3D` behind `FocusedGraph`; the latter owns selection, expansion, and action semantics.

## Files To Start With

- `app/src/app/WorkspaceSurface.tsx`
- `app/src/components/layout/AppShell.tsx`
- `app/src/components/layout/ActivityBar.tsx`
- `app/src/components/layout/Tabs.tsx`
- `app/src/features/graph/FocusedGraph.tsx`
- `app/src/features/graph/GraphViewport3D.tsx`
- `app/src/features/terminal/TerminalWorkspace.tsx`
- `app/src-tauri/src/terminal/native.rs`
- `app/src/styles/reference-workbench.css`
- `app/tests/App.test.tsx`
- `app/tests/layout.test.tsx`
