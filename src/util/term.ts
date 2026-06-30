// Terminal branding — ANSI colour for human-facing CLI output ONLY.
//
// These helpers are never used inside the Markdown / SARIF / JSON documents the
// CLI emits; those must stay plain so they pipe and render cleanly. Colour is
// gated on an interactive TTY and the usual opt-outs (NO_COLOR, dumb terminals),
// so piped output, CI logs, and the AI-agent install hook (all non-TTY) receive
// exactly the same bytes as before — no escape codes.

let forced: boolean | null = null;

/** Test seam: true = force on, false = force off, null = auto-detect. */
export function setColorOverride(v: boolean | null): void {
  forced = v;
}

/** Whether ANSI colour should be emitted right now. */
export function colorEnabled(): boolean {
  if (forced !== null) return forced;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.HAWKEYE_NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  return Boolean(process.stdout && process.stdout.isTTY);
}

const sgr = (open: string, s: string): string =>
  colorEnabled() ? `\x1b[${open}m${s}\x1b[0m` : s;

// Brand palette (24-bit). The verdict tones match the brand's signal system, so
// the terminal speaks the same colour language as the badges and banners.
export const paint = {
  green: (s: string) => sgr('38;2;21;71;52', s),   // brand deep green  #154734
  gold:  (s: string) => sgr('38;2;176;137;47', s), // championship gold #B0892F
  safe:  (s: string) => sgr('38;2;31;157;87', s),  // SAFE emerald      #1F9D57
  warn:  (s: string) => sgr('38;2;194;138;27', s), // UNKNOWN amber     #C28A1B
  block: (s: string) => sgr('38;2;178;58;58', s),  // BLOCKED red       #B23A3A
  dim:   (s: string) => sgr('2', s),
  bold:  (s: string) => sgr('1', s),
};

/**
 * A compact, branded one-line header for interactive runs. Uses the default
 * foreground for "Hawk" (so it reads on any terminal background) with a gold
 * "eye" and reticle glyph, echoing the logo's gold focal point.
 */
export function brandHeader(): string {
  const mark = paint.gold('⌖');
  const word = paint.bold('Hawk') + paint.bold(paint.gold('eye'));
  const tag = paint.dim('· supply-chain line-judge');
  return `${mark}  ${word} ${tag}`;
}
