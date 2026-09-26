import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  CirclePause,
  FolderOpen,
  Map,
  Play,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { ConfirmDialog } from "../../components/common/ModalDialog";
import type {
  ActivityItem,
  IpcClient,
  ProjectRecord,
  WorkspaceGraphPage,
} from "../../lib/ipc";
import type { Activity, ProjectView } from "../../state/shell";
import { useProjects } from "../../state/projects";
import { useTheme } from "../../state/theme";

const FocusedGraph = lazy(async () => ({
  default: (await import("../graph")).FocusedGraph,
}));
const PlannerWorkspace = lazy(async () => ({
  default: (await import("../planner")).PlannerWorkspace,
}));

function formatUpdated(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently updated";
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round((timestamp - Date.now()) / 86_400_000),
    "day",
  );
}

function ProjectRow({
  project,
  onOpen,
}: {
  project: ProjectRecord;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="project-row" onClick={onOpen}>
      <span className="project-row-main">
        <strong>{project.name}</strong>
        <span>{project.outcome}</span>
      </span>
      <span className="project-row-progress">
        <span>
          <span style={{ width: `${String(project.progressPercent)}%` }} />
        </span>
        <small>{project.progressPercent}%</small>
      </span>
      <span className="project-row-next">
        <small>Next</small>
        {project.nextMilestone ?? "Set a milestone"}
      </span>
      <span className="project-row-meta">
        <span className="status-label" data-status={project.status}>
          {project.status}
        </span>
        <small>{formatUpdated(project.updatedAt)}</small>
      </span>
    </button>
  );
}

function ProjectEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="projects-empty" aria-labelledby="projects-empty-title">
      <p className="eyebrow">Your control center starts here</p>
      <h2 id="projects-empty-title">Create your first Project</h2>
      <p>
        Give a meaningful outcome a home, then connect its files, plan, and
        agent instructions when you are ready.
      </p>
      <button
        type="button"
        className="button button-primary"
        onClick={onCreate}
      >
        <Plus size={16} aria-hidden="true" />
        Create Project
      </button>
    </section>
  );
}

function ProjectList({ onCreate }: { onCreate: () => void }) {
  const { error, loading, projects, selectProject } = useProjects();
  const [status, setStatus] = useState<"active" | "paused" | "archived">(
    "active",
  );
  const filtered = projects.filter((project) => project.status === status);
  return (
    <section className="projects-workspace" aria-labelledby="projects-title">
      <header className="projects-header">
        <div>
          <p className="eyebrow">Projects</p>
          <h1 id="projects-title">Move meaningful work forward</h1>
          <p>Outcomes, next milestones, files, and agent work in one place.</p>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={onCreate}
        >
          <Plus size={16} aria-hidden="true" />
          Create Project
        </button>
      </header>
      <div
        className="projects-status-tabs"
        role="group"
        aria-label="Filter Projects by status"
      >
        {(["active", "paused", "archived"] as const).map((value) => (
          <button
            type="button"
            aria-pressed={status === value}
            key={value}
            onClick={() => {
              setStatus(value);
            }}
          >
            {value.slice(0, 1).toUpperCase() + value.slice(1)}
            <span>
              {projects.filter((project) => project.status === value).length}
            </span>
          </button>
        ))}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !projects.length ? (
        <div className="projects-loading" role="status">
          Loading Projects…
        </div>
      ) : !projects.length && status === "active" ? (
        <ProjectEmpty onCreate={onCreate} />
      ) : filtered.length ? (
        <div className="project-list" role="list">
          <div className="project-list-heading" aria-hidden="true">
            <span>Project</span>
            <span>Progress</span>
            <span>Next milestone</span>
            <span>Status</span>
          </div>
          {filtered.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              onOpen={() => {
                selectProject(project.id);
              }}
            />
          ))}
        </div>
      ) : (
        <section className="projects-filter-empty">
          <h2>No {status} Projects</h2>
          <p>Projects with this status will appear here.</p>
        </section>
      )}
    </section>
  );
}

