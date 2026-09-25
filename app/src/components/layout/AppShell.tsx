import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  ChevronDown,
  PanelLeft,
  PanelRight,
  Plus,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { createDefaultCommands } from "../../app/commands";
import { ipcClient, type IpcClient } from "../../lib/ipc";
import type { TerminalRequest } from "../../features/terminal/TerminalWorkspace";
import type { GraphSelectionContext } from "../../features/graph";
import type { SourceDiagnostic } from "../../features/editor/source";
import {
  useShell,
  ShellProvider,
  type Activity,
  type PlannerView,
  type ProjectView,
  type WorkbenchResource,
} from "../../state/shell";
import { PreferencesProvider } from "../../state/preferences";
import { ThemeProvider } from "../../state/theme";
import { WorkspaceProvider } from "../../state/workspace";
import { ProjectsProvider } from "../../state/projects";
import { useProjects } from "../../state/projects";
import { useWorkspace } from "../../state/workspace";
import { CommandPalette } from "../common/CommandPalette";
import { ConfirmDialog, ModalDialog } from "../common/ModalDialog";
import { ActivityBar } from "./ActivityBar";
import { Tabs } from "./Tabs";
import { UtilityDock, type UtilityDockTab } from "./UtilityDock";
import { WorkspaceNavigator } from "./WorkspaceNavigator";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { CreateProjectDialog } from "../../features/projects";

const IntegratedWorkspaceSurface = lazy(async () => ({
  default: (await import("../../app/WorkspaceSurface")).WorkspaceSurface,
}));
const activityTitles: Record<Activity, string> = {
  home: "Home",
  projects: "Projects",
  activity: "Activity",
  knowledge: "Knowledge",
  files: "Files",
  graph: "Graph",
  search: "Search",
  planner: "Tasks",
  calendar: "Calendar",
  agents: "Agents",
  terminal: "Terminal",
  "source-control": "Source Control",
  settings: "Settings",
};

