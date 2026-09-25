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
  let notice = null;
  const dismissed = new Set();

  const COPY = {
    idle: "Open a pull request’s Files changed tab to use Jev-Reviewer.",
    unpaired: "Not paired with your local reviewer, so GitHub’s code is unchanged. Click the Jev-Reviewer toolbar button → Connection, paste the output of jev-reviewer token, and Save.",
    stale: "This report is for an older commit, so GitHub’s code is shown. Rerun jev-reviewer analyze, then click Refresh report in the toolbar popup.",
    unverified: "Can’t confirm which commit this page shows, so GitHub’s code is shown. Reload the page; if this continues, rerun jev-reviewer analyze.",
    unsupported: "Your report is ready, but GitHub’s new Files changed page isn’t supported yet. Switch to the classic page (profile picture → Feature preview → turn off the new Files changed experience), then reload.",
    changesQuiet: "GitHub’s new Files changed page isn’t supported yet. Jev-Reviewer works on the classic page."
  };
  // Only states the user must act on get an on-page notice. A stopped server or a PR
  // without a report stays quiet: this script runs on every pull request page.
  const NOTICE_STATES = new Set(["unpaired", "unsupported", "stale", "unverified"]);

  function identity() {
    return JevReviewerUI.pageIdentity(location.pathname);
  }

  function renderNotice(state, copy) {
    const key = `${activeKey}|${state}`;
    if (!NOTICE_STATES.has(state) || dismissed.has(key)) { notice?.remove(); return; }
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "jrv-page-notice";
      notice.setAttribute("role", "status");
      const title = document.createElement("strong");
      title.textContent = "Jev-Reviewer";
      const text = document.createElement("span");
      text.className = "jrv-page-notice-text";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "jrv-page-notice-close";
      close.setAttribute("aria-label", "Dismiss");
      close.textContent = "×";
      close.addEventListener("click", () => { dismissed.add(notice.dataset.key); notice.remove(); });
      notice.append(title, text, close);
    }
    notice.dataset.key = key;
    notice.dataset.state = state;
    notice.querySelector(".jrv-page-notice-text").textContent = copy;
    if (!notice.isConnected) document.body.append(notice);
  }

  function readyCopy() {
    const coverage = report.coverage || {};
    const skipped = coverage.unanalysed
      ? ` ${coverage.unanalysed} of ${coverage.total} changes weren’t analyzed (--max-units), so their files keep GitHub’s code.`
      : " Other files keep their original diff.";
    if (!managed.size) return `Report loaded. Waiting for GitHub’s diff tables.${coverage.unanalysed ? skipped : ""}`;
    return `Showing logic for ${managed.size} ${managed.size === 1 ? "file" : "files"}.${skipped}`;
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
    renderNotice(state, copy);
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
      updateStatus(freshness.state === "stale" ? "stale" : "unverified", freshness.state === "stale" ? COPY.stale : COPY.unverified);
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
    updateStatus("ready", readyCopy());
  }

  function scheduleApply() {
    if (scheduled || !report) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; applyToFiles(); }, 80);
  }

  async function load(force = false) {
    const request = identity();
    const key = request ? `${request.owner}/${request.repo}#${request.pullRequest}:${request.view}` : "";
    // A changed page head invalidates visible prose before any asynchronous request.
    if (key === activeKey && report) applyToFiles();
    if (!force && pending && key === activeKey) return;
    const ticket = ++generation;
    pending = false;
    if (key !== activeKey) { restore(); report = null; signature = ""; activeKey = key; }
    if (!request) { updateStatus("idle", COPY.idle); return; }
    settings = await chrome.storage.local.get(["pairingToken", "logicView", "displaySettings"]);
    if (ticket !== generation) return;
    if (settings.logicView === false) { restore(); report = null; updateStatus("disabled", "Showing GitHub’s original code."); return; }
    pending = true;
    const result = await message({ type: "JEV_REVIEWER_FETCH", owner: request.owner, repo: request.repo, pullRequest: request.pullRequest });
    if (ticket !== generation) return;
    pending = false;
    if (!result?.ok) {
      restore(); report = null;
      if (result?.status === 401) updateStatus("unpaired", COPY.unpaired);
      else if (request.view === "changes") updateStatus("idle", COPY.changesQuiet);
      else updateStatus("unavailable", result?.error || "Local reviewer unavailable. Showing GitHub’s code.");
      return;
    }
    // The report exists, but the new React page has none of the classic diff markup.
    if (request.view === "changes") { restore(); report = null; updateStatus("unsupported", COPY.unsupported); return; }
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
  setInterval(() => { if (!document.hidden && identity()?.view === "files") load(); }, 20000);
  load();
})();
