/* ==========================================================================
   PRODUCT PAGE EXTRACTION UTILITIES
   --------------------------------------------------------------------------
   Scrapes product metadata (titles, URLs, images) from DOM nodes on both
   grid/search pages (cards) and Product Detail Pages (PDPs).
   ========================================================================== */

const ProductPageExtractor = {
  /**
   * Main entry point to extract a clean product title.
   * Uses a tiered fallback strategy: Grid Card selectors -> Schema.org JSON-LD
   * -> Active site driver -> Top-level H1 -> Image Alt text -> OG/Page Title.
   * 
   * @param {HTMLImageElement|null} targetImg - The clicked product image element.
   * @param {HTMLElement|null} container - Surrounding card or DOM section container.
   * @returns {string} The extracted product title (defaults to "Product" if unresolved).
   */
  extractTitle(targetImg, container) {
    // Attempt to retrieve a site-specific driver (e.g., custom rules per store domain)
    const driver = typeof getActiveDriver === 'function' ? getActiveDriver() : null;

    // -------------------------------------------------------------
    // LOCAL FIRST — anything near the clicked image beats page-level data
    // -------------------------------------------------------------
    // Page-level sources (JSON-LD, <h1>, og:title) all describe the page's
    // MAIN product. On a PDP with a "you may also like" strip, or any listing
    // page, clicking a secondary image used to return the main product's name
    // instead of the one actually clicked. Anything scoped to the clicked
    // element is therefore tried first, and only genuinely page-level clicks
    // fall through to page-level data.
    const localTitle = this.extractLocalTitle(targetImg, container);
    if (localTitle) return localTitle;

    // -------------------------------------------------------------
    // PAGE-LEVEL FALLBACKS (main product of this page)
    // -------------------------------------------------------------

    // Strategy 1: Schema.org structured data (JSON-LD)
    const jsonLdTitle = this.getJsonLdProductTitle();
    if (jsonLdTitle) return jsonLdTitle;

    // Strategy 2: Custom site driver selector (if defined)
    if (driver?.productPageTitleSelector) {
      const pageTitleEl = document.querySelector(driver.productPageTitleSelector);
      const text = pageTitleEl?.innerText?.trim();
      if (this.isValidTitle(text)) return text.replace(/\s+/g, ' ');
    }

    // Strategy 3: Page <h1> tag (filtering out site headers and breadcrumbs)
    const h1s = document.querySelectorAll('h1');
    for (const h1 of h1s) {
      if (!h1.closest('nav, header, footer, .breadcrumb, [class*="breadcrumb" i]')) {
        const text = h1.innerText?.trim();
        if (this.isValidTitle(text)) return text.replace(/\s+/g, ' ');
      }
    }

    // Strategy 4: OpenGraph title tag or standard document title cleaned up
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    return this.cleanTitleText(ogTitle || document.title) || "Product";
  },

  /**
   * Finds the best title for the SPECIFIC clicked image, using only markup
   * scoped to it — never page-level metadata.
   *
   * Walks outward from the image through progressively larger ancestors,
   * scoring candidates within each. The first ancestor that yields a
   * confident candidate wins, so the nearest meaningful label is preferred
   * over one further up the tree.
   *
   * @param {HTMLImageElement|null} targetImg
   * @param {HTMLElement|null} container
   * @returns {string|null} A title, or null to fall through to page-level data.
   */
  extractLocalTitle(targetImg, container) {
    const scopes = [];

    // Walk up from the image, collecting plausible product containers. Capped
    // at 6 levels: beyond that we are into page furniture, where a match is
    // more likely to belong to a different product than the clicked one.
    let node = targetImg?.parentElement || null;
    for (let depth = 0; node && depth < 6; depth++) {
      if (node === document.body) break;
      scopes.push(node);
      node = node.parentElement;
    }
    // The picker's own idea of the card, as a last local resort.
    if (container && container !== document.body && !scopes.includes(container)) {
      scopes.push(container);
    }

    for (const scope of scopes) {
      const best = this.bestTitleInScope(scope, targetImg);
      if (best) return best;
    }

    // The image's own alt/title. Deliberately after the DOM scan: alt text is
    // often decorative ("Product image 2"), while a heading beside it is the
    // real name. isValidTitle screens the worst of those.
    const altText = targetImg?.alt?.trim() || targetImg?.title?.trim();
    if (this.isValidTitle(altText)) return altText.replace(/\s+/g, ' ');

    return null;
  },

  /**
   * Scores every candidate label inside one scope and returns the strongest.
   *
   * The previous implementation walked a fixed selector list and returned the
   * FIRST match, so a decorative element matching [class*="title"] (a badge,
   * a section heading, a "New in" flag) beat the real product name whenever it
   * happened to appear earlier in the DOM. Scoring compares candidates instead
   * of trusting document order.
   *
   * @param {HTMLElement} scope
   * @param {HTMLImageElement|null} targetImg
   * @returns {string|null}
   */
  bestTitleInScope(scope, targetImg) {
    if (!scope || !scope.querySelectorAll) return null;

    const candidates = scope.querySelectorAll(
      '[itemprop="name"], h1, h2, h3, h4, ' +
      '[class*="title" i], [class*="name" i], [class*="heading" i], ' +
      '[data-testid*="title" i], [data-testid*="name" i], ' +
      'a[href*="/product" i], a[href*="/p/" i], a[href*="/dp/" i]'
    );

    let bestText = null;
    let bestScore = -Infinity;

    for (const el of candidates) {
      // Skip anything that is page furniture rather than product labelling.
      if (el.closest('nav, header, footer, .breadcrumb, [class*="breadcrumb" i]')) continue;

      const text = el.innerText?.trim().replace(/\s+/g, ' ');
      if (!this.isValidTitle(text)) continue;
      if (text.length > 180) continue;   // a paragraph, not a name

      let score = 0;

      // Explicit semantics beat guesswork.
      if (el.matches('[itemprop="name"]')) score += 60;
      if (/^H[1-4]$/.test(el.tagName)) score += 30;
      if (el.matches('a[href*="/product" i], a[href*="/p/" i], a[href*="/dp/" i]')) score += 25;
      if (el.matches('[data-testid*="title" i], [data-testid*="name" i]')) score += 20;

      // A class merely CONTAINING "title"/"name" is weak evidence — it is what
      // was previously trusted outright, and what most often went wrong.
      if (el.matches('[class*="title" i], [class*="name" i], [class*="heading" i]')) score += 8;

      // Closeness to the clicked image, in shared-ancestor terms. The label for
      // the clicked product is nearly always nearer to it than a neighbour's.
      if (targetImg) {
        const common = this.commonAncestorDepth(el, targetImg);
        score += Math.max(0, 24 - common * 4);
      }

      // Real product names are a few words; single tokens are usually labels
      // ("New", "Sale") and very long strings are descriptions.
      const words = text.split(' ').length;
      if (words >= 2 && words <= 14) score += 12;
      if (words === 1) score -= 10;

      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    }

    // Require more than the bare minimum, so a weak match falls through to the
    // next scope out rather than locking in something dubious.
    return bestScore >= 20 ? bestText : null;
  },

  /**
   * How many levels up from `el` the nearest ancestor shared with `other` sits.
   * Used as a proximity signal — smaller means the two are more closely related.
   *
   * @returns {number} Depth, or a large number when unrelated.
   */
  commonAncestorDepth(el, other) {
    let depth = 0;
    let node = el;
    while (node && depth < 12) {
      if (node.contains(other)) return depth;
      node = node.parentElement;
      depth++;
    }
    return 99;
  },

  isValidTitle(text) {
    if (!text || text.length < 3) return false;
    
    // Ignore price strings (e.g., "$19.99", "£50")
    if (/^[\$\s?€£¥]\s?\d+/.test(text)) return false;
    
    // Filter out common e-commerce call-to-actions and placeholder text
    const stopWords = /^(add to cart|buy now|quick view|view details|select options|shop now|in stock|out of stock|image|photo|product|thumbnail)$/i;
    return !stopWords.test(text.trim());
  },

  /**
   * Cleans title strings by stripping brand suffixes, site delimiters, and Amazon prefixes.
   * 
   * @param {string} rawTitle - Raw string from meta tags or document title.
   * @returns {string|null} Cleaned title string or null if empty.
   */
  cleanTitleText(rawTitle) {
    if (!rawTitle) return null;
    let title = rawTitle.trim();
    
    // Split by common brand separators (| - — :) and take the leading segment
    title = title.split(/\s+[\|–—\-\:]\s+/)[0].trim();
    
    // Strip Amazon specific title prefixes
    title = title.replace(/^Amazon\.com\s*:\s*/i, '');
    
    return title.length > 0 ? title : null;
  },

  /**
   * Extracts the full target product URL.
   * Prefers card container anchor tags, falls back to parent image links or page URL.
   * 
   * @param {HTMLImageElement|null} targetImg - Clicked product image element.
   * @param {HTMLElement|null} container - Card container element.
   * @returns {string} Absolute product page URL.
   */
  extractProductUrl(targetImg, container) {
    // Check if the card container is an anchor itself or contains a product link
    if (container && container !== document.body) {
      const structuralLink = container.tagName === 'A' ? container : container.querySelector('a[href]');
      if (structuralLink && structuralLink.href) return structuralLink.href;
    }

    // Check closest anchor wrapping the clicked image
    const parentLink = targetImg?.closest('a[href]');
    if (parentLink) return parentLink.href;

    // Default to the current tab URL (PDP scenario)
    return window.location.href;
  },

  /**
   * Extracts the highest quality image URL from the target element.
   * 
   * @param {HTMLImageElement|null} targetImg - Clicked image element.
   * @returns {string} Image source URL (currentSrc preferred for responsive images).
   */
  extractImageUrl(targetImg) {
    // currentSrc captures the active srcset URL rendered by the browser
    return targetImg ? (targetImg.currentSrc || targetImg.src) : '';
  }
};