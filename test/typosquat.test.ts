import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectTyposquat, editDistanceWithin1 } from '../src/util/typosquat.js';
import { checkPackage } from '../src/checker.js';
import type { Policy } from '../src/types.js';

const policy: Policy = {
  organizationName: 'Test',
  blockedLicenses: [],
  minScorecardScore: 0,
  blockVulnerabilities: true,
  minBlockingSeverity: 'MEDIUM',
  blockDeprecated: true,
  exceptionFormUrl: '',
};

describe('editDistanceWithin1', () => {
  it('is true for identical, one insertion/deletion/substitution, or transposition', () => {
    expect(editDistanceWithin1('react', 'react')).toBe(true);   // identical
    expect(editDistanceWithin1('react', 'reactt')).toBe(true);  // insertion
    expect(editDistanceWithin1('chalk', 'chlk')).toBe(true);    // deletion
    expect(editDistanceWithin1('lodash', 'lodish')).toBe(true); // substitution
    expect(editDistanceWithin1('react', 'recat')).toBe(true);   // transposition
  });

  it('is false for two or more edits', () => {
    expect(editDistanceWithin1('react', 'rust')).toBe(false);
    expect(editDistanceWithin1('lodash', 'lodax')).toBe(false);
    expect(editDistanceWithin1('express', 'compress')).toBe(false);
  });
});

describe('detectTyposquat', () => {
  it('flags one-edit look-alikes of popular packages', () => {
    expect(detectTyposquat('NPM', 'expres')?.nearest).toBe('express');
    expect(detectTyposquat('NPM', 'loadsh')?.nearest).toBe('lodash');
    expect(detectTyposquat('PYPI', 'requets')?.nearest).toBe('requests');
  });

  it('flags separator/case squats', () => {
    const hit = detectTyposquat('NPM', 'lo-dash');
    expect(hit?.nearest).toBe('lodash');
    expect(hit?.kind).toBe('separator');
  });

  it('never flags a package that is itself popular (incl. legit near-neighbours)', () => {
    expect(detectTyposquat('NPM', 'react')).toBeNull();
    expect(detectTyposquat('NPM', 'preact')).toBeNull(); // 1 edit from react, but legit
    expect(detectTyposquat('PYPI', 'urllib3')).toBeNull();
  });

  it('does not flag unrelated names or unknown ecosystems', () => {
    expect(detectTyposquat('NPM', 'my-internal-tool')).toBeNull();
    expect(detectTyposquat('NPM', 'left-pad')).toBeNull();
    expect(detectTyposquat('MAVEN', 'expres')).toBeNull(); // no list for ecosystem
  });
});

describe('checkPackage typosquat integration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('BLOCKS a typosquat even when the package itself audits clean', async () => {
    // 'expres' resolves to a clean MIT package with no vulns — only the name
    // betrays it. The verdict must still be BLOCKED on the typosquat signal.
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d });
      if (u.includes('api.osv.dev')) return ok({ vulns: [] });
      if (u.includes(':dependencies')) return ok({ nodes: [{ versionKey: { system: 'NPM', name: 'expres', version: '1.0.0' }, relation: 'SELF' }], edges: [] });
      if (u.includes('/versions/')) return ok({ versionKey: { system: 'NPM', name: 'expres', version: '1.0.0' }, licenses: ['MIT'] });
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const r = await checkPackage('NPM', 'expres', '1.0.0', policy);
    expect(r.verdict).toBe('BLOCKED');
    const v = r.violations.find(x => x.type === 'TYPOSQUAT');
    expect(v).toBeDefined();
    expect(v?.affectedDep).toBe('express');
  });

  it('does not run typosquat detection when blockTyposquats is false', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      const ok = (d: unknown) => ({ ok: true, status: 200, json: async () => d });
      if (u.includes('api.osv.dev')) return ok({ vulns: [] });
      if (u.includes(':dependencies')) return ok({ nodes: [{ versionKey: { system: 'NPM', name: 'expres', version: '1.0.0' }, relation: 'SELF' }], edges: [] });
      if (u.includes('/versions/')) return ok({ versionKey: { system: 'NPM', name: 'expres', version: '1.0.0' }, licenses: ['MIT'] });
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const r = await checkPackage('NPM', 'expres', '1.0.0', { ...policy, blockTyposquats: false });
    expect(r.violations.find(x => x.type === 'TYPOSQUAT')).toBeUndefined();
    expect(r.verdict).toBe('SAFE');
  });
});
