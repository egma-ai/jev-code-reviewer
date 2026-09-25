// CLI wording for analysis coverage. Unanalyzed units keep their conservative P0 in the
// report (a human must look at them), but they are never counted as reviewed priorities.
export function coverageCounts(changes) {
  const analyzed = changes.filter((change) => !change.signals?.includes('not_analyzed'));
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const change of analyzed) if (Object.hasOwn(counts, change.priority)) counts[change.priority] += 1;
  return { total: changes.length, analyzed: analyzed.length, notAnalyzed: changes.length - analyzed.length, counts };
}

export function coveragePlan(total, selected, maxUnits) {
  if (selected >= total) return `Analyzing all ${total} change units.`;
  return `Analyzing ${selected} of ${total} change units, taken in path order (--max-units ${maxUnits}). ` +
    `The other ${total - selected} are not sent to the providers and keep GitHub's original diff.`;
}

export function savedLine({ total, analyzed, notAnalyzed, counts }) {
  const split = `${counts.P0} P0, ${counts.P1} P1, ${counts.P2} P2`;
  if (!notAnalyzed) return `Saved ${total} cards (${split}).`;
  return `Saved ${total} cards: ${analyzed} analyzed (${split}), ${notAnalyzed} not analyzed. ` +
    "Files with an unanalyzed change keep GitHub's code; rerun with a higher --max-units (up to 100) to cover more.";
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
