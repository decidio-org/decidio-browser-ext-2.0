function getTitleFromSchema() {
  const schemas = document.querySelectorAll('script[type="application/ld+json"]');
  for (const schema of schemas) {
    try {
      const data = JSON.parse(schema.textContent);
      if (data['@type'] === 'Product' && data.name) return data.name;
      if (data['@graph']) {
        const product = data['@graph'].find(n => n['@type'] === 'Product');
        if (product?.name) return product.name;
      }
    } catch {}
  }
  return null;
}

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
    // productItemSelector: '.product-card-container,[class*="product-card"], [class*="product-item"], [class*="grid-item"]',
    productItemSelector: [
      'section[class*="product"]',
      'ul[class*="product"] > li',
      'ol[class*="product"] > li',
      '.product-card-container',
      '[class*="product-card"]',
      '[class*="product-item"]',
      '[class*="grid-item"]'
    ].join(','),

    // titleSelector: 'h2, h3, .title, [class*="title"], [class*="name"]',

    titleSelector: [
      'h1',   // product page titles
      'h2',   // most grid cards
      'h3',   // nested card titles
      '[itemprop="name"]',      // schema.org markup
      '[aria-label*="product"]', // aria-labeled titles
      'figcaption'              // image-first cards
    ].join(','),


// FOR PRICE EXTRACTION IF WE NEED IT
//     <data value="29.99">$29.99</data>   <!-- semantic price -->
// <ins>$29.99</ins>                    <!-- sale price -->
// <del>$39.99</del>                    <!-- original price -->
// [itemprop="price"]                   <!-- schema.org -->
// [aria-label*="price"]

    allowedZones: 'a, button, img',

    isProductPage: () => {
      const hasBuyButton = document.querySelector('button[class*="add-to-cart"], #add-to-cart-button');
      return hasBuyButton !== null;
    },
    productPageTitleSelector: 'h1',
  }
};


const ARCHETYPE_DRIVERS = {
  realestate: {
    productItemSelector: [
      // Semantic
      'article[class*="card"]',
      'li[class*="card"]',
      'li[class*="result"]',
      'li[class*="listing"]',
      // Common patterns across sites
      '[class*="property-card"]',
      '[class*="listing-card"]',
      '[class*="home-card"]',
      '[class*="result-card"]',
      '[class*="MapHome"]',
      // Data attributes (more stable than class names)
      '[data-test*="card"]',
      '[data-testid*="card"]',
      '[data-listing-id]',
      '[data-propertyid]',
    ].join(','),

    titleSelector: [
      // Most reliable — semantic address element
      'address',
      // Data attributes (stable across deployments)
      '[data-test*="addr"]',
      '[data-testid*="addr"]',
      '[data-test*="street"]',
      // Common class patterns (case-insensitive via JS, not CSS)
      '[class*="address"]',
      '[class*="Address"]',
      '[class*="street"]',
      '[class*="Street"]',
    ].join(','),

    isProductPage: () => {
      const url = window.location.href;
      // URL patterns common to property detail pages
      const detailPatterns = [
        /\/homedetails\//,
        /\/homes?\/.*\/home\//,
        /\/property\//,
        /\/listing\//,
        /\/for-sale\//,
        /\/for-rent\//,
        /\/(mls|mlsid)[=-]/i,
      ];
      if (detailPatterns.some(p => p.test(url))) return true;

      // DOM signals for a property detail page
      const hasGallery = document.querySelector('[class*="gallery"], [class*="Gallery"], [class*="photo-carousel"]') !== null;
      const hasFactsSection = document.querySelector('[class*="facts"], [class*="Facts"], [class*="details-section"]') !== null;
      const hasContactForm = document.querySelector('form[class*="contact"], form[class*="Contact"], button[class*="tour"]') !== null;

      return hasGallery && (hasFactsSection || hasContactForm);
    },

    productPageTitleSelector: [
      'h1',
      'address',
      '[class*="summary-address"]',
      '[class*="street-address"]',
      '[data-test*="addr"]',
    ].join(','),

    // Custom title extractor for real estate — called before the generic chain
    extractTitle: (container) => extractRealEstateTitle(container),
  }
};

