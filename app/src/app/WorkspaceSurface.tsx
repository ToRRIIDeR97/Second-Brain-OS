import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  FolderOpen,
  GitBranch,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ConfirmDialog } from "../components/common/ModalDialog";
import {
  AgentComposer,
  createIpcAgentSessionSource,
  type AgentAvailability,
  type AgentWorkspaceState,
} from "../features/agents";
import {
  bytesToBase64,
  createImageAttachmentPlacement,
  imageDataUrl,
  MAX_IMAGE_BYTES,
  normalizeImageFile,
  resolveImageAttachmentPath,
} from "../features/editor/markdown/attachments";
import { NewNoteDialog } from "../features/editor/markdown/NewNoteDialog";
import {
  LanguageToolActions,
  LanguageToolStatus,
  languageForPath,
  type LanguageToolStatusItem,
  type SourceDiagnostic,
  type EditorTabState,
} from "../features/editor/source";
import { GitDiffEditor } from "../features/viewers";
import type {
  GraphCommand,
  GraphCommandContext,
  GraphPage,
  GraphSelectionContext,
} from "../features/graph";
import { KnowledgeSearchModal, type SearchResponse } from "../features/search";
import type { SourceControlChange } from "../features/source-control";
import type {
  ActivityPage,
  ActivityCategory,
  CommandResult,
  AgentProviderProbeRecord,
  GitFileDiff,
  GitWorkspaceStatus,
  IpcClient,
  WorkspaceDirectoryEntry,
  WorkspaceKind,
  WorkspaceSummary,
  WorkspaceTrustLevel,
  ToolLanguage,
  LanguageToolStatus as ToolStatus,
  IntegrationSettings,
  IntegrationSettingsUpdate,
  GoogleConnectionStatus,
  PlannerItemRecord,
} from "../lib/ipc";
import type { Activity } from "../state/shell";
import type { PlannerView, ProjectView } from "../state/shell";
import { ProjectsWorkspace } from "../features/projects";
import { useProjects } from "../state/projects";
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
const PlannerWorkspace = lazy(async () => ({
  default: (await import("../features/planner")).PlannerWorkspace,
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
const noopDiagnostics = () => undefined;
const defaultIntegrationSettings: IntegrationSettings = {
  version: 1,
  google: {
    oauthClientId: null,
    consentMode: "read_only",
    calendarEnabled: true,
    tasksEnabled: true,
  },
  codex: { defaultSandbox: "read_only" },
};

function nameFromRoot(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).at(-1) || "Workspace";
}

function localDateKey(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function plannerDate(item: PlannerItemRecord) {
  if (!item.schedule) return undefined;
  if (item.schedule.kind === "exact")
    return localDateKey(new Date(item.schedule.startEpochSeconds * 1000));
  return item.schedule.date;
}

function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function isMarkdown(path: string) {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function toolLanguageForPath(path: string): ToolLanguage | undefined {
  const language = languageForPath(path);
  return language === "typescript" ||
    language === "javascript" ||
    language === "python" ||
    language === "rust"
    ? language
    : undefined;
}

function toolIds(language: ToolLanguage | undefined) {
  if (language === "typescript" || language === "javascript")
    return {
      formatter: "prettier",
      analyzer: "eslint",
      server: "typescript-language-server",
    };
  if (language === "python")
    return {
      formatter: "ruff",
      analyzer: "ruff",
      server: "pyright-langserver",
    };
  if (language === "rust")
    return {
      formatter: "rustfmt",
      analyzer: "cargo-clippy",
      server: "rust-analyzer",
    };
  return {};
}

function isSuccess<T>(
  result: CommandResult<T>,
): result is Extract<CommandResult<T>, { ok: true }> {
  return result.ok;
}

function errorMessage<T>(result: CommandResult<T>) {
  return result.ok ? "" : result.error.message;
}

function eventLabel(eventType: string) {
  return eventType
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" · ");
}

function activitySubject(payload: Record<string, unknown> | null) {
  if (!payload) return "Application event";
  const subject = payload.path ?? payload.resourceId ?? payload.projectId;
  return typeof subject === "string" ? subject : "Application event";
}

function EmptyWorkspace({
  onRegister,
  onSelectRoot,
  busy,
  error,
}: {
  onRegister: (input: {
    name: string;
    rootPath: string;
    rootGrantId: string;
    kind: WorkspaceKind;
    trustLevel: WorkspaceTrustLevel;
  }) => Promise<void>;
  onSelectRoot: IpcClient["workspaces"]["selectRoot"];
  busy: boolean;
  error: string;
}) {
  const [rootPath, setRootPath] = useState("");
  const [rootGrantId, setRootGrantId] = useState("");
  const [name, setName] = useState("");
  const [trustLevel, setTrustLevel] = useState<WorkspaceTrustLevel>("trusted");
  const [folderPickerBusy, setFolderPickerBusy] = useState(false);
  const [folderPickerError, setFolderPickerError] = useState("");

  const chooseFolder = async () => {
    setFolderPickerBusy(true);
    setFolderPickerError("");
    try {
      const result = await onSelectRoot();
      if (!result.ok) throw new Error(result.error.message);
      if (!result.data) return;
      setRootPath(result.data.displayPath);
      setRootGrantId(result.data.grantId);
      setName(
        (current) =>
          current.trim() || result.data?.suggestedName || "Workspace",
      );
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
      <div className="workspace-onboarding-panel">
        <div className="workspace-onboarding-intro">
          <span className="workspace-onboarding-mark" aria-hidden="true">
            <FolderOpen size={22} strokeWidth={1.8} />
          </span>
          <p className="eyebrow">Your local space</p>
          <h1 id="workspace-title">Open a local workspace</h1>
          <p className="workspace-onboarding-summary">
            Choose a folder to keep notes, plans, and project files in one
            place.
          </p>
          <ul className="workspace-onboarding-benefits">
            <li>
              <ShieldCheck size={16} strokeWidth={1.9} aria-hidden="true" />
              <span>Your files stay on this device.</span>
            </li>
            <li>
              <Search size={16} strokeWidth={1.9} aria-hidden="true" />
              <span>Browse, edit, and search from one workspace.</span>
            </li>
            <li>
              <LockKeyhole size={16} strokeWidth={1.9} aria-hidden="true" />
              <span>Set the access level before you open it.</span>
            </li>
          </ul>
        </div>
        <form
          className="workspace-onboarding-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onRegister({
              name: name.trim() || nameFromRoot(rootPath),
              rootPath: rootPath.trim(),
              rootGrantId,
              kind: "brain",
              trustLevel,
            });
          }}
        >
          <header className="workspace-onboarding-form-heading">
            <p className="eyebrow">Workspace details</p>
            <h2>Start with a folder</h2>
            <p>Pick the folder you want Second Brain OS to work in.</p>
          </header>
          <div className="workspace-folder-field">
            <span className="workspace-field-label" id="workspace-folder-label">
              Workspace folder
            </span>
            <button
              className="button workspace-folder-picker"
              type="button"
              aria-labelledby="workspace-folder-label"
              aria-describedby="workspace-folder-selection"
              onClick={() => void chooseFolder()}
              disabled={busy || folderPickerBusy}
            >
              <FolderOpen size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>
                {folderPickerBusy
                  ? "Choosing folder…"
                  : rootPath
                    ? "Choose a different folder"
                    : "Choose folder…"}
              </span>
            </button>
            <output
              className="workspace-folder-selection"
              id="workspace-folder-selection"
              aria-live="polite"
              aria-label="Selected workspace folder"
            >
              {rootPath || "No folder selected yet."}
            </output>
          </div>
          <div className="workspace-onboarding-fields">
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
          </div>
          <p className="workspace-trust-note">
            <ShieldCheck size={15} strokeWidth={1.9} aria-hidden="true" />
            Trusted workspaces can edit files and use the terminal.
          </p>
          <button
            className="button button-primary workspace-open-button"
            type="submit"
            disabled={busy || !rootPath || !rootGrantId}
          >
            <span>{busy ? "Opening…" : "Open workspace"}</span>
            <ArrowRight size={17} strokeWidth={2} aria-hidden="true" />
          </button>
          {error || folderPickerError ? (
            <p className="workspace-onboarding-error" role="alert">
              {error || folderPickerError}
            </p>
          ) : null}
        </form>
      </div>
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
  ipc,
  toolStatuses,
  formatting,
  analyzing,
  onFormat,
  onAnalyze,
  line,
  column,
}: {
  document: OpenDocument;
  canWrite: boolean;
  saving: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
  onImportImage: (file: File, alt: string) => Promise<string | undefined>;
  resolveLocalImage: (source: string) => Promise<string | undefined>;
  ipc: IpcClient;
  toolStatuses: readonly ToolStatus[];
  formatting: boolean;
  analyzing: boolean;
  onFormat: () => void;
  onAnalyze: () => void;
  line?: number;
  column?: number;
}) {
  const tab: EditorTabState = {
    resourceId: `${document.workspaceId}:${document.relativePath}`,
    modelUri: `second-brain://${document.workspaceId}/${document.relativePath}`,
    workspaceId: document.workspaceId,
    relativePath: document.relativePath,
    language: languageForPath(document.relativePath),
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
  const ids = toolIds(toolLanguageForPath(document.relativePath));
  const statuses: LanguageToolStatusItem[] = toolStatuses
    .filter((status) =>
      [ids.server, ids.formatter, ids.analyzer].includes(status.id),
    )
    .map((status) => ({
      id: status.id,
      name: status.name,
      available: status.available,
      ...(status.version ? { detail: status.version } : {}),
    }));
  const available = (id?: string) =>
    id !== undefined &&
    toolStatuses.some((item) => item.id === id && item.available);
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
        <div className="document-editor-actions">
          {!isMarkdown(document.relativePath) ? (
            <LanguageToolActions
              onFormat={onFormat}
              onAnalyze={onAnalyze}
              formatting={formatting}
              analyzing={analyzing}
              canFormat={canWrite && available(ids.formatter)}
              canAnalyze={available(ids.analyzer)}
            />
          ) : null}
          <button
            className="button button-primary"
            type="button"
            disabled={
              !canWrite || saving || document.content === document.baseContent
            }
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>
      {!isMarkdown(document.relativePath) ? (
        <LanguageToolStatus statuses={statuses} />
      ) : null}
      {isMarkdown(document.relativePath) ? (
        <MarkdownEditor
          value={document.content}
          readOnly={!canWrite}
          onChange={onChange}
          onImportImage={onImportImage}
          resolveLocalImage={resolveLocalImage}
        />
      ) : (
        <SourceEditor
          key={tab.modelUri}
          tab={tab}
          readOnly={!canWrite}
          onChange={onChange}
          lsp={{ ipc }}
          {...(line === undefined ? {} : { line })}
          {...(column === undefined ? {} : { column })}
        />
      )}
    </section>
  );
}

