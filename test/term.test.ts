import { describe, it, expect, afterEach } from 'vitest';
import { paint, brandHeader, colorEnabled, setColorOverride } from '../src/util/term.js';

afterEach(() => setColorOverride(null));

describe('terminal branding (src/util/term.ts)', () => {
  it('emits no escape codes when colour is disabled', () => {
    setColorOverride(false);
    expect(colorEnabled()).toBe(false);
    expect(paint.safe('ok')).toBe('ok');
    expect(paint.block('no')).toBe('no');
    // brand header is plain text — safe for non-TTY (hooks, pipes, CI)
    expect(brandHeader()).not.toContain('\x1b');
    expect(brandHeader()).toContain('Hawk');
    expect(brandHeader()).toContain('eye');
  });

  it('wraps text in SGR codes when colour is forced on', () => {
    setColorOverride(true);
    expect(colorEnabled()).toBe(true);
    expect(paint.safe('ok')).toBe('\x1b[38;2;31;157;87mok\x1b[0m');
    expect(paint.block('x')).toBe('\x1b[38;2;178;58;58mx\x1b[0m');
    expect(paint.bold('x')).toBe('\x1b[1mx\x1b[0m');
    expect(brandHeader()).toContain('\x1b[');
  });

  it('honours NO_COLOR regardless of TTY', () => {
    setColorOverride(null);
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      expect(colorEnabled()).toBe(false);
      expect(paint.gold('x')).toBe('x');
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  });
});
