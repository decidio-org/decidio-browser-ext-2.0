/**
 * app.js
 * 
 * This script manages the extension's popup UI, including the sidebar panel, product collection tiles,
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

    // Automatically expand the card when the extension UI loads
    if (sidebarPanel) {
        sidebarPanel.classList.remove('is-collapsed');
    }

    if (toggleAnchor && sidebarPanel) {
        // Clicking the floating icon opens/closes the sidebar panel
        toggleAnchor.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebarPanel.classList.toggle('is-collapsed');
        });
    }

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
            
            setTimeout(() => {
                dropdown.classList.remove('is-closing');
            }, 450); // Matches the visual CSS transition timeout
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dropdown.classList.contains('is-active')) {
                closeDropdown();
            } else {
                openDropdown();
            }
        });

        options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.getAttribute('data-value');
                
                if (value === 'create-new') {
                    display.innerText = "Create List +";
                } else {
                    display.innerText = option.innerText;
                }
                closeDropdown();
            });
        });

        // Close dropdown when clicking out anywhere on the root document layout
        document.addEventListener('click', () => {
            if (dropdown.classList.contains('is-active')) {
                closeDropdown();
            }
        });
    });

    // ==========================================
    // DECIDIO INTERACTION MODE PICKER
    // ==========================================
    if (addProductBtn) {
        // Listen for the "Add a Product" click
        addProductBtn.addEventListener('click', async () => {
            // Collapse/hide the panel UI elements
            if (sidebarPanel) sidebarPanel.classList.add('is-collapsed');
            if (toggleAnchor) toggleAnchor.style.display = 'none'; // Keeps toggle anchor hidden during interaction

            // Query the currently active browser tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (tab) {
                // Send a message to content.js on the main page to start interaction mode
                chrome.tabs.sendMessage(tab.id, { action: "START_DECIDIO_PICKER" });
            }
        });
    }

    // Listen for messages BACK from the web page picker
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // CASE A: User successfully selected an image
        if (message.action === "PRODUCT_IMAGE_PICKED") {
            // Bring the UI back smoothly
            if (sidebarPanel) sidebarPanel.classList.remove('is-collapsed');
            if (toggleAnchor) toggleAnchor.style.display = '';

            if (productsContainer) {
                displaySelectedProduct(message.imageUrl, message.productUrl, productsContainer);
            }
        }
        
        // CASE B: User clicked off or cancelled picker mode
        else if (message.action === "DECIDIO_PICKER_CANCELLED") {
            // Restore the panel UI cards and logo smoothly back into view
            if (sidebarPanel) sidebarPanel.classList.remove('is-collapsed');
            if (toggleAnchor) toggleAnchor.style.display = '';
        }
    });

    // ==========================================
    // PRODUCT DESELECT / REMOVAL LOGIC
    // ==========================================
    if (productsContainer) {
        productsContainer.addEventListener('click', (event) => {
            // Find if the clicked element is part of a collected product tile
            const productTile = event.target.closest('.collected-product-tile');
            
            if (productTile) {
                // Remove the tile visually from the panel container
                productTile.remove();
                
                // Dynamically re-index remaining numbers (01, 02, 03...) so they stay continuous
                const remainingTiles = productsContainer.querySelectorAll('.collected-product-tile');
                remainingTiles.forEach((tile, index) => {
                    // Correct the flexbox order
                    tile.style.order = index + 1;
                    
                    // Update the text overlay badge inside it
                    const badge = tile.querySelector('.product-tile-number');
                    if (badge) {
                        badge.textContent = String(index + 1).padStart(2, '0');
                    }
                });
            }
        });
    }
});

// Helper rendering utility function
function displaySelectedProduct(imageUrl, productUrl, container) {
    // Calculate the current item number based on existing collected tiles
    const existingTiles = container.querySelectorAll('.collected-product-tile').length;
    const itemNumber = String(existingTiles + 1).padStart(2, '0'); // Formats as 01, 02, etc.

    // Create the tile wrapper
    const productTile = document.createElement('div');
    productTile.className = 'collected-product-tile';

    productTile.setAttribute('data-product-url', productUrl);
    
    // Style the wrapper tile
    productTile.style.position = 'relative';
    productTile.style.width = '85px';
    productTile.style.height = '110px';
    productTile.style.borderRadius = '8px';
    productTile.style.overflow = 'hidden';
    productTile.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    productTile.style.background = 'rgba(255, 255, 255, 0.08)';
    productTile.style.boxSizing = 'border-box';

    // Create the image preview element
    const imgPreview = document.createElement('img');
    imgPreview.src = imageUrl;
    imgPreview.style.width = '100%';
    imgPreview.style.height = '100%';
    imgPreview.style.objectFit = 'cover';
    imgPreview.style.display = 'block';

    // Create the number badge overlay
    const numberBadge = document.createElement('div');
    numberBadge.className = 'product-tile-number';
    numberBadge.textContent = itemNumber;
    
    // Position the badge at the bottom right
    numberBadge.style.position = 'absolute';
    numberBadge.style.bottom = '6px';
    numberBadge.style.right = '8px';
    numberBadge.style.color = '#ffffff';
    numberBadge.style.fontSize = '12px';
    numberBadge.style.fontWeight = 'bold';
    numberBadge.style.textShadow = '0px 1px 3px rgba(0, 0, 0, 0.8)'; // Makes white text readable over bright images

    productTile.appendChild(imgPreview);
    productTile.appendChild(numberBadge);
    
    // Explicitly set the CSS order so layout structures respect the sequence
    const addBtn = document.getElementById('addProductBtn');
    if (addBtn) {
        addBtn.style.order = '0'; // Forces the button to always be first
    }
    
    // Set this tile's order to match its item number (1, 2, 3...) so they line up sequentially
    productTile.style.order = existingTiles + 1;

    // Append it safely to the end of the container
    container.appendChild(productTile);
}