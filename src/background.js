/**
 * background.js
 *
 * Extension Service Worker handling icon state, storage updates,
 * and communication between app.js and content.js.
 */

/**
 * The content-script bundle, in dependency order — must stay identical to
 * manifest.json's content_scripts[0].js. content.js is last because it is the
 * only one that RUNS anything on load (it constructs DecidioContentPicker from
 * picker.js and calls ui.js's globals); the others only declare. Injecting a
 * subset leaves those references undefined.
 */
const CONTENT_SCRIPT_FILES = [
  "util.js",
  "requests.js",
  "drivers.js",
  "productPageExtract.js",
  "picker.js",
  "ui.js",
  "content.js"
];

/**
 * Updates the extension toolbar icon dynamically based on active state.
 * 
 * @param {number} tabId - Target tab ID to update.
 * @param {boolean} isActive - Whether the extension is currently active.
 */
function updateExtensionUI(tabId, isActive) {
  if (!tabId) return;
  const iconPath = isActive ? "images/active_logo.png" : "images/default_logo.png";
  
  // Set toolbar action icon dynamically across supported densities
  chrome.action.setIcon({
    tabId: tabId,
    path: {
      "16": iconPath,
      "48": iconPath,
      "128": iconPath
    }
  }).catch(() => {}); // Suppress errors if the tab closes before icon update finishes
}

/**
 * Broadcasts runtime messages to extension views (popups/iframes) safely.
 * Swallows errors when no receiver is actively listening.
 * 
 * @param {Object} message - Payload message object to broadcast.
 */
function safeRuntimeSendMessage(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Expected benign error when sidebar iframe/popup is not currently open/mounted
  });
}

/**
 * Safely sends a message to a specific tab's content script wrapper.
 * 
 * @param {number} tabId - Target browser tab ID.
 * @param {Object} message - Message object payload.
 * @param {Function} [callback] - Optional response and error handler.
 */
function safeTabSendMessage(tabId, message, callback) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, message, (response) => {
    const err = chrome.runtime.lastError;
    if (callback) callback(response, err);
  });
}

/* --------------------------------------------------------------------------
   FILING COLLECTED ITEMS
   --------------------------------------------------------------------------

   Filing used to happen in the panel, and every tab with Decidio on has its
   own panel. Filing is read-the-list, add, write-it-back, so two panels doing
   it at once overwrote each other: an item ended up in the list but not in
   Collected Items, or in neither, depending on which write landed last. It
   happened only sometimes, and only with more than one tab open.

   The worker is a single instance shared by every tab. Each batch is filed
   here, one after another, and the list, Collected Items, the cascade flag
   and recency are written in ONE storage write so nothing can land half
   done. Panels only redraw from storage.

   Dev session only: that is local storage end to end. A signed-in session
   files through the API from the panel, as before. */

// Mirrors DEV_AUTH_BYPASS in app.js — the two must agree.
const DEV_AUTH_BYPASS = true;
function devSession() {
  try { return DEV_AUTH_BYPASS && !('update_url' in chrome.runtime.getManifest()); }
  catch (e) { return false; }
}

let filingChain = Promise.resolve();
function fileInBackground(items) {
  // Strictly one batch at a time. A batch that fails must not stop the next.
  filingChain = filingChain.then(() => fileNow(items), () => fileNow(items));
  return filingChain;
}

async function fileNow(items) {
  const { devLists = [] } = await chrome.storage.local.get({ devLists: [] });
  const known = new Set(devLists.map((l) => String(l.id)));
  // An item collected for a list that has since gone falls back to the first
  // list, or to the holding queue Collected Items shows as "Not in a list".
  const fallback = devLists[0] ? String(devLists[0].id) : 'unfiled';

  const groups = new Map();
  for (const it of items) {
    const dest = it.listId && known.has(String(it.listId)) ? String(it.listId) : fallback;
    if (!groups.has(dest)) groups.set(dest, []);
    groups.get(dest).push(it);
  }

  const keys = ['listsAwaitingCascade', 'listRecentUse'];
  for (const id of groups.keys()) keys.push('devListItems_' + id, 'listQueue_' + id);
  const cur = await chrome.storage.local.get(keys);

  const now = Date.now();
  const out = {};
  const cascade = Array.isArray(cur.listsAwaitingCascade) ? cur.listsAwaitingCascade.slice() : [];
  const recent = Object.assign({}, cur.listRecentUse || {});

  for (const [id, its] of groups) {
    // Named items go into the list as well; anything without a name waits in
    // Collected Items, where it can be retried or sent somewhere.
    const named = its.filter((it) => (it.state ? it.state === 'complete' : !!it.productTitle));
    // One id per item, carried by both the list item and its Collected Items
    // row, so an edit made from either finds the other exactly — even when
    // the same product has been collected twice.
    const ids = new Map(its.map((it) => [it, 'i' + now + Math.random().toString(36).slice(2, 8)]));
    out['devListItems_' + id] = (cur['devListItems_' + id] || []).concat(named.map((it) => ({
      id: ids.get(it),
      imageUrl: it.imageUrl || null,
      productUrl: it.productUrl || null,
      productTitle: it.productTitle || null,
      // Not the overlay's guess (the first word of the name — "Taccia" for a
      // Flos lamp). A brand field that arrives filled in with a wrong guess
      // is worse than an empty one; it is set by hand in the item's details.
      brand: null
    })));
    out['listQueue_' + id] = (cur['listQueue_' + id] || []).concat(its.map((it) => ({
      id: 'q' + now + Math.random().toString(36).slice(2, 7),
      itemId: ids.get(it),
      thumb: it.imageUrl || null,
      title: it.productTitle || null,
      brand: null,
      productUrl: it.productUrl || null,
      state: it.state === 'pending' ? 'pending' : (named.includes(it) ? 'added' : 'failed'),
      error: it.error || null,
      addedAt: now
    })));
    if (!cascade.includes(id)) cascade.push(id);
    recent[id] = now;
  }
  out.listsAwaitingCascade = cascade;
  out.listRecentUse = recent;

  await chrome.storage.local.set(out);
  return [...groups.keys()];
}

