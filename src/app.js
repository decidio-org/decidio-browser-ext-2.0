/**
 * app.js
 * 
 * Manages the iframe UI: sidebar panel visibility, tile rendering, tile removal,
 * dropdowns, mode toggles, and triggering the picker on the active tab.
 */

document.addEventListener('DOMContentLoaded', () => {

  // Primary UI control elements & state references
  const toggleAnchor = document.getElementById('decidioToggle');
  const sidebarPanel = document.getElementById('decidioSidebarPanel');
  const addProductBtn = document.getElementById('addProductBtn');
  const productsContainer = document.getElementById('products-container');
  const singleModeBtn = document.getElementById('modeSingleBtn');
  const multiModeBtn = document.getElementById('modeMultiBtn');
  const dropdowns = document.querySelectorAll('.list-dropdown-component');

  // Selection mode state ('single' vs 'multi') sent to the content script picker
  let currentSelectionMode = 'single';

  /* --------------------------------------------------------------------------
     SIDEBAR PANEL INITIALIZATION
     -------------------------------------------------------------------------- */

  // Ensure sidebar is expanded by default on initialization
  if (sidebarPanel) {
    sidebarPanel.classList.remove('is-collapsed');
  }

  // Toggle sidebar visibility when clicking the toggle anchor
  if (toggleAnchor && sidebarPanel) {
    toggleAnchor.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebarPanel.classList.toggle('is-collapsed');
    });
  }

  /* --------------------------------------------------------------------------
     STORAGE & TILE RENDERING
     -------------------------------------------------------------------------- */

  /**
   * Updates the count badge on the logo toggle icon based on collected items.
   * @param {number} [countOverride] - Explicit product count override.
   */
  function updateLogoBadge(countOverride) {
    if (!toggleAnchor) return;

    let totalProducts = 0;
    if (typeof countOverride === 'number') {
      totalProducts = countOverride;
    } else if (productsContainer) {
      totalProducts = productsContainer.querySelectorAll('.collected-product-tile').length;
    }

    renderBadgeCount(toggleAnchor, totalProducts);
  }

  /**
   * Clears existing DOM tiles and re-renders the complete list from storage data.
   * @param {Array<Object>} savedProducts - Array of product objects from chrome.storage.
   */
  function syncUIFromStorageArray(savedProducts) {
    if (!productsContainer) return;

    // Flush existing DOM elements before repopulating
    const oldTiles = productsContainer.querySelectorAll('.collected-product-tile');
    oldTiles.forEach(tile => tile.remove());

    // Reverse array so newer additions preserve visually correct stack order
    const reversedProducts = [...savedProducts].reverse();
    reversedProducts.forEach((prod) => {
      displaySelectedProduct(prod.imageUrl, prod.productUrl, prod.productTitle || "Product", productsContainer);
    });

    updateLogoBadge(savedProducts.length);
  }

  // Fetch initial saved products from local storage on load
  chrome.storage.local.get({ savedProducts: [] }, (result) => {
    syncUIFromStorageArray(result.savedProducts);
  });

  // Real-time synchronization across instances when extension storage updates
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.savedProducts) {
      const updatedProductsList = changes.savedProducts.newValue || [];
      syncUIFromStorageArray(updatedProductsList);
    }
  });

  // Handle tile deletion via event delegation on the product container
  if (productsContainer) {
    productsContainer.addEventListener('click', (event) => {
      const productTile = event.target.closest('.collected-product-tile');
      
      if (productTile) {
        const urlToRemove = productTile.getAttribute('data-product-url');
        productTile.remove(); // Immediate DOM removal for snappy UI responsiveness

        // Re-index remaining tiles in the DOM to update flex ordering and numbered badges
        const remainingTiles = productsContainer.querySelectorAll('.collected-product-tile');
        remainingTiles.forEach((tile, index) => {
          tile.style.order = index + 1;
          const badge = tile.querySelector('.product-tile-number');
          if (badge) badge.textContent = String(index + 1).padStart(2, '0');
        });

        updateLogoBadge();

        // Persist deletion changes back to Chrome extension local storage
        chrome.storage.local.get({ savedProducts: [] }, (result) => {
          const updatedList = result.savedProducts.filter(p => p.productUrl !== urlToRemove);
          chrome.storage.local.set({ savedProducts: updatedList });
        });
      }
    });
  }

  /* --------------------------------------------------------------------------
     UI COMPONENTS (DROPDOWNS & MODE SWITCHER)
     -------------------------------------------------------------------------- */

  // Initialize custom dropdown behavior and option selection
  dropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('.dropdown-trigger');
    const options = dropdown.querySelectorAll('.dropdown-option');
    const display = dropdown.querySelector('.selected-value-display');

    if (!trigger || !display) return;

    function openDropdown() {
      dropdown.classList.remove('is-closing');
      dropdown.classList.add('is-active');
    }

    function closeDropdown() {
      dropdown.classList.add('is-closing');
      dropdown.classList.remove('is-active');
      setTimeout(() => { dropdown.classList.remove('is-closing'); }, 450); // Syncs with CSS closing animation duration
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.contains('is-active') ? closeDropdown() : openDropdown();
    });

    options.forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = option.getAttribute('data-value');
        display.innerText = value === 'create-new' ? "Create List +" : option.innerText;
        closeDropdown();
      });
    });

    // Close open dropdown when clicking outside
    document.addEventListener('click', () => {
      if (dropdown.classList.contains('is-active')) closeDropdown();
    });
  });

  // Toggle selection modes (single element vs. batch multi-selection)
  if (singleModeBtn && multiModeBtn) {
    singleModeBtn.addEventListener('click', () => {
      currentSelectionMode = 'single';
      singleModeBtn.classList.add('active');
      multiModeBtn.classList.remove('active');
    });

    multiModeBtn.addEventListener('click', () => {
      currentSelectionMode = 'multi';
      multiModeBtn.classList.add('active');
      singleModeBtn.classList.remove('active');
    });
  }

  /* --------------------------------------------------------------------------
     TRIGGER PICKER IN ACTIVE TAB & MESSAGE LISTENERS
     -------------------------------------------------------------------------- */

  // Send payload to content script on active tab when user clicks "Add Product"
  if (addProductBtn) {
    addProductBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { 
          action: "START_DECIDIO_PICKER",
          mode: currentSelectionMode 
        });
      }
    });
  }

  // Listen for messages from background/content scripts to restore sidebar state
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "RENDER_PICKED_PRODUCT" || message.action === "DECIDIO_PICKER_CANCELLED") {
      if (sidebarPanel) sidebarPanel.classList.remove('is-collapsed');
      if (toggleAnchor) toggleAnchor.style.display = '';
    }
  });

});

