/**
 * ============================================
 * components.js includes the extension card.
 * If any changes are needed to the appearance of the
 * card or buttons
 * ===========================================
 */


 if (typeof getActiveDriver === 'undefined') {
    console.error('decidio: drivers.js not loaded yet');
  }
let cardLayer = 1000; // Tracks z-index layer so the newest clicked product card stays on top

// Increment and apply z-index so clicked cards stack
function bringToFront(card) {
  cardLayer++;
  card.style.zIndex = cardLayer;
}


function handleInitialPageLayout(retries = 5) {
    const driver = getActiveDriver();
    if (!driver) return;

    const titleEl = document.querySelector(driver.productPageTitleSelector);
    if (!titleEl && retries > 0) {
      setTimeout(() => handleInitialPageLayout(retries - 1), 500);
      return;
    }
  
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
        productTitle = clone.textContent.trim();
      }
  
      // Create the fixed layout card
      const card = createExtenCard(productTitle, true);
  
      document.body.appendChild(card);
      
      positionCardSafely(card, window.innerWidth - 280, 20, true);
    }
}


  /**
   * Generates the extension card
   */
function createExtenCard(title, isProductPageMode = false) {
    const card = document.createElement('div');

    // Apply classes based on context
    if (isProductPageMode) {
        card.className = 'product-card product-page-mode';
    } else {
        card.className = 'product-card';
    }
    
    bringToFront(card);

    // The structure of the card
    card.innerHTML = `
        <button class="close-button">&times;</button>
        <div class="overlay-main">
            <h2 class="title">${title}</h2>
            <p class="desc">${isProductPageMode ? 'Product overview dashboard active.' : 'Placeholder for future text here'}</p>
        </div>
        <footer class="footer">
            <div class="actions">
                <button class="button">Add Recent</button>
                <button class="button">Add New</button>
                <button class="button">Add to Existing</button>
                </div>
            <span class="logo">d.</span>
        </footer>
    `;
    return card;
}