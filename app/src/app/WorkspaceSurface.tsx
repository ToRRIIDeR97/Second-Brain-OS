import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AgentWorkspace, type AgentWorkspaceState } from "../features/agents";
import { MarkdownEditor } from "../features/editor/markdown";
import { SourceEditor, type EditorTabState } from "../features/editor/source";
import {
  FocusedGraph,
  type GraphCommand,
  type GraphCommandContext,
  type GraphPage,
} from "../features/graph";
import { DerivedReviewQueue } from "../features/knowledge/derived/DerivedReviewQueue";
import { KnowledgeSearchModal, type SearchResponse } from "../features/search";
import {
  SourceControlWorkspace,
  type SourceControlChange,
} from "../features/source-control";
import type {
  CommandResult,
  GitWorkspaceStatus,
  IpcClient,
  WorkspaceDirectoryEntry,
  WorkspaceKind,
  WorkspaceSummary,
  WorkspaceTrustLevel,
} from "../lib/ipc";
import type { Activity } from "../state/shell";

type OpenDocument = {
  workspaceId: string;
  relativePath: string;
  content: string;
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
          Folder path
          <input
            required
            value={rootPath}
            onChange={(event) => {
              setRootPath(event.target.value);
            }}
            placeholder="/Users/you/Documents/My Brain"
          />
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
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "Opening…" : "Open workspace"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
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
}: {
  document: OpenDocument;
  canWrite: boolean;
  saving: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
}) {
  const tab: EditorTabState = {
    resourceId: `${document.workspaceId}:${document.relativePath}`,
    modelUri: `second-brain://${document.workspaceId}/${document.relativePath}`,
    workspaceId: document.workspaceId,
    relativePath: document.relativePath,
    language: fileLanguage(document.relativePath),
    encoding: document.encoding,
    eol: document.eol,
    status: "clean",
    content: document.content,
    baseHash: document.baseHash,
    baseRevisionId: document.baseRevisionId,
    baseContent: document.content,
    externalChange: "none",
    openRequest: 1,
  };
  return (
    <section
      className="document-editor"
      aria-label={`Editor for ${document.relativePath}`}
    >
      <header>
        <div>
          <p className="eyebrow">
            {canWrite ? "Editable" : "Read-only workspace"}
          </p>
          <h1>{document.relativePath}</h1>
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
}: {
  activity: Activity;
  ipc: IpcClient;
  onOpenPalette: () => void;
  searchOpen?: boolean;
  onCloseSearch?: () => void;
  onNavigate?: (activity: Activity) => void;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<WorkspaceDirectoryEntry[]>([]);
  const [document, setDocument] = useState<OpenDocument>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState<SearchResponse>(emptySearch);
  const [graph, setGraph] = useState<GraphPage>({
    nodes: [],
    edges: [],
    truncated: false,
  });
  const [git, setGit] = useState<GitWorkspaceStatus>();
  const [agents, setAgents] = useState<AgentWorkspaceState>({
    workspaceId: "",
    sessions: [],
    activeSessionId: null,
  });
  const workspace = workspaces.find((item) => item.id === workspaceId);

  const refreshWorkspaces = useCallback(async () => {
    setLoading(true);
    const result = await ipc.workspaces.list();
    if (!isSuccess(result) || !Array.isArray(result.data)) {
      setError(
        errorMessage(result) || "The desktop workspace bridge is unavailable.",
      );
      setLoading(false);
      return;
    }
    setWorkspaces(result.data);
    setWorkspaceId((current) =>
      result.data.some((item) => item.id === current)
        ? current
        : result.data[0]?.id,
    );
    setError("");
    setLoading(false);
  }, [ipc]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshWorkspaces();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshWorkspaces]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("second-brain:collections", {
        detail: workspaces
          .filter(({ kind }) => kind === "collection")
          .map(({ id, name }) => ({ id, label: name })),
      }),
    );
  }, [workspaces]);

  useEffect(() => {
    const selectWorkspace = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail.id;
      if (!id || !workspaces.some((item) => item.id === id)) return;
      setWorkspaceId(id);
      setDirectory("");
      setDocument(undefined);
      onNavigate("knowledge");
    };
    window.addEventListener("second-brain:select-workspace", selectWorkspace);
    return () => {
      window.removeEventListener(
        "second-brain:select-workspace",
        selectWorkspace,
      );
    };
  }, [onNavigate, workspaces]);

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

  const registerWorkspace = async (registration: {
    name: string;
    rootPath: string;
    kind: WorkspaceKind;
    trustLevel: WorkspaceTrustLevel;
  }) => {
    setLoading(true);
    const result = await ipc.workspaces.register(registration);
    if (!isSuccess(result)) {
      setError(errorMessage(result));
      setLoading(false);
      return;
    }
    setWorkspaces((current) => [...current, result.data]);
    setWorkspaceId(result.data.id);
    setDirectory("");
    setError("");
    setLoading(false);
  };

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
        baseHash: result.data.contentHash,
        baseRevisionId: result.data.revisionId,
        encoding: result.data.encoding,
        eol: result.data.eol,
      });
      setError("");
    },
    [ipc, workspace],
  );

  const saveDocument = async () => {
    if (!document || !workspace) return;
    setSaving(true);
    const result = await ipc.files.writeText({
      path: {
        workspaceId: document.workspaceId,
        relativePath: document.relativePath,
      },
      content: document.content,
      baseHash: document.baseHash,
      baseContent: document.content,
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
            baseHash: result.data.contentHash,
            baseRevisionId: result.data.revisionId,
          }
        : current,
    );
    void refreshDirectory();
  };

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
    const openNote = (event: Event) => {
      const relativePath = (event as CustomEvent<{ relativePath?: string }>)
        .detail.relativePath;
      if (!relativePath) return;
      if (relativePath === "notes/today.md") createDailyNote();
      else {
        void openDocument(relativePath);
        onNavigate("knowledge");
      }
    };
    window.addEventListener("second-brain:open-note", openNote);
    return () => {
      window.removeEventListener("second-brain:open-note", openNote);
    };
  }, [createDailyNote, onNavigate, openDocument]);

  const refreshGit = useCallback(async () => {
    if (!workspace) return;
    const result = await ipc.git.status(workspace.id);
    if (isSuccess(result)) setGit(result.data);
    else setError(errorMessage(result));
  }, [ipc, workspace]);

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
      window.dispatchEvent(
        new CustomEvent("second-brain:open-terminal", {
          detail: {
            workspaceId: context.source.workspaceId,
            relativePath,
            preset:
              command === "graph.open-terminal"
                ? "shell"
                : (context.provider ?? "codex"),
          },
        }),
      );
    }
  };

  const surface = (content: ReactNode) => (
    <>
      {content}
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
        error={error}
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
          setDocument((current) => current && { ...current, content });
        }}
        onSave={() => {
          void saveDocument();
        }}
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
          window.dispatchEvent(
            new CustomEvent("second-brain:open-terminal", {
              detail: {
                workspaceId: workspace.id,
                relativePath,
                preset: action === "terminal" ? "shell" : action,
              },
            }),
          );
        }}
      />,
    );

  if (activity === "graph")
    return surface(
      <FocusedGraph
        page={graph}
        onExpand={(nodeId) => expandGraphNode(nodeId)}
        onCommand={handleGraphCommand}
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
    const mutate = async (
      operation: "stage" | "unstage" | "discard",
      path: string,
    ) => {
      const result =
        operation === "stage"
          ? await ipc.git.stage(workspace.id, [path])
          : operation === "unstage"
            ? await ipc.git.unstage(workspace.id, [path])
            : await ipc.git.discard(
                workspace.id,
                [path],
                window.confirm(`Discard changes to ${path}?`),
              );
      if (!isSuccess(result)) setError(errorMessage(result));
      else {
        void refreshGit();
      }
    };
    return surface(
      <SourceControlWorkspace
        {...(git?.branch === undefined ? {} : { branch: git.branch })}
        changes={changes}
        onStage={(path) => {
          void mutate("stage", path);
        }}
        onUnstage={(path) => {
          void mutate("unstage", path);
        }}
        onDiscard={(path) => {
          void mutate("discard", path);
        }}
      />,
    );
  }

  if (activity === "settings")
    return surface(
      <section className="workspace-settings" aria-labelledby="settings-title">
        <p className="eyebrow">Workspace settings</p>
        <h1 id="settings-title">{workspace.name}</h1>
        <p>
          Trust: {workspace.trustLevel.replaceAll("_", " ")} ·{" "}
          {workspace.canWrite ? "editing enabled" : "read-only"}
        </p>
        <button
          className="button"
          type="button"
          onClick={() => {
            void refreshWorkspaces();
          }}
        >
          Refresh workspaces
        </button>
      </section>,
    );

  const today = new Date().toLocaleDateString("en-CA");
  return surface(
    <section className="home-surface" aria-labelledby="home-title">
      <p className="eyebrow">{workspace.name}</p>
      <h1 id="home-title">Good to see you.</h1>
      <p className="workspace-lede">
        Capture what matters, see today at a glance, and follow the threads in
        your knowledge graph.
      </p>
      <div className="quick-actions">
        <button
          className="quick-action"
          type="button"
          onClick={createDailyNote}
        >
          <span>＋</span>
          <strong>Today’s note</strong>
          <small>Open notes/today.md</small>
        </button>
        <button
          className="quick-action"
          type="button"
          onClick={() => {
            const title = window.prompt("Note title")?.trim();
            if (!title) return;
            const slug = title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "");
            void createNote(`notes/${slug || "untitled"}.md`, title);
          }}
        >
          <span>✦</span>
          <strong>New note</strong>
          <small>Create a Markdown node in notes.</small>
        </button>
        <button className="quick-action" type="button" onClick={onOpenPalette}>
          <span>⌘⇧P</span>
          <strong>Commands</strong>
          <small>Open the action palette.</small>
        </button>
      </div>
      <div className="home-dashboard-grid">
        <section className="home-card" aria-labelledby="calendar-title">
          <p className="eyebrow">Calendar</p>
          <h2 id="calendar-title">Today</h2>
          <input type="date" defaultValue={today} aria-label="Calendar date" />
          <p>Connect Google Calendar to show your schedule here.</p>
        </section>
        <section className="home-card" aria-labelledby="tasks-title">
          <p className="eyebrow">Google Tasks</p>
          <h2 id="tasks-title">Tasks</h2>
          <p>Your Google task list will appear here after connection.</p>
          <button className="button button-small" type="button" disabled>
            Google connection required
          </button>
        </section>
      </div>
      <section className="home-graph" aria-labelledby="home-graph-title">
        <header>
          <p className="eyebrow">Knowledge graph</p>
          <h2 id="home-graph-title">This folder</h2>
        </header>
        <FocusedGraph
          page={graph}
          onExpand={(nodeId) => expandGraphNode(nodeId)}
          onCommand={handleGraphCommand}
        />
      </section>
      {error ? <p role="alert">{error}</p> : null}
      <DerivedReviewQueue artifacts={[]} />
    </section>,
  );
}
