# Note editor restoration plan

## Goal

Restore the useful editing behavior from the legacy React/Tauri editor inside the current Solid/OpenCode notes page. Keep Markdown files canonical and keep filesystem access behind the validated Second Brain server routes.

## Evidence

The parity reference is `origin/main` at commit `4b8c687`, especially:

- `app/src/features/editor/markdown/MarkdownEditor.tsx`
- `app/src/features/editor/markdown/MarkdownEditor.test.tsx`
- `app/src/features/editor/markdown/extensions.ts`
- `app/src/features/editor/markdown/attachments.ts`

The current implementation lives in `opencode/packages/app/src/pages/notes.tsx`. It already has note persistence, revision conflict checks, metadata, backlinks, and a Markdown renderer with GFM tables, task lists, KaTeX, and Shiki code highlighting.

## Module seam

The notes page owns note identity, metadata, persistence, and conflict handling. A new note-editor module owns editing behavior behind this interface:

```ts
type NoteEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  loading?: boolean;
};
```

Mode selection, selection transforms, slash commands, split geometry, fullscreen state, and editor focus stay inside the module. Pure Markdown transformations are a separate internal seam and are tested without rendering the page.

## Phase 1: restore structured source editing

This phase is the current implementation target.

- Move editor behavior out of the page into the note-editor module.
- Restore Write, Split, and Preview modes.
- Restore side-by-side and stacked split layouts with resizing.
- Restore fullscreen editing.
- Add commands for headings, emphasis, lists, tasks, quotes, links, code, dividers, tables, math, and image URLs.
- Add searchable slash commands with keyboard navigation.
- Preserve selection after every command and apply line commands across multiline selections.
- Keep `Cmd/Ctrl+S`, `Cmd/Ctrl+B`, and `Cmd/Ctrl+I` shortcuts.
- Reuse the existing Markdown renderer for preview instead of adding another parser.
- Add focused tests for Markdown transformations and slash-command detection.

## Phase 2: rich editing

- Add a Solid adapter around a framework-neutral ProseMirror/Tiptap core.
- Port the legacy Markdown codec before enabling rich editing so unsupported Markdown cannot disappear during mode changes.
- Restore task toggling, table controls, code-language selection, link editing, math dialogs, and image node views.
- Lazy-load the rich editor and source editor so notes do not add their full bundle cost to the application shell.
- Port the old rich/source round-trip tests before making Rich the default mode.

Phase 2 needs a dependency and bundle-size decision. The old `@tiptap/react` module cannot be copied into the Solid renderer.

## Phase 3: local image attachments

- Add a bounded Second Brain image-import route that accepts a workspace ID, note-relative destination, supported image MIME type, and limited payload.
- Validate the destination through `LocationMutation` and write through `FileMutation`.
- Reject traversal, SVG, unknown MIME types, oversized payloads, and base64 embedded directly in note Markdown.
- Return a note-relative Markdown path and resolve it through an authenticated workspace route.
- Add paste, drop, and file-picker adapters in the note editor.
- Add HEIC conversion only if the existing OpenCode image pipeline can perform it without shipping a second image stack.

## Verification

- Run the focused note-editor command tests.
- Run the app typecheck.
- Run the app build when typecheck passes.
- Exercise mode changes, toolbar commands, slash commands, resizing, fullscreen, preview rendering, save, discard, and note switching in the local notes page.
- Review the final diff against the legacy parity list and confirm that no unrestricted filesystem access reaches the renderer.

## Explicit limits for phase 1

Phase 1 restores the complete source-editing workflow, not WYSIWYG editing or local file import. Those two features need the codec and server work above to avoid data loss and unsafe renderer filesystem access.
