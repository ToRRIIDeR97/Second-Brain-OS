import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  editorDocumentToTiptap,
  markdownCodec,
  tiptapToMarkdown,
  type EditorDocument,
} from "./codec";
import { MarkdownExtensions } from "./extensions";

export type MarkdownEditorMode = "rich" | "source" | "split";

export interface MarkdownEditorProps {
  value: string;
  mode?: MarkdownEditorMode;
  readOnly?: boolean;
  onChange?: (markdown: string) => void;
  onQuickNote?: () => void;
}

function modeLabel(mode: MarkdownEditorMode): string {
  return mode === "rich" ? "Rich" : mode === "source" ? "Source" : "Split";
}

export function MarkdownEditor({
  value,
  mode: requestedMode = "rich",
  readOnly = false,
  onChange,
  onQuickNote,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<MarkdownEditorMode>(requestedMode);
  const [document, setDocument] = useState<EditorDocument>(() =>
    markdownCodec.parse(value),
  );
  const [sourceValue, setSourceValue] = useState(value);
  const updatingFromParent = useRef(false);
  const editor = useEditor({
    extensions: MarkdownExtensions,
    editable: !readOnly,
    content: editorDocumentToTiptap(document),
    onUpdate: ({ editor: tiptapEditor }) => {
      if (updatingFromParent.current || readOnly) return;
      const next = tiptapToMarkdown(tiptapEditor.getJSON(), document);
      setSourceValue(next);
      const parsed = markdownCodec.parse(next);
      setDocument({ ...parsed, sourceEdited: true });
      onChange?.(next);
    },
  });

  useEffect(() => {
    if (value === sourceValue) return;
    // Synchronize a controlled external value into the editor projection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSourceValue(value);
    const next = markdownCodec.parse(value);
    setDocument(next);
    updatingFromParent.current = true;
    editor.commands.setContent(editorDocumentToTiptap(next), {
      emitUpdate: false,
    });
    updatingFromParent.current = false;
  }, [editor, sourceValue, value]);

  const updateSource = useCallback(
    (next: string) => {
      setSourceValue(next);
      const parsed = markdownCodec.parse(next);
      setDocument(parsed);
      updatingFromParent.current = true;
      editor.commands.setContent(editorDocumentToTiptap(parsed), {
        emitUpdate: false,
      });
      updatingFromParent.current = false;
      onChange?.(next);
    },
    [editor, onChange],
  );

  const modeButtons = useMemo(() => ["rich", "source", "split"] as const, []);

  return (
    <section aria-label="Markdown editor">
      <header>
        {modeButtons.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={mode === candidate}
            onClick={() => {
              setMode(candidate);
            }}
          >
            {modeLabel(candidate)}
          </button>
        ))}
        <button type="button" onClick={() => onQuickNote?.()}>
          Quick note
        </button>
      </header>
      {(mode === "rich" || mode === "split") && (
        <EditorContent editor={editor} />
      )}
      {(mode === "source" || mode === "split") && (
        <Editor
          height={mode === "split" ? "240px" : "480px"}
          language="markdown"
          value={sourceValue}
          onChange={(next) => {
            updateSource(next ?? "");
          }}
          options={{
            readOnly,
            minimap: { enabled: false },
            wordWrap: "on",
            lineNumbers: "on",
          }}
        />
      )}
    </section>
  );
}
