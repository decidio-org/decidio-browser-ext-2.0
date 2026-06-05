// Test to see if molding the extension to the format of certain sites can improve issues with the cards being selectable in areas it shouldn't be
const SITE_DRIVERS = {
  "amazon": {
    // May need some change??
    productItemSelector: '.s-result-item[data-component-type="s-search-result"]',
    titleSelector: 'h2 a span',
    isProductPage: () => document.getElementById('dp') !== null,
    productPageTitleSelector: '#productTitle',
  },
  
  "zillow": {
    productItemSelector: 'div[class*="srp-"]',
    titleSelector: 'address',
    isProductPage: () => window.location.href.includes('/homedetails/'),
  },
  "generic": { 
    fallbackFinder: (clickedElement) => {
      return findProductContainer(clickedElement);
    },

    isProductPage: () => {
      // Keep your awesome e-commerce product page detector loop here
      const hasBuyButton = document.querySelector('button[class*="add-to-cart"], #add-to-cart-button');
      return hasBuyButton !== null;
    },
    productPageTitleSelector: 'h1',
  }
};

// Helper function to figure out which site rules to apply
function getActiveDriver() {
  const host = window.location.hostname;

  if (host.includes('amazon')) return SITE_DRIVERS.amazon;
  if (host.includes('zillow')) return SITE_DRIVERS.zillow;
  
  // Falls back to global commerce rules for every other website on the web
  return SITE_DRIVERS.generic;
}

// New Code Section

/**
 * Heuristic Scoring Engine
 * 
 * This part of the extension acts as a "fallback" system. Instead of relying on
 * hardcoded class names that can break if a website updates its layout, the extension
 * uses a system based on scoring.
 * When a cuser clicks an item, we climb up the DOM tree and score elements based on
 * the presence of an e-commerce product card (image, link, price, etc.). This 
 * guarantees better accuracy across unmapped or updated sites (especially sites that 
 * are as complex as Zillow).
 */

/**
 * Rates an element's likelihood of being an e-commerce product card.
 */
function scoreProductCard(el, clickedEl) {
  if (!el || !clickedEl) return 0;

  let score = 0;

  // Image checks (Optimized for overlays/siblings)
  const containerImg = el.querySelector("img");
  if (containerImg) {
    // Check if clicked element IS the image, CONTAINS the image, 
    // or is a close sibling/overlay sharing the same parent
    const isExactImage = containerImg.contains(clickedEl) || clickedEl.closest('img') === containerImg;
    const isImageSibling = clickedEl.parentElement && clickedEl.parentElement.querySelector('img') === containerImg;

    if (isExactImage || isImageSibling) {
      score += 35; // Bumped up from 25 to favor image clicks strongly
    } else {
      score += 15;
    }
  }
  
  // 2. Link check
  if (el.querySelector("a[href]")) {
    score += 25;
  }

  // Smart Filter/Form Penalty 
  // ONLY penalize if the element is an explicit filter sidebar or form container, 
  // not just because it contains a single <label> or input.
  const isFilterStructure = el.matches('aside, form, .sidebar, .filters');
  const hasTooManyInputs = el.querySelectorAll('input').length > 3;
  if (isFilterStructure || hasTooManyInputs) {
      score -= 40; 
  }

  // Text Content & Price Checks
  const text = el.innerText || "";
  
  // Regex adjustments to catch price formats cleanly
  if (/[\$\s?€£¥]\s?\d+(?:[\.,]\d{2})?/.test(text)) score += 40;
  
  // Real estate tracking (For Zillow support)
  if (/\b(bd|ba|sqft|home|house|address)\b/i.test(text)) score += 30; 
  if (/star|review|rating/i.test(text)) score += 10;

  return score;
}

/**
 * Climbs the DOM tree starting from a user click to find the
 * product card wrapper.
 */
function findProductContainer(startEl) {
  let current = startEl;
  let bestCandidate = null;
  let highestScore = 0;

  // Climb up the DOM tree
  while (current && current !== document.body) {
      const currentScore = scoreProductCard(current, startEl);
      
      // Capturing the peak score
      if (currentScore >= 70 && currentScore >= highestScore) {
          highestScore = currentScore;
          bestCandidate = current;
      }
      
      // Relaxed boundaries for modern high-res grid items
      if (current.offsetWidth > 800 || current.offsetHeight > 900) {
        console.log("Geometric boundary reached. Stopping DOM climb.");
        break;
      }
      
      current = current.parentElement;
  }

  return bestCandidate;
}