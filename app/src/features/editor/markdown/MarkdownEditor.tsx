import MonacoEditor from "@monaco-editor/react";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor as TiptapEditor,
} from "@tiptap/react";
import {
  Bold,
  Code2,
  FileCode2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Maximize2,
  Minus,
  Pilcrow,
  Quote,
  Sigma,
  Strikethrough,
  Table2,
  Redo2,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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

type SlashCommandId =
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "divider"
  | "codeBlock"
  | "image"
  | "link"
  | "inlineMath"
  | "mathBlock"
  | "table";

type SlashCommand = {
  id: SlashCommandId;
  group: "Basic blocks" | "Media" | "Advanced";
  label: string;
  description: string;
  keywords: string;
  icon: ReactNode;
};

type SlashMenuState = {
  from: number;
  query: string;
  top: number;
  left: number;
};

type TablePickerState = {
  rows: number;
  columns: number;
  top: number;
  left: number;
};

const TABLE_PICKER_SIZE = 9;

const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: "text",
    group: "Basic blocks",
    label: "Text",
    description: "Start writing with plain text",
    keywords: "plain paragraph",
    icon: <Pilcrow size={18} />,
  },
  {
    id: "heading1",
    group: "Basic blocks",
    label: "Heading 1",
    description: "Big section heading",
    keywords: "h1 title",
    icon: <Heading1 size={18} />,
  },
  {
    id: "heading2",
    group: "Basic blocks",
    label: "Heading 2",
    description: "Medium section heading",
    keywords: "h2 subtitle",
    icon: <Heading2 size={18} />,
  },
  {
    id: "heading3",
    group: "Basic blocks",
    label: "Heading 3",
    description: "Small section heading",
    keywords: "h3 subtitle",
    icon: <Heading3 size={18} />,
  },
  {
    id: "bulletList",
    group: "Basic blocks",
    label: "Bulleted list",
    description: "Create a simple bulleted list",
    keywords: "bullet unordered list",
    icon: <List size={18} />,
  },
  {
    id: "orderedList",
    group: "Basic blocks",
    label: "Numbered list",
    description: "Create a list with numbering",
    keywords: "number ordered list",
    icon: <ListOrdered size={18} />,
  },
  {
    id: "taskList",
    group: "Basic blocks",
    label: "To-do list",
    description: "Track a task with a checkbox",
    keywords: "todo task checkbox check",
    icon: <ListTodo size={18} />,
  },
  {
    id: "blockquote",
    group: "Basic blocks",
    label: "Quote",
    description: "Capture a quotation",
    keywords: "quote blockquote",
    icon: <Quote size={18} />,
  },
  {
    id: "divider",
    group: "Basic blocks",
    label: "Divider",
    description: "Visually divide blocks",
    keywords: "divider horizontal rule line",
    icon: <Minus size={18} />,
  },
  {
    id: "image",
    group: "Media",
    label: "Image",
    description: "Upload or embed an image",
    keywords: "image photo picture upload heic",
    icon: <ImageIcon size={18} />,
  },
  {
    id: "link",
    group: "Media",
    label: "Link",
    description: "Link to a page or URL",
    keywords: "link url bookmark",
    icon: <Link size={18} />,
  },
  {
    id: "codeBlock",
    group: "Advanced",
    label: "Code",
    description: "Capture a code snippet",
    keywords: "code block snippet fence",
    icon: <FileCode2 size={18} />,
  },
  {
    id: "inlineMath",
    group: "Advanced",
    label: "Inline equation",
    description: "Insert a TeX formula in text",
    keywords: "equation formula math latex tex inline",
    icon: <Sigma size={18} />,
  },
  {
    id: "mathBlock",
    group: "Advanced",
    label: "Block equation",
    description: "Display a TeX formula on its own line",
    keywords: "equation formula math latex tex display block",
    icon: <Sigma size={18} />,
  },
  {
    id: "table",
    group: "Advanced",
    label: "Table",
    description: "Add a simple table",
    keywords: "table grid rows columns",
    icon: <Table2 size={18} />,
  },
];

function filterSlashCommands(query: string): readonly SlashCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) =>
    `${command.label} ${command.keywords}`.toLowerCase().includes(normalized),
  );
}

