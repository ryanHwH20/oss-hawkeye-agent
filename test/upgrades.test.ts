import { describe, it, expect } from 'vitest';
import { findSmartUpgrades } from '../src/formatter.js';

describe('findSmartUpgrades (issue #10)', () => {
  it('prefers the closest same-major.minor patch as "minimal" and the highest as "latest"', () => {
    // current 1.2.3; fixes available at a patch (1.2.5), a minor (1.3.0), a major (2.0.0)
    const { minimal, latest } = findSmartUpgrades('1.2.3', ['1.3.0', '1.2.5', '2.0.0']);
    expect(minimal).toBe('1.2.5'); // no breaking change
    expect(latest).toBe('2.0.0');  // newest stable
  });

  it('falls back to the highest fixed version when no same-line patch exists', () => {
    const { minimal, latest } = findSmartUpgrades('1.2.3', ['1.3.0', '2.0.0']);
    expect(minimal).toBe('2.0.0');
    expect(latest).toBe('2.0.0');
  });

  it('handles non-semver versions (e.g. Maven) by returning the last fixed version', () => {
    const { minimal, latest } = findSmartUpgrades('3.5.8.RELEASE', ['3.5.9.RELEASE']);
    expect(minimal).toBe('3.5.9.RELEASE');
    expect(latest).toBe('3.5.9.RELEASE');
  });

  it('returns nulls when there are no fixed versions', () => {
    expect(findSmartUpgrades('1.0.0', [])).toEqual({ minimal: null, latest: null });
  });
});