/* --------------------------------------------------------------------------
   MESSAGE HANDLERS (CONTENT SCRIPT & APP UI COMMUNICATION)
   -------------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  /* Screenshot of the visible tab, for collecting a picture the page will not
     let us read any other way.

     Canvas is the normal route, but drawing a cross-origin image onto one
     taints it and toDataURL then throws — which is most of why some sites
     give up no image at all. A tab capture is of the RENDERED page, so it is
     subject to none of that: no CORS, no tainting, and it works for CSS
     backgrounds, <canvas>, SVG and video frames that were never an <img> to
     begin with. The cost is resolution (the viewport, not the source file),
     so it is a fallback rather than the first choice.

     Needs <all_urls> (granted) and must run here — captureVisibleTab is not
     available to content scripts. */
  if (request.action === "DECIDIO_CAPTURE_TAB") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      // A capture can be refused: chrome:// and the Web Store are off limits
      // whatever the permissions say, and captures are rate limited.
      const err = chrome.runtime.lastError;
      sendResponse(err ? { error: err.message } : { dataUrl });
    });
    return true;   // async sendResponse
  }

  /* Done in the overlay. The one way a collect is saved.

     Files the batch and answers only once it is written: {ok: true} closes
     the overlay, anything else keeps it open with the items and an error.
     `return true` holds the message open — and the worker awake — until the
     answer is sent. */
  if (request.action === "DECIDIO_SAVE_COLLECTED") {
    const fromTab = sender && sender.tab ? sender.tab.id : null;
    const stamp = Date.now();
    const items = (request.items || []).map((it, i) => ({
      ...it,
      listId: request.listId || it.listId || null,
      tabId: fromTab,
      pid: stamp + '-' + i + '-' + Math.random().toString(36).slice(2, 7),
      pickedAt: stamp
    }));

    const reply = (ok, extra) => {
      try { sendResponse(Object.assign({ ok }, extra || {})); } catch (e) {}
      // The panel was minimised for collecting; this brings it back.
      safeRuntimeSendMessage({ action: "RENDER_PICKED_PRODUCT" });
    };

    if (devSession()) {
      fileInBackground(items).then(
        (listIds) => reply(true, { listIds }),
        (err) => reply(false, { error: String((err && err.message) || err) })
      );
    } else {
      // Signed in: the panel files through the API, so the batch waits for
      // it in savedProducts as before.
      chrome.storage.local.get({ savedProducts: [] }, (r) => {
        const updated = ((r && r.savedProducts) || []).concat(items);
        chrome.storage.local.set({ savedProducts: updated }, () => {
          const err = chrome.runtime.lastError;
          reply(!err, err ? { error: err.message } : undefined);
        });
      });
    }
    return true;
  }

  // A panel asking which tab it lives in, so it files only that tab's
  // collects. An extension frame inside a tab is given that tab as sender.
  if (request.action === "DECIDIO_WHICH_TAB") {
    sendResponse({ tabId: sender && sender.tab ? sender.tab.id : null });
    return;
  }

  // Return the active/inactive state stored in chrome.storage.local
  if (request.action === "GET_EXTENSION_STATE") {
    chrome.storage.local.get({ isExtensionActive: false }, (data) => {
      sendResponse({ isExtensionActive: data.isExtensionActive });
    });
    return true; // Keeps message channel open for asynchronous sendResponse call
  }
  
  // Save a single picked product to local storage and trigger UI re-render
  if (request.action === "PRODUCT_IMAGE_PICKED") {
    chrome.storage.local.get({ savedProducts: [] }, (result) => {
      const existing = result.savedProducts || [];

      const updatedList = [...existing, {
        imageUrl: request.imageUrl,
        productUrl: request.productUrl,
        productTitle: request.productTitle
      }];
      chrome.storage.local.set({ savedProducts: updatedList }, () => {
        safeRuntimeSendMessage({ action: "RENDER_PICKED_PRODUCT" });
      });
    });
  } 
  // Save multiple picked products in batch to storage and trigger UI re-render
  else if (request.action === "PRODUCT_IMAGES_BATCH_PICKED") {
    // Every item is stamped with the tab it was collected in and an id of its
    // own. Each tab with Decidio on has its own panel, and all of them watch
    // savedProducts; the tab says which panel owns the batch, and the id lets
    // that panel take out exactly what it filed and nothing else.
    const fromTab = sender && sender.tab ? sender.tab.id : null;
    const stamp = Date.now();
    chrome.storage.local.get({ savedProducts: [] }, (result) => {
      const existing = result.savedProducts || [];
      const incoming = (request.items || request.products || []).map((it, i) => ({
        ...it,
        tabId: fromTab,
        pid: stamp + '-' + i + '-' + Math.random().toString(36).slice(2, 7),
        pickedAt: stamp
      }));

      // On the local dev session the worker files the batch itself. It is
      // the one context every tab shares, so filing here happens once, in
      // order, instead of in whichever tab's panel noticed first.
      if (devSession()) {
        fileInBackground(incoming).finally(() => {
          safeRuntimeSendMessage({ action: "RENDER_PICKED_PRODUCT" });
        });
        return;
      }

      const updatedList = [...existing, ...incoming];
      chrome.storage.local.set({ savedProducts: updatedList }, () => {
        safeRuntimeSendMessage({ action: "RENDER_PICKED_PRODUCT" });
      });
    });
  }
});

