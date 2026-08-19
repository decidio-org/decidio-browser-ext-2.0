/* ==========================================================================
   SCHEMA & METADATA HELPERS
   ========================================================================== */

/**
 * Parses JSON-LD scripts on the page to extract structured Product schema titles.
 * @returns {string|null} Clean product name if found, otherwise null.
 */
function getTitleFromSchema() {
  const schemas = document.querySelectorAll('script[type="application/ld+json"]');
  for (const schema of schemas) {
    try {
      const data = JSON.parse(schema.textContent);
      // Handle array roots, graph objects, or single entity schemas
      const items = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
      for (const item of items) {
        if ((item['@type'] === 'Product' || item['@type'] === 'IndividualProduct') && item.name) {
          return typeof item.name === 'string' ? item.name : item.name.name;
        }
      }
    } catch {} // Ignore malformed JSON-LD scripts
  }
  return null;
}

/**
 * Extracts product/page title from OpenGraph or Twitter meta tags.
 * @returns {string|null} Meta title content if available.
 */
function getMetaTitle() {
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (ogTitle) return ogTitle;
  const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.getAttribute('content');
  if (twitterTitle) return twitterTitle;
  return null;
}

/**
 * Extracts and cleans document.title by stripping store brand suffixes/prefixes.
 * Example: "Item Name - Store.com" -> "Item Name"
 * @returns {string} Sanitized document title.
 */
function getCleanedDocumentTitle() {
  let title = document.title || '';
  // Split on common delimiters like "|", "–", "-", or ":"
  title = title.split(/\s+[\|–—\-\:]\s+/)[0].trim();
  title = title.replace(/^Amazon\.com\s*:\s*/i, '');
  return title;
}

/**
 * Sanitizes candidate text strings by filtering out call-to-actions, stock statuses, and prices.
 * @param {string} text - Raw string candidate to evaluate.
 * @returns {string|null} Valid title string or null if text matches noise patterns.
 */
function cleanTitleText(text) {
  if (!text) return null;
  let cleaned = text.replace(/\s+/g, ' ').trim();
  
  // Filter out non-title action text (buttons, stock status, ratings)
  const stopWords = /^(add to cart|buy now|quick view|view details|select options|shop now|in stock|out of stock|add to wish list|\d+(\.\d+)?\s*(stars|reviews)?)$/i;
  if (stopWords.test(cleaned)) return null;
  
  // Filter out standalone price values ($19.99, £50, etc.)
  if (/^[\$\s?€£¥]\s?\d+(?:[\.,]\d{2})?$/.test(cleaned)) return null;

  return cleaned.length > 1 ? cleaned : null;
}

/**
 * Attempts to pull a meaningful title string from an image's alt/title/aria attributes.
 * @param {HTMLImageElement} img - Target image node.
 * @returns {string|null} Clean title or null if generic/missing.
 */
function getImageAltTitle(img) {
  if (!img) return null;
  const candidate = img.alt || img.title || img.getAttribute('aria-label');
  if (!candidate) return null;
  
  const text = candidate.trim();
  const genericWords = /^(product|image|photo|thumbnail|picture|item|logo|\d+)$/i;
  if (genericWords.test(text) || text.length < 3) return null;
  
  return cleanTitleText(text);
}

/* ==========================================================================
   SMART CONTAINER TEXT FALLBACK
   ========================================================================== */

/**
 * Scans leaf DOM nodes within a container card to discover deeply nested text content
 * matching character lengths typical of product titles.
 * @param {HTMLElement} container - Card/wrapper DOM node.
 * @returns {string|null} Highest confidence title string found in leaf nodes.
 */
function getSmartContainerText(container) {
  let bestText = null;
  const elements = container.querySelectorAll('*');

  for (const el of elements) {
    // Skip irrelevant structure, script, and interaction elements
    if (['SCRIPT','STYLE','NOSCRIPT','SVG','BUTTON','INPUT','OPTION','LABEL','NAV','HEADER'].includes(el.tagName)) continue;
    
    // Evaluate leaf nodes only (elements with no child HTML element nodes)
    if (el.children.length > 0) continue;

    const text = cleanTitleText(el.innerText || el.textContent);
    if (!text) continue;

    // Filter within ideal title length thresholds (5 to 140 chars)
    if (text.length >= 5 && text.length <= 140) {
      if (!bestText || text.length > bestText.length) {
        bestText = text;
      }
    }
  }

  return bestText;
}

