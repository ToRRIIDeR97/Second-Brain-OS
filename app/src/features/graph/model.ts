import type { GraphAuthority, GraphPage, GraphPosition } from "./types";

export const DEFAULT_GRAPH_CAP = 300;

const inferredAuthorities = new Set<GraphAuthority>([
  "model_inferred",
  "heuristic_inferred",
]);

export function authorityLabel(authority: GraphAuthority): string {
  return authority.replaceAll("_", " ");
}

export function isInferred(authority: GraphAuthority): boolean {
  return inferredAuthorities.has(authority);
}

export function mergeGraphPages(
  current: GraphPage,
  incoming: GraphPage,
  hardCap = DEFAULT_GRAPH_CAP,
): GraphPage {
  const nodeCap = Math.max(1, hardCap);
  const seenNodeIds = new Set<string>();
  const nodes = [...current.nodes, ...incoming.nodes]
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    .filter((node) => {
      if (seenNodeIds.has(node.id)) return false;
      seenNodeIds.add(node.id);
      return true;
    })
    .slice(0, nodeCap);
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const seenEdgeIds = new Set<string>();
  const edges = [...current.edges, ...incoming.edges]
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    .filter((edge) => {
      if (
        seenEdgeIds.has(edge.id) ||
        !nodeIds.has(edge.sourceId) ||
        !nodeIds.has(edge.targetId)
      )
        return false;
      seenEdgeIds.add(edge.id);
      return true;
    })
    .slice(0, nodeCap);

  return {
    nodes,
    edges,
    truncated:
      current.truncated ||
      incoming.truncated ||
      current.nodes.length + incoming.nodes.length > nodes.length,
    ...(incoming.continuationToken
      ? { continuationToken: incoming.continuationToken }
      : current.continuationToken
        ? { continuationToken: current.continuationToken }
        : {}),
  };
}

export function boundedGraph(
  page: GraphPage,
  hardCap = DEFAULT_GRAPH_CAP,
): GraphPage {
  return mergeGraphPages(
    { nodes: [], edges: [], truncated: false },
    page,
    hardCap,
  );
}

export function layoutGraph(
  nodeIds: string[],
  previous: ReadonlyMap<string, GraphPosition> = new Map(),
): Map<string, GraphPosition> {
  const positions = new Map(previous);
  const ordered = [...nodeIds].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  ordered.forEach((id, index) => {
    if (!positions.has(id)) {
      positions.set(id, {
        x: 90 + (index % columns) * 190,
        y: 70 + Math.floor(index / columns) * 110,
      });
    }
  });
  for (const id of positions.keys()) {
    if (!nodeIds.includes(id)) positions.delete(id);
  }
  return positions;
}
