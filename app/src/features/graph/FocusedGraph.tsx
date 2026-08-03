import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authorityLabel,
  boundedGraph,
  DEFAULT_GRAPH_CAP,
  isInferred,
  layoutGraph,
  mergeGraphPages,
} from "./model";
import type {
  GraphCommand,
  GraphCommandContext,
  GraphEdge,
  GraphNode,
  GraphPage,
  GraphPosition,
  GraphSelectionContext,
} from "./types";

export type FocusedGraphProps = {
  page: GraphPage;
  hardCap?: number;
  /**
   * When provided, the graph reads selection from its parent. Passing `null`
   * explicitly clears a controlled selection; omitting the prop keeps the
   * graph self-managed for small/embedded consumers.
   */
  selectedNodeId?: string | null;
  /** Called with the selected node id whenever the user changes selection. */
  onSelectionChange?: (nodeId: string | undefined) => void;
  /**
   * Receives the bounded graph context for the selected node. This is the
   * bridge used by a global inspector and keeps relationship rendering out of
   * the graph canvas.
   */
  onSelectionContextChange?: (
    context: GraphSelectionContext | undefined,
  ) => void;
  onExpand?: (nodeId: string, knownNodeIds: string[]) => Promise<GraphPage>;
  onLoadMore?: (
    continuationToken: string,
    knownNodeIds: string[],
  ) => Promise<GraphPage>;
  onCommand?: (
    command: GraphCommand,
    context: GraphCommandContext,
  ) => void | Promise<void>;
  /**
   * Render the legacy relationship inspector inside the graph. It is opt-in so
   * shell consumers can render the same context in the global inspector.
   */
  showInspector?: boolean;
  /** Alias for consumers that prefer the feature's placement-oriented name. */
  embeddedInspector?: boolean;
};

type GraphContextMenu = {
  node: GraphNode;
  x: number;
  y: number;
};

const buttonStyle = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  color: "var(--text)",
  background: "var(--surface-raised)",
  padding: "6px 8px",
  cursor: "pointer",
} as const;

function statusText(record: Pick<GraphNode, "authority" | "stale">): string {
  return `${authorityLabel(record.authority)}${record.stale ? ", stale" : ", current"}`;
}

function nodeLabel(node: GraphNode): string {
  const confidence =
    node.confidence === undefined
      ? ""
      : `, ${String(Math.round(node.confidence * 100))}% confidence`;
  return `${node.label}, ${node.type}, ${statusText(node)}${confidence}`;
}

function relatedNode(
  edge: GraphEdge,
  selectedId: string,
  nodes: Map<string, GraphNode>,
): GraphNode | undefined {
  return nodes.get(
    edge.sourceId === selectedId ? edge.targetId : edge.sourceId,
  );
}

const nodeColors = [
  "#ef7f88",
  "#e87baa",
  "#4f91e8",
  "#62b65a",
  "#e1bd47",
  "#72a6b9",
  "#dc7557",
  "#8ccf72",
] as const;

function graphHash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function nodeColor(node: GraphNode): string {
  if (node.type.toLowerCase().includes("folder")) return "#e7c54f";
  return nodeColors[graphHash(node.type) % nodeColors.length] ?? "#79a7c0";
}

