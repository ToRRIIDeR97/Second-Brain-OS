import {
  defaultShellState,
  migrateShellLayout,
  shellReducer,
  toLegacyBackendLayout,
  toBackendLayout,
} from "../src/state/shell";

test("shell reducer keeps tab and pane state keyboard-operable", () => {
  const planner = shellReducer(defaultShellState, {
    type: "tab/open",
    tab: { id: "planner", title: "Planner", activity: "planner" },
  });
  expect(planner.activeTabId).toBe("planner");
  expect(planner.activity).toBe("planner");
  const resized = shellReducer(planner, { type: "sidebar/resize", width: 99 });
  expect(resized.sidebarWidth).toBe(40);
  expect(toBackendLayout(resized)).toMatchObject({
    version: 2,
    navigatorWidth: 40,
  });
  expect(toLegacyBackendLayout(resized)).toMatchObject({
    version: 1,
    sidebarWidth: 40,
  });
  const themed = shellReducer(resized, { type: "theme/set", mode: "auto" });
  const inspector = shellReducer(themed, {
    type: "inspector/tab",
    tab: "context",
  });
  const collapsed = shellReducer(inspector, {
    type: "navigator/toggle",
    open: false,
  });
  expect(toBackendLayout(collapsed)).toMatchObject({
    themeMode: "auto",
    inspectorTab: "context",
    navigatorOpen: false,
  });
});

test("resource-only tabs are scoped to a workspace and can be marked dirty", () => {
  const opened = shellReducer(defaultShellState, {
    type: "resource/open",
    resource: {
      id: "doc-1",
      kind: "file",
      title: "Architecture",
      workspaceId: "brain",
    },
  });

  expect(opened.activeWorkspaceId).toBe("brain");
  expect(opened.tabs).toHaveLength(1);
  expect(opened.tabsByWorkspace.brain).toHaveLength(1);
  expect(opened.activeTabId).toBe("doc-1");

  const dirty = shellReducer(opened, {
    type: "tab/set-dirty",
    id: "doc-1",
    dirty: true,
  });
  expect(dirty.tabs[0]?.dirty).toBe(true);
  expect(dirty.workspaceTabs.brain?.[0]?.dirty).toBe(true);
});

test("kind-only resource tabs receive a stable resource identity", () => {
  const state = shellReducer(defaultShellState, {
    type: "tab/open",
    tab: {
      id: "preview-1",
      title: "Preview",
      kind: "preview",
      workspaceId: "brain",
    },
  });
  expect(state.tabs[0]?.resource).toMatchObject({
    id: "preview-1",
    kind: "preview",
  });
  expect(state.history.entries[0]?.resourceId).toBe("preview-1");
});

test("workspace collections and navigation history stay independent", () => {
  const first = shellReducer(defaultShellState, {
    type: "resource/open",
    resource: {
      id: "one",
      kind: "file",
      title: "One",
      workspaceId: "first",
    },
  });
  const second = shellReducer(first, {
    type: "resource/open",
    resource: {
      id: "two",
      kind: "file",
      title: "Two",
      workspaceId: "first",
    },
  });
  expect(second.history.entries.map((entry) => entry.resourceId)).toEqual([
    "one",
    "two",
  ]);

  const switched = shellReducer(second, {
    type: "workspace/select",
    workspaceId: "second",
  });
  expect(switched.tabs).toEqual([]);
  const other = shellReducer(switched, {
    type: "resource/open",
    resource: {
      id: "other",
      kind: "graph",
      title: "Graph",
      workspaceId: "second",
    },
  });
  expect(other.tabsByWorkspace.first?.map((tab) => tab.id)).toEqual([
    "one",
    "two",
  ]);
  expect(other.tabsByWorkspace.second?.map((tab) => tab.id)).toEqual(["other"]);
  expect(other.history.entries.map((entry) => entry.resourceId)).toEqual([
    "other",
  ]);
});

test("history back and forward activate resource tabs", () => {
  const one = shellReducer(defaultShellState, {
    type: "resource/open",
    resource: { id: "one", kind: "file", title: "One" },
  });
  const two = shellReducer(one, {
    type: "resource/open",
    resource: { id: "two", kind: "file", title: "Two" },
  });
  const back = shellReducer(two, { type: "history/back" });
  expect(back.activeTabId).toBe("one");
  expect(back.history.index).toBe(0);
  const forward = shellReducer(back, { type: "history/forward" });
  expect(forward.activeTabId).toBe("two");
  expect(forward.history.index).toBe(1);
});

test("history restores control-center views as one location", () => {
  const home = shellReducer(defaultShellState, {
    type: "history/push",
    entry: {
      id: "home",
      activity: "home",
      projectView: "overview",
      plannerView: "today",
      projectId: null,
    },
  });
  const project = shellReducer(home, {
    type: "history/push",
    entry: {
      id: "project-map",
      activity: "projects",
      projectView: "map",
      plannerView: "tasks",
      projectId: "project_alpha",
    },
  });
  const current = {
    ...project,
    activity: "projects" as const,
    projectView: "map" as const,
    plannerView: "tasks" as const,
  };

  const back = shellReducer(current, { type: "history/back" });
  expect(back).toMatchObject({
    activity: "home",
    projectView: "overview",
    plannerView: "today",
  });
  expect(back.history.entries[1]?.projectId).toBe("project_alpha");

  const forward = shellReducer(back, { type: "history/forward" });
  expect(forward).toMatchObject({
    activity: "projects",
    projectView: "map",
    plannerView: "tasks",
  });
});

test("v1 layout payloads migrate to the canonical v2 shape", () => {
  const migrated = migrateShellLayout({
    version: 1,
    sidebarWidth: 33,
    inspectorWidth: 18,
    inspectorOpen: false,
    drawerOpen: true,
  });
  expect(migrated).toMatchObject({
    version: 2,
    navigatorWidth: 33,
    inspectorWidth: 18,
    inspectorOpen: false,
    drawerOpen: true,
    themeMode: "light",
  });
});
