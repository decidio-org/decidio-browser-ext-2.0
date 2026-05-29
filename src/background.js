// Object to track if the icon is active on current tab
let activeTabs = {};

// Listen for when the user clicks the extension toolbar icon
chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  
  // Send the message to content script
  chrome.tabs.sendMessage(tabId, { action: "toggle_decidio." });

  // Toggle the icon image for this specific tab
  if (!activeTabs[tabId]) {
    activeTabs[tabId] = true;
    
    // Switch to active logo (Using the correct object format)
    chrome.action.setIcon({
      tabId: tabId,
      path: {
        "16": "active_logo.png", // It's best practice to define sizes, 
        "48": "active_logo.png", // but even {"128": "active_logo.png"} works
        "128": "active_logo.png"
      }
    });
  } else {
    activeTabs[tabId] = false;
    
    // Switch back to default logo
    chrome.action.setIcon({
      tabId: tabId,
      path: {
        "16": "default_logo.png",
        "48": "default_logo.png",
        "128": "default_logo.png"
      }
    });
  }
});

// Clean up memory when the user closes a tab
chrome.tabs.onRemoved.addListener((tabId) => {
  delete activeTabs[tabId];
});

// Reset state if the tab reloads or navigates to a new URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    delete activeTabs[tabId];
    // Chrome automatically resets the icon to the manifest default 
    // when a page refreshes/navigates.
  }
});