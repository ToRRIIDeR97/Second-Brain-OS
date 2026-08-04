export type GraphAuthority =
  | "explicit_user"
  | "explicit_file"
  | "provider_authoritative"
  | "agent_confirmed"
  | "model_inferred"
  | "heuristic_inferred";

export type GraphSource = {
  workspaceId: string;
  relativePath: string;
};

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  authority: GraphAuthority;
  confidence?: number;
  stale?: boolean;
  source?: GraphSource;
};

export type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  authority: GraphAuthority;
  confidence?: number;
  stale?: boolean;
};

export type GraphPage = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  continuationToken?: string;
};

export type GraphCommand =
  | "graph.open-source"
  | "graph.search-related"
  | "graph.open-terminal"
  | "graph.add-to-context"
  | "graph.prepare-agent"
  | "graph.show-actions";

export type GraphCommandContext = {
  node: GraphNode;
  source?: GraphSource;
  provider?: "codex" | "claude";
};

/**
 * The graph state associated with the currently selected node.
 *
 * Keeping relationships in the selection payload means consumers such as the
 * global inspector do not need to reach into the SVG to reconstruct the
 * selected node's context. `graph` is the bounded, currently visible page and
 * therefore remains safe to pass across the feature boundary.
 */
export type GraphSelectionContext = {
  node: GraphNode;
  relationships: GraphEdge[];
  relatedNodes: GraphNode[];
  graph: GraphPage;
};

export type GraphPosition = { x: number; y: number };
