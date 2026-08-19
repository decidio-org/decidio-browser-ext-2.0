/* ==========================================================================
   UI COMPONENTS
   ========================================================================== */

/**
 * Creates and injects the floating action button into the document body.
 * Handles styling, hover interactions, click triggers, and initial badge updates.
 */
function createFloatingToggleButton() {
  // Prevent duplicate button creation if it already exists in the DOM
  if (document.getElementById('decidio-toggle-btn')) return;

  // Create container element and populate logo/label
  const toggleBtn = document.createElement('div');
  toggleBtn.id = 'decidio-toggle-btn';
  toggleBtn.innerHTML = `d<span style="color: #3b82f6;">.</span>`;
  
  // Apply inline styles to fix positioning, backdrop blur, and layering
  toggleBtn.style.cssText = `
    position: fixed;
    top: 20px;
    right: 24px;
    width: 56px;
    height: 56px;
    background-color: rgba(45, 46, 48, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(197, 191, 191, 0.2);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-family: Arial, sans-serif;
    font-size: 26px;
    font-weight: 800;
    cursor: pointer;
    z-index: 2147483647; /* Maximum z-index to ensure it sits above host page elements */
    user-select: none;
    transition: transform 0.2s ease;
  `;

  // Hover animations
  toggleBtn.addEventListener('mouseenter', () => {
    toggleBtn.style.transform = 'scale(1.05)';
  });
  toggleBtn.addEventListener('mouseleave', () => {
    toggleBtn.style.transform = 'scale(1)';
  });

  // Toggle extension sidebar state on click
  toggleBtn.addEventListener('click', () => {
    const extensionRoot = document.getElementById('decidio-extension-root');
    if (extensionRoot) {
      deactivateExtensionUI();
    } else {
      activateExtensionUI();
    }
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
    transition: 'right 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
    pointerEvents: 'auto' // Re-enable interaction inside the iframe
  });

  extensionRoot.appendChild(iframe);
  document.body.appendChild(extensionRoot);

  // Trigger smooth slide-in animation on next paint frame
  requestAnimationFrame(() => {
    iframe.style.right = '0px';
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
}

/**
 * Restores the minimized sidebar iframe back into view.
 */
function restoreSidebar() {
  const iframe = document.getElementById('decidio-main-frame');
  if (iframe) {
    iframe.style.right = '0px';
  }
}