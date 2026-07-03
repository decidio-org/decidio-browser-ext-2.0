/**
 * Main Pipeline Orchestrator
 */
async function orchestrateProductPipeline(payload) {
  const targetUrl = payload.url;

  // LOCAL CACHING: Read verification pass
  const cacheCheck = await chrome.storage.local.get(targetUrl);
  if (cacheCheck && cacheCheck[targetUrl]) {
    console.log("decidio: URL Collected ->", targetUrl);
    return cacheCheck[targetUrl];
  }

  console.log("decidio: Spawning background scraper tab ->", targetUrl);
  let scraperTab = null;
  let scriptResult = null;
  
  try {
    const scraperWindow = await chrome.windows.create({
      url: targetUrl,
      type: 'popup',
      state: 'minimized',
      focused: false
    });

    scraperTab = scraperWindow.tabs?.[0] || (await chrome.tabs.query({ windowId: scraperWindow.id }))[0];

    // Wait using our utility function
    await Promise.race([
      waitForTabComplete(scraperTab.id),
      new Promise(resolve => setTimeout(resolve, 4000))
    ]);

    // Dynamically pick between standard extraction or Shopify driver
    const isShopifySite = targetUrl.includes('myshopify') || payload.isShopify;
    const extractionFunction = isShopifySite ? runShopifyExtractionScript : runDomExtractionScript;

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: scraperTab.id },
      func: extractionFunction
    });

    scriptResult = injectionResults[0]?.result;

  } catch (scrapeError) {
    console.error("decidio: Background scraping pass failed:", scrapeError);
  } finally {
    if (scraperTab && scraperTab.id) {
      await chrome.tabs.remove(scraperTab.id).catch(() => {});
    }
  }

  // Data mapping
  const rawTextContent = scriptResult?.text || "";
  const extractedJsonLd = scriptResult?.jsonLd || null;
  const parsedRawSpecs = scriptResult?.specMap || {};
  
  payload.raw_features = scriptResult?.featuresList || [];
  payload.raw_webpage_text = rawTextContent;
  payload.json_ld_data = extractedJsonLd;
  payload.raw_specs = parsedRawSpecs;

  // Process JSON-LD Data via utilities
  let finalAmount = 0.0;
  let finalCurrency = "USD";
  let extractedImages = [];

  if (extractedJsonLd) {
    const scanResults = scanJsonLdData(extractedJsonLd);
    finalAmount = scanResults.finalAmount;
    finalCurrency = scanResults.finalCurrency;
    extractedImages = [...scanResults.imageSet];
  }
  payload.images = extractedImages;

  // Fallbacks
  if (finalAmount === 0.0 && scriptResult?.metaPrice) {
    finalAmount = parseFloat(scriptResult.metaPrice) || 0.0;
    if (scriptResult.metaCurrency) finalCurrency = scriptResult.metaCurrency.toUpperCase();
  }
  if (finalAmount === 0.0 && payload.price && typeof payload.price === 'string') {
    finalAmount = parseFloat(payload.price.replace(/[^0-9.]/g, '')) || 0.0;
  }
  payload.price = { amount: finalAmount, currency: finalCurrency };

  // Building final payload
  const finalizedCanonicalJson = {
    product_type: "Unknown", // TO DO: Use fetchProductClassification later
    name: payload.name || "Unknown",
    price: payload.price || { amount: 0.00, currency: "USD" },
    raw_specs: payload.raw_specs || {},
    raw_features: payload.raw_features || [],
    images: payload.images || []
  };

  if (finalizedCanonicalJson) {
    finalizedCanonicalJson._debugJsonLd = extractedJsonLd;
    await chrome.storage.local.set({ [targetUrl]: finalizedCanonicalJson });
    
    // TO DO: callHarmonizeEndpoint(finalizedCanonicalJson.product_type, finalizedCanonicalJson) ? Outdated
  }

  return finalizedCanonicalJson;
}

/**
 * FUTURE WORK BLOCKS
 */
/* async function fetchProductClassification(payload) {
  // Classification logic here
} 

async function callHarmonizeEndpoint(productType, payload) {
  // Harmonization logic here
} 
*/