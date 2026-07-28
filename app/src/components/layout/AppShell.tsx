import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { createDefaultCommands } from "../../app/commands";
import { WorkspaceSurface as IntegratedWorkspaceSurface } from "../../app/WorkspaceSurface";
import { ipcClient, type CommandResult, type IpcClient } from "../../lib/ipc";
import {
  TerminalWorkspace,
  type TerminalRequest,
} from "../../features/terminal/TerminalWorkspace";
import {
  useShell,
  ShellProvider,
  type Activity,
  type Drawer as DrawerId,
} from "../../state/shell";
import { CommandPalette } from "../common/CommandPalette";
import { ActivityBar } from "./ActivityBar";
import { Drawer } from "./Drawer";
import { Inspector } from "./Inspector";
import { Navigator, type NavigatorEntry } from "./Navigator";
import { Tabs } from "./Tabs";

const activityTitles: Record<Activity, string> = {
  home: "Home",
  knowledge: "Knowledge",
  files: "Files",
  graph: "Graph",
  search: "Search",
  planner: "Planner",
  agents: "Agents",
  terminal: "Terminal",
  "source-control": "Source Control",
  settings: "Settings",
};

function IpcStatus({ ipc }: { ipc: IpcClient }) {
  const [result, setResult] = useState<CommandResult<string> | null>(null);
  const check = async () => {
    setResult(await ipc.system.ping());
  };
  return (
    <div className="ipc-status">
      {result ? (
        result.ok ? (
          <span role="status" className="ipc-result ipc-success">
            <span className="status-dot" />
            Connected · {result.correlationId}
          </span>
        ) : (
          <span
            role="alert"
            className="ipc-result ipc-error"
            title={result.error.message}
          >
            IPC error · {result.correlationId}
          </span>
        )
      ) : (
        <span className="ipc-result ipc-idle">
          <span className="status-dot" />
          Bridge idle
        </span>
      )}
      <button
        type="button"
        className="button button-small"
        onClick={() => void check()}
      >
        Check bridge
      </button>
    </div>
  );
}

