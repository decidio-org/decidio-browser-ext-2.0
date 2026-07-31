/**
 * background.js
 * 
 * This script manages logic for:
 * - Handling messages from content scripts and popup scripts. Popup is not in use right now for log-in
 * - Managing the extension's active state and UI (icon and popup).
 */




// Helper to update the extension icon and popup behavior globally or per-tab
const AUTH_KEY = "isLoggedIn";
const ACTIVE_KEY = "isExtensionActive";

async function updateExtensionUI(tabId, isActive) {
  const { [AUTH_KEY]: isLoggedIn } = await chrome.storage.local.get(AUTH_KEY);

  // Once logged in, the icon is always a toggle — never a login prompt.
  chrome.action.setPopup({
    tabId: tabId,
    popup: isLoggedIn ? "" : "popup.html"
  });

  
  chrome.action.setIcon({
    tabId: tabId,
    path: {
      "16": iconPath,
      "48": iconPath,
      "128": iconPath
    }
  });

  //If active, disable the popup so onClicked fires. If inactive, show popup.html
  chrome.action.setPopup({ 
   tabId: tabId, 
   popup: isActive ? "" : "popup.html" 
  });
}

// Listen for messages from content.js or popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  //Handle login success from popup
  if (request.action === "LOGIN_SUCCESS") {
    chrome.storage.local.set({ [AUTH_KEY]: true, [ACTIVE_KEY]: true }, () => {
      // Global default — applies to every tab, present and future.
      chrome.action.setPopup({ popup: "" });
  
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          updateExtensionUI(tabs[0].id, true);
          chrome.tabs.sendMessage(tabs[0].id, { action: "toggle_decidio", state: true });
        }
      });
      return true;
    });

  }
  // Content script asking for the initial state when a page loads
  if (request.action === "GET_EXTENSION_STATE") {
    chrome.storage.local.get({ isExtensionActive: false }, (data) => {
      sendResponse({ isExtensionActive: data.isExtensionActive });
    });
    return true;
  }

  if (request.action === "PRODUCT_IMAGE_PICKED") {
    const newProduct = {
      imageUrl: request.imageUrl,
      productUrl: request.productUrl,
      productTitle: request.productTitle || "Product",
      timestamp: new Date().toISOString()
    };

    chrome.storage.local.get({ savedProducts: [] }, (result) => {
      const currentProducts = result.savedProducts;
      currentProducts.push(newProduct);

      chrome.storage.local.set({ savedProducts: currentProducts }, () => {
        console.log("Successfully saved product data mapping:", newProduct);
        
        // Forward back to app.js that a product was added
        chrome.runtime.sendMessage({
          action: "RENDER_PICKED_PRODUCT",
          product: newProduct
        });
      });
    });
  }
});



// Handle Action Button Click (Hotbar Icon)
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const data = await chrome.storage.local.get({ isExtensionActive: false });
  const nextActiveState = !data.isExtensionActive;

  const storageUpdates = { isExtensionActive: nextActiveState };

  // If turning OFF, clear out old saved items
  if (!nextActiveState) {
    storageUpdates.savedProducts = [];
    console.log("Extension turned off. Clearing product box storage.");
  }

  await chrome.storage.local.set(storageUpdates);
  
  // Update UI for the current tab
  updateExtensionUI(tab.id, nextActiveState);

  chrome.tabs.sendMessage(tab.id, { action: "toggle_decidio.", state: nextActiveState }, (response) => {
    if (chrome.runtime.lastError) {
      if (nextActiveState) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"] 
        });
      }
    }
  });
});

// Listen for when the user switches tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  
  // Get the global active state from storage
  const data = await chrome.storage.local.get({ isExtensionActive: false });
  
  // Update the extension icon/UI for new activated tab
  updateExtensionUI(tabId, data.isExtensionActive);

  // Tell the content script in this tab to sync its UI with the global state
  chrome.tabs.sendMessage(tabId, { action: "toggle_decidio.", state: data.isExtensionActive }, (response) => {
    // If the content script isn't running on this tab yet and the extension is active, inject it
    if (chrome.runtime.lastError && data.isExtensionActive) {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      });
    }
  });
});

// Keep UI state consistent when tabs update or user switches tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabId) {
    const data = await chrome.storage.local.get({ isExtensionActive: false });
    updateExtensionUI(tabId, data.isExtensionActive);
  }
});

