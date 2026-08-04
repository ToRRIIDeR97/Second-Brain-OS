import { fireEvent, render, screen } from "@testing-library/react";
import { AppShell } from "../src/components/layout/AppShell";
import { createMockIpc } from "../src/lib/ipc";

test("renders the persistent application shell", () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  expect(screen.getByRole("main")).toHaveAttribute("data-route", "home");
  expect(
    screen.getByRole("navigation", { name: "Primary activity" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /welcome/i })).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Open a utility" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Files" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("complementary", { name: "Inspector" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Check desktop bridge" }),
  ).not.toBeInTheDocument();
});

test("opens the calendar and Google Tasks in the right utility panel", () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  fireEvent.click(
    screen.getByRole("button", { name: /Calendar and Google Tasks/ }),
  );
  expect(screen.getByRole("tab", { name: "Calendar" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Week of/ })).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Task list" }),
  ).toBeInTheDocument();
});

test("keeps the graph integrated into Home and opens knowledge search", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: /Calendar/ }));

  expect(terminal).toBeInTheDocument();
  expect(terminal).toHaveAttribute("hidden");
});
