/**
 * ===========================
 * Main controller file that sets up state, listens for chrome
 * messages, tracks mouse, and handles event listeners.
 * =========================
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
let currentTargetCard = null; // Keeps track of the targeted product context matching the badge

// Check storage on page load ---
chrome.storage.local.get({ isExtensionActive: false }, (data) => {
  isExtensionActive = data.isExtensionActive;
  if (isExtensionActive) {
    console.log("decidio. AUTO-ACTIVATED on page load/navigation");
  }
});

// Listen for the message from background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggle_decidio.") {
    isExtensionActive = request.state;

    if (isExtensionActive) {
      console.log("decidio. is now ACTIVE");
    } else {
      console.log("decidio. is now INACTIVE");

      // Remove all active product overlays
      const existingCards = document.querySelectorAll('.product-card');
      existingCards.forEach(card => card.remove());

      hideHoverElements();
    }
    sendResponse({ nextState: isExtensionActive });
  }
  return true;
});

/**
 * Mouse motion & position section
 */

// Track mouse movement
document.addEventListener('mousemove', (e) => {
  if (!isExtensionActive) return;

  lastClientX = e.clientX;
  lastClientY = e.clientY;

  evaluateBadgeState(e.target, e.clientX, e.clientY);
});

// Handle scroll changes and look up what's under the cursor
document.addEventListener('scroll', () => {
  if (!isExtensionActive) return;

  // Calculates what element has scrolled beneath the mouse
  const elementUnderCursor = document.elementFromPoint(lastClientX, lastClientY);
  if (elementUnderCursor) {
    evaluateBadgeState(elementUnderCursor, lastClientX, lastClientY);
  }
}, { passive: true });

// Checks whether the element beneath the cursor is a "target"
function evaluateBadgeState(targetElement, clientX, clientY) {
  // Edge-case for clearing the hover elements when on the product card or extension interface
  if (
    targetElement.closest('#decidio-root') || 
    targetElement.closest('.product-card') ||
    targetElement.classList.contains('decidio-hover-badge')
  ) {
    return;
  }

  const driver = getActiveDriver();
  let clickableCard = null;

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
    // Lock the global target reference for extraction synchronization
    currentTargetCard = clickableCard;
    
    // The decidio. badge by the mouse
    hoverBadge.classList.add('visible');
    hoverBadge.style.left = `${clientX - 20}px`; 
    hoverBadge.style.top = `${clientY - 35}px`;
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
document.body.addEventListener('click', (e) => {
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
    // If they clicked on a add to list or whatever button
    if (e.target.closest('.actions') || e.target.classList.contains('button')) {
       return; 
    }
    
    e.preventDefault();
    e.stopPropagation();
    bringToFront(clickedCard);
    return;
  }

  // Skip extension's internal UI clicks so they still work perfectly
  if (e.target.closest('#decidio-root') || e.target.closest('.product-card') || e.target.classList.contains('decidio-hover-badge')) {
    return; 
  }

  // Grab the active driver rules
  const driver = getActiveDriver();
  let clickedProductCard = null;

  // Use the driver's specific selector to see if a product card was clicked
  if (driver && driver.productItemSelector) {
    clickedProductCard = e.target.closest(driver.productItemSelector);
  }

  // If the strict selector missed it, use heuristic fallback
  if (!clickedProductCard && driver && typeof driver.fallbackFinder === 'function') {
    clickedProductCard = driver.fallbackFinder(e.target);
  }

  // If we successfully matched a product card via the driver...
  if (clickedProductCard) {
    console.log("User clicked directly on a driver-verified product card!");

    // Extract the URL using the driver's layout rules
    let destinationUrl = null;

    // If they clicked directly on or inside a link, grab that first
    const directLink = e.target.closest('a[href]');
    if (directLink) {
      destinationUrl = directLink.href;
    } else if (driver.titleSelector) {
      // Otherwise, use the driver's title selector to find the anchor link inside the card
      const titleAnchor = clickedProductCard.querySelector(driver.titleSelector)?.closest('a') 
                || clickedProductCard.querySelector(driver.titleSelector)?.querySelector('a');
      if (titleAnchor) destinationUrl = titleAnchor.href;
    }

    // Ultimate fallback if the driver's structural link isn't found
    if (!destinationUrl) {
      const fallbackAnchor = clickedProductCard.querySelector('a[href]');
      if (fallbackAnchor) destinationUrl = fallbackAnchor.href;
    }

    // You now have the exact product URL directly from the driver
    if (destinationUrl && destinationUrl.startsWith('http')) {
      console.log(`[Driver Match Success] Grabbed URL: ${destinationUrl}`);

      e.preventDefault(); 
      e.stopPropagation();

      handleBadgeActivation(clickedProductCard, destinationUrl, e.pageX, e.pageY);
    }
  }
}, true);


