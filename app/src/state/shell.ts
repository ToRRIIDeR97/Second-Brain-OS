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
import type { InspectorTab, ShellLayout } from "../lib/ipc";

export const ACTIVITIES = [
  "home",
  "knowledge",
  "files",
  "graph",
  "search",
  "planner",
  "calendar",
  "agents",
  "terminal",
  "source-control",
  "settings",
] as const;
export const DRAWERS = ["terminal"] as const;
export const THEME_MODES = ["auto", "light", "dark"] as const;
export const WORKBENCH_RESOURCE_KINDS = [
  "activity",
  "file",
  "preview",
  "graph",
  "git-diff",
  "agent-session",
  "terminal-session",
  "terminal",
  "custom",
] as const;

export type Activity = (typeof ACTIVITIES)[number];
export type Drawer = (typeof DRAWERS)[number];
export type ThemeMode = (typeof THEME_MODES)[number];
export type WorkbenchResourceKind = (typeof WORKBENCH_RESOURCE_KINDS)[number];

/**
 * A resource is the identity of something shown in the workbench.  Activity
 * surfaces (Home, Graph, Settings, …) can still be represented by a regular
 * ShellTab, while resource tabs do not need to belong to an activity at all.
 */
export type WorkbenchResource = {
  id: string;
  kind: WorkbenchResourceKind;
  title: string;
  workspaceId?: string;
  relativePath?: string;
  activity?: Activity;
  metadata?: Record<string, unknown>;
};

export type WorkbenchSelectionKind =
  | "file"
  | "graph-node"
  | "git-change"
  | "agent-session"
  | "terminal-session";

/** The contextual item shown by the global inspector. */
export type WorkbenchSelection =
  | {
      kind: "file";
      workspaceId: string;
      relativePath: string;
      line?: number;
      column?: number;
    }
  | {
      kind: "graph-node";
      nodeId: string;
      workspaceId?: string;
    }
  | {
      kind: "git-change";
      workspaceId: string;
      relativePath: string;
      staged?: boolean;
    }
  | {
      kind: "agent-session";
      sessionId: string;
      workspaceId?: string;
    }
  | {
      kind: "terminal-session";
      sessionId: string;
      workspaceId?: string;
    };

export type WorkbenchHistoryEntry = {
  /** Stable location id. For a resource this is usually the resource id. */
  id?: string;
  resourceId?: string;
  workspaceId?: string;
  selection?: WorkbenchSelection | null;
};

export type WorkbenchHistory = {
  entries: WorkbenchHistoryEntry[];
  /** Index of the visible entry. -1 means that the history is empty. */
  index: number;
};

/**
 * The activity field remains optional so resource-only tabs can be opened by
 * new callers. Existing activity tabs continue to provide it unchanged.
 */
export type ShellTab = {
  id: string;
  title: string;
  activity?: Activity;
  /** Resource-oriented tab metadata used by the tab strip. */
  kind?: string;
  resourceType?: string;
  description?: string;
  closable?: boolean;
  pinned?: boolean;
  preview?: boolean;
  dirty?: boolean;
  workspaceId?: string;
  resource?: WorkbenchResource;
};

export type ShellState = {
  activity: Activity;
  themeMode: ThemeMode;
  sidebarWidth: number;
  /** Alias used by the workbench design; kept in sync with sidebarWidth. */
  navigatorWidth: number;
  navigatorOpen: boolean;
  inspectorWidth: number;
  inspectorOpen: boolean;
  drawerOpen: boolean;
  drawer: Drawer;
  drawerHeight: number;
  activeInspectorTab: string;
  tabs: ShellTab[];
  activeTabId: string;
  commandPaletteOpen: boolean;
  activeWorkspaceId: string | null;
  /** Legacy/global tab view. It always mirrors tabs for the active workspace. */
  tabsByWorkspace: Record<string, ShellTab[]>;
  /** Readable alias for tabsByWorkspace used by workbench consumers. */
  workspaceTabs: Record<string, ShellTab[]>;
  activeTabIdsByWorkspace: Record<string, string>;
  navigationHistory: WorkbenchHistory;
  /** Short alias for navigationHistory. */
  history: WorkbenchHistory;
  navigationHistoryByWorkspace: Record<string, WorkbenchHistory>;
  selection: WorkbenchSelection | null;
};

const emptyHistory = (): WorkbenchHistory => ({ entries: [], index: -1 });

