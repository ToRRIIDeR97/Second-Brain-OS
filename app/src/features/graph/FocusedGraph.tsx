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

const panelStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 32%)",
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
  }, [hardCap, page]);

  useEffect(() => {
    const version = ++layoutVersion.current;
    const timer = window.setTimeout(() => {
      if (version !== layoutVersion.current) return;
      setPositions((current) =>
        layoutGraph(
          graph.nodes.map(({ id }) => id),
          current,
        ),
      );
    });
    return () => {
      window.clearTimeout(timer);
    };
  }, [graph.nodes]);

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
  const width = Math.max(
    640,
    ...[...positions.values()].map(({ x }) => x + 110),
  );
  const height = Math.max(
    360,
    ...[...positions.values()].map(({ y }) => y + 70),
  );

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

  const selectAndExpand = useCallback(
    (node: GraphNode) => {
      setSelectedId(node.id);
      if (onExpand && graph.nodes.length < hardCap) {
        void addPage(() =>
          onExpand(
            node.id,
            graph.nodes.map(({ id }) => id),
          ),
        );
      }
    },
    [addPage, graph.nodes, hardCap, onExpand],
  );

  const runCommand = useCallback(
    (command: GraphCommand, node: GraphNode) => {
      if (!onCommand) return;
      const context: GraphCommandContext = {
        node,
        ...(node.source ? { source: node.source } : {}),
      };
      void onCommand(command, context);
    },
    [onCommand],
  );

  return (
    <section aria-label="Focused knowledge graph" style={panelStyle}>
      <div style={{ minWidth: 0, overflow: "auto", position: "relative" }}>
        <svg
          role="img"
          aria-label={`Focused graph with ${String(graph.nodes.length)} nodes and ${String(graph.edges.length)} relationships`}
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          style={{ display: "block", minWidth: 640, width: "100%" }}
        >
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
                  stroke="var(--text-faint)"
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
                aria-pressed={selectedNode}
                transform={`translate(${String(position.x - 75)} ${String(position.y - 32)})`}
                onClick={(event) => {
                  if (event.detail <= 1) selectAndExpand(node);
                }}
                onDoubleClick={() => {
                  if (node.source) runCommand("graph.open-source", node);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelectedId(node.id);
                  runCommand("graph.show-actions", node);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectAndExpand(node);
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <rect
                  width="150"
                  height="64"
                  rx="8"
                  fill={
                    selectedNode ? "var(--surface-hover)" : "var(--surface)"
                  }
                  stroke={node.stale ? "var(--danger)" : "var(--text-muted)"}
                  strokeWidth={selectedNode ? 2 : 1}
                  strokeDasharray={isInferred(node.authority) ? "6 4" : "none"}
                />
                <text x="10" y="20" fill="var(--text)" fontSize="12">
                  {node.label.length > 20
                    ? `${node.label.slice(0, 19)}…`
                    : node.label}
                </text>
                <text x="10" y="39" fill="var(--text-muted)" fontSize="10">
                  {node.type}
                </text>
                <text x="10" y="54" fill="var(--text-muted)" fontSize="9">
                  {isInferred(node.authority) ? "INFERRED" : "AUTHORITATIVE"}
                  {node.stale ? " · STALE" : ""}
                </text>
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
                  ["graph.open-terminal", "Open terminal"],
                  ["graph.add-to-context", "Add to context"],
                  ["graph.prepare-agent", "Prepare agent"],
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