function detectSiteArchetype() {
  const host = window.location.hostname;
  const text = document.body.innerText.toLowerCase();
  const url = window.location.href;

  // Known real estate domains (extend as needed)
  const realEstateDomains = [
    'zillow', 'redfin', 'realtor', 'trulia', 'homes.com',
    'coldwellbanker', 'century21', 'compass', 'movoto',
    'loopnet', 'crexi', 'apartments.com', 'rent.com',
  ];
  if (realEstateDomains.some(d => host.includes(d))) return 'realestate';

  // Structural signals for unknown real estate sites
  const hasAddressTag = document.querySelector('address') !== null;
  const hasBedBath = /\b\d+\s*(bd|ba|bed|bath|bedroom|bathroom|sqft|sq\.?\s?ft)/i.test(text);
  const hasPricePerMonth = /\$[\d,]+\s*\/\s*(mo|month)/i.test(text);
  const hasForSaleRent = /(for sale|for rent|homes? for|listing price|asking price)/i.test(text);
  const hasMapView = document.querySelector('[class*="map"], [id*="map"], [aria-label*="map"]') !== null;

  const score =
    (hasAddressTag ? 3 : 0) +
    (hasBedBath ? 3 : 0) +
    (hasPricePerMonth ? 2 : 0) +
    (hasForSaleRent ? 2 : 0) +
    (hasMapView ? 1 : 0);

  if (score >= 4) return 'realestate';
  return 'generic';
}
// Helper function to figure out which site rules to apply
function getActiveDriver() {
  const host = window.location.hostname;

  if (host.includes('amazon')) return SITE_DRIVERS.amazon;
  // if (host.includes('zillow')) return SITE_DRIVERS.zillow;

  // Archetype detection for everything else
  const archetype = detectSiteArchetype();
  if (archetype === 'realestate') return ARCHETYPE_DRIVERS.realestate;
  
  // Falls back to global commerce rules for every other website on the web
  return SITE_DRIVERS.generic;
}

/**
 * Last-resort title heuristic: finds the longest non-price text string
 * inside a container that's plausibly a product name.
 */
 function getLongestTextNode(container) {
  const pricePattern = /^[\$€£¥]?\s?\d+[\.,]?\d*$|^\d+[\.,]\d{2}$/;
  let best = null;

  container.querySelectorAll('*').forEach(el => {
    if (['SCRIPT','STYLE','NOSCRIPT'].includes(el.tagName)) return;
    const text = (el.childNodes[0]?.textContent ?? '').trim(); // direct text only, no children
    if (!text || pricePattern.test(text)) return;
    if (text.length > 10 && (!best || text.length > best.length)) {
      best = text;
    }
  });

  return best;
}


/**
 * Strips city/state/zip suffixes from an address string,
 * returning just the street line.
 */
 function cleanAddressText(raw) {
  if (!raw) return null;
  // Take only the first line if multi-line
  const first = raw.split(/[\n,|]/)[0].trim();
  // Must look like a street address: starts with a number
  if (/^\d+\s+\w/.test(first) && first.length > 5) return first;
  // Or return the whole thing trimmed if it's short enough to be an address
  const full = raw.trim().replace(/\s+/g, ' ');
  if (full.length < 80) return full;
  return null;
}

/**
 * Walks text nodes looking for strings that match US/CA address patterns.
 */
function findAddressPattern(container) {
  const addressPattern = /^\d+\s[\w\s]+(?:st|ave|rd|blvd|dr|ln|ct|pl|way|cir|terr?|pkwy|hwy)\b/i;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    if (addressPattern.test(text) && text.length < 100) return text;
  }
  return null;
}

/**
 * Extracts a clean street address from a real estate card.
 * Tries semantic/attribute selectors first, then falls back to
 * pattern-matching text nodes for address-shaped strings.
 */
 function extractRealEstateTitle(container) {
  // 1. Semantic address element
  const addressEl = container.querySelector('address');
  if (addressEl) return cleanAddressText(addressEl.textContent);

  // 2. Data attribute selectors (stable)
  const dataSelectors = [
    '[data-test*="addr"]', '[data-testid*="addr"]',
    '[data-test*="street"]', '[data-testid*="street"]',
  ];
  for (const sel of dataSelectors) {
    const el = container.querySelector(sel);
    if (el) return cleanAddressText(el.textContent);
  }

  // 3. Class name patterns (case-insensitive JS match — more reliable than CSS [class*=])
  const allEls = container.querySelectorAll('*');
  for (const el of allEls) {
    const cls = el.className?.toString().toLowerCase() ?? '';
    if (
      (cls.includes('address') || cls.includes('street')) &&
      !cls.includes('city') && !cls.includes('state') // avoid city/state-only spans
    ) {
      const text = cleanAddressText(el.textContent);
      if (text) return text;
    }
  }

  // 4. Pattern-match for address-shaped strings in any text node
  return findAddressPattern(container);
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

  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount >= 3 && wordCount <= 60) score += 15; // typical product card copy
  if (wordCount > 100) score -= 20; // probably a paragraph block, not a card


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
      if (currentScore >= 55 && currentScore >= highestScore) {
          highestScore = currentScore;
          bestCandidate = current;
      }
      
      // Relaxed boundaries for modern high-res grid items
      if (current.offsetWidth > 600 || current.offsetHeight > 700) {
        console.log("Geometric boundary reached. Stopping DOM climb.");
        break;
      }
      
      current = current.parentElement;
  }

  return bestCandidate;
}