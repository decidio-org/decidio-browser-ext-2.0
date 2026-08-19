/**
 * background.js
 * 
 * Extension Service Worker handling icon state, storage updates,
 * and communication between app.js and content.js.
 */

/**
 * Updates the extension toolbar icon dynamically based on active state.
 * 
 * @param {number} tabId - Target tab ID to update.
 * @param {boolean} isActive - Whether the extension is currently active.
 */
function updateExtensionUI(tabId, isActive) {
  if (!tabId) return;
  const iconPath = isActive ? "images/active_logo.png" : "images/default_logo.png";
  
  // Set toolbar action icon dynamically across supported densities
  chrome.action.setIcon({
    tabId: tabId,
    path: {
      "16": iconPath,
      "48": iconPath,
      "128": iconPath
    }
  }).catch(() => {}); // Suppress errors if the tab closes before icon update finishes
}

/**
 * Broadcasts runtime messages to extension views (popups/iframes) safely.
 * Swallows errors when no receiver is actively listening.
 * 
 * @param {Object} message - Payload message object to broadcast.
 */
function safeRuntimeSendMessage(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Expected benign error when sidebar iframe/popup is not currently open/mounted
  });
}

/**
 * Safely sends a message to a specific tab's content script wrapper.
 * 
 * @param {number} tabId - Target browser tab ID.
 * @param {Object} message - Message object payload.
 * @param {Function} [callback] - Optional response and error handler.
 */
function safeTabSendMessage(tabId, message, callback) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, message, (response) => {
    const err = chrome.runtime.lastError;
    if (callback) callback(response, err);
  });
}

/* --------------------------------------------------------------------------
   MESSAGE HANDLERS (CONTENT SCRIPT & APP UI COMMUNICATION)
   -------------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // Return the active/inactive state stored in chrome.storage.local
  if (request.action === "GET_EXTENSION_STATE") {
    chrome.storage.local.get({ isExtensionActive: false }, (data) => {
      sendResponse({ isExtensionActive: data.isExtensionActive });
    });
    return true; // Keeps message channel open for asynchronous sendResponse call
  }
  
  // Save a single picked product to local storage and trigger UI re-render
  if (request.action === "PRODUCT_IMAGE_PICKED") {
    chrome.storage.local.get({ savedProducts: [] }, (result) => {
      const updatedList = [...result.savedProducts, {
        imageUrl: request.imageUrl,
        productUrl: request.productUrl,
        productTitle: request.productTitle
      }];
      chrome.storage.local.set({ savedProducts: updatedList }, () => {
        safeRuntimeSendMessage({ action: "RENDER_PICKED_PRODUCT" });
      });
    });
  } 
  // Save multiple picked products in batch to storage and trigger UI re-render
  else if (request.action === "PRODUCT_IMAGES_BATCH_PICKED") {
    chrome.storage.local.get({ savedProducts: [] }, (result) => {
      const itemsToAppend = request.items || request.products || [];
      const updatedList = [...result.savedProducts, ...itemsToAppend];
      chrome.storage.local.set({ savedProducts: updatedList }, () => {
        safeRuntimeSendMessage({ action: "RENDER_PICKED_PRODUCT" });
      });
    });
  }
});

/* --------------------------------------------------------------------------
   TOOLBAR ACTION & TAB LIFECYCLE LISTENERS
   -------------------------------------------------------------------------- */

// Handles browser action icon clicks to toggle extension state on/off
chrome.action.onClicked.addListener(async (tab) => {
  // Guard against system, browser extension store, and blank internal pages
  if (!tab || !tab.id || tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://")) return;

  const data = await chrome.storage.local.get({ isExtensionActive: false });
  const nextActiveState = !data.isExtensionActive;

  const storageUpdates = { isExtensionActive: nextActiveState };

  // Clear accumulated list data whenever extension is toggled OFF
  if (!nextActiveState) {
    storageUpdates.savedProducts = [];
    console.log("Extension turned off. Clearing product collect box storage.");
  }

  await chrome.storage.local.set(storageUpdates);
  
  updateExtensionUI(tab.id, nextActiveState);

  const targetAction = nextActiveState ? "TOGGLE_DECIDIO_EXTENSION" : "DEACTIVATE_DECIDIO_EXTENSION";

  // Dispatch activation signal to content script with fallback script injection
  safeTabSendMessage(tab.id, { action: targetAction }, (response, error) => {
    if (error && nextActiveState) {
      // If content script is unattached on this tab, inject dynamically
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"] 
      }, () => {
        if (!chrome.runtime.lastError) {
          safeTabSendMessage(tab.id, { action: targetAction });
        }
      });
    }
  });
});

// Sync icon and UI state when active browser tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const data = await chrome.storage.local.get({ isExtensionActive: false });
  
  updateExtensionUI(tabId, data.isExtensionActive);

  if (!data.isExtensionActive) {
    safeTabSendMessage(tabId, { action: "DEACTIVATE_DECIDIO_EXTENSION" });
  }
});

// Refresh icon state when target tab finishes page navigation/reload
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabId && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
    const data = await chrome.storage.local.get({ isExtensionActive: false });
    updateExtensionUI(tabId, data.isExtensionActive);
  }
});
