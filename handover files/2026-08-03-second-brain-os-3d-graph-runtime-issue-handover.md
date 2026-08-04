# Second Brain OS Handover - 3D Graph Blank Canvas Runtime Issue

**Date tag:** 2026-08-03
**Last updated:** 2026-08-03
**Scope:** React Force Graph 3D integration in the desktop Graph view
**Status:** resolved — verified in the Tauri WKWebView runtime

## Summary

`react-force-graph-3d` was integrated to replace the SVG-based focused graph with a pannable, rotatable, zoomable WebGL graph. The blank desktop canvas reported below has now been fixed and visually verified in the actual Tauri application.

## Resolution

Two issues combined to produce the blank appearance:

1. Sparse focused graphs occupied only a few pixels at the renderer's default camera distance. `GraphViewport3D` now waits briefly for initial force-layout coordinates and calls `zoomToFit(350, 55)` automatically. The existing **Fit graph** control remains available.
2. The 3D viewport styles had been added to `app.css`, but the application entry point loads `reference-workbench.css`. The active stylesheet now contains the viewport sizing, overflow, canvas, fallback, and control rules.

The experimental `ngraph` engine and custom Three.js node meshes were removed. The library's standard D3 engine and node renderer now display nodes, links, selection color, and controls correctly.

Runtime verification in Tauri showed the real `5 nodes · 4 relationships` dataset as visible, fitted nodes and links. A regression test now covers the delayed automatic camera fit.

## Current state

- The running desktop app receives and displays the real `5 nodes · 4 relationships` graph data.
- Nodes, links, orbit/zoom interaction, and the **Fit graph** control are visible in the Tauri application.
- Sparse graphs are framed automatically after their initial force layout.
- The implementation uses the library's default D3 engine and node renderer.

## Changes made

- Added `/temp/` to the repository `.gitignore` before cloning the upstream reference repository.
- Cloned `vasturiano/react-force-graph` temporarily to `temp/react-force-graph`, inspected it, and removed the entire `temp/` folder afterward. The ignore rule remains so future temporary downloads stay untracked.
- Added `react-force-graph-3d@1.29.1` and direct `three@0.185.1` dependencies.
- Added `app/src/features/graph/GraphViewport3D.tsx` and routed `FocusedGraph.tsx` through it, preserving the existing graph selection, expansion, and context-menu flows.
- Updated graph styling and tests for the new viewport and an accessible fallback/list representation.

## Runtime experiments and outcomes

| Experiment                                                                                                        | Outcome                                                              |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Map application edges using native `source` / `target` fields instead of custom `sourceId` / `targetId` accessors | Canvas remained blank.                                               |
| Render custom, self-lit Three.js `MeshBasicMaterial` sphere nodes                                                 | Canvas remained blank.                                               |
| Switch physics to `forceEngine="ngraph"`                                                                          | Applied immediately before the stop request; not visually rechecked. |

The data summary makes an empty backend response unlikely. The remaining fault is likely in the WebGL/WebKit runtime, an unobserved JavaScript error, or the library's interaction with Tauri's WKWebView.

## Verification performed

After the resolution, these commands completed successfully:

```text
pnpm --filter @second-brain-os/app format
pnpm --filter @second-brain-os/app lint
pnpm --filter @second-brain-os/app test
pnpm --filter @second-brain-os/app build
```

- Tests: 27 files, 98 tests passed.
- Lint, formatting, and production build passed.
- The commands emitted a Node engine warning: the project requests Node `22.22.3`; the checks ran under Node `24.14.0`.
- A focused regression test verifies the delayed `zoomToFit(350, 55)` call.
- The actual Tauri/WKWebView window was launched and visually verified with the real graph dataset; this supplements the JSDOM suite.

## Resolved issue

The 3D canvas previously appeared blank in the desktop app even while graph data was present. Diagnostic screen captures were written temporarily under `/private/tmp/`; they are not repository artifacts and are not part of the delivery.

## Recommended next steps

1. Keep a Tauri/WKWebView visual smoke check in the release checklist because JSDOM cannot validate WebGL output.
2. Recheck camera framing after future force-graph or Three.js dependency upgrades.
3. Consider automated desktop image assertions only if the project adds a stable Tauri UI-test harness.

## Files to inspect

- `.gitignore`
- `app/package.json`
- `pnpm-lock.yaml`
- `app/src/features/graph/FocusedGraph.tsx`
- `app/src/features/graph/GraphViewport3D.tsx`
- `app/src/features/graph/GraphViewport3D.test.tsx`
- `app/src/features/graph/graph.test.tsx`
- `app/src/styles/app.css`
- `app/src/styles/reference-workbench.css`

## Caveats

- The working tree also contains an unrelated pre-existing untracked file, `docs/product-designer-handoff.md`; it was not modified for this work.
