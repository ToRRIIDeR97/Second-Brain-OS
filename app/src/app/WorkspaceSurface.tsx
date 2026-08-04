import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CalendarPlus, Command, FilePlus2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ConfirmDialog } from "../components/common/ModalDialog";
import type { AgentWorkspaceState } from "../features/agents";
import {
  bytesToBase64,
  createImageAttachmentPlacement,
  imageDataUrl,
  MAX_IMAGE_BYTES,
  resolveImageAttachmentPath,
} from "../features/editor/markdown/attachments";
import { NewNoteDialog } from "../features/editor/markdown/NewNoteDialog";
import type { EditorTabState } from "../features/editor/source";
import type {
  GraphCommand,
  GraphCommandContext,
  GraphPage,
  GraphSelectionContext,
} from "../features/graph";
import { KnowledgeSearchModal, type SearchResponse } from "../features/search";
import type { SourceControlChange } from "../features/source-control";
import type {
  CommandResult,
  GitWorkspaceDiff,
  GitWorkspaceStatus,
  IpcClient,
  WorkspaceDirectoryEntry,
  WorkspaceKind,
  WorkspaceSummary,
  WorkspaceTrustLevel,
} from "../lib/ipc";
import type { Activity } from "../state/shell";
import { usePreferences } from "../state/preferences";
import { useTheme } from "../state/theme";
import { useWorkspace } from "../state/workspace";

const AgentWorkspace = lazy(async () => ({
  default: (await import("../features/agents")).AgentWorkspace,
}));
const MarkdownEditor = lazy(async () => ({
  default: (await import("../features/editor/markdown")).MarkdownEditor,
}));
const SourceEditor = lazy(async () => ({
  default: (await import("../features/editor/source")).SourceEditor,
}));
const FocusedGraph = lazy(async () => ({
  default: (await import("../features/graph")).FocusedGraph,
}));
const SourceControlWorkspace = lazy(async () => ({
  default: (await import("../features/source-control")).SourceControlWorkspace,
}));
const LocalPlanner = lazy(async () => ({
  default: (await import("../features/planner")).LocalPlanner,
}));
const ReferenceCalendar = lazy(async () => ({
  default: (await import("../features/planner/ReferenceCalendar"))
    .ReferenceCalendar,
}));

type OpenDocument = {
  workspaceId: string;
  relativePath: string;
  content: string;
  baseContent: string;
  baseHash: string;
  baseRevisionId: string;
  encoding: "utf8" | "utf8Bom" | "unsupported";
  eol: "lf" | "crlf" | "mixed";
};

const emptySearch: SearchResponse = { results: [], structuredPlan: "" };

function nameFromRoot(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).at(-1) || "Workspace";
}

function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function fileLanguage(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    rs: "rust",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    css: "css",
    html: "html",
    sh: "shell",
    py: "python",
  };
  return languages[extension ?? ""] ?? "plaintext";
}

