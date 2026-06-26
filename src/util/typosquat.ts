import { POPULAR_PACKAGES } from '../data/popular-packages.js';

/** Don't flag near-misses of very short names — too noisy to be reliable. */
const MIN_TARGET_LEN = 4;

export interface TyposquatHit {
  /** The popular package this name appears to imitate. */
  nearest: string;
  /** 'edit' = one insertion/deletion/substitution/transposition; 'separator' = only -._ / case differs. */
  kind: 'edit' | 'separator';
}

/** Collapse separators and case so `Lo-Dash` and `lodash` compare equal. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, '');
}

/**
 * Damerau–Levenshtein distance, short-circuited at >1 (we only care whether two
 * names are within a single typo of each other).
 */
export function editDistanceWithin1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  // Find the first and last differing positions to isolate the edit.
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  let j = 0;
  while (j < la - i && j < lb - i && a[la - 1 - j] === b[lb - 1 - j]) j++;

  const ra = a.slice(i, la - j); // differing middle of a
  const rb = b.slice(i, lb - j); // differing middle of b

  if (la === lb) {
    // substitution (one char) or adjacent transposition
    if (ra.length === 1 && rb.length === 1) return true;
    if (ra.length === 2 && rb.length === 2 && ra[0] === rb[1] && ra[1] === rb[0]) return true;
    return false;
  }
  // single insertion or deletion: the shorter middle must be empty
  return ra.length === 0 || rb.length === 0;
}

/**
 * Decide whether `name` is a likely typosquat of a popular package in the given
 * ecosystem. Returns null when the name is itself popular, the ecosystem is
 * unknown, or nothing is close enough.
 */
export function detectTyposquat(system: string, name: string): TyposquatHit | null {
  const list = POPULAR_PACKAGES[system.toUpperCase()];
  if (!list || !name) return null;

  // A name that IS a known popular package is never a typosquat (this also
  // exempts legitimate near-neighbours like `preact` vs `react`).
  if (list.includes(name)) return null;

  const norm = normalize(name);
  for (const pop of list) {
    if (pop.length < MIN_TARGET_LEN) continue;
    if (pop === name) return null;

    // Separator/case squat: same once normalized, but not identical raw.
    if (normalize(pop) === norm) return { nearest: pop, kind: 'separator' };

    if (Math.abs(pop.length - name.length) <= 1 && editDistanceWithin1(name, pop)) {
      return { nearest: pop, kind: 'edit' };
    }
  }
  return null;
}
