// The content script will tell us what state it is in.

// Listen for when the user clicks the extension toolbar icon
chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  
  // Send the message to content script
  chrome.tabs.sendMessage(tabId, { action: "toggle_decidio." }, (response) => {
    
    // If the content script didn't respond
    if (chrome.runtime.lastError || !response) {
      console.warn("decidio.: Content script not ready on this tab.");
      return; 
    }

    // Update the icon based on the exact state returned by the content script
    if (response.nextState === true) {
      chrome.action.setIcon({
        tabId: tabId,
        path: {
          "16": "active_logo.png", 
          "48": "active_logo.png",
          "128": "active_logo.png"
        }
      });
    } else {
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
});