function slashMenuState(editor: TiptapEditor): SlashMenuState | undefined {
  const { selection } = editor.state;
  if (!selection.empty || !selection.$from.parent.isTextblock) return undefined;
  const text = selection.$from.parent.textBetween(
    0,
    selection.$from.parentOffset,
    "\0",
    "\0",
  );
  const match = /(?:^|\s)\/([^/\s]*)$/.exec(text);
  if (!match) return undefined;
  const query = match[1] ?? "";
  const from = selection.from - query.length - 1;
  const coordinates = editor.view.coordsAtPos(selection.from);
  const menuHeight = 390;
  const top =
    window.innerHeight - coordinates.bottom >= 260
      ? coordinates.bottom + 6
      : Math.max(12, coordinates.top - menuHeight);
  return {
    from,
    query,
    top,
    left: Math.max(12, Math.min(coordinates.left, window.innerWidth - 340)),
  };
}

function validTarget(value: string): boolean {
  const target = value.trim();
  if (!target || /\s/.test(target)) return false;
  if (/^(https?:\/\/|mailto:)/i.test(target)) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return false;
  return true;
}

function imageUploadFile(files: FileList): File | undefined {
  return Array.from(files).find(
    (file) =>
      file.type.startsWith("image/") ||
      /\.(?:gif|heic|heif|jpe?g|png|webp)$/i.test(file.name),
  );
}

function imageAltText(file: File): string {
  return file.name.replace(/\.[^.]+$/, "");
}

