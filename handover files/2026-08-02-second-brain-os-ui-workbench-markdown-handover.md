# Second Brain OS Handover - UI Workbench and Markdown Editing

**Date tag:** 2026-08-02
**Last updated:** 2026-08-02
**Scope:** Desktop shell, workspace navigation, right utility dock, terminal, calendar, Git, agents, graph, settings, and Markdown editing
**Status:** current

## Executive Summary

This workstream substantially redesigned the Second Brain OS desktop application to match the user's supplied light, macOS-style knowledge IDE references. The old global inspector and bottom terminal drawer are no longer the intended interaction model. The current design uses a persistent left activity rail and navigator, a central Chrome-like resource tab workspace, and an optional right utility dock whose tabs are opened and closed by the user.

The right utility dock supports Files, Calendar, Git, and Terminal. It starts with no utility tabs and presents a centered launcher. Open utilities become closeable tabs, already-open utilities are unavailable from the add menu, and closing the final tab returns to the launcher. Terminal sessions render directly as xterm surfaces in the right dock rather than as a secondary status card or bottom drawer.

The Markdown editor now has a Rich/Source pill toggle and a real formatting toolbar. The final pass fixed source-to-rich synchronization, link and image insertion, Markdown table parsing/serialization, edit-state propagation, and a React render-phase state warning. The latest frontend checks pass with 80 tests.

The working tree is large, dirty, and uncommitted. It contains the whole UI redesign and associated integration work. Preserve unrelated changes and do not reset or selectively discard files without first understanding their ownership.

## Current State

- Repository: `/Users/japardinathaniel/Documents/GitHub/Second Brain OS`
- Current branch: `codex/frontend-integration-terminal-graph`
- Working tree: modified and untracked files; nothing from this UI workstream was committed during the latest session.
- Development command: `pnpm run desktop:dev` from the repository root.
- Renderer URL used by Tauri: `http://localhost:1420/`.
- A Tauri development process was still running at handover time and was receiving Vite HMR updates. A future session should not assume that process survived task/session teardown; restart with the command above if needed.
- The latest runtime-log poll after the edit-state fix showed only the expected HMR update and no new renderer error.
- The user's primary visual references are the eleven `ChatGPT Image Aug 2, 2026...png` files on `/Users/japardinathaniel/Desktop/`. The most complete shell reference is `ChatGPT Image Aug 2, 2026, 08_10_19 PM.png`.

## What Changed

### Desktop shell and navigation

- Reworked the application into a light, high-density desktop IDE rather than a card-based web dashboard.
- Added a macOS-specific Tauri configuration and window treatment.
- Rebuilt the activity rail, navigator, resource tab strip, main workspace, top chrome, and status areas.
- Removed the old horizontal workspace strip from the intended final shell. Workspace/project selection is not meant to occupy a full second navigation bar.
- Resource tabs represent files or views that the user opened. They carry active, dirty, and close behavior instead of acting like a fixed product navigation row.
- Added global workspace, theme, preference, and shell-state providers.
- Added new-note, confirmation, workspace-navigation, and preference/settings surfaces.

### Right utility dock

- Added `UtilityDock` as the right-side window surface.
- Supported utilities are Files, Calendar, Git, and Terminal.
- No utilities are populated by default.
- The empty state presents a centered launcher similar to Codex's panel launcher.
- Open utilities appear as closeable tabs; closing the last utility restores the launcher.
- The add control excludes utilities already open.
- The boundary between the center workspace and right dock uses the same simple divider language as the left navigator boundary.
- The former Inspector/Provenance placeholder panel is no longer the desired right-side default.

### Terminal

- Terminal now lives in the right utility dock, not a bottom drawer.
- Opening Terminal shows the xterm terminal surface directly.
- Multiple terminal sessions retain terminal-specific tabs and direct keyboard input.
- The implementation continues to use workspace-scoped native PTY commands; it does not expose unrestricted shell execution to the renderer.

### Calendar and planning

- Added a reference calendar matching the supplied weekly calendar layout.
- Calendar, task, and scheduling surfaces are represented in the redesigned UI.
- Current calendar/task content should be treated as a reference/local presentation unless live provider adapters are explicitly confirmed. Google Calendar and Google Tasks OAuth/sync are not demonstrated by the latest frontend verification.

