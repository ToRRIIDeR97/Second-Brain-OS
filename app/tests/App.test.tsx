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
    screen.getByRole("button", { name: "Check bridge" }),
  ).toBeInTheDocument();
});

test("routes activities and opens knowledge search from the keyboard", () => {
  const mock = createMockIpc();
  render(<AppShell ipc={mock.client} />);

  fireEvent.click(screen.getByRole("button", { name: "Graph" }));
  expect(screen.getByRole("main")).toHaveAttribute("data-route", "graph");
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(
    screen.getByRole("dialog", { name: "Search knowledge" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("searchbox", { name: "Search knowledge" }),
  ).toHaveFocus();
});
