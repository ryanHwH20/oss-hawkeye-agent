import { describe, it, expect } from 'vitest';
import { parseAuditLog, aggregateAudit, formatAuditReport } from '../src/audit-report.js';

const lines = [
  JSON.stringify({ event: 'check-command', command: 'npm install lodash', decision: 'allow', verdict: 'SAFE', packages: [{ name: 'lodash', version: '4.18.0', verdict: 'SAFE', categories: [] }] }),
  JSON.stringify({ event: 'check-command', command: 'npm install expres', decision: 'block', verdict: 'BLOCKED', packages: [{ name: 'expres', version: '0.0.5', verdict: 'BLOCKED', categories: ['TYPOSQUAT'] }] }),
  JSON.stringify({ event: 'check-command', command: 'npm install expres', decision: 'block', verdict: 'BLOCKED', packages: [{ name: 'expres', version: '0.0.5', verdict: 'BLOCKED', categories: ['TYPOSQUAT'] }] }),
  JSON.stringify({ event: 'check-command', command: 'npm install evil', decision: 'block', verdict: 'BLOCKED', packages: [{ name: 'evil', version: '1.0.0', verdict: 'BLOCKED', categories: ['MALWARE'] }] }),
  JSON.stringify({ event: 'check-command', command: 'npm install gplpkg', decision: 'override', verdict: 'BLOCKED', packages: [{ name: 'gplpkg', version: '2.0.0', verdict: 'BLOCKED', categories: ['LICENSE'], override: 'legacy, approved', approvedBy: 'sec' }] }),
  '',
  'not-json-garbage',
  JSON.stringify({ event: 'other', decision: 'block' }), // wrong event, ignored
].join('\n');

describe('audit-report aggregation', () => {
  const entries = parseAuditLog(lines);

  it('parses valid check-command lines, skipping blanks/garbage/other events', () => {
    expect(entries).toHaveLength(5);
  });

  it('computes decision counts, block rate, and override rate', () => {
    const r = aggregateAudit(entries);
    expect(r.total).toBe(5);
    expect(r.allow).toBe(1);
    expect(r.block).toBe(3);
    expect(r.override).toBe(1);
    expect(r.blockRate).toBeCloseTo(3 / 5);
    expect(r.overrideRate).toBeCloseTo(1 / 4); // 1 override of (3 blocks + 1 override)
  });

  it('ranks most-blocked packages and counts categories', () => {
    const r = aggregateAudit(entries);
    expect(r.topBlocked[0]).toEqual({ name: 'expres', count: 2 });
    expect(r.categories).toMatchObject({ TYPOSQUAT: 2, MALWARE: 1, LICENSE: 1 });
  });

  it('lists overrides with reason and approver', () => {
    const r = aggregateAudit(entries);
    expect(r.overrides).toHaveLength(1);
    expect(r.overrides[0]).toMatchObject({ name: 'gplpkg', reason: 'legacy, approved', approvedBy: 'sec' });
  });

  it('renders a markdown report', () => {
    const md = formatAuditReport(aggregateAudit(entries));
    expect(md).toContain('Block rate');
    expect(md).toContain('`expres`');
    expect(md).toContain('TYPOSQUAT');
  });

  it('handles an empty log gracefully', () => {
    const r = aggregateAudit(parseAuditLog(''));
    expect(r.total).toBe(0);
    expect(formatAuditReport(r)).toContain('No audit records');
  });
});
