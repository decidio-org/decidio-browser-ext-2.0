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
    
    // The decidio. badge by the mouse TEMPORARY MAY MAKE IT INVISIBLE????
    hoverBadge.classList.add('visible');
    hoverBadge.style.left = `${clientX - 20}px`; 
    hoverBadge.style.top = `${clientY - 10}px`;
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
    e.preventDefault();
    e.stopPropagation();
    bringToFront(clickedCard);
    return;
  }

  // INTERCEPT CLICKS ONLY ON HOVER BADGE
  if (e.target.classList.contains('decidio-hover-badge')) {
    e.preventDefault();
    e.stopPropagation();
    
    if (currentTargetCard) {
      handleBadgeActivation(currentTargetCard, e.pageX, e.pageY);
    }
    return;
  }
}, true);


/**
 * DOM CAPTURE LAYER: Extraction & Pipelines
 */
function handleBadgeActivation(productCardElement, appendX, appendY) {
  const driver = getActiveDriver() || {};

  // Cap the user at max 5 concurrent open cards
  const activeCards = document.querySelectorAll('.product-card');
  if (activeCards.length >= 5) {
    alert("You've reached the maximum limit of 5 product overlays. Close one to add another.");
    return;
  }

  // EXTRACT THE GENUINE PRODUCT PAGE URL FROM THE CARD
  // Fallback pattern: Find active driver links, fallback to any anchor inside the card
  const anchorElement = driver.titleSelector ? productCardElement.querySelector(driver.titleSelector)?.closest('a') : null;
  const productUrlAnchor = anchorElement || productCardElement.querySelector('a');
  const targetProductUrl = productUrlAnchor ? productUrlAnchor.href : null;

  if (!targetProductUrl || !targetProductUrl.startsWith('http')) {
    console.error("Decidio. could not find a valid product page URL inside this card framework.");
    return;
  } else {
    console.log(`URL EXTRACTION SUCCESS:\n${targetProductUrl}\n`);

    navigator.clipboard.writeText(targetProductUrl).catch(() => {});
  }

  // Scrape Card Metadata
  // const productTitle = getTitleFromSchema()
  //   ?? productCardElement.querySelector('[itemprop="name"]')?.textContent.trim()
  //   ?? (driver.titleSelector ? productCardElement.querySelector(driver.titleSelector)?.textContent.trim() : null)
  //   ?? productCardElement.querySelector('img[alt]')?.alt.trim()
  //   ?? productCardElement.querySelector('a')?.getAttribute('aria-label')
  //   ?? "Unknown Product";

    const productTitle =
    (typeof driver.extractTitle === 'function'
      ? driver.extractTitle(isProductCard)
      : null)
    ?? getTitleFromSchema()
    ?? isProductCard.querySelector('[itemprop="name"]')?.textContent.trim()
    ?? isProductCard.querySelector(driver.titleSelector)?.textContent.trim()
    ?? (() => {
        const alt = isProductCard.querySelector('img[alt]')?.alt.trim();
        return alt && alt.length > 5 ? alt : null;
      })()
    ?? isProductCard.querySelector('a[aria-label]')?.getAttribute('aria-label')?.trim()
    ?? isProductCard.querySelector('a[title]')?.getAttribute('title')?.trim()
    ?? getLongestTextNode(isProductCard)
    ?? "Unknown Product";

  const price = null;

  // Build Request Payload Object
  const rawScrapePayload = {
    product_type: "unknown",
    name: productTitle,
    price: price,
    url: targetProductUrl,
    raw_specs: {},
    raw_features: []
  };


  // ==========================================
  // TEMPORARY TESTING BLOCK FOR CONSOLE
  // ==========================================
  console.log("%c TARGET URL INTERCEPTED BY DECIDIO:", "color: #a855f7; font-weight: bold;");
  console.log(`URL: ${targetProductUrl}`);
  // ==========================================


  // UI RENDERING: Instantiate and pin container immediately in loading status mode


  // Build the product card
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
      // Inject standard template layout container
      const specDisplay = cardElement.querySelector('.ai-display-container');
      
      requestAnimationFrame(() => {
        renderCanonicalSpecs(specDisplay, canonicalData);
      });
    } catch (parseError) {
      console.error("Layout processing exception:", parseError);
      renderErrorState(overlayMain, "Failed parsing system parameters safely.");
    }
  });
}

/**
 * Fallback Renderer if components.js is not loaded
 */
function renderTiersUIFallback(container, rawJsonPayload) {
  const specs = rawJsonPayload.Specs || rawJsonPayload.specs || {};
  let rowsHtml = '';
  
  for (const [key, valueArray] of Object.entries(specs)) {
    const displayValue = Array.isArray(valueArray) ? valueArray.join(', ') : (valueArray || '—');
    rowsHtml += `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);">
        <td class="fade-key" style="padding: 6px 4px; text-align: left;">${key}</td>
        <td class="fade-value" style="padding: 6px 4px; text-align: right;">${displayValue}</td>
      </tr>
    `;
  }

  container.innerHTML = `<table>${rowsHtml}</table>`;
}

function renderErrorState(container, message) {
  container.innerHTML = `
    <div class="decidio-error-wrapper" style="padding: 10px; color: #ef4444; font-size: 13px; text-align: center;">
      <p style="font-weight: bold; margin: 0 0 4px 0;">Harmonization Error</p>
      <p style="margin: 0; color: #ba9393;">${message}</p>
    </div>
  `;
}