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
    screen.getByRole("button", { name: "Check desktop bridge" }),
  ).toBeInTheDocument();
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

test("routes activities and opens knowledge search from the keyboard", async () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  fireEvent.click(screen.getByRole("button", { name: "Graph" }));
  expect(screen.getByRole("main")).toHaveAttribute("data-route", "graph");
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(
    await screen.findByRole("dialog", { name: "Search knowledge" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("searchbox", { name: "Search knowledge" }),
  ).toHaveFocus();
});

test("opens the terminal directly and returns to the launcher when its tab closes", async () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  fireEvent.click(
    screen.getByRole("button", { name: "Open terminal in utility panel" }),
  );
  expect(
    await screen.findByLabelText("Terminal workspace"),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close Terminal" }));
  expect(
    screen.getByRole("heading", { name: "Open a utility" }),
  ).toBeInTheDocument();
});
