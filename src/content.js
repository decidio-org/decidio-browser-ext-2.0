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
hoverBadge.setAttribute('aria-hidden', 'true');
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
  let clickableCard = null;



  // ---- May need change after merge
  if (driver && driver.productItemSelector) {
    clickableCard = targetElement.closest(driver.productItemSelector);
  }

  // Fall back to scoring if the strict match isn't there
  if (!clickableCard && driver && typeof driver.fallbackFinder === 'function') {
    clickableCard = driver.fallbackFinder(targetElement);
  }


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



  let isProductCard = null;
  // Attempt to locate container using structural selectors
  if (driver && driver.productItemSelector) {
    isProductCard = e.target.closest(driver.productItemSelector);
  }
  
  // If missed, engage scoring
  if (!isProductCard && driver && typeof driver.fallbackFinder === 'function') {
    console.log("Strict selector missed. Activating Heuristic Scoring Engine...");
    isProductCard = driver.fallbackFinder(e.target);
  }



  // If the user clicked a random whitespace on the screen
  if (!isProductCard) {
    return;
  }

  // Stop browser navigation for the product card
  e.preventDefault();
  e.stopImmediatePropagation();

  // Cap the user at max 5 concurrent open cards (Review??)
  const activeCards = document.querySelectorAll('.product-card');
  if (activeCards.length >= 5) {
    alert("You've reached the maximum limit of 5 product overlays. Close one to add another..");
    return;
  }

  const productTitle = getTitleFromSchema()
  ?? isProductCard.querySelector('[itemprop="name"]')?.textContent.trim()
  ?? isProductCard.querySelector(driver.titleSelector)?.textContent.trim()
  ?? isProductCard.querySelector('img[alt]')?.alt.trim()
  ?? isProductCard.querySelector('a')?.getAttribute('aria-label')
  ?? getTitleFromSchema()   // page-level last resort
  ?? "Unknown Product";

  if (!productTitle) return;

  // Build the product card
  const card = createExtenCard(productTitle, false);

  document.body.appendChild(card);
  aiFetch(card, productTitle);
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




/**
 * Contacts background service worker for AI product specifications
 * and turns off the card loader animation once received.
 */
function aiFetch(cardElement, productTitle) {
  chrome.runtime.sendMessage({ action: "fetchProductSpecs", title: productTitle }, async (response) => {
    
    const overlayMain = cardElement.querySelector('.overlay-main');
    const loader = cardElement.querySelector('.card-loader');

    // Target the description paragraph in your card
    const descElement = cardElement.querySelector('.desc');
    


    // Remove loading indicator immediately
    cardElement.classList.remove('is-loading');
    if (loader) loader.style.display = 'none';

    // Clear or hide the default description paragraph so it doesn't crowd the card 
    // since we only want to show the specifications
    if (descElement) descElement.style.display = 'none';

    try {
      let aiResult;

      if (response && response.specs) {
        if (typeof response.specs === 'string') {
          aiResult = JSON.parse(response.specs);
        } else {
          aiResult = response.specs;
        }
      } else {
        throw new Error("No data received.");
      }

      // Create a specific container for the table typing system with a scroll limit
      const aiDisplay = document.createElement('div');
      aiDisplay.className = 'ai-display-container';
      
      // Max-height ensures a long spec list doesn't overflow off the screen layout.
      aiDisplay.style.cssText = 'max-height: 320px; overflow-y: auto; margin-top: 10px; padding-right: 4px;';
      overlayMain.appendChild(aiDisplay);

      // Extract the nested "Specs" directly, skipping URL, Description, Visuals, etc.
      if (aiResult && aiResult.Specs) {
        await renderSpecsTable(aiDisplay, aiResult.Specs);
      } else {
        aiDisplay.innerHTML = "<p style='color: #888; font-size: 13px; text-align: center;'>No technical specifications found.</p>";
      }

    } catch (err) {
        console.error("Decidio. data processing error:", err);
        if (overlayMain) {
          const errorMsg = document.createElement('p');
          errorMsg.style.cssText = 'color: #ff4d4d; font-size: 13px; font-weight: bold; margin-top: 10px;';
          errorMsg.textContent = "Error loading product data specs.";
          overlayMain.appendChild(errorMsg);
        }
    }
  });
}