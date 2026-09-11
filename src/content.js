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
  // TEMPORARY DIAGNOSTIC — remove once the reported error is identified.
  // Surfaces uncaught errors from this isolated world with a greppable tag, so
  // the file/line/message can be read off directly instead of expanding a
  // collapsed "anonymous function" stack frame.
  window.addEventListener('error', (e) => {
    console.error('[decidio] uncaught:', e.message,
                  '@', e.filename + ':' + e.lineno + ':' + e.colno,
                  e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[decidio] unhandled rejection:',
                  e.reason && (e.reason.stack || e.reason.message || e.reason));
  });

  // Guard against redundant script injections on the same web page
  if (window.decidioContentScriptInjected) return;

  // Initialize content picker instance on global scope for cross-script access
  window.decidioPickerInstance = new DecidioContentPicker();

  // Set AFTER the construction above, not before it. This flag makes every
  // later injection bail out at the guard, so setting it first meant a single
  // failed construction left the tab permanently dead: the flag said "already
  // injected", the instance and listeners below did not exist, and a corrected
  // re-injection would return early rather than retry. Now a throw leaves the
  // flag unset and the next injection gets a clean attempt.
  window.decidioContentScriptInjected = true;

  /**
   * Whether this content script can still reach its extension.
   *
   * Reloading or updating an extension ORPHANS the content scripts already
   * injected into open tabs: the old code keeps running in the page, but its
   * connection back to the extension is severed, and from that moment every
   * chrome.* call throws "Extension context invalidated". Nothing in a rebuilt
   * source file can affect those tabs — only reloading the page can — so the
   * errors persist through fixes and look like the fix did not work.
   *
   * chrome.runtime.id becomes undefined at exactly that moment, which is the
   * one cheap way to check BEFORE calling and fail quietly instead of throwing.
   */
  function extensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;   // accessing chrome.runtime itself throws once orphaned
    }
  }

  /**
   * Synchronizes host page UI elements (sidebar and floating button) with active extension state.
   * 
   * @param {boolean} isOn - Whether the extension is currently toggled on.
   */
  function setExtensionState(isOn) {
    const extensionRoot = document.getElementById('decidio-extension-root');
    const toggleBtn = document.getElementById('decidio-toggle-btn');

    if (isOn) {
      // The "d." exists so there is something to click while the panel is
      // closed — but it hides itself the moment the panel is open, so its
      // wordmark and the panel's own are never on screen together.
      if (!toggleBtn) createFloatingToggleButton();
      if (!extensionRoot) activateExtensionUI();
      syncFloatingToggleVisibility();
    } else {
      deactivateExtensionUI();
      removeFloatingToggleButton();
      // Optional call: deactivateExtensionUI() above already guards this same
      // instance, and this copy did not — so on any page where construction
      // failed, every OFF path threw "cannot read properties of undefined
      // (reading 'stop')" from here instead of just tidying up.
      window.decidioPickerInstance?.stop(); // Abort active element picking sessions
    }
  }

  /* --------------------------------------------------------------------------
     BACKGROUND & RUNTIME MESSAGE HANDLERS
     -------------------------------------------------------------------------- */

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // Apply the state background.js already decided and stored, rather than
    // toggling again here. background.js flips isExtensionActive and writes it
    // BEFORE sending this message, so re-toggling made the two flip twice per
    // click and cancel out. This side only mirrors the stored value now.
    if (request.action === "TOGGLE_DECIDIO_EXTENSION") {
      chrome.storage.local.get({ isExtensionActive: false }, (result) => {
        if (chrome.runtime.lastError || !result) return;
        setExtensionState(result.isExtensionActive);
        sendResponse({ status: "toggled", state: result.isExtensionActive });
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
      chrome.storage.local.set({ isExtensionActive: false });
      setExtensionState(false);
      sendResponse({ status: "deactivated" });
    }

    // Launch interactive DOM element/product picker
    if (request.action === "START_DECIDIO_PICKER") {
      const mode = request.mode || 'single';
      window.decidioPickerInstance?.start(mode);
      sendResponse({ status: "picker_started" });
    }

    // Halt active DOM picking session
    if (request.action === "STOP_DECIDIO_PICKER") {
      window.decidioPickerInstance?.stop();
      sendResponse({ status: "picker_stopped" });
    }

    return true;
  });

  /* --------------------------------------------------------------------------
     INITIALIZATION & MULTI-TAB SYNCING
     -------------------------------------------------------------------------- */

  // On script load/page mount, restore existing user session state from storage
  if (extensionAlive()) {
    chrome.storage.local.get({ isExtensionActive: false, savedProducts: [] }, (result) => {
      // The context can still die between the call and this callback, in which
      // case `result` is undefined and touching it throws from inside here.
      if (chrome.runtime.lastError || !result) return;

      if (result.isExtensionActive) {
        setExtensionState(true);
      }
      // `|| []` because storage defaults only fill in MISSING keys — a key
      // explicitly holding null comes back as null, and .length throws on it.
      updateFloatingToggleBadge((result.savedProducts || []).length);
    });
  }

  // Listen for storage changes to mirror state and product data across open browser tabs
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !extensionAlive()) return;

    // Synchronize UI ON/OFF visibility when changed in another tab or background
    if (changes.isExtensionActive) {
      setExtensionState(changes.isExtensionActive.newValue);
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
