import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExceptions, matchException, type Exception } from '../src/util/exceptions.js';

const FAR_FUTURE = Date.parse('2999-01-01');
const LONG_AGO = Date.parse('2000-01-01');

const exceptions: Exception[] = [
  { package: 'express', ecosystem: 'NPM', version: '4.16.0', reason: 'Legacy service; migration scheduled', approvedBy: 'sec-team' },
  { package: 'anyver', reason: 'Accept all versions' },
  { package: 'lapsed', reason: 'Temporary', expires: '2020-01-01' },
  { package: 'timed', reason: 'Valid until 2999', expires: '2999-01-01' },
  { package: 'noreason', reason: '   ' },
];

describe('matchException', () => {
  const now = Date.parse('2026-06-01');

  it('matches an exact name+ecosystem+version exception', () => {
    const m = matchException(exceptions, 'NPM', 'express', '4.16.0', now);
    expect(m?.reason).toContain('Legacy service');
    expect(m?.approvedBy).toBe('sec-team');
  });

  it('does not match a different version when a version is pinned', () => {
    expect(matchException(exceptions, 'NPM', 'express', '4.17.0', now)).toBeNull();
  });

  it('does not match a different ecosystem when one is specified', () => {
    expect(matchException(exceptions, 'PYPI', 'express', '4.16.0', now)).toBeNull();
  });

  it('matches any version when no version is pinned', () => {
    expect(matchException(exceptions, 'NPM', 'anyver', '9.9.9', now)).not.toBeNull();
  });

  it('never matches an expired exception (fail-closed)', () => {
    expect(matchException(exceptions, 'NPM', 'lapsed', '1.0.0', now)).toBeNull();
  });

  it('matches a not-yet-expired exception', () => {
    expect(matchException(exceptions, 'NPM', 'timed', '1.0.0', now)).not.toBeNull();
  });

  it('never matches an exception with an empty reason', () => {
    expect(matchException(exceptions, 'NPM', 'noreason', '1.0.0', now)).toBeNull();
  });

  it('never matches an unparseable expiry date', () => {
    const bad: Exception[] = [{ package: 'x', reason: 'ok', expires: 'not-a-date' }];
    expect(matchException(bad, 'NPM', 'x', '1.0.0', now)).toBeNull();
  });

  it('respects the now boundary', () => {
    const e: Exception[] = [{ package: 'x', reason: 'ok', expires: '2026-06-01T00:00:00Z' }];
    expect(matchException(e, 'NPM', 'x', '1.0.0', LONG_AGO)).not.toBeNull();
    expect(matchException(e, 'NPM', 'x', '1.0.0', FAR_FUTURE)).toBeNull();
  });
});

describe('loadExceptions', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hawkeye-exc-'));
    writeFileSync(
      join(dir, '.hawkeye-exceptions.yaml'),
      `exceptions:\n  - package: express\n    reason: legacy\n  - package: noreason\n  - notapackage: true\n`
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('loads well-formed exceptions and drops malformed ones', () => {
    const list = loadExceptions(dir);
    expect(list).toHaveLength(1);
    expect(list[0].package).toBe('express');
  });

  it('returns [] when no exceptions file exists', () => {
    expect(loadExceptions(tmpdir())).toEqual([]);
  });
});
