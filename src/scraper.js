/**
 * scraper.js contain scraping pipeline
 */

const BACKEND_URL = 'http://localhost:8000';


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
    let parsedRawSpecs = {};
    let metaPrice = null;
    let metaCurrency = null;
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
          // AUTO-EXPAND TABS & ACCORDIONS
          const specKeywords = /details|specifications|tech\s*specs|product\s*details|features|sizing|care/i;
          
          // Find buttons, tabs, or headers that might hide specs and click them
          const interactiveElements = document.querySelectorAll('button, a, summary, .tab, [role="tab"], .accordion-header, h2, h3');
          interactiveElements.forEach(el => {
            if (specKeywords.test(el.innerText || el.textContent)) {
              try {
                // Only click if it doesn't look like it redirects to a completely new page URL
                if (!el.getAttribute('href') || el.getAttribute('href').startsWith('#')) {
                  el.click();
                }
              } catch (e) {
                // Fail silently if click is blocked
              }
            }
          });

          // Slight delay to let clicked dynamic areas render content templates
          const start = Date.now(); while (Date.now() - start < 400) {}

          // EXTRACT PRICE META TAGS DIRECTLY FROM THE DOM BEFORE STRIPPING HTML
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

          // DICTIONARY SPEC EXTRACTION
          const specDictionary = {};
          const rawFeaturesArray = [];

          // EXTRACT DETAILS / BLOCKS (Look for "Details", "Fit & Sizing" sections)
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

          // EXTRACT RETAIL SIZE GRIDS & ACCEPTS CHOSEN DROP-DOWN SELECT ELEMENT VALUES
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
            specDictionary["Available Sizes"] = [...new Set(foundSizes)].join(', ');
          }

          // FALLBACK GENERAL COLON SCRAPER
          document.querySelectorAll('table tr, li, [class*="attribute"]').forEach(el => {
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

          // ESCAPE PRUNED BODY
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
      });
  
      const scriptResult = injectionResults[0]?.result;
      rawTextContent = scriptResult?.text || "";
      extractedJsonLd = scriptResult?.jsonLd || null;
      parsedRawSpecs = scriptResult?.specMap || {};
      metaPrice = scriptResult?.metaPrice || null;
      metaCurrency = scriptResult?.metaCurrency || null;
      payload.raw_features = scriptResult?.featuresList || [];

      console.log(`decidio: Scraped ${rawTextContent.length} characters.`);
      console.log("decidio: Map of raw specs gathered for Harmonizer:", parsedRawSpecs);
      if (extractedJsonLd) {
        console.log("decidio: JSON-LD Structured Data Found:", extractedJsonLd);
      }
  
    } catch (scrapeError) {
      console.error("decidio: Background scraping pass failed:", scrapeError);
    } finally {
      if (scraperTab && scraperTab.id) {
        await chrome.tabs.remove(scraperTab.id).catch(() => {});
      }
    }
  
    payload.raw_webpage_text = rawTextContent;
    payload.json_ld_data = extractedJsonLd;
    payload.raw_specs = parsedRawSpecs;
  

    // PIPELINE STRATEGY: PARSE VALUE PRICE OBJECTS
    let finalAmount = 0.0;
    let finalCurrency = "USD";
    const imageSet = new Set();

    if (extractedJsonLd) {
      const fastScan = (obj) => {
        if (!obj || typeof obj !== 'object') return;

        // Handle Array structures immediately by scanning elements
        if (Array.isArray(obj)) {
          obj.forEach(item => fastScan(item));
          return;
        }

        // PRICE MATCHING
        const priceVal = obj.price || obj.lowPrice || obj.highPrice;
        if (priceVal && finalAmount === 0.0) {
          const parsedPrice = parseFloat(String(priceVal).replace(/[^0-9.]/g, ''));
          if (!isNaN(parsedPrice) && parsedPrice > 0) {
            finalAmount = parsedPrice;
            finalCurrency = obj.priceCurrency || "USD";
          }
        }

        // IMAGE EXTRACTION (Strings, Arrays, and Nested URL Objects)
        const imageVal = obj.image || obj.images || obj.associatedMedia || obj.contentUrl;
        if (imageVal) {
          if (typeof imageVal === 'string' && imageVal.trim().length > 0) {
            imageSet.add(imageVal.trim());
          } else if (Array.isArray(imageVal)) {
            imageVal.forEach(img => {
              if (typeof img === 'string' && img.trim().length > 0) {
                imageSet.add(img.trim());
              } else if (img && typeof img === 'object') {
                const url = img.url || img.contentUrl;
                if (url && typeof url === 'string') imageSet.add(url.trim());
              }
            });
          } else if (typeof imageVal === 'object') {
            const url = imageVal.url || imageVal.contentUrl;
            if (url && typeof url === 'string') imageSet.add(url.trim());
          }
        }

        // Recursively crawl nested nodes safely
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            // Avoid re-scanning arrays twice if processed above
            if (typeof obj[key] === 'object' && obj[key] !== null) {
              fastScan(obj[key]);
            }
          }
        }
      };

      fastScan(extractedJsonLd);
    }

    // Instantly convert to an array of unique image URLs
    payload.images = [...imageSet];

    // Fallback to Meta data found directly in DOM
    if (finalAmount === 0.0 && metaPrice) {
      finalAmount = parseFloat(metaPrice) || 0.0;
      if (metaCurrency) finalCurrency = metaCurrency.toUpperCase();
    }

    // Fallback to raw string manipulation strings
    if (finalAmount === 0.0 && payload.price && typeof payload.price === 'string') {
      finalAmount = parseFloat(payload.price.replace(/[^0-9.]/g, '')) || 0.0;
    }

    payload.price = {
       amount: finalAmount,
       currency: finalCurrency
    };


    // PRODUCT TYPE CLASSIFICATION
    console.log("decidio: Formatting raw data...");
    
    const finalizedCanonicalJson = {
      product_type: "Unknown",
      name: payload.name || "Unknown",
      price: payload.price || { amount: 0.00, currency: "USD" },
      // We map the specs directly into a normalized structure for the component
      specs: payload.raw_specs || {},
      raw_specs: payload.raw_specs || {},
      raw_features: payload.raw_features || [],
      images: payload.images || []
    };
  
    if (finalizedCanonicalJson) {
      finalizedCanonicalJson._debugJsonLd = extractedJsonLd;
      await chrome.storage.local.set({ [targetUrl]: finalizedCanonicalJson });
  }
  
    return finalizedCanonicalJson;
  }
  
  /**
   * Come back to this section later...
   * By trying to classify the product, it would make the process
   * of the loading longer and even then, would require continuous 
   * alteration to update new categories.
   */
  /* async function fetchProductClassification(payload) {
    
  } */
  
  /**
   * Later on, sync with the Harmonization pipeline to later be saved to the database?
   * The length of time it is taking for scraping, we should hamonize the data or call an ai
   * for its classification.
   */
  /* async function callHarmonizeEndpoint(productType, payload) {
    
  } */
  
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