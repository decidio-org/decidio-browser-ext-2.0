/**
 * Utility function to recursively scan JSON-LD objects for prices and images.
 * Keeps primary pipeline file clear of recursive scanning logic.
 */
function scanJsonLdData(obj, context = { finalAmount: 0.0, finalCurrency: "USD", imageSet: new Set() }) {
  if (!obj || typeof obj !== 'object') return context;

  if (Array.isArray(obj)) {
    obj.forEach(item => scanJsonLdData(item, context));
    return context;
  }

  // Price Matching
  const priceVal = obj.price || obj.lowPrice || obj.highPrice;
  if (priceVal && context.finalAmount === 0.0) {
    const parsedPrice = parseFloat(String(priceVal).replace(/[^0-9.]/g, ''));
    if (!isNaN(parsedPrice) && parsedPrice > 0) {
      context.finalAmount = parsedPrice;
      context.finalCurrency = obj.priceCurrency || "USD";
    }
  }

  // Image Extraction
  const imageVal = obj.image || obj.images || obj.associatedMedia || obj.contentUrl;
  if (imageVal) {
    if (typeof imageVal === 'string' && imageVal.trim().length > 0) {
      context.imageSet.add(imageVal.trim());
    } else if (Array.isArray(imageVal)) {
      imageVal.forEach(img => {
        if (typeof img === 'string' && img.trim().length > 0) {
          context.imageSet.add(img.trim());
        } else if (img && typeof img === 'object') {
          const url = img.url || img.contentUrl;
          if (url && typeof url === 'string') context.imageSet.add(url.trim());
        }
      });
    } else if (typeof imageVal === 'object') {
      const url = imageVal.url || imageVal.contentUrl;
      if (url && typeof url === 'string') context.imageSet.add(url.trim());
    }
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        scanJsonLdData(obj[key], context);
      }
    }
  }

  return context;
}

/**
 * This heavy script is executed strictly inside the context of the scraped tab.
 * It deals with UI expansions, meta tags, and site-specific frameworks like Shopify.
 */