/* ==========================================================================
   SITE & ARCHETYPE DRIVERS
   ========================================================================== */

/**
 * Domain-specific configuration drivers for targeted title & card extraction.
 */
const SITE_DRIVERS = {
  "amazon": {
    productItemSelector: '.s-result-item[data-component-type="s-search-result"]',
    titleSelector: 'h2 a span, h2 span, h2 a',
    isProductPage: () => document.getElementById('dp') !== null || document.getElementById('ppd') !== null,
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

    productItemSelector: [
      'section[class*="product"]',
      'ul[class*="product"] > li',
      'ol[class*="product"] > li',
      '.product-card-container',
      '[class*="product-card"]',
      '[class*="product-item"]',
      '[class*="grid-item"]'
    ].join(','),

    titleSelector: [
      '[class*="title" i]',
      '[class*="name" i]',
      '[class*="heading" i]',
      '[id*="title" i]',
      '[id*="name" i]',
      'h2',
      'h3',
      'h4',
      'h1',
      '[itemprop="name"]',
      'a[href*="/product/"]',
      'a[href*="/item/"]',
      'a[href*="/p/"]',
      'figcaption'
    ].join(','),

    allowedZones: 'a, button, img',

    // Heuristic detection to identify if current page is a Product Detail Page (PDP)
    isProductPage: () => {
      if (typeof getTitleFromSchema === 'function' && getTitleFromSchema()) return true;

      // Check for buy/add-to-cart button presence
      const hasBuyButton = document.querySelector(
        '#add-to-cart-button, #buy-now-button, button[id*="add-to-cart"], button[class*="add-to-cart" i], button[name="add"]'
      );
      
      // Check for primary title structures
      const hasProductTitle = document.querySelector('#productTitle, h1[class*="product" i], h1[class*="title" i]');

      return hasBuyButton !== null || hasProductTitle !== null;
    },

    productPageTitleSelector: '[itemprop="name"], h1, h2.product-title',
  }
};

/**
 * Category-based archetype configurations (e.g., real estate listings vs. e-commerce)
 */