### Git and source control

- Reworked the Git surface and added typed diff data through IPC.
- Git changes can open diff resources as central tabs.
- The right utility Git tab is intended as the source-control launcher/overview; detailed diffs belong in the main resource workspace.

### Agents, graph, context, and settings

- Expanded agent session state, source data, activity presentation, and inspector/context models.
- Restyled and refined focused graph rendering and its selection context.
- Added theme and editor-autosave preferences.
- Added workspace selection and registration state outside the previous local `WorkspaceSurface` ownership.
- Updated context presentation, source control, search, graph, agents, terminal, and shell tests to reflect the new composition.

### Markdown editor

- Added the requested Rich/Source pill toggle.
- Replaced the placeholder toolbar with working commands for H1-H3, bold, italic, strikethrough, inline code, links, bullet lists, numbered lists, task lists, blockquotes, tables, images, code blocks, horizontal rules, undo, and redo.
- Added full-screen editor behavior.
- Added safe link/image insertion dialogs. `http`, `https`, `mailto`, anchors, absolute workspace paths, and relative workspace paths are accepted; unknown URI schemes such as `javascript:` are rejected.
- Source view uses Monaco with Markdown syntax, line numbers, wrapping, and automatic layout.
- Fixed Rich/Source synchronization so a local Source edit is not overwritten by the previous controlled prop value when switching back to Rich.
- Prevented parent echoes of local content from unnecessarily replacing the Tiptap document and disturbing edit history/cursor state.
- Kept read-only state synchronized with the Tiptap editor.
- Fixed Markdown table parsing so the `| --- |` separator is not loaded as a visible data row.
- Fixed table serialization so inserted tables receive a valid Markdown header separator, consistent column counts, escaped pipes, and safe line-break conversion.
- Added component-level regression tests for source/rich switching, block formatting, and link insertion, plus codec/editor tests for valid table round trips.
- Moved dirty-tab propagation out of the React state-updater callback, eliminating the observed `Cannot update ShellProvider while rendering WorkspaceSurface` warning during editing.

## Verification

The final frontend verification was run from `app/` after the Markdown and edit-state fixes:

```sh
pnpm lint
pnpm test
pnpm build
```

Observed results:

- ESLint passed with zero warnings.
- Vitest passed: 23 test files, 80 tests.
- TypeScript project build passed.
- Vite production build passed with 1,696 modules transformed.
- The Markdown editor targeted suite passed: 2 files, 6 tests.
- `git diff --check` passed before the final one-line `WorkspaceSurface` state-ordering adjustment; that final patch contains no whitespace-sensitive content.

Earlier in this same UI workstream, Rustfmt and the Rust application test suites were reported passing after the backend/IPC changes. They were not rerun after the final frontend-only Markdown adjustments. A pickup agent preparing a commit or PR should rerun the repository-level commands below:

```sh
pnpm run format
pnpm run lint
pnpm run test
pnpm run build
cargo build --workspace
git diff --check
```

## Important Outputs

- `app/src/components/layout/AppShell.tsx`
- `app/src/components/layout/ActivityBar.tsx`
- `app/src/components/layout/Navigator.tsx`
- `app/src/components/layout/Tabs.tsx`
- `app/src/components/layout/UtilityDock.tsx`
- `app/src/components/layout/WorkspaceNavigator.tsx`
- `app/src/app/WorkspaceSurface.tsx`
- `app/src/state/shell.ts`
- `app/src/state/workspace.tsx`
- `app/src/state/preferences.tsx`
- `app/src/state/theme.tsx`
- `app/src/features/editor/markdown/MarkdownEditor.tsx`
- `app/src/features/editor/markdown/codec.ts`
- `app/src/features/editor/markdown/MarkdownEditor.test.tsx`
- `app/src/features/editor/markdown/editor.test.ts`
- `app/src/features/terminal/TerminalWorkspace.tsx`
- `app/src/features/planner/ReferenceCalendar.tsx`
- `app/src/features/source-control/SourceControlWorkspace.tsx`
- `app/src/features/agents/AgentWorkspace.tsx`
- `app/src/features/graph/FocusedGraph.tsx`
- `app/src/styles/reference-workbench.css`
- `app/src/styles/app.css`
- `app/src-tauri/src/commands.rs`
- `app/src-tauri/tauri.macos.conf.json`

