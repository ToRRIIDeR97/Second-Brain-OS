import {
  defaultShellState,
  shellReducer,
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
    version: 1,
    sidebarWidth: 40,
  });
});
