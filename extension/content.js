(function bootJevReviewer() {
  "use strict";

  const ROOT_ID = "jev-reviewer-root";
  const DISPLAY_KEY = "displaySettings";
  const URL_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/files\/?$/;
  let activeKey = "";
  let nativeDiff = null;
  let lastUrl = location.href;

  function parsePullRequest(pathname = location.pathname) {
    const match = pathname.match(URL_PATTERN);
    if (!match) return null;
    return { owner: match[1], repo: match[2], pullRequest: Number(match[3]) };
  }

  function currentHeadSha() {
    let comparisonHead = "";
    const comparisonPath = document.querySelector(".js-pull-refresh-on-pjax[data-url*='end_commit_oid=']")?.getAttribute("data-url");
    if (comparisonPath) {
      try { comparisonHead = new URL(comparisonPath, location.origin).searchParams.get("end_commit_oid") || ""; }
      catch { comparisonHead = ""; }
    }
    const candidates = [
      document.querySelector("[data-head-ref-oid]")?.getAttribute("data-head-ref-oid"),
      document.querySelector("meta[name='octolytics-dimension-pull_request_head_sha']")?.content,
      comparisonHead
    ].filter(Boolean);
    return candidates.find((value) => /^[a-f0-9]{7,40}$/i.test(value)) || "";
  }

  function findNativeDiff() {
    return document.querySelector(
      "[data-target='diff-layout.mainContainer'], .js-diff-progressive-container, #files_bucket, .js-diff-load-container"
    );
  }

  function setNativeDiffVisible(visible) {
    if (!nativeDiff || !nativeDiff.isConnected) nativeDiff = findNativeDiff();
    if (!nativeDiff) return;
    nativeDiff.dataset.jevNativeDiff = "true";
    nativeDiff.hidden = !visible;
  }

  function mountRoot() {
    document.getElementById(ROOT_ID)?.remove();
    nativeDiff = findNativeDiff();
    const root = document.createElement("div");
    root.id = ROOT_ID;
    if (nativeDiff && nativeDiff.parentNode) nativeDiff.parentNode.insertBefore(root, nativeDiff);
    else (document.querySelector("main") || document.body).prepend(root);
    return root;
  }

  function renderStatus(root, kind, title, copy, retry, savePairingToken) {
    root.replaceChildren();
    root.className = `jrv-shell jrv-status jrv-status--${kind}`;
    const mark = document.createElement("span");
    mark.className = "jrv-mark";
    mark.textContent = "J";
    const content = document.createElement("div");
    const heading = document.createElement("h2");
    heading.className = "jrv-status__title";
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.className = "jrv-status__copy";
    paragraph.textContent = copy;
    content.append(heading, paragraph);
    if (retry) {
      const button = document.createElement("button");
      button.className = "jrv-button";
      button.type = "button";
      button.textContent = "Retry";
      button.addEventListener("click", retry);
      content.append(button);
    }
    if (savePairingToken) {
      const pairing = document.createElement("details");
      pairing.className = "jrv-status__pairing";
      const pairingSummary = document.createElement("summary");
      pairingSummary.textContent = "Set pairing token";
      const row = document.createElement("div");
      row.className = "jrv-token-row";
      const input = document.createElement("input");
      input.className = "jrv-token-input";
      input.type = "password";
      input.autocomplete = "off";
      input.placeholder = "Paste local pairing token";
      const save = document.createElement("button");
      save.className = "jrv-button jrv-button--small";
      save.type = "button";
      save.textContent = "Save and retry";
      save.addEventListener("click", async () => {
        save.disabled = true;
        await savePairingToken(input.value.trim());
      });
      row.append(input, save);
      pairing.append(pairingSummary, row);
      content.append(pairing);
    }
    root.append(mark, content);
  }

  function message(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(response || { ok: false, error: "No response from extension service worker." });
      });
    });
  }

  async function load(force = false) {
    const identity = parsePullRequest();
    if (!identity) {
      document.getElementById(ROOT_ID)?.remove();
      setNativeDiffVisible(true);
      activeKey = "";
      return;
    }
    const key = `${identity.owner}/${identity.repo}#${identity.pullRequest}`;
    if (!force && key === activeKey && document.getElementById(ROOT_ID)) return;
    activeKey = key;
    const root = mountRoot();
    renderStatus(root, "loading", "Preparing the human review", "Loading the latest local Jev-Reviewer report…");

    const result = await message({ type: "JEV_REVIEWER_FETCH", ...identity });
    if (key !== activeKey) return;
    if (!result.ok) {
      setNativeDiffVisible(true);
      renderStatus(
        root,
        "unavailable",
        "Local reviewer unavailable",
        `${result.error || "Could not load this review."} Start it with “jev-reviewer serve”, then retry. The GitHub diff remains visible.`,
        () => load(true),
        async (pairingToken) => {
          await chrome.storage.local.set({ pairingToken });
          load(true);
        }
      );
      return;
    }

    const stored = await chrome.storage.local.get([DISPLAY_KEY, "pairingToken"]);
    root.className = "";
    JevReviewerUI.renderReview(root, result.report, {
      display: stored[DISPLAY_KEY],
      currentHeadSha: currentHeadSha(),
      hasPairingToken: Boolean(stored.pairingToken),
      onRefresh: () => load(true),
      onNativeDiffChange: setNativeDiffVisible,
      onDisplayChange: (display) => chrome.storage.local.set({ [DISPLAY_KEY]: display }),
      onPairingToken: async (pairingToken) => {
        await chrome.storage.local.set({ pairingToken });
        load(true);
      }
    });
  }

  document.addEventListener("turbo:load", () => load());
  document.addEventListener("pjax:end", () => load());
  window.addEventListener("popstate", () => setTimeout(() => load(), 0));
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      load();
    }
  }, 750);
  load();
})();
