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
      oldLogic: "All sessions remained active.",
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
document.body.dataset.rendererReady = "true";
