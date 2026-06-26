import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExceptions, matchException, type Exception } from '../src/util/exceptions.js';

const EXC = 'exceptions:\n  - package: gplpkg\n    reason: legacy, approved\n';

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

describe('loadExceptions — git provenance gate (review v3 #1)', () => {
  const g = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  function newRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hawkeye-gitexc-'));
    g(dir, 'init', '-q');
    g(dir, 'config', 'user.email', 't@t');
    g(dir, 'config', 'user.name', 't');
    g(dir, 'commit', '--allow-empty', '-qm', 'init'); // establish HEAD
    return dir;
  }
  const dirs: string[] = [];
  const repo = () => { const d = newRepo(); dirs.push(d); return d; };
  afterEach(() => { delete process.env.HAWKEYE_TRUST_UNCOMMITTED_EXCEPTIONS; });
  afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

  it('honors a committed, unmodified exceptions file', () => {
    const dir = repo();
    writeFileSync(join(dir, '.hawkeye-exceptions.yaml'), EXC);
    g(dir, 'add', '.hawkeye-exceptions.yaml');
    g(dir, 'commit', '-qm', 'add exceptions');
    expect(loadExceptions(dir)).toHaveLength(1);
  });

  it('IGNORES an uncommitted (agent-written) exceptions file', () => {
    const dir = repo();
    writeFileSync(join(dir, '.hawkeye-exceptions.yaml'), EXC); // written, never committed
    expect(loadExceptions(dir)).toEqual([]);
  });

  it('IGNORES a committed file that was then modified in the working tree', () => {
    const dir = repo();
    writeFileSync(join(dir, '.hawkeye-exceptions.yaml'), EXC);
    g(dir, 'add', '.hawkeye-exceptions.yaml');
    g(dir, 'commit', '-qm', 'add');
    writeFileSync(join(dir, '.hawkeye-exceptions.yaml'), EXC + '  - package: evil\n    reason: x\n'); // tampered
    expect(loadExceptions(dir)).toEqual([]);
  });

  it('honors an uncommitted file when explicitly overridden', () => {
    const dir = repo();
    writeFileSync(join(dir, '.hawkeye-exceptions.yaml'), EXC);
    process.env.HAWKEYE_TRUST_UNCOMMITTED_EXCEPTIONS = '1';
    expect(loadExceptions(dir)).toHaveLength(1);
  });
});
