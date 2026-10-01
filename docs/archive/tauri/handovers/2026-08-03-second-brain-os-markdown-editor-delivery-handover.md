# Second Brain OS Handover — Markdown Editor Delivery

**Date tag:** 2026-08-03
**Status:** committed delivery handover
**Branch:** `codex/frontend-integration-terminal-graph`
**Scope:** Notion-inspired Markdown editing, safe local image attachments, static resizable tables, and the accompanying workbench integration

## Summary

This delivery completes the requested Markdown-editor upgrade while preserving ordinary, portable Markdown as the canonical note format. It intentionally does **not** add database-backed tables or table-to-database linking.

The editor now supports rich editing, Monaco source editing, and a resizable Rich/Source split in side-by-side or stacked orientation. Inline and display TeX render through KaTeX; code blocks have syntax highlighting and a language selector; static tables can be resized and retain their widths in Markdown metadata; local image attachments use workspace-relative paths and a typed, bounded Tauri bridge.

The wider workbench changes from the August 2 handover are included in the same delivery: the desktop shell/navigation redesign, right utility dock, terminal placement, reference calendar, source-control surface, agent/context updates, theme/preferences state, and related tests.

## Markdown Editor Capabilities

- Rich, Source, and Split modes; the Split mode has a draggable separator and vertical (side-by-side) or horizontal (stacked) layouts.
- Formatting commands for headings, marks, links, bullet/numbered/task lists, blockquotes, dividers, undo/redo, tables, code blocks, and images.
- Inline and display TeX insertion with safe KaTeX rendering and in-place editing.
- Language-selectable, highlighted code blocks using Lowlight.
- Static Tiptap tables with row/column controls and resizable columns.
- A deterministic Markdown codec that preserves table widths through an inert adjacent comment:

  ```markdown
  <!-- second-brain-table-widths: 180,240 -->
  | Name | Value |
  | --- | --- |
  | One | Two |
  ```

- Local PNG, JPEG, GIF, and WebP import. The renderer keeps only note-relative Markdown paths; the backend enforces allowed image types, base64 decoding, a 10 MB limit, workspace/path policy checks, and create-only attachment writes.

## Important Files

- `app/src/features/editor/markdown/MarkdownEditor.tsx`
- `app/src/features/editor/markdown/extensions.ts`
- `app/src/features/editor/markdown/MathNodeView.tsx`
- `app/src/features/editor/markdown/ImageNodeView.tsx`
- `app/src/features/editor/markdown/codec.ts`
- `app/src/features/editor/markdown/attachments.ts`
- `app/src/app/WorkspaceSurface.tsx`
- `app/src/lib/ipc/types.ts` and `app/src/lib/ipc/client.ts`
- `app/src-tauri/src/commands.rs` and `app/src-tauri/src/app.rs`
- `app/src/styles/reference-workbench.css`

For broader shell and workbench context, start with `handover files/2026-08-02-second-brain-os-ui-workbench-markdown-handover.md`.

## Validation Completed

All checks below passed after the editor and attachment integration:

```sh
pnpm --filter @second-brain-os/app test
pnpm --filter @second-brain-os/app lint
pnpm --filter @second-brain-os/app format
pnpm --filter @second-brain-os/app build
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git diff --check
```

Frontend tests: 26 files / 96 tests passed. Rust workspace tests, formatting, and strict Clippy passed.

A browser-based rendered-app pass used the actual built renderer with a mocked trusted Tauri workspace bridge. It verified task toggling, code-language selection, table row insertion and column resizing, KaTeX insertion/rendering, local image import/preview calls, both split orientations, and persisted Markdown output. The real Rust attachment commands are additionally covered by the workspace test suite.

## Run and Verify Locally

```sh
pnpm --filter @second-brain-os/app exec vite --host 127.0.0.1 --port 4173
```

For the full native shell, use the repository's desktop development command:

```sh
pnpm run desktop:dev
```

## Deliberate Scope and Follow-up

1. Tables are static Markdown tables only. Database-backed tables, relations, rollups, and formulas are deliberately out of scope.
2. The Rich/Source split is an editor-view split, not arbitrary document-column layout.
3. A native Tauri manual pass with a real workspace remains useful for final UX review of file-picker behavior, keyboard selection, narrow-window layout, and attachment persistence on disk.
4. The package declares Node 22.22.3. The validation environment used Node 24.14.0 and emitted only the expected engine warning.
5. `docs/product-designer-handoff.md` remains untracked and intentionally excluded from this delivery because the prior handover identifies it as superseded by the current right-utility-dock design. Preserve it locally until it is deliberately revised or archived.

## Commit Boundary

This handover accompanies the cohesive UI/workbench delivery on the branch above. No database or provider-integration scope is implied by the Markdown additions.