function tableMenuPosition(editor: TiptapEditor) {
  const dom = editor.view.domAtPos(editor.state.selection.from).node;
  const element = dom instanceof HTMLElement ? dom : dom.parentElement;
  const rect = element?.closest("table")?.getBoundingClientRect();
  return {
    top: Math.max(12, (rect?.top ?? 50) - 38),
    left: Math.max(12, rect?.left ?? 12),
  };
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
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>();
  const [slashSelection, setSlashSelection] = useState(0);
  const [tablePicker, setTablePicker] = useState<TablePickerState>();
  const slashMenuId = useId();
  const dismissedSlashFrom = useRef<number | undefined>(undefined);
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
  const syncSlashMenu = useCallback((tiptapEditor: TiptapEditor) => {
    const next = slashMenuState(tiptapEditor);
    if (!next) {
      dismissedSlashFrom.current = undefined;
      setSlashMenu(undefined);
      return;
    }
    if (dismissedSlashFrom.current === next.from) return;
    setSlashMenu(next);
  }, []);
  const editor = useEditor({
    extensions: markdownExtensions,
    editable: !readOnly,
    content: editorDocumentToTiptap(initialDocument),
    editorProps: {
      attributes: {
        "data-placeholder": "Type '/' for commands",
        spellcheck: "true",
      },
    },
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
      syncSlashMenu(tiptapEditor);
    },
    onSelectionUpdate: ({ editor: tiptapEditor }) => {
      syncSlashMenu(tiptapEditor);
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
          .updateAttributes("codeBlock", { language: "plain text" })
          .run();
    });
  };

  const insertTable = (rows: number, columns: number) => {
    if (richDisabled) return;
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols: columns, withHeaderRow: true })
      .run();
    setTablePicker(undefined);
  };

  const insertImportedImage = useCallback(
    async (file: File, alt: string, position?: number): Promise<boolean> => {
      if (!onImportImage || richDisabled) return false;
      const source = (await onImportImage(file, alt))?.trim() ?? "";
      if (!source || /^data:/i.test(source) || /;base64,/i.test(source))
        return false;
      const image = { type: "image", attrs: { src: source, alt } };
      if (position === undefined)
        editor.chain().focus().insertContent(image).run();
      else editor.chain().focus().insertContentAt(position, image).run();
      return true;
    },
    [editor, onImportImage, richDisabled],
  );

  const submitInsert = async () => {
    if (!insertDialog) return;
    if (insertDialog.kind === "image" && insertDialog.file) {
      if (!onImportImage) {
        setInsertError("Local image import is unavailable.");
        return;
      }
      setInsertSubmitting(true);
      try {
        if (
          !(await insertImportedImage(
            insertDialog.file,
            insertDialog.label.trim(),
          ))
        ) {
          setInsertError("The local image could not be imported.");
          return;
        }
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

  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashMenu?.query ?? ""),
    [slashMenu?.query],
  );

  const runSlashCommand = useCallback(
    (command: SlashCommand) => {
      if (!slashMenu || richDisabled) return;
      const to = editor.state.selection.from;
      setSlashMenu(undefined);
      dismissedSlashFrom.current = undefined;
      editor.chain().focus().deleteRange({ from: slashMenu.from, to }).run();

      switch (command.id) {
        case "text":
          editor.chain().focus().setParagraph().run();
          break;
        case "heading1":
        case "heading2":
        case "heading3":
          editor
            .chain()
            .focus()
            .setHeading({
              level: Number(command.id.at(-1)) as 1 | 2 | 3,
            })
            .run();
          break;
        case "bulletList":
          editor.chain().focus().toggleBulletList().run();
          break;
        case "orderedList":
          editor.chain().focus().toggleOrderedList().run();
          break;
        case "taskList":
          editor.chain().focus().toggleTaskList().run();
          break;
        case "blockquote":
          editor.chain().focus().toggleBlockquote().run();
          break;
        case "divider":
          editor.chain().focus().setHorizontalRule().run();
          break;
        case "codeBlock":
          editor.chain().focus().setCodeBlock({ language: "plain text" }).run();
          break;
        case "image":
        case "link":
          setInsertDialog({ kind: command.id, url: "", label: "" });
          setInsertError("");
          break;
        case "inlineMath":
        case "mathBlock":
          setEquationDialog({ kind: command.id, value: "" });
          break;
        case "table":
          setTablePicker({
            rows: 3,
            columns: 3,
            top: slashMenu.top,
            left: slashMenu.left,
          });
          break;
      }
    },
    [editor, richDisabled, slashMenu],
  );

  useEffect(() => {
    setSlashSelection(0);
  }, [slashMenu?.query]);

  useEffect(() => {
    if (!slashMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissedSlashFrom.current = slashMenu.from;
        setSlashMenu(undefined);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (!filteredSlashCommands.length) return;
        setSlashSelection((current) => {
          const offset = event.key === "ArrowDown" ? 1 : -1;
          return (
            (current + offset + filteredSlashCommands.length) %
            filteredSlashCommands.length
          );
        });
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        filteredSlashCommands.length
      ) {
        event.preventDefault();
        event.stopPropagation();
        const command =
          filteredSlashCommands[
            Math.min(slashSelection, filteredSlashCommands.length - 1)
          ];
        if (command) runSlashCommand(command);
      }
    };
    editor.view.dom.addEventListener("keydown", handleKeyDown, true);
    return () => {
      editor.view.dom.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    editor,
    filteredSlashCommands,
    runSlashCommand,
    slashMenu,
    slashSelection,
  ]);

  useEffect(() => {
    const dom = editor.view.dom;
    const pasteImage = (event: ClipboardEvent) => {
      const file = event.clipboardData
        ? imageUploadFile(event.clipboardData.files)
        : undefined;
      if (!file || richDisabled || !onImportImage) return;
      event.preventDefault();
      const position = editor.state.selection.from;
      void insertImportedImage(file, imageAltText(file), position).catch(
        () => undefined,
      );
    };
    const dropImage = (event: DragEvent) => {
      const file = event.dataTransfer
        ? imageUploadFile(event.dataTransfer.files)
        : undefined;
      if (!file || richDisabled || !onImportImage) return;
      event.preventDefault();
      const position = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      })?.pos;
      void insertImportedImage(file, imageAltText(file), position).catch(
        () => undefined,
      );
    };
    const allowImageDrop = (event: DragEvent) => {
      if (
        event.dataTransfer &&
        event.dataTransfer.types.includes("Files") &&
        !richDisabled
      )
        event.preventDefault();
    };
    dom.addEventListener("paste", pasteImage);
    dom.addEventListener("drop", dropImage);
    dom.addEventListener("dragover", allowImageDrop);
    return () => {
      dom.removeEventListener("paste", pasteImage);
      dom.removeEventListener("drop", dropImage);
      dom.removeEventListener("dragover", allowImageDrop);
    };
  }, [editor, insertImportedImage, onImportImage, richDisabled]);

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
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setTablePicker({
                rows: 3,
                columns: 3,
                top: rect.bottom + 6,
                left: Math.max(
                  12,
                  Math.min(rect.left, window.innerWidth - 250),
                ),
              });
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

      {!richDisabled && tableActive ? (
        <div
          className="markdown-table-menu"
          role="toolbar"
          aria-label="Table controls"
          style={tableMenuPosition(editor)}
        >
          <button
            type="button"
            aria-label="Add row after"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            + Row
          </button>
          <button
            type="button"
            aria-label="Delete row"
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            − Row
          </button>
          <button
            type="button"
            aria-label="Add column after"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            + Column
          </button>
          <button
            type="button"
            aria-label="Delete column"
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            − Column
          </button>
          <button
            type="button"
            aria-label="Delete table"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            Delete
          </button>
        </div>
      ) : null}

      {tablePicker ? (
        <div
          className="markdown-table-picker"
          role="dialog"
          aria-label="Choose table size"
          style={{ top: tablePicker.top, left: tablePicker.left }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setTablePicker(undefined);
          }}
        >
          <header>
            <strong>
              {tablePicker.columns} × {tablePicker.rows} table
            </strong>
            <button
              type="button"
              aria-label="Close table size picker"
              onClick={() => {
                setTablePicker(undefined);
              }}
            >
              ×
            </button>
          </header>
          <div className="markdown-table-picker-grid">
            {Array.from(
              { length: TABLE_PICKER_SIZE * TABLE_PICKER_SIZE },
              (_, index) => {
                const row = Math.floor(index / TABLE_PICKER_SIZE) + 1;
                const column = (index % TABLE_PICKER_SIZE) + 1;
                return (
                  <button
                    key={`${String(column)}-${String(row)}`}
                    type="button"
                    aria-label={`Insert ${String(column)} × ${String(row)} table`}
                    data-active={
                      row <= tablePicker.rows && column <= tablePicker.columns
                    }
                    autoFocus={row === 3 && column === 3}
                    onFocus={() => {
                      setTablePicker((current) =>
                        current &&
                        (current.rows !== row || current.columns !== column)
                          ? { ...current, rows: row, columns: column }
                          : current,
                      );
                    }}
                    onPointerEnter={() => {
                      setTablePicker((current) =>
                        current
                          ? { ...current, rows: row, columns: column }
                          : current,
                      );
                    }}
                    onClick={() => {
                      insertTable(row, column);
                    }}
                  />
                );
              },
            )}
          </div>
        </div>
      ) : null}

      {slashMenu ? (
        <div
          className="markdown-slash-menu"
          role="menu"
          aria-label="Insert block"
          style={{ top: slashMenu.top, left: slashMenu.left }}
        >
          <div className="markdown-slash-menu-query">
            <span>/</span>
            <strong>{slashMenu.query || "Type to filter"}</strong>
          </div>
          <div className="markdown-slash-menu-results">
            {(["Basic blocks", "Media", "Advanced"] as const).map((group) => {
              const commands = filteredSlashCommands.filter(
                (command) => command.group === group,
              );
              if (!commands.length) return null;
              return (
                <section key={group} aria-label={group}>
                  <p>{group}</p>
                  {commands.map((command) => {
                    const index = filteredSlashCommands.indexOf(command);
                    return (
                      <button
                        id={`${slashMenuId}-${command.id}`}
                        key={command.id}
                        type="button"
                        role="menuitem"
                        data-selected={index === slashSelection}
                        onMouseEnter={() => {
                          setSlashSelection(index);
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          runSlashCommand(command);
                        }}
                      >
                        <span>{command.icon}</span>
                        <span>
                          <strong>{command.label}</strong>
                          <small>{command.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
            {!filteredSlashCommands.length ? (
              <p className="markdown-slash-menu-empty">No blocks found</p>
            ) : null}
          </div>
          <footer>
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc dismiss</span>
          </footer>
        </div>
      ) : null}

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
                accept="image/*,.heic,.heif"
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
          <MonacoEditor
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