export const defaultShellState: ShellState = {
  activity: "home",
  themeMode: "light",
  sidebarWidth: 21,
  navigatorWidth: 21,
  navigatorOpen: true,
  inspectorWidth: 22,
  inspectorOpen: true,
  drawerOpen: false,
  drawer: "terminal",
  drawerHeight: 30,
  activeInspectorTab: "overview",
  tabs: [{ id: "welcome", title: "Welcome", activity: "home" }],
  activeTabId: "welcome",
  commandPaletteOpen: false,
  activeWorkspaceId: null,
  tabsByWorkspace: {},
  workspaceTabs: {},
  activeTabIdsByWorkspace: {},
  navigationHistory: emptyHistory(),
  history: emptyHistory(),
  navigationHistoryByWorkspace: {},
  selection: null,
};

export type ShellAction =
  | { type: "activity/set"; activity: Activity }
  | { type: "sidebar/resize"; width: number }
  | { type: "navigator/toggle"; open?: boolean }
  | { type: "inspector/resize"; width: number }
  | { type: "inspector/toggle"; open?: boolean }
  | { type: "inspector/tab"; tab: string }
  | { type: "drawer/toggle"; drawer?: Drawer }
  | { type: "drawer/resize"; height: number }
  | { type: "theme/set"; mode: ThemeMode }
  | { type: "theme/set-mode"; mode: ThemeMode }
  | { type: "tab/open"; tab: ShellTab }
  | {
      type: "resource/open";
      resource: WorkbenchResource;
      title?: string;
      workspaceId?: string;
      activity?: Activity;
    }
  | {
      type: "tab/open-resource";
      resource: WorkbenchResource;
      title?: string;
      workspaceId?: string;
      activity?: Activity;
    }
  | { type: "tab/activate"; id: string; workspaceId?: string }
  | { type: "resource/activate"; id: string; workspaceId?: string }
  | { type: "tab/close"; id: string; workspaceId?: string }
  | { type: "resource/close"; id: string; workspaceId?: string }
  | {
      type: "tab/dirty";
      id: string;
      dirty: boolean;
      workspaceId?: string;
    }
  | {
      type: "tab/set-dirty";
      id: string;
      dirty: boolean;
      workspaceId?: string;
    }
  | {
      type: "tab/mark-dirty";
      id: string;
      dirty: boolean;
      workspaceId?: string;
    }
  | {
      type: "resource/set-dirty";
      id: string;
      dirty: boolean;
      workspaceId?: string;
    }
  | { type: "workspace/select"; workspaceId: string | null }
  | { type: "workspace/activate"; workspaceId: string | null }
  | { type: "selection/set"; selection: WorkbenchSelection | null }
  | { type: "history/push"; entry: WorkbenchHistoryEntry; workspaceId?: string }
  | { type: "history/back"; workspaceId?: string }
  | { type: "history/forward"; workspaceId?: string }
  | { type: "navigation/back"; workspaceId?: string }
  | { type: "navigation/forward"; workspaceId?: string }
  | { type: "history/reset"; workspaceId?: string }
  | { type: "palette/toggle"; open?: boolean }
  | { type: "restore"; state: ShellState | Partial<ShellState> };

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

function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
  );
}

function isResourceKind(value: unknown): value is WorkbenchResourceKind {
  return (
    typeof value === "string" &&
    (WORKBENCH_RESOURCE_KINDS as readonly string[]).includes(value)
  );
}

function isSelection(value: unknown): value is WorkbenchSelection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kind === "string" &&
    [
      "file",
      "graph-node",
      "git-change",
      "agent-session",
      "terminal-session",
    ].includes(candidate.kind)
  );
}

function isResource(value: unknown): value is WorkbenchResource {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    isResourceKind(candidate.kind)
  );
}

function tabActivity(tab: ShellTab, fallback: Activity): Activity {
  return tab.activity ?? tab.resource?.activity ?? fallback;
}

function tabWorkspaceId(
  tab: ShellTab,
  state: ShellState,
  explicitWorkspaceId?: string,
): string | null {
  return (
    explicitWorkspaceId ??
    tab.workspaceId ??
    tab.resource?.workspaceId ??
    state.activeWorkspaceId
  );
}

function historyLocationId(entry: WorkbenchHistoryEntry): string | undefined {
  return entry.resourceId ?? entry.id;
}

