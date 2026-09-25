import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach } from "vitest";
import { AppShell } from "../src/components/layout/AppShell";
import { createMockIpc } from "../src/lib/ipc";

beforeEach(() => {
  window.localStorage.clear();
});

test("renders the persistent application shell", () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  expect(screen.getByRole("main")).toHaveAttribute("data-route", "home");
  expect(
    screen.getByRole("navigation", { name: "Primary activity" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Open a utility" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Search notes and workspace" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Files" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("complementary", { name: "Inspector" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Check desktop bridge" }),
  ).not.toBeInTheDocument();
});

test("changes the main route from the primary activity rail", () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  expect(screen.getByRole("main")).toHaveAttribute("data-route", "projects");
});

test("opens global creation and agent actions", async () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  fireEvent.click(screen.getByRole("button", { name: "Ask Second Brain" }));
  expect(await screen.findByRole("tab", { name: "Ask" })).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("Create"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Task" }));
  expect(screen.getByRole("main")).toHaveAttribute("data-route", "calendar");
});

test("opens the local planner in the right utility panel", async () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  fireEvent.click(screen.getByRole("button", { name: "Show utility panel" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Local tasks and calendar/ }),
  );
  expect(screen.getByRole("tab", { name: "Calendar" })).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Create a Brain to start planning." }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Google/)).not.toBeInTheDocument();
});

test("keeps the graph out of Home and opens knowledge search", async () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  expect(
    screen.queryByRole("button", { name: "Graph" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveAttribute("data-route", "home");
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(
    await screen.findByRole("dialog", { name: "Search knowledge" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("searchbox", { name: "Search knowledge" }),
  ).toHaveFocus();
});

test("confirms before closing the terminal utility", async () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  fireEvent.click(
    screen.getByRole("button", { name: "Open terminal in utility panel" }),
  );
  const terminal = await screen.findByLabelText("Terminal workspace");
  expect(screen.getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close Terminal" }));
  expect(
    screen.getByRole("dialog", { name: "Close terminal?" }),
  ).toBeInTheDocument();
  expect(terminal).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("tab", { name: "Terminal" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Close Terminal" }));
  fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
  expect(screen.queryByLabelText("Terminal workspace")).not.toBeInTheDocument();
});

test("keeps an open terminal mounted when another utility tab is selected", async () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  fireEvent.click(
    screen.getByRole("button", { name: "Open terminal in utility panel" }),
  );
  const terminal = await screen.findByLabelText("Terminal workspace");
  fireEvent.click(screen.getByLabelText("Add utility tab"));
  const utility = screen.getByRole("complementary", { name: "Utility panel" });
  fireEvent.click(within(utility).getByRole("button", { name: /Calendar/ }));

  expect(terminal).toBeInTheDocument();
  expect(terminal).toHaveAttribute("hidden");
});