/* --------------------------------------------------------------------------
   DOM TILE RENDER HELPER
   -------------------------------------------------------------------------- */

/**
 * Dynamically constructs and injects a product tile DOM node into the panel container.
 * Uses inline styling for isolated layout properties to complement style.css.
 * 
 * @param {string} imageUrl - Source URL for the product image thumbnail.
 * @param {string} productUrl - Unique target product page link.
 * @param {string} productTitle - Display title for the product card.
 * @param {HTMLElement} container - DOM wrapper element holding the product list.
 */
function displaySelectedProduct(imageUrl, productUrl, productTitle, container) {
  const existingTiles = container.querySelectorAll('.collected-product-tile').length;
  const itemNumber = String(existingTiles + 1).padStart(2, '0'); 

  // Card Outer Container
  const productTile = document.createElement('div');
  productTile.className = 'collected-product-tile';
  productTile.setAttribute('data-product-url', productUrl);
  
  // Tile dimensions and flex layout styles
  productTile.style.position = 'relative';
  productTile.style.width = '120px';
  productTile.style.height = '180px'; 
  productTile.style.display = 'flex';
  productTile.style.flexDirection = 'column';
  productTile.style.boxSizing = 'border-box';
  productTile.style.flexShrink = '0';

  // Image Frame Wrapper
  const imgWrapper = document.createElement('div');
  imgWrapper.style.position = 'relative';
  imgWrapper.style.width = '120px';
  imgWrapper.style.height = '140px';
  imgWrapper.style.borderRadius = '8px';
  imgWrapper.style.overflow = 'hidden';
  imgWrapper.style.border = '1px solid rgba(255, 255, 255, 0.15)';
  imgWrapper.style.background = 'rgba(255, 255, 255, 0.08)';

  // Product Image Element
  const imgPreview = document.createElement('img');
  imgPreview.src = imageUrl;
  imgPreview.style.width = '100%';
  imgPreview.style.height = '100%';
  imgPreview.style.objectFit = 'cover';
  imgPreview.style.display = 'block';

  // Floating Index Number Badge (01, 02, etc.)
  const numberBadge = document.createElement('div');
  numberBadge.className = 'product-tile-number';
  numberBadge.textContent = itemNumber;
  
  numberBadge.style.position = 'absolute';
  numberBadge.style.bottom = '6px';
  numberBadge.style.right = '8px';
  numberBadge.style.color = '#ffffff';
  numberBadge.style.fontSize = '16px';
  numberBadge.style.fontWeight = 'bold';
  numberBadge.style.background = 'rgba(0, 0, 0, 0.65)';
  numberBadge.style.padding = '2px 6px';
  numberBadge.style.borderRadius = '4px';
  numberBadge.style.backdropFilter = 'blur(4px)';
  numberBadge.style.border = '1px solid rgba(255, 255, 255, 0.15)';

  imgWrapper.appendChild(imgPreview);
  imgWrapper.appendChild(numberBadge);

  // Product Title Label Frame
  const titleLabel = document.createElement('div');
  titleLabel.className = 'product-tile-title';
  titleLabel.textContent = productTitle;
  titleLabel.style.width = '100%';
  titleLabel.style.fontSize = '13px';
  titleLabel.style.lineHeight = '1.2';
  titleLabel.style.color = '#e2e8f0';
  titleLabel.style.marginTop = '6px';
  titleLabel.style.textAlign = 'center';
  
  // Multi-line clamping: Truncates to max 2 lines with an ellipsis
  titleLabel.style.minHeight = '2.6em'; 
  titleLabel.style.textOverflow = 'ellipsis';
  titleLabel.style.display = '-webkit-box';
  titleLabel.style['-webkit-line-clamp'] = '2';
  titleLabel.style['-webkit-box-orient'] = 'vertical';
  titleLabel.style.overflow = 'hidden';

  productTile.appendChild(imgWrapper);
  productTile.appendChild(titleLabel);
  
  // Keep the 'Add Product' button anchored at flex position 0
  const addBtn = document.getElementById('addProductBtn');
  if (addBtn) addBtn.style.order = '0'; 
  
  productTile.style.order = existingTiles + 1;
  container.appendChild(productTile);
}