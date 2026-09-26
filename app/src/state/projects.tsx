import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  IpcClient,
  ProjectCreateRequest,
  ProjectPatch,
  ProjectRecord,
  ProjectStatus,
} from "../lib/ipc";
import { useWorkspace } from "./workspace";

type ProjectsContextValue = {
  projects: ProjectRecord[];
  activeProjectId: string | undefined;
  activeProject: ProjectRecord | undefined;
  brainWorkspaceId: string | undefined;
  loading: boolean;
  error: string;
  selectProject: (projectId: string | undefined) => void;
  refreshProjects: () => Promise<void>;
  createProject: (
    input: Omit<ProjectCreateRequest, "brainWorkspaceId">,
  ) => Promise<ProjectRecord | undefined>;
  updateProject: (
    projectId: string,
    patch: ProjectPatch,
  ) => Promise<ProjectRecord | undefined>;
  setProjectStatus: (
    projectId: string,
    status: ProjectStatus,
  ) => Promise<ProjectRecord | undefined>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);
const activeProjectStorageKey = "second-brain-os.active-project.v1";

function readActiveProjectId() {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(activeProjectStorageKey) || undefined;
  } catch {
    return undefined;
  }
}

function message(result: { ok: boolean; error?: { message: string } }) {
  return result.ok
    ? ""
    : (result.error?.message ?? "The Project request failed.");
}

export function ProjectsProvider({
  ipc,
  children,
}: {
  ipc: IpcClient;
  children: ReactNode;
}) {
  const { workspaces, refreshWorkspaces } = useWorkspace();
  const brainWorkspaceId = workspaces.find(({ kind }) => kind === "brain")?.id;
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(
    readActiveProjectId,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refreshProjects = useCallback(async () => {
    if (!brainWorkspaceId) {
      setProjects([]);
      setActiveProjectId(undefined);
      setError("");
      return;
    }
    setLoading(true);
    const result = await ipc.projects.list(brainWorkspaceId);
    setLoading(false);
    if (!result.ok) {
      setError(message(result));
      return;
    }
    setProjects(result.data);
    setActiveProjectId((current) =>
      current && result.data.some(({ id }) => id === current)
        ? current
        : result.data.find(({ status }) => status === "active")?.id,
    );
    setError("");
  }, [brainWorkspaceId, ipc]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshProjects(), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshProjects]);

  useEffect(() => {
    try {
      if (activeProjectId)
        window.localStorage.setItem(activeProjectStorageKey, activeProjectId);
      else window.localStorage.removeItem(activeProjectStorageKey);
    } catch {
      // Project selection is convenient state, not canonical product data.
    }
  }, [activeProjectId]);

  const replaceProject = useCallback((project: ProjectRecord) => {
    setProjects((current) =>
      [...current.filter(({ id }) => id !== project.id), project].sort(
        (left, right) => right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
  }, []);

  const createProject = useCallback(
    async (input: Omit<ProjectCreateRequest, "brainWorkspaceId">) => {
      if (!brainWorkspaceId) {
        setError("Open a Brain workspace before creating a Project.");
        return undefined;
      }
      setLoading(true);
      const result = await ipc.projects.create({
        ...input,
        brainWorkspaceId,
      });
      setLoading(false);
      if (!result.ok) {
        setError(message(result));
        return undefined;
      }
      replaceProject(result.data);
      setActiveProjectId(result.data.id);
      setError("");
      if (result.data.location) await refreshWorkspaces();
      return result.data;
    },
    [brainWorkspaceId, ipc, refreshWorkspaces, replaceProject],
  );

  const updateProject = useCallback(
    async (projectId: string, patch: ProjectPatch) => {
      if (!brainWorkspaceId) return undefined;
      setLoading(true);
      const result = await ipc.projects.update(
        brainWorkspaceId,
        projectId,
        patch,
      );
      setLoading(false);
      if (!result.ok) {
        setError(message(result));
        return undefined;
      }
      replaceProject(result.data);
      setError("");
      return result.data;
    },
    [brainWorkspaceId, ipc, replaceProject],
  );

  const setProjectStatus = useCallback(
    async (projectId: string, status: ProjectStatus) => {
      if (!brainWorkspaceId) return undefined;
      setLoading(true);
      const result = await ipc.projects.setStatus(
        brainWorkspaceId,
        projectId,
        status,
      );
      setLoading(false);
      if (!result.ok) {
        setError(message(result));
        return undefined;
      }
      replaceProject(result.data);
      setError("");
      return result.data;
    },
    [brainWorkspaceId, ipc, replaceProject],
  );

  const selectProject = useCallback(
    (projectId: string | undefined) => {
      if (
        projectId === undefined ||
        projects.some(({ id }) => id === projectId)
      )
        setActiveProjectId(projectId);
    },
    [projects],
  );

  const activeProject = projects.find(({ id }) => id === activeProjectId);
  const value = useMemo(
    () => ({
      projects,
      activeProjectId,
      activeProject,
      brainWorkspaceId,
      loading,
      error,
      selectProject,
      refreshProjects,
      createProject,
      updateProject,
      setProjectStatus,
    }),
    [
      activeProject,
      activeProjectId,
      brainWorkspaceId,
      createProject,
      error,
      loading,
      projects,
      refreshProjects,
      selectProject,
      setProjectStatus,
      updateProject,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjects() {
  const context = useContext(ProjectsContext);
  if (!context)
    throw new Error("useProjects must be used inside ProjectsProvider");
  return context;
}
