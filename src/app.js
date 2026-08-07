/**
 * app.js
 * 
 * Manages the iframe UI: sidebar panel visibility, tile rendering, tile removal,
 * dropdowns, mode toggles, and triggering the picker on the active tab.
 */

document.addEventListener('DOMContentLoaded', () => {

  const toggleAnchor = document.getElementById('decidioToggle');
  const sidebarPanel = document.getElementById('decidioSidebarPanel');
  const addProductBtn = document.getElementById('addProductBtn');
  const productsContainer = document.getElementById('products-container');
  const singleModeBtn = document.getElementById('modeSingleBtn');
  const multiModeBtn = document.getElementById('modeMultiBtn');
  const dropdowns = document.querySelectorAll('.list-dropdown-component');

  let currentSelectionMode = 'single';

  /* --------------------------------------------------------------------------
     SIDEBAR PANEL INITIALIZATION
     -------------------------------------------------------------------------- */

  if (sidebarPanel) {
    sidebarPanel.classList.remove('is-collapsed');
  }

  if (toggleAnchor && sidebarPanel) {
    toggleAnchor.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebarPanel.classList.toggle('is-collapsed');
    });
  }

  /* --------------------------------------------------------------------------
     STORAGE & TILE RENDERING
     -------------------------------------------------------------------------- */

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

  function syncUIFromStorageArray(savedProducts) {
    if (!productsContainer) return;

    const oldTiles = productsContainer.querySelectorAll('.collected-product-tile');
    oldTiles.forEach(tile => tile.remove());

    const reversedProducts = [...savedProducts].reverse();
    reversedProducts.forEach((prod) => {
      displaySelectedProduct(prod.imageUrl, prod.productUrl, prod.productTitle || "Product", productsContainer);
    });

    updateLogoBadge(savedProducts.length);
  }

  // Initial UI load from storage
  chrome.storage.local.get({ savedProducts: [] }, (result) => {
    syncUIFromStorageArray(result.savedProducts);
  });

  // Auto-sync UI whenever extension storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.savedProducts) {
      const updatedProductsList = changes.savedProducts.newValue || [];
      syncUIFromStorageArray(updatedProductsList);
    }
  });

  // Tile deletion handler
  if (productsContainer) {
    productsContainer.addEventListener('click', (event) => {
      const productTile = event.target.closest('.collected-product-tile');
      
      if (productTile) {
        const urlToRemove = productTile.getAttribute('data-product-url');
        productTile.remove();

        const remainingTiles = productsContainer.querySelectorAll('.collected-product-tile');
        remainingTiles.forEach((tile, index) => {
          tile.style.order = index + 1;
          const badge = tile.querySelector('.product-tile-number');
          if (badge) badge.textContent = String(index + 1).padStart(2, '0');
        });

        updateLogoBadge();

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
      setTimeout(() => { dropdown.classList.remove('is-closing'); }, 450); 
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

    document.addEventListener('click', () => {
      if (dropdown.classList.contains('is-active')) closeDropdown();
    });
  });

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

function displaySelectedProduct(imageUrl, productUrl, productTitle, container) {
  const existingTiles = container.querySelectorAll('.collected-product-tile').length;
  const itemNumber = String(existingTiles + 1).padStart(2, '0'); 

  const productTile = document.createElement('div');
  productTile.className = 'collected-product-tile';
  productTile.setAttribute('data-product-url', productUrl);
  
  // Scaled up tile width and height
  productTile.style.position = 'relative';
  productTile.style.width = '120px';
  productTile.style.height = '180px'; 
  productTile.style.display = 'flex';
  productTile.style.flexDirection = 'column';
  productTile.style.boxSizing = 'border-box';
  productTile.style.flexShrink = '0';

  const imgWrapper = document.createElement('div');
  imgWrapper.style.position = 'relative';
  imgWrapper.style.width = '120px';
  imgWrapper.style.height = '140px';
  imgWrapper.style.borderRadius = '8px';
  imgWrapper.style.overflow = 'hidden';
  imgWrapper.style.border = '1px solid rgba(255, 255, 255, 0.15)';
  imgWrapper.style.background = 'rgba(255, 255, 255, 0.08)';

  const imgPreview = document.createElement('img');
  imgPreview.src = imageUrl;
  imgPreview.style.width = '100%';
  imgPreview.style.height = '100%';
  imgPreview.style.objectFit = 'cover';
  imgPreview.style.display = 'block';

  const numberBadge = document.createElement('div');
  numberBadge.className = 'product-tile-number';
  numberBadge.textContent = itemNumber;
  
  numberBadge.style.position = 'absolute';
  numberBadge.style.bottom = '6px';
  numberBadge.style.right = '8px';
  numberBadge.style.color = '#ffffff';
  numberBadge.style.fontSize = '12px';
  numberBadge.style.fontWeight = 'bold';
  numberBadge.style.textShadow = '0px 1px 3px rgba(0, 0, 0, 0.8)'; 

  imgWrapper.appendChild(imgPreview);
  imgWrapper.appendChild(numberBadge);

  const titleLabel = document.createElement('div');
  titleLabel.className = 'product-tile-title';
  titleLabel.textContent = productTitle;
  titleLabel.style.width = '100%';
  titleLabel.style.fontSize = '13px';
  titleLabel.style.lineHeight = '1.2';
  titleLabel.style.color = '#e2e8f0';
  titleLabel.style.marginTop = '6px';
  titleLabel.style.textAlign = 'center';
  
  // Allows title to wrap up to 2 lines before truncating
  titleLabel.style.display = '-webkit-box';
  titleLabel.style['-webkit-line-clamp'] = '2';
  titleLabel.style['-webkit-box-orient'] = 'vertical';
  titleLabel.style.overflow = 'hidden';

  productTile.appendChild(imgWrapper);
  productTile.appendChild(titleLabel);
  
  const addBtn = document.getElementById('addProductBtn');
  if (addBtn) addBtn.style.order = '0'; 
  
  productTile.style.order = existingTiles + 1;
  container.appendChild(productTile);
}