export function FocusedGraph({
  page,
  hardCap = DEFAULT_GRAPH_CAP,
  selectedNodeId,
  onSelectionChange,
  onSelectionContextChange,
  onExpand,
  onLoadMore,
  onCommand,
  showInspector: showInspectorProp,
  embeddedInspector,
}: FocusedGraphProps) {
  const [graph, setGraph] = useState(() => boundedGraph(page, hardCap));
  const [internalSelectedId, setInternalSelectedId] = useState<string>();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [positions, setPositions] = useState<Map<string, GraphPosition>>(
    () => new Map(),
  );
  const [loadingRequests, setLoadingRequests] = useState(0);
  const [error, setError] = useState<string>();
  const [contextMenu, setContextMenu] = useState<GraphContextMenu>();
  const graphEpoch = useRef(0);
  const layoutVersion = useRef(0);
  const loading = loadingRequests > 0;
  const showInspector = showInspectorProp ?? embeddedInspector ?? false;

  useEffect(() => {
    graphEpoch.current += 1;
    const next = boundedGraph(page, hardCap);
    setGraph(next);
    setInternalSelectedId((current) =>
      current && next.nodes.some(({ id }) => id === current)
        ? current
        : undefined,
    );
    setExpandedIds(new Set());
    setContextMenu(undefined);
  }, [hardCap, page]);

  useEffect(() => {
    const version = ++layoutVersion.current;
    const timer = window.setTimeout(() => {
      if (version !== layoutVersion.current) return;
      setPositions((current) =>
        layoutGraph(
          graph.nodes.map(({ id }) => id),
          graph.edges,
          current,
        ),
      );
    });
    return () => {
      window.clearTimeout(timer);
    };
  }, [graph.edges, graph.nodes]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => {
      setContextMenu(undefined);
    };
    const dismissOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("keydown", dismissOnKeyDown);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("keydown", dismissOnKeyDown);
    };
  }, [contextMenu]);

  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const effectiveSelectedId =
    selectedNodeId !== undefined
      ? (selectedNodeId ?? undefined)
      : internalSelectedId;
  const selected = effectiveSelectedId
    ? nodesById.get(effectiveSelectedId)
    : undefined;
  const relationships = useMemo(
    () =>
      selected
        ? graph.edges.filter(
            ({ sourceId, targetId }) =>
              sourceId === selected.id || targetId === selected.id,
          )
        : [],
    [graph.edges, selected],
  );
  const selectionContext = useMemo<GraphSelectionContext | undefined>(() => {
    if (!selected) return undefined;
    const relatedNodes = relationships
      .map((edge) => relatedNode(edge, selected.id, nodesById))
      .filter((node): node is GraphNode => Boolean(node));
    return {
      node: selected,
      relationships,
      relatedNodes,
      graph,
    };
  }, [graph, nodesById, relationships, selected]);

  useEffect(() => {
    onSelectionContextChange?.(selectionContext);
  }, [onSelectionContextChange, selectionContext]);

  const nodeDegrees = useMemo(() => {
    const degrees = new Map<string, number>();
    graph.nodes.forEach(({ id }) => degrees.set(id, 0));
    graph.edges.forEach(({ sourceId, targetId }) => {
      degrees.set(sourceId, (degrees.get(sourceId) ?? 0) + 1);
      degrees.set(targetId, (degrees.get(targetId) ?? 0) + 1);
    });
    return degrees;
  }, [graph.edges, graph.nodes]);

  const addPage = useCallback(
    async (load: () => Promise<GraphPage>) => {
      const epoch = graphEpoch.current;
      setLoadingRequests((current) => current + 1);
      setError(undefined);
      try {
        const incoming = await load();
        if (epoch !== graphEpoch.current) return false;
        setGraph((current) => mergeGraphPages(current, incoming, hardCap));
        return true;
      } catch (cause) {
        if (epoch === graphEpoch.current)
          setError(
            cause instanceof Error ? cause.message : "Graph request failed",
          );
        return false;
      } finally {
        setLoadingRequests((current) => Math.max(0, current - 1));
      }
    },
    [hardCap],
  );

  const selectNode = useCallback(
    (node: GraphNode) => {
      setInternalSelectedId(node.id);
      onSelectionChange?.(node.id);
    },
    [onSelectionChange],
  );

  const clearSelection = useCallback(() => {
    setInternalSelectedId(undefined);
    onSelectionChange?.(undefined);
  }, [onSelectionChange]);

  const expandNode = useCallback(
    (node: GraphNode) => {
      if (
        !onExpand ||
        expandedIds.has(node.id) ||
        graph.nodes.length >= hardCap
      )
        return;
      setExpandedIds((current) => new Set(current).add(node.id));
      void addPage(() =>
        onExpand(
          node.id,
          graph.nodes.map(({ id }) => id),
        ),
      ).then((succeeded) => {
        if (succeeded) return;
        setExpandedIds((current) => {
          const next = new Set(current);
          next.delete(node.id);
          return next;
        });
      });
    },
    [addPage, expandedIds, graph.nodes, hardCap, onExpand],
  );

  const runCommand = useCallback(
    (
      command: GraphCommand,
      node: GraphNode,
      provider?: GraphCommandContext["provider"],
    ) => {
      if (!onCommand) return;
      const context: GraphCommandContext = {
        node,
        ...(node.source ? { source: node.source } : {}),
        ...(provider ? { provider } : {}),
      };
      void onCommand(command, context);
    },
    [onCommand],
  );

  return (
    <section className="focused-graph" aria-label="Focused knowledge graph">
      <div className="focused-graph-canvas">
        <svg
          role="img"
          aria-label={`Focused graph with ${String(graph.nodes.length)} nodes and ${String(graph.edges.length)} relationships`}
          viewBox="0 0 960 610"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter
              id="node-glow"
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
            >
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect width="960" height="610" fill="#17191d" />
          {graph.edges.map((edge) => {
            const source = positions.get(edge.sourceId);
            const target = positions.get(edge.targetId);
            if (!source || !target) return null;
            return (
              <g key={edge.id}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={isInferred(edge.authority) ? "#747079" : "#92979d"}
                  strokeWidth="0.65"
                  opacity="0.54"
                  strokeDasharray={isInferred(edge.authority) ? "5 4" : "none"}
                />
                <title>{`${edge.type}, ${statusText(edge)}`}</title>
              </g>
            );
          })}
          {graph.nodes.map((node) => {
            const position = positions.get(node.id) ?? { x: 90, y: 70 };
            const selectedNode = effectiveSelectedId === node.id;
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={nodeLabel(node)}
                aria-haspopup="menu"
                aria-pressed={selectedNode}
                aria-expanded={onExpand ? expandedIds.has(node.id) : undefined}
                transform={`translate(${String(position.x)} ${String(position.y)})`}
                onClick={(event) => {
                  if (event.detail <= 1) {
                    selectNode(node);
                  }
                }}
                onDoubleClick={() => {
                  selectNode(node);
                  if (onExpand) expandNode(node);
                  else if (node.source) runCommand("graph.open-source", node);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  selectNode(node);
                  setContextMenu({
                    node,
                    x: event.clientX,
                    y: event.clientY,
                  });
                  runCommand("graph.show-actions", node);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectNode(node);
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <circle
                  r={Math.min(
                    15,
                    4 +
                      Math.sqrt(nodeDegrees.get(node.id) ?? 0) * 1.7 +
                      (node.type.toLowerCase().includes("folder") ? 2 : 0) +
                      (selectedNode ? 2 : 0),
                  )}
                  fill={nodeColor(node)}
                  stroke={
                    node.stale
                      ? "var(--danger)"
                      : selectedNode
                        ? "#f3f5f7"
                        : "#24272c"
                  }
                  strokeWidth={selectedNode ? 1.8 : 0.65}
                  strokeDasharray={isInferred(node.authority) ? "3 2" : "none"}
                  opacity={node.stale ? 0.72 : 0.98}
                  filter={selectedNode ? "url(#node-glow)" : undefined}
                />
                {selectedNode ? (
                  <text
                    x="18"
                    y="4"
                    fill="#f1f2f4"
                    fontSize="11"
                    paintOrder="stroke"
                    stroke="#17191d"
                    strokeWidth="3"
                  >
                    {node.label.length > 28
                      ? `${node.label.slice(0, 27)}…`
                      : node.label}
                  </text>
                ) : null}
                <title>{nodeLabel(node)}</title>
              </g>
            );
          })}
        </svg>
        {loading ? (
          <p role="status" style={{ margin: 12, color: "var(--text-muted)" }}>
            Loading graph…
          </p>
        ) : null}
        {error ? (
          <p role="alert" style={{ margin: 12, color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}
        {graph.truncated ? (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: 12,
            }}
          >
            <span>
              Results truncated; this view is capped at {hardCap} items.
            </span>
            {graph.continuationToken && onLoadMore ? (
              <button
                type="button"
                style={buttonStyle}
                disabled={loading || graph.nodes.length >= hardCap}
                onClick={() => {
                  const token = graph.continuationToken;
                  if (!token) return;
                  void addPage(() =>
                    onLoadMore(
                      token,
                      graph.nodes.map(({ id }) => id),
                    ),
                  );
                }}
              >
                Load more
              </button>
            ) : null}
          </div>
        ) : null}
        {contextMenu ? (
          <div
            role="menu"
            aria-label={`Actions for ${contextMenu.node.label}`}
            style={{
              position: "fixed",
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 10,
              display: "grid",
              gap: 4,
              minWidth: 160,
              padding: 6,
              border: "1px solid var(--line)",
              borderRadius: 6,
              background: "var(--surface-raised)",
              boxShadow: "0 8px 20px rgba(0, 0, 0, 0.2)",
            }}
          >
            {(
              [
                ["graph.open-terminal", "Open terminal", undefined],
                ["graph.prepare-agent", "Prepare Codex", "codex"],
                ["graph.prepare-agent", "Prepare Claude", "claude"],
              ] as const
            ).map(([command, label, provider], index) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                style={{ ...buttonStyle, textAlign: "left" }}
                autoFocus={index === 0}
                onClick={() => {
                  setContextMenu(undefined);
                  runCommand(command, contextMenu.node, provider);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {showInspector && selected ? (
        <aside
          className="focused-graph-inspector"
          aria-label="Graph inspector and relationship list"
        >
          <button
            type="button"
            className="focused-graph-inspector-close"
            aria-label="Close graph inspector"
            onClick={() => {
              clearSelection();
            }}
          >
            ×
          </button>
          <>
            <p style={{ margin: "0 0 4px", color: "var(--text-muted)" }}>
              {selected.type}
            </p>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>
              {selected.label}
            </h2>
            <p>
              Authority: {authorityLabel(selected.authority)}
              <br />
              State: {selected.stale ? "stale" : "current"}
              {selected.confidence === undefined ? null : (
                <>
                  <br />
                  Confidence: {Math.round(selected.confidence * 100)}%
                </>
              )}
            </p>
            <div
              aria-label="Selected node actions"
              style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
            >
              {onExpand ? (
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={
                    expandedIds.has(selected.id) ||
                    graph.nodes.length >= hardCap
                  }
                  onClick={() => {
                    expandNode(selected);
                  }}
                >
                  {expandedIds.has(selected.id) ? "Expanded" : "Expand"}
                </button>
              ) : null}
              {selected.source ? (
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => {
                    runCommand("graph.open-source", selected);
                  }}
                >
                  Open source
                </button>
              ) : null}
              {(
                [
                  ["graph.search-related", "Search related"],
                  ["graph.add-to-context", "Add to context"],
                ] as const
              ).map(([command, label]) => (
                <button
                  key={command}
                  type="button"
                  style={buttonStyle}
                  onClick={() => {
                    runCommand(command, selected);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <h3 style={{ marginBottom: 8 }}>Relationships</h3>
            {relationships.length ? (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {relationships.map((edge) => {
                  const related = relatedNode(edge, selected.id, nodesById);
                  if (!related) return null;
                  return (
                    <li key={edge.id} style={{ marginBottom: 6 }}>
                      <button
                        type="button"
                        style={{
                          ...buttonStyle,
                          width: "100%",
                          textAlign: "left",
                        }}
                        onClick={() => {
                          selectNode(related);
                        }}
                      >
                        <strong>{edge.type}</strong> → {related.label}
                        <small
                          style={{
                            display: "block",
                            color: "var(--text-muted)",
                          }}
                        >
                          {statusText(edge)}
                        </small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No visible relationships.</p>
            )}
          </>
        </aside>
      ) : null}
    </section>
  );
}
