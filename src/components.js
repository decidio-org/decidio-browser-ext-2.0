/**
 * ============================================
 * components.js includes the extension card.
 * If any changes are needed to the appearance of the
 * card or buttons
 * ===========================================
 */

let cardLayer = 1; // Tracks z-index layer so the newest clicked product card stays on top

// Increment and apply z-index so clicked cards stack
function bringToFront(card) {
  cardLayer++;
  card.style.zIndex = cardLayer;
}


function handleInitialPageLayout() {
    const driver = getActiveDriver();
    if (!driver) return;
  
    // Prevent duplicate product page cards from stacking on re-runs
    const existingProductCard = document.querySelector('.product-card.product-page-mode');
    if (existingProductCard) existingProductCard.remove();
  
    // If the driver confirms we are looking at an individual product page
    if (typeof driver.isProductPage === 'function' && driver.isProductPage()) {
      
      // Hide trailing search badge since we're in product mode
      hideHoverElements();
  
      // Safely extract the title using your driver's selector
      let productTitle = "Unknown Product";
      const titleEl = document.querySelector(driver.productPageTitleSelector);
      
      if (titleEl) {
        // Clone it to safely strip out any sneaky inner prices/tags inside the H1
        const clone = titleEl.cloneNode(true);
        const extraElements = clone.querySelectorAll('span, script, style, .price');
        extraElements.forEach(el => el.remove());
        productTitle = clone.innerText.trim();
      }
  
      // Create the fixed layout card
      const card = createExtenCard(productTitle, true);
  
      document.body.appendChild(card);

      // Add AI call here......
      aiFetch(card, productTitle);
      
      positionCardSafely(card, window.innerWidth - 280, 20, true);
    }
}


  /**
   * Generates the extension card
   */
function createExtenCard(title, isProductPageMode = false) {
    const card = document.createElement('div');

    // Apply classes based on context. 
    // We add 'is-loading' by default so it spins immediately upon creation.
    if (isProductPageMode) {
        card.className = 'product-card product-page-mode is-loading';
    } else {
        card.className = 'product-card is-loading';
    }
    
    bringToFront(card);

    // The structure of the card including the 12 blade spans
    card.innerHTML = `
        <div class="card-loader">
            <div class="blade-spinner">
                <span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span>
            </div>
            <div class="loader-text">Analyzing specs with decidio. Intelligence...</div>
        </div>
        <button class="close-button">&times;</button>
        <div class="overlay-main">
            <h4 class="title">${title}</h4>
            <p class="desc">${isProductPageMode ? 'Product overview dashboard active.' : 'Placeholder for future text here'}</p>
        </div>
        <div class="footer">
            <div class="actions">
                <button class="button">Add Recent</button>
                <button class="button">Add New</button>
                <button class="button">Add to Existing</button>
                </div>
            <span class="logo">d.</span>
        </div>
    `;
    return card;
}


/**
 * ====================================================
 * UI Layout & Typewriter Rendering Functions
 * ====================================================
 */

let userHasScrolledUp = false;
let isGlidingUp = false;

/**
 * Dynamically builds a specifications table from a structured JSON object
 */
async function renderSpecsTable(containerElement, specsObject) {
    // Clean out old elements if they exist
    const existingTable = containerElement.querySelector('table');
    if (existingTable) existingTable.remove();

    // Reset layout state flags for this new injection loop
    userHasScrolledUp = false;
    isGlidingUp = false;

    // Set up the onscroll intercept listener on your container element
    containerElement.onscroll = () => {
        const distanceFromBottom = containerElement.scrollHeight - containerElement.clientHeight - containerElement.scrollTop;
        
        // If the user scrolls away from the bottom, flip the flag to pause scrolling
        if (!isGlidingUp) {
            // A threshold of > 10px means the user intentionally scrolled upward
            userHasScrolledUp = distanceFromBottom > 10;
        }
    };

    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; margin-top: 0px; font-family: Arial, sans-serif; font-size: 11px;';
    containerElement.appendChild(table);

    const specsEntries = Object.entries(specsObject);

    for (const [specType, valueArray] of specsEntries) {
        const rawVal = Array.isArray(valueArray) ? valueArray.join(', ') : String(valueArray);

        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid rgba(255, 255, 255, 0.08)';

        const typeCell = document.createElement('td');
        typeCell.className = 'fade-key';
        typeCell.style.cssText = 'padding: 6px 4px; font-weight: bold; vertical-align: top; width: 45%; text-align: left;';

        const valueCell = document.createElement('td');
        valueCell.className = 'fade-value';
        valueCell.style.cssText = 'padding: 6px 4px; vertical-align: top; width: 55%; text-align: right;';

        row.appendChild(typeCell);
        row.appendChild(valueCell);
        table.appendChild(row);

        // Run sequential typewriter processing loops
        await typeTextEffect(typeCell, specType, containerElement);
        await typeTextEffect(valueCell, rawVal, containerElement);
    }
}

/**
 * Character-by-character typewriter loop
 */
async function typeTextEffect(element, fullText, container) {
    element.textContent = ""; 
    for (const char of fullText) {
        element.textContent += char;
        autoScroll(container); // Triggers original state calculator
        await new Promise(resolve => setTimeout(resolve, 15)); 
    }
}

function autoScroll(container) {
    // If the user manually scrolled away, or an external script is gliding, freeze auto-scrolling
    if (!container || userHasScrolledUp || isGlidingUp) return;
    
    container.scrollTop = container.scrollHeight;

    requestAnimationFrame(() => {
        if (!isGlidingUp) {
            container.scrollTop = container.scrollHeight + 40; // Pads layout safely past text line edge
        }
    });
}