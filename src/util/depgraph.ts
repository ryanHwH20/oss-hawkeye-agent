/**
 * Pure helpers for reasoning about a deps.dev dependency graph: a BFS from the
 * root (node 0) that records each node's parent, and a path reconstruction from
 * any node back up to the root. Kept dependency-free so they can be unit tested
 * in isolation.
 */

export interface GraphNode {
  versionKey: { name: string; version: string };
}

export interface GraphEdge {
  fromNode: number;
  toNode: number;
}

/**
 * BFS from the root (node 0) recording, for each reachable node, the parent it
 * was first discovered from. The root has no entry.
 */
export function buildParentMap(nodeCount: number, edges: ReadonlyArray<GraphEdge>): Map<number, number> {
  const parentMap = new Map<number, number>();
  if (nodeCount === 0) return parentMap;

  const queue: number[] = [0];
  const visited = new Set<number>([0]);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const edge of edges) {
      if (edge.fromNode !== curr) continue;
      const child = edge.toNode;
      if (!visited.has(child)) {
        visited.add(child);
        parentMap.set(child, curr);
        queue.push(child);
      }
    }
  }

  return parentMap;
}

/**
 * Reconstruct the topological path `root → … → nodeId` as `name@version`
 * strings, using the parent map from {@link buildParentMap}.
 */
export function dependencyPath(
  nodes: ReadonlyArray<GraphNode>,
  parentMap: ReadonlyMap<number, number>,
  nodeId: number
): string[] {
  const path: string[] = [];
  let curr: number | undefined = nodeId;
  while (curr !== undefined) {
    const node = nodes[curr];
    if (node) {
      path.unshift(`${node.versionKey.name}@${node.versionKey.version}`);
    }
    curr = parentMap.get(curr);
  }
  return path;
}
