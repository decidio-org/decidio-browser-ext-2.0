/* ==========================================================================
   MAIN CONTENT SCRIPT
   ========================================================================== */
/**
 * This file handles communication between this file and background
 */
(function () {
  if (window.decidioContentScriptInjected) return;
  window.decidioContentScriptInjected = true;

  window.decidioPickerInstance = new DecidioContentPicker();

  // Helper to sync UI visibility based on global state
  function setExtensionState(isOn) {
    const extensionRoot = document.getElementById('decidio-extension-root');
    const toggleBtn = document.getElementById('decidio-toggle-btn');

    if (isOn) {
      if (!toggleBtn) createFloatingToggleButton();
      if (!extensionRoot) activateExtensionUI();
    } else {
      deactivateExtensionUI();
      removeFloatingToggleButton();
      window.decidioPickerInstance.stop();
    }
  }

  // Handle incoming messages
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TOGGLE_DECIDIO_EXTENSION") {
      chrome.storage.local.get({ isExtensionOn: false }, (result) => {
        const newState = !result.isExtensionOn;
        chrome.storage.local.set({ isExtensionOn: newState });
        setExtensionState(newState);
        sendResponse({ status: "toggled", state: newState });
      });
      return true;
    }

    if (request.action === "SYNC_EXTENSION_STATE") {
      setExtensionState(request.isOn);
      sendResponse({ status: "synced" });
    }

    if (request.action === "DEACTIVATE_DECIDIO_EXTENSION") {
      chrome.storage.local.set({ isExtensionOn: false });
      setExtensionState(false);
      sendResponse({ status: "deactivated" });
    }

    if (request.action === "START_DECIDIO_PICKER") {
      const mode = request.mode || 'single';
      window.decidioPickerInstance.start(mode);
      sendResponse({ status: "picker_started" });
    }

    if (request.action === "STOP_DECIDIO_PICKER") {
      window.decidioPickerInstance.stop();
      sendResponse({ status: "picker_stopped" });
    }

    return true;
  });

  // Run when tab loads or script injects
  chrome.storage.local.get({ isExtensionOn: false, savedProducts: [] }, (result) => {
    if (result.isExtensionOn) {
      setExtensionState(true);
    }
    updateFloatingToggleBadge(result.savedProducts.length);
  });

  // MULTI-TAB SYNCING
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    // Sync UI ON/OFF state across tabs
    if (changes.isExtensionOn) {
      setExtensionState(changes.isExtensionOn.newValue);
    }

    // Sync saved products across tabs
    if (changes.savedProducts) {
      const updatedProducts = changes.savedProducts.newValue || [];
      updateFloatingToggleBadge(updatedProducts.length);

      // Call UI re-render function if ui.js is listening or active
      if (typeof window.renderCollectedProducts === 'function') {
        window.renderCollectedProducts(updatedProducts);
      }
    }
  });

  window.addEventListener('message', (event) => {
  if (event.data?.action === 'DECIDIO_MINIMIZE_SIDEBAR') {
    minimizeSidebar();
  }
  if (event.data?.action === 'DECIDIO_RESTORE_SIDEBAR') {
    restoreSidebar();
  }
});
})();