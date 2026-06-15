import parse from 'spdx-expression-parse';

/**
 * SPDX-aware license matching.
 *
 * A declared license can be an SPDX *expression*, not just an id — e.g.
 * `(MIT OR GPL-3.0-only)` or `Apache-2.0 AND BSD-3-Clause`. Exact-string
 * matching against a blocklist misses these, letting copyleft slip through (or
 * over-blocking a dual license you could legally satisfy a different way).
 *
 * Semantics:
 * - `A AND B` — you must comply with both, so it's blocked if *either* side is.
 * - `A OR B` — you may pick either, so it's blocked only if *both* sides are.
 */

interface SpdxLicenseNode {
  license: string;
  plus?: boolean;
  exception?: string;
}

interface SpdxConjunctionNode {
  conjunction: 'and' | 'or';
  left: SpdxNode;
  right: SpdxNode;
}

type SpdxNode = SpdxLicenseNode | SpdxConjunctionNode;

interface Evaluation {
  isBlocked: boolean;
  offenders: string[];
}

function evaluate(node: SpdxNode, blocked: Set<string>): Evaluation {
  if ('license' in node) {
    const hit = blocked.has(node.license);
    return { isBlocked: hit, offenders: hit ? [node.license] : [] };
  }

  const left = evaluate(node.left, blocked);
  const right = evaluate(node.right, blocked);

  // AND → must satisfy both → blocked if either is blocked.
  // OR  → free to choose   → blocked only if both are blocked.
  const isBlocked = node.conjunction === 'and'
    ? left.isBlocked || right.isBlocked
    : left.isBlocked && right.isBlocked;

  return { isBlocked, offenders: isBlocked ? [...left.offenders, ...right.offenders] : [] };
}

/**
 * Given the declared licenses of a package and the policy blocklist, return the
 * distinct blocked license ids that the package effectively forces on you.
 * Non-SPDX strings (e.g. "Unknown", "SEE LICENSE IN …") fall back to exact match.
 */
export function flaggedLicenses(declared: string[], blockedLicenses: string[]): string[] {
  const blocked = new Set(blockedLicenses);
  const offenders = new Set<string>();

  for (const entry of declared) {
    let node: SpdxNode | null = null;
    try {
      node = parse(entry) as SpdxNode;
    } catch {
      node = null; // not a valid SPDX expression
    }

    if (node) {
      const result = evaluate(node, blocked);
      if (result.isBlocked) result.offenders.forEach(o => offenders.add(o));
    } else if (blocked.has(entry)) {
      offenders.add(entry);
    }
  }

  return [...offenders];
}
