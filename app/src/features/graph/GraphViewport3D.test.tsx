import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOUSE, type Object3D } from "three";
import { GraphViewport3D } from "./GraphViewport3D";
import type { GraphEdge, GraphNode, GraphPage } from "./types";

type ForceGraphRenderProps = {
  backgroundColor?: string;
  cooldownTime?: number;
  extraRenderers?: unknown[];
  nodeColor?: (node: GraphNode) => string;
  nodeLabel?: (node: GraphNode) => string;
  nodeResolution?: number;
  nodeThreeObject?: (node: GraphNode) => Object3D;
  nodeThreeObjectExtend?: boolean;
  onLinkHover?: (edge: GraphEdge | null) => void;
  warmupTicks?: number;
};

const { cameraPosition, orbitControls, renderForceGraph, zoomToFit } =
  vi.hoisted(() => ({
    cameraPosition: vi.fn(),
    orbitControls: {
      mouseButtons: { LEFT: 0, MIDDLE: 1, RIGHT: 2 },
      target: { x: 0, y: 0, z: 0 },
      update: vi.fn(),
    },
    renderForceGraph: vi.fn<(props: ForceGraphRenderProps) => void>(),
    zoomToFit: vi.fn(),
  }));

vi.mock("react-force-graph-3d", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<unknown, ForceGraphRenderProps>(
      function MockForceGraph3D(props, ref) {
        renderForceGraph(props);
        React.useImperativeHandle(ref, () => ({
          camera: () => ({ position: { x: 0, y: 0, z: 100 } }),
          cameraPosition,
          controls: () => orbitControls,
          zoomToFit,
        }));
        return React.createElement("canvas");
      },
    ),
  };
});

const graph: GraphPage = {
  nodes: [
    { id: "a", label: "Alpha", type: "Note", authority: "explicit_file" },
    { id: "b", label: "Beta", type: "Note", authority: "explicit_file" },
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
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cameraPosition.mockReset();
  orbitControls.mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
  orbitControls.update.mockReset();
  renderForceGraph.mockReset();
  zoomToFit.mockReset();
});

describe("GraphViewport3D", () => {
  it("uses the middle mouse button to pan", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 TestBrowser",
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );

    render(
      <GraphViewport3D
        graph={graph}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
        onContextMenu={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );

    expect(orbitControls.mouseButtons).toMatchObject({
      MIDDLE: MOUSE.PAN,
      RIGHT: MOUSE.DOLLY,
    });
  });

  it("exposes expand and collapse controls", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 TestBrowser",
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );
    const onExpandAll = vi.fn();
    const onCollapseAll = vi.fn();

    render(
      <GraphViewport3D
        graph={graph}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
        onContextMenu={vi.fn()}
        onClearSelection={vi.fn()}
        onExpandAll={onExpandAll}
        onCollapseAll={onCollapseAll}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand all nodes" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse to root node" }),
    );
    expect(onExpandAll).toHaveBeenCalledOnce();
    expect(onCollapseAll).toHaveBeenCalledOnce();
  });

  it("frames a sparse graph without an ambient camera animation", () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 TestBrowser",
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );

    render(
      <GraphViewport3D
        graph={graph}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
        onContextMenu={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(zoomToFit).toHaveBeenCalledWith(0, 55);
    expect(renderForceGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({ cooldownTime: 0, warmupTicks: 120 }),
    );
  });

  it("updates the opaque WebGL background with the resolved theme", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 TestBrowser",
    );
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as WebGLRenderingContext);

    const view = render(
      <GraphViewport3D
        graph={graph}
        theme="light"
        onSelect={vi.fn()}
        onExpand={vi.fn()}
        onContextMenu={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );

    expect(renderForceGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({
        backgroundColor: "#fbfcfd",
        nodeResolution: 16,
        nodeThreeObjectExtend: true,
      }),
    );
    const color = renderForceGraph.mock.lastCall?.[0].nodeColor;
    const sampleNode = graph.nodes[0];
    expect(sampleNode).toBeDefined();
    if (!sampleNode) return;
    expect(color?.({ ...sampleNode, type: "folder" })).toBe("#9fd6ae");
    expect(color?.({ ...sampleNode, type: "file" })).toBe("#9fc8e8");
    expect(renderForceGraph.mock.lastCall?.[0].nodeLabel?.(sampleNode)).toBe(
      "Alpha · Note",
    );
    getContext.mockReturnValue({
      clearRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
    } as unknown as WebGLRenderingContext);
    const labelObject = renderForceGraph.mock.lastCall?.[0].nodeThreeObject?.({
      ...sampleNode,
      label: "abcdefghijklmnop.md",
    });
    expect(labelObject?.name).toBe("abcdefghij..");
    const labelElement = (
      labelObject?.children[0] as unknown as {
        element: HTMLElement;
      }
    ).element;
    expect(labelElement).toHaveClass("focused-graph-node-label");
    expect(labelElement).toHaveTextContent("abcdefghij..");
    expect(renderForceGraph.mock.lastCall?.[0].extraRenderers).toHaveLength(1);

    act(() => {
      renderForceGraph.mock.lastCall?.[0].onLinkHover?.(graph.edges[0] ?? null);
    });
    const highlightedColor = renderForceGraph.mock.lastCall?.[0].nodeColor;
    expect(highlightedColor?.(sampleNode)).toBe("#cae6fa");
    expect(highlightedColor?.(graph.nodes[1] ?? sampleNode)).toBe("#cae6fa");

    expect(screen.getByRole("button", { name: "Zoom in" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(cameraPosition).toHaveBeenLastCalledWith(
      { x: 0, y: 0, z: 78 },
      { x: 0, y: 0, z: 0 },
      180,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(cameraPosition).toHaveBeenLastCalledWith(
      { x: 0, y: 0, z: 128 },
      { x: 0, y: 0, z: 0 },
      180,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset graph view" }));
    expect(zoomToFit).toHaveBeenLastCalledWith(350, 55);

    view.rerender(
      <GraphViewport3D
        graph={graph}
        theme="dark"
        onSelect={vi.fn()}
        onExpand={vi.fn()}
        onContextMenu={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(renderForceGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({ backgroundColor: "#171b21" }),
    );
  });

  it("removes graph and camera animation when reduced motion is requested", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 TestBrowser",
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );

    render(
      <GraphViewport3D
        graph={graph}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
        onContextMenu={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );

    expect(renderForceGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({ cooldownTime: 0, warmupTicks: 120 }),
    );
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(zoomToFit).toHaveBeenLastCalledWith(0, 55);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(cameraPosition).toHaveBeenLastCalledWith(
      { x: 0, y: 0, z: 78 },
      { x: 0, y: 0, z: 0 },
      0,
    );
  });
});
