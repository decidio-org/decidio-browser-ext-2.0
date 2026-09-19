/* ==========================================================================
   UI COMPONENTS
   ========================================================================== */

/**
 * Creates and injects the floating action button into the document body.
 * Handles styling, hover interactions, click triggers, and initial badge updates.
 */
/**
 * Registers the Decidio faces on the HOST page, once.
 *
 * @font-face declared inside a shadow root is ignored by the CSS spec — font
 * loading is document-scoped — so the picker's own <style> cannot bring these
 * in on its own, and anything in the shadow DOM asking for "SFProDisplay"
 * would silently fall back to a system face. Injecting here makes the faces
 * available to both the shadow UI and the floating button.
 *
 * The files are listed in web_accessible_resources; without that the browser
 * blocks the fetch and the fallback kicks in just as quietly.
 */
function ensureDecidioFonts() {
  if (document.getElementById('decidio-font-face')) return;

  const url = (file) => chrome.runtime.getURL('fonts/' + file);
  const style = document.createElement('style');
  style.id = 'decidio-font-face';
  style.textContent = `
    @font-face {
      font-family: "SFProDisplay";
      src: url("${url('SFProDisplay-Regular.woff2')}") format("woff2");
      font-weight: 400; font-style: normal; font-display: swap;
    }
    @font-face {
      font-family: "SFProDisplay";
      src: url("${url('SFProDisplay-Medium.woff2')}") format("woff2");
      font-weight: 500; font-style: normal; font-display: swap;
    }
    @font-face {
      font-family: "SFProDisplay";
      src: url("${url('SFProDisplay-Semibold.woff2')}") format("woff2");
      font-weight: 600; font-style: normal; font-display: swap;
    }
    @font-face {
      font-family: "SFProDisplay";
      src: url("${url('SFProDisplay-Heavy.woff2')}") format("woff2");
      font-weight: 800; font-style: normal; font-display: swap;
    }
    @font-face {
      font-family: "NHaasGroteskDSStd";
      src: url("${url('NHaasGroteskDSStd-65Md.woff2')}") format("woff2");
      font-weight: 500; font-style: normal; font-display: swap;
    }
    @font-face {
      font-family: "NHaasGroteskDSStd";
      src: url("${url('NHaasGroteskDSStd-75Bd.woff2')}") format("woff2");
      font-weight: 700; font-style: normal; font-display: swap;
    }
    @font-face {
      font-family: "NHaasGroteskDSStd";
      src: url("${url('NHaasGroteskDSStd-95Blk.woff2')}") format("woff2");
      font-weight: 900; font-style: normal; font-display: swap;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Shows the floating "d." only while the panel is NOT on screen.
 *
 * Both carry the decidio wordmark, so with the panel open they read as two
 * logos stacked in the same corner. The button's whole job is to be something
 * to click when there is no panel, so it steps aside once there is one.
 */
function syncFloatingToggleVisibility() {
  const toggleBtn = document.getElementById('decidio-toggle-btn');
  if (!toggleBtn) return;

  const iframe = document.getElementById('decidio-main-frame');
  const panelOnScreen = Boolean(iframe) && iframe.style.right === '0px';

  toggleBtn.style.opacity = panelOnScreen ? '0' : '1';
  toggleBtn.style.pointerEvents = panelOnScreen ? 'none' : 'auto';
}

function createFloatingToggleButton() {
  // Prevent duplicate button creation if it already exists in the DOM
  if (document.getElementById('decidio-toggle-btn')) return;

  ensureDecidioFonts();

  // Create container element and populate logo/label
  const toggleBtn = document.createElement('div');
  toggleBtn.id = 'decidio-toggle-btn';
  toggleBtn.innerHTML = `d<span style="color: #476DA7;">.</span>`;   // Decidio Blue
  
  // Apply inline styles to fix positioning, backdrop blur, and layering
  toggleBtn.style.cssText = `
    position: fixed;
    top: 20px;
    right: 24px;
    width: 56px;
    height: 56px;
    /* Solid black, square, no blur or outline — the grey frosted plate was
       chrome the app does not use anywhere. */
    background-color: #000000;
    border: none;
    border-radius: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-family: "NHaasGroteskDSStd", Arial, sans-serif;
    font-size: 26px;
    font-weight: 900;
    cursor: pointer;
    z-index: 2147483647; /* Maximum z-index to ensure it sits above host page elements */
    user-select: none;
    transition: transform 0.2s ease, opacity 0.25s ease;
  `;

  // Hover animations
  toggleBtn.addEventListener('mouseenter', () => {
    toggleBtn.style.transform = 'scale(1.05)';
  });
  toggleBtn.addEventListener('mouseleave', () => {
    toggleBtn.style.transform = 'scale(1)';
  });

  // Toggle extension sidebar visibility on click
  toggleBtn.addEventListener('click', () => {
    const extensionRoot = document.getElementById('decidio-extension-root');
    const iframe = document.getElementById('decidio-main-frame');

    // Nothing mounted yet — build it.
    if (!extensionRoot || !iframe) {
      activateExtensionUI();
      return;
    }

    // Slide, do not tear down. This used to call deactivateExtensionUI(), which
    // REMOVES the root 300ms later, so every re-open rebuilt the iframe from
    // scratch: index.html reloaded and everything living in the panel (the auth
    // form's contents, the selected list, collected tiles) was thrown away on
    // each toggle. Clicking twice inside that 300ms window also let the pending
    // removal fire after the panel had been re-activated, leaving it gone.
    // Minimising keeps the iframe alive, which is what this button is described
    // as doing — toggling the panel in and out, not turning the extension off.
    // The toolbar icon remains the on/off control.
    const isHidden = iframe.style.right !== '0px';
    if (isHidden) {
      restoreSidebar();
    } else {
      minimizeSidebar();
    }
    syncFloatingToggleVisibility();
  });

  // Attach to host page DOM and fetch initial state
  document.body.appendChild(toggleBtn);
  updateFloatingToggleBadge();
}

/**
 * Removes the floating toggle button from the DOM.
 */
function removeFloatingToggleButton() {
  const toggleBtn = document.getElementById('decidio-toggle-btn');
  if (toggleBtn) {
    toggleBtn.remove();
  }
}

/**
 * Builds and injects the sidebar UI container and iframe into the host page.
 * Uses a slide-in animation via CSS transitions.
 */
function activateExtensionUI() {
  // Prevent duplicate extension root containers
  if (document.getElementById('decidio-extension-root')) return;

  // Create isolated container wrapper for the sidebar
  const extensionRoot = document.createElement('div');
  extensionRoot.id = 'decidio-extension-root';
  Object.assign(extensionRoot.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    width: '430px',
    height: '100vh',
    zIndex: '2147483646',
    pointerEvents: 'none' // Allows clicks to pass through empty regions of the container
  });

  // Main UI iframe pointing to extension's index.html
  const iframe = document.createElement('iframe');
  iframe.id = 'decidio-main-frame';
  iframe.src = chrome.runtime.getURL('index.html'); 
  Object.assign(iframe.style, {
    position: 'absolute',
    top: '0',
    right: '-450px', // Initial off-screen position for slide-in animation
    width: '100%',
    height: '100%',
    border: 'none',
    backgroundColor: 'transparent',
    // Clipped to the panel's own shape, which the panel reports once it has
    // laid out (see DECIDIO_PANEL_RECT in content.js). Without the clip the
    // transparent margins of this 430px column would keep eating clicks meant
    // for the page. This first value is the workspace
    // panel's default box, so nothing flashes before the report arrives.
    clipPath: 'inset(88px 24px calc(25vh - 7px) 26px round 16px)',
    transition: 'right 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
    pointerEvents: 'auto' // Re-enable interaction inside the iframe
  });

  // Shadow that lifts the panel off the page. It cannot be the iframe's own:
  // the iframe is clip-path'd to the panel, and a clip removes anything drawn
  // outside it, shadow included. So it is a separate layer underneath, in a
  // frame that slides exactly as the iframe does, sized by the same panel
  // report that sets the clip (content.js).
  const shadowFrame = document.createElement('div');
  shadowFrame.id = 'decidio-panel-shadow-frame';
  Object.assign(shadowFrame.style, {
    position: 'absolute',
    top: '0',
    right: iframe.style.right,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    transition: iframe.style.transition
  });
  const shadow = document.createElement('div');
  shadow.id = 'decidio-panel-shadow';
  Object.assign(shadow.style, {
    position: 'absolute',
    opacity: '0',                // shown once the panel reports its box
    transition: 'opacity 0.2s ease',
    boxShadow: '0 32px 80px rgba(0, 0, 0, 0.30), 0 10px 28px rgba(0, 0, 0, 0.18)'
  });
  shadowFrame.appendChild(shadow);

  // Every slide in or out sets iframe.style.right from several places in
  // this file; mirroring the attribute keeps the shadow in step without
  // having to remember it at each of them.
  new MutationObserver(() => {
    shadowFrame.style.right = iframe.style.right;
  }).observe(iframe, { attributes: true, attributeFilter: ['style'] });

  extensionRoot.appendChild(shadowFrame);
  extensionRoot.appendChild(iframe);
  document.body.appendChild(extensionRoot);

  // Trigger smooth slide-in animation on next paint frame
  requestAnimationFrame(() => {
    iframe.style.right = '0px';
    syncFloatingToggleVisibility();
  });
}

/**
 * Deactivates the extension UI with a slide-out transition and cleans up DOM elements.
 * Also stops active helper tools (e.g., element pickers).
 */
function deactivateExtensionUI() {
  // Clean up element picker tool instance if active on window
  if (window.decidioPickerInstance) {
    window.decidioPickerInstance.stop();
  }

  const extensionRoot = document.getElementById('decidio-extension-root');
  const iframe = document.getElementById('decidio-main-frame');

  if (extensionRoot && iframe) {
    // Disable interactions during exit transition
    iframe.style.pointerEvents = 'none';
    iframe.style.right = '-450px'; // Slide out off-screen

    // Wait for slide-out CSS transition (300ms) to complete before DOM removal
    setTimeout(() => {
      if (extensionRoot) {
        extensionRoot.remove();
      }
    }, 300);
  } else if (extensionRoot) {
    // Fallback immediate cleanup if iframe isn't present
    extensionRoot.remove();
  }
}

/**
 * Updates the item count badge displayed on the toggle button.
 * 
 * @param {number} [countOverride] - Optional manual count override. If omitted, reads from chrome.storage.local.
 */
function updateFloatingToggleBadge(countOverride) {
  // Support both ID naming conventions
  const toggleBtn = document.getElementById('decidio-toggle-btn') || document.getElementById('decidioToggle');
  if (!toggleBtn) return;

  if (typeof countOverride === 'number') {
    renderBadgeCount(toggleBtn, countOverride);
  } else {
    // Fetch saved products count asynchronously from Chrome Storage
    chrome.storage.local.get({ savedProducts: [] }, (result) => {
      renderBadgeCount(toggleBtn, result.savedProducts.length);
    });
  }
}

/**
 * Temporarily slides the sidebar iframe out of view while keeping the root container intact.
 */
function minimizeSidebar() {
  const iframe = document.getElementById('decidio-main-frame');
  if (iframe) {
    iframe.style.right = '-450px';
  }
  // The panel just left, so the "d." becomes the way back to it.
  syncFloatingToggleVisibility();
}

/**
 * Restores the minimized sidebar iframe back into view.
 */
function restoreSidebar() {
  const iframe = document.getElementById('decidio-main-frame');
  if (iframe) {
    iframe.style.right = '0px';
  }
  syncFloatingToggleVisibility();
}