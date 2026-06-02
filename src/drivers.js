// Test to see if molding the extension to the format of certain sites can improve issues with the cards being selectable in areas it shouldn't be

const SITE_DRIVERS = {
  "amazon": {
    productItemSelector: '.s-result-item[data-component-type="s-search-result"]',
    titleSelector: 'h2 a span, .a-size-base-plus.a-color-base.a-text-normal',
    allowedZones: '.s-image, .a-price, h2 a',
    
    // Amazon specific detail page check
    isProductPage: () => {
      return document.getElementById('dp') !== null || document.getElementById('ppd') !== null;
    },
    productPageTitleSelector: '#productTitle',
    productPageDescSelector: '#feature-bullets'
  },
  "zillow": {
    productItemSelector: [
        'li[class*="CarouselSlide"]',       // The carousel items
        'div[class*="srp-"]',               // The main search result cards
        '[class*="ListItem"]'               // Backup for standard list views
    ].join(','),
    
    titleSelector: 'address, [class*="PropertyCardAddress"]',
    allowedZones: 'a, address, button',

    isProductPage: () => {
      // Zillow's individual listing pages usually have a dedicated summary container
      return document.querySelector('[class*="pdp-"]') !== null || window.location.href.includes('/homedetails/');
    },
    productPageTitleSelector: 'h1[class*="StyledHeading"], [class*="PropertyAddress"]',
    productPageDescSelector: '[class*="Text-c11n"]'
  },
  "generic": { 
    productItemSelector: '.product-card-container, [class*="product-card"], [class*="product-item"], [class*="grid-item"]',
    titleSelector: 'h2, h3, .title, [class*="title"], [class*="name"]',
    allowedZones: 'a, button, img',

    // --- GLOBAL E-COMMERCE PRODUCT PAGE DETECTOR ---
    // This is for the product page ver. of extension
    isProductPage: () => {
      // Check for common e-commerce "Add to Cart" or checkout button attributes
      const hasBuyButton = document.querySelector([
        'button[name="add-to-cart"]',
        'button[id*="AddToCart"]',
        'button[class*="add-to-cart"]',
        'input[type="submit"][value*="Cart" i]',
        'button[data-testid*="add-to-cart"]',
        '#add-to-cart-button'
      ].join(','));

      if (hasBuyButton) return true;

      // Does the URL look like a standard product listing...
      const url = window.location.pathname.toLowerCase();
      if (url.includes('/product/') || url.includes('/p/') || url.includes('/item/')) {
        return true;
      }

      // Alternate fallback: Check for embedded product metadata schema
      const hasProductSchema = document.querySelector('script[type="application/ld+json"]');
      if (hasProductSchema && hasProductSchema.innerText.includes('"@type": "Product"')) {
        return true;
      }

      return false;
    },
    // E-commerce standard design practice dictates the product name is the primary H1
    productPageTitleSelector: 'h1',
    productPageDescSelector: '.product-description, #description, [class*="description"]'
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