## Known Issues

1. The entire redesign remains uncommitted in a large dirty working tree. It mixes shell, frontend-domain, IPC, backend-command, style, and test changes. Review ownership and history before splitting or committing it.
2. `docs/product-designer-handoff.md` is an untracked 3,060-line artifact based on the older inspector plus bottom-terminal-drawer model. Its shell layout guidance is superseded by this handover and the current implementation. Do not use it as current UI truth without revising it.
3. Google Calendar and Google Tasks live synchronization was not demonstrated. The current reference calendar must not be described as provider-connected until OAuth, credentials, provider adapters, error states, and sync tests exist.
4. Manual native-app interaction remains necessary for text selection formatting, toolbar selection retention, undo/redo history, image insertion, table editing, source-mode cursor behavior, autosave, and external-file changes.
5. The full set of supplied design screens has not been reproduced pixel-for-pixel. The strongest implementation focus was shell composition, right utility tabs, terminal placement, navigation density, and Markdown editing.
6. Some older layout components such as `Drawer`, `Inspector`, and `WorkspaceStrip` remain in the tree for compatibility/tests even though they are no longer the intended primary composition. Confirm actual import reachability before deleting them.
7. The production Markdown chunk is approximately 465 kB before gzip (about 145 kB gzip). It is not currently a build failure, but further editor extensions should be added deliberately.
8. The utility-dock empty state and add/close behavior are covered by shell/layout tests, but should still receive manual narrow-window and keyboard-navigation review.
9. There is no commit, staging action, PR, or clean-worktree checkpoint associated with this handover.

## Next Steps

1. Restart or focus the native application with `pnpm run desktop:dev` and complete a manual UX pass against the user's supplied images.
2. Exercise every Markdown toolbar command on selected and unselected text, save the file, reopen it, and compare Source output for preservation.
3. Add interaction tests for image insertion, task-list toggling, table insertion, undo/redo, external value replacement, and read-only transitions.
4. Verify the right utility dock from an empty state: add each utility, prevent duplicates, switch tabs, close tabs, and return to the launcher.
5. Verify native terminal creation, typing, resizing, session switching, and teardown inside the right dock.
6. Decide whether to update and move `docs/product-designer-handoff.md` into `handover files/` as a historical artifact or replace it with a current product-design specification that reflects the right utility dock.
7. Wire real Google Calendar and Google Tasks only after confirming product scope, authentication storage, provider error handling, and privacy requirements.
8. Run the full repository verification commands, review the diff by domain, and create deliberate commits rather than one opaque UI mega-commit.

## Practical Caveats

- Preserve the user's existing dirty changes. Do not use `git reset --hard`, broad checkout commands, or bulk deletion.
- Keep one Tauri backend and a thin MCP sidecar; do not extract services merely to organize the redesign.
- Renderer filesystem and terminal calls must remain workspace-ID plus validated-relative-path based.
- Canonical Markdown files must remain human-readable and round-trip safely. Unsupported constructs should stay protected rather than being silently discarded.
- Do not reintroduce the global Inspector/Provenance placeholder as the default right panel. The user's stated model is an optional utility window with user-managed tabs.
- Do not move Terminal back to the bottom drawer.
- Do not prepopulate all four utility tabs. The empty launcher is the intended first state.
- Detailed Git diffs and opened files belong in central resource tabs; the right dock is for utility views.
- Treat the Desktop reference images as design intent, not proof that every provider or agent workflow is already implemented.

## Files To Start With

1. `app/src/components/layout/AppShell.tsx`
2. `app/src/components/layout/UtilityDock.tsx`
3. `app/src/state/shell.ts`
4. `app/src/app/WorkspaceSurface.tsx`
5. `app/src/features/editor/markdown/MarkdownEditor.tsx`
6. `app/src/features/editor/markdown/codec.ts`
7. `app/src/styles/reference-workbench.css`
8. `app/tests/shell.test.ts`
9. `app/tests/layout.test.tsx`
10. `app/src/features/editor/markdown/MarkdownEditor.test.tsx`
