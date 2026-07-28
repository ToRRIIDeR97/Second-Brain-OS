import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import { ipcClient, type IpcClient } from "../lib/ipc";
import type { ShellLayout } from "../lib/ipc";

export const ACTIVITIES = [
  "home",
  "knowledge",
  "files",
  "graph",
  "search",
  "planner",
  "agents",
  "terminal",
  "source-control",
  "settings",
] as const;
export const DRAWERS = ["terminal"] as const;

export type Activity = (typeof ACTIVITIES)[number];
export type Drawer = (typeof DRAWERS)[number];

const tabbedActivities = new Set<Activity>([
  "home",
  "knowledge",
  "files",
  "graph",
  "source-control",
  "settings",
]);

export type ShellTab = {
  id: string;
  title: string;
  activity: Activity;
  dirty?: boolean;
};

export type ShellState = {
  activity: Activity;
  sidebarWidth: number;
  inspectorWidth: number;
  inspectorOpen: boolean;
  drawerOpen: boolean;
  drawer: Drawer;
  tabs: ShellTab[];
  activeTabId: string;
  commandPaletteOpen: boolean;
};

export const defaultShellState: ShellState = {
  activity: "home",
  sidebarWidth: 21,
  inspectorWidth: 22,
  inspectorOpen: true,
  drawerOpen: false,
  drawer: "terminal",
  tabs: [{ id: "welcome", title: "Welcome", activity: "home" }],
  activeTabId: "welcome",
  commandPaletteOpen: false,
};

export type ShellAction =
  | { type: "activity/set"; activity: Activity }
  | { type: "sidebar/resize"; width: number }
  | { type: "inspector/resize"; width: number }
  | { type: "inspector/toggle" }
  | { type: "drawer/toggle"; drawer?: Drawer }
  | { type: "tab/open"; tab: ShellTab }
  | { type: "tab/activate"; id: string }
  | { type: "tab/close"; id: string }
  | { type: "palette/toggle"; open?: boolean }
  | { type: "restore"; state: ShellState };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isActivity(value: unknown): value is Activity {
  return (
    typeof value === "string" &&
    (ACTIVITIES as readonly string[]).includes(value)
  );
}

function isDrawer(value: unknown): value is Drawer {
  return (
    typeof value === "string" && (DRAWERS as readonly string[]).includes(value)
  );
}

export function shellReducer(
  state: ShellState,
  action: ShellAction,
): ShellState {
  switch (action.type) {
    case "activity/set":
      return { ...state, activity: action.activity };
    case "sidebar/resize":
      return { ...state, sidebarWidth: clamp(action.width, 12, 40) };
    case "inspector/resize":
      return { ...state, inspectorWidth: clamp(action.width, 14, 40) };
    case "inspector/toggle":
      return { ...state, inspectorOpen: !state.inspectorOpen };
    case "drawer/toggle": {
      const drawer = action.drawer ?? state.drawer;
      return {
        ...state,
        drawer,
        drawerOpen: action.drawer === undefined ? !state.drawerOpen : true,
      };
    }
    case "tab/open": {
      const existing = state.tabs.some((tab) => tab.id === action.tab.id);
      return {
        ...state,
        tabs: existing ? state.tabs : [...state.tabs, action.tab],
        activeTabId: action.tab.id,
        activity: action.tab.activity,
      };
    }
    case "tab/activate": {
      const tab = state.tabs.find((item) => item.id === action.id);
      return tab
        ? { ...state, activeTabId: action.id, activity: tab.activity }
        : state;
    }
    case "tab/close": {
      if (state.tabs.length === 1) return state;
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      if (state.activeTabId !== action.id) return { ...state, tabs };
      const next = tabs[Math.max(0, index - 1)] ?? tabs[0];
      if (!next) return state;
      return { ...state, tabs, activeTabId: next.id, activity: next.activity };
    }
    case "palette/toggle":
      return {
        ...state,
        commandPaletteOpen: action.open ?? !state.commandPaletteOpen,
      };
    case "restore":
      return action.state;
    default:
      return state;
  }
}

const storageKey = "second-brain-os.shell.v1";