function isMarkdown(path: string) {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function isSuccess<T>(
  result: CommandResult<T>,
): result is Extract<CommandResult<T>, { ok: true }> {
  return result.ok;
}

function errorMessage<T>(result: CommandResult<T>) {
  return result.ok ? "" : result.error.message;
}

function EmptyWorkspace({
  onRegister,
  busy,
  error,
}: {
  onRegister: (input: {
    name: string;
    rootPath: string;
    kind: WorkspaceKind;
    trustLevel: WorkspaceTrustLevel;
  }) => void;
  busy: boolean;
  error: string;
}) {
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [trustLevel, setTrustLevel] = useState<WorkspaceTrustLevel>("trusted");
  const [folderPickerBusy, setFolderPickerBusy] = useState(false);
  const [folderPickerError, setFolderPickerError] = useState("");

  const chooseFolder = async () => {
    setFolderPickerBusy(true);
    setFolderPickerError("");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select workspace folder",
      });
      if (typeof selected !== "string" || !selected) return;
      setRootPath(selected);
      setName((current) => current.trim() || nameFromRoot(selected));
    } catch (cause) {
      setFolderPickerError(
        cause instanceof Error
          ? cause.message
          : "The folder picker could not be opened.",
      );
    } finally {
      setFolderPickerBusy(false);
    }
  };

  return (
    <section className="workspace-onboarding" aria-labelledby="workspace-title">
      <p className="eyebrow">Get started</p>
      <h1 id="workspace-title">Open a local workspace</h1>
      <p>
        Register a folder to browse, edit, search, inspect, and review its
        contents. The app keeps all subsequent file operations scoped to this
        workspace identity.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onRegister({
            name: name.trim() || nameFromRoot(rootPath),
            rootPath: rootPath.trim(),
            kind: "brain",
            trustLevel,
          });
        }}
      >
        <label>
          Workspace folder
          <button
            className="button"
            type="button"
            onClick={() => void chooseFolder()}
            disabled={busy || folderPickerBusy}
          >
            {folderPickerBusy
              ? "Choosing folder…"
              : rootPath
                ? "Choose a different folder"
                : "Choose folder…"}
          </button>
          <output
            className="workspace-folder-selection"
            aria-live="polite"
            aria-label="Selected workspace folder"
          >
            {rootPath || "No folder selected yet."}
          </output>
        </label>
        <label>
          Workspace name
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="My Brain"
          />
        </label>
        <label>
          Trust level
          <select
            value={trustLevel}
            onChange={(event) => {
              setTrustLevel(event.target.value as WorkspaceTrustLevel);
            }}
          >
            <option value="untrusted">Untrusted (read-only)</option>
            <option value="trusted_read_only">Trusted read-only</option>
            <option value="trusted">
              Trusted (editing and terminal enabled)
            </option>
            <option value="restricted">Restricted (read-only)</option>
          </select>
        </label>
        <button
          className="button button-primary"
          type="submit"
          disabled={busy || !rootPath}
        >
          {busy ? "Opening…" : "Open workspace"}
        </button>
      </form>
      {error || folderPickerError ? (
        <p role="alert">{error || folderPickerError}</p>
      ) : null}
    </section>
  );
}