function normalizeHistory(value: unknown): WorkbenchHistory {
  if (typeof value !== "object" || value === null) return emptyHistory();
  const candidate = value as Record<string, unknown>;
  const rawEntries = Array.isArray(candidate.entries)
    ? candidate.entries
        .filter(
          (entry): entry is WorkbenchHistoryEntry =>
            typeof entry === "object" && entry !== null,
        )
        .map((entry) => {
          const raw = entry as Record<string, unknown>;
          const normalized: WorkbenchHistoryEntry = {};
          if (typeof raw.id === "string") normalized.id = raw.id;
          if (typeof raw.resourceId === "string")
            normalized.resourceId = raw.resourceId;
          if (typeof raw.workspaceId === "string")
            normalized.workspaceId = raw.workspaceId;
          if (isSelection(raw.selection)) normalized.selection = raw.selection;
          else if (raw.selection === null) normalized.selection = null;
          return normalized;
        })
    : [];
  const rawIndex = candidate.index;
  const index =
    typeof rawIndex === "number" && Number.isFinite(rawIndex)
      ? clamp(rawIndex, -1, Math.max(-1, rawEntries.length - 1))
      : rawEntries.length - 1;
  return { entries: rawEntries, index };
}

function normalizeTab(value: unknown): ShellTab | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.title !== "string")
    return null;
  const activity = isActivity(candidate.activity)
    ? candidate.activity
    : undefined;
  const parsedResource = isResource(candidate.resource)
    ? candidate.resource
    : undefined;
  const kind = typeof candidate.kind === "string" ? candidate.kind : undefined;
  const resource =
    parsedResource ??
    (kind && kind !== "activity"
      ? {
          id: candidate.id,
          title: candidate.title,
          kind:
            kind === "terminal"
              ? ("terminal-session" as const)
              : isResourceKind(kind)
                ? kind
                : ("custom" as const),
        }
      : undefined);
  if (!activity && !resource) return null;
  const tab: ShellTab = { id: candidate.id, title: candidate.title };
  if (activity) tab.activity = activity;
  if (resource) tab.resource = resource;
  if (typeof candidate.kind === "string") tab.kind = candidate.kind;
  if (typeof candidate.resourceType === "string")
    tab.resourceType = candidate.resourceType;
  if (typeof candidate.description === "string")
    tab.description = candidate.description;
  if (typeof candidate.closable === "boolean")
    tab.closable = candidate.closable;
  if (typeof candidate.pinned === "boolean") tab.pinned = candidate.pinned;
  if (typeof candidate.preview === "boolean") tab.preview = candidate.preview;
  if (typeof candidate.dirty === "boolean") tab.dirty = candidate.dirty;
  if (typeof candidate.workspaceId === "string")
    tab.workspaceId = candidate.workspaceId;
  return tab;
}

function normalizeTabs(value: unknown): ShellTab[] {
  return Array.isArray(value)
    ? value
        .map((tab) => normalizeTab(tab))
        .filter((tab): tab is ShellTab => tab !== null)
    : [];
}

function normalizeTabMap(value: unknown): Record<string, ShellTab[]> {
  if (typeof value !== "object" || value === null) return {};
  const result: Record<string, ShellTab[]> = {};
  for (const [workspaceId, rawTabs] of Object.entries(value)) {
    const tabs = normalizeTabs(rawTabs);
    if (tabs.length > 0) result[workspaceId] = tabs;
  }
  return result;
}

function normalizeHistoryMap(value: unknown): Record<string, WorkbenchHistory> {
  if (typeof value !== "object" || value === null) return {};
  const result: Record<string, WorkbenchHistory> = {};
  for (const [workspaceId, rawHistory] of Object.entries(value)) {
    result[workspaceId] = normalizeHistory(rawHistory);
  }
  return result;
}

