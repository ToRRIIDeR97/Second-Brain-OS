import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  PanelLeft,
  PanelRight,
  Search,
  SquareTerminal,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { createDefaultCommands } from "../../app/commands";
import { ipcClient, type IpcClient } from "../../lib/ipc";
import type { TerminalRequest } from "../../features/terminal/TerminalWorkspace";
import type { GraphSelectionContext } from "../../features/graph";
import {
  useShell,
  ShellProvider,
  type Activity,
  type WorkbenchResource,
} from "../../state/shell";
import { PreferencesProvider } from "../../state/preferences";
import { ThemeProvider } from "../../state/theme";
import { WorkspaceProvider } from "../../state/workspace";
import { useWorkspace } from "../../state/workspace";
import { CommandPalette } from "../common/CommandPalette";
import { ConfirmDialog, ModalDialog } from "../common/ModalDialog";
import { ActivityBar } from "./ActivityBar";
import { Tabs } from "./Tabs";
import { UtilityDock, type UtilityDockTab } from "./UtilityDock";
import { WorkspaceNavigator } from "./WorkspaceNavigator";

const IntegratedWorkspaceSurface = lazy(async () => ({
  default: (await import("../../app/WorkspaceSurface")).WorkspaceSurface,
}));
const activityTitles: Record<Activity, string> = {
  home: "Home",
  knowledge: "Files",
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
  const [terminalRequest, setTerminalRequest] = useState<TerminalRequest>();
  const [noteRequest, setNoteRequest] = useState<{
    key: number;
    relativePath: string;
  }>();
  const [fileRequest, setFileRequest] = useState<{
    key: number;
    relativePath: string;
  }>();
  const [saveRequest, setSaveRequest] = useState<{
    key: number;
    resourceId: string;
  }>();
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string>();
  const [, setGraphSelection] = useState<GraphSelectionContext>();
  const [utilityOpen, setUtilityOpen] = useState(true);
  const [utilityTabs, setUtilityTabs] = useState<UtilityDockTab[]>([]);
  const [utilityTab, setUtilityTab] = useState<UtilityDockTab>();
  const [terminalClosePending, setTerminalClosePending] = useState(false);
  const utilityPanelRef = usePanelRef();
  const { activeWorkspace } = useWorkspace();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      dispatch({ type: "navigator/toggle", open: true });
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [dispatch]);
  const setActivity = useCallback(
    (activity: Activity) => {
      if (activity !== "graph" && activity !== "home") {
        setGraphSelection(undefined);
        dispatch({ type: "selection/set", selection: null });
      }
      dispatch({ type: "activity/set", activity });
    },
    [dispatch],
  );

  const openActivityTab = useCallback(
    (activity: Activity) => {
      setActivity(activity);
      dispatch({
        type: "tab/open",
        tab: {
          id: `activity:${activity}`,
          title: activityTitles[activity],
          activity,
        },
      });
    },
    [dispatch, setActivity],
  );

  const openUtility = useCallback((tab: UtilityDockTab) => {
    setUtilityTabs((current) =>
      current.includes(tab) ? current : [...current, tab],
    );
    setUtilityTab(tab);
    setUtilityOpen(true);
  }, []);

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
      activity: "knowledge" | "files";
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
          preset: detail.preset === "shell" ? "zsh" : (detail.preset ?? "zsh"),
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
        <nav className="topbar-history" aria-label="Resource history">
          <button
            type="button"
            className="icon-button"
            aria-label="Go back"
            disabled={!historyCanGoBack}
            onClick={() => {
              dispatch({ type: "history/back" });
            }}
          >
            <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Go forward"
            disabled={!historyCanGoForward}
            onClick={() => {
              dispatch({ type: "history/forward" });
            }}
          >
            <ArrowRight size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </nav>
        <div className="topbar-title">
          <span>Second Brain OS</span>
          <span aria-hidden="true">—</span>
          <strong>{activeWorkspace?.name ?? "Local workbench"}</strong>
        </div>
        <button
          type="button"
          className="search-trigger"
          onClick={() => {
            setSearchOpen(true);
          }}
        >
          <Search size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>Search notes and workspace</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="topbar-actions">
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
                  onAdd={openActivityTab}
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
                    noteRequest={noteRequest}
                    fileRequest={fileRequest}
                    saveRequest={saveRequest}
                    onOpenTerminal={openTerminal}
                    onDocumentOpened={openDocumentResource}
                    onDocumentDirtyChange={markDocumentDirty}
                    onDocumentSaved={finishPendingDocumentSave}
                    onGitDiffOpened={openGitDiffResource}
                    onGraphSelectionContextChange={updateGraphSelection}
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
            <UtilityDock
              {...(utilityTab ? { activeTab: utilityTab } : {})}
              openTabs={utilityTabs}
              ipc={ipc}
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
              onOpenPath={(relativePath) => {
                setFileRequest({ key: Date.now(), relativePath });
              }}
            />
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
          <ShellProvider ipc={ipc}>
            <ShellFrame ipc={ipc} />
          </ShellProvider>
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>
  );
}

export { AppShell as DesktopShell };
