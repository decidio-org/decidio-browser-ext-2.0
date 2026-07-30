/**
 * app.js
 * 
 * This script manages the extension's popup UI, including the sidebar panel, product collection tiles, number badge,
 * and interaction with the content script. 
 */
document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // DOM REFERENCES
    // ==========================================
    const toggleAnchor = document.getElementById('decidioToggle');
    const sidebarPanel = document.getElementById('decidioSidebarPanel');
    const addProductBtn = document.getElementById('addProductBtn');
    const productsContainer = document.getElementById('products-container');

    if (sidebarPanel) {
        sidebarPanel.classList.remove('is-collapsed');
    }

    if (toggleAnchor && sidebarPanel) {
        toggleAnchor.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebarPanel.classList.toggle('is-collapsed');
        });
    }

    // ==========================================
    //  LOGO BADGE FUNCTION
    // ==========================================
    function updateLogoBadge() {
        if (!productsContainer || !toggleAnchor) return;
        
        const totalProducts = productsContainer.querySelectorAll('.collected-product-tile').length;
        let badge = toggleAnchor.querySelector('.decidio-badge-count');
        
        if (totalProducts > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'decidio-badge-count';
                badge.style.cssText = `
                    position: absolute;
                    top: -10px;
                    right: -10px;
                    background-color: #B8363D;
                    color: #ffffff;
                    border-radius: 50%;
                    font-size: 13px;
                    font-weight: bold;
                    width: 22px;
                    height: 22px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
                    z-index: 10;
                `;
                
                if (window.getComputedStyle(toggleAnchor).position === 'static') {
                    toggleAnchor.style.position = 'relative';
                }
                toggleAnchor.appendChild(badge);
            }
            badge.textContent = totalProducts;
        } else if (badge) {
            badge.remove();
        }
    }

    // ==========================================
    //  UI REFRESH HELPER FUNCTION
    // ==========================================
    // This wipes the display container and rebuilds it using whatever is currently in storage.
    function syncUIFromStorageArray(savedProducts) {
        if (!productsContainer) return;
        
        const oldTiles = productsContainer.querySelectorAll('.collected-product-tile');
        oldTiles.forEach(tile => tile.remove());
        
        savedProducts.forEach((prod) => {
            // Pass prod.productTitle here
            displaySelectedProduct(prod.imageUrl, prod.productUrl, prod.productTitle || "Product", productsContainer);
        });
        
        updateLogoBadge();
    }

    // Load any existing saved products out of memory storage when sidebar renders
    chrome.storage.local.get({ savedProducts: [] }, (result) => {
        syncUIFromStorageArray(result.savedProducts);
    });

    // ==========================================
    //  CROSS-TAB STORAGE EVENT LISTENER
    // ==========================================
    // When a product is deleted (or added) 
    // from one tab, this updates the remaining tabs
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.savedProducts) {
            const updatedProductsList = changes.savedProducts.newValue || [];
            syncUIFromStorageArray(updatedProductsList);
        }
    });

    // ==========================================
    // WORKSPACE CUSTOM DROPDOWN LOGIC
    // ==========================================
    const dropdowns = document.querySelectorAll('.list-dropdown-component');
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

    // ==========================================
    // DECIDIO INTERACTION MODE PICKER
    // ==========================================
    if (addProductBtn) {
        addProductBtn.addEventListener('click', async () => {
            if (sidebarPanel) sidebarPanel.classList.add('is-collapsed');
            if (toggleAnchor) toggleAnchor.style.display = 'none'; 

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.tabs.sendMessage(tab.id, { action: "START_DECIDIO_PICKER" });
            }
        });
    }

    // Listen for messages BACK from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "RENDER_PICKED_PRODUCT") {
            if (sidebarPanel) sidebarPanel.classList.remove('is-collapsed');
            if (toggleAnchor) toggleAnchor.style.display = '';
        }
        else if (message.action === "DECIDIO_PICKER_CANCELLED") {
            if (sidebarPanel) sidebarPanel.classList.remove('is-collapsed');
            if (toggleAnchor) toggleAnchor.style.display = '';
        }
    });

    // ==========================================
    // PRODUCT DESELECT / REMOVAL LOGIC
    // ==========================================
    if (productsContainer) {
        productsContainer.addEventListener('click', (event) => {
            const productTile = event.target.closest('.collected-product-tile');
            
            if (productTile) {
                const urlToRemove = productTile.getAttribute('data-product-url');
                
                // Remove it from the current active DOM layout
                productTile.remove();
                
                // Keep UI Continuous
                const remainingTiles = productsContainer.querySelectorAll('.collected-product-tile');
                remainingTiles.forEach((tile, index) => {
                    tile.style.order = index + 1;
                    const badge = tile.querySelector('.product-tile-number');
                    if (badge) badge.textContent = String(index + 1).padStart(2, '0');
                });

                updateLogoBadge();

                // Clean out data from local storage. 
                // Saving this updates chrome.storage.local, which helps with cross-tab syncing
                chrome.storage.local.get({ savedProducts: [] }, (result) => {
                    const updatedList = result.savedProducts.filter(p => p.productUrl !== urlToRemove);
                    chrome.storage.local.set({ savedProducts: updatedList });
                });
            }
        });
    }
});

// Helper rendering utility function
function displaySelectedProduct(imageUrl, productUrl, productTitle, container) {
    const existingTiles = container.querySelectorAll('.collected-product-tile').length;
    const itemNumber = String(existingTiles + 1).padStart(2, '0'); 

    const productTile = document.createElement('div');
    productTile.className = 'collected-product-tile';
    productTile.setAttribute('data-product-url', productUrl);
    
    productTile.style.position = 'relative';
    productTile.style.width = '85px';
    // Leave space for the title text underneath
    productTile.style.height = '140px'; 
    productTile.style.display = 'flex';
    productTile.style.flexDirection = 'column';
    productTile.style.boxSizing = 'border-box';

    // Wrap the image in its own container
    const imgWrapper = document.createElement('div');
    imgWrapper.style.position = 'relative';
    imgWrapper.style.width = '85px';
    imgWrapper.style.height = '110px';
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

    // Create the text label container for the title underneath the wrapper
    const titleLabel = document.createElement('div');
    titleLabel.className = 'product-tile-title';
    titleLabel.textContent = productTitle;
    titleLabel.style.width = '100%';
    titleLabel.style.fontSize = '11px';
    titleLabel.style.color = '#e2e8f0';
    titleLabel.style.marginTop = '4px';
    titleLabel.style.textAlign = 'center';
    titleLabel.style.whiteSpace = 'nowrap';
    titleLabel.style.overflow = 'hidden';
    titleLabel.style.textOverflow = 'ellipsis'; // Adds '...' if text is too long MAYBE CHANGE THIS???????============

    productTile.appendChild(imgWrapper);
    productTile.appendChild(titleLabel);
    
    const addBtn = document.getElementById('addProductBtn');
    if (addBtn) addBtn.style.order = '0'; 
    
    productTile.style.order = existingTiles + 1;
    container.appendChild(productTile);
}