(function bootJevReviewer() {
  "use strict";

  const managed = new Map();
  let report = null;
  let settings = {};
  let signature = "";
  let activeKey = "";
  let generation = 0;
  let pending = false;
  let scheduled = false;
  let lastUrl = location.href;
  let status = { state: "loading", message: "Loading the local report…", provenance: "" };

  function identity() {
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/files\/?$/);
    return match ? { owner: match[1], repo: match[2], pullRequest: Number(match[3]) } : null;
  }

  function currentHeadSha() {
    const path = document.querySelector(".js-pull-refresh-on-pjax[data-url*='end_commit_oid=']")?.getAttribute("data-url");
    let comparisonHead = "";
    try { if (path) comparisonHead = new URL(path, location.origin).searchParams.get("end_commit_oid"); } catch { /* Unknown head: keep code visible. */ }
    const candidates = [comparisonHead,
      document.querySelector("[data-head-ref-oid]")?.getAttribute("data-head-ref-oid"),
      document.querySelector("meta[name='octolytics-dimension-pull_request_head_sha']")?.content
    ].filter((value) => /^[a-f0-9]{40}$/i.test(value || "")).map((value) => value.toLowerCase());
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? unique[0] : "";
  }

  function message(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        resolve(chrome.runtime.lastError ? { ok: false, error: "The extension was reloaded. Refresh this GitHub page." } : response);
      });
    });
  }

  function updateStatus(state, copy) {
    status = { state, message: copy, provenance: report ? JevReviewerUI.provenanceText(report) : "" };
    document.documentElement.dataset.jevReviewerState = state;
    message({ type: "JEV_REVIEWER_STATUS_UPDATE", state, message: copy });
  }

  function toggle(file) {
    return file.querySelector(":scope > .js-file-header button.js-details-target[aria-label='Toggle diff contents']");
  }

  function setExpanded(file, expanded) {
    const button = toggle(file);
    if (!button) return;
    if ((button.getAttribute("aria-expanded") === "true") !== expanded) button.click();
    // Also supports GitHub's deferred diff markup before its handlers have connected.
    file.classList.toggle("Details--on", expanded);
    file.classList.toggle("open", expanded);
    button?.setAttribute("aria-expanded", String(expanded));
  }

  function restoreFile(file, record) {
    record.replacement.remove();
    record.badge.remove();
    record.table.hidden = record.wasHidden;
    record.table.removeAttribute("data-jev-code-hidden");
    file.removeAttribute("data-jev-file");
    if (file.isConnected && record.wasExpanded !== null) setExpanded(file, record.wasExpanded);
  }

  function restore() {
    for (const [file, record] of managed) restoreFile(file, record);
    managed.clear();
  }

  function applyToFiles() {
    if (!report || settings.logicView === false) return;
    const freshness = JevReviewerUI.makeFreshness(report, currentHeadSha());
    if (freshness.state !== "fresh" || !/^[a-f0-9]{40}$/i.test(report.headSha)) {
      restore();
      updateStatus(freshness.state === "stale" ? "stale" : "unverified",
        freshness.state === "stale" ? "This report is for an older commit. Showing GitHub’s code." : "Cannot verify the report’s commit. Showing GitHub’s code.");
      return;
    }
    const display = JevReviewerUI.mergeDisplay(settings.displaySettings, report.display);
    for (const [file, record] of managed) {
      if (!file.isConnected) { restoreFile(file, record); managed.delete(file); }
    }
    for (const file of document.querySelectorAll(".js-file[data-tagsearch-path]")) {
      const header = file.querySelector(":scope > .js-file-header[data-path]");
      const path = header?.getAttribute("data-path") || file.getAttribute("data-tagsearch-path");
      const changes = report.changes.filter((change) => change.files.includes(path));
      if (!header || !changes.length || changes.some((change) => change.signals.includes("not_analyzed"))) continue;
      const table = file.querySelector(":scope > .js-file-content table.diff-table");
      if (!table) continue;
      const existing = managed.get(file);
      if (existing?.table === table && existing.replacement.isConnected) continue;
      if (existing) { restoreFile(file, existing); managed.delete(file); }

      const priority = ["P0", "P1", "P2"].find((level) => changes.some((change) => change.priority === level));
      const replacement = document.createElement("div");
      replacement.className = "jrv-native-replacement";
      replacement.dataset.path = path;
      JevReviewerUI.renderLogicTable(replacement, changes, { report });
      const badge = JevReviewerUI.createPriorityBadge(priority, report);
      badge.classList.add("jrv-native-priority");
      const nativeToggle = toggle(file);
      const record = { table, replacement, badge, wasHidden: table.hidden, wasExpanded: nativeToggle ? nativeToggle.getAttribute("aria-expanded") === "true" : null };
      managed.set(file, record);
      table.before(replacement);
      table.hidden = true;
      table.dataset.jevCodeHidden = "true";
      (header.querySelector(".file-info") || header).append(badge);
      file.dataset.jevFile = priority;
      setExpanded(file, display.expanded[priority]);
    }
    updateStatus("ready", managed.size ? `Showing logic for ${managed.size} files. Other files keep their original diff.` : "Report loaded. Waiting for GitHub’s diff tables.");
  }

  function scheduleApply() {
    if (scheduled || !report) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; applyToFiles(); }, 80);
  }

  async function load(force = false) {
    const request = identity();
    const key = request ? `${request.owner}/${request.repo}#${request.pullRequest}` : "";
    // A changed page head invalidates visible prose before any asynchronous request.
    if (key === activeKey && report) applyToFiles();
    if (!force && pending && key === activeKey) return;
    const ticket = ++generation;
    pending = false;
    if (key !== activeKey) { restore(); report = null; signature = ""; activeKey = key; }
    if (!request) { updateStatus("idle", "Open a GitHub pull request’s Files changed tab."); return; }
    settings = await chrome.storage.local.get(["pairingToken", "logicView", "displaySettings"]);
    if (ticket !== generation) return;
    if (settings.logicView === false) { restore(); report = null; updateStatus("disabled", "Showing GitHub’s original code."); return; }
    pending = true;
    const result = await message({ type: "JEV_REVIEWER_FETCH", ...request });
    if (ticket !== generation) return;
    pending = false;
    if (!result?.ok) {
      restore(); report = null;
      updateStatus("unavailable", result?.error || "Local reviewer unavailable. Showing GitHub’s code.");
      return;
    }
    const nextSignature = JSON.stringify(result.report);
    if (force || !report || signature !== nextSignature) {
      restore();
      report = JevReviewerUI.normalizeReport(result.report);
      signature = nextSignature;
    }
    applyToFiles();
  }

  chrome.runtime.onMessage.addListener((request, _sender, respond) => {
    if (request?.type === "JEV_REVIEWER_STATUS") { respond(status); return false; }
    if (request?.type === "JEV_REVIEWER_REFRESH") { load(true).then(() => respond(status)); return true; }
    return false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && ["pairingToken", "logicView", "displaySettings"].some((key) => key in changes)) load(true);
  });
  new MutationObserver((mutations) => {
    const headSelector = ".js-pull-refresh-on-pjax, [data-head-ref-oid], meta[name='octolytics-dimension-pull_request_head_sha']";
    const headChanged = mutations.some((mutation) =>
      (mutation.type === "attributes" && mutation.target.matches(headSelector)) ||
      [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node.nodeType === 1 &&
        (node.matches(headSelector) || node.querySelector(headSelector))));
    if (headChanged) applyToFiles();
    if (mutations.some((mutation) => [...mutation.addedNodes].some((node) => node.nodeType === 1 &&
      (node.matches(".js-file, table.diff-table, .js-pull-refresh-on-pjax") || node.querySelector(".js-file, table.diff-table, .js-pull-refresh-on-pjax"))))) scheduleApply();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-url", "data-head-ref-oid", "content"] });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { applyToFiles(); load(); } });
  document.addEventListener("turbo:load", () => load(true));
  document.addEventListener("pjax:end", () => load(true));
  window.addEventListener("popstate", () => load(true));
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; load(true); }
  }, 750);
  setInterval(() => { if (!document.hidden && identity()) load(); }, 20000);
  load();
})();
