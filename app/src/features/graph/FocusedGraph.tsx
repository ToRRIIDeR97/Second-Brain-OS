import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authorityLabel,
  boundedGraph,
  DEFAULT_GRAPH_CAP,
  mergeGraphPages,
} from "./model";
import { GraphViewport3D } from "./GraphViewport3D";
import type {
  GraphCommand,
  GraphCommandContext,
  GraphEdge,
  GraphNode,
  GraphPage,
  GraphSelectionContext,
} from "./types";

export type FocusedGraphProps = {
  page: GraphPage;
  /** Resolved application theme used by the opaque WebGL canvas. */
  theme?: "light" | "dark";
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

type ExpandedBranch = {
  nodeIds: string[];
  edgeIds: string[];
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
  theme = "light",
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
  const [expandedBranches, setExpandedBranches] = useState<
    Map<string, ExpandedBranch>
  >(() => new Map());
  const [loadingRequests, setLoadingRequests] = useState(0);
  const [error, setError] = useState<string>();
  const [contextMenu, setContextMenu] = useState<GraphContextMenu>();
  const graphEpoch = useRef(0);
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
    setExpandedBranches(new Map());
    setContextMenu(undefined);
  }, [hardCap, page]);

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

  const addPage = useCallback(
    async (
      load: () => Promise<GraphPage>,
      onIncoming?: (incoming: GraphPage) => void,
    ) => {
      const epoch = graphEpoch.current;
      setLoadingRequests((current) => current + 1);
      setError(undefined);
      try {
        const incoming = await load();
        if (epoch !== graphEpoch.current) return false;
        onIncoming?.(incoming);
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

  const collapseNode = useCallback(
    (nodeId: string) => {
      const branchIds = new Set<string>();
      const nodeIds = new Set<string>();
      const edgeIds = new Set<string>();
      const pending = [nodeId];
      while (pending.length) {
        const parentId = pending.pop();
        if (!parentId || branchIds.has(parentId)) continue;
        branchIds.add(parentId);
        const branch = expandedBranches.get(parentId);
        if (!branch) continue;
        branch.edgeIds.forEach((id) => edgeIds.add(id));
        branch.nodeIds.forEach((id) => {
          nodeIds.add(id);
          if (expandedBranches.has(id)) pending.push(id);
        });
      }
      setGraph((current) => ({
        ...current,
        nodes: current.nodes.filter(({ id }) => !nodeIds.has(id)),
        edges: current.edges.filter(
          ({ id, sourceId, targetId }) =>
            !edgeIds.has(id) &&
            !nodeIds.has(sourceId) &&
            !nodeIds.has(targetId),
        ),
      }));
      setExpandedBranches((current) => {
        const next = new Map(current);
        branchIds.forEach((id) => next.delete(id));
        return next;
      });
      setExpandedIds((current) => {
        const next = new Set(current);
        branchIds.forEach((id) => next.delete(id));
        return next;
      });
    },
    [expandedBranches],
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
      if (!onExpand) return;
      if (expandedBranches.has(node.id)) {
        collapseNode(node.id);
        return;
      }
      if (expandedIds.has(node.id) || graph.nodes.length >= hardCap) return;
      const knownNodeIds = new Set(graph.nodes.map(({ id }) => id));
      const knownEdgeIds = new Set(graph.edges.map(({ id }) => id));
      setExpandedIds((current) => new Set(current).add(node.id));
      void addPage(
        () =>
          onExpand(
            node.id,
            graph.nodes.map(({ id }) => id),
          ),
        (incoming) => {
          setExpandedBranches((current) => {
            const next = new Map(current);
            next.set(node.id, {
              nodeIds: incoming.nodes
                .map(({ id }) => id)
                .filter((id) => !knownNodeIds.has(id)),
              edgeIds: incoming.edges
                .map(({ id }) => id)
                .filter((id) => !knownEdgeIds.has(id)),
            });
            return next;
          });
        },
      ).then((succeeded) => {
        if (!succeeded) {
          setExpandedIds((current) => {
            const next = new Set(current);
            next.delete(node.id);
            return next;
          });
        }
      });
    },
    [
      addPage,
      collapseNode,
      expandedBranches,
      expandedIds,
      graph.edges,
      graph.nodes,
      hardCap,
      onExpand,
    ],
  );

  const expandAll = useCallback(async () => {
    if (!onExpand || loading) return;
    const epoch = graphEpoch.current;
    const expanded = new Set(expandedIds);
    const branches = new Map(expandedBranches);
    let nextGraph = graph;
    const pending = graph.nodes.filter(({ id }) => !expanded.has(id));
    setLoadingRequests((current) => current + 1);
    setError(undefined);
    try {
      while (pending.length && nextGraph.nodes.length < hardCap) {
        const node = pending.shift();
        if (!node || expanded.has(node.id)) continue;
        expanded.add(node.id);
        const knownNodeIds = new Set(nextGraph.nodes.map(({ id }) => id));
        const knownEdgeIds = new Set(nextGraph.edges.map(({ id }) => id));
        const incoming = await onExpand(node.id, [...knownNodeIds]);
        if (epoch !== graphEpoch.current) return;
        const addedNodes = incoming.nodes.filter(
          ({ id }) => !knownNodeIds.has(id),
        );
        branches.set(node.id, {
          nodeIds: addedNodes.map(({ id }) => id),
          edgeIds: incoming.edges
            .map(({ id }) => id)
            .filter((id) => !knownEdgeIds.has(id)),
        });
        nextGraph = mergeGraphPages(nextGraph, incoming, hardCap);
        pending.push(...addedNodes.filter(({ id }) => !expanded.has(id)));
        setGraph(nextGraph);
        setExpandedIds(new Set(expanded));
        setExpandedBranches(new Map(branches));
      }
      if (epoch !== graphEpoch.current) return;
      setGraph(nextGraph);
      setExpandedIds(expanded);
      setExpandedBranches(branches);
    } catch (cause) {
      if (epoch === graphEpoch.current)
        setError(
          cause instanceof Error ? cause.message : "Graph request failed",
        );
    } finally {
      setLoadingRequests((current) => Math.max(0, current - 1));
    }
  }, [expandedBranches, expandedIds, graph, hardCap, loading, onExpand]);

  const collapseAll = useCallback(() => {
    graphEpoch.current += 1;
    const initialGraph = boundedGraph(page, hardCap);
    const targets = new Set(initialGraph.edges.map(({ targetId }) => targetId));
    const roots = initialGraph.nodes.filter(({ id }) => !targets.has(id));
    const rootNodes = roots.length ? roots : initialGraph.nodes.slice(0, 1);
    const rootIds = new Set(rootNodes.map(({ id }) => id));
    setGraph(initialGraph);
    setExpandedIds(rootIds);
    setExpandedBranches(new Map());
    setInternalSelectedId((current) =>
      current && rootIds.has(current) ? current : undefined,
    );
    if (effectiveSelectedId && !rootIds.has(effectiveSelectedId))
      onSelectionChange?.(undefined);
  }, [effectiveSelectedId, hardCap, onSelectionChange, page]);

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
        <GraphViewport3D
          graph={graph}
          theme={theme}
          expandedNodeIds={expandedIds}
          selectedNodeId={effectiveSelectedId}
          onSelect={selectNode}
          onExpand={(node) => {
            if (onExpand) expandNode(node);
            else if (node.source) runCommand("graph.open-source", node);
          }}
          {...(onExpand ? { onExpandAll: () => void expandAll() } : {})}
          onCollapseAll={collapseAll}
          busy={loading}
          onClearSelection={clearSelection}
          onContextMenu={(node, x, y) => {
            if (onCommand) {
              setContextMenu({ node, x, y });
              runCommand("graph.show-actions", node);
            }
          }}
        />
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
        {contextMenu && onCommand ? (
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
              {selected.source && onCommand ? (
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
              {onCommand
                ? (
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
                  ))
                : null}
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
