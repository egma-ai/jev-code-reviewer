"use strict";

const API_ORIGIN = "http://127.0.0.1:4731";
const SAFE_SLUG = /^[A-Za-z0-9_.-]+$/;

function validRequest(message) {
  return Boolean(
    message &&
      message.type === "JEV_REVIEWER_FETCH" &&
      SAFE_SLUG.test(message.owner || "") &&
      SAFE_SLUG.test(message.repo || "") &&
      /^[1-9][0-9]*$/.test(String(message.pullRequest || ""))
  );
}

function reportMatchesRequest(report, message) {
  if (!report || typeof report !== "object") return false;
  const expectedRepository = `${message.owner}/${message.repo}`.toLowerCase();
  const actualRepository = String(report.repository || "").toLowerCase();
  return actualRepository === expectedRepository && Number(report.pullRequest ?? report.pull_request) === Number(message.pullRequest);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!validRequest(message)) {
    sendResponse({ ok: false, error: "Invalid GitHub pull request identifier." });
    return false;
  }

  const request = async () => {
    const { pairingToken = "" } = await chrome.storage.local.get("pairingToken");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const endpoint = `${API_ORIGIN}/api/reviews/${encodeURIComponent(message.owner)}/${encodeURIComponent(message.repo)}/${encodeURIComponent(String(message.pullRequest))}`;

    try {
      const headers = { Accept: "application/json" };
      if (pairingToken) headers.Authorization = `Bearer ${pairingToken}`;
      const response = await fetch(endpoint, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = response.status === 401
          ? "Pairing token rejected. Update it in Display settings."
          : `Local service returned HTTP ${response.status}.`;
        return { ok: false, status: response.status, error: detail };
      }
      const report = await response.json();
      if (!reportMatchesRequest(report, message)) {
        return { ok: false, error: "The local report identity does not match this GitHub pull request." };
      }
      return { ok: true, report };
    } catch (error) {
      const timedOut = error && error.name === "AbortError";
      return {
        ok: false,
        error: timedOut
          ? "The local reviewer did not respond in time."
          : "Jev-Reviewer is not reachable on 127.0.0.1:4731."
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  request().then(sendResponse);
  return true;
});
