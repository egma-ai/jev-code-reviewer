"use strict";

import test from "node:test";
import assert from "node:assert/strict";
await import("../review-ui.js");
const ui = globalThis.JevReviewerUI;

test("normalizes, bounds, and sorts change priorities", () => {
  const report = ui.normalizeReport({
    title: " Example ",
    head_sha: "abcdef123456",
    changes: [
      { title: "Low", priority: "p2", old_logic: "a", new_logic: "b" },
      { title: "Unknown", priority: "P9" },
      { title: "Medium", priority: "P1" }
    ]
  });
  assert.equal(report.title, "Example");
  assert.equal(report.headSha, "abcdef123456");
  assert.deepEqual(report.changes.map((item) => item.priority), ["P0", "P1", "P2"]);
  assert.match(report.changes[0].whyHumanReview, /conservatively/);
});

test("unknown priority fails closed to P0", () => {
  assert.equal(ui.normalizeChange({ priority: "critical" }, 0).priority, "P0");
  assert.equal(ui.normalizeChange({}, 0).priority, "P0");
});

test("freshness handles fresh, stale, and unverifiable reports", () => {
  assert.equal(ui.makeFreshness({ headSha: "abcdef123" }, "abcdef123").state, "fresh");
  assert.equal(ui.makeFreshness({ headSha: "abcdef123" }, "999999999").state, "stale");
  assert.equal(ui.makeFreshness({ headSha: "abcdef123" }, "").state, "unverified");
});

test("default display expands only P0 and hides the native diff", () => {
  const display = ui.mergeDisplay();
  assert.deepEqual(display.expanded, { P0: true, P1: false, P2: false });
  assert.deepEqual(display.visible, { P0: true, P1: true, P2: true });
  assert.equal(display.showNativeDiff, false);
});

test("report display supplies defaults and saved settings override them", () => {
  const fromReport = ui.mergeDisplay(undefined, { P0: false, P1: true, P2: true });
  assert.deepEqual(fromReport.expanded, { P0: false, P1: true, P2: true });
  const overridden = ui.mergeDisplay({ expanded: { P1: false } }, { P0: false, P1: true, P2: true });
  assert.deepEqual(overridden.expanded, { P0: false, P1: false, P2: true });
});

test("normalizes evidence without preserving arbitrary object fields", () => {
  const item = ui.normalizeChange({
    evidence: [{ path: "src/a.js", start_line: 7, snippet: "safe", dangerous: "ignored" }]
  }, 0);
  assert.deepEqual(item.evidence[0], {
    path: "src/a.js",
    startLine: 7,
    endLine: null,
    side: "new",
    snippet: "safe"
  });
  assert.equal("dangerous" in item.evidence[0], false);
});

test("missing evidence line numbers remain null rather than coercing to zero", () => {
  const item = ui.normalizeChange({ evidence: [{ path: "src/a.js" }] }, 0);
  assert.equal(item.evidence[0].startLine, null);
  assert.equal(item.evidence[0].endLine, null);
});

test("retains explicit provider provenance, coverage, and review notes", () => {
  const report = ui.normalizeReport({
    mode: "replay",
    provenance: { classification: "live-typesafe-api", explanations: "prepared-copy", note: "Limited demo." },
    coverage: { total: 3, analyzed: 2, unanalysed: 1 },
    changes: [{ policyReasons: ["Policy override."], contextWarnings: ["Graph unavailable."] }]
  });
  assert.deepEqual(report.provenance, {
    classification: "live-typesafe-api",
    explanations: "prepared-copy",
    note: "Limited demo."
  });
  assert.deepEqual(report.coverage, { total: 3, analyzed: 2, unanalysed: 1 });
  assert.deepEqual(report.changes[0].policyReasons, ["Policy override."]);
  assert.deepEqual(report.changes[0].contextWarnings, ["Graph unavailable."]);
  assert.equal(ui.provenanceText(report), "Recorded Jev decisions · prepared demo explanations");
});
