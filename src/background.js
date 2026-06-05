// Listen for messages from content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchProductSpecs") {
    const productTitle = request.title;

    // Grab the URL for AI later....
    const tabUrl = sender.tab ? sender.tab.url : "";

    // Call AI API wrapper here (now serving local sample.json mock data)
    callYourAIService(productTitle, tabUrl)
      .then(aiResultData => {
        // Send the JSON object back to content.js
        sendResponse({ specs: aiResultData });
      })
      .catch(error => {
        console.error("AI Fetch Error:", error);
        sendResponse({ specs: null });
      });

    return true; // Keeps the message channel open for async handlers
  }
});

/**
 * Mock AI Service
 * Reads sample.json locally, mimicking a server response delay.
 */
async function callYourAIService(title, url) {
  // Mimicking a 1.5-second API network delay for realism:
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  try {
    // Fetch the local JSON file asset directly from the extension's folder
    const jsonUrl = chrome.runtime.getURL('sample.json');
    const response = await fetch(jsonUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to read sample.json: ${response.statusText}`);
    }

    const data = await response.json();
    return data; // Returns the full structured JSON layout object
  } catch (err) {
    console.error("Error reading local sample.json asset:", err);
    throw err;
  }
}

// Helper function to update the extension icon based on active state
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

// Listen for when the user clicks the extension toolbar icon
chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id;

  // Get the current persistent state, default to false if it doesn't exist yet
  const data = await chrome.storage.local.get({ isExtensionActive: false });
  const newState = !data.isExtensionActive;

  // Save the new state globally
  await chrome.storage.local.set({ isExtensionActive: newState });

  // Instantly update the icon on the current tab
  updateIcon(tabId, newState);

  // Send the message to the content script with the brand new state
  chrome.tabs.sendMessage(tabId, { action: "toggle_decidio.", state: newState }, (response) => {
    // Suppress errors if the user clicks the icon on a page where content scripts can't run
    if (chrome.runtime.lastError) {
      console.warn("decidio.: Content script not ready on this tab.");
    }
  });
});

// Listen for tab updates (like navigation/reloads) to ensure the icon stays correct
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only check when the page finishes loading completely
  if (changeInfo.status === 'complete') {
    const data = await chrome.storage.local.get({ isExtensionActive: false });
    
    // Update the icon to reflect the global extension state for this reloaded/new page
    updateIcon(tabId, data.isExtensionActive);
  }
});