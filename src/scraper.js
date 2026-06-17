/**
 * scraper.js contain scraping pipeline
 */

const BACKEND_URL = 'http://localhost:8000';
const KNOWN_TYPES = ['coffee_maker', 'grinder', 'laptop', 'smartphone', 'keyboard'];


/**
 * ====================================================
 * HARMONIZATION EXTENSION PIPELINE
 * ====================================================
 */
async function orchestrateProductPipeline(payload) {
    const targetUrl = payload.url;
  
    // LOCAL CACHING: Read verification pass
    const cacheCheck = await chrome.storage.local.get(targetUrl);
    if (cacheCheck && cacheCheck[targetUrl]) {
      console.log("decidio: URL Collected ->", targetUrl);
      return cacheCheck[targetUrl];
    }
  
    // Stealth background tab scraper
    console.log("decidio: Spawning background scraper tab ->", targetUrl);
    let rawTextContent = "";
    let extractedJsonLd = null;
    let scraperTab = null;
    
    try {
      // Create a non-active background tab using the user's browser context (cookies/session)
      scraperTab = await chrome.tabs.create({
        url: targetUrl,
        active: false
      });
  
      // Wait for the tab loading status to hit 'complete' (with a 4-second cutoff fallback)
      await Promise.race([
        waitForTabComplete(scraperTab.id),
        new Promise(resolve => setTimeout(resolve, 4000))
      ]);
  
      // Inject a script to pull the text body
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: scraperTab.id },
        func: () => {
            // Grab raw text
            const text = document.body.innerText;
          
            // Grab and parse JSON-LD scripts
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            const jsonDataArray = [];
          
            jsonLdScripts.forEach(script => {
                try {
                    const cleanedText = script.innerText.trim();
                    if (cleanedText) {
                      const parsed = JSON.parse(cleanedText);
                      if (parsed) jsonDataArray.push(parsed);
                    }
                } catch (e) {
                // Ignore malformed JSON-LD elements
                }
            });
          
            return {
                text: text,
                jsonLd: jsonDataArray.length > 0 ? jsonDataArray : null
          };
        }
      });
  
      const scriptResult = injectionResults[0]?.result;
      rawTextContent = scriptResult?.text || "";
      extractedJsonLd = scriptResult?.jsonLd || null;

      console.log(`decidio: Scraped ${rawTextContent.length} characters.`);
      if (extractedJsonLd) {
        console.log("decidio: JSON-LD Structured Data Found:", extractedJsonLd);
      }
  
    } catch (scrapeError) {
      console.error("decidio: Background scraping pass failed:", scrapeError);
    } finally {
      // Always close the background tab to prevent memory leaks
      if (scraperTab && scraperTab.id) {
        await chrome.tabs.remove(scraperTab.id).catch(() => {});
      }
    }
  
    payload.raw_webpage_text = rawTextContent;
    payload.json_ld_data = extractedJsonLd;
  
    // PRODUCT TYPE CLASSIFICATION: Call the backend /classify endpoint
    console.log("decidio: Initiating classification pass...");
    const productType = await fetchProductClassification(payload);
    
    let finalizedCanonicalJson = null;
  
    // ROUTING LOGIC: Determine endpoint paths using known types list
    if (KNOWN_TYPES.includes(productType)) {
      console.log(`decidio: Known type [${productType}] detected. Routing to /harmonize...`);
      // REQUEST BUILDER: Send data to backend service
      finalizedCanonicalJson = await callHarmonizeEndpoint(productType, payload);
    } else {
      console.log(`decidio: Unknown type [${productType}]. Falling back to Gemini Flash...`);
      // Fallback to current pipeline path
      finalizedCanonicalJson = await callGeminiFlashPipelineFallback(productType, payload);
    }
  
    // LOCAL CACHING: Write verification cache pass on success
    if (finalizedCanonicalJson && !finalizedCanonicalJson.error) {
        finalizedCanonicalJson._debugJsonLd = extractedJsonLd;
        await chrome.storage.local.set({ [targetUrl]: finalizedCanonicalJson });
    }
  
    return finalizedCanonicalJson;
  }
  
  /**
   * Endpoint Connection Tasks
   */
  async function fetchProductClassification(payload) {
    try {
      const response = await fetch(`${BACKEND_URL}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          url: payload.url,
          raw_specs: payload.raw_specs,
          raw_webpage_text: payload.raw_webpage_text, // Sent if backend wants to classify using page text??
          json_ld_data: payload.json_ld_data // Send to backend if json-ld is helpful?????
        })
      });
  
    if (!response.ok) throw new Error(`Classification failure: ${response.statusText}`);
      const data = await response.json(); // Expected "shape": { product_type, confidence }
      return data.product_type || 'unknown';
    } catch (err) {
      console.error("Classification error encountered, assigning unknown:", err);
      return 'unknown';
    }
  }
  
  async function callHarmonizeEndpoint(productType, payload) {
    // REQUEST BUILDER (extension -> harmonization)
    const harmonizeRequestPayload = {
      product_type: productType,
      name: payload.name,
      price: payload.price,
      raw_specs: payload.raw_specs,
      raw_features: payload.raw_features,
      raw_webpage_text: payload.raw_webpage_text,
      json_ld_data: payload.json_ld_data
    };
  
    const response = await fetch(`${BACKEND_URL}/harmonize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(harmonizeRequestPayload)
    });
  
    if (!response.ok) {
      throw new Error(`Harmonizer returned status error code: ${response.status}`);
    }
  
    return await response.json(); // RECEIVE AND RETURN CANONICAL SPEC JSON OBJECT
  }
  
  async function callGeminiFlashPipelineFallback(productType, payload) {
    // Matches routing rules to hit "legacy" pipeline setup
    const response = await fetch(`${BACKEND_URL}/gemini-flash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_type: productType,
        name: payload.name,
        raw_specs: payload.raw_specs,
        raw_features: payload.raw_features,
        url: payload.url,
        raw_webpage_text: payload.raw_webpage_text,
        json_ld_data: payload.json_ld_data
      })
    });
  
    if (!response.ok) {
      throw new Error(`Gemini Flash pipeline fallback returned error status: ${response.status}`);
    }
  
    return await response.json();
  }
  
  /**
   * Tracks background tab's loading cycle and resolves once completely loaded
   */
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
  
  /**
   * ====================================================
   * Not sure to delete this or not? Maybe wait until we
   * connect gemini for testing?
   * ====================================================
   */
  async function callYourAIService(title, url) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    try {
      const jsonUrl = chrome.runtime.getURL('sample.json');
      const response = await fetch(jsonUrl);
      if (!response.ok) throw new Error(`Failed to read sample.json: ${response.statusText}`);
      return await response.json();
    } catch (err) {
      console.error("Error reading local sample.json asset:", err);
      throw err;
    }
  }