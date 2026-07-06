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
    brand: payload.brand || null,
    price: payload.price || { amount: 0.00, currency: "USD" },
    raw_specs: payload.raw_specs || {},
    raw_features: payload.raw_features || [],
    raw_sections: {
      webpage_text: payload.raw_webpage_text || "",
      images: payload.images || []
    },
    source_url: targetUrl
  };


  try {
    // Push data to the API ingestion path without blocking
    await callIngestEndpoint(finalizedCanonicalJson).catch(err => {
      console.warn("decidio: API Ingestion failed/bypassed, continuing to UI rendering:", err);
    });
    
    // Cache a tracking status locally
    await chrome.storage.local.set({ 
      [targetUrl]: { status: "ingested", timestamp: Date.now() } 
    });
    
    // Merge success flag directly with scraped data
    return { 
      success: true, 
      message: "Product data offloaded.",
      ...finalizedCanonicalJson 
    }; 
    
  } catch (apiError) {
    console.error("decidio: Critical pipeline failure fallback:", apiError);
    return {
      success: false,
      message: "Operating in offline mode.",
      ...finalizedCanonicalJson
    };
  }
}

/**
 * Upload scraped product to backend
 */
async function callIngestEndpoint(payload) {

  const API_URL =
    "https://decidio-api-production.up.railway.app";

  const { jwtToken } =
    await chrome.storage.local.get("jwtToken");

  const activeToken =
    jwtToken ||
    (typeof JWT_TOKEN !== "undefined"
      ? JWT_TOKEN
      : null);

  if (!activeToken) {
    throw new Error(
      "Missing authentication token."
    );
  }

  // Map the local payload to match schema fields
  const apiRequestBody = {
    product_type: payload.product_type || "Unknown",
    name: payload.name || "Unknown",
    brand: payload.brand || null,
    price: payload.price || { amount: 0.0, currency: "USD" },
    raw_specs: payload.raw_specs || {},
    raw_features: payload.raw_features || [],
    raw_sections: payload.raw_sections || {},
    source_url: payload.source_url || null
  };

  // Fire to the products endpoint
  const response = await fetch(`${API_URL}/api/products/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${activeToken}` // Injecting the live token securely
    },
    body: JSON.stringify(apiRequestBody)
  });

  if (!response.ok) {
    throw new Error(`API Ingestion responded with code: ${response.status}`);
  }

  return await response.json();
}