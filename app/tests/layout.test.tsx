import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { Drawer } from "../src/components/layout/Drawer";
import { Navigator } from "../src/components/layout/Navigator";

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

test("drawer exposes terminal first and renders its supplied content", () => {
  const onSelect = vi.fn();
  render(
    <Drawer
      active="terminal"
      onSelect={onSelect}
      terminal={<p>Shell output</p>}
    />,
  );

  expect(screen.getAllByRole("tab")[0]).toHaveTextContent("Terminal");
  expect(screen.getAllByRole("tab")).toHaveLength(1);
  expect(screen.getByText("Shell output")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
  expect(onSelect).toHaveBeenCalledWith("terminal");
  expect(screen.queryByText(/is ready/)).not.toBeInTheDocument();
});
