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
    
    // Switch to active logo
    chrome.action.setIcon({
      path: "active_logo.png",
      tabId: tabId
    });
  } else {
    activeTabs[tabId] = false;
    
    // Switch back to default logo
    chrome.action.setIcon({
      path: "default_logo.png",
      tabId: tabId
    });
  }
});

// Clean up memory when the user closes a tab
chrome.tabs.onRemoved.addListener((tabId) => {
  delete activeTabs[tabId];
});