/**
 * Dedicated Shopify Extraction Driver
 * Runs inside the context of the scraped tab when a Shopify layout is detected.
 */
async function runShopifyExtractionScript() {
  // Grab metadata
  let crawledMetaPrice = null;
  let crawledMetaCurrency = null;
  const priceMeta = document.querySelector('meta[property="og:price:amount"], meta[itemprop="price"]');
  const currencyMeta = document.querySelector('meta[property="og:price:currency"], meta[itemprop="priceCurrency"]');
  
  if (priceMeta) crawledMetaPrice = priceMeta.getAttribute('content');
  if (currencyMeta) crawledMetaCurrency = currencyMeta.getAttribute('content');

  // Shopify Extractor
  const specDictionary = {};
  const foundShopifyColors = [];
  const foundShopifySizes = [];
  
  const shopifyOptions = document.querySelectorAll(
    'form[action*="/cart/add"] select option, select[id*="product-select"] option, select[class*="variant"] option, .product-form__variants option'
  );

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

  // Fallback to basic JSON-LD
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  const jsonDataArray = [];
  jsonLdScripts.forEach(script => {
    try {
      const parsed = JSON.parse(script.innerText.trim());
      if (parsed) jsonDataArray.push(parsed);
    } catch (e) {}
  });

  // Pruning the body
  const bodyClone = document.body.cloneNode(true);
  const junkSelectors = 'nav, footer, header, script, style, iframe, svg, noscript';
  bodyClone.querySelectorAll(junkSelectors).forEach(el => el.remove());
  const prunedBodyText = bodyClone.innerText.replace(/\n\s*\n/g, '\n').trim();

  return {
    text: prunedBodyText,
    specMap: specDictionary,
    featuresList: [],
    jsonLd: jsonDataArray.length > 0 ? jsonDataArray : null,
    metaPrice: crawledMetaPrice,
    metaCurrency: crawledMetaCurrency
  };
}