function ProjectOverview({ project }: { project: ProjectRecord }) {
  const { error, loading, setProjectStatus, updateProject } = useProjects();
  const [progress, setProgress] = useState(project.progressPercent);
  const [nextMilestone, setNextMilestone] = useState(
    project.nextMilestone ?? "",
  );
  const [blocker, setBlocker] = useState(project.blocker ?? "");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const changed =
    progress !== project.progressPercent ||
    nextMilestone !== (project.nextMilestone ?? "") ||
    blocker !== (project.blocker ?? "");
  return (
    <div className="project-overview">
      <section
        className="project-outcome"
        aria-labelledby="project-outcome-title"
      >
        <p className="eyebrow">Outcome</p>
        <h2 id="project-outcome-title">{project.outcome}</h2>
        <div className="project-overview-progress">
          <label htmlFor="project-progress">Progress</label>
          <input
            id="project-progress"
            type="range"
            min="0"
            max="100"
            value={progress}
            onChange={(event) => {
              setProgress(Number(event.target.value));
            }}
          />
          <output htmlFor="project-progress">{progress}%</output>
        </div>
      </section>
      <div className="project-overview-grid">
        <section>
          <label htmlFor="project-next-milestone">Next milestone</label>
          <textarea
            id="project-next-milestone"
            rows={3}
            maxLength={1000}
            value={nextMilestone}
            onChange={(event) => {
              setNextMilestone(event.target.value);
            }}
            placeholder="What concrete result comes next?"
          />
        </section>
        <section data-attention={blocker ? "true" : undefined}>
          <label htmlFor="project-blocker">Blocker</label>
          <textarea
            id="project-blocker"
            rows={3}
            maxLength={1000}
            value={blocker}
            onChange={(event) => {
              setBlocker(event.target.value);
            }}
            placeholder="No blocker"
          />
        </section>
      </div>
      <div className="project-overview-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={loading || !changed}
          onClick={() =>
            void updateProject(project.id, {
              progressPercent: progress,
              nextMilestone: nextMilestone.trim() || null,
              blocker: blocker.trim() || null,
            })
          }
        >
          {loading ? "Saving…" : "Save current state"}
        </button>
        {project.status === "paused" ? (
          <button
            className="button"
            type="button"
            disabled={loading}
            onClick={() => void setProjectStatus(project.id, "active")}
          >
            <Play size={15} aria-hidden="true" /> Resume Project
          </button>
        ) : (
          <button
            className="button"
            type="button"
            disabled={loading}
            onClick={() => void setProjectStatus(project.id, "paused")}
          >
            <CirclePause size={15} aria-hidden="true" /> Pause Project
          </button>
        )}
        <button
          className="button button-danger-quiet"
          type="button"
          disabled={loading}
          onClick={() => {
            setArchiveOpen(true);
          }}
        >
          <Archive size={15} aria-hidden="true" /> Archive
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={archiveOpen}
        title={`Archive ${project.name}?`}
        message="The Project card and linked files remain intact. You can restore it from Archived Projects."
        confirmLabel="Archive Project"
        dangerous
        busy={loading}
        onClose={() => {
          if (!loading) setArchiveOpen(false);
        }}
        onConfirm={() => {
          void setProjectStatus(project.id, "archived").then((updated) => {
            if (updated) setArchiveOpen(false);
          });
        }}
      />
    </div>
  );
}

function ProjectSettings({ project }: { project: ProjectRecord }) {
  const { error, loading, updateProject } = useProjects();
  const [outcome, setOutcome] = useState(project.outcome);
  const [instructions, setInstructions] = useState(project.instructions);
  const [tags, setTags] = useState(project.tags.join(", "));
  const changed =
    outcome !== project.outcome ||
    instructions !== project.instructions ||
    tags !== project.tags.join(", ");
  return (
    <section
      className="project-settings"
      aria-labelledby="project-settings-title"
    >
      <header>
        <p className="eyebrow">Project settings</p>
        <h2 id="project-settings-title">Scope and access</h2>
        <p>Keep the outcome, agent guidance, and linked location explicit.</p>
      </header>
      <label>
        Outcome
        <textarea
          rows={3}
          value={outcome}
          onChange={(event) => {
            setOutcome(event.target.value);
          }}
        />
      </label>
      <label>
        Agent instructions
        <textarea
          rows={6}
          value={instructions}
          onChange={(event) => {
            setInstructions(event.target.value);
          }}
        />
      </label>
      <label>
        Tags
        <input
          value={tags}
          onChange={(event) => {
            setTags(event.target.value);
          }}
        />
      </label>
      <div className="project-settings-location">
        <strong>Linked location</strong>
        <span>{project.location?.displayPath ?? "No folder connected"}</span>
        <small>Access is enforced by the linked workspace grant.</small>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button button-primary"
        disabled={loading || !changed || !outcome.trim()}
        onClick={() =>
          void updateProject(project.id, {
            outcome: outcome.trim(),
            instructions: instructions.trim(),
            tags: tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          })
        }
      >
        {loading ? "Saving…" : "Save Project settings"}
      </button>
    </section>
  );
}