/**
 * DOM CAPTURE LAYER: Extraction & Pipelines
 */
function handleBadgeActivation(productCardElement, targetProductUrl, appendX, appendY) {
  const driver = getActiveDriver() || {};

  // Cap the user at max 5 concurrent open cards
  const activeCards = document.querySelectorAll('.product-card');
  if (activeCards.length >= 5) {
    alert("You've reached the maximum limit of 5 decidio. cards. Close one to add another.");
    return;
  }

  navigator.clipboard.writeText(targetProductUrl).catch(() => {});

  // Scrape Card Metadata
 const productTitle = getTitleFromSchema()
   ?? productCardElement.querySelector('[itemprop="name"]')?.textContent.trim()
   ?? (driver.titleSelector ? productCardElement.querySelector(driver.titleSelector)?.textContent.trim() : null)
   ?? productCardElement.querySelector('img[alt]')?.alt.trim()
   ?? productCardElement.querySelector('a')?.getAttribute('aria-label')
   ?? "Unknown Product";

  const price = null;

  // Build Request Payload Object
  const rawScrapePayload = {
    product_type: "Unknown",
    name: productTitle,
    price: price,
    url: targetProductUrl,
    raw_specs: {},
    raw_features: []
  };

  // UI RENDERING: Instantiate and pin container immediately in loading status mode
  const card = createExtenCard(productTitle, false);
  card.classList.add('is-loading'); // Engages loading screen spinner styles
  document.body.appendChild(card);
  positionCardSafely(card, appendX - 20, appendY + 15, false);
  hideHoverElements();

  // Route to pipeline coordinator
  executeHarmonizationPipeline(card, rawScrapePayload);
}

/**
 * RECEIVE & RENDER CANONICAL SPEC JSON
 */
function executeHarmonizationPipeline(cardElement, payload) {
  const overlayMain = cardElement.querySelector('.overlay-main');
  const loader = cardElement.querySelector('.card-loader');
  const descElement = cardElement.querySelector('.desc');

  if (descElement) descElement.style.display = 'none';

  // REQUEST BUILDER: Send payload via background
  chrome.runtime.sendMessage({ action: "PROCESS_PRODUCT_PIPELINE", payload: payload }, (response) => {
    
    // Clear Loading Architecture Flags
    cardElement.classList.remove('is-loading');
    if (loader) loader.style.display = 'none';

    if (chrome.runtime.lastError || !response || response.error) {
      console.error("Decidio error fallback triggered:", chrome.runtime.lastError || response?.error);
      renderErrorState(overlayMain, response?.error || "Pipeline request failed.");
      return;
    }

    try {
      const canonicalData = response.data;
      requestAnimationFrame(() => {
        renderCanonicalSpecs(cardElement, canonicalData);
      });
    } catch (parseError) {
      console.error("Layout processing exception:", parseError);
      renderErrorState(overlayMain, "Failed parsing system parameters safely.");
    }
  });
}

function renderErrorState(container, message) {
  container.innerHTML = `
    <div class="decidio-error-wrapper" style="padding: 10px; color: #ef4444; font-size: 13px; text-align: center;">
      <p style="font-weight: bold; margin: 0 0 4px 0;">Harmonization Error</p>
      <p style="margin: 0; color: #ba9393;">${message}</p>
    </div>
  `;
}