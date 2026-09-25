import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageCounts, coveragePlan, savedLine, formatDuration } from '../src/summary.mjs';

const change = (priority, analyzed = true) => ({ priority, signals: analyzed ? [] : ['not_analyzed'] });

test('saved line never counts unanalyzed units as reviewed P0', () => {
  const summary = coverageCounts([change('P0'), change('P0'), change('P1'), change('P2'), change('P0', false), change('P0', false)]);
  assert.deepEqual(summary, { total: 6, analyzed: 4, notAnalyzed: 2, counts: { P0: 2, P1: 1, P2: 1 } });
  assert.equal(savedLine(summary), "Saved 6 cards: 4 analyzed (2 P0, 1 P1, 1 P2), 2 not analyzed. Files with an unanalyzed change keep GitHub's code; rerun with a higher --max-units (up to 100) to cover more.");
});

test('fully analyzed reports keep the short saved line', () => {
  assert.equal(savedLine(coverageCounts([change('P1'), change('P2')])), 'Saved 2 cards (0 P0, 1 P1, 1 P2).');
});

test('coverage plan states the cap before any provider call', () => {
  assert.equal(coveragePlan(625, 12, 12), "Analyzing 12 of 625 change units, taken in path order (--max-units 12). The other 613 are not sent to the providers and keep GitHub's original diff.");
  assert.equal(coveragePlan(5, 5, 12), 'Analyzing all 5 change units.');
});

test('durations read naturally', () => {
  assert.equal(formatDuration(4_200), '4s');
  assert.equal(formatDuration(178_000), '2m 58s');
});
