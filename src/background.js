/**
 * background.js contains code for the icon, listening for messages
 * from content.js
 */

importScripts('scraper_utils.js', 'scraper_shopify.js', 'scraper.js');


// Listen for messages from content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Catch the new centralized integration pipeline action
  if (request.action === "PROCESS_PRODUCT_PIPELINE") {
    const payload = request.payload;

    // Execute routing, classification, caching, and fallback management
    orchestrateProductPipeline(payload)
      .then(canonicalData => {
        sendResponse({ data: canonicalData });
      })
      .catch(error => {
        console.error("Pipeline Engine Exception:", error);
        sendResponse({ error: error.message || "Failed processing specification rules." });
      });

    return true;
  }
});

/**
 * =======================
 * EXTENSION ICON SECTION
 * =======================
 */

function updateIcon(tabId, isActive) {
  const iconPath = isActive ? "active_logo.png" : "default_logo.png";
  chrome.action.setIcon({
    tabId: tabId,
    path: {
      "16": iconPath,
      "48": iconPath,
      "128": iconPath
    }
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  const data = await chrome.storage.local.get({ isExtensionActive: false });
  const newState = !data.isExtensionActive;

  await chrome.storage.local.set({ isExtensionActive: newState });
  updateIcon(tabId, newState);

  chrome.tabs.sendMessage(tabId, { action: "toggle_decidio.", state: newState }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("decidio.: Content script not ready on this tab.");
    }
  });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const data = await chrome.storage.local.get({ isExtensionActive: false });
    updateIcon(tabId, data.isExtensionActive);
  }
});