function normalizeState(value: Partial<ShellState> | ShellState): ShellState {
  const raw = value as Partial<ShellState>;
  const rawTabs = normalizeTabs(raw.tabs);
  const fallbackTab: ShellTab = {
    id: "welcome",
    title: "Welcome",
    activity: "home",
  };
  const tabMap = normalizeTabMap(raw.tabsByWorkspace ?? raw.workspaceTabs);
  const activeWorkspaceId =
    typeof raw.activeWorkspaceId === "string" ? raw.activeWorkspaceId : null;
  const workspaceTabs = { ...tabMap };
  const restoredWorkspaceTabs =
    activeWorkspaceId && workspaceTabs[activeWorkspaceId]
      ? workspaceTabs[activeWorkspaceId]
      : undefined;
  const tabs =
    rawTabs.length > 0 ? rawTabs : (restoredWorkspaceTabs ?? [fallbackTab]);
  const activeTabIdsByWorkspace: Record<string, string> = {};
  for (const [workspaceId, workspaceTabList] of Object.entries(workspaceTabs)) {
    const requested = raw.activeTabIdsByWorkspace?.[workspaceId];
    if (requested && workspaceTabList.some((tab) => tab.id === requested)) {
      activeTabIdsByWorkspace[workspaceId] = requested;
    } else if (workspaceTabList[0]) {
      activeTabIdsByWorkspace[workspaceId] = workspaceTabList[0].id;
    }
  }
  const activeTabId =
    typeof raw.activeTabId === "string" &&
    tabs.some((tab) => tab.id === raw.activeTabId)
      ? raw.activeTabId
      : (tabs[0]?.id ?? fallbackTab.id);
  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? fallbackTab;
  const history = normalizeHistory(raw.navigationHistory ?? raw.history);
  return {
    activity: isActivity(raw.activity)
      ? raw.activity
      : tabActivity(activeTab, "home"),
    themeMode: isThemeMode(raw.themeMode)
      ? raw.themeMode
      : defaultShellState.themeMode,
    sidebarWidth:
      typeof raw.sidebarWidth === "number" && Number.isFinite(raw.sidebarWidth)
        ? clamp(raw.sidebarWidth, 12, 40)
        : typeof raw.navigatorWidth === "number" &&
            Number.isFinite(raw.navigatorWidth)
          ? clamp(raw.navigatorWidth, 12, 40)
          : defaultShellState.sidebarWidth,
    navigatorWidth:
      typeof raw.navigatorWidth === "number" &&
      Number.isFinite(raw.navigatorWidth)
        ? clamp(raw.navigatorWidth, 12, 40)
        : typeof raw.sidebarWidth === "number" &&
            Number.isFinite(raw.sidebarWidth)
          ? clamp(raw.sidebarWidth, 12, 40)
          : defaultShellState.navigatorWidth,
    navigatorOpen:
      typeof raw.navigatorOpen === "boolean"
        ? raw.navigatorOpen
        : defaultShellState.navigatorOpen,
    inspectorWidth:
      typeof raw.inspectorWidth === "number" &&
      Number.isFinite(raw.inspectorWidth)
        ? clamp(raw.inspectorWidth, 14, 40)
        : defaultShellState.inspectorWidth,
    inspectorOpen:
      typeof raw.inspectorOpen === "boolean"
        ? raw.inspectorOpen
        : defaultShellState.inspectorOpen,
    drawerOpen:
      typeof raw.drawerOpen === "boolean"
        ? raw.drawerOpen
        : defaultShellState.drawerOpen,
    drawer: isDrawer(raw.drawer) ? raw.drawer : defaultShellState.drawer,
    drawerHeight:
      typeof raw.drawerHeight === "number" && Number.isFinite(raw.drawerHeight)
        ? clamp(raw.drawerHeight, 12, 80)
        : defaultShellState.drawerHeight,
    activeInspectorTab:
      typeof raw.activeInspectorTab === "string" &&
      raw.activeInspectorTab.length > 0
        ? raw.activeInspectorTab
        : defaultShellState.activeInspectorTab,
    tabs,
    activeTabId,
    commandPaletteOpen:
      typeof raw.commandPaletteOpen === "boolean"
        ? raw.commandPaletteOpen
        : defaultShellState.commandPaletteOpen,
    activeWorkspaceId,
    tabsByWorkspace: workspaceTabs,
    workspaceTabs,
    activeTabIdsByWorkspace,
    navigationHistory: history,
    history,
    navigationHistoryByWorkspace: normalizeHistoryMap(
      raw.navigationHistoryByWorkspace,
    ),
    selection: isSelection(raw.selection) ? raw.selection : null,
  };
}

function setHistory(
  state: ShellState,
  history: WorkbenchHistory,
  workspaceId?: string,
): ShellState {
  if (workspaceId) {
    const navigationHistoryByWorkspace = {
      ...state.navigationHistoryByWorkspace,
      [workspaceId]: history,
    };
    return workspaceId === state.activeWorkspaceId
      ? {
          ...state,
          navigationHistoryByWorkspace,
          navigationHistory: history,
          history,
        }
      : { ...state, navigationHistoryByWorkspace };
  }
  return { ...state, navigationHistory: history, history };
}

function getHistory(state: ShellState, workspaceId?: string): WorkbenchHistory {
  return workspaceId
    ? (state.navigationHistoryByWorkspace[workspaceId] ?? emptyHistory())
    : state.navigationHistory;
}

