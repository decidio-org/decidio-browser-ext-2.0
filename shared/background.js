// Starts the overlay
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_OVERLAY" });
});
// Log a message to know what is going on
console.log("Decidio Background Service Worker is active.");