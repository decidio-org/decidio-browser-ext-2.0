/* ==========================================================================
   MAIN CONTENT SCRIPT
   ========================================================================== */
/**
 * Main Content Script
 * 
 * Handles state management, UI mounting, multi-tab synchronization,
 * and message passing between the background worker and injected UI/Picker.
 */
(function () {
  // Guard against redundant script injections on the same web page
  if (window.decidioContentScriptInjected) return;
  window.decidioContentScriptInjected = true;

  // Initialize content picker instance on global scope for cross-script access
  window.decidioPickerInstance = new DecidioContentPicker();

  /**
   * Synchronizes host page UI elements (sidebar and floating button) with active extension state.
   * 
   * @param {boolean} isOn - Whether the extension is currently toggled on.
   */
  function setExtensionState(isOn) {
    const extensionRoot = document.getElementById('decidio-extension-root');
    const toggleBtn = document.getElementById('decidio-toggle-btn');

    if (isOn) {
      if (!toggleBtn) createFloatingToggleButton();
      if (!extensionRoot) activateExtensionUI();
    } else {
      deactivateExtensionUI();
      removeFloatingToggleButton();
      window.decidioPickerInstance.stop(); // Abort active element picking sessions
    }
  }

  /* --------------------------------------------------------------------------
     BACKGROUND & RUNTIME MESSAGE HANDLERS
     -------------------------------------------------------------------------- */

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // Toggle extension active state on icon click or shortcut
    if (request.action === "TOGGLE_DECIDIO_EXTENSION") {
      chrome.storage.local.get({ isExtensionOn: false }, (result) => {
        const newState = !result.isExtensionOn;
        chrome.storage.local.set({ isExtensionOn: newState });
        setExtensionState(newState);
        sendResponse({ status: "toggled", state: newState });
      });
      return true; // Keep message channel open for async response
    }

    // Explicitly sync current UI state requested by caller
    if (request.action === "SYNC_EXTENSION_STATE") {
      setExtensionState(request.isOn);
      sendResponse({ status: "synced" });
    }

    // Turn off extension UI and clean up DOM injections
    if (request.action === "DEACTIVATE_DECIDIO_EXTENSION") {
      chrome.storage.local.set({ isExtensionOn: false });
      setExtensionState(false);
      sendResponse({ status: "deactivated" });
    }

    // Launch interactive DOM element/product picker
    if (request.action === "START_DECIDIO_PICKER") {
      const mode = request.mode || 'single';
      window.decidioPickerInstance.start(mode);
      sendResponse({ status: "picker_started" });
    }

    // Halt active DOM picking session
    if (request.action === "STOP_DECIDIO_PICKER") {
      window.decidioPickerInstance.stop();
      sendResponse({ status: "picker_stopped" });
    }

    return true;
  });

  /* --------------------------------------------------------------------------
     INITIALIZATION & MULTI-TAB SYNCING
     -------------------------------------------------------------------------- */

  // On script load/page mount, restore existing user session state from storage
  chrome.storage.local.get({ isExtensionOn: false, savedProducts: [] }, (result) => {
    if (result.isExtensionOn) {
      setExtensionState(true);
    }
    updateFloatingToggleBadge(result.savedProducts.length);
  });

  // Listen for storage changes to mirror state and product data across open browser tabs
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    // Synchronize UI ON/OFF visibility when changed in another tab or background
    if (changes.isExtensionOn) {
      setExtensionState(changes.isExtensionOn.newValue);
    }

    // Update floating badge count and trigger UI refresh when products collection updates
    if (changes.savedProducts) {
      const updatedProducts = changes.savedProducts.newValue || [];
      updateFloatingToggleBadge(updatedProducts.length);

      // Invoke global re-render function if ui.js script is attached
      if (typeof window.renderCollectedProducts === 'function') {
        window.renderCollectedProducts(updatedProducts);
      }
    }
  });

  /* --------------------------------------------------------------------------
     POSTMESSAGE LISTENER (IFRAME TO HOST PAGE COMMUNICATION)
     -------------------------------------------------------------------------- */

  // Listen for layout commands dispatched from embedded iframe UI
  window.addEventListener('message', (event) => {
    if (event.data?.action === 'DECIDIO_MINIMIZE_SIDEBAR') {
      minimizeSidebar();
    }
    if (event.data?.action === 'DECIDIO_RESTORE_SIDEBAR') {
      restoreSidebar();
    }
  });
})();