/* --------------------------------------------------------------------------
   TOOLBAR ACTION & TAB LIFECYCLE LISTENERS
   -------------------------------------------------------------------------- */

/* A reload or update orphans the copy of the content scripts in every open
   tab: it keeps running and keeps its panel and overlay on screen, but it can
   no longer reach the extension, so pressing the aperture collects nothing and
   nothing is filed — silently. Until now the only cure was refreshing each
   page by hand, and a tab that was missed looked exactly like adding being
   broken. So every open page gets a fresh copy the moment this worker
   installs; content.js clears away what the orphaned copy left behind. */
/* Anything left in the old savedProducts inbox — collected by a version that
   handed batches to the panels — is filed once, here, so it is not stranded
   now that the panels no longer file on the dev session. */
async function fileLeftovers() {
  if (!devSession()) return;
  const { savedProducts = [] } = await chrome.storage.local.get({ savedProducts: [] });
  if (!savedProducts.length) return;
  // Filed first, cleared after: a failed filing leaves them to try again.
  await fileInBackground(savedProducts);
  await chrome.storage.local.set({ savedProducts: [] });
}
chrome.runtime.onStartup.addListener(() => { fileLeftovers().catch(() => {}); });

chrome.runtime.onInstalled.addListener(async () => {
  fileLeftovers().catch(() => {});
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { return; }
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !/^(https?|file):/.test(tab.url)) continue;
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CONTENT_SCRIPT_FILES
    }).catch(() => { /* a page that refuses scripts (the Web Store, a PDF) */ });
  }
});

// Handles browser action icon clicks to toggle extension state on/off

chrome.action.onClicked.addListener(async (tab) => {
  // Guard against system, browser extension store, and blank internal pages
  if (!tab || !tab.id || tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://")) return;

  const data = await chrome.storage.local.get({ isExtensionActive: false });
  const nextActiveState = !data.isExtensionActive;

  const storageUpdates = { isExtensionActive: nextActiveState };

  // Collected items deliberately SURVIVE a toggle-off. They used to be wiped
  // here, so collecting a few things and closing the panel silently discarded
  // them — indistinguishable from a bug, and the opposite of what a collect
  // box is for. Clearing is now an explicit user action, not a side effect of
  // hiding the UI.

  await chrome.storage.local.set(storageUpdates);
  
  updateExtensionUI(tab.id, nextActiveState);

  const targetAction = nextActiveState ? "TOGGLE_DECIDIO_EXTENSION" : "DEACTIVATE_DECIDIO_EXTENSION";

  // Dispatch activation signal to content script with fallback script injection
  safeTabSendMessage(tab.id, { action: targetAction }, (response, error) => {
    if (error && nextActiveState) {
      // If content script is unattached on this tab, inject dynamically.
      // ALL of them, in the manifest's own order — not content.js alone.
      // content.js constructs DecidioContentPicker at load and calls into
      // ui.js's globals, so injecting it by itself threw "DecidioContentPicker
      // is not defined" and left the panel dead. Hits any tab that was already
      // open when the extension was installed or reloaded.
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_SCRIPT_FILES
      }, () => {
        if (!chrome.runtime.lastError) {
          safeTabSendMessage(tab.id, { action: targetAction });
        }
      });
    }
  });
});

// Sync icon and UI state when active browser tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const data = await chrome.storage.local.get({ isExtensionActive: false });
  
  updateExtensionUI(tabId, data.isExtensionActive);

  if (!data.isExtensionActive) {
    safeTabSendMessage(tabId, { action: "DEACTIVATE_DECIDIO_EXTENSION" });
  }
});

// Refresh icon state when target tab finishes page navigation/reload
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabId && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
    const data = await chrome.storage.local.get({ isExtensionActive: false });
    updateExtensionUI(tabId, data.isExtensionActive);
  }
});