function ProjectFiles({
  project,
  ipc,
}: {
  project: ProjectRecord;
  ipc: IpcClient;
}) {
  const workspaceId = project.location?.workspaceId;
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<
    Array<{ name: string; relativePath: string; kind: "file" | "directory" }>
  >([]);
  const [preview, setPreview] = useState<{ path: string; content: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!workspaceId) return;
    let current = true;
    void ipc.workspaces
      .listDirectory({ workspaceId, relativePath: directory })
      .then((result) => {
        if (!current) return;
        if (result.ok) {
          setEntries(
            result.data.entries.filter(
              (entry): entry is typeof entry & { kind: "file" | "directory" } =>
                entry.kind === "file" || entry.kind === "directory",
            ),
          );
          setError("");
        } else setError(result.error.message);
      });
    return () => {
      current = false;
    };
  }, [directory, ipc, workspaceId]);
  if (!workspaceId)
    return (
      <section className="project-view-empty">
        <FolderOpen aria-hidden="true" />
        <h2>No folder connected</h2>
        <p>This planning-only Project has no files yet.</p>
      </section>
    );
  return (
    <section className="project-files" aria-labelledby="project-files-title">
      <header>
        <div>
          <p className="eyebrow">Files</p>
          <h2 id="project-files-title">Project files</h2>
        </div>
        <button
          type="button"
          className="button button-small"
          disabled={!directory}
          onClick={() => {
            setDirectory(directory.split("/").slice(0, -1).join("/"));
          }}
        >
          Up one folder
        </button>
      </header>
      <div className="project-files-layout">
        <ul aria-label="Project file browser">
          {entries.map((entry) => (
            <li key={entry.relativePath}>
              <button
                type="button"
                onClick={() => {
                  if (entry.kind === "directory") {
                    setDirectory(entry.relativePath);
                    setPreview(undefined);
                    return;
                  }
                  void ipc.files
                    .readText({ workspaceId, relativePath: entry.relativePath })
                    .then((result) => {
                      if (result.ok) {
                        setPreview({
                          path: entry.relativePath,
                          content: result.data.content,
                        });
                        setError("");
                      } else setError(result.error.message);
                    });
                }}
              >
                {entry.kind === "directory" ? (
                  <FolderOpen size={15} aria-hidden="true" />
                ) : null}
                <span>{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="project-file-preview">
          {preview ? (
            <>
              <strong>{preview.path}</strong>
              <pre>{preview.content}</pre>
            </>
          ) : (
            <p>Select a text file to preview it without leaving the Project.</p>
          )}
        </div>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ProjectActivity({
  project,
  ipc,
}: {
  project: ProjectRecord;
  ipc: IpcClient;
}) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void ipc.activity
      .list({ projectId: project.id, limit: 50 })
      .then((result) => {
        if (!mounted) return;
        setLoading(false);
        if (result.ok) setItems(result.data.items);
        else setError(result.error.message);
      });
    return () => {
      mounted = false;
    };
  }, [ipc, project.id]);
  if (loading)
    return (
      <div className="project-view-loading" role="status">
        Loading Project Activity…
      </div>
    );
  if (error)
    return (
      <section className="project-view-empty">
        <h2>Project Activity is unavailable</h2>
        <p role="alert">{error}</p>
      </section>
    );
  if (!items.length)
    return (
      <section className="project-view-empty">
        <Sparkles size={22} aria-hidden="true" />
        <h2>No Project Activity yet</h2>
        <p>
          Project updates and linked file, Git, approval, and Run events will
          appear here when they occur.
        </p>
      </section>
    );
  return (
    <section
      className="project-activity"
      aria-labelledby="project-activity-title"
    >
      <header>
        <p className="eyebrow">Activity</p>
        <h2 id="project-activity-title">Project history</h2>
      </header>
      <div className="activity-rows">
        {items.map((item) => (
          <div className="activity-history-row" key={item.id}>
            <span>
              <strong>{item.eventType.replaceAll(".", " · ")}</strong>
              <small>{item.actorType}</small>
            </span>
            <time dateTime={item.timestamp}>
              {new Date(item.timestamp).toLocaleString()}
            </time>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectMap({
  project,
  ipc,
}: {
  project: ProjectRecord;
  ipc: IpcClient;
}) {
  const { resolvedTheme } = useTheme();
  const [page, setPage] = useState<WorkspaceGraphPage>({
    nodes: [],
    edges: [],
    truncated: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const workspaceId = project.location?.workspaceId;
  useEffect(() => {
    if (!workspaceId) return;
    let mounted = true;
    void ipc.knowledge.graph(workspaceId, "").then((result) => {
      if (!mounted) return;
      setLoading(false);
      if (result.ok) setPage(result.data);
      else setError(result.error.message);
    });
    return () => {
      mounted = false;
    };
  }, [ipc, workspaceId]);
  if (!workspaceId)
    return (
      <section className="project-view-empty">
        <Map size={22} aria-hidden="true" />
        <h2>Map needs Project files</h2>
        <p>Connect a folder to map this Project&apos;s resources.</p>
      </section>
    );
  if (loading)
    return (
      <div className="project-view-loading" role="status">
        Loading Project Map…
      </div>
    );
  if (error)
    return (
      <section className="project-view-empty">
        <h2>Project Map is unavailable</h2>
        <p role="alert">{error}</p>
      </section>
    );
  const visibleNodes = page.nodes
    .filter(({ label }) => label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 100);
  return (
    <section className="project-map" aria-labelledby="project-map-title">
      <header>
        <div>
          <p className="eyebrow">Map</p>
          <h2 id="project-map-title">Project relationships</h2>
        </div>
        <label>
          <span className="visually-hidden">Search Project Map</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Filter resources"
          />
        </label>
      </header>
      {page.nodes.length > 100 ? (
        <p className="project-map-warning" role="status">
          Showing the first 100 resources. Narrow the Project Map to see more.
        </p>
      ) : null}
      <div className="project-map-layout">
        <div className="project-map-canvas">
          <Suspense fallback={<div role="status">Loading map renderer…</div>}>
            <FocusedGraph
              page={{ ...page, nodes: page.nodes.slice(0, 100) }}
              hardCap={100}
              theme={resolvedTheme}
              selectedNodeId={selectedNodeId ?? null}
              onSelectionChange={setSelectedNodeId}
              onExpand={async (nodeId) => {
                const result = await ipc.knowledge.graph(
                  workspaceId,
                  "",
                  nodeId,
                );
                if (!result.ok) throw new Error(result.error.message);
                return result.data;
              }}
            />
          </Suspense>
        </div>
        <ul className="project-map-list" aria-label="Project Map resources">
          {visibleNodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                aria-pressed={selectedNodeId === node.id}
                onClick={() => {
                  setSelectedNodeId(node.id);
                }}
              >
                <span>{node.label}</span>
                <small>{node.type}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ProjectViewContent({
  project,
  view,
  onNavigate,
  ipc,
}: {
  project: ProjectRecord;
  view: ProjectView;
  onNavigate: (activity: Activity) => void;
  ipc: IpcClient;
}) {
  const { brainWorkspaceId } = useProjects();
  if (view === "overview")
    return <ProjectOverview key={project.id} project={project} />;
  if (view === "settings")
    return <ProjectSettings key={project.id} project={project} />;
  if (view === "files") return <ProjectFiles project={project} ipc={ipc} />;
  if (view === "plan" || view === "work")
    return (
      <Suspense
        fallback={
          <div className="project-view-loading" role="status">
            Loading Project plan…
          </div>
        }
      >
        <PlannerWorkspace
          key={view}
          ipc={ipc}
          {...(brainWorkspaceId ? { brainWorkspaceId } : {})}
          projectId={project.id}
          projectName={project.name}
          initialView={view === "work" ? "tasks" : "month"}
          onOpenSettings={() => {
            onNavigate("settings");
          }}
        />
      </Suspense>
    );
  if (view === "activity")
    return <ProjectActivity project={project} ipc={ipc} />;
  return <ProjectMap project={project} ipc={ipc} />;
}

export function ProjectsWorkspace({
  view,
  onViewChange = () => undefined,
  onCreate,
  onNavigate,
  ipc,
}: {
  view: ProjectView;
  onViewChange?: (view: ProjectView) => void;
  onCreate: () => void;
  onNavigate: (activity: Activity) => void;
  ipc: IpcClient;
}) {
  const { activeProject, projects, selectProject } = useProjects();
  const project = useMemo(
    () => projects.find(({ id }) => id === activeProject?.id),
    [activeProject?.id, projects],
  );
  if (!project) return <ProjectList onCreate={onCreate} />;
  return (
    <article className="project-workspace" aria-labelledby="project-title">
      <header className="project-header">
        <button
          type="button"
          className="project-back"
          onClick={() => {
            selectProject(undefined);
          }}
        >
          <ArrowLeft size={15} aria-hidden="true" /> All Projects
        </button>
        <div>
          <span className="status-label" data-status={project.status}>
            {project.status}
          </span>
          <h1 id="project-title">{project.name}</h1>
          <p>{project.location?.displayPath ?? "No folder connected"}</p>
        </div>
        <button
          type="button"
          className="button button-small project-settings-button"
          onClick={() => {
            onViewChange("settings");
          }}
        >
          <Settings size={15} aria-hidden="true" /> Settings
        </button>
      </header>
      <ProjectViewContent
        project={project}
        view={view}
        onNavigate={onNavigate}
        ipc={ipc}
      />
    </article>
  );
}