function readStoredState(): ShellState {
  if (typeof window === "undefined") return defaultShellState;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return defaultShellState;
    const parsed = JSON.parse(stored) as Partial<ShellState>;
    const rawTabs: unknown = parsed.tabs;
    const tabs = Array.isArray(rawTabs)
      ? rawTabs.filter((tab): tab is ShellTab => {
          if (typeof tab !== "object" || tab === null) return false;
          const candidate = tab as Record<string, unknown>;
          return (
            typeof candidate.id === "string" &&
            typeof candidate.title === "string" &&
            isActivity(candidate.activity) &&
            tabbedActivities.has(candidate.activity)
          );
        })
      : [];
    const fallbackTab: ShellTab = {
      id: "welcome",
      title: "Welcome",
      activity: "home",
    };
    const safeTabs = tabs.length > 0 ? tabs : [fallbackTab];
    const firstTab = safeTabs[0] ?? fallbackTab;
    const activeTabId = safeTabs.some((tab) => tab.id === parsed.activeTabId)
      ? (parsed.activeTabId ?? firstTab.id)
      : firstTab.id;
    return {
      activity:
        isActivity(parsed.activity) && tabbedActivities.has(parsed.activity)
          ? parsed.activity
          : firstTab.activity,
      sidebarWidth:
        typeof parsed.sidebarWidth === "number" &&
        Number.isFinite(parsed.sidebarWidth)
          ? clamp(parsed.sidebarWidth, 12, 40)
          : defaultShellState.sidebarWidth,
      inspectorWidth:
        typeof parsed.inspectorWidth === "number" &&
        Number.isFinite(parsed.inspectorWidth)
          ? clamp(parsed.inspectorWidth, 14, 40)
          : defaultShellState.inspectorWidth,
      inspectorOpen:
        typeof parsed.inspectorOpen === "boolean"
          ? parsed.inspectorOpen
          : defaultShellState.inspectorOpen,
      drawerOpen:
        typeof parsed.drawerOpen === "boolean"
          ? parsed.drawerOpen
          : defaultShellState.drawerOpen,
      drawer: isDrawer(parsed.drawer)
        ? parsed.drawer
        : defaultShellState.drawer,
      tabs: safeTabs,
      activeTabId,
      commandPaletteOpen:
        typeof parsed.commandPaletteOpen === "boolean"
          ? parsed.commandPaletteOpen
          : defaultShellState.commandPaletteOpen,
    };
  } catch {
    return defaultShellState;
  }
}

export function toBackendLayout(state: ShellState): ShellLayout {
  return {
    version: 1,
    sidebarWidth: state.sidebarWidth,
    inspectorWidth: state.inspectorWidth,
    inspectorOpen: state.inspectorOpen,
    drawerOpen: state.drawerOpen,
  };
}

function applyBackendLayout(
  state: ShellState,
  layout: ShellLayout,
): ShellState {
  return {
    ...state,
    sidebarWidth: clamp(layout.sidebarWidth, 12, 40),
    inspectorWidth: clamp(layout.inspectorWidth, 14, 40),
    inspectorOpen: layout.inspectorOpen,
    drawerOpen: layout.drawerOpen,
  };
}

type ShellContextValue = { state: ShellState; dispatch: Dispatch<ShellAction> };
const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  children,
  ipc = ipcClient,
}: {
  children: ReactNode;
  ipc?: IpcClient;
}) {
  const [state, dispatch] = useReducer(
    shellReducer,
    undefined,
    readStoredState,
  );
  const hydrated = useRef(false);

  useEffect(() => {
    let mounted = true;
    void ipc.shell.loadLayout().then((result) => {
      if (!mounted) return;
      if (result.ok && result.data)
        dispatch({
          type: "restore",
          state: applyBackendLayout(state, result.data),
        });
      hydrated.current = true;
    });
    return () => {
      mounted = false;
    };
    // Loading once per window is deliberate; later saves use the current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipc]);

  useEffect(() => {
    if (!hydrated.current || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(state));
    void ipc.shell.saveLayout(toBackendLayout(state));
  }, [ipc, state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return createElement(ShellContext.Provider, { value }, children);
}

export function useShell() {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside ShellProvider");
  return context;
}