function pushHistory(
  history: WorkbenchHistory,
  entry: WorkbenchHistoryEntry,
): WorkbenchHistory {
  const locationId = historyLocationId(entry);
  const current = history.entries[history.index];
  if (
    current &&
    historyLocationId(current) === locationId &&
    current.workspaceId === entry.workspaceId
  ) {
    const entries = history.entries.slice();
    entries[history.index] = entry;
    return { entries, index: history.index };
  }
  const entries = history.entries.slice(0, history.index + 1);
  entries.push(entry);
  return { entries, index: entries.length - 1 };
}

function updateTabs(
  state: ShellState,
  tabs: ShellTab[],
  activeTabId: string,
  workspaceId: string | null,
): ShellState {
  if (!workspaceId) {
    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
    return {
      ...state,
      tabs,
      activeTabId: activeTab?.id ?? "",
      activity: activeTab
        ? tabActivity(activeTab, state.activity)
        : state.activity,
    };
  }
  const tabsByWorkspace = { ...state.tabsByWorkspace, [workspaceId]: tabs };
  const activeTabIdsByWorkspace = {
    ...state.activeTabIdsByWorkspace,
    [workspaceId]: activeTabId,
  };
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  return {
    ...state,
    activeWorkspaceId: workspaceId,
    tabs,
    workspaceTabs: tabsByWorkspace,
    tabsByWorkspace,
    activeTabId: activeTab?.id ?? "",
    activeTabIdsByWorkspace,
    activity: activeTab
      ? tabActivity(activeTab, state.activity)
      : state.activity,
  };
}

function openTab(state: ShellState, tab: ShellTab): ShellState {
  const resourceTab =
    !tab.resource && tab.kind && tab.kind !== "activity"
      ? {
          ...tab,
          resource: {
            id: tab.id,
            title: tab.title,
            kind:
              tab.kind === "terminal"
                ? ("terminal-session" as const)
                : isResourceKind(tab.kind)
                  ? tab.kind
                  : ("custom" as const),
            ...(tab.workspaceId ? { workspaceId: tab.workspaceId } : {}),
          },
        }
      : tab;
  const workspaceId = tabWorkspaceId(resourceTab, state);
  const currentTabs = workspaceId
    ? (state.tabsByWorkspace[workspaceId] ?? [])
    : state.tabs;
  const existing = currentTabs.find((item) => item.id === resourceTab.id);
  const tabs = existing
    ? currentTabs.map((item) =>
        item.id === resourceTab.id ? { ...item, ...resourceTab } : item,
      )
    : [...currentTabs, resourceTab];
  let next = updateTabs(state, tabs, resourceTab.id, workspaceId);
  const resourceId = resourceTab.resource?.id;
  if (resourceId) {
    const history = pushHistory(getHistory(next, workspaceId ?? undefined), {
      id: resourceId,
      resourceId,
      ...(workspaceId ? { workspaceId } : {}),
    });
    next = setHistory(next, history, workspaceId ?? undefined);
  }
  return next;
}

function activateTab(
  state: ShellState,
  id: string,
  workspaceId?: string,
): ShellState {
  const targetWorkspaceId = workspaceId ?? state.activeWorkspaceId;
  const tabs = targetWorkspaceId
    ? (state.tabsByWorkspace[targetWorkspaceId] ?? [])
    : state.tabs;
  const tab = tabs.find((item) => item.id === id);
  return tab ? updateTabs(state, tabs, tab.id, targetWorkspaceId) : state;
}

function closeTab(
  state: ShellState,
  id: string,
  workspaceId?: string,
): ShellState {
  const targetWorkspaceId = workspaceId ?? state.activeWorkspaceId;
  const tabs = targetWorkspaceId
    ? (state.tabsByWorkspace[targetWorkspaceId] ?? [])
    : state.tabs;
  if (tabs.length === 1) return state;
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const remaining = tabs.filter((tab) => tab.id !== id);
  if (
    state.activeTabId !== id ||
    targetWorkspaceId !== state.activeWorkspaceId
  ) {
    if (targetWorkspaceId) {
      const tabsByWorkspace = {
        ...state.tabsByWorkspace,
        [targetWorkspaceId]: remaining,
      };
      const workspaceTabs = tabsByWorkspace;
      return {
        ...state,
        tabsByWorkspace,
        workspaceTabs,
        activeTabIdsByWorkspace:
          state.activeTabIdsByWorkspace[targetWorkspaceId] === id
            ? {
                ...state.activeTabIdsByWorkspace,
                [targetWorkspaceId]: remaining[0]?.id ?? "",
              }
            : state.activeTabIdsByWorkspace,
      };
    }
    return { ...state, tabs: remaining };
  }
  const next = remaining[Math.max(0, index - 1)] ?? remaining[0];
  return next
    ? updateTabs(state, remaining, next.id, targetWorkspaceId)
    : state;
}

