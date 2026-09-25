"use strict";

const API_ORIGIN = "http://127.0.0.1:4731";

// "paired" | "rejected" | "offline". A server that predates /api/pairing answers 404
// only after the token check passes, so 404 still proves the token.
async function verifyToken(token) {
  try {
    const response = await fetch(`${API_ORIGIN}/api/pairing`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (response.ok || response.status === 404) return "paired";
    return response.status === 401 ? "rejected" : "offline";
  } catch { return "offline"; }
}

async function activeMessage(type) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ? await chrome.tabs.sendMessage(tab.id, { type }) : null;
  } catch { return null; }
}

async function showStatus() {
  const status = await activeMessage("JEV_REVIEWER_STATUS");
  // No answer means the page predates the extension (GitHub navigates without reloading).
  document.querySelector("#status").textContent = status?.message || "Open a pull request’s Files changed tab on github.com. Already there? Reload the page.";
  document.querySelector("#provenance").textContent = status?.provenance || "";
  if (status?.state === "unpaired") document.querySelector("#connection").open = true;
}

async function initialize() {
  const settings = await chrome.storage.local.get(["pairingToken", "logicView", "displaySettings"]);
  document.querySelector("#logic-view").checked = settings.logicView !== false;
  document.querySelector("#connection").open = !settings.pairingToken;
  if (settings.pairingToken) document.querySelector("#token").placeholder = "Pairing token saved";
  for (const input of document.querySelectorAll("[data-priority]")) {
    input.checked = settings.displaySettings?.expanded?.[input.dataset.priority] ?? input.dataset.priority === "P0";
    input.addEventListener("change", async () => {
      const stored = await chrome.storage.local.get("displaySettings");
      const expanded = Object.fromEntries([...document.querySelectorAll("[data-priority]")].map((item) => [item.dataset.priority, item.checked]));
      await chrome.storage.local.set({ displaySettings: { ...stored.displaySettings, expanded } });
    });
  }
  await showStatus();
}

document.querySelector("#logic-view").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ logicView: event.target.checked });
  setTimeout(showStatus, 400);
});
document.querySelector("#save").addEventListener("click", async () => {
  const input = document.querySelector("#token");
  const result = document.querySelector("#pairing-result");
  const pairingToken = input.value.trim();
  if (!pairingToken) return;
  result.textContent = "Checking the token…";
  const check = await verifyToken(pairingToken);
  if (check === "rejected") {
    result.textContent = "Token rejected: it does not match this computer’s reviewer. Copy it again with jev-reviewer token and paste the whole line.";
    return;
  }
  await chrome.storage.local.set({ pairingToken });
  input.value = "";
  input.placeholder = "Pairing token saved";
  result.textContent = check === "paired"
    ? "Paired with your local reviewer."
    : "Saved, but not checked: the local reviewer is not running. Start jev-reviewer serve.";
  setTimeout(showStatus, 500);
});
document.querySelector("#refresh").addEventListener("click", async (event) => {
  event.target.disabled = true;
  await activeMessage("JEV_REVIEWER_REFRESH");
  await showStatus();
  event.target.disabled = false;
});
initialize();
