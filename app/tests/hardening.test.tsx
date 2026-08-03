import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/components/layout/AppShell";
import { FocusedGraph } from "../src/features/graph";
import { LocalPlanner } from "../src/features/planner";
import { createMockIpc } from "../src/lib/ipc";

describe("accessibility hardening", () => {
  it("gives shell controls names, landmarks, visible focus, and keyboard access", async () => {
    render(<AppShell ipc={createMockIpc().client} />);

    expect(
      screen.getByRole("navigation", { name: "Primary activity" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAccessibleName();
      if (button.matches(":disabled")) continue;
      button.focus();
      expect(button).toHaveFocus();
    }

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      await screen.findByRole("dialog", { name: "Search knowledge" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("searchbox", { name: "Search knowledge" }),
      ).toHaveFocus();
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Search knowledge" }),
    ).not.toBeInTheDocument();
  });

  it("keeps graph and planner workflows available without canvas or pointer input", () => {
    const { unmount } = render(
      <FocusedGraph
        showInspector
        page={{
          nodes: [
            {
              id: "a",
              label: "Alpha",
              type: "Note",
              authority: "explicit_file",
            },
            {
              id: "b",
              label: "Beta",
              type: "Note",
              authority: "explicit_file",
            },
          ],
          edges: [
            {
              id: "a-b",
              sourceId: "a",
              targetId: "b",
              type: "LINKS_TO",
              authority: "explicit_file",
            },
          ],
          truncated: false,
        }}
      />,
    );
    expect(
      screen.getByRole("img", { name: /Focused graph with 2 nodes/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", {
        name: "Graph inspector and relationship list",
      }),
    ).not.toBeInTheDocument();
    const beta = screen.getByRole("button", { name: /^Beta, Note/ });
    beta.focus();
    fireEvent.keyDown(beta, { key: "Enter" });
    expect(beta).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("complementary", {
        name: "Graph inspector and relationship list",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    unmount();

    render(<LocalPlanner nowEpochSeconds={1_751_320_800} timezone="UTC" />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Keyboard task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add locally" }));
    expect(
      screen.getByRole("list", { name: "tasks planner items" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Complete Keyboard task" }),
    ).toBeInTheDocument();
  });
});
