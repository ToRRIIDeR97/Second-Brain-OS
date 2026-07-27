import { useCallback } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";

import type { EditorTabState, ViewState } from "./types";

export type SourceEditorProps = {
  tab: EditorTabState;
  readOnly?: boolean;
  line?: number;
  column?: number;
  onChange: (content: string) => void;
  onMount?: (editor: Parameters<OnMount>[0], monaco: Monaco) => void;
  onViewStateChange?: (viewState: ViewState) => void;
};

export function SourceEditor({
  tab,
  readOnly = false,
  line,
  column,
  onChange,
  onMount,
  onViewStateChange,
}: SourceEditorProps) {
  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      if (line !== undefined) {
        const model = editor.getModel();
        if (model) {
          const targetLine = Math.max(1, Math.min(line, model.getLineCount()));
          const targetColumn = Math.max(
            1,
            Math.min(column ?? 1, model.getLineMaxColumn(targetLine)),
          );
          editor.setPosition({ lineNumber: targetLine, column: targetColumn });
          editor.revealPositionInCenter({
            lineNumber: targetLine,
            column: targetColumn,
          });
        }
      }
      onMount?.(editor, monaco);
    },
    [column, line, onMount],
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      onChange(value ?? "");
    },
    [onChange],
  );

  const handleBlur = useCallback(() => {
    const editorElement = document.querySelector<HTMLElement>(
      `[data-editor-resource="${tab.resourceId}"]`,
    );
    if (!editorElement || !onViewStateChange) return;
    const editor = editorElement.querySelector<HTMLElement>(".monaco-editor");
    if (!editor) return;
    // The wrapper intentionally leaves Monaco's full view state in the tab
    // owner. This small DOM fallback keeps navigation state serializable in
    // tests without coupling the reducer to Monaco's runtime types.
    onViewStateChange({
      cursorLine: 1,
      cursorColumn: 1,
      scrollTop: editor.scrollTop,
      scrollLeft: editor.scrollLeft,
    });
  }, [onViewStateChange, tab.resourceId]);

  return (
    <div
      data-editor-resource={tab.resourceId}
      onBlur={handleBlur}
      style={{ height: "100%", minHeight: 240 }}
    >
      <Editor
        path={tab.modelUri}
        value={tab.content}
        language={tab.language}
        {...(line === undefined ? {} : { line })}
        onChange={handleChange}
        onMount={handleMount}
        keepCurrentModel
        saveViewState
        height="100%"
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          readOnly: readOnly || tab.encoding === "unsupported",
          wordWrap: "off",
        }}
        wrapperProps={{ "aria-label": `Source editor for ${tab.relativePath}` }}
      />
    </div>
  );
}
