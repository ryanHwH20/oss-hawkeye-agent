import { describe, it, expect } from 'vitest';
import { extractSeverity } from '../src/api/osv.js';

const cvss = (vector: string) => ({ id: 'X', severity: [{ type: 'CVSS_V3', score: vector }] });

describe('extractSeverity (issue #10)', () => {
  it('classifies a CVSS 9.8 vector as CRITICAL', () => {
    const { level, score } = extractSeverity(cvss('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'));
    expect(level).toBe('CRITICAL');
    expect(score).toBeGreaterThanOrEqual(9.0);
  });

  it('classifies a CVSS 7.5 vector as HIGH', () => {
    const { level, score } = extractSeverity(cvss('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N'));
    expect(level).toBe('HIGH');
    expect(score).toBeGreaterThanOrEqual(7.0);
    expect(score!).toBeLessThan(9.0);
  });

  it('classifies a CVSS 5.3 vector as MEDIUM (and normalizes 3.1 → 3.0)', () => {
    const { level, score } = extractSeverity(cvss('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N'));
    expect(level).toBe('MEDIUM');
    expect(score!).toBeGreaterThanOrEqual(4.0);
    expect(score!).toBeLessThan(7.0);
  });

  it('falls back to the database_specific severity string when no CVSS vector is present', () => {
    const { level, score } = extractSeverity({ id: 'X', database_specific: { severity: 'LOW' } });
    expect(level).toBe('LOW');
    expect(score).toBeNull();
  });

  it('returns UNKNOWN when neither a CVSS vector nor a severity string is present', () => {
    const { level, score } = extractSeverity({ id: 'X' });
    expect(level).toBe('UNKNOWN');
    expect(score).toBeNull();
  });
});