function setTabDirty(
  state: ShellState,
  id: string,
  dirty: boolean,
  workspaceId?: string,
): ShellState {
  const targetWorkspaceId = workspaceId ?? state.activeWorkspaceId;
  const tabs = targetWorkspaceId
    ? (state.tabsByWorkspace[targetWorkspaceId] ?? [])
    : state.tabs;
  if (!tabs.some((tab) => tab.id === id)) return state;
  const updated = tabs.map((tab) => (tab.id === id ? { ...tab, dirty } : tab));
  if (targetWorkspaceId) {
    const tabsByWorkspace = {
      ...state.tabsByWorkspace,
      [targetWorkspaceId]: updated,
    };
    return {
      ...state,
      tabs:
        targetWorkspaceId === state.activeWorkspaceId ? updated : state.tabs,
      workspaceTabs: tabsByWorkspace,
      tabsByWorkspace,
    };
  }
  return { ...state, tabs: updated };
}

function navigateHistory(
  state: ShellState,
  direction: -1 | 1,
  workspaceId?: string,
): ShellState {
  const targetWorkspaceId = workspaceId ?? state.activeWorkspaceId;
  const history = getHistory(state, targetWorkspaceId ?? undefined);
  const nextIndex = clamp(
    history.index + direction,
    -1,
    history.entries.length - 1,
  );
  if (nextIndex === history.index || nextIndex < 0) return state;
  const nextEntry = history.entries[nextIndex];
  const nextId = nextEntry ? historyLocationId(nextEntry) : undefined;
  let next = setHistory(
    state,
    { ...history, index: nextIndex },
    targetWorkspaceId ?? undefined,
  );
  if (nextId) next = activateTab(next, nextId, targetWorkspaceId ?? undefined);
  if (nextEntry?.selection !== undefined)
    next = { ...next, selection: nextEntry.selection };
  return next;
}

export function shellReducer(
  state: ShellState,
  action: ShellAction,
): ShellState {
  switch (action.type) {
    case "activity/set":
      return { ...state, activity: action.activity };
    case "sidebar/resize": {
      const width = clamp(action.width, 12, 40);
      return { ...state, sidebarWidth: width, navigatorWidth: width };
    }
    case "navigator/toggle":
      return {
        ...state,
        navigatorOpen: action.open ?? !state.navigatorOpen,
      };
    case "inspector/resize":
      return { ...state, inspectorWidth: clamp(action.width, 14, 40) };
    case "inspector/toggle":
      return {
        ...state,
        inspectorOpen: action.open ?? !state.inspectorOpen,
      };
    case "inspector/tab":
      return { ...state, activeInspectorTab: action.tab };
    case "drawer/toggle": {
      const drawer = action.drawer ?? state.drawer;
      return {
        ...state,
        drawer,
        drawerOpen: action.drawer === undefined ? !state.drawerOpen : true,
      };
    }
    case "drawer/resize":
      return { ...state, drawerHeight: clamp(action.height, 12, 80) };
    case "theme/set":
    case "theme/set-mode":
      return { ...state, themeMode: action.mode };
    case "tab/open":
      return openTab(state, action.tab);
    case "resource/open":
    case "tab/open-resource": {
      const activity = action.activity ?? action.resource.activity;
      const tab: ShellTab = {
        id: action.resource.id,
        title: action.title ?? action.resource.title,
        kind:
          action.resource.kind === "terminal-session"
            ? "terminal"
            : action.resource.kind,
        resource: action.resource,
        ...(activity ? { activity } : {}),
        ...(action.workspaceId || action.resource.workspaceId
          ? { workspaceId: action.workspaceId ?? action.resource.workspaceId }
          : {}),
      };
      return openTab(state, tab);
    }
    case "tab/activate":
    case "resource/activate":
      return activateTab(state, action.id, action.workspaceId);
    case "tab/close":
    case "resource/close":
      return closeTab(state, action.id, action.workspaceId);
    case "tab/dirty":
    case "tab/set-dirty":
    case "tab/mark-dirty":
    case "resource/set-dirty":
      return setTabDirty(state, action.id, action.dirty, action.workspaceId);
    case "workspace/select":
    case "workspace/activate": {
      if (action.workspaceId === state.activeWorkspaceId) return state;
      const workspaceId = action.workspaceId;
      if (!workspaceId) {
        return {
          ...state,
          activeWorkspaceId: null,
          tabs: state.tabsByWorkspace["default"] ?? state.tabs,
          activeTabId:
            state.activeTabIdsByWorkspace.default ?? state.activeTabId,
        };
      }
      const tabs = state.tabsByWorkspace[workspaceId] ?? [];
      const activeTabId =
        state.activeTabIdsByWorkspace[workspaceId] ?? tabs[0]?.id ?? "";
      const activeTab = tabs.find((tab) => tab.id === activeTabId);
      const tabsByWorkspace = {
        ...state.tabsByWorkspace,
        [workspaceId]: tabs,
      };
      const activeTabIdsByWorkspace = {
        ...state.activeTabIdsByWorkspace,
        [workspaceId]: activeTabId,
      };
      return {
        ...state,
        activeWorkspaceId: workspaceId,
        tabs,
        tabsByWorkspace,
        workspaceTabs: tabsByWorkspace,
        activeTabIdsByWorkspace,
        activeTabId,
        activity: activeTab
          ? tabActivity(activeTab, state.activity)
          : state.activity,
        navigationHistory:
          state.navigationHistoryByWorkspace[workspaceId] ?? emptyHistory(),
        history:
          state.navigationHistoryByWorkspace[workspaceId] ?? emptyHistory(),
      };
    }
    case "selection/set":
      return { ...state, selection: action.selection };
    case "history/push": {
      const workspaceId =
        action.workspaceId ?? state.activeWorkspaceId ?? undefined;
      return setHistory(
        state,
        pushHistory(getHistory(state, workspaceId), {
          ...action.entry,
          ...(workspaceId && !action.entry.workspaceId ? { workspaceId } : {}),
        }),
        workspaceId,
      );
    }
    case "history/back":
    case "navigation/back":
      return navigateHistory(state, -1, action.workspaceId);
    case "history/forward":
    case "navigation/forward":
      return navigateHistory(state, 1, action.workspaceId);
    case "history/reset": {
      const workspaceId =
        action.workspaceId ?? state.activeWorkspaceId ?? undefined;
      return setHistory(state, emptyHistory(), workspaceId);
    }
    case "palette/toggle":
      return {
        ...state,
        commandPaletteOpen: action.open ?? !state.commandPaletteOpen,
      };
    case "restore":
      return normalizeState(action.state);
    default:
      return state;
  }
}