function FileBrowser({
  workspace,
  directory,
  entries,
  error,
  onDirectory,
  onOpen,
  onContextAction,
}: {
  workspace: WorkspaceSummary;
  directory: string;
  entries: WorkspaceDirectoryEntry[];
  error: string;
  onDirectory: (path: string) => void;
  onOpen: (path: string) => void;
  onContextAction: (
    action: "terminal" | "codex" | "claude",
    entry: WorkspaceDirectoryEntry,
  ) => void;
}) {
  const [menu, setMenu] = useState<{
    entry: WorkspaceDirectoryEntry;
    x: number;
    y: number;
  }>();
  return (
    <section className="file-browser" aria-labelledby="files-title">
      <header>
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1 id="files-title">{directory || "Workspace files"}</h1>
        </div>
        {directory ? (
          <button
            className="button button-small"
            type="button"
            onClick={() => {
              onDirectory(parentPath(directory));
            }}
          >
            Up one level
          </button>
        ) : null}
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : entries.length ? (
        <ul aria-label="Workspace files">
          {entries.map((entry) => (
            <li key={entry.relativePath}>
              <button
                type="button"
                onClick={() => {
                  if (entry.kind === "directory")
                    onDirectory(entry.relativePath);
                  else onOpen(entry.relativePath);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({
                    entry,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                <span aria-hidden="true">
                  {entry.kind === "directory" ? "▸" : "◌"}
                </span>
                <strong>{entry.name}</strong>
                <small>
                  {entry.kind === "file"
                    ? `${String(entry.sizeBytes)} bytes`
                    : entry.kind}
                  {entry.ignored ? " · ignored" : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>This folder is empty or contains no visible entries.</p>
      )}
      {menu ? (
        <div
          className="workspace-context-menu"
          role="menu"
          aria-label={`Actions for ${menu.entry.name}`}
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenu(undefined);
          }}
        >
          {(
            [
              ["terminal", "Open terminal here"],
              ["codex", "Open Codex here"],
              ["claude", "Open Claude here"],
            ] as const
          ).map(([action, label]) => (
            <button
              type="button"
              role="menuitem"
              key={action}
              onClick={() => {
                onContextAction(action, menu.entry);
                setMenu(undefined);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DocumentEditor({
  document,
  canWrite,
  saving,
  onChange,
  onSave,
  onImportImage,
  resolveLocalImage,
}: {
  document: OpenDocument;
  canWrite: boolean;
  saving: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
  onImportImage: (file: File, alt: string) => Promise<string | undefined>;
  resolveLocalImage: (source: string) => Promise<string | undefined>;
}) {
  const tab: EditorTabState = {
    resourceId: `${document.workspaceId}:${document.relativePath}`,
    modelUri: `second-brain://${document.workspaceId}/${document.relativePath}`,
    workspaceId: document.workspaceId,
    relativePath: document.relativePath,
    language: fileLanguage(document.relativePath),
    encoding: document.encoding,
    eol: document.eol,
    status: document.content === document.baseContent ? "clean" : "dirty",
    content: document.content,
    baseHash: document.baseHash,
    baseRevisionId: document.baseRevisionId,
    baseContent: document.baseContent,
    externalChange: "none",
    openRequest: 1,
  };
  return (
    <section
      className="document-editor"
      aria-label={`Editor for ${document.relativePath}`}
    >
      <header className="document-editor-header">
        <div className="document-heading">
          <nav className="document-breadcrumb" aria-label="Document path">
            {document.relativePath.split("/").map((segment, index, path) => (
              <span key={`${segment}-${String(index)}`}>
                <strong>{segment}</strong>
                {index < path.length - 1 ? <i aria-hidden="true">›</i> : null}
              </span>
            ))}
          </nav>
          <p className="document-save-state" role="status">
            {!canWrite
              ? "Read-only workspace"
              : document.content === document.baseContent
                ? "Saved"
                : "Unsaved changes"}
          </p>
        </div>
        <button
          className="button button-primary"
          type="button"
          disabled={!canWrite || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </header>
      {isMarkdown(document.relativePath) ? (
        <MarkdownEditor
          value={document.content}
          readOnly={!canWrite}
          onChange={onChange}
          onImportImage={onImportImage}
          resolveLocalImage={resolveLocalImage}
        />
      ) : (
        <SourceEditor tab={tab} readOnly={!canWrite} onChange={onChange} />
      )}
    </section>
  );
}

export function WorkspaceSurface({
  activity,
  ipc,
  onOpenPalette,
  searchOpen = false,
  onCloseSearch = () => undefined,
  onNavigate = () => undefined,
  noteRequest,
  fileRequest,
  saveRequest,
  onOpenTerminal = () => undefined,
  onDocumentOpened = () => undefined,
  onDocumentDirtyChange = () => undefined,
  onDocumentSaved = () => undefined,
  onGitDiffOpened = () => undefined,
  onGraphSelectionContextChange = () => undefined,
}: {
  activity: Activity;
  ipc: IpcClient;
  onOpenPalette: () => void;
  searchOpen?: boolean;
  onCloseSearch?: () => void;
  onNavigate?: (activity: Activity) => void;
  noteRequest?: { key: number; relativePath: string } | undefined;
  fileRequest?: { key: number; relativePath: string } | undefined;
  saveRequest?: { key: number; resourceId: string } | undefined;
  onOpenTerminal?: (request: {
    workspaceId: string;
    relativePath: string;
    preset: "shell" | "codex" | "claude";
  }) => void;
  onDocumentOpened?: (resource: {
    workspaceId: string;
    relativePath: string;
    title: string;
    activity: "knowledge" | "files";
  }) => void;
  onDocumentDirtyChange?: (resourceId: string, dirty: boolean) => void;
  onDocumentSaved?: (resourceId: string) => void;
  onGitDiffOpened?: (resource: {
    workspaceId: string;
    path: string;
    title: string;
  }) => void;
  onGraphSelectionContextChange?: (
    context: GraphSelectionContext | undefined,
  ) => void;
}) {
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<WorkspaceDirectoryEntry[]>([]);
  const [document, setDocument] = useState<OpenDocument>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<string>();
  const [bridgeResult, setBridgeResult] =
    useState<CommandResult<string> | null>(null);
  const [search, setSearch] = useState<SearchResponse>(emptySearch);
  const [graph, setGraph] = useState<GraphPage>({
    nodes: [],
    edges: [],
    truncated: false,
  });
  const [git, setGit] = useState<GitWorkspaceStatus>();
  const [gitDiff, setGitDiff] = useState<{
    path: string;
    data: GitWorkspaceDiff;
  }>();
  const [agents, setAgents] = useState<AgentWorkspaceState>({
    workspaceId: "",
    sessions: [],
    activeSessionId: null,
  });
  const {
    workspaces,
    activeWorkspace: workspace,
    activeWorkspaceId,
    loading,
    error: workspaceError,
    registerWorkspace,
    refreshWorkspaces,
  } = useWorkspace();
  const { mode: themeMode, resolvedTheme, setMode: setThemeMode } = useTheme();
  const { editorAutosave, setEditorAutosave } = usePreferences();
  const checkDesktopBridge = useCallback(async () => {
    setBridgeResult(await ipc.system.ping());
  }, [ipc]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDirectory("");
      setDocument(undefined);
      setEntries([]);
      setError("");
      setGitDiff(undefined);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeWorkspaceId]);

  const refreshDirectory = useCallback(async () => {
    if (!workspace || workspace.kind === "collection") return;
    const result = await ipc.workspaces.listDirectory({
      workspaceId: workspace.id,
      relativePath: directory,
    });
    if (!isSuccess(result)) {
      setError(errorMessage(result));
      return;
    }
    setEntries(result.data.entries);
    setError("");
  }, [directory, ipc, workspace]);

  useEffect(() => {
    const refresh = () => void refreshDirectory();
    const timer = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 2_500);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshDirectory]);

  const openDocument = useCallback(
    async (relativePath: string) => {
      if (!workspace) return;
      const result = await ipc.files.readText({
        workspaceId: workspace.id,
        relativePath,
      });
      if (!isSuccess(result)) {
        setError(errorMessage(result));
        return;
      }
      setDocument({
        workspaceId: workspace.id,
        relativePath,
        content: result.data.content,
        baseContent: result.data.content,
        baseHash: result.data.contentHash,
        baseRevisionId: result.data.revisionId,
        encoding: result.data.encoding,
        eol: result.data.eol,
      });
      onDocumentOpened({
        workspaceId: workspace.id,
        relativePath,
        title: relativePath.split("/").at(-1) ?? relativePath,
        activity: isMarkdown(relativePath) ? "knowledge" : "files",
      });
      setError("");
    },
    [ipc, onDocumentOpened, workspace],
  );

  const importImage = useCallback(
    async (file: File, _alt: string): Promise<string | undefined> => {
      void _alt;
      if (!workspace || !document || !workspace.canWrite) return undefined;
      if (
        !Number.isSafeInteger(file.size) ||
        file.size <= 0 ||
        file.size > MAX_IMAGE_BYTES
      ) {
        setError("Images must be between 1 byte and 10 MB.");
        return undefined;
      }
      const placement = createImageAttachmentPlacement(
        document.relativePath,
        file.name,
        file.type,
      );
      if (!placement) {
        setError("Use a PNG, JPEG, GIF, or WebP image.");
        return undefined;
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        setError("The selected image could not be read.");
        return undefined;
      }
      if (bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) {
        setError("The selected image is too large.");
        return undefined;
      }
      let bytesBase64: string;
      try {
        bytesBase64 = bytesToBase64(bytes);
      } catch {
        setError("The selected image could not be encoded.");
        return undefined;
      }
      const result = await ipc.files.createAttachment({
        path: {
          workspaceId: document.workspaceId,
          relativePath: placement.workspaceRelativePath,
        },
        bytesBase64,
      });
      if (!isSuccess(result)) {
        setError(errorMessage(result));
        return undefined;
      }
      setError("");
      return placement.markdownPath;
    },
    [document, ipc, workspace],
  );

  const resolveLocalImage = useCallback(
    async (source: string): Promise<string | undefined> => {
      if (!workspace || !document) return undefined;
      const relativePath = resolveImageAttachmentPath(
        document.relativePath,
        source,
      );
      if (!relativePath) return undefined;
      const result = await ipc.files.readAttachment({
        workspaceId: document.workspaceId,
        relativePath,
      });
      if (!isSuccess(result)) {
        setError(errorMessage(result));
        return undefined;
      }
      const dataUrl = imageDataUrl(
        result.data.base64,
        result.data.mediaType,
        result.data.sizeBytes,
      );
      if (!dataUrl) {
        setError("The workspace returned an invalid image attachment.");
        return undefined;
      }
      return dataUrl;
    },
    [document, ipc, workspace],
  );

  const saveDocument = useCallback(async () => {
    if (!document || !workspace) return;
    const submittedContent = document.content;
    setSaving(true);
    const result = await ipc.files.writeText({
      path: {
        workspaceId: document.workspaceId,
        relativePath: document.relativePath,
      },
      content: submittedContent,
      baseHash: document.baseHash,
      baseContent: document.baseContent,
      actor: { actorType: "user", actorId: "desktop" },
      correlationId: `ui-${Date.now().toString(36)}`,
    });
    setSaving(false);
    if (!isSuccess(result)) {
      setError(errorMessage(result));
      return;
    }
    setDocument((current) =>
      current
        ? {
            ...current,
            baseContent: submittedContent,
            baseHash: result.data.contentHash,
            baseRevisionId: result.data.revisionId,
          }
        : current,
    );
    onDocumentDirtyChange(
      `file:${document.workspaceId}:${document.relativePath}`,
      false,
    );
    onDocumentSaved(`file:${document.workspaceId}:${document.relativePath}`);
    void refreshDirectory();
  }, [
    document,
    ipc,
    onDocumentDirtyChange,
    onDocumentSaved,
    refreshDirectory,
    workspace,
  ]);

  useEffect(() => {
    if (
      !editorAutosave ||
      !workspace?.canWrite ||
      !document ||
      saving ||
      document.content === document.baseContent
    )
      return;
    const timer = window.setTimeout(() => void saveDocument(), 1_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [document, editorAutosave, saveDocument, saving, workspace?.canWrite]);

  useEffect(() => {
    if (!saveRequest || !document || saving) return;
    const resourceId = `file:${document.workspaceId}:${document.relativePath}`;
    if (saveRequest.resourceId !== resourceId) return;
    const timer = window.setTimeout(() => {
      void saveDocument();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [document, saveDocument, saveRequest, saving]);

  const searchEntries = async (query: string) => {
    if (!workspace) return;
    const result = await ipc.knowledge.search(workspace.id, query);
    if (!isSuccess(result)) {
      setSearch({ ...emptySearch, error: errorMessage(result) });
      return;
    }
    setSearch(result.data);
  };

  const createNote = useCallback(
    async (relativePath: string, title: string) => {
      if (!workspace) return;
      const existing = await ipc.files.readText({
        workspaceId: workspace.id,
        relativePath,
      });
      if (isSuccess(existing)) {
        void openDocument(relativePath);
        onNavigate("knowledge");
        return;
      }
      const result = await ipc.files.writeText({
        path: { workspaceId: workspace.id, relativePath },
        content: `# ${title}\n\n`,
        actor: { actorType: "user", actorId: "desktop" },
        correlationId: `ui-${Date.now().toString(36)}`,
      });
      if (!isSuccess(result)) {
        setError(errorMessage(result));
        return;
      }
      void refreshDirectory();
      void openDocument(relativePath);
      onNavigate("knowledge");
    },
    [ipc, onNavigate, openDocument, refreshDirectory, workspace],
  );

  const createDailyNote = useCallback(() => {
    const date = new Date().toLocaleDateString("en-CA");
    void createNote("notes/today.md", date);
  }, [createNote]);

  useEffect(() => {
    if (!noteRequest) return;
    const timer = window.setTimeout(() => {
      if (noteRequest.relativePath === "notes/today.md") createDailyNote();
      else {
        void openDocument(noteRequest.relativePath);
        onNavigate("knowledge");
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [createDailyNote, noteRequest, onNavigate, openDocument]);

  useEffect(() => {
    if (!fileRequest) return;
    const timer = window.setTimeout(() => {
      void openDocument(fileRequest.relativePath);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [fileRequest, openDocument]);

  const refreshGit = useCallback(async () => {
    if (!workspace) return;
    const result = await ipc.git.status(workspace.id);
    if (isSuccess(result)) setGit(result.data);
    else setError(errorMessage(result));
  }, [ipc, workspace]);

  const mutateGit = useCallback(
    async (operation: "stage" | "unstage" | "discard", path: string) => {
      if (!workspace) return;
      const result =
        operation === "stage"
          ? await ipc.git.stage(workspace.id, [path])
          : operation === "unstage"
            ? await ipc.git.unstage(workspace.id, [path])
            : await ipc.git.discard(workspace.id, [path], true);
      if (!isSuccess(result)) setError(errorMessage(result));
      else void refreshGit();
    },
    [ipc, refreshGit, workspace],
  );

  const openGitDiff = useCallback(
    async (path: string, staged: boolean) => {
      if (!workspace) return;
      const result = await ipc.git.diff(workspace.id, staged, [path]);
      if (!isSuccess(result)) {
        setError(errorMessage(result));
        return;
      }
      setGitDiff({ path, data: result.data });
      onGitDiffOpened({
        workspaceId: workspace.id,
        path,
        title: `${path.split("/").at(-1) ?? path} · diff`,
      });
      setError("");
    },
    [ipc, onGitDiffOpened, workspace],
  );

  useEffect(() => {
    if (activity !== "source-control") return;
    const timer = window.setTimeout(() => {
      void refreshGit();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activity, refreshGit]);

  const refreshGraph = useCallback(async () => {
    if (!workspace) return;
    const result = await ipc.knowledge.graph(workspace.id, directory);
    if (isSuccess(result)) setGraph(result.data);
    else setError(errorMessage(result));
  }, [directory, ipc, workspace]);

  useEffect(() => {
    if (activity !== "graph" && activity !== "home") return;
    const timer = window.setTimeout(() => {
      void refreshGraph();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activity, refreshGraph]);

  const expandGraphNode = async (nodeId: string) => {
    if (!workspace)
      return { nodes: [], edges: [], truncated: false } satisfies GraphPage;
    const result = await ipc.knowledge.graph(workspace.id, directory, nodeId);
    if (!isSuccess(result)) throw new Error(errorMessage(result));
    return result.data;
  };

  const handleGraphCommand = (
    command: GraphCommand,
    context: GraphCommandContext,
  ) => {
    if (command === "graph.open-source" && context.source) {
      void openDocument(context.source.relativePath);
      return;
    }
    if (
      (command === "graph.open-terminal" ||
        command === "graph.prepare-agent") &&
      context.source
    ) {
      const relativePath =
        context.node.type === "folder"
          ? context.source.relativePath
          : parentPath(context.source.relativePath);
      onOpenTerminal({
        workspaceId: context.source.workspaceId,
        relativePath,
        preset:
          command === "graph.open-terminal"
            ? "shell"
            : (context.provider ?? "codex"),
      });
    }
  };

  const surface = (content: ReactNode) => (
    <>
      <Suspense
        fallback={
          <div className="surface-loading" role="status">
            Loading workspace surface…
          </div>
        }
      >
        {content}
      </Suspense>
      <KnowledgeSearchModal
        open={searchOpen}
        response={search}
        onClose={onCloseSearch}
        onSearch={(query) => void searchEntries(query)}
        onOpen={(result) => {
          onCloseSearch();
          void openDocument(result.path);
          onNavigate("knowledge");
        }}
      />
      <NewNoteDialog
        open={newNoteOpen}
        onClose={() => {
          setNewNoteOpen(false);
        }}
        onCreate={(relativePath, title) => {
          void createNote(relativePath, title);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDiscard)}
        title="Discard local changes?"
        message={
          pendingDiscard
            ? `Changes to ${pendingDiscard} will be discarded. This action cannot be undone from Second Brain OS.`
            : ""
        }
        confirmLabel="Discard changes"
        dangerous
        onClose={() => {
          setPendingDiscard(undefined);
        }}
        onConfirm={() => {
          if (pendingDiscard) void mutateGit("discard", pendingDiscard);
          setPendingDiscard(undefined);
        }}
      />
    </>
  );

  if (loading && !workspaces.length)
    return surface(<p role="status">Loading workspaces…</p>);
  if (!workspace)
    return surface(
      <EmptyWorkspace
        onRegister={(registration) => {
          void registerWorkspace(registration);
        }}
        busy={loading}
        error={workspaceError || error}
      />,
    );

  if (
    workspace.kind === "collection" &&
    (activity === "files" || activity === "knowledge")
  )
    return surface(
      <section className="workspace-empty-state">
        <p className="eyebrow">Virtual collection</p>
        <h1>{workspace.name}</h1>
        <p>
          Collections group project cards and do not contain filesystem files.
          Open a brain or project workspace to browse notes.
        </p>
      </section>,
    );

  if (document && (activity === "files" || activity === "knowledge"))
    return surface(
      <DocumentEditor
        document={document}
        canWrite={workspace.canWrite}
        saving={saving}
        onChange={(content) => {
          onDocumentDirtyChange(
            `file:${document.workspaceId}:${document.relativePath}`,
            content !== document.baseContent,
          );
          setDocument((current) => {
            if (!current) return current;
            return { ...current, content };
          });
        }}
        onSave={() => {
          void saveDocument();
        }}
        onImportImage={importImage}
        resolveLocalImage={resolveLocalImage}
      />,
    );

  if (activity === "files" || activity === "knowledge")
    return surface(
      <FileBrowser
        workspace={workspace}
        directory={directory}
        error={error}
        entries={entries.filter(
          (entry) =>
            activity === "files" ||
            isMarkdown(entry.relativePath) ||
            entry.kind === "directory",
        )}
        onDirectory={setDirectory}
        onOpen={(path) => void openDocument(path)}
        onContextAction={(action, entry) => {
          const relativePath =
            entry.kind === "directory"
              ? entry.relativePath
              : parentPath(entry.relativePath);
          onOpenTerminal({
            workspaceId: workspace.id,
            relativePath,
            preset: action === "terminal" ? "shell" : action,
          });
        }}
      />,
    );

  if (activity === "agents")
    return surface(
      <AgentWorkspace
        state={{ ...agents, workspaceId: workspace.id }}
        onChange={(next) => {
          setAgents(next);
        }}
      />,
    );

  if (activity === "source-control") {
    const changes: SourceControlChange[] = (git?.changes ?? []).map(
      (change) => ({
        path: change.path,
        status: change.status,
        staged: change.staged,
      }),
    );
    if (gitDiff)
      return surface(
        <section className="git-diff-view" aria-labelledby="git-diff-title">
          <header className="git-diff-header">
            <div>
              <p className="eyebrow">
                {gitDiff.data.staged ? "Staged diff" : "Working tree diff"}
              </p>
              <h1 id="git-diff-title">{gitDiff.path}</h1>
            </div>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                setGitDiff(undefined);
              }}
            >
              Back to changes
            </button>
          </header>
          {gitDiff.data.truncated ? (
            <p role="status">This diff was truncated to a safe display size.</p>
          ) : null}
          <pre className="git-diff-patch" tabIndex={0}>
            <code>{gitDiff.data.patch || "No textual changes."}</code>
          </pre>
        </section>,
      );
    return surface(
      <SourceControlWorkspace
        {...(git?.branch === undefined ? {} : { branch: git.branch })}
        changes={changes}
        onStage={(path) => {
          void mutateGit("stage", path);
        }}
        onUnstage={(path) => {
          void mutateGit("unstage", path);
        }}
        onDiscard={(path) => {
          setPendingDiscard(path);
        }}
        onOpenDiff={(path, staged) => {
          void openGitDiff(path, staged);
        }}
      />,
    );
  }

  if (activity === "planner")
    return surface(
      <section className="tasks-workspace" aria-labelledby="tasks-heading">
        <header className="surface-toolbar">
          <div>
            <p className="eyebrow">Tasks</p>
            <h1 id="tasks-heading">All Tasks</h1>
          </div>
          <span className="surface-status">Local planner</span>
        </header>
        <LocalPlanner />
      </section>,
    );

  if (activity === "calendar") return surface(<ReferenceCalendar />);

  if (activity === "settings")
    return surface(
      <section className="workspace-settings" aria-labelledby="settings-title">
        <header className="settings-heading">
          <div>
            <p className="eyebrow">Settings</p>
            <h1 id="settings-title">Workspace</h1>
            <p>Configure how Second Brain OS works for this local workspace.</p>
          </div>
          <button
            className="button button-small"
            type="button"
            onClick={() => void refreshWorkspaces()}
          >
            Refresh
          </button>
        </header>
        <fieldset className="settings-group settings-profile">
          <legend>Workspace Profile</legend>
          <dl className="settings-rows">
            <div>
              <dt>Workspace name</dt>
              <dd>{workspace.name}</dd>
            </div>
            <div>
              <dt>Workspace type</dt>
              <dd>{workspace.kind}</dd>
            </div>
            <div>
              <dt>Data location</dt>
              <dd>
                <span className="settings-badge">● Local only</span>
              </dd>
            </div>
            <div>
              <dt>Workspace ID</dt>
              <dd>
                <code>{workspace.id}</code>
              </dd>
            </div>
          </dl>
        </fieldset>
        <fieldset className="settings-group">
          <legend>Local-First Settings</legend>
          <dl className="settings-rows">
            <div>
              <dt>Local-first mode</dt>
              <dd>
                Always prefer local data and offline operation{" "}
                <span className="settings-switch" data-on="true" />
              </dd>
            </div>
            <div>
              <dt>Workspace trust</dt>
              <dd>{workspace.trustLevel.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Editing</dt>
              <dd>{workspace.canWrite ? "Enabled" : "Read-only"}</dd>
            </div>
            <div>
              <dt>Native terminal</dt>
              <dd>{workspace.canUseTerminal ? "Available" : "Unavailable"}</dd>
            </div>
          </dl>
        </fieldset>
        <fieldset className="settings-group">
          <legend>Appearance</legend>
          <p>
            Choose how the workbench canvas and editor surfaces are rendered.
          </p>
          <div className="segmented-control" aria-label="Theme">
            {(["light", "auto", "dark"] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                className="button button-small"
                aria-pressed={themeMode === mode}
                onClick={() => {
                  setThemeMode(mode);
                }}
              >
                {mode.slice(0, 1).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="settings-group">
          <legend>Editor</legend>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={editorAutosave}
              onChange={(event) => {
                setEditorAutosave(event.target.checked);
              }}
            />
            <span>
              <strong>Autosave after one second</strong>
              <small>Off by default. Save failures remain visible.</small>
            </span>
          </label>
        </fieldset>
        <fieldset className="settings-group">
          <legend>Debugging</legend>
          <dl className="settings-rows">
            <div>
              <dt>Desktop bridge</dt>
              <dd>
                {bridgeResult
                  ? bridgeResult.ok
                    ? "Connected"
                    : bridgeResult.error.message
                  : "Not checked"}
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => void checkDesktopBridge()}
                >
                  Check desktop bridge
                </button>
              </dd>
            </div>
            {bridgeResult ? (
              <div>
                <dt>Correlation ID</dt>
                <dd>
                  <code>{bridgeResult.correlationId}</code>
                </dd>
              </div>
            ) : null}
          </dl>
        </fieldset>
        <fieldset className="settings-group">
          <legend>Sync & Collaboration</legend>
          <dl className="settings-rows">
            <div>
              <dt>Cloud sync</dt>
              <dd>Not configured</dd>
            </div>
            <div>
              <dt>Shared links</dt>
              <dd>Unavailable in this local build</dd>
            </div>
            <div>
              <dt>Collaborative editing</dt>
              <dd>Local-only</dd>
            </div>
          </dl>
        </fieldset>
      </section>,
    );

  return surface(
    <section className="home-surface" aria-labelledby="home-title">
      <h1 id="home-title" className="visually-hidden">
        Home
      </h1>
      <div className="quick-actions">
        <button
          className="quick-action"
          type="button"
          onClick={createDailyNote}
        >
          <span>
            <CalendarPlus size={16} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <strong>Today’s note</strong>
          <small>Open notes/today.md</small>
        </button>
        <button
          className="quick-action"
          type="button"
          onClick={() => {
            setNewNoteOpen(true);
          }}
        >
          <span>
            <FilePlus2 size={16} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <strong>New note</strong>
          <small>Create a Markdown node in notes.</small>
        </button>
        <button className="quick-action" type="button" onClick={onOpenPalette}>
          <span>
            <Command size={16} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <strong>Commands</strong>
          <small>Open the action palette.</small>
        </button>
      </div>
      <FocusedGraph
        page={graph}
        theme={resolvedTheme}
        onExpand={(nodeId) => expandGraphNode(nodeId)}
        onCommand={handleGraphCommand}
        onSelectionContextChange={onGraphSelectionContextChange}
      />
      {error ? <p role="alert">{error}</p> : null}
    </section>,
  );
}
