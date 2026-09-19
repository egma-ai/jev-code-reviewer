"use strict";

async function activeMessage(type) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ? await chrome.tabs.sendMessage(tab.id, { type }) : null;
  } catch { return null; }
}

async function showStatus() {
  const status = await activeMessage("JEV_REVIEWER_STATUS");
  document.querySelector("#status").textContent = status?.message || "Open a GitHub pull request’s Files changed tab.";
  document.querySelector("#provenance").textContent = status?.provenance || "";
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
  const pairingToken = input.value.trim();
  if (!pairingToken) return;
  await chrome.storage.local.set({ pairingToken });
  input.value = "";
  input.placeholder = "Pairing token saved";
  setTimeout(showStatus, 500);
});
document.querySelector("#refresh").addEventListener("click", async (event) => {
  event.target.disabled = true;
  await activeMessage("JEV_REVIEWER_REFRESH");
  await showStatus();
  event.target.disabled = false;
});
initialize();
