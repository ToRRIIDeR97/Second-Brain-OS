import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { createDefaultCommands } from "../../app/commands";
import { ipcClient, type IpcClient, type CommandResult } from "../../lib/ipc";
import {
  useShell,
  ShellProvider,
  type Activity,
  type Drawer as DrawerId,
} from "../../state/shell";
import { CommandPalette } from "../common/CommandPalette";
import { EmptyState } from "../common/EmptyState";
import { ActivityBar } from "./ActivityBar";
import { Drawer } from "./Drawer";
import { Inspector } from "./Inspector";
import { Navigator } from "./Navigator";
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

function WorkspacePlaceholder({
  activity,
  onOpenPalette,
}: {
  activity: Activity;
  onOpenPalette: () => void;
}) {
  const title = activityTitles[activity];
  if (activity === "home") {
    return (
      <section className="home-surface" aria-labelledby="workspace-title">
        <p className="eyebrow">Second Brain OS · Personal knowledge base</p>
        <h1 id="workspace-title">A calm place to think.</h1>
        <p className="workspace-lede">
          Your local workspace is ready. Choose an activity to start exploring.
        </p>
        <div className="quick-actions">
          <button
            type="button"
            className="quick-action"
            onClick={onOpenPalette}
          >
            <span>⌘K</span>
            <strong>Open command palette</strong>
            <small>Find an action without leaving the keyboard.</small>
          </button>
          <button
            type="button"
            className="quick-action"
            onClick={onOpenPalette}
          >
            <span>⌕</span>
            <strong>Search your workspace</strong>
            <small>
              Search and retrieve notes when the index is connected.
            </small>
          </button>
        </div>
      </section>
    );
  }
  return (
    <EmptyState
      title={`${title} is ready for its feature pane`}
      description="This shell region is intentionally a placeholder for the next checkpoint."
    />
  );
}

function ShellFrame({ ipc }: { ipc: IpcClient }) {
  const { state, dispatch } = useShell();
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
              dispatch({ type: "palette/toggle", open: true });
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
      <div className="shell-body">
        <ActivityBar active={state.activity} onChange={setActivity} />
        <Group orientation="horizontal" className="shell-panels">
          <Panel
            defaultSize={`${String(state.sidebarWidth)}%`}
            minSize="12%"
            maxSize="40%"
            onResize={(size) => {
              dispatch({ type: "sidebar/resize", width: size.asPercentage });
            }}
          >
            <Navigator activity={state.activity} />
          </Panel>
          <Separator className="resize-handle" aria-label="Resize navigator" />
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
                <WorkspacePlaceholder
                  activity={state.activity}
                  onOpenPalette={() => {
                    dispatch({ type: "palette/toggle", open: true });
                  }}
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
      {state.drawerOpen ? (
        <Drawer
          active={state.drawer}
          onSelect={(drawer: DrawerId) => {
            dispatch({ type: "drawer/toggle", drawer });
          }}
        />
      ) : null}
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