export function WorkspaceSurface({
  activity,
  ipc,
  searchOpen = false,
  onCloseSearch = () => undefined,
  onNavigate = () => undefined,
  projectView = "overview",
  plannerView = "today",
  onPlannerViewChange = () => undefined,
  onCreateProject = () => undefined,
  onProjectViewChange = () => undefined,
  onOpenAgentPanel = () => undefined,
  newNoteRequest,
  noteRequest,
  fileRequest,
  saveRequest,
  onOpenTerminal = () => undefined,
  onDocumentOpened = () => undefined,
  onDocumentDirtyChange = () => undefined,
  onDocumentSaved = () => undefined,
  onGitDiffOpened = () => undefined,
  onGraphSelectionContextChange = () => undefined,
  onDiagnosticsChange = noopDiagnostics,
}: {
  activity: Activity;
  ipc: IpcClient;
  onOpenPalette: () => void;
  searchOpen?: boolean;
  onCloseSearch?: () => void;
  onNavigate?: (activity: Activity) => void;
  projectView?: ProjectView;
  plannerView?: PlannerView;
  onPlannerViewChange?: (view: PlannerView) => void;
  onCreateProject?: () => void;
  onProjectViewChange?: (view: ProjectView) => void;
  onOpenAgentPanel?: () => void;
  newNoteRequest?: number | undefined;
  noteRequest?: { key: number; relativePath: string } | undefined;
  fileRequest?:
    | {
        key: number;
        relativePath: string;
        line?: number;
        column?: number;
      }
    | undefined;
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
    activity: "knowledge" | "files" | "projects";
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
  onDiagnosticsChange?: (diagnostics: SourceDiagnostic[]) => void;
}) {
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<WorkspaceDirectoryEntry[]>([]);
  const [documents, setDocuments] = useState<Record<string, OpenDocument>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<string>();

  useEffect(() => {
    if (newNoteRequest === undefined) return;
    const timer = window.setTimeout(() => {
      setNewNoteOpen(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [newNoteRequest]);

  const [bridgeResult, setBridgeResult] =
    useState<CommandResult<string> | null>(null);
  const [search, setSearch] = useState<SearchResponse>(emptySearch);
  const [graph, setGraph] = useState<GraphPage>({
    nodes: [],
    edges: [],
    truncated: false,
  });
  const [git, setGit] = useState<GitWorkspaceStatus>();
  const [auditActivity, setAuditActivity] = useState<ActivityPage>({
    items: [],
  });
  const [activityCategory, setActivityCategory] =
    useState<ActivityCategory>("all");
  const [gitDiff, setGitDiff] = useState<{
    path: string;
    data: GitFileDiff;
  }>();
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const [formatting, setFormatting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [editorLocation, setEditorLocation] = useState<{
    line: number;
    column: number;
  }>();
  const [agents, setAgents] = useState<AgentWorkspaceState>({
    workspaceId: "",
    sessions: [],
    activeSessionId: null,
  });
  const [agentAvailability, setAgentAvailability] = useState<AgentAvailability>(
    { status: "degraded", reason: "Checking Codex App Server…" },
  );
  const [homePlannerItems, setHomePlannerItems] = useState<PlannerItemRecord[]>(
    [],
  );
  const [integrationSettings, setIntegrationSettings] =
    useState<IntegrationSettings>(defaultIntegrationSettings);
  const [integrationDraft, setIntegrationDraft] =
    useState<IntegrationSettingsUpdate>({
      google: { ...defaultIntegrationSettings.google },
      codex: { ...defaultIntegrationSettings.codex },
    });
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [integrationMessage, setIntegrationMessage] = useState<{
    kind: "success" | "error";
    text: string;
  }>();
  const [googleStatus, setGoogleStatus] = useState<GoogleConnectionStatus>();
  const [googleAction, setGoogleAction] = useState<
    "connect" | "sync" | "disconnect"
  >();
  const googleClientSecretConfigured = Boolean(
    googleClientSecret.trim() ||
    (integrationDraft.google.oauthClientId?.trim() ===
      integrationSettings.google.oauthClientId &&
      googleStatus?.clientSecretConfigured),
  );
  const pendingIntegrationUpdate = useMemo<IntegrationSettingsUpdate>(
    () => ({
      google: {
        ...integrationDraft.google,
        oauthClientSecret: googleClientSecret.trim() || null,
      },
      codex: integrationDraft.codex,
    }),
    [googleClientSecret, integrationDraft],
  );
  const [codexProbe, setCodexProbe] = useState<AgentProviderProbeRecord>();
  const agentSource = useMemo(() => createIpcAgentSessionSource(ipc), [ipc]);
  const {
    workspaces,
    activeWorkspace: workspace,
    activeWorkspaceId,
    loading,
    error: workspaceError,
    registerWorkspace,
    refreshWorkspaces,
  } = useWorkspace();
  const {
    projects,
    brainWorkspaceId,
    loading: projectsLoading,
    selectProject,
  } = useProjects();
  const document = activeWorkspaceId ? documents[activeWorkspaceId] : undefined;
  const setDocument = useCallback(
    (next: SetStateAction<OpenDocument | undefined>) => {
      if (!activeWorkspaceId) return;
      setDocuments((current) => {
        const value =
          typeof next === "function" ? next(current[activeWorkspaceId]) : next;
        if (!value) {
          const updated: Record<string, OpenDocument> = {};
          for (const [workspaceId, openDocument] of Object.entries(current)) {
            if (workspaceId !== activeWorkspaceId)
              updated[workspaceId] = openDocument;
          }
          return updated;
        }
        return { ...current, [activeWorkspaceId]: value };
      });
    },
    [activeWorkspaceId],
  );
  const { mode: themeMode, resolvedTheme, setMode: setThemeMode } = useTheme();
  const { editorAutosave, setEditorAutosave, formatOnSave, setFormatOnSave } =
    usePreferences();
  const checkDesktopBridge = useCallback(async () => {
    setBridgeResult(await ipc.system.ping());
  }, [ipc]);

  useEffect(() => {
    let current = true;
    void ipc.integrations.get().then((result) => {
      if (!current) return;
      setIntegrationLoading(false);
      if (!result.ok) {
        setIntegrationMessage({ kind: "error", text: result.error.message });
        return;
      }
      setIntegrationSettings(result.data);
      setIntegrationDraft({
        google: { ...result.data.google },
        codex: { ...result.data.codex },
      });
    });
    return () => {
      current = false;
    };
  }, [ipc]);

  useEffect(() => {
    if (activity !== "settings") return;
    let current = true;
    void ipc.integrations.googleStatus().then((result) => {
      if (current && result.ok) setGoogleStatus(result.data);
    });
    void ipc.agents.probe().then((result) => {
      if (current && result.ok) setCodexProbe(result.data);
    });
    return () => {
      current = false;
    };
  }, [activity, ipc]);

  const refreshGoogleStatus = useCallback(async () => {
    const result = await ipc.integrations.googleStatus();
    if (result.ok) setGoogleStatus(result.data);
  }, [ipc]);

  const connectGoogle = useCallback(async () => {
    if (!brainWorkspaceId || googleAction) return;
    setGoogleAction("connect");
    setIntegrationMessage({
      kind: "success",
      text: "Waiting for Google in your browser…",
    });
    const saved = await ipc.integrations.save(pendingIntegrationUpdate);
    if (!saved.ok) {
      setIntegrationMessage({ kind: "error", text: saved.error.message });
      setGoogleAction(undefined);
      return;
    }
    setIntegrationSettings(saved.data);
    setIntegrationDraft({
      google: { ...saved.data.google },
      codex: { ...saved.data.codex },
    });
    setGoogleClientSecret("");
    const result = await ipc.integrations.googleConnect(brainWorkspaceId);
    setGoogleAction(undefined);
    if (!result.ok) {
      setIntegrationMessage({ kind: "error", text: result.error.message });
      await refreshGoogleStatus();
      return;
    }
    setIntegrationMessage({
      kind: "success",
      text: `Google connected. Synced ${String(result.data.calendarItems)} calendar items and ${String(result.data.taskItems)} tasks.`,
    });
    await refreshGoogleStatus();
  }, [
    brainWorkspaceId,
    googleAction,
    ipc,
    pendingIntegrationUpdate,
    refreshGoogleStatus,
  ]);

  const syncGoogle = useCallback(async () => {
    if (!brainWorkspaceId || googleAction) return;
    setGoogleAction("sync");
    setIntegrationMessage({ kind: "success", text: "Syncing Google…" });
    const result = await ipc.integrations.googleSync(brainWorkspaceId);
    setGoogleAction(undefined);
    if (!result.ok) {
      setIntegrationMessage({ kind: "error", text: result.error.message });
      return;
    }
    setIntegrationMessage({
      kind: "success",
      text: `Google is up to date. Synced ${String(result.data.calendarItems)} calendar items and ${String(result.data.taskItems)} tasks.`,
    });
    await refreshGoogleStatus();
  }, [brainWorkspaceId, googleAction, ipc, refreshGoogleStatus]);

  const disconnectGoogle = useCallback(async () => {
    if (googleAction) return;
    setGoogleAction("disconnect");
    setIntegrationMessage({ kind: "success", text: "Disconnecting Google…" });
    const result = await ipc.integrations.googleDisconnect();
    setGoogleAction(undefined);
    if (!result.ok) {
      setIntegrationMessage({ kind: "error", text: result.error.message });
      return;
    }
    setGoogleStatus(result.data);
    setIntegrationMessage({ kind: "success", text: result.data.message });
  }, [googleAction, ipc]);

  const saveIntegrationSettings = useCallback(async () => {
    setIntegrationSaving(true);
    setIntegrationMessage(undefined);
    const result = await ipc.integrations.save(pendingIntegrationUpdate);
    setIntegrationSaving(false);
    if (!result.ok) {
      setIntegrationMessage({ kind: "error", text: result.error.message });
      return;
    }
    setIntegrationSettings(result.data);
    setIntegrationDraft({
      google: { ...result.data.google },
      codex: { ...result.data.codex },
    });
    setGoogleClientSecret("");
    setIntegrationMessage({
      kind: "success",
      text: "Integration settings saved.",
    });
    await refreshGoogleStatus();
  }, [ipc, pendingIntegrationUpdate, refreshGoogleStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDirectory("");
      setEntries([]);
      setError("");
      setGitDiff(undefined);
      setToolStatuses([]);
      onDiagnosticsChange([]);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeWorkspaceId, onDiagnosticsChange]);

  useEffect(() => {
    if (!workspace?.canUseTerminal) return;
    let current = true;
    void ipc.languageTools.status(workspace.id).then((result) => {
      if (!current) return;
      if (result.ok) setToolStatuses(result.data);
      else setError(result.error.message);
    });
    return () => {
      current = false;
    };
  }, [ipc, workspace?.canUseTerminal, workspace?.id]);

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
    async (
      relativePath: string,
      location?: { line: number; column: number },
    ) => {
      if (!workspace) return;
      if (
        document?.workspaceId === workspace.id &&
        document.relativePath === relativePath &&
        document.content !== document.baseContent
      ) {
        setEditorLocation(location);
        return;
      }
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
      setEditorLocation(location);
      onDocumentOpened({
        workspaceId: workspace.id,
        relativePath,
        title: relativePath.split("/").at(-1) ?? relativePath,
        activity: isMarkdown(relativePath) ? "knowledge" : "files",
      });
      setError("");
    },
    [document, ipc, onDocumentOpened, setDocument, workspace],
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
      let normalizedFile: File;
      try {
        normalizedFile = await normalizeImageFile(file);
      } catch {
        setError("The HEIC image could not be converted.");
        return undefined;
      }
      const placement = createImageAttachmentPlacement(
        document.relativePath,
        normalizedFile.name,
        normalizedFile.type,
      );
      if (!placement) {
        setError("Use a HEIC, PNG, JPEG, GIF, or WebP image.");
        return undefined;
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await normalizedFile.arrayBuffer());
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

  const formatContent = useCallback(
    async (content: string) => {
      if (!document || !workspace) return undefined;
      const language = toolLanguageForPath(document.relativePath);
      if (!language) return content;
      setFormatting(true);
      const result = await ipc.languageTools.format(
        workspace.id,
        document.relativePath,
        language,
        content,
      );
      setFormatting(false);
      if (!result.ok) {
        setError(result.error.message);
        return undefined;
      }
      setError("");
      return result.data.content;
    },
    [document, ipc, workspace],
  );

  const formatDocument = useCallback(async () => {
    if (!document) return;
    const formatted = await formatContent(document.content);
    if (formatted === undefined || formatted === document.content) return;
    onDocumentDirtyChange(
      `file:${document.workspaceId}:${document.relativePath}`,
      formatted !== document.baseContent,
    );
    setDocument((current) =>
      current ? { ...current, content: formatted } : current,
    );
  }, [document, formatContent, onDocumentDirtyChange, setDocument]);

  const analyzeWorkspace = useCallback(async () => {
    if (!document || !workspace) return;
    const language = toolLanguageForPath(document.relativePath);
    if (!language) return;
    setAnalyzing(true);
    const result = await ipc.languageTools.analyze(workspace.id, language);
    setAnalyzing(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onDiagnosticsChange(
      result.data.map((diagnostic) => ({
        path: diagnostic.relativePath,
        line: diagnostic.line,
        column: diagnostic.column,
        severity: diagnostic.severity,
        message: diagnostic.message,
        source: diagnostic.source,
        ...(diagnostic.code ? { code: diagnostic.code } : {}),
      })),
    );
    setError("");
  }, [document, ipc, onDiagnosticsChange, workspace]);

  const saveDocument = useCallback(async () => {
    if (!document || !workspace) return;
    setSaving(true);
    let submittedContent = document.content;
    if (formatOnSave && !isMarkdown(document.relativePath)) {
      submittedContent =
        (await formatContent(submittedContent)) ?? submittedContent;
    }
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
            content: submittedContent,
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
    formatContent,
    formatOnSave,
    ipc,
    onDocumentDirtyChange,
    onDocumentSaved,
    refreshDirectory,
    setDocument,
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
      void openDocument(
        fileRequest.relativePath,
        fileRequest.line === undefined
          ? undefined
          : { line: fileRequest.line, column: fileRequest.column ?? 1 },
      );
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
      const result = await ipc.git.fileDiff(workspace.id, staged, path);
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
    if (activity !== "source-control" && activity !== "activity") return;
    const timer = window.setTimeout(() => {
      void refreshGit();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activity, refreshGit]);

  const refreshActivity = useCallback(async () => {
    const result = await ipc.activity.list({
      limit: 50,
      category: activity === "activity" ? activityCategory : "all",
    });
    if (isSuccess(result)) setAuditActivity(result.data);
    else setError(errorMessage(result));
  }, [activity, activityCategory, ipc]);

  useEffect(() => {
    if (activity !== "activity" && activity !== "home") return;
    const timer = window.setTimeout(() => void refreshActivity(), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activity, refreshActivity]);

  useEffect(() => {
    if (!workspace || !["home", "activity", "agents"].includes(activity))
      return;
    let current = true;
    void agentSource.probe().then((availability) => {
      if (current) setAgentAvailability(availability);
    });
    void agentSource
      .list(workspace.id)
      .then((sessions) => {
        if (!current) return;
        setAgents({
          workspaceId: workspace.id,
          sessions,
          activeSessionId: sessions[0]?.id ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [activity, agentSource, workspace]);

  useEffect(() => {
    if (activity !== "home" || !brainWorkspaceId) return;
    let current = true;
    void ipc.planner.list({ brainWorkspaceId }).then((result) => {
      if (current && result.ok) setHomePlannerItems(result.data);
    });
    return () => {
      current = false;
    };
  }, [activity, brainWorkspaceId, ipc]);

  const refreshGraph = useCallback(async () => {
    if (!workspace) return;
    const result = await ipc.knowledge.graph(workspace.id, directory);
    if (isSuccess(result)) setGraph(result.data);
    else setError(errorMessage(result));
  }, [directory, ipc, workspace]);

  useEffect(() => {
    if (activity !== "graph") return;
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
        onSelectRoot={ipc.workspaces.selectRoot}
        onRegister={async (registration) => {
          const registered = await registerWorkspace(registration);
          if (registered) onNavigate("knowledge");
        }}
        busy={loading}
        error={workspaceError || error}
      />,
    );

  if (activity === "projects")
    return surface(
      <ProjectsWorkspace
        view={projectView}
        onViewChange={onProjectViewChange}
        onCreate={onCreateProject}
        onNavigate={onNavigate}
        ipc={ipc}
      />,
    );

  if (activity === "activity") {
    const blockedProjects = projects.filter(
      ({ status, blocker }) => status === "active" && Boolean(blocker),
    );
    const activityAgents =
      agents.workspaceId === workspace.id ? agents.sessions : [];
    const problemAgents = activityAgents.filter(({ state }) =>
      ["waiting", "failed", "recoverable"].includes(state),
    );
    return surface(
      <section className="activity-workspace" aria-labelledby="activity-title">
        <header className="activity-workspace-header">
          <div>
            <p className="eyebrow">Activity</p>
            <h1 id="activity-title">Work that needs your attention</h1>
            <p>Real local state only. Disconnected services stay explicit.</p>
          </div>
        </header>
        <div
          className="activity-filter"
          role="group"
          aria-label="Filter Activity"
        >
          {(["all", "attention", "runs", "changes", "history"] as const).map(
            (category) => (
              <button
                type="button"
                aria-pressed={activityCategory === category}
                key={category}
                onClick={() => {
                  setActivityCategory(category);
                }}
              >
                {category.slice(0, 1).toUpperCase() + category.slice(1)}
              </button>
            ),
          )}
        </div>
        {(activityCategory === "all" || activityCategory === "attention") &&
        (blockedProjects.length || problemAgents.length) ? (
          <section
            className="activity-section"
            aria-labelledby="attention-title"
          >
            <header>
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <h2 id="attention-title">Needs attention</h2>
                <p>
                  {blockedProjects.length} blocked Project
                  {blockedProjects.length === 1 ? "" : "s"}
                </p>
              </div>
            </header>
            <div className="activity-rows">
              {blockedProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    selectProject(project.id);
                    onNavigate("projects");
                  }}
                >
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.blocker}</small>
                  </span>
                  <span>Review blocker</span>
                </button>
              ))}
              {problemAgents.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => {
                    setAgents((current) => ({
                      ...current,
                      activeSessionId: session.id,
                    }));
                    onOpenAgentPanel();
                  }}
                >
                  <span>
                    <strong>{session.objective}</strong>
                    <small>
                      {session.error?.message ?? `Session is ${session.state}`}
                    </small>
                  </span>
                  <span>Review run</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {activityCategory === "all" || activityCategory === "runs" ? (
          <section className="activity-section" aria-labelledby="runs-title">
            <header>
              <Sparkles size={18} aria-hidden="true" />
              <div>
                <h2 id="runs-title">Agent runs</h2>
                <p>{activityAgents.length} persisted local sessions</p>
              </div>
            </header>
            {activityAgents.length ? (
              <div className="activity-rows">
                {activityAgents.map((session) => (
                  <button
                    type="button"
                    key={session.id}
                    onClick={() => {
                      setAgents((current) => ({
                        ...current,
                        activeSessionId: session.id,
                      }));
                      onOpenAgentPanel();
                    }}
                  >
                    <span>
                      <strong>{session.objective}</strong>
                      <small>{session.currentAction ?? session.state}</small>
                    </span>
                    <span>{session.state}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="activity-section-empty">No agent runs yet.</p>
            )}
          </section>
        ) : null}
        {activityCategory === "all" || activityCategory === "changes" ? (
          <section className="activity-section" aria-labelledby="changes-title">
            <header>
              <GitBranch size={18} aria-hidden="true" />
              <div>
                <h2 id="changes-title">Changes</h2>
                <p>
                  {git?.changes.length ?? 0} working-tree changes in{" "}
                  {workspace.name}
                </p>
              </div>
            </header>
            {git?.changes.length ? (
              <div className="activity-rows">
                {git.changes.slice(0, 8).map((change) => (
                  <button
                    key={`${change.staged ? "staged" : "working"}:${change.path}`}
                    type="button"
                    onClick={() => {
                      onNavigate("source-control");
                    }}
                  >
                    <span>
                      <strong>{change.path}</strong>
                      <small>{change.staged ? "Staged" : "Working tree"}</small>
                    </span>
                    <span>{change.status}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="activity-section-empty">No local file changes.</p>
            )}
          </section>
        ) : null}
        {activityCategory === "all" ? (
          <section
            className="activity-connections"
            aria-labelledby="connections-title"
          >
            <h2 id="connections-title">Connections</h2>
            <div>
              <span>
                <Sparkles size={17} aria-hidden="true" />
              </span>
              <p>
                <strong>Agent provider</strong>
                <small>
                  {agentAvailability.reason ??
                    "Codex App Server is ready for managed sessions"}
                </small>
              </p>
              <span
                className="status-label"
                data-status={
                  agentAvailability.status === "available" ? "active" : "paused"
                }
              >
                {agentAvailability.status === "available"
                  ? "Available"
                  : "Unavailable"}
              </span>
            </div>
            <div>
              <span>
                <CalendarDays size={17} aria-hidden="true" />
              </span>
              <p>
                <strong>External calendar sync</strong>
                <small>
                  Local planning works without a provider connection
                </small>
              </p>
              <span className="status-label" data-status="paused">
                Disconnected
              </span>
            </div>
          </section>
        ) : null}
        {activityCategory === "all" || activityCategory === "history" ? (
          <section className="activity-section" aria-labelledby="history-title">
            <header>
              <BookOpen size={18} aria-hidden="true" />
              <div>
                <h2 id="history-title">History</h2>
                <p>Persisted, redacted application events</p>
              </div>
            </header>
            {auditActivity.items.length ? (
              <div className="activity-rows">
                {auditActivity.items.map((item) => (
                  <div className="activity-history-row" key={item.id}>
                    <span>
                      <strong>{activitySubject(item.payload)}</strong>
                      <small>{eventLabel(item.eventType)}</small>
                    </span>
                    <time dateTime={item.timestamp}>
                      {new Date(item.timestamp).toLocaleString()}
                    </time>
                  </div>
                ))}
              </div>
            ) : (
              <p className="activity-section-empty">
                No persisted Activity yet.
              </p>
            )}
          </section>
        ) : null}
      </section>,
    );
  }

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
        ipc={ipc}
        toolStatuses={toolStatuses}
        formatting={formatting}
        analyzing={analyzing}
        onFormat={() => {
          void formatDocument();
        }}
        onAnalyze={() => {
          void analyzeWorkspace();
        }}
        {...(editorLocation?.line === undefined
          ? {}
          : { line: editorLocation.line, column: editorLocation.column })}
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
        sessionSource={agentSource}
        defaultSandbox={integrationSettings.codex.defaultSandbox}
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
          <GitDiffEditor
            {...(gitDiff.data.original === undefined
              ? {}
              : { original: gitDiff.data.original })}
            {...(gitDiff.data.modified === undefined
              ? {}
              : { modified: gitDiff.data.modified })}
            originalLabel={gitDiff.data.originalLabel}
            modifiedLabel={gitDiff.data.modifiedLabel}
            language={languageForPath(gitDiff.path)}
            {...(gitDiff.data.fallback
              ? { fallback: gitDiff.data.fallback }
              : {})}
            binary={gitDiff.data.binary}
            oversized={gitDiff.data.oversized}
          />
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
      <PlannerWorkspace
        ipc={ipc}
        {...(brainWorkspaceId ? { brainWorkspaceId } : {})}
        initialView="tasks"
        onOpenSettings={() => {
          onNavigate("settings");
        }}
      />,
    );

  if (activity === "calendar")
    return surface(
      <PlannerWorkspace
        ipc={ipc}
        {...(brainWorkspaceId ? { brainWorkspaceId } : {})}
        view={plannerView}
        onViewChange={onPlannerViewChange}
        onOpenSettings={() => {
          onNavigate("settings");
        }}
      />,
    );

  if (activity === "graph")
    return surface(
      <FocusedGraph
        page={graph}
        theme={resolvedTheme}
        onExpand={(nodeId) => expandGraphNode(nodeId)}
        onCommand={handleGraphCommand}
        onSelectionContextChange={onGraphSelectionContextChange}
      />,
    );

  if (activity === "settings")
    return surface(
      <section className="workspace-settings" aria-labelledby="settings-title">
        <header className="settings-heading">
          <div>
            <p className="eyebrow">Settings</p>
            <h1 id="settings-title">Application settings</h1>
            <p>
              Configure your workspace, connected services, and agent runtime.
            </p>
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
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={formatOnSave}
              onChange={(event) => {
                setFormatOnSave(event.target.checked);
              }}
            />
            <span>
              <strong>Format code on save</strong>
              <small>Off by default. Uses the detected local formatter.</small>
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
        <fieldset className="settings-group settings-integration-group">
          <legend>Google Calendar &amp; Tasks</legend>
          <div className="settings-integration-heading">
            <div>
              <strong>Google workspace connection</strong>
              <p>
                Add the desktop OAuth client used for calendar and task sync.
              </p>
            </div>
            <span
              className="status-label"
              data-status={
                googleStatus?.state === "connected"
                  ? "active"
                  : googleStatus?.state === "connecting"
                    ? "waiting"
                    : googleStatus?.state === "error"
                      ? "failed"
                      : "paused"
              }
            >
              {googleStatus?.state === "connected"
                ? "Connected"
                : googleStatus?.state === "connecting"
                  ? "Connecting"
                  : integrationDraft.google.oauthClientId?.trim() &&
                      googleClientSecretConfigured
                    ? "Ready to connect"
                    : "Not configured"}
            </span>
          </div>
          <label className="settings-field">
            <span>
              <strong>OAuth client ID</strong>
              <small>
                Create a Desktop app credential in Google Cloud, then paste its
                client ID here. Secrets and tokens are never stored in notes.
              </small>
            </span>
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              value={integrationDraft.google.oauthClientId ?? ""}
              placeholder="123456789.apps.googleusercontent.com"
              onChange={(event) => {
                setIntegrationMessage(undefined);
                setIntegrationDraft((current) => ({
                  ...current,
                  google: {
                    ...current.google,
                    oauthClientId: event.target.value || null,
                  },
                }));
              }}
            />
          </label>
          <label className="settings-field">
            <span>
              <strong>OAuth client secret</strong>
              <small>
                Paste the client_secret from the downloaded Desktop OAuth JSON.
                It is stored only in Windows Credential Manager. Leave this
                blank to keep the saved secret.
              </small>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              maxLength={512}
              value={googleClientSecret}
              placeholder={
                googleClientSecretConfigured
                  ? "Saved in Windows Credential Manager"
                  : "Paste the matching client secret"
              }
              onChange={(event) => {
                setIntegrationMessage(undefined);
                setGoogleClientSecret(event.target.value);
              }}
            />
          </label>
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>
                <strong>Google access</strong>
                <small>Start read-only and enable writes deliberately.</small>
              </span>
              <select
                value={integrationDraft.google.consentMode}
                onChange={(event) => {
                  setIntegrationMessage(undefined);
                  setIntegrationDraft((current) => ({
                    ...current,
                    google: {
                      ...current.google,
                      consentMode:
                        event.target.value === "read_write"
                          ? "read_write"
                          : "read_only",
                    },
                  }));
                }}
              >
                <option value="read_only">Read only</option>
                <option value="read_write">Read and write</option>
              </select>
            </label>
            <div className="settings-service-toggles">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={integrationDraft.google.calendarEnabled}
                  onChange={(event) => {
                    setIntegrationMessage(undefined);
                    setIntegrationDraft((current) => ({
                      ...current,
                      google: {
                        ...current.google,
                        calendarEnabled: event.target.checked,
                      },
                    }));
                  }}
                />
                <span>
                  <strong>Google Calendar</strong>
                  <small>Include calendar events in Planner.</small>
                </span>
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={integrationDraft.google.tasksEnabled}
                  onChange={(event) => {
                    setIntegrationMessage(undefined);
                    setIntegrationDraft((current) => ({
                      ...current,
                      google: {
                        ...current.google,
                        tasksEnabled: event.target.checked,
                      },
                    }));
                  }}
                />
                <span>
                  <strong>Google Tasks</strong>
                  <small>Include Google tasks in Planner.</small>
                </span>
              </label>
            </div>
          </div>
          <div className="settings-connection-card">
            <div>
              <strong>
                {googleStatus?.message ?? "Checking Google connection…"}
              </strong>
              <small>
                {googleStatus?.lastSyncedAt
                  ? `Last synced ${new Date(googleStatus.lastSyncedAt).toLocaleString()}`
                  : "No Google data has been synced yet."}
              </small>
            </div>
            <div className="settings-connection-actions">
              {googleStatus?.connected ? (
                <>
                  <button
                    type="button"
                    className="button button-small"
                    disabled={!brainWorkspaceId || Boolean(googleAction)}
                    onClick={() => void syncGoogle()}
                  >
                    {googleAction === "sync" ? "Syncing…" : "Sync now"}
                  </button>
                  <button
                    type="button"
                    className="button button-small button-danger-quiet"
                    disabled={Boolean(googleAction)}
                    onClick={() => void disconnectGoogle()}
                  >
                    {googleAction === "disconnect"
                      ? "Disconnecting…"
                      : "Disconnect"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button button-primary button-small"
                  disabled={
                    !brainWorkspaceId ||
                    !integrationDraft.google.oauthClientId?.trim() ||
                    !googleClientSecretConfigured ||
                    (!integrationDraft.google.calendarEnabled &&
                      !integrationDraft.google.tasksEnabled) ||
                    Boolean(googleAction)
                  }
                  onClick={() => void connectGoogle()}
                >
                  {googleAction === "connect"
                    ? "Waiting for Google…"
                    : "Connect Google"}
                </button>
              )}
            </div>
          </div>
          <p className="settings-integration-note">
            Sign-in opens in your default browser and returns through a private
            loopback callback. The OAuth client secret and refresh token are
            stored in Windows Credential Manager; your local planner remains
            available offline.
          </p>
        </fieldset>
        <fieldset className="settings-group settings-integration-group">
          <legend>Codex</legend>
          <div className="settings-integration-heading">
            <div>
              <strong>Managed agent runtime</strong>
              <p>
                Second Brain uses the supported local Codex App Server for agent
                sessions.
              </p>
            </div>
            <span
              className="status-label"
              data-status={
                codexProbe?.status === "available" ? "active" : "paused"
              }
            >
              {codexProbe?.status === "available" ? "Ready" : "Needs setup"}
            </span>
          </div>
          <dl className="settings-rows settings-runtime-rows">
            <div>
              <dt>Installed runtime</dt>
              <dd>
                {codexProbe?.version ?? codexProbe?.reason ?? "Checking…"}
              </dd>
            </div>
          </dl>
          <div className="settings-form-grid settings-codex-controls">
            <label className="settings-field">
              <span>
                <strong>Default agent access</strong>
                <small>You can still change access before each run.</small>
              </span>
              <select
                value={integrationDraft.codex.defaultSandbox}
                onChange={(event) => {
                  setIntegrationMessage(undefined);
                  setIntegrationDraft((current) => ({
                    ...current,
                    codex: {
                      defaultSandbox:
                        event.target.value === "workspace_write"
                          ? "workspace_write"
                          : "read_only",
                    },
                  }));
                }}
              >
                <option value="read_only">Read only</option>
                <option value="workspace_write">Workspace write</option>
              </select>
            </label>
            <div className="settings-runtime-action">
              <span>
                <strong>Sign in or update Codex</strong>
                <small>
                  Opens the protected Codex terminal inside this app.
                </small>
              </span>
              <button
                type="button"
                className="button"
                disabled={!workspace.canUseTerminal}
                onClick={() => {
                  onOpenTerminal({
                    workspaceId: workspace.id,
                    relativePath: "",
                    preset: "codex",
                  });
                }}
              >
                Open Codex setup
              </button>
            </div>
          </div>
        </fieldset>
        <div className="settings-save-row">
          <p
            role={integrationMessage?.kind === "error" ? "alert" : "status"}
            data-kind={integrationMessage?.kind}
          >
            {integrationLoading
              ? "Loading integration settings…"
              : (integrationMessage?.text ??
                "Configuration is stored locally for this installation.")}
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={integrationLoading || integrationSaving}
            onClick={() => void saveIntegrationSettings()}
          >
            {integrationSaving ? "Saving…" : "Save integration settings"}
          </button>
        </div>
      </section>,
    );

  const activeProjects = projects.filter(({ status }) => status === "active");
  const attentionProjects = activeProjects.filter(({ blocker }) => blocker);
  const currentAgentSessions =
    agents.workspaceId === workspace.id ? agents.sessions : [];
  const attentionAgents = currentAgentSessions.filter(({ state }) =>
    ["waiting", "failed", "recoverable"].includes(state),
  );
  const recentRuns = currentAgentSessions.slice(0, 3);
  const todayPlannerItems = homePlannerItems.filter(
    (item) =>
      item.status !== "archived" && plannerDate(item) === localDateKey(),
  );
  return surface(
    <section className="home-workspace" aria-labelledby="home-title">
      <header className="home-heading">
        <div>
          <p className="eyebrow">Control center</p>
          <h1 id="home-title">What should move forward?</h1>
          <p>
            Pick up active work, capture a thought, or ask for help without
            hunting through the interface.
          </p>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={onCreateProject}
        >
          <Plus size={16} aria-hidden="true" /> Create Project
        </button>
      </header>

      <section className="home-ask" aria-labelledby="home-ask-title">
        <h2 className="sr-only" id="home-ask-title">
          Ask Second Brain
        </h2>
        <AgentComposer
          workspaceId={workspace.id}
          source={agentSource}
          defaultSandbox={integrationSettings.codex.defaultSandbox}
          onStarted={(session) => {
            setAgents((current) => ({
              workspaceId: workspace.id,
              sessions:
                current.workspaceId === workspace.id
                  ? [
                      ...current.sessions.filter(({ id }) => id !== session.id),
                      session,
                    ]
                  : [session],
              activeSessionId: session.id,
            }));
            onOpenAgentPanel();
          }}
        />
      </section>

      {projectsLoading && !projects.length ? (
        <section className="home-first-run" aria-live="polite">
          <div>
            <p className="eyebrow">Projects</p>
            <h2>Loading your control center…</h2>
          </div>
        </section>
      ) : !projects.length ? (
        <section className="home-first-run" aria-labelledby="first-run-title">
          <div>
            <p className="eyebrow">Start here</p>
            <h2 id="first-run-title">Build your first working context</h2>
            <p>
              A Project connects an outcome to its files, plan, progress, and
              agent instructions. It can start without a folder.
            </p>
            <button
              type="button"
              className="button button-primary"
              onClick={onCreateProject}
            >
              Create your first Project
            </button>
          </div>
          <ol>
            <li>
              <span>1</span>
              <p>
                <strong>Name the outcome</strong>
                <small>Make success concrete.</small>
              </p>
            </li>
            <li>
              <span>2</span>
              <p>
                <strong>Connect files when ready</strong>
                <small>Folder access stays explicit.</small>
              </p>
            </li>
            <li>
              <span>3</span>
              <p>
                <strong>Add a next milestone</strong>
                <small>Home keeps it visible.</small>
              </p>
            </li>
          </ol>
        </section>
      ) : null}

      {attentionProjects.length || attentionAgents.length ? (
        <section
          className="home-section home-attention"
          aria-labelledby="home-attention-title"
        >
          <header>
            <div>
              <p className="eyebrow">Needs attention</p>
              <h2 id="home-attention-title">Clear the blockers</h2>
            </div>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                onNavigate("activity");
              }}
            >
              View Activity
            </button>
          </header>
          {attentionProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => {
                selectProject(project.id);
                onNavigate("projects");
              }}
            >
              <AlertTriangle size={17} aria-hidden="true" />
              <span>
                <strong>{project.name}</strong>
                <small>{project.blocker}</small>
              </span>
              <span>Review</span>
            </button>
          ))}
          {attentionAgents.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                setAgents((current) => ({
                  ...current,
                  activeSessionId: session.id,
                }));
                onOpenAgentPanel();
              }}
            >
              <Sparkles size={17} aria-hidden="true" />
              <span>
                <strong>{session.objective}</strong>
                <small>
                  {session.state === "waiting"
                    ? "Waiting for approval"
                    : (session.error?.message ?? `Session is ${session.state}`)}
                </small>
              </span>
              <span>Review run</span>
            </button>
          ))}
        </section>
      ) : null}

      {activeProjects.length ? (
        <section
          className="home-section"
          aria-labelledby="active-projects-title"
        >
          <header>
            <div>
              <p className="eyebrow">Active Projects</p>
              <h2 id="active-projects-title">Keep momentum</h2>
            </div>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                onNavigate("projects");
              }}
            >
              All Projects
            </button>
          </header>
          <div className="home-project-list">
            {activeProjects.slice(0, 5).map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  selectProject(project.id);
                  onNavigate("projects");
                }}
              >
                <span className="home-project-title">
                  <strong>{project.name}</strong>
                  <small>{project.outcome}</small>
                </span>
                <span className="home-project-next">
                  <small>Next milestone</small>
                  {project.nextMilestone ?? "Set the next milestone"}
                </span>
                <span className="home-project-progress">
                  <span>
                    <span
                      style={{ width: `${String(project.progressPercent)}%` }}
                    />
                  </span>
                  <small>{project.progressPercent}%</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {recentRuns.length ? (
        <section className="home-section" aria-labelledby="recent-runs-title">
          <header>
            <div>
              <p className="eyebrow">Agent runs</p>
              <h2 id="recent-runs-title">Recent delegated work</h2>
            </div>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                onOpenAgentPanel();
              }}
            >
              All runs
            </button>
          </header>
          <div className="home-run-list">
            {recentRuns.map((session) => (
              <button
                type="button"
                key={session.id}
                onClick={() => {
                  setAgents((current) => ({
                    ...current,
                    activeSessionId: session.id,
                  }));
                  onOpenAgentPanel();
                }}
              >
                <span>
                  <strong>{session.objective}</strong>
                  <small>{session.currentAction ?? session.state}</small>
                </span>
                <span className="status-label" data-status={session.state}>
                  {session.state}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className="home-section home-today"
        aria-labelledby="today-title"
      >
        <header>
          <div>
            <p className="eyebrow">Today</p>
            <h2 id="today-title">Capture and plan</h2>
          </div>
        </header>
        {todayPlannerItems.length ? (
          <div className="home-planner-list" aria-label="Today’s plan">
            {todayPlannerItems.slice(0, 5).map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  onNavigate("calendar");
                }}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.projectId ? "Project work" : "Personal plan"}
                  </small>
                </span>
                <span>{item.status.replaceAll("_", " ")}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="home-today-empty">Nothing scheduled for today.</p>
        )}
        <div className="home-inline-actions">
          <button type="button" onClick={createDailyNote}>
            <BookOpen size={17} aria-hidden="true" />
            <span>
              <strong>Today’s note</strong>
              <small>Open notes/today.md</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setNewNoteOpen(true);
            }}
          >
            <Plus size={17} aria-hidden="true" />
            <span>
              <strong>New note</strong>
              <small>Capture a thought in Markdown</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onNavigate("calendar");
            }}
          >
            <CalendarDays size={17} aria-hidden="true" />
            <span>
              <strong>Calendar</strong>
              <small>Open local planning</small>
            </span>
          </button>
        </div>
      </section>
      {document ? (
        <section className="home-section" aria-labelledby="resume-title">
          <header>
            <div>
              <p className="eyebrow">Resume</p>
              <h2 id="resume-title">Continue where you left off</h2>
            </div>
          </header>
          <button
            type="button"
            className="home-resume"
            onClick={() => {
              onNavigate(
                isMarkdown(document.relativePath) ? "knowledge" : "files",
              );
            }}
          >
            <BookOpen size={18} aria-hidden="true" />
            <span>
              <strong>{document.relativePath.split("/").at(-1)}</strong>
              <small>{document.relativePath}</small>
            </span>
            <span>Open</span>
          </button>
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>,
  );
}
