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
  // Guard against duplicate cards on retry
  const existingCard = document.querySelector('.product-card.product-page-mode');
  if (existingCard) return;

  const driver = getActiveDriver();
  if (!driver) return;

  // Check product page first before querying anything
  if (typeof driver.isProductPage === 'function' && !driver.isProductPage()) return;

  const titleEl = document.querySelector(driver.productPageTitleSelector);
  if (!titleEl && retries > 0) {
    setTimeout(() => handleInitialPageLayout(retries - 1), 500);
    return;
  }

  hideHoverElements();

  let productTitle = "Unknown Product";
  if (titleEl) {
    const clone = titleEl.cloneNode(true);
    clone.querySelectorAll('span, script, style, .price').forEach(el => el.remove());
    productTitle = clone.textContent.trim();
  }

  const card = createExtenCard(productTitle, true);
  document.body.appendChild(card);
  positionCardSafely(card, window.innerWidth - 280, 20, true);
}


  /**
   * Generates the extension card
   */
function createExtenCard(title, isProductPageMode = false) {
  const card = document.createElement('article'); 
    card.setAttribute('role', 'dialog');             
    card.setAttribute('aria-label', `Product details: ${title}`); 
    card.setAttribute('aria-modal', 'true'); 

    if (isProductPageMode) {
        card.className = 'product-card product-page-mode';
    } else {
        card.className = 'product-card';
    }

    bringToFront(card);

    // 3. REPLACE card.innerHTML — close button label and logo aria-hidden
    card.innerHTML = `
        <button class="close-button" aria-label="Close ${title} card">&times;</button>
        <div class="overlay-main">
            <h2 class="title">${title}</h2>
            <p class="desc">${isProductPageMode ? 'Product overview dashboard active.' : 'Placeholder for future text here'}</p>
        </div>
        <div class="footer">
            <nav class="actions" aria-label="Product actions">
                <button class="button">Add Recent</button>
                <button class="button">Add New</button>
                <button class="button">Add to Existing</button>
            </nav>
            <span class="logo" aria-hidden="true">d.</span>
        </div>

    `;
    return card;
}