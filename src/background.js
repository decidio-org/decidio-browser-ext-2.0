/**
 * background.js contains code for the icon, listening for messages
 * from content.js
 */

importScripts('scraper_utils.js', 'scraper_shopify.js', 'scraper.js');


// Listen for messages from content.js or popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  // Handle the login success message from popup.js
  if (request.action === "LOGIN_SUCCESS") {
    // Save state globally
    chrome.storage.local.set({ isExtensionActive: true });

    // Update the current active tab immediately so it locks into the active state
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        // Disable the popup explicitly for THIS active tab right away
        chrome.action.setPopup({ tabId: tabs[0].id, popup: "" });
        updateIcon(tabs[0].id, true);
        
        // Notify the content script to spin up the UI environment
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggle_decidio.", state: true });
      }
    });
    return;
  }

  // Catch the centralized integration pipeline action
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

// This handles the explicit state shift per-tab
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Check current state from storage
  const data = await chrome.storage.local.get({ isExtensionActive: false });
  const currentlyActive = data.isExtensionActive;

  // Swap to the opposite state
  const nextActiveState = !currentlyActive;

  // Commit state change to storage
  await chrome.storage.local.set({ isExtensionActive: nextActiveState });
  
  // Update Icon and Popup per tabId explicitly so Chrome doesn't fallback to defaults
  if (nextActiveState) {
    // Turning ON
    chrome.action.setPopup({ tabId: tab.id, popup: "" });
    updateIcon(tab.id, true);
  } else {
    // Turning OFF
    chrome.action.setPopup({ tabId: tab.id, popup: "popup.html" });
    updateIcon(tab.id, false);
    console.log("Extension deactivated for this session.");
  }

  // Send payload to content script
  chrome.tabs.sendMessage(tab.id, { action: "toggle_decidio.", state: nextActiveState }, (response) => {
    if (chrome.runtime.lastError) {
      // If content script isn't loaded yet on activation, inject it
      if (nextActiveState) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"] 
        });
      }
    }
  });
});

// Keep state persistent across tab changes/reloads
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const data = await chrome.storage.local.get({ isExtensionActive: false });
    
    // Ensure the icon matches the current login state
    updateIcon(tabId, data.isExtensionActive);

    if (data.isExtensionActive) {
      chrome.action.setPopup({ tabId: tabId, popup: "" });
    } else {
      chrome.action.setPopup({ tabId: tabId, popup: "popup.html" });
    }
  }
});