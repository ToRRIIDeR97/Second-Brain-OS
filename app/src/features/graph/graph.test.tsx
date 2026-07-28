import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FocusedGraph } from "./FocusedGraph";
import { layoutGraph, mergeGraphPages } from "./model";
import type {
  GraphCommand,
  GraphCommandContext,
  GraphNode,
  GraphPage,
} from "./types";

const node = (id: string, label = id): GraphNode => ({
  id,
  label,
  type: "Note",
  authority: "explicit_file",
});

const page = (nodes: GraphNode[], truncated = false): GraphPage => ({
  nodes,
  edges:
    nodes.length > 1
      ? [
          {
            id: `${nodes[0]?.id ?? ""}-${nodes[1]?.id ?? ""}`,
            sourceId: nodes[0]?.id ?? "",
            targetId: nodes[1]?.id ?? "",
            type: "LINKS_TO",
            authority: "explicit_file",
          },
        ]
      : [],
  truncated,
});

describe("focused graph model", () => {
  it("merges expansions deterministically without exceeding the hard cap", () => {
    const merged = mergeGraphPages(
      page([node("b"), node("a")]),
      page([node("c"), node("a")], true),
      2,
    );
    expect(merged.nodes.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(merged.truncated).toBe(true);
  });

  it("preserves positions while deterministically placing new nodes", () => {
    const first = layoutGraph(["b", "a"]);
    const expanded = layoutGraph(["c", "b", "a"], [], first);
    expect(expanded.get("a")).toEqual(first.get("a"));
    expect(expanded.get("b")).toEqual(first.get("b"));
    expect(expanded.get("c")).toBeDefined();
  });
});

describe("FocusedGraph", () => {
  it("selects nodes without expanding until the explicit action is used", async () => {
    const onExpand = vi
      .fn<(id: string, knownNodeIds: string[]) => Promise<GraphPage>>()
      .mockResolvedValue(page([node("expanded")]));

    const { container } = render(
      <FocusedGraph page={page([node("a"), node("b")])} onExpand={onExpand} />,
    );
    expect(container.querySelectorAll("svg circle")).toHaveLength(2);
    const firstNode = screen.getByRole("button", { name: /^a, Note/ });
    fireEvent.click(firstNode);
    expect(onExpand).not.toHaveBeenCalled();
    expect(firstNode).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(onExpand).toHaveBeenCalledWith("a", ["a", "b"]);
    await screen.findByRole("button", { name: /^expanded, Note/ });
  });

  it("does not expand from keyboard selection and ignores an obsolete expansion", async () => {
    let resolveFirst: ((value: GraphPage) => void) | undefined;
    const onExpand = vi
      .fn<(id: string, knownNodeIds: string[]) => Promise<GraphPage>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(page([node("current", "Current result")]));

    render(
      <FocusedGraph page={page([node("a"), node("b")])} onExpand={onExpand} />,
    );
    const firstNode = screen.getByRole("button", { name: /^a, Note/ });
    fireEvent.keyDown(firstNode, { key: "Enter" });
    expect(onExpand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: /^b, Note/ }));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await screen.findByRole("button", { name: /^Current result, Note/ });
    resolveFirst?.(page([node("obsolete", "Obsolete result")]));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /^Obsolete result, Note/ }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /LINKS_TO → a/ }),
    ).toBeInTheDocument();
  });

  it("keeps launch actions behind the node context menu", () => {
    const onCommand =
      vi.fn<(command: GraphCommand, context: GraphCommandContext) => void>();
    render(<FocusedGraph page={page([node("a")])} onCommand={onCommand} />);
    expect(
      screen.queryByRole("button", { name: "Open terminal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Prepare agent" }),
    ).not.toBeInTheDocument();

    const graphNode = screen.getByRole("button", { name: /^a, Note/ });
    fireEvent.contextMenu(graphNode);
    expect(
      screen.getByRole("menu", { name: "Actions for a" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open terminal" }));
    fireEvent.contextMenu(graphNode);
    fireEvent.click(screen.getByRole("menuitem", { name: "Prepare Codex" }));
    fireEvent.contextMenu(graphNode);
    fireEvent.click(screen.getByRole("menuitem", { name: "Prepare Claude" }));

    expect(onCommand.mock.calls.map(([command]) => command)).toEqual([
      "graph.show-actions",
      "graph.open-terminal",
      "graph.show-actions",
      "graph.prepare-agent",
      "graph.show-actions",
      "graph.prepare-agent",
    ]);
    expect(onCommand.mock.calls[1]?.[1]?.node.id).toBe("a");
    expect(onCommand.mock.calls[3]?.[1]?.provider).toBe("codex");
    expect(onCommand.mock.calls[5]?.[1]?.provider).toBe("claude");
  });
});
