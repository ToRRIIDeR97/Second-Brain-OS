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

export type GraphPosition = { x: number; y: number };