const ARCHETYPE_DRIVERS = {
  realestate: {
    productItemSelector: [
      'article[class*="card"]',
      'li[class*="card"]',
      'li[class*="result"]',
      'li[class*="listing"]',
      '[class*="property-card"]',
      '[class*="listing-card"]',
      '[class*="home-card"]',
      '[class*="result-card"]',
      '[class*="MapHome"]',
      '[data-test*="card"]',
      '[data-testid*="card"]',
      '[data-listing-id]',
      '[data-propertyid]',
    ].join(','),

    titleSelector: [
      'address',
      '[data-test*="addr"]',
      '[data-testid*="addr"]',
      '[data-test*="street"]',
      '[class*="address"]',
      '[class*="Address"]',
      '[class*="street"]',
      '[class*="Street"]',
    ].join(','),

    // Checks URL patterns and page features (galleries, property specs) for Real Estate PDPs
    isProductPage: () => {
      const url = window.location.href;
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

    extractTitle: (container) => extractRealEstateTitle(container),
  }
};

/* ==========================================================================
   OPTIMIZED TITLE EXTRACTION PIPELINE
   ========================================================================== */

/**
 * Main execution pipeline for title resolution:
 * 1. Checks Product Detail Page (PDP) schemas, selectors, and h1 nodes.
 * 2. Checks Container-scoped targets (selectors, links, img alt, leaf nodes).
 * 3. Falls back to global page metadata / document title.
 * 
 * @param {HTMLImageElement|HTMLElement} targetImg - Clicked element or thumbnail image node.
 * @param {HTMLElement} [container] - Enclosing product card container.
 * @returns {string} Best resolved title text.
 */
function extractTitle(targetImg, container) {
  const driver = getActiveDriver();
  const isProduct = driver.isProductPage ? driver.isProductPage() : false;

  // -------------------------------------------------------------
  // STRATEGY 1: PRODUCT DETAIL PAGE (PDP)
  // -------------------------------------------------------------
  if (isProduct) {
    const schemaTitle = getTitleFromSchema();
    if (schemaTitle) return schemaTitle.trim();

    if (driver.productPageTitleSelector) {
      const el = document.querySelector(driver.productPageTitleSelector);
      const text = cleanTitleText(el?.innerText || el?.textContent);
      if (text) return text;
    }

    // Secondary PDP check: find h1 outside standard header/nav layouts
    const h1s = document.querySelectorAll('h1');
    for (const h1 of h1s) {
      if (!h1.closest('header, nav, .breadcrumb, [class*="breadcrumb"]')) {
        const text = cleanTitleText(h1.innerText || h1.textContent);
        if (text) return text;
      }
    }

    const metaTitle = getMetaTitle();
    if (metaTitle) return cleanTitleText(metaTitle);
  }

  // -------------------------------------------------------------
  // STRATEGY 2: PRODUCT CARD / LIST ITEM (Container-Scoped)
  // -------------------------------------------------------------
  const targetContainer = container && container !== document.body ? container : null;

  if (targetContainer) {
    if (driver.extractTitle) {
      const customTitle = driver.extractTitle(targetContainer);
      if (customTitle) return customTitle;
    }

    const selector = driver.titleSelector || SITE_DRIVERS.generic.titleSelector;
    const candidates = targetContainer.querySelectorAll(selector);

    for (const el of candidates) {
      if (el.closest('header, nav, .price, [class*="price"], [class*="badge"], [class*="rating"]')) continue;
      const text = cleanTitleText(el.innerText || el.textContent);
      if (text) return text;
    }

    // Secondary pass: Check all anchor links inside the card
    const links = targetContainer.querySelectorAll('a[href]');
    for (const a of links) {
      if (a.closest('.price, [class*="price"]')) continue;
      const text = cleanTitleText(a.innerText || a.textContent);
      if (text && text.length > 3) return text;
    }

    // Tertiary pass: Image alt / title attributes
    const imgAlt = getImageAltTitle(targetImg) || getImageAltTitle(targetContainer.querySelector('img'));
    if (imgAlt) return imgAlt;

    // Quaternary pass: Leaf node text scanner fallback
    const cardText = getSmartContainerText(targetContainer);
    if (cardText) return cardText;
  }

  // -------------------------------------------------------------
  // STRATEGY 3: GLOBAL FALLBACK
  // -------------------------------------------------------------
  const directImgAlt = getImageAltTitle(targetImg);
  if (directImgAlt) return directImgAlt;

  const globalMeta = getMetaTitle();
  if (globalMeta) return cleanTitleText(globalMeta);

  return getCleanedDocumentTitle();
}

/* ==========================================================================
   UTILITY & SEARCH ENGINE FUNCTIONS
   ========================================================================== */

/**
 * Detects whether the current site represents a real estate platform vs generic e-commerce.
 * @returns {string} 'realestate' or 'generic'
 */
function detectSiteArchetype() {
  const host = window.location.hostname;
  const text = document.body.innerText.toLowerCase();

  const realEstateDomains = [
    'zillow', 'redfin', 'realtor', 'trulia', 'homes.com',
    'coldwellbanker', 'century21', 'compass', 'movoto',
    'loopnet', 'crexi', 'apartments.com', 'rent.com',
  ];
  if (realEstateDomains.some(d => host.includes(d))) return 'realestate';

  // Heuristic scoring based on real estate keywords and DOM structure
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

/**
 * Retrieves active driver config based on domain matching or page archetype heuristics.
 * @returns {Object} Site driver configuration object.
 */
function getActiveDriver() {
  const host = window.location.hostname;

  if (host.includes('amazon')) return SITE_DRIVERS.amazon;

  const archetype = detectSiteArchetype();
  if (archetype === 'realestate') return ARCHETYPE_DRIVERS.realestate;
  
  return SITE_DRIVERS.generic;
}

/**
 * Cleans street address strings extracted from real estate cards.
 * @param {string} raw - Unsanitized address text.
 * @returns {string|null} Formatted street address or null.
 */
function cleanAddressText(raw) {
  if (!raw) return null;
  const first = raw.split(/[\n,|]/)[0].trim();
  if (/^\d+\s+\w/.test(first) && first.length > 5) return first;
  const full = raw.trim().replace(/\s+/g, ' ');
  if (full.length < 80) return full;
  return null;
}

/**
 * Uses TreeWalker to traverse text nodes matching standard street address regex patterns.
 * @param {HTMLElement} container - Card container element.
 * @returns {string|null} First matching street address string.
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
 * Real Estate title extractor looking for <address> tags, data attributes, address classes, or regex patterns.
 * @param {HTMLElement} container - Card wrapper element.
 * @returns {string|null} Resolved property address title.
 */
function extractRealEstateTitle(container) {
  const addressEl = container.querySelector('address');
  if (addressEl) return cleanAddressText(addressEl.textContent);

  const dataSelectors = [
    '[data-test*="addr"]', '[data-testid*="addr"]',
    '[data-test*="street"]', '[data-testid*="street"]',
  ];
  for (const sel of dataSelectors) {
    const el = container.querySelector(sel);
    if (el) return cleanAddressText(el.textContent);
  }

  const allEls = container.querySelectorAll('*');
  for (const el of allEls) {
    const cls = el.className?.toString().toLowerCase() ?? '';
    if (
      (cls.includes('address') || cls.includes('street')) &&
      !cls.includes('city') && !cls.includes('state')
    ) {
      const text = cleanAddressText(el.textContent);
      if (text) return text;
    }
  }

  return findAddressPattern(container);
}

/**
 * Evaluates candidate DOM nodes against scoring criteria to determine if they are product cards.
 * @param {HTMLElement} el - Candidate parent container.
 * @param {HTMLElement} clickedEl - Element originally clicked by user.
 * @returns {number} Confidence score (0 to 100+).
 */
function scoreProductCard(el, clickedEl) {
  if (!el || !clickedEl) return 0;
  let score = 0;

  // Bonus for containing or directly referencing the clicked target element
  const containerImg = el.querySelector("img");
  if (containerImg) {
    const isExactImage = containerImg.contains(clickedEl) || clickedEl.closest('img') === containerImg;
    const isImageSibling = clickedEl.parentElement && clickedEl.parentElement.querySelector('img') === containerImg;

    if (isExactImage || isImageSibling) {
      score += 35;
    } else {
      score += 15;
    }
  }
  
  if (el.querySelector("a[href]")) score += 25;

  // Penalty for sidebar filter panels or input-heavy forms
  const isFilterStructure = el.matches('aside, form, .sidebar, .filters');
  const hasTooManyInputs = el.querySelectorAll('input').length > 3;
  if (isFilterStructure || hasTooManyInputs) score -= 40; 

  // Content indicators (prices, specs, review ratings)
  const text = el.innerText || "";
  if (/[\$\s?€£¥]\s?\d+(?:[\.,]\d{2})?/.test(text)) score += 40;
  if (/\b(bd|ba|sqft|home|house|address)\b/i.test(text)) score += 30; 
  if (/star|review|rating/i.test(text)) score += 10;

  // Word count heuristic to penalize full page containers vs single product cards
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount >= 3 && wordCount <= 60) score += 15;
  if (wordCount > 100) score -= 20;

  return score;
}

/**
 * Walks up the DOM tree from the target element to locate the highest-scoring product card container.
 * @param {HTMLElement} startEl - Clicked target DOM node.
 * @returns {HTMLElement|null} Best matching card container or null.
 */
function findProductContainer(startEl) {
  let current = startEl;
  let bestCandidate = null;
  let highestScore = 0;

  while (current && current !== document.body) {
    const currentScore = scoreProductCard(current, startEl);
    
    // Threshold score of 55 required to qualify as a product card
    if (currentScore >= 55 && currentScore >= highestScore) {
      highestScore = currentScore;
      bestCandidate = current;
    }
    
    // Stop climbing if container dimensions exceed typical card size limits
    if (current.offsetWidth > 600 || current.offsetHeight > 700) {
      break;
    }
    
    current = current.parentElement;
  }

  return bestCandidate;
}