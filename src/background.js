/**
 * background.js
 * 
 * Extension Service Worker handling icon state, storage updates,
 * and communication between app.js and content.js.
 */

function updateExtensionUI(tabId, isActive) {
  if (!tabId) return;
  const iconPath = isActive ? "images/active_logo.png" : "images/default_logo.png";
  
  chrome.action.setIcon({
    tabId: tabId,
    path: {
      "16": iconPath,
      "48": iconPath,
      "128": iconPath
    }
  }).catch(() => {}); // Suppress errors if tab was closed before icon updated
}

// Safely broadcast messages to popups/iframes without throwing unhandled promise errors
function safeRuntimeSendMessage(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Expected error when no popup/iframe is active to receive the message
  });
}

// Safely send messages to tab content scripts
function safeTabSendMessage(tabId, message, callback) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, message, (response) => {
    const err = chrome.runtime.lastError;
    if (callback) callback(response, err);
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === "GET_EXTENSION_STATE") {
    chrome.storage.local.get({ isExtensionActive: false }, (data) => {
      sendResponse({ isExtensionActive: data.isExtensionActive });
    });
    return true;
  }
  
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

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://")) return;

  const data = await chrome.storage.local.get({ isExtensionActive: false });
  const nextActiveState = !data.isExtensionActive;

  const storageUpdates = { isExtensionActive: nextActiveState };

  if (!nextActiveState) {
    storageUpdates.savedProducts = [];
    console.log("Extension turned off. Clearing product collect box storage.");
  }

  await chrome.storage.local.set(storageUpdates);
  
  updateExtensionUI(tab.id, nextActiveState);

  const targetAction = nextActiveState ? "TOGGLE_DECIDIO_EXTENSION" : "DEACTIVATE_DECIDIO_EXTENSION";

  safeTabSendMessage(tab.id, { action: targetAction }, (response, error) => {
    if (error && nextActiveState) {
      // Content script is missing on this tab; inject it dynamically
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

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const data = await chrome.storage.local.get({ isExtensionActive: false });
  
  updateExtensionUI(tabId, data.isExtensionActive);

  if (!data.isExtensionActive) {
    safeTabSendMessage(tabId, { action: "DEACTIVATE_DECIDIO_EXTENSION" });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabId && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
    const data = await chrome.storage.local.get({ isExtensionActive: false });
    updateExtensionUI(tabId, data.isExtensionActive);
  }
});