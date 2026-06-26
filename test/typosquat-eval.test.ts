import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectTyposquat } from '../src/util/typosquat.js';

// Evaluation harness for the typosquat detector. The product's whole claim is
// precision; this measures it against a labeled corpus and GATES regressions in
// CI. Grow test/fixtures/typosquat-eval.json (ideally with real malicious-feed
// data) to strengthen the guarantee.

interface Case {
  ecosystem: string;
  name: string;
  label: 'typosquat' | 'legit';
  of?: string;
  hard?: boolean;
  note?: string;
}

// Quality gates. Precision must be high — a false positive blocks a legitimate
// install. Recall is bounded by design (distance-1 + separator squats), so the
// gate reflects the catchable set; `hard` combosquat/multi-edit cases are the
// known ceiling and tracked separately.
const MIN_PRECISION = 1.0;        // zero false positives tolerated
const MIN_RECALL = 0.85;          // overall, including known-hard misses
const MIN_RECALL_CATCHABLE = 1.0; // every non-`hard` typosquat must be caught

const cases: Case[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'typosquat-eval.json'), 'utf8')
).cases;

describe('typosquat detector — evaluation', () => {
  const evald = cases.map(c => ({ ...c, flagged: detectTyposquat(c.ecosystem, c.name) !== null }));

  const tp = evald.filter(c => c.label === 'typosquat' && c.flagged);
  const fp = evald.filter(c => c.label === 'legit' && c.flagged);
  const fn = evald.filter(c => c.label === 'typosquat' && !c.flagged);
  const tn = evald.filter(c => c.label === 'legit' && !c.flagged);

  const precision = tp.length / (tp.length + fp.length || 1);
  const recall = tp.length / (tp.length + fn.length || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);

  const catchable = evald.filter(c => c.label === 'typosquat' && !c.hard);
  const recallCatchable = catchable.filter(c => c.flagged).length / (catchable.length || 1);

  it('reports metrics and meets the quality gates', () => {
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    // eslint-disable-next-line no-console
    console.log(
      `\n  Typosquat eval (${cases.length} cases): ` +
        `precision ${pct(precision)} · recall ${pct(recall)} · F1 ${pct(f1)} · ` +
        `recall(catchable) ${pct(recallCatchable)}` +
        `\n  TP=${tp.length} FP=${fp.length} FN=${fn.length} TN=${tn.length}` +
        (fp.length ? `\n  FALSE POSITIVES: ${fp.map(c => c.name).join(', ')}` : '') +
        (fn.length ? `\n  MISSED: ${fn.map(c => `${c.name}${c.hard ? ' (hard)' : ''}`).join(', ')}` : '')
    );

    expect(precision).toBeGreaterThanOrEqual(MIN_PRECISION);
    expect(recall).toBeGreaterThanOrEqual(MIN_RECALL);
    expect(recallCatchable).toBeGreaterThanOrEqual(MIN_RECALL_CATCHABLE);
  });

  it('every missed typosquat is a known-hard case (no surprise distance-1 misses)', () => {
    expect(fn.every(c => c.hard)).toBe(true);
  });
});
