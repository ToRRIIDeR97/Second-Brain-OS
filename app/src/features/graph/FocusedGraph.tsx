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
} from "./types";

type FocusedGraphProps = {
  page: GraphPage;
  hardCap?: number;
  onExpand?: (nodeId: string, knownNodeIds: string[]) => Promise<GraphPage>;
  onLoadMore?: (
    continuationToken: string,
    knownNodeIds: string[],
  ) => Promise<GraphPage>;
  onCommand?: (
    command: GraphCommand,
    context: GraphCommandContext,
  ) => void | Promise<void>;
};

type GraphContextMenu = {
  node: GraphNode;
  x: number;
  y: number;
};

const panelStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(230px, 27%)",
  minHeight: 0,
  height: "100%",
} as const;

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

export function FocusedGraph({
  page,
  hardCap = DEFAULT_GRAPH_CAP,
  onExpand,
  onLoadMore,
  onCommand,
}: FocusedGraphProps) {
  const [graph, setGraph] = useState(() => boundedGraph(page, hardCap));
  const [selectedId, setSelectedId] = useState<string | undefined>(
    graph.nodes[0]?.id,
  );
  const [positions, setPositions] = useState<Map<string, GraphPosition>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [contextMenu, setContextMenu] = useState<GraphContextMenu>();
  const requestVersion = useRef(0);
  const layoutVersion = useRef(0);

  useEffect(() => {
    requestVersion.current += 1;
    const next = boundedGraph(page, hardCap);
    setGraph(next);
    setSelectedId((current) =>
      current && next.nodes.some(({ id }) => id === current)
        ? current
        : next.nodes[0]?.id,
    );
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
  const selected = selectedId ? nodesById.get(selectedId) : undefined;
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
  const showLabels = graph.nodes.length <= 35;

  const addPage = useCallback(
    async (load: () => Promise<GraphPage>) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setError(undefined);
      try {
        const incoming = await load();
        if (version !== requestVersion.current) return;
        setGraph((current) => mergeGraphPages(current, incoming, hardCap));
      } catch (cause) {
        if (version === requestVersion.current)
          setError(
            cause instanceof Error ? cause.message : "Graph request failed",
          );
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [hardCap],
  );

  const selectNode = useCallback((node: GraphNode) => {
    setSelectedId(node.id);
  }, []);

  const expandNode = useCallback(
    (node: GraphNode) => {
      if (!onExpand || graph.nodes.length >= hardCap) return;
      void addPage(() =>
        onExpand(
          node.id,
          graph.nodes.map(({ id }) => id),
        ),
      );
    },
    [addPage, graph.nodes, hardCap, onExpand],
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
    <section aria-label="Focused knowledge graph" style={panelStyle}>
      <div
        className="focused-graph-canvas"
        style={{ minWidth: 0, overflow: "hidden", position: "relative" }}
      >
        <svg
          role="img"
          aria-label={`Focused graph with ${String(graph.nodes.length)} nodes and ${String(graph.edges.length)} relationships`}
          viewBox="0 0 960 610"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block", width: "100%", height: "100%" }}
        >
          <defs>
            <radialGradient id="graph-background">
              <stop offset="0%" stopColor="#1b2230" />
              <stop offset="100%" stopColor="#0d1118" />
            </radialGradient>
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
          <rect width="960" height="610" fill="url(#graph-background)" />
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
                  stroke={isInferred(edge.authority) ? "#666078" : "#667184"}
                  strokeWidth="0.8"
                  opacity="0.48"
                  strokeDasharray={isInferred(edge.authority) ? "5 4" : "none"}
                />
                <title>{`${edge.type}, ${statusText(edge)}`}</title>
              </g>
            );
          })}
          {graph.nodes.map((node) => {
            const position = positions.get(node.id) ?? { x: 90, y: 70 };
            const selectedNode = selectedId === node.id;
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={nodeLabel(node)}
                aria-haspopup="menu"
                aria-pressed={selectedNode}
                transform={`translate(${String(position.x)} ${String(position.y)})`}
                onClick={(event) => {
                  if (event.detail <= 1) selectNode(node);
                }}
                onDoubleClick={() => {
                  if (node.source) runCommand("graph.open-source", node);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelectedId(node.id);
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
                  r={
                    selectedNode
                      ? 15
                      : node.type.toLowerCase().includes("folder")
                        ? 11
                        : 7
                  }
                  fill={
                    selectedNode
                      ? "#c3b1ff"
                      : node.type.toLowerCase().includes("folder")
                        ? "#e4cd68"
                        : node.type.toLowerCase().includes("note")
                          ? "#7f91ff"
                          : "#aab3c2"
                  }
                  stroke={node.stale ? "var(--danger)" : "#e8ecf4"}
                  strokeWidth={selectedNode ? 2.5 : 0.8}
                  strokeDasharray={isInferred(node.authority) ? "3 2" : "none"}
                  opacity={node.stale ? 0.72 : 0.96}
                  filter={selectedNode ? "url(#node-glow)" : undefined}
                />
                {showLabels || selectedNode ? (
                  <text
                    x={selectedNode ? 20 : 14}
                    y="4"
                    fill={selectedNode ? "#f2edff" : "#c4cad5"}
                    fontSize={selectedNode ? 12 : 10}
                    paintOrder="stroke"
                    stroke="#0d1118"
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

      <aside
        aria-label="Graph inspector and relationship list"
        style={{
          overflow: "auto",
          padding: 16,
          borderLeft: "1px solid var(--line)",
          background: "var(--surface)",
        }}
      >
        {selected ? (
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
                  disabled={graph.nodes.length >= hardCap}
                  onClick={() => {
                    expandNode(selected);
                  }}
                >
                  Expand
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
                          setSelectedId(related.id);
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
        ) : (
          <p>No node selected.</p>
        )}
      </aside>
    </section>
  );
}
