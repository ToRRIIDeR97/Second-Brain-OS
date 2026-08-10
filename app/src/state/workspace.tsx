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
  WorkspaceKind,
  WorkspaceSummary,
  WorkspaceTrustLevel,
} from "../lib/ipc";

export type WorkspaceRegistration = {
  name: string;
  rootPath: string;
  kind: WorkspaceKind;
  trustLevel: WorkspaceTrustLevel;
};

type WorkspaceContextValue = {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | undefined;
  activeWorkspace: WorkspaceSummary | undefined;
  loading: boolean;
  error: string;
  selectWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<void>;
  registerWorkspace: (
    registration: WorkspaceRegistration,
  ) => Promise<WorkspaceSummary | undefined>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const activeWorkspaceStorageKey = "second-brain-os.active-workspace.v1";

function readStoredWorkspaceId() {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(activeWorkspaceStorageKey);
    return value || undefined;
  } catch {
    return undefined;
  }
}

function persistWorkspaceId(workspaceId: string | undefined) {
  if (typeof window === "undefined") return;
  try {
    if (workspaceId)
      window.localStorage.setItem(activeWorkspaceStorageKey, workspaceId);
    else window.localStorage.removeItem(activeWorkspaceStorageKey);
  } catch {
    // Storage is a convenience; a private browsing context must not break the shell.
  }
}

function resultError(result: { ok: boolean; error?: { message: string } }) {
  return result.ok
    ? ""
    : (result.error?.message ?? "Workspace request failed.");
}

export function WorkspaceProvider({
  ipc,
  children,
}: {
  ipc: IpcClient;
  children: ReactNode;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<
    string | undefined
  >(readStoredWorkspaceId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshWorkspaces = useCallback(async () => {
    setLoading(true);
    const result = await ipc.workspaces.list();
    if (!result.ok || !Array.isArray(result.data)) {
      setError(resultError(result));
      setLoading(false);
      return;
    }
    setWorkspaces(result.data);
    setActiveWorkspaceId((current) =>
      current && result.data.some(({ id }) => id === current)
        ? current
        : (result.data.find(({ kind }) => kind === "brain")?.id ??
          result.data[0]?.id),
    );
    setError("");
    setLoading(false);
  }, [ipc]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshWorkspaces(), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshWorkspaces]);

  useEffect(() => {
    persistWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId]);

  const registerWorkspace = useCallback(
    async (registration: WorkspaceRegistration) => {
      setLoading(true);
      const result = await ipc.workspaces.register(registration);
      if (!result.ok) {
        setError(resultError(result));
        setLoading(false);
        return undefined;
      }
      setWorkspaces((current) => [
        ...current.filter(({ id }) => id !== result.data.id),
        result.data,
      ]);
      setActiveWorkspaceId(result.data.id);
      setError("");
      setLoading(false);
      return result.data;
    },
    [ipc],
  );

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      if (workspaces.some(({ id }) => id === workspaceId)) {
        setActiveWorkspaceId(workspaceId);
      }
    },
    [workspaces],
  );

  const activeWorkspace = workspaces.find(({ id }) => id === activeWorkspaceId);
  const value = useMemo(
    () => ({
      workspaces,
      activeWorkspaceId,
      activeWorkspace,
      loading,
      error,
      selectWorkspace,
      refreshWorkspaces,
      registerWorkspace,
    }),
    [
      activeWorkspace,
      activeWorkspaceId,
      error,
      loading,
      refreshWorkspaces,
      registerWorkspace,
      selectWorkspace,
      workspaces,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context)
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}