function ShellFrame({ ipc }: { ipc: IpcClient }) {
  const { state, dispatch } = useShell();
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [newNoteRequest, setNewNoteRequest] = useState<number>();
  const [terminalRequest, setTerminalRequest] = useState<TerminalRequest>();
  const [noteRequest, setNoteRequest] = useState<{
    key: number;
    relativePath: string;
  }>();
  const [fileRequest, setFileRequest] = useState<{
    key: number;
    relativePath: string;
    line?: number;
    column?: number;
  }>();
  const [saveRequest, setSaveRequest] = useState<{
    key: number;
    resourceId: string;
  }>();
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string>();
  const [, setGraphSelection] = useState<GraphSelectionContext>();
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [utilityTabs, setUtilityTabs] = useState<UtilityDockTab[]>([]);
  const [utilityTab, setUtilityTab] = useState<UtilityDockTab>();
  const [terminalClosePending, setTerminalClosePending] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SourceDiagnostic[]>([]);
  const utilityPanelRef = usePanelRef();
  const { activeWorkspace } = useWorkspace();
  const { activeProjectId, selectProject } = useProjects();
  const restoringHistory = useRef(false);
  const createMenuRef = useRef<HTMLDetailsElement>(null);

  const historyEntry = useCallback(
    (
      activity = state.activity,
      projectView = state.projectView,
      plannerView = state.plannerView,
      projectId: string | null = activeProjectId ?? null,
    ) => ({
      id: `activity:${activity}:${projectView}:${plannerView}:${projectId ?? "all"}`,
      activity,
      projectView,
      plannerView,
      projectId,
      ...(activeWorkspace?.id ? { workspaceId: activeWorkspace.id } : {}),
    }),
    [
      activeProjectId,
      activeWorkspace?.id,
      state.activity,
      state.plannerView,
      state.projectView,
    ],
  );

  useEffect(() => {
    if (state.history.index >= 0) return;
    dispatch({ type: "history/push", entry: historyEntry() });
  }, [dispatch, historyEntry, state.history.index]);

  useEffect(() => {
    if (restoringHistory.current) {
      restoringHistory.current = false;
      return;
    }
    if (state.activity !== "projects") return;
    dispatch({ type: "history/push", entry: historyEntry() });
  }, [activeProjectId, dispatch, historyEntry, state.activity]);

  const setActivity = useCallback(
    (activity: Activity) => {
      if (activity !== "graph" && activity !== "home") {
        setGraphSelection(undefined);
        dispatch({ type: "selection/set", selection: null });
      }
      dispatch({ type: "activity/set", activity });
      dispatch({ type: "history/push", entry: historyEntry(activity) });
    },
    [dispatch, historyEntry],
  );

  const setProjectView = useCallback(
    (view: ProjectView) => {
      dispatch({ type: "project/view", view });
      dispatch({
        type: "history/push",
        entry: historyEntry("projects", view),
      });
    },
    [dispatch, historyEntry],
  );

  const setPlannerView = useCallback(
    (view: PlannerView) => {
      dispatch({ type: "planner/view", view });
      dispatch({
        type: "history/push",
        entry: historyEntry("calendar", state.projectView, view),
      });
    },
    [dispatch, historyEntry, state.projectView],
  );

  const moveHistory = useCallback(
    (direction: -1 | 1) => {
      const next = state.history.entries[state.history.index + direction];
      if (!next) return;
      if (
        next.projectId !== undefined &&
        (next.projectId ?? undefined) !== activeProjectId
      ) {
        restoringHistory.current = true;
        selectProject(next.projectId ?? undefined);
      }
      dispatch({ type: direction < 0 ? "history/back" : "history/forward" });
    },
    [
      activeProjectId,
      dispatch,
      selectProject,
      state.history.entries,
      state.history.index,
    ],
  );

  const openUtility = useCallback((tab: UtilityDockTab) => {
    setUtilityTabs((current) =>
      current.includes(tab) ? current : [...current, tab],
    );
    setUtilityTab(tab);
    setUtilityOpen(true);
  }, []);

  const updateDiagnostics = useCallback(
    (next: SourceDiagnostic[]) => {
      setDiagnostics(next);
      if (next.length) openUtility("problems");
    },
    [openUtility],
  );

  const removeUtilityTab = useCallback((tab: UtilityDockTab) => {
    if (tab === "terminal") setTerminalRequest(undefined);
    setUtilityTabs((current) => {
      const index = current.indexOf(tab);
      const remaining = current.filter((item) => item !== tab);
      setUtilityTab((active) =>
        active === tab
          ? (remaining[Math.min(index, remaining.length - 1)] ??
            remaining.at(-1))
          : active,
      );
      return remaining;
    });
  }, []);

  const closeUtilityTab = useCallback(
    (tab: UtilityDockTab) => {
      if (tab === "terminal") setTerminalClosePending(true);
      else removeUtilityTab(tab);
    },
    [removeUtilityTab],
  );

  useEffect(() => {
    if (utilityOpen) utilityPanelRef.current?.expand();
    else utilityPanelRef.current?.collapse();
  }, [utilityOpen, utilityPanelRef]);

  useEffect(() => {
    dispatch({
      type: "workspace/select",
      workspaceId: activeWorkspace?.id ?? null,
    });
  }, [activeWorkspace?.id, dispatch]);

  const openDocumentResource = useCallback(
    (input: {
      workspaceId: string;
      relativePath: string;
      title: string;
      activity: "knowledge" | "files" | "projects";
    }) => {
      const resource: WorkbenchResource = {
        id: `file:${input.workspaceId}:${input.relativePath}`,
        kind: "file",
        title: input.title,
        workspaceId: input.workspaceId,
        relativePath: input.relativePath,
        activity: input.activity,
      };
      dispatch({ type: "resource/open", resource });
      dispatch({
        type: "history/push",
        workspaceId: input.workspaceId,
        entry: { resourceId: resource.id, workspaceId: input.workspaceId },
      });
    },
    [dispatch],
  );

  const activateResourceTab = useCallback(
    (id: string) => {
      const tab = state.tabs.find((item) => item.id === id);
      dispatch({ type: "tab/activate", id });
      const resource = tab?.resource;
      if (resource?.kind === "file" && resource.relativePath) {
        setFileRequest({
          key: Date.now(),
          relativePath: resource.relativePath,
        });
      }
    },
    [dispatch, state.tabs],
  );

  const activeFilePath = state.tabs.find(({ id }) => id === state.activeTabId)
    ?.resource?.relativePath;
  useEffect(() => {
    if (!activeFilePath) return;
    const timer = window.setTimeout(() => {
      setFileRequest({ key: Date.now(), relativePath: activeFilePath });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeFilePath, state.activeTabId]);

  const historyCanGoBack = state.history.index > 0;
  const historyCanGoForward =
    state.history.index >= 0 &&
    state.history.index < state.history.entries.length - 1;
  const pendingCloseTab = state.tabs.find(({ id }) => id === pendingCloseTabId);

  const registry = useMemo(
    () =>
      createDefaultCommands({
        openPalette: () => {
          dispatch({ type: "palette/toggle", open: true });
        },
        toggleInspector: () => {
          setUtilityOpen((open) => !open);
        },
        toggleDrawer: () => {
          openUtility("terminal");
        },
        setActivity,
      }),
    [dispatch, openUtility, setActivity],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        dispatch({ type: "palette/toggle" });
      }
      if (modifier && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setUtilityOpen((open) => !open);
      }
      if (event.key === "Escape" && state.commandPaletteOpen)
        dispatch({ type: "palette/toggle", open: false });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dispatch, state.commandPaletteOpen]);

  const openTerminal = useCallback(
    (detail: {
      workspaceId: string;
      relativePath?: string;
      preset?: "shell" | "codex" | "claude";
    }) => {
      if (!utilityTabs.includes("terminal")) {
        setTerminalRequest({
          key: Date.now(),
          workspaceId: detail.workspaceId,
          relativePath: detail.relativePath ?? "",
          ...(detail.preset && detail.preset !== "shell"
            ? { preset: detail.preset }
            : {}),
        });
      }
      openUtility("terminal");
    },
    [openUtility, utilityTabs],
  );

  const markDocumentDirty = useCallback(
    (resourceId: string, dirty: boolean) => {
      dispatch({ type: "tab/dirty", id: resourceId, dirty });
    },
    [dispatch],
  );

  const finishPendingDocumentSave = useCallback(
    (resourceId: string) => {
      if (resourceId !== pendingCloseTabId) return;
      dispatch({ type: "tab/close", id: resourceId });
      setPendingCloseTabId(undefined);
      setSaveRequest(undefined);
    },
    [dispatch, pendingCloseTabId],
  );

  const openGitDiffResource = useCallback(
    ({
      workspaceId,
      path,
      title,
    }: {
      workspaceId: string;
      path: string;
      title: string;
    }) => {
      const resource: WorkbenchResource = {
        id: `git-diff:${workspaceId}:${path}`,
        kind: "git-diff",
        title,
        workspaceId,
        relativePath: path,
        activity: "source-control",
      };
      dispatch({ type: "resource/open", resource });
      dispatch({
        type: "history/push",
        workspaceId,
        entry: { resourceId: resource.id, workspaceId },
      });
    },
    [dispatch],
  );

  const updateGraphSelection = useCallback(
    (context: GraphSelectionContext | undefined) => {
      setGraphSelection(context);
      dispatch({
        type: "selection/set",
        selection: context
          ? {
              kind: "graph-node",
              nodeId: context.node.id,
              ...(context.node.source
                ? { workspaceId: context.node.source.workspaceId }
                : {}),
            }
          : null,
      });
    },
    [dispatch],
  );

  return (
    <div className="app-shell">
      <header
        className="topbar"
        onMouseDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest(
              "button, input, select, textarea, a",
            )
          )
            return;
          void getCurrentWindow()
            .startDragging()
            .catch(() => undefined);
        }}
      >
        <div className="topbar-leading">
          <nav className="topbar-history" aria-label="Resource history">
            <button
              type="button"
              className="icon-button"
              aria-label="Go back"
              disabled={!historyCanGoBack}
              onClick={() => {
                moveHistory(-1);
              }}
            >
              <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Go forward"
              disabled={!historyCanGoForward}
              onClick={() => {
                moveHistory(1);
              }}
            >
              <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </nav>
          <span className="topbar-divider" aria-hidden="true" />
          <WorkspaceSwitcher
            onWorkspaceOpened={() => {
              setActivity("knowledge");
            }}
          />
        </div>
        <div className="topbar-actions">
          <details ref={createMenuRef} className="topbar-create-menu">
            <summary className="button button-small" aria-label="Create">
              <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
              Create
              <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
            </summary>
            <div className="topbar-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  setProjectCreateOpen(true);
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                }}
              >
                Project
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  setActivity("knowledge");
                  setNewNoteRequest(Date.now());
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                }}
              >
                Note
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  setPlannerView("tasks");
                  setActivity("calendar");
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                }}
              >
                Task
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  setPlannerView("today");
                  setActivity("calendar");
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                }}
              >
                Calendar event
              </button>
            </div>
          </details>
          <button
            type="button"
            className="button button-small topbar-ask"
            aria-label="Ask Second Brain"
            onClick={() => {
              createMenuRef.current?.removeAttribute("open");
              openUtility("agent");
            }}
          >
            <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" /> Ask
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Open needs attention"
            title="Needs attention"
            onClick={() => {
              createMenuRef.current?.removeAttribute("open");
              setActivity("activity");
            }}
          >
            <Bell size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={
              state.navigatorOpen ? "Hide navigator" : "Show navigator"
            }
            title="Toggle navigator"
            onClick={() => {
              dispatch({ type: "navigator/toggle" });
            }}
          >
            <PanelLeft size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={
              utilityOpen ? "Hide utility panel" : "Show utility panel"
            }
            title="Toggle utility panel"
            onClick={() => {
              setUtilityOpen((open) => !open);
            }}
          >
            <PanelRight size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Open terminal in utility panel"
            title="Open terminal"
            onClick={() => {
              openUtility("terminal");
            }}
          >
            <SquareTerminal size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="shell-body">
        <ActivityBar active={state.activity} onChange={setActivity} />
        <Group orientation="horizontal" className="shell-panels">
          {state.navigatorOpen ? (
            <>
              <Panel
                defaultSize={`${String(state.sidebarWidth)}%`}
                minSize="12%"
                maxSize="40%"
                onResize={(size) => {
                  dispatch({
                    type: "sidebar/resize",
                    width: size.asPercentage,
                  });
                }}
              >
                <WorkspaceNavigator
                  activity={state.activity}
                  projectView={state.projectView}
                  onProjectViewChange={(view) => {
                    setProjectView(view);
                  }}
                  plannerView={state.plannerView}
                  onPlannerViewChange={(view) => {
                    setPlannerView(view);
                  }}
                  ipc={ipc}
                  onOpenDailyNote={() => {
                    setNoteRequest({
                      key: Date.now(),
                      relativePath: "notes/today.md",
                    });
                    setActivity("knowledge");
                  }}
                  onOpenPath={(relativePath) => {
                    setFileRequest({ key: Date.now(), relativePath });
                    setActivity("files");
                  }}
                  onClose={() => {
                    dispatch({ type: "navigator/toggle", open: false });
                  }}
                />
              </Panel>
              <Separator
                className="resize-handle"
                aria-label="Resize navigator"
              />
            </>
          ) : null}
          <Panel minSize="360px">
            <div className="workspace-column">
              {state.tabs.length ? (
                <Tabs
                  tabs={state.tabs.map((tab) => ({
                    ...tab,
                    kind:
                      tab.resource?.kind === "terminal-session"
                        ? "terminal"
                        : (tab.resource?.kind ?? "activity"),
                  }))}
                  activeTabId={state.activeTabId}
                  onActivate={activateResourceTab}
                  onClose={(id) => {
                    const tab = state.tabs.find((item) => item.id === id);
                    if (tab?.dirty) setPendingCloseTabId(id);
                    else dispatch({ type: "tab/close", id });
                  }}
                />
              ) : null}
              <main className="workspace" data-route={state.activity}>
                <Suspense
                  fallback={
                    <div className="surface-loading" role="status">
                      Loading workbench…
                    </div>
                  }
                >
                  <IntegratedWorkspaceSurface
                    activity={state.activity}
                    ipc={ipc}
                    onOpenPalette={() => {
                      dispatch({ type: "palette/toggle", open: true });
                    }}
                    searchOpen={searchOpen}
                    onCloseSearch={() => {
                      setSearchOpen(false);
                    }}
                    onNavigate={setActivity}
                    projectView={state.projectView}
                    plannerView={state.plannerView}
                    onPlannerViewChange={(view) => {
                      setPlannerView(view);
                    }}
                    onCreateProject={() => {
                      setProjectCreateOpen(true);
                    }}
                    onProjectViewChange={setProjectView}
                    onOpenAgentPanel={() => {
                      openUtility("agent");
                    }}
                    newNoteRequest={newNoteRequest}
                    noteRequest={noteRequest}
                    fileRequest={fileRequest}
                    saveRequest={saveRequest}
                    onOpenTerminal={openTerminal}
                    onDocumentOpened={openDocumentResource}
                    onDocumentDirtyChange={markDocumentDirty}
                    onDocumentSaved={finishPendingDocumentSave}
                    onGitDiffOpened={openGitDiffResource}
                    onGraphSelectionContextChange={updateGraphSelection}
                    onDiagnosticsChange={updateDiagnostics}
                  />
                </Suspense>
              </main>
            </div>
          </Panel>
          <Separator
            className="resize-handle"
            aria-label="Resize utility panel"
            disabled={!utilityOpen}
          />
          <Panel
            panelRef={utilityPanelRef}
            defaultSize="360px"
            minSize="320px"
            maxSize="640px"
            collapsible
            collapsedSize={0}
            groupResizeBehavior="preserve-pixel-size"
          >
            {utilityOpen || utilityTabs.length ? (
              <UtilityDock
                {...(utilityTab ? { activeTab: utilityTab } : {})}
                openTabs={utilityTabs}
                ipc={ipc}
                diagnostics={diagnostics}
                {...(terminalRequest ? { terminalRequest } : {})}
                onOpenTab={openUtility}
                onTabChange={setUtilityTab}
                onCloseTab={closeUtilityTab}
                onClose={() => {
                  setUtilityOpen(false);
                }}
                onOpenDailyNote={() => {
                  setNoteRequest({
                    key: Date.now(),
                    relativePath: "notes/today.md",
                  });
                }}
                onOpenPath={(relativePath, line, column) => {
                  setFileRequest({
                    key: Date.now(),
                    relativePath,
                    ...(line === undefined ? {} : { line }),
                    ...(column === undefined ? {} : { column }),
                  });
                }}
              />
            ) : null}
          </Panel>
        </Group>
      </div>
      <CommandPalette
        key={state.commandPaletteOpen ? "open" : "closed"}
        open={state.commandPaletteOpen}
        registry={registry}
        context={{
          activity: state.activity,
          hasWorkspace: true,
          hasSelection: false,
        }}
        onClose={() => {
          dispatch({ type: "palette/toggle", open: false });
        }}
      />
      <CreateProjectDialog
        open={projectCreateOpen}
        ipc={ipc}
        onClose={() => {
          setProjectCreateOpen(false);
        }}
        onCreated={() => {
          setActivity("projects");
          setProjectView("overview");
        }}
      />
      <ConfirmDialog
        open={terminalClosePending}
        title="Close terminal?"
        message="Closing this terminal will terminate its running process and any work in it."
        confirmLabel="Close terminal"
        dangerous
        onClose={() => {
          setTerminalClosePending(false);
        }}
        onConfirm={() => {
          removeUtilityTab("terminal");
          setTerminalClosePending(false);
        }}
      />
      <ModalDialog
        open={Boolean(pendingCloseTab?.dirty)}
        title={`Save changes to ${pendingCloseTab?.title ?? "this resource"}?`}
        eyebrow="Unsaved changes"
        onClose={() => {
          setPendingCloseTabId(undefined);
        }}
      >
        <p>Your changes will be lost if you close this tab without saving.</p>
        <footer className="modal-dialog-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setPendingCloseTabId(undefined);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={() => {
              if (pendingCloseTabId)
                dispatch({ type: "tab/close", id: pendingCloseTabId });
              setPendingCloseTabId(undefined);
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              if (!pendingCloseTabId) return;
              setSaveRequest({
                key: Date.now(),
                resourceId: pendingCloseTabId,
              });
            }}
          >
            Save and close
          </button>
        </footer>
      </ModalDialog>
      <footer className="status-bar" aria-label="Workspace status">
        <span>
          <span className="status-dot" aria-hidden="true" /> Local-first
        </span>
        <span>{activityTitles[state.activity]}</span>
        <span>{activeWorkspace?.canWrite ? "Editable" : "Read-only"}</span>
      </footer>
    </div>
  );
}

export function AppShell({ ipc = ipcClient }: { ipc?: IpcClient }) {
  return (
    <ThemeProvider>
      <PreferencesProvider>
        <WorkspaceProvider ipc={ipc}>
          <ProjectsProvider ipc={ipc}>
            <ShellProvider ipc={ipc}>
              <ShellFrame ipc={ipc} />
            </ShellProvider>
          </ProjectsProvider>
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>
  );
}

export { AppShell as DesktopShell };
