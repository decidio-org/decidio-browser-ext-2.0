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