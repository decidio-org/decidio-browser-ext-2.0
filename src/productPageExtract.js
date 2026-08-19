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
    // IF CLICKED INSIDE A SPECIFIC CARD (Search / Grid Page)
    // -------------------------------------------------------------
    // Verify container is a specific card item rather than a main page wrapper
    const isGridCard = container && 
      container !== document.body && 
      container.tagName !== 'MAIN' && 
      !container.matches('#dp, #ppd, .product-detail, .product-single');

    if (isGridCard) {
      // Priority selector cascade for elements inside product grid cards
      const cardTitleSelectors = [
        '[class*="title" i]',
        '[class*="name" i]',
        '[class*="heading" i]',
        'h2', 'h3', 'h4',
        'a[href*="/product/"]', 'a[href*="/p/"]', 'a'
      ];

      // Loop through candidate elements within the card container
      for (const selector of cardTitleSelectors) {
        const titleEl = container.querySelector(selector);
        if (titleEl) {
          const text = titleEl.innerText?.trim();
          if (this.isValidTitle(text)) return text.replace(/\s+/g, ' ');
        }
      }

      // Fallback: Check 'alt' or 'title' attribute on the clicked image
      const altText = targetImg?.alt?.trim() || targetImg?.title?.trim();
      if (this.isValidTitle(altText)) return altText;
    }

    // -------------------------------------------------------------
    // IF ON PRODUCT DETAIL PAGE (PDP) OR FALLBACK
    // -------------------------------------------------------------
    
    // Strategy 1: Schema.org structured data (JSON-LD)
    const jsonLdTitle = this.getJsonLdProductTitle();
    if (jsonLdTitle) return jsonLdTitle;

    // Strategy 2: Custom site driver selector (if defined)
    if (driver?.productPageTitleSelector) {
      const pageTitleEl = document.querySelector(driver.productPageTitleSelector);
      const text = pageTitleEl?.innerText?.trim();
      if (text) return text;
    }

    // Strategy 3: Page <h1> tag (filtering out site headers and breadcrumbs)
    const h1s = document.querySelectorAll('h1');
    for (const h1 of h1s) {
      if (!h1.closest('nav, header, .breadcrumb, [class*="breadcrumb"]')) {
        const text = h1.innerText?.trim();
        if (text && text.length > 2) return text;
      }
    }

    // Strategy 4: Fallback to the target image's alt/title attribute
    if (targetImg) {
      const imgAlt = targetImg.alt?.trim() || targetImg.title?.trim();
      if (this.isValidTitle(imgAlt)) return imgAlt;
    }

    // Strategy 5: OpenGraph title tag or standard document title cleaned up
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    return this.cleanTitleText(ogTitle || document.title) || "Product";
  },

  /**
   * Scrapes Schema.org (JSON-LD) scripts embedded in the page to find
   * a 'Product' or 'IndividualProduct' schema name.
   * 
   * @returns {string|null} The product name from structured data, or null if missing/invalid.
   */
  getJsonLdProductTitle() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        // Normalize JSON-LD structure (handles top-level objects, arrays, and @graph wrappers)
        const items = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);

        for (const item of items) {
          if ((item['@type'] === 'Product' || item['@type'] === 'IndividualProduct') && item.name) {
            // Handle plain string names vs nested name objects
            return typeof item.name === 'string' ? item.name.trim() : item.name.name?.trim();
          }
        }
      } catch (e) {
        // Ignore JSON parsing errors for malformed vendor scripts
      }
    }
    return null;
  },

  /**
   * Validates whether candidate text is a real product title rather than a price or CTA button.
   * 
   * @param {string} text - The candidate title text.
   * @returns {boolean} True if the string meets title criteria.
   */
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