async function runDomExtractionScript() {
  // Tiny internal utility to click elements and detect if we need to wait
  const clickMatchingElements = (selector, regex) => {
    let didClick = false;
    document.querySelectorAll(selector).forEach(el => {
      if (regex.test(el.innerText || el.textContent)) {
        try {
          // Ensure it's not a standard link redirect and that it's visible
          const isNotRedirect = !el.getAttribute('href') || el.getAttribute('href').startsWith('#');
          const isVisible = el.offsetWidth > 0 || el.offsetHeight > 0;
          
          if (isNotRedirect && isVisible) {
            el.click();
            didClick = true;
          }
        } catch (e) {}
      }
    });
    return didClick;
  };

  // AUTO-EXPAND TABS & ACCORDIONS
  const specKeywords = /details|specifications|tech\s*specs|product\s*details|features|sizing|care/i;
  const tabSelectors = 'button, a, summary, .tab, [role="tab"], .accordion-header, h2, h3';
  
  // Call the helper. If it returns true (meaning it actually clicked something), we wait.
  if (clickMatchingElements(tabSelectors, specKeywords)) {
    await new Promise(resolve => setTimeout(resolve, 300)); 
  }

  // FIND AND CLICK "SHOW MORE" BUTTONS
  const showMoreKeywords = /show\s*more|view\s*more|read\s*more|expand|see\s*all/i;
  const buttonSelectors = 'button, a, span, div[role="button"]';
  
  // Call the helper again for show more items.
  if (clickMatchingElements(buttonSelectors, showMoreKeywords)) {
    await new Promise(resolve => setTimeout(resolve, 300)); 
  }

  // EXTRACT PRICE META TAGS
  let crawledMetaPrice = null;
  let crawledMetaCurrency = null;
  const priceMeta = document.querySelector('meta[property="og:price:amount"], meta[property="product:price:amount"], meta[itemprop="price"]');
  const currencyMeta = document.querySelector('meta[property="og:price:currency"], meta[property="product:price:currency"], meta[itemprop="priceCurrency"]');
  
  if (priceMeta) crawledMetaPrice = priceMeta.getAttribute('content');
  if (currencyMeta) crawledMetaCurrency = currencyMeta.getAttribute('content');

  // GRAB AND PARSE JSON-LD STRUCTURED DATA
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  const jsonDataArray = [];
  jsonLdScripts.forEach(script => {
    try {
      const cleanedText = script.innerText.trim();
      if (cleanedText) {
        const parsed = JSON.parse(cleanedText);
        if (parsed) jsonDataArray.push(parsed);
      }
    } catch (e) {}
  });

  const specDictionary = {};
  const rawFeaturesArray = [];
  
  // EXTRACT DETAILS / BLOCKS
  const targetDetailContainers = document.querySelectorAll('.product-details, #product-details, .details, #details, [class*="description"], [class*="detail"]');
  targetDetailContainers.forEach(container => {
    container.querySelectorAll('p, li').forEach(el => {
      const text = el.innerText ? el.innerText.trim() : "";
      if (text && text.length > 10 && text.length < 500) {
        if (text.includes(':') && !text.includes('\n')) {
          const parts = text.split(':');
          specDictionary[parts[0].trim()] = parts.slice(1).join(':').trim();
        } else {
          if (!rawFeaturesArray.includes(text)) {
            rawFeaturesArray.push(text);
          }
        }
      }
    });
  });

  // EXTRACT RETAIL SIZE GRIDS
  const sizeElements = document.querySelectorAll(
    '.size-swatches, .swatch-value, [class*="size"] button, [class*="size"] span, .swatch-anchor, [id*="size"] option, [class*="size"] option, select[name*="size"] option'
  );
  const foundSizes = [];
  const sizeRegex = /^([xsmlxl|xxl|small|medium|large]+)$|^([0-9./\s\-x]+)$/i;

  sizeElements.forEach(el => {
    const txt = (el.innerText || el.getAttribute('data-attr-value') || el.value || "").trim();
    if (txt && txt.length > 0 && txt.length < 15 && !/guide|select/i.test(txt)) {
      const lowerTxt = txt.toLowerCase();
      const isStandardSize = ['s','m','l','xl','xs','xxl','small','medium','large'].includes(lowerTxt);
      const isDynamicSize = sizeRegex.test(lowerTxt) || lowerTxt.includes('short') || lowerTxt.includes('long');
      
      if (isStandardSize || isDynamicSize) {
        foundSizes.push(txt.toUpperCase());
      }
    }
  });
  if (foundSizes.length > 0) {
    specDictionary["Size"] = [...new Set(foundSizes)].join(', ');
  }

  // SHOPIFY MULTI-VARIANT EXTRACTOR
  const foundShopifyColors = [];
  const foundShopifySizes = [];
  const shopifyOptions = document.querySelectorAll('form[action*="/cart/add"] select option, select[id*="product-select"] option, select[class*="variant"] option, .product-form__variants option');

  shopifyOptions.forEach(opt => {
    let text = opt.innerText || "";
    if (text.includes('-')) text = text.split('-')[0].trim();

    if (text.includes('/')) {
      const parts = text.split('/');
      const firstPart = parts[0].trim();
      const secondPart = parts[1].trim();
      const sizeKeywords = /small|medium|large|xl|xs|^[smlx]+$/i;

      if (sizeKeywords.test(firstPart) || !isNaN(firstPart)) {
        if (firstPart) foundShopifySizes.push(firstPart);
        if (secondPart) foundShopifyColors.push(secondPart);
      } else {
        if (firstPart) foundShopifyColors.push(firstPart);
        if (secondPart) foundShopifySizes.push(secondPart);
      }
    } else {
      if (text && text.length < 30 && !/select|choose/i.test(text)) {
        if (isNaN(text) && !['s','m','l','xl','xs'].includes(text.toLowerCase())) {
          foundShopifyColors.push(text.trim());
        }
      }
    }
  });

  if (foundShopifyColors.length > 0) specDictionary["Color"] = [...new Set(foundShopifyColors)].join(', ');
  if (foundShopifySizes.length > 0) specDictionary["Size"] = [...new Set(foundShopifySizes)].join(', ');

  // TABLE SPECS
  document.querySelectorAll('table tr').forEach(row => {
    const cells = row.querySelectorAll('td, th');
    if (cells.length >= 2) {
      const label = cells[0].innerText ? cells[0].innerText.trim() : "";
      const value = cells[1].innerText ? cells[1].innerText.trim() : "";
      if (label && value && label.length < 50 && value.length < 300) {
        const cleanLabel = label.replace(/:$/, '').trim();
        if (!specDictionary[cleanLabel]) specDictionary[cleanLabel] = value;
      }
    }
  });

  // INLINE COLON FALLBACK
  document.querySelectorAll('li, [class*="attribute"]').forEach(el => {
    const text = el.innerText ? el.innerText.trim() : "";
    if (text.includes(':') && !text.includes('\n')) {
      const parts = text.split(':');
      const label = parts[0].trim();
      const value = parts.slice(1).join(':').trim();
      if (label && value && label.length < 40 && value.length < 150 && !specDictionary[label]) {
        specDictionary[label] = value;
      }
    }
  });

  // JUNK PRUNING
  const bodyClone = document.body.cloneNode(true);
  const junkSelectors = 'nav, footer, header, script, style, iframe, svg, noscript, [class*="footer"], [class*="header"], [id*="footer"], [id*="header"], .reviews, #reviews, .comments, .related-products';
  bodyClone.querySelectorAll(junkSelectors).forEach(el => el.remove());
  const prunedBodyText = bodyClone.innerText.replace(/\n\s*\n/g, '\n').trim();

  return {
    text: prunedBodyText,
    specMap: specDictionary,
    featuresList: rawFeaturesArray,
    jsonLd: jsonDataArray.length > 0 ? jsonDataArray : null,
    metaPrice: crawledMetaPrice,
    metaCurrency: crawledMetaCurrency
  };
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}