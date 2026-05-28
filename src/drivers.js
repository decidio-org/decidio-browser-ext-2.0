// Test to see if molding the extension to the format of certain sites can improve issues with the cards being selectable in areas it shouldn't be

export const SITE_DRIVERS = {
    "amazon": {
      productItemSelector: '.s-result-item[data-component-type="s-search-result"]',
      titleSelector: 'h2 a span, .a-size-base-plus.a-color-base.a-text-normal',
      allowedZones: '.s-image, .a-price, h2 a'
    },
    "zillow": {
        productItemSelector: [
            'li[class*="CarouselSlide"]',       // The carousel items
            'div[class*="srp-"]',               // The main search result cards
            '[class*="ListItem"]',              // Backup for standard list views
            'article'                           // Semantic fallback container
        ].join(','),
      
      // Zillow universally places the house address inside an <address> tag
      titleSelector: 'address, [class*="PropertyCardAddress"]',
      allowedZones: 'a, address, button'
    },
    "generic": { 
      productItemSelector: 'a, .product-card-container, [class*="product-item"], article, h1',
      titleSelector: 'h1, h2, h3, .title, [class*="title"]',
      allowedZones: 'a, button, img'
    }
  };
  
  // Helper function to figure out which site rules to apply
  export function getActiveDriver() {
    const host = window.location.hostname;
    if (host.includes('amazon')) return SITE_DRIVERS.amazon;
    if (host.includes('zillow')) return SITE_DRIVERS.zillow;
    return SITE_DRIVERS.generic;
  }