/**
 * background.js
 *
 * This script manages logic for:
 * - Handling messages from the content script and the panel (app.js)
 * - Managing the extension's active state and toolbar icon
 *
 * Auth lives entirely in the panel now. There is no popup, so no popup is ever
 * registered — which is what lets chrome.action.onClicked fire on every click.
 */

 const ACTIVE_KEY = "isExtensionActive";
 const TOGGLE_MSG = "TOGGLE_PANEL";
 
 /**
  * The toolbar icon reflects one thing only: whether the panel is open.
  * It says nothing about sign-in state — the panel decides what to render.
  */
 function updateExtensionUI(tabId, isActive) {
   const iconPath = isActive ? "active_logo.PNG" : "default_logo.png";
   chrome.action.setIcon({
     tabId: tabId,
     path: { "16": iconPath, "48": iconPath, "128": iconPath }
   });
 }
 
 /**
  * Push panel state to a tab. If the content script isn't loaded there yet,
  * inject it — but only when we're turning the panel on.
  */
 function syncTab(tabId, isActive) {
   chrome.tabs.sendMessage(tabId, { action: TOGGLE_MSG, state: isActive }, () => {
     if (chrome.runtime.lastError && isActive) {
       chrome.scripting.executeScript({
         target: { tabId: tabId },
         files: ["content.js"]
       });
     }
   });
 }
 
 // ============================================================
 // MESSAGES
 // ============================================================
 
 chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
 
   // Content script asking for initial state when a page loads
   if (request.action === "GET_EXTENSION_STATE") {
     chrome.storage.local.get({ [ACTIVE_KEY]: false }, (data) => {
       sendResponse({ isExtensionActive: data[ACTIVE_KEY] });
     });
     return true;
   }
 
   // Panel signed in. Nothing to do here — app.js writes jwtToken, and its own
   // chrome.storage.onChanged listener swaps the view. Kept as a hook.
   if (request.action === "LOGIN_SUCCESS") {
     console.log("decidio: signed in");
   }
 
   // Panel signed out. Collected products belong to the account, so clear them.
   // Deliberately does NOT touch isExtensionActive — the panel stays open and
   // swaps to the login view in place.
   if (request.action === "LOGOUT") {
     chrome.storage.local.set({ savedProducts: [] });
   }
 
   if (request.action === "PRODUCT_IMAGE_PICKED") {
     const newProduct = {
       imageUrl: request.imageUrl,
       productUrl: request.productUrl,
       productTitle: request.productTitle || "Product",
       timestamp: new Date().toISOString()
     };
 
     chrome.storage.local.get({ savedProducts: [] }, (result) => {
       const currentProducts = result.savedProducts;
       currentProducts.push(newProduct);
 
       chrome.storage.local.set({ savedProducts: currentProducts }, () => {
         console.log("decidio: saved product", newProduct);
         chrome.runtime.sendMessage({
           action: "RENDER_PICKED_PRODUCT",
           product: newProduct
         });
       });
     });
   }
 });
 
 // ============================================================
 // TOOLBAR ICON CLICK
 // ============================================================
 
 chrome.action.onClicked.addListener(async (tab) => {
   if (!tab.id) return;
 
   const data = await chrome.storage.local.get({ [ACTIVE_KEY]: false });
   const nextActiveState = !data[ACTIVE_KEY];
 
   await chrome.storage.local.set({ [ACTIVE_KEY]: nextActiveState });
 
   updateExtensionUI(tab.id, nextActiveState);
   syncTab(tab.id, nextActiveState);
 });
 
 // ============================================================
 // TAB LIFECYCLE
 // ============================================================
 
 chrome.tabs.onActivated.addListener(async (activeInfo) => {
   const tabId = activeInfo.tabId;
   const data = await chrome.storage.local.get({ [ACTIVE_KEY]: false });
 
   updateExtensionUI(tabId, data[ACTIVE_KEY]);
   syncTab(tabId, data[ACTIVE_KEY]);
 });
 
 chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
   if (changeInfo.status === 'complete' && tabId) {
     const data = await chrome.storage.local.get({ [ACTIVE_KEY]: false });
     updateExtensionUI(tabId, data[ACTIVE_KEY]);
   }
 });