const storageKey = "second-brain-os.shell.v1";
const storageKeyV2 = "second-brain-os.shell.v2";

/** Read and migrate both the original shell snapshot and the v2 snapshot. */
export function readStoredState(): ShellState {
  if (typeof window === "undefined") return defaultShellState;
  try {
    const stored =
      window.localStorage.getItem(storageKeyV2) ??
      window.localStorage.getItem(storageKey);
    if (!stored) return defaultShellState;
    return normalizeState(JSON.parse(stored) as Partial<ShellState>);
  } catch {
    return defaultShellState;
  }
}

export type ShellLayoutV2 = Omit<ShellLayout, "version" | "inspectorTab"> & {
  version: 2;
  /** Legacy v1 spelling retained when exporting or reading old snapshots. */
  sidebarWidth?: number;
  /** Renderer-only alias; inspectorTab is the canonical IPC spelling. */
  activeInspectorTab?: string;
  /** Drawer identity is local state and is ignored by the current backend. */
  drawer?: Drawer;
  inspectorTab: InspectorTab;
};

const INSPECTOR_TABS: readonly InspectorTab[] = [
  "overview",
  "relationships",
  "source",
  "context",
  "history",
  "provider",
  "actions",
];

function inspectorTab(value: string): InspectorTab {
  return (INSPECTOR_TABS as readonly string[]).includes(value)
    ? (value as InspectorTab)
    : "overview";
}

export function toShellLayoutV2(state: ShellState): ShellLayoutV2 {
  return {
    version: 2,
    // sidebarWidth is the legacy renderer field; navigatorWidth is the v2
    // wire spelling. Keep this mapping explicit for callers restoring v1
    // state objects that do not yet carry the alias.
    navigatorWidth: state.sidebarWidth,
    inspectorWidth: state.inspectorWidth,
    navigatorOpen: state.navigatorOpen,
    inspectorOpen: state.inspectorOpen,
    drawerOpen: state.drawerOpen,
    drawerHeight: state.drawerHeight,
    themeMode: state.themeMode,
    inspectorTab: inspectorTab(state.activeInspectorTab),
  };
}

/** Alias with a name that makes the versioned wire format explicit. */
export const toBackendLayoutV2 = toShellLayoutV2;

