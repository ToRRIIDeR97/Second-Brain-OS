import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FocusedGraph } from "./FocusedGraph";
import { layoutGraph, mergeGraphPages } from "./model";
import type { GraphNode, GraphPage } from "./types";

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
    const expanded = layoutGraph(["c", "b", "a"], first);
    expect(expanded.get("a")).toEqual(first.get("a"));
    expect(expanded.get("b")).toEqual(first.get("b"));
    expect(expanded.get("c")).toBeDefined();
  });
});

describe("FocusedGraph", () => {
  it("ignores an obsolete expansion and exposes relationships as buttons", async () => {
    let resolveFirst: ((value: GraphPage) => void) | undefined;
    const onExpand = vi
      .fn<(id: string) => Promise<GraphPage>>()
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
    fireEvent.click(screen.getByRole("button", { name: /^a, Note/ }));
    fireEvent.click(screen.getByRole("button", { name: /^b, Note/ }));
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
});
