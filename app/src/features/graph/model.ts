import type {
  GraphAuthority,
  GraphEdge,
  GraphPage,
  GraphPosition,
} from "./types";

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
  edges: Pick<GraphEdge, "sourceId" | "targetId">[] = [],
  previous: ReadonlyMap<string, GraphPosition> = new Map(),
): Map<string, GraphPosition> {
  const ordered = [...nodeIds].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const positions = new Map<string, GraphPosition>();
  const fixed = new Set<string>();
  const center = { x: 470, y: 300 };
  const hash = (value: string) => {
    let result = 2166136261;
    for (const character of value) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  };

  ordered.forEach((id, index) => {
    const existing = previous.get(id);
    if (existing) {
      positions.set(id, { ...existing });
      fixed.add(id);
    } else {
      const linked = edges
        .flatMap((edge) =>
          edge.sourceId === id
            ? [edge.targetId]
            : edge.targetId === id
              ? [edge.sourceId]
              : [],
        )
        .map((linkedId) => positions.get(linkedId) ?? previous.get(linkedId))
        .find(Boolean);
      const angle =
        ((hash(id) % 10_000) / 10_000) * Math.PI * 2 +
        (index / Math.max(1, ordered.length)) * 0.3;
      const radius = linked
        ? 82 + (hash(`${id}:radius`) % 70)
        : 90 + Math.sqrt(index + 1) * 35;
      positions.set(id, {
        x: (linked?.x ?? center.x) + Math.cos(angle) * radius,
        y: (linked?.y ?? center.y) + Math.sin(angle) * radius,
      });
    }
  });

  const validEdges = edges.filter(
    ({ sourceId, targetId }) =>
      positions.has(sourceId) && positions.has(targetId),
  );
  // ponytail: This O(n²) simulation is bounded by DEFAULT_GRAPH_CAP. A
  // Barnes-Hut dependency is warranted only if profiling exceeds that ceiling.
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const forces = new Map<string, { x: number; y: number }>(
      ordered.map((id) => [id, { x: 0, y: 0 }]),
    );
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < ordered.length;
        rightIndex += 1
      ) {
        const leftId = ordered[leftIndex];
        const rightId = ordered[rightIndex];
        if (!leftId || !rightId) continue;
        const left = positions.get(leftId);
        const right = positions.get(rightId);
        const leftForce = forces.get(leftId);
        const rightForce = forces.get(rightId);
        if (!left || !right || !leftForce || !rightForce) continue;
        const dx = right.x - left.x || 0.01;
        const dy = right.y - left.y || 0.01;
        const distanceSquared = Math.max(100, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSquared);
        const strength = 1_900 / distanceSquared;
        const fx = (dx / distance) * strength;
        const fy = (dy / distance) * strength;
        leftForce.x -= fx;
        leftForce.y -= fy;
        rightForce.x += fx;
        rightForce.y += fy;
      }
    }
    for (const edge of validEdges) {
      const source = positions.get(edge.sourceId);
      const target = positions.get(edge.targetId);
      const sourceForce = forces.get(edge.sourceId);
      const targetForce = forces.get(edge.targetId);
      if (!source || !target || !sourceForce || !targetForce) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const strength = (distance - 92) * 0.0028;
      const fx = (dx / distance) * strength;
      const fy = (dy / distance) * strength;
      sourceForce.x += fx;
      sourceForce.y += fy;
      targetForce.x -= fx;
      targetForce.y -= fy;
    }
    for (const id of ordered) {
      if (fixed.has(id)) continue;
      const position = positions.get(id);
      const force = forces.get(id);
      if (!position || !force) continue;
      force.x += (center.x - position.x) * 0.0009;
      force.y += (center.y - position.y) * 0.0009;
      const cooling = 1 - iteration / 80;
      position.x = Math.min(
        920,
        Math.max(40, position.x + force.x * cooling * 18),
      );
      position.y = Math.min(
        570,
        Math.max(35, position.y + force.y * cooling * 18),
      );
    }
  }
  return positions;
}
