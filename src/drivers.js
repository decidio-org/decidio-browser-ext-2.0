// Test to see if molding the extension to the format of certain sites can improve issues with the cards being selectable in areas it shouldn't be
const SITE_DRIVERS = {
  "amazon": {
    productItemSelector: '.s-result-item[data-component-type="s-search-result"]',
    titleSelector: 'h2 a span, .a-size-base-plus.a-color-base.a-text-normal',
    allowedZones: '.s-image, .a-price, h2 a'
  },
  "zillow": {
    // REMOVED 'article' because headers/layout containers often use semantic article blocks
    productItemSelector: [
        'li[class*="CarouselSlide"]',       // The carousel items
        'div[class*="srp-"]',               // The main search result cards
        '[class*="ListItem"]'               // Backup for standard list views
    ].join(','),
    
    titleSelector: 'address, [class*="PropertyCardAddress"]',
    allowedZones: 'a, address, button'
  },
  "generic": { 
    // CLEANED: Removed 'a' and 'h1' so header links and titles don't act as product containers
    productItemSelector: '.product-card-container, [class*="product-card"], [class*="product-item"], [class*="grid-item"]',
    titleSelector: 'h2, h3, .title, [class*="title"], [class*="name"]',
    allowedZones: 'a, button, img'
  }
};

// Helper function to figure out which site rules to apply
function getActiveDriver() {
  const host = window.location.hostname;
  if (host.includes('amazon')) return SITE_DRIVERS.amazon;
  if (host.includes('zillow')) return SITE_DRIVERS.zillow;
  return SITE_DRIVERS.generic;
}