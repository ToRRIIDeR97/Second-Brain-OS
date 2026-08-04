import { type ForceGraphMethods, type NodeObject } from "react-force-graph-3d";
import ForceGraph3D from "react-force-graph-3d";
import { Focus, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CanvasTexture,
  Group,
  MOUSE,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { isInferred } from "./model";
import type { GraphEdge, GraphNode, GraphPage } from "./types";

type Graph3DNode = GraphNode & { degree: number };
type Graph3DLink = GraphEdge & { source: string; target: string };

type GraphViewport3DProps = {
  graph: GraphPage;
  theme?: "light" | "dark";
  expandedNodeIds?: ReadonlySet<string>;
  selectedNodeId?: string | undefined;
  onSelect: (node: GraphNode) => void;
  onExpand: (node: GraphNode) => void;
  onContextMenu: (node: GraphNode, x: number, y: number) => void;
  onClearSelection: () => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  busy?: boolean;
};

function isFolderNode(node: GraphNode): boolean {
  return node.type.toLowerCase().includes("folder");
}

function nodeColor(node: GraphNode): string {
  return isFolderNode(node) ? "#9fd6ae" : "#9fc8e8";
}

function highlightedNodeColor(node: GraphNode): string {
  return isFolderNode(node) ? "#c8f0d1" : "#cae6fa";
}

function fileName(node: GraphNode): string {
  return node.label.split(/[\\/]/).at(-1) ?? node.label;
}

function displayName(node: GraphNode): string {
  const name = fileName(node);
  return name.length > 12 ? `${name.slice(0, 10)}..` : name;
}

function nodeLabel(node: GraphNode): string {
  return `${fileName(node)} · ${node.type}`;
}

function createNodeName(node: GraphNode, theme: "light" | "dark"): Group {
  const label = displayName(node);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "600 44px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 8;
    context.strokeStyle = theme === "dark" ? "#171b21" : "#fbfcfd";
    context.strokeText(label, canvas.width / 2, canvas.height / 2);
    context.fillStyle = theme === "dark" ? "#eef2f5" : "#27313a";
    context.fillText(label, canvas.width / 2, canvas.height / 2);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.position.y = 6;
  sprite.scale.set(20, 5, 1);
  sprite.renderOrder = 1;
  const worldPosition = new Vector3();
  sprite.onBeforeRender = (_renderer, _scene, camera) => {
    const distance = camera.position.distanceTo(
      sprite.getWorldPosition(worldPosition),
    );
    material.opacity = Math.max(0, Math.min(1, (210 - distance) / 100));
  };
  const group = new Group();
  group.name = label;
  group.add(sprite);
  return group;
}

function supportsWebGL(): boolean {
  if (typeof window === "undefined" || /jsdom/i.test(navigator.userAgent))
    return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function GraphViewport3D({
  graph,
  theme = "light",
  expandedNodeIds,
  selectedNodeId,
  onSelect,
  onExpand,
  onContextMenu,
  onClearSelection,
  onExpandAll,
  onCollapseAll,
  busy = false,
}: GraphViewport3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const forceGraphRef = useRef<
    ForceGraphMethods<Graph3DNode, Graph3DLink> | undefined
  >(undefined);
  const lastClick = useRef<{ id: string; at: number } | undefined>(undefined);
  const [size, setSize] = useState({ width: 960, height: 610 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string>();
  const [hoveredLinkNodeIds, setHoveredLinkNodeIds] = useState<Set<string>>();
  const [webglAvailable] = useState(supportsWebGL);
  const backgroundColor = theme === "dark" ? "#171b21" : "#fbfcfd";

  const graphData = useMemo(() => {
    const degrees = new Map<string, number>();
    graph.nodes.forEach((node) => degrees.set(node.id, 0));
    graph.edges.forEach(({ sourceId, targetId }) => {
      degrees.set(sourceId, (degrees.get(sourceId) ?? 0) + 1);
      degrees.set(targetId, (degrees.get(targetId) ?? 0) + 1);
    });
    return {
      // The library adds mutable simulation coordinates, so never give it our
      // canonical graph records directly.
      nodes: graph.nodes.map((node) => ({
        ...node,
        degree: degrees.get(node.id) ?? 0,
      })),
      links: graph.edges.map((edge) => ({
        ...edge,
        source: edge.sourceId,
        target: edge.targetId,
      })),
    };
  }, [graph.edges, graph.nodes]);

  const highlightedNodeIds = useMemo(() => {
    if (hoveredLinkNodeIds) return hoveredLinkNodeIds;
    const focusId = hoveredNodeId ?? selectedNodeId;
    if (!focusId) return new Set<string>();
    return new Set(
      graph.edges.flatMap((edge) =>
        edge.sourceId === focusId
          ? [focusId, edge.targetId]
          : edge.targetId === focusId
            ? [focusId, edge.sourceId]
            : [],
      ),
    );
  }, [graph.edges, hoveredLinkNodeIds, hoveredNodeId, selectedNodeId]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const fitGraph = useCallback((duration = 350) => {
    forceGraphRef.current?.zoomToFit(duration, 55);
  }, []);

  const zoomGraph = useCallback((factor: number) => {
    const graph = forceGraphRef.current;
    if (!graph) return;
    const camera = graph.camera();
    const target =
      (graph.controls() as { target?: Vector3 }).target ?? new Vector3();
    graph.cameraPosition(
      {
        x: target.x + (camera.position.x - target.x) * factor,
        y: target.y + (camera.position.y - target.y) * factor,
        z: target.z + (camera.position.z - target.z) * factor,
      },
      target,
      180,
    );
  }, []);

  useEffect(() => {
    const controls = forceGraphRef.current?.controls() as
      | {
          mouseButtons?: { LEFT: number; MIDDLE: number; RIGHT: number };
          update?: () => void;
        }
      | undefined;
    if (!controls?.mouseButtons) return;
    controls.mouseButtons.MIDDLE = MOUSE.PAN;
    controls.mouseButtons.RIGHT = MOUSE.DOLLY;
    controls.update?.();
  }, [graphData]);

  const nodeNameObject = useCallback(
    (node: Graph3DNode) => createNodeName(node, theme),
    [theme],
  );

  useEffect(() => {
    // Sparse focused graphs occupy only a few pixels at the renderer's default
    // camera distance. Let the force layout establish coordinates, then frame
    // the graph just as the explicit "Fit graph" control does.
    const timer = window.setTimeout(() => {
      fitGraph();
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [fitGraph, graphData, size.height, size.width]);

  const focusNode = useCallback((node: NodeObject<Graph3DNode>) => {
    if (node.x === undefined || node.y === undefined || node.z === undefined)
      return;
    const distance = 85;
    const magnitude = Math.hypot(node.x, node.y, node.z) || 1;
    const ratio = 1 + distance / magnitude;
    forceGraphRef.current?.cameraPosition(
      { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
      { x: node.x, y: node.y, z: node.z },
      500,
    );
  }, []);

  const handleNodeClick = useCallback(
    (node: NodeObject<Graph3DNode>) => {
      const at = Date.now();
      const doubleClick =
        lastClick.current?.id === node.id && at - lastClick.current.at < 350;
      lastClick.current = { id: node.id, at };
      onSelect(node);
      focusNode(node);
      if (isFolderNode(node) || doubleClick) onExpand(node);
    },
    [focusNode, onExpand, onSelect],
  );

  return (
    <div ref={containerRef} className="focused-graph-viewport">
      <div
        className="sr-only"
        role="img"
        aria-label={`Focused graph with ${String(graph.nodes.length)} nodes and ${String(graph.edges.length)} relationships`}
      />
      {webglAvailable ? (
        <>
          <ForceGraph3D<Graph3DNode, Graph3DLink>
            ref={forceGraphRef}
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor={backgroundColor}
            controlType="orbit"
            showNavInfo={false}
            warmupTicks={60}
            cooldownTime={5_000}
            d3VelocityDecay={0.45}
            nodeRelSize={2.7}
            nodeResolution={16}
            nodeVal={(node) => 1 + Math.sqrt(node.degree)}
            nodeColor={(node) =>
              highlightedNodeIds.has(node.id)
                ? highlightedNodeColor(node)
                : nodeColor(node)
            }
            nodeLabel={nodeLabel}
            nodeThreeObject={nodeNameObject}
            nodeThreeObjectExtend
            linkColor={(edge) =>
              highlightedNodeIds.has(edge.sourceId) &&
              highlightedNodeIds.has(edge.targetId)
                ? "#c7e5ff"
                : isInferred(edge.authority)
                  ? "#747079"
                  : "#92979d"
            }
            linkWidth={(edge) =>
              highlightedNodeIds.has(edge.sourceId) &&
              highlightedNodeIds.has(edge.targetId)
                ? 1.6
                : 0.6
            }
            nodeOpacity={0.96}
            linkOpacity={0.5}
            onNodeClick={handleNodeClick}
            onNodeHover={(node) => {
              setHoveredNodeId(node?.id ?? undefined);
              setHoveredLinkNodeIds(undefined);
            }}
            onLinkHover={(edge) => {
              setHoveredNodeId(undefined);
              setHoveredLinkNodeIds(
                edge ? new Set([edge.sourceId, edge.targetId]) : undefined,
              );
            }}
            onNodeRightClick={(node, event) => {
              event.preventDefault();
              onSelect(node);
              onContextMenu(node, event.clientX, event.clientY);
            }}
            onBackgroundClick={onClearSelection}
          />
          <div className="focused-graph-controls">
            <button
              type="button"
              aria-label="Expand all nodes"
              title="Expand all nodes"
              disabled={!onExpandAll || busy}
              onClick={onExpandAll}
            >
              <Maximize2 aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Collapse to root node"
              title="Collapse to root node"
              disabled={!onCollapseAll || busy}
              onClick={onCollapseAll}
            >
              <Minimize2 aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => {
                zoomGraph(0.78);
              }}
            >
              <ZoomIn aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => {
                zoomGraph(1.28);
              }}
            >
              <ZoomOut aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Reset graph view"
              title="Reset graph view"
              onClick={() => {
                fitGraph();
              }}
            >
              <Focus aria-hidden="true" />
            </button>
          </div>
        </>
      ) : (
        <p className="focused-graph-fallback" role="status">
          3D graph is unavailable. Use the accessible node list below.
        </p>
      )}
      <div className="sr-only" aria-label="Graph nodes">
        {graphData.nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            aria-label={`${fileName(node)}, ${node.type}`}
            aria-pressed={node.id === selectedNodeId}
            aria-expanded={
              isFolderNode(node)
                ? (expandedNodeIds?.has(node.id) ?? false)
                : undefined
            }
            onClick={() => {
              onSelect(node);
              if (isFolderNode(node)) onExpand(node);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(node);
                if (isFolderNode(node)) onExpand(node);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelect(node);
              onContextMenu(node, event.clientX, event.clientY);
            }}
          >
            {nodeLabel(node)}
          </button>
        ))}
      </div>
    </div>
  );
}
