import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/components/layout/AppShell";
import { FocusedGraph } from "../src/features/graph";
import { LocalPlanner } from "../src/features/planner";
import { createMockIpc } from "../src/lib/ipc";

describe("accessibility hardening", () => {
  it("gives shell controls names, landmarks, visible focus, and keyboard access", () => {
    render(<AppShell ipc={createMockIpc().client} />);

    expect(
      screen.getByRole("navigation", { name: "Primary activity" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAccessibleName();
      button.focus();
      expect(button).toHaveFocus();
    }

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      screen.getByRole("dialog", { name: "Command palette" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search commands" }),
    ).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Command palette" }),
    ).not.toBeInTheDocument();
  });

  it("keeps graph and planner workflows available without canvas or pointer input", () => {
    const { unmount } = render(
      <FocusedGraph
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
      screen.getByRole("complementary", {
        name: "Graph inspector and relationship list",
      }),
    ).toBeInTheDocument();
    const beta = screen.getByRole("button", { name: /^Beta, Note/ });
    beta.focus();
    fireEvent.keyDown(beta, { key: "Enter" });
    expect(beta).toHaveAttribute("aria-pressed", "true");
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
