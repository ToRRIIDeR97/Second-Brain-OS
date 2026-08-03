import Editor from "@monaco-editor/react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  Bold,
  Code2,
  FileCode2,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Maximize2,
  Minus,
  Quote,
  Strikethrough,
  Table2,
  Redo2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  editorDocumentToTiptap,
  markdownCodec,
  tiptapToMarkdown,
  type EditorDocument,
} from "./codec";
import { createMarkdownExtensions } from "./extensions";

export type MarkdownEditorMode = "rich" | "source" | "split";
export type MarkdownSplitOrientation = "vertical" | "horizontal";

export interface MarkdownEditorProps {
  value: string;
  mode?: MarkdownEditorMode;
  readOnly?: boolean;
  onChange?: (markdown: string) => void;
  onImportImage?: (file: File, alt: string) => Promise<string | undefined>;
  resolveLocalImage?: (source: string) => Promise<string | undefined>;
}

type InsertDialog = {
  kind: "link" | "image";
  url: string;
  label: string;
  file?: File | undefined;
};

type EquationDialog = {
  kind: "inlineMath" | "mathBlock";
  value: string;
};

const CODE_LANGUAGES = [
  ["", "Plain text"],
  ["bash", "Bash"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["css", "CSS"],
  ["go", "Go"],
  ["graphql", "GraphQL"],
  ["html", "HTML"],
  ["java", "Java"],
  ["javascript", "JavaScript"],
  ["json", "JSON"],
  ["kotlin", "Kotlin"],
  ["markdown", "Markdown"],
  ["php", "PHP"],
  ["python", "Python"],
  ["ruby", "Ruby"],
  ["rust", "Rust"],
  ["sql", "SQL"],
  ["swift", "Swift"],
  ["toml", "TOML"],
  ["typescript", "TypeScript"],
  ["xml", "XML"],
  ["yaml", "YAML"],
] as const;

function validTarget(value: string): boolean {
  const target = value.trim();
  if (!target || /\s/.test(target)) return false;
  if (/^(https?:\/\/|mailto:)/i.test(target)) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return false;
  return true;
}

export function MarkdownEditor({
  value,
  mode: requestedMode = "rich",
  readOnly = false,
  onChange,
  onImportImage,
  resolveLocalImage,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<MarkdownEditorMode>(requestedMode);
  const [splitOrientation, setSplitOrientation] =
    useState<MarkdownSplitOrientation>("vertical");
  const [fullscreen, setFullscreen] = useState(false);
  const [insertDialog, setInsertDialog] = useState<InsertDialog>();
  const [insertError, setInsertError] = useState("");
  const [insertSubmitting, setInsertSubmitting] = useState(false);
  const [equationDialog, setEquationDialog] = useState<EquationDialog>();
  const [initialDocument] = useState<EditorDocument>(() =>
    markdownCodec.parse(value),
  );
  const [sourceValue, setSourceValue] = useState(value);
  const documentRef = useRef(initialDocument);
  const lastExternalValue = useRef(value);
  const updatingFromParent = useRef(false);
  const markdownExtensions = useMemo(
    () => createMarkdownExtensions({ resolveLocalImage }),
    [resolveLocalImage],
  );
  const editor = useEditor({
    extensions: markdownExtensions,
    editable: !readOnly,
    content: editorDocumentToTiptap(initialDocument),
    onUpdate: ({ editor: tiptapEditor }) => {
      if (updatingFromParent.current || readOnly) return;
      const next = tiptapToMarkdown(
        tiptapEditor.getJSON(),
        documentRef.current,
      );
      setSourceValue(next);
      const parsed = markdownCodec.parse(next);
      documentRef.current = { ...parsed, sourceEdited: true };
      lastExternalValue.current = next;
      onChange?.(next);
    },
  });
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  });

  useEffect(() => {
    if (value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    // Synchronize the controlled file value into both editor projections.
    setSourceValue(value);
    const next = markdownCodec.parse(value);
    documentRef.current = next;
    updatingFromParent.current = true;
    editor.commands.setContent(editorDocumentToTiptap(next), {
      emitUpdate: false,
    });
    updatingFromParent.current = false;
  }, [editor, value]);

  const updateSource = useCallback(
    (next: string) => {
      if (readOnly) return;
      setSourceValue(next);
      const parsed = markdownCodec.parse(next);
      documentRef.current = parsed;
      lastExternalValue.current = next;
      updatingFromParent.current = true;
      editor.commands.setContent(editorDocumentToTiptap(parsed), {
        emitUpdate: false,
      });
      updatingFromParent.current = false;
      onChange?.(next);
    },
    [editor, onChange, readOnly],
  );

  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  const richDisabled = readOnly || mode === "source";
  const codeBlockActive = editor.isActive("codeBlock");
  const activeCodeLanguage = codeBlockActive
    ? String(editor.getAttributes("codeBlock").language ?? "")
    : "";
  const tableActive = editor.isActive("table");
  const format = (action: () => void) => {
    if (!richDisabled) action();
  };

  const openInsertDialog = (kind: InsertDialog["kind"]) => {
    const { from, to } = editor.state.selection;
    setInsertDialog({
      kind,
      url: "",
      label: editor.state.doc.textBetween(from, to, " "),
    });
    setInsertError("");
  };

  const openEquationDialog = (kind: EquationDialog["kind"]) => {
    setEquationDialog({ kind, value: "" });
  };

  const submitEquation = () => {
    if (!equationDialog || richDisabled || !equationDialog.value.trim()) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: equationDialog.kind,
        attrs: { value: equationDialog.value.trim() },
      })
      .run();
    setEquationDialog(undefined);
  };

  const toggleCodeBlock = () => {
    format(() => {
      if (codeBlockActive) editor.chain().focus().toggleCodeBlock().run();
      else
        editor
          .chain()
          .focus()
          .toggleCodeBlock()
          .updateAttributes("codeBlock", { language: "" })
          .run();
    });
  };

  const submitInsert = async () => {
    if (!insertDialog) return;
    if (insertDialog.kind === "image" && insertDialog.file) {
      if (!onImportImage) {
        setInsertError("Local image import is unavailable.");
        return;
      }
      setInsertSubmitting(true);
      try {
        const source = await onImportImage(
          insertDialog.file,
          insertDialog.label.trim(),
        );
        const importedSource = source?.trim() ?? "";
        if (
          !importedSource ||
          /^data:/i.test(importedSource) ||
          /;base64,/i.test(importedSource)
        ) {
          setInsertError("The local image could not be imported.");
          return;
        }
        editor
          .chain()
          .focus()
          .setImage({ src: importedSource, alt: insertDialog.label.trim() })
          .run();
        setInsertDialog(undefined);
        setInsertError("");
      } catch {
        setInsertError("The local image could not be imported.");
      } finally {
        setInsertSubmitting(false);
      }
      return;
    }
    const url = insertDialog.url.trim();
    if (!validTarget(url)) {
      setInsertError(
        "Use an https, mailto, anchor, or workspace-relative URL.",
      );
      return;
    }
    if (insertDialog.kind === "image") {
      editor
        .chain()
        .focus()
        .setImage({ src: url, alt: insertDialog.label.trim() })
        .run();
    } else {
      const { from, to } = editor.state.selection;
      if (from !== to) editor.chain().focus().setLink({ href: url }).run();
      else
        editor
          .chain()
          .focus()
          .insertContent({
            type: "text",
            text: insertDialog.label.trim() || url,
            marks: [{ type: "link", attrs: { href: url } }],
          })
          .run();
    }
    setInsertDialog(undefined);
    setInsertError("");
  };

  return (
    <section
      className={`markdown-editor${fullscreen ? " markdown-editor-fullscreen" : ""}`}
      aria-label="Markdown editor"
    >
      <header className="markdown-editor-toolbar">
        <div className="markdown-formatting" aria-label="Markdown formatting">
          {([1, 2, 3] as const).map((level) => (
            <button
              type="button"
              key={level}
              disabled={richDisabled}
              aria-label={`Heading ${String(level)}`}
              aria-pressed={editor.isActive("heading", { level })}
              onClick={() => {
                format(() =>
                  editor.chain().focus().toggleHeading({ level }).run(),
                );
              }}
            >
              H{level}
            </button>
          ))}
          <span className="markdown-toolbar-divider" />
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Bold"
            aria-pressed={editor.isActive("bold")}
            onClick={() => {
              format(() => editor.chain().focus().toggleBold().run());
            }}
          >
            <Bold size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Italic"
            aria-pressed={editor.isActive("italic")}
            onClick={() => {
              format(() => editor.chain().focus().toggleItalic().run());
            }}
          >
            <Italic size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Strikethrough"
            aria-pressed={editor.isActive("strike")}
            onClick={() => {
              format(() => editor.chain().focus().toggleStrike().run());
            }}
          >
            <Strikethrough size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Inline code"
            aria-pressed={editor.isActive("code")}
            onClick={() => {
              format(() => editor.chain().focus().toggleCode().run());
            }}
          >
            <Code2 size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Link"
            aria-pressed={editor.isActive("link")}
            onClick={() => {
              if (editor.isActive("link"))
                format(() => editor.chain().focus().unsetLink().run());
              else openInsertDialog("link");
            }}
          >
            <Link size={15} />
          </button>
          <span className="markdown-toolbar-divider" />
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Bullet list"
            aria-pressed={editor.isActive("bulletList")}
            onClick={() => {
              format(() => editor.chain().focus().toggleBulletList().run());
            }}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Numbered list"
            aria-pressed={editor.isActive("orderedList")}
            onClick={() => {
              format(() => editor.chain().focus().toggleOrderedList().run());
            }}
          >
            <ListOrdered size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Task list"
            aria-pressed={editor.isActive("taskList")}
            onClick={() => {
              format(() => editor.chain().focus().toggleTaskList().run());
            }}
          >
            <ListTodo size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Blockquote"
            aria-pressed={editor.isActive("blockquote")}
            onClick={() => {
              format(() => editor.chain().focus().toggleBlockquote().run());
            }}
          >
            <Quote size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Insert table"
            onClick={() => {
              format(() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run(),
              );
            }}
          >
            <Table2 size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Insert image"
            onClick={() => {
              openInsertDialog("image");
            }}
          >
            <ImageIcon size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Code block"
            aria-pressed={codeBlockActive}
            onClick={() => {
              toggleCodeBlock();
            }}
          >
            <FileCode2 size={15} />
          </button>
          <label className="markdown-code-language">
            <span className="markdown-visually-hidden">
              Code block language
            </span>
            <select
              aria-label="Code block language"
              value={activeCodeLanguage}
              disabled={richDisabled || !codeBlockActive}
              onChange={(event) => {
                const language =
                  event.currentTarget.value === "__custom__"
                    ? ""
                    : event.currentTarget.value;
                format(() =>
                  editor
                    .chain()
                    .focus()
                    .updateAttributes("codeBlock", { language })
                    .run(),
                );
              }}
            >
              {activeCodeLanguage &&
              !CODE_LANGUAGES.some(
                ([language]) => language === activeCodeLanguage,
              ) ? (
                <option value={activeCodeLanguage}>{activeCodeLanguage}</option>
              ) : null}
              {CODE_LANGUAGES.map(([language, label]) => (
                <option key={language || "plain"} value={language}>
                  {label}
                </option>
              ))}
              <option value="__custom__">Custom / unset</option>
            </select>
          </label>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Horizontal rule"
            onClick={() => {
              format(() => editor.chain().focus().setHorizontalRule().run());
            }}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Insert inline equation"
            onClick={() => {
              openEquationDialog("inlineMath");
            }}
          >
            ∑
          </button>
          <button
            type="button"
            disabled={richDisabled}
            aria-label="Insert display equation"
            onClick={() => {
              openEquationDialog("mathBlock");
            }}
          >
            ∑□
          </button>
          <div
            className="markdown-table-controls"
            data-active={tableActive}
            aria-label="Table controls"
          >
            <button
              type="button"
              disabled={richDisabled || !tableActive}
              aria-label="Add row before"
              onClick={() => {
                format(() => editor.chain().focus().addRowBefore().run());
              }}
            >
              Row ↑
            </button>
            <button
              type="button"
              disabled={richDisabled || !tableActive}
              aria-label="Add row after"
              onClick={() => {
                format(() => editor.chain().focus().addRowAfter().run());
              }}
            >
              Row ↓
            </button>
            <button
              type="button"
              disabled={richDisabled || !tableActive}
              aria-label="Add column before"
              onClick={() => {
                format(() => editor.chain().focus().addColumnBefore().run());
              }}
            >
              Col ←
            </button>
            <button
              type="button"
              disabled={richDisabled || !tableActive}
              aria-label="Add column after"
              onClick={() => {
                format(() => editor.chain().focus().addColumnAfter().run());
              }}
            >
              Col →
            </button>
            <button
              type="button"
              disabled={richDisabled || !tableActive}
              aria-label="Delete table"
              onClick={() => {
                format(() => editor.chain().focus().deleteTable().run());
              }}
            >
              Delete table
            </button>
          </div>
          <span className="markdown-toolbar-divider" />
          <button
            type="button"
            disabled={
              richDisabled || !editor.can().chain().focus().undo().run()
            }
            aria-label="Undo"
            onClick={() => {
              format(() => editor.chain().focus().undo().run());
            }}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            disabled={
              richDisabled || !editor.can().chain().focus().redo().run()
            }
            aria-label="Redo"
            onClick={() => {
              format(() => editor.chain().focus().redo().run());
            }}
          >
            <Redo2 size={15} />
          </button>
        </div>
        <div className="markdown-toolbar-end">
          <div className="markdown-mode-toggle" aria-label="Editor mode">
            {(["rich", "source", "split"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={mode === candidate}
                onClick={() => {
                  setMode(candidate);
                }}
              >
                {candidate === "rich"
                  ? "Rich"
                  : candidate === "source"
                    ? "Source"
                    : "Split"}
              </button>
            ))}
          </div>
          {mode === "split" ? (
            <div
              className="markdown-split-orientation"
              aria-label="Split orientation"
            >
              <button
                type="button"
                aria-label="Vertical split (side-by-side)"
                aria-pressed={splitOrientation === "vertical"}
                onClick={() => {
                  setSplitOrientation("vertical");
                }}
              >
                Vertical
              </button>
              <button
                type="button"
                aria-label="Horizontal split (stacked)"
                aria-pressed={splitOrientation === "horizontal"}
                onClick={() => {
                  setSplitOrientation("horizontal");
                }}
              >
                Horizontal
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="markdown-fullscreen"
            aria-label={
              fullscreen ? "Exit full screen editor" : "Full screen editor"
            }
            aria-pressed={fullscreen}
            onClick={() => {
              setFullscreen((expanded) => !expanded);
            }}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </header>

      {insertDialog ? (
        <form
          className="markdown-insert-dialog"
          role="dialog"
          aria-label={
            insertDialog.kind === "link" ? "Insert link" : "Insert image"
          }
          onSubmit={(event) => {
            event.preventDefault();
            void submitInsert();
          }}
        >
          <div>
            <strong>
              {insertDialog.kind === "link" ? "Insert link" : "Insert image"}
            </strong>
            <button
              type="button"
              aria-label="Close insert dialog"
              onClick={() => {
                setInsertDialog(undefined);
                setInsertError("");
              }}
            >
              ×
            </button>
          </div>
          <label>
            {insertDialog.kind === "link" ? "Text" : "Alt text"}
            <input
              value={insertDialog.label}
              onChange={(event) => {
                setInsertDialog({
                  ...insertDialog,
                  label: event.currentTarget.value,
                });
              }}
            />
          </label>
          <label>
            URL
            <input
              autoFocus
              value={insertDialog.url}
              placeholder="https://example.com"
              onChange={(event) => {
                setInsertDialog({
                  ...insertDialog,
                  url: event.currentTarget.value,
                });
                setInsertError("");
              }}
            />
          </label>
          {insertDialog.kind === "image" ? (
            <label>
              Local image
              <input
                type="file"
                accept="image/*"
                aria-label="Local image file"
                onChange={(event) => {
                  setInsertDialog({
                    ...insertDialog,
                    file: event.currentTarget.files?.[0],
                  });
                  setInsertError("");
                }}
              />
            </label>
          ) : null}
          {insertError ? <p role="alert">{insertError}</p> : null}
          <button
            type="submit"
            className="button button-primary"
            disabled={insertSubmitting}
          >
            {insertSubmitting ? "Importing…" : "Insert"}
          </button>
        </form>
      ) : null}

      {equationDialog ? (
        <form
          className="markdown-equation-dialog"
          role="dialog"
          aria-label="Insert equation"
          onSubmit={(event) => {
            event.preventDefault();
            submitEquation();
          }}
        >
          <div>
            <strong>Insert equation</strong>
            <button
              type="button"
              aria-label="Close equation dialog"
              onClick={() => {
                setEquationDialog(undefined);
              }}
            >
              ×
            </button>
          </div>
          <label>
            Equation type
            <select
              aria-label="Equation type"
              value={equationDialog.kind}
              onChange={(event) => {
                setEquationDialog({
                  ...equationDialog,
                  kind: event.currentTarget.value as EquationDialog["kind"],
                });
              }}
            >
              <option value="inlineMath">Inline</option>
              <option value="mathBlock">Display</option>
            </select>
          </label>
          <label>
            TeX source
            <textarea
              autoFocus
              aria-label="TeX source"
              value={equationDialog.value}
              placeholder="e.g. \\frac{a}{b}"
              onChange={(event) => {
                setEquationDialog({
                  ...equationDialog,
                  value: event.currentTarget.value,
                });
              }}
            />
          </label>
          <button type="submit" className="button button-primary">
            Insert equation
          </button>
        </form>
      ) : null}

      {(() => {
        const sourceEditor = (
          <Editor
            height="100%"
            language="markdown"
            theme="vs"
            value={sourceValue}
            onChange={(next) => {
              updateSource(next ?? "");
            }}
            options={{
              automaticLayout: true,
              readOnly,
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbers: "on",
              lineNumbersMinChars: 3,
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 12,
              renderLineHighlight: "none",
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              fontFamily: '"SFMono-Regular", Consolas, monospace',
              fontSize: 13,
              lineHeight: 22,
              padding: { top: 16, bottom: 48 },
              scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
            }}
          />
        );
        return (
          <div className="markdown-editor-canvas" data-mode={mode}>
            {mode === "rich" ? <EditorContent editor={editor} /> : null}
            {mode === "source" ? sourceEditor : null}
            {mode === "split" ? (
              <Group
                orientation={
                  splitOrientation === "vertical" ? "horizontal" : "vertical"
                }
                className="markdown-split"
                data-orientation={splitOrientation}
              >
                <Panel minSize="20%">
                  <div className="markdown-split-rich">
                    <EditorContent editor={editor} />
                  </div>
                </Panel>
                <Separator
                  className="markdown-split-handle"
                  aria-label="Resize Markdown split"
                />
                <Panel minSize="20%">
                  <div className="markdown-split-source">{sourceEditor}</div>
                </Panel>
              </Group>
            ) : null}
          </div>
        );
      })()}
    </section>
  );
}