export function toBackendLayout(state: ShellState): ShellLayout;
export function toBackendLayout(
  state: ShellState,
  version: 1,
): ReturnType<typeof toLegacyBackendLayout>;
export function toBackendLayout(state: ShellState, version: 2): ShellLayoutV2;
export function toBackendLayout(
  state: ShellState,
  version: 1 | 2 = 2,
): ShellLayout | ShellLayoutV2 | ReturnType<typeof toLegacyBackendLayout> {
  if (version === 2) return toShellLayoutV2(state);
  // Keep an explicit legacy mapper for callers that still write the v1
  // database shape. The default mapper is the canonical v2 IPC payload.
  return toLegacyBackendLayout(state);
}

/** The pre-workbench layout shape, useful to old integrations during rollout. */
export function toLegacyBackendLayout(state: ShellState): {
  version: 1;
  sidebarWidth: number;
  inspectorWidth: number;
  inspectorOpen: boolean;
  drawerOpen: boolean;
} {
  return {
    version: 1,
    sidebarWidth: state.sidebarWidth,
    inspectorWidth: state.inspectorWidth,
    inspectorOpen: state.inspectorOpen,
    drawerOpen: state.drawerOpen,
  };
}

function validLayoutNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

/** Convert a v1 backend layout (or malformed persisted value) to v2. */
export type ShellLayoutInput =
  | ShellLayout
  | ShellLayoutV2
  | (Partial<Omit<ShellLayoutV2, "version">> & { version?: number });

export function migrateShellLayout(
  layout: ShellLayoutInput | null | undefined,
): ShellLayoutV2 {
  const raw = (layout ?? {}) as Partial<ShellLayoutV2> & { version?: number };
  const navigatorWidth = validLayoutNumber(
    raw.navigatorWidth ?? raw.sidebarWidth,
    defaultShellState.navigatorWidth,
    12,
    40,
  );
  return {
    version: 2,
    sidebarWidth: navigatorWidth,
    navigatorWidth,
    inspectorWidth: validLayoutNumber(
      raw.inspectorWidth,
      defaultShellState.inspectorWidth,
      14,
      40,
    ),
    navigatorOpen:
      typeof raw.navigatorOpen === "boolean" ? raw.navigatorOpen : true,
    inspectorOpen:
      typeof raw.inspectorOpen === "boolean"
        ? raw.inspectorOpen
        : defaultShellState.inspectorOpen,
    drawerOpen:
      typeof raw.drawerOpen === "boolean"
        ? raw.drawerOpen
        : defaultShellState.drawerOpen,
    drawerHeight: validLayoutNumber(
      raw.drawerHeight,
      defaultShellState.drawerHeight,
      12,
      80,
    ),
    drawer: isDrawer(raw.drawer) ? raw.drawer : defaultShellState.drawer,
    themeMode: isThemeMode(raw.themeMode)
      ? raw.themeMode
      : defaultShellState.themeMode,
    activeInspectorTab:
      typeof raw.activeInspectorTab === "string" &&
      raw.activeInspectorTab.length > 0
        ? raw.activeInspectorTab
        : defaultShellState.activeInspectorTab,
    inspectorTab: inspectorTab(
      typeof raw.inspectorTab === "string"
        ? raw.inspectorTab
        : typeof raw.activeInspectorTab === "string"
          ? raw.activeInspectorTab
          : defaultShellState.activeInspectorTab,
    ),
  };
}

export const migrateShellLayoutV2 = migrateShellLayout;

function applyBackendLayout(
  state: ShellState,
  layout: ShellLayoutInput,
): ShellState {
  const migrated = migrateShellLayout(layout);
  return {
    ...state,
    sidebarWidth: migrated.navigatorWidth,
    navigatorWidth: migrated.navigatorWidth,
    navigatorOpen: migrated.navigatorOpen,
    inspectorWidth: migrated.inspectorWidth,
    inspectorOpen: migrated.inspectorOpen,
    drawerOpen: migrated.drawerOpen,
    drawer: migrated.drawer ?? state.drawer,
    drawerHeight: migrated.drawerHeight,
    themeMode: migrated.themeMode,
    activeInspectorTab: migrated.activeInspectorTab ?? migrated.inspectorTab,
  };
}

export function fromBackendLayout(
  state: ShellState,
  layout: ShellLayoutInput | null | undefined,
): ShellState {
  return layout ? applyBackendLayout(state, layout) : state;
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
          state: fromBackendLayout(state, result.data),
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
    const serialized = JSON.stringify(state);
    window.localStorage.setItem(storageKeyV2, serialized);
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