function ShellFrame({ ipc }: { ipc: IpcClient }) {
  const { state, dispatch } = useShell();
  const [searchOpen, setSearchOpen] = useState(false);
  const [terminalRequest, setTerminalRequest] = useState<TerminalRequest>();
  const [collections, setCollections] = useState<NavigatorEntry[]>([]);
  const setActivity = useCallback(
    (activity: Activity) => {
      dispatch({ type: "activity/set", activity });
      dispatch({
        type: "tab/open",
        tab: { id: activity, title: activityTitles[activity], activity },
      });
    },
    [dispatch],
  );
  const registry = useMemo(
    () =>
      createDefaultCommands({
        openPalette: () => {
          dispatch({ type: "palette/toggle", open: true });
        },
        toggleInspector: () => {
          dispatch({ type: "inspector/toggle" });
        },
        toggleDrawer: () => {
          dispatch({ type: "drawer/toggle" });
        },
        setActivity,
      }),
    [dispatch, setActivity],
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
        dispatch({ type: "inspector/toggle" });
      }
      if (event.key === "Escape" && state.commandPaletteOpen)
        dispatch({ type: "palette/toggle", open: false });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dispatch, state.commandPaletteOpen]);

  useEffect(() => {
    const openTerminal = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          workspaceId: string;
          relativePath?: string;
          preset?: "shell" | "codex" | "claude";
        }>
      ).detail;
      setTerminalRequest({
        key: Date.now(),
        workspaceId: detail.workspaceId,
        relativePath: detail.relativePath ?? "",
        preset: detail.preset === "shell" ? "zsh" : (detail.preset ?? "zsh"),
      });
      dispatch({ type: "drawer/toggle", drawer: "terminal" });
    };
    window.addEventListener("second-brain:open-terminal", openTerminal);
    return () => {
      window.removeEventListener("second-brain:open-terminal", openTerminal);
    };
  }, [dispatch]);

  useEffect(() => {
    const updateCollections = (event: Event) => {
      setCollections(
        (event as CustomEvent<NavigatorEntry[]>).detail.filter(
          (entry) => entry.id && entry.label,
        ),
      );
    };
    window.addEventListener("second-brain:collections", updateCollections);
    return () => {
      window.removeEventListener("second-brain:collections", updateCollections);
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          type="button"
          className="workspace-switcher"
          aria-label="Current workspace"
        >
          <span className="workspace-avatar">P</span>
          <span>
            <strong>Personal</strong>
            <small>Workspace</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </button>
        <div className="topbar-breadcrumb" aria-label="Current location">
          <span>Second Brain OS</span>
          <span aria-hidden="true">/</span>
          <strong>{activityTitles[state.activity]}</strong>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="search-trigger"
            onClick={() => {
              setSearchOpen(true);
            }}
          >
            <span>⌕</span> Search <kbd>⌘K</kbd>
          </button>
          <IpcStatus ipc={ipc} />
          <button
            type="button"
            className="icon-button"
            aria-label={
              state.inspectorOpen ? "Hide inspector" : "Show inspector"
            }
            title="Toggle inspector"
            onClick={() => {
              dispatch({ type: "inspector/toggle" });
            }}
          >
            ◫
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={
              state.drawerOpen ? "Hide bottom drawer" : "Show bottom drawer"
            }
            title="Toggle drawer"
            onClick={() => {
              dispatch({ type: "drawer/toggle" });
            }}
          >
            ▔
          </button>
        </div>
      </header>
      <Group orientation="vertical" className="shell-vertical">
        <Panel minSize="30%">
          <div className="shell-body">
            <ActivityBar active={state.activity} onChange={setActivity} />
            <Group orientation="horizontal" className="shell-panels">
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
                <Navigator
                  activity={state.activity}
                  dailyNotes={[
                    {
                      id: "notes/today.md",
                      label: "Today",
                      secondary: new Date().toLocaleDateString(),
                    },
                  ]}
                  collections={collections}
                  onDailyNoteSelect={(note) => {
                    window.dispatchEvent(
                      new CustomEvent("second-brain:open-note", {
                        detail: { relativePath: note.id },
                      }),
                    );
                  }}
                  onCollectionSelect={(collection) => {
                    window.dispatchEvent(
                      new CustomEvent("second-brain:select-workspace", {
                        detail: { id: collection.id },
                      }),
                    );
                  }}
                />
              </Panel>
              <Separator
                className="resize-handle"
                aria-label="Resize navigator"
              />
              <Panel minSize={35}>
                <div className="workspace-column">
                  <Tabs
                    tabs={state.tabs}
                    activeTabId={state.activeTabId}
                    onActivate={(id) => {
                      dispatch({ type: "tab/activate", id });
                    }}
                    onClose={(id) => {
                      dispatch({ type: "tab/close", id });
                    }}
                  />
                  <main className="workspace" data-route={state.activity}>
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
                    />
                  </main>
                </div>
              </Panel>
              {state.inspectorOpen ? (
                <>
                  <Separator
                    className="resize-handle"
                    aria-label="Resize inspector"
                  />
                  <Panel
                    defaultSize={`${String(state.inspectorWidth)}%`}
                    minSize="14%"
                    maxSize="40%"
                    onResize={(size) => {
                      dispatch({
                        type: "inspector/resize",
                        width: size.asPercentage,
                      });
                    }}
                  >
                    <Inspector activity={state.activity} />
                  </Panel>
                </>
              ) : null}
            </Group>
          </div>
        </Panel>
        {state.drawerOpen ? (
          <>
            <Separator
              className="drawer-resize-handle"
              aria-label="Resize terminal drawer"
            />
            <Panel defaultSize="30%" minSize="14%" maxSize="70%">
              <Drawer
                active={state.drawer}
                onSelect={(drawer: DrawerId) => {
                  dispatch({ type: "drawer/toggle", drawer });
                }}
                terminal={
                  <TerminalWorkspace ipc={ipc} request={terminalRequest} />
                }
              />
            </Panel>
          </>
        ) : null}
      </Group>
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
    </div>
  );
}

export function AppShell({ ipc = ipcClient }: { ipc?: IpcClient }) {
  return (
    <ShellProvider ipc={ipc}>
      <ShellFrame ipc={ipc} />
    </ShellProvider>
  );
}

export { AppShell as DesktopShell };
