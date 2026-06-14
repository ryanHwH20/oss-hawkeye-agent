import { describe, it, expect } from 'vitest';
import { buildParentMap, dependencyPath } from '../src/util/depgraph.js';

const node = (name: string, version = '1.0.0') => ({ versionKey: { name, version } });

describe('dependency graph (issue #10)', () => {
  // root(0) → a(1) → b(2),  root(0) → c(3)
  const nodes = [node('root'), node('a'), node('b'), node('c')];
  const edges = [
    { fromNode: 0, toNode: 1 },
    { fromNode: 1, toNode: 2 },
    { fromNode: 0, toNode: 3 },
  ];

  it('builds a parent map via BFS from the root', () => {
    const parents = buildParentMap(nodes.length, edges);
    expect(parents.get(1)).toBe(0);
    expect(parents.get(2)).toBe(1);
    expect(parents.get(3)).toBe(0);
    expect(parents.has(0)).toBe(false); // root has no parent
  });

  it('reconstructs the full topological path to a deep node', () => {
    const parents = buildParentMap(nodes.length, edges);
    expect(dependencyPath(nodes, parents, 2)).toEqual(['root@1.0.0', 'a@1.0.0', 'b@1.0.0']);
    expect(dependencyPath(nodes, parents, 3)).toEqual(['root@1.0.0', 'c@1.0.0']);
    expect(dependencyPath(nodes, parents, 0)).toEqual(['root@1.0.0']);
  });

  it('does not revisit nodes when the graph has a cycle', () => {
    // 0 → 1 → 2 → 1 (cycle back to 1)
    const cyclic = [node('root'), node('a'), node('b')];
    const cyclicEdges = [
      { fromNode: 0, toNode: 1 },
      { fromNode: 1, toNode: 2 },
      { fromNode: 2, toNode: 1 },
    ];
    const parents = buildParentMap(cyclic.length, cyclicEdges);
    expect(parents.get(1)).toBe(0); // first discovery wins, not the cycle edge
    expect(parents.get(2)).toBe(1);
    expect(dependencyPath(cyclic, parents, 2)).toEqual(['root@1.0.0', 'a@1.0.0', 'b@1.0.0']);
  });

  it('returns an empty parent map for an empty graph', () => {
    expect(buildParentMap(0, []).size).toBe(0);
  });
});
