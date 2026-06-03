/**
 * ====================================================
 * Content.js file is the main controller file that sets up state, listens
 * for Chrome messages, tracks the mouse, and handles event listeners.
 * ====================================================
 */

/**
 * Initialization and DOM (document object model) setup section
 */
// Main container to hold the extension's UI elements
const overlayRoot = document.createElement('div');
overlayRoot.id = 'decidio-root';
document.body.appendChild(overlayRoot);

// Floating text badge that follows the user's mouse
const hoverBadge = document.createElement('div');
hoverBadge.className = 'decidio-hover-badge';
hoverBadge.innerText = 'decidio.';
document.body.appendChild(hoverBadge);

let isExtensionActive = false; // On/off tracker
let lastClientX = 0;
let lastClientY = 0;


// Check storage on page load ---
chrome.storage.local.get({ isExtensionActive: false }, (data) => {
  isExtensionActive = data.isExtensionActive;
  if (isExtensionActive) {
    console.log("decidio. AUTO-ACTIVATED on page load/navigation");
    handleInitialPageLayout();
  }
});

// Listen for the message from background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggle_decidio.") {
    isExtensionActive = request.state;

    if (isExtensionActive) {
      console.log("decidio. is now ACTIVE");
      handleInitialPageLayout();
    } else {
      console.log("decidio. is now INACTIVE");

      // Remove all active product overlays
      const existingCards = document.querySelectorAll('.product-card');
      existingCards.forEach(card => card.remove());

      hideHoverElements();
    }
    sendResponse({nextState: isExtensionActive });
  }
  return true;
});

/**
 * Mouse motion & position section
 */

// Track mouse movement
document.addEventListener('mousemove', (e) => {
  if (!isExtensionActive) return;
  
  // Don't track mouse or show search badge if we are on an active product page
  const driver = getActiveDriver();
  if (driver && typeof driver.isProductPage === 'function' && driver.isProductPage()) {
    hideHoverElements();
    return;
  }

  lastClientX = e.clientX;
  lastClientY = e.clientY;

  evaluateBadgeState(e.target, e.clientX, e.clientY);
});

// Handle scroll changes and look up what's under the cursor
document.addEventListener('scroll', () => {
  if (!isExtensionActive) return;

  // Exit early if we are on a product page so scroll math doesn't conflict
  const driver = getActiveDriver();
  if (driver && typeof driver.isProductPage === 'function' && driver.isProductPage()) {
    return; 
  }

  // Calculates what element has scrolled beneath the mouse
  const elementUnderCursor = document.elementFromPoint(lastClientX, lastClientY);
  if (elementUnderCursor) {
    evaluateBadgeState(elementUnderCursor, lastClientX, lastClientY);
  }
}, { passive: true });

// Checks whether the element beneath the cursor is a "target"
function evaluateBadgeState(targetElement, clientX, clientY) {
  // Edge-case for clearing the hover elements when on the product card
  if (
    targetElement.closest('#decidio-root') || 
    targetElement.closest('.product-card')
  ) {
    hideHoverElements();
    return;
  }

  const driver = getActiveDriver();
  const clickableCard = targetElement.closest(driver.productItemSelector);
  // Make sure there is inner text characters
  const hasText = targetElement.innerText && targetElement.innerText.trim().length > 0;
  
  if (clickableCard && hasText) {
    // The decidio. badge by the mouse
    hoverBadge.classList.add('visible');
    hoverBadge.style.left = `${clientX + 15}px`; 
    hoverBadge.style.top = `${clientY + 15}px`;
  } else {
    hideHoverElements();
  }
}

function hideHoverElements() {
  hoverBadge.classList.remove('visible');
}


/**
 * Dealing with clicks and interaction section
 */

// Clean up hover UI when user's cursor exits the web page
document.addEventListener('mouseleave', () => {
  hideHoverElements();
});

// Clicking logic for the overlay cards
document.addEventListener('click', (e) => {
  if (!isExtensionActive) return;


  // x button on the overlay card
  if (e.target.classList.contains('close-button')) {
    e.preventDefault();
    e.stopPropagation();

    const cardToClose = e.target.closest('.product-card');
    if (cardToClose) cardToClose.remove();
    return;
  }

  // Bringing the card to the front of the stack
  const clickedCard = e.target.closest('.product-card');
  if (clickedCard) {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(clickedCard);
    return;
  }

  if (e.target.classList.contains('decidio-hover-badge')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Get the config rule again for the click listener
  const driver = getActiveDriver();

  // If we are on a product page, don't allow search-click rules to override anything
  if (driver && typeof driver.isProductPage === 'function' && driver.isProductPage()) {
    return;
  }

  // Use the driver's selector map
  const isProductCard = e.target.closest(driver.productItemSelector);
  
  // If the user clicked a random whitespace on the screen
  if (!isProductCard) {
    return;
  }

  // Stop browser navigation for the product card
  e.preventDefault();
  e.stopPropagation();

  // Cap the user at max 5 concurrent open cards (Review??)
  const activeCards = document.querySelectorAll('.product-card');
  if (activeCards.length >= 5) {
    alert("You've reached the maximum limit of 5 product overlays. Close one to add another..");
    return;
  }

  let productTitle = "Unknown product";

  // Look into the product container block using the custom sub-selector matching the product title string
  const targetedTitleElement = isProductCard.querySelector(driver.titleSelector);
  
  if (targetedTitleElement) {
    productTitle = targetedTitleElement.innerText.trim();
  } else if (e.target.innerText) {
    // Fallback if the site mapping doesn't intercept a distinct child element
    productTitle = e.target.innerText.trim();
  }
  
  // If text is super long (like a whole product description block), grab just the title text
  if (productTitle.length > 150) {
    const fallbackH1 = document.querySelector('h1');
    if (fallbackH1) productTitle = fallbackH1.innerText.trim();
  }

  if (!productTitle) return;

  // Build the product card
  const card = createExtenCard(productTitle, false);

  document.body.appendChild(card);
  positionCardSafely(card, e.pageX - 20, e.pageY + 15, false);
  hideHoverElements();
}, true);

// Part of keeping the card from being somewhere you can't see/reach the close button
window.addEventListener('resize', () => {
  if (!isExtensionActive) return;
  const activeCards = document.querySelectorAll('.product-card');
  activeCards.forEach(card => {
    // Only recalculate bounds if it's in fixed viewport mode. 
    // Absolute cards are already anchored safely to the page body layout flow!
    if (card.classList.contains('product-page-mode')) {
      const currentLeft = parseInt(card.style.left) || 0;
      const currentTop = parseInt(card.style.top) || 0;
      positionCardSafely(card, currentLeft, currentTop, true);
    }
  });
});