import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { ActivityBar } from "../src/components/layout/ActivityBar";
import { Drawer } from "../src/components/layout/Drawer";
import { Inspector } from "../src/components/layout/Inspector";
import { Navigator } from "../src/components/layout/Navigator";
import { Tabs } from "../src/components/layout/Tabs";

test("navigator opens data-backed notes and collections", () => {
  const onDailyNoteSelect = vi.fn();
  const onCollectionSelect = vi.fn();
  const note = { id: "today", label: "Today", secondary: "Jun 28" };
  const collection = { id: "ideas", label: "Ideas" };

  render(
    <Navigator
      activity="knowledge"
      dailyNotes={[note]}
      collections={[collection]}
      onDailyNoteSelect={onDailyNoteSelect}
      onCollectionSelect={onCollectionSelect}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Today/ }));
  fireEvent.click(screen.getByRole("button", { name: "Ideas" }));
  expect(onDailyNoteSelect).toHaveBeenCalledWith(note);
  expect(onCollectionSelect).toHaveBeenCalledWith(collection);
  expect(screen.queryByText("Local workspace ready")).not.toBeInTheDocument();
});

test("navigator hides from its header control", () => {
  const onClose = vi.fn();

  render(<Navigator activity="home" onClose={onClose} />);

  expect(screen.queryByText("Navigator")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hide navigator" }));
  expect(onClose).toHaveBeenCalledOnce();
});

test("drawer renders terminal content without a duplicate header", () => {
  render(<Drawer terminal={<p>Shell output</p>} />);

  expect(screen.getByText("Shell output")).toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "Terminal" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/is ready/)).not.toBeInTheDocument();
});

test("activity rail keeps the primary order and moves focus with arrow keys", () => {
  const onChange = vi.fn();
  render(<ActivityBar active="home" onChange={onChange} />);

  const rail = screen.getByRole("navigation", { name: "Primary activity" });
  const buttons = within(rail).getAllByRole("button");
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Home",
    "Files",
    "Tasks",
    "Agents",
    "Settings",
  ]);
  expect(buttons.at(-1)?.parentElement).toHaveAttribute(
    "data-section",
    "settings",
  );

  const homeButton = buttons[0];
  const knowledgeButton = buttons[1];
  const agentsButton = buttons[3];
  if (!homeButton || !knowledgeButton || !agentsButton) {
    throw new Error("Activity rail did not render all expected buttons");
  }
  fireEvent.keyDown(homeButton, { key: "ArrowDown" });
  expect(knowledgeButton).toHaveFocus();
  fireEvent.click(knowledgeButton);
  expect(onChange).toHaveBeenCalledWith("files");
  fireEvent.click(agentsButton);
  expect(onChange).toHaveBeenCalledWith("agents");
});

test("resource tabs support roving keyboard focus and dirty close state", () => {
  const onActivate = vi.fn();
  const onClose = vi.fn();
  render(
    <Tabs
      tabs={[
        { id: "home", title: "Home", activity: "home", kind: "activity" },
        {
          id: "readme",
          title: "README.md",
          activity: "files",
          kind: "file",
          dirty: true,
        },
      ]}
      activeTabId="home"
      onActivate={onActivate}
      onClose={onClose}
    />,
  );

  const readmeTab = screen.getByRole("tab", {
    name: "README.md, unsaved changes",
  });
  expect(readmeTab.parentElement).toHaveAttribute("data-resource-kind", "file");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Home" }), {
    key: "ArrowRight",
  });
  expect(readmeTab).toHaveFocus();
  fireEvent.keyDown(readmeTab, { key: "Enter" });
  expect(onActivate).toHaveBeenCalledWith("readme");
  fireEvent.click(screen.getByRole("button", { name: "Close README.md" }));
  expect(onClose).toHaveBeenCalledWith("readme");
});

test("tab add opens Home by default and offers activity tabs", () => {
  const onAdd = vi.fn();

  render(
    <Tabs
      tabs={[{ id: "home", title: "Home", activity: "home" }]}
      activeTabId="home"
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onAdd={onAdd}
    />,
  );

  const addButton = screen.getByRole("button", {
    name: "Open a new resource",
  });
  fireEvent.click(addButton);
  fireEvent.mouseEnter(addButton);
  fireEvent.click(screen.getByRole("button", { name: "Files" }));
  expect(onAdd).toHaveBeenNthCalledWith(1, "home");
  expect(onAdd).toHaveBeenNthCalledWith(2, "knowledge");
});

test("inspector tabs render the selected resource contract", () => {
  const onTabChange = vi.fn();
  render(
    <Inspector
      activity="files"
      selection={{
        kind: "file",
        id: "readme",
        title: "README.md",
        subtitle: "Workspace file",
        metadata: [{ label: "Path", value: "README.md" }],
      }}
      onTabChange={onTabChange}
    />,
  );

  expect(screen.getAllByText("README.md").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("tab", { name: "Provenance" }));
  expect(onTabChange).toHaveBeenCalledWith("source");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Source");
});
