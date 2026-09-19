"use strict";

const report = {
  repository: "example/project",
  pullRequest: 42,
  title: "Rotate sessions safely",
  headSha: "abcdef1234567890",
  generatedAt: "2026-09-18T12:00:00Z",
  mode: "replay",
  changes: [
    {
      id: "sessions",
      title: "Session policy <img src=x onerror=alert(1)>",
      priority: "P0",
      oldLogic: "All sessions <img src=x onerror=alert(1)> remained active.",
      newLogic: "Sensitive changes now rotate sessions.",
      whatChanged: "Rotation moved into the account service.",
      whyHumanReview: "Authentication behavior changed.",
      files: ["src/session.ts"],
      evidence: [{ path: "src/session.ts", startLine: 12, endLine: 28, snippet: "rotateSession();" }],
      confidence: 0.93
    },
    {
      id: "types",
      title: "Propagate the session result type",
      priority: "P2",
      oldLogic: "The result was untyped.",
      newLogic: "The result uses SessionResult.",
      whatChanged: "A mechanical type annotation was added.",
      whyHumanReview: "Automated evidence is sufficient."
    }
  ]
};

JevReviewerUI.renderReview(document.querySelector("#review"), report, {
  currentHeadSha: "abcdef1234567890"
});

const root = document.querySelector("#review");
const files = [...root.querySelectorAll(":scope > .jrv-file")];
const first = files[0];
const second = files[1];
const required = {
  files: files.length === 2,
  logicTable: Boolean(first?.querySelector(".jrv-logic-table")),
  oldCell: Boolean(first?.querySelector(".jrv-old-logic")),
  newCell: Boolean(first?.querySelector(".jrv-new-logic")),
  infoNote: Boolean(first?.querySelector(".jrv-change-note .jrv-change-note__summary")),
  priorityBadge: first?.querySelector(".jrv-priority")?.textContent === "P0",
  p0Expanded: first?.open === true,
  p2Collapsed: second?.open === false,
  literalModelText: first?.querySelector(".jrv-old-logic")?.textContent.includes("<img src=x onerror=alert(1)>") === true,
  noInjectedImage: first?.querySelector("img") === null,
  noLegacyDashboard: root.querySelector(".jrv-card, .jrv-shell, .jrv-header, .jrv-toolbar") === null
};
const failed = Object.entries(required).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Renderer smoke assertions failed: ${failed.join(", ")}`);

const result = document.createElement("output");
result.id = "renderer-result";
result.textContent = "Native file renderer assertions passed";
document.body.append(result);
document.body.dataset.rendererAssertions = "passed";
document.body.dataset.rendererReady = "true";
