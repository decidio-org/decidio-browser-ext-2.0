/**
 * app.js
 * 
 * Manages the iframe UI: sidebar panel visibility, tile rendering, tile removal,
 * dropdowns, mode toggles, and triggering the picker on the active tab.
 */

/**
 * Base URL for the Decidio FastAPI backend on Railway.
 * If requests.js already exports this, delete the constant here and reuse that one
 * instead — two copies will drift.
 */

 const API_BASE_URL = "https://decidio-api-production.up.railway.app";

/**
 * Set true if /auth/login rejects requests without a handle.
 * The OpenAPI example shows handle on both endpoints, but the two may share
 * one Pydantic model where it's optional. Check the Schema tab's required list.
 */
const LOGIN_REQUIRES_HANDLE = false;

document.addEventListener('DOMContentLoaded', () => {

  // Primary UI control elements & state references
  const toggleAnchor = document.getElementById('decidioToggle');
  const sidebarPanel = document.getElementById('decidioSidebarPanel');
  const addProductBtn = document.getElementById('addProductBtn');
  const productsContainer = document.getElementById('products-container');
  const singleModeBtn = document.getElementById('modeSingleBtn');
  const multiModeBtn = document.getElementById('modeMultiBtn');
  const dropdowns = document.querySelectorAll('.list-dropdown-component');

  // Selection mode state ('single' vs 'multi') sent to the content script picker
  let currentSelectionMode = 'single';

  /* --------------------------------------------------------------------------
     SIDEBAR PANEL INITIALIZATION
     -------------------------------------------------------------------------- */

  // Ensure sidebar is expanded by default on initialization
  if (sidebarPanel) {
    sidebarPanel.classList.remove('is-collapsed');
  }

  // Toggle sidebar visibility when clicking the toggle anchor
  if (toggleAnchor && sidebarPanel) {
    toggleAnchor.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebarPanel.classList.toggle('is-collapsed');
    });
  }
  /* --------------------------------------------------------------------------
     AUTH VIEW CONTROL
     -------------------------------------------------------------------------- */

     const authView = document.getElementById('authView');
     const authHandle = document.getElementById('authHandle');
     const authEmail = document.getElementById('authEmail');
     const authPassword = document.getElementById('authPassword');
     const authConfirm = document.getElementById('authConfirm');
     const authSubmitBtn = document.getElementById('authSubmitBtn');
     const authForgotBtn = document.getElementById('authForgotBtn');
     const authGoogleBtn = document.getElementById('authGoogleBtn');
     const authAppleBtn = document.getElementById('authAppleBtn');
     const authSwitchBtn = document.getElementById('authSwitchBtn');
     const authSwitchLabel = document.getElementById('authSwitchLabel');
     const authError = document.getElementById('authError');
   
     const AUTH_FIELDS = [authHandle, authEmail, authPassword, authConfirm];
   
     // 'login' | 'signup'
     let authMode = 'login';
   
     /* ---------- View state ---------- */
   
     function showAuthView() {
       if (sidebarPanel) sidebarPanel.classList.add('is-auth');
     }
   
     function showWorkspaceView() {
       if (sidebarPanel) sidebarPanel.classList.remove('is-auth');
       clearAuthError();
     }
   
     function showAuthError(message) {
       if (!authError) return;
       authError.textContent = message;
       authError.classList.add('is-visible');
     }
   
     function clearAuthError() {
       if (!authError) return;
       authError.textContent = '';
       authError.classList.remove('is-visible');
     }
   
     /** Swaps copy and field visibility between login and signup. */
     function setAuthMode(mode) {
       authMode = mode;
       clearAuthError();
   
       if (sidebarPanel) sidebarPanel.classList.toggle('is-signup', mode === 'signup');
   
       if (mode === 'signup') {
         authSubmitBtn.textContent = 'Create account';
         authPassword.setAttribute('autocomplete', 'new-password');
         authSwitchLabel.textContent = 'Already have an account?';
         authSwitchBtn.textContent = 'Sign in';
       } else {
         authSubmitBtn.textContent = 'Sign in';
         authPassword.setAttribute('autocomplete', 'current-password');
         authSwitchLabel.textContent = 'No account?';
         authSwitchBtn.textContent = 'Sign up';
       }
     }
   
     /* ---------- API layer ---------- */
   
     // Maps FastAPI validation loc fields to labels matching the UI
     const FIELD_LABELS = {
       email: 'Email',
       password: 'Password',
       handle: 'Handle'
     };
   
     /**
      * Turns a FastAPI error body into one display string.
      * 422 returns detail as an array of { loc, msg, type, input, ctx };
      * HTTPException returns detail as a plain string.
      *
      * @param {Object|null} payload - Parsed JSON error body, or null if unparseable.
      * @param {number} status - HTTP status, used for fallback copy.
      * @returns {string}
      */
     function parseApiError(payload, status) {
       const detail = payload && payload.detail;
   
       if (typeof detail === 'string' && detail.trim()) {
         return detail;
       }
   
       if (Array.isArray(detail) && detail.length) {
         const messages = detail.map((item) => {
           if (!item || typeof item.msg !== 'string') return null;
   
           // loc is typically ["body", "<field>"] — take the trailing segment
           const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
           const label = FIELD_LABELS[field];
   
           // Pydantic messages start with "Value error, " or "String should have..."
           const msg = item.msg.replace(/^Value error,\s*/i, '');
   
           return label ? `${label}: ${msg}` : msg;
         }).filter(Boolean);
   
         if (messages.length) return messages.join(' ');
       }
   
       if (status === 401) return 'Incorrect email or password.';
       if (status === 403) return 'This account does not have access.';
       if (status === 409) return 'An account with that email or handle already exists.';
       if (status === 429) return 'Too many attempts. Please wait and try again.';
       if (status >= 500) return 'Server error. Please try again in a moment.';
   
       return 'Something went wrong. Please try again.';
     }
   
     /**
      * Fetch wrapper that parses JSON safely and throws display-ready errors.
      *
      * @param {string} path - Endpoint path, e.g. '/auth/login'.
      * @param {Object} [options] - { method, body, token }.
      * @returns {Promise<*>} Parsed response body.
      */
     async function apiRequest(path, options = {}) {
       const { method = 'GET', body = null, token = null } = options;
   
       const headers = {};
       if (body) headers['Content-Type'] = 'application/json';
       if (token) headers['Authorization'] = `Bearer ${token}`;
   
       let response;
       try {
         response = await fetch(`${API_BASE_URL}${path}`, {
           method,
           headers,
           body: body ? JSON.stringify(body) : undefined
         });
       } catch (networkErr) {
         // fetch rejects only on network/CORS failure, never on HTTP status
         const err = new Error('Could not reach the server. Check your connection.');
         err.status = 0;
         throw err;
       }
   
       // Read as text first — error bodies are not guaranteed to be JSON
       const raw = await response.text();
       let parsed = null;
       try {
         parsed = raw ? JSON.parse(raw) : null;
       } catch (parseErr) {
         parsed = raw || null;
       }
   
       if (!response.ok) {
         const err = new Error(parseApiError(
           typeof parsed === 'object' ? parsed : null,
           response.status
         ));
         err.status = response.status;
         throw err;
       }
   
       return parsed;
     }
   
     /**
      * Builds a fallback handle from an email local-part.
      * @param {string} email
      * @returns {string}
      */
     function deriveHandle(email) {
       const local = String(email).split('@')[0] || '';
       const cleaned = local.toLowerCase().replace(/[^a-z0-9_]/g, '');
       return cleaned || `user${Date.now().toString().slice(-6)}`;
     }
   
     /**
      * Persists the token payload returned by /auth/login and /auth/signup.
      * Shape is fixed by the API: { access_token, token_type, user_id, created }.
      *
      * @param {Object} data
      * @returns {Promise<void>}
      */
     function persistSession(data) {
       if (!data || !data.access_token) {
         throw new Error('Signed in, but no token was returned. Please try again.');
       }
   
       return new Promise((resolve) => {
         chrome.storage.local.set({
           jwtToken: data.access_token,
           tokenType: data.token_type || 'bearer',
           userId: data.user_id || null,
           isLoggedIn: true
         }, resolve);
       });
     }
   
     /**
      * Bootstrap call — confirms the stored token is still valid and returns
      * whatever identity/org payload the server sends.
      *
      * @param {string} token
      * @returns {Promise<*>}
      */
     function fetchMe(token) {
       return apiRequest('/auth/me', { token });
     }
   
     /* ---------- Session lifecycle ---------- */
   
     /**
      * Clears the session and returns to the auth view.
      * There is no refresh endpoint, so an expired token means a full re-login.
      */
     function logout() {
       chrome.storage.local.set({
         jwtToken: null,
         tokenType: null,
         userId: null,
         isLoggedIn: false,
         savedProducts: []
       }, () => {
         AUTH_FIELDS.forEach((f) => { if (f) f.value = ''; });
         setAuthMode('login');
         showAuthView();
       });
     }
   
     window.decidioLogout = logout;
   
     // On load: show workspace optimistically if a token exists, then verify it
     chrome.storage.local.get({ isLoggedIn: false, jwtToken: null }, async (result) => {
       if (!result.isLoggedIn || !result.jwtToken) {
         showAuthView();
         return;
       }
   
       showWorkspaceView();
   
       try {
         await fetchMe(result.jwtToken);
       } catch (err) {
         // Only a rejected token forces logout — a network blip should not
         if (err.status === 401 || err.status === 403) {
           logout();
           showAuthError('Your session expired. Please sign in again.');
         }
       }
     });
   
     // Keep views in sync if another surface signs in or out
     chrome.storage.onChanged.addListener((changes, areaName) => {
       if (areaName !== 'local' || !changes.isLoggedIn) return;
       changes.isLoggedIn.newValue ? showWorkspaceView() : showAuthView();
     });
   
     /* ---------- Form handling ---------- */
   
     /**
      * Disables inputs and swaps button copy while a request is in flight.
      * @param {boolean} isLoading
      */
     function setAuthLoading(isLoading) {
       if (!authSubmitBtn) return;
   
       authSubmitBtn.disabled = isLoading;
       AUTH_FIELDS.forEach((f) => { if (f) f.disabled = isLoading; });
   
       if (isLoading) {
         authSubmitBtn.textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';
       } else {
         authSubmitBtn.textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
       }
     }
   
     if (authSwitchBtn) {
       authSwitchBtn.addEventListener('click', () => {
         setAuthMode(authMode === 'login' ? 'signup' : 'login');
       });
     }
   
     if (authSubmitBtn) {
       authSubmitBtn.addEventListener('click', async () => {
         clearAuthError();
   
         const email = authEmail.value.trim();
         const password = authPassword.value;
   
         if (!email || !password) {
           showAuthError('Please enter your email and password.');
           return;
         }
   
         if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
           showAuthError('Please enter a valid email address.');
           return;
         }
   
         // Server enforces an 8-character minimum; mirror it to avoid a round trip
         if (password.length < 8) {
           showAuthError('Password must be at least 8 characters.');
           return;
         }
   
         if (authMode === 'signup' && password !== authConfirm.value) {
           showAuthError('Passwords do not match.');
           return;
         }
   
         const payload = { email, password };
   
         if (authMode === 'signup') {
           payload.handle = authHandle.value.trim() || deriveHandle(email);
         } else if (LOGIN_REQUIRES_HANDLE) {
           payload.handle = deriveHandle(email);
         }
   
         setAuthLoading(true);
   
         try {
           const path = authMode === 'signup' ? '/auth/signup' : '/auth/login';
           const data = await apiRequest(path, { method: 'POST', body: payload });
   
           await persistSession(data);
   
           // Clear credentials from the DOM before revealing the workspace
           AUTH_FIELDS.forEach((f) => { if (f) f.value = ''; });
   
           showWorkspaceView();
         } catch (err) {
           showAuthError(err.message);
         } finally {
           setAuthLoading(false);
         }
       });
     }
   
     // Enter submits from any field
     AUTH_FIELDS.forEach((field) => {
       if (!field) return;
       field.addEventListener('keydown', (e) => {
         if (e.key === 'Enter') authSubmitBtn.click();
       });
     });
   
    //  if (authForgotBtn) {
    //    authForgotBtn.addEventListener('click', () => {
    //      showAuthError('Password reset is coming soon.');
    //    });
    //  }
   
     [authGoogleBtn, authAppleBtn].forEach((btn) => {
       if (!btn) return;
       btn.addEventListener('click', () => {
         showAuthError('Social login is coming soon.');
       });
     });
  /* --------------------------------------------------------------------------
     STORAGE & TILE RENDERING
     -------------------------------------------------------------------------- */

  /**
   * Updates the count badge on the logo toggle icon based on collected items.
   * @param {number} [countOverride] - Explicit product count override.
   */
  function updateLogoBadge(countOverride) {
    if (!toggleAnchor) return;

    let totalProducts = 0;
    if (typeof countOverride === 'number') {
      totalProducts = countOverride;
    } else if (productsContainer) {
      totalProducts = productsContainer.querySelectorAll('.collected-product-tile').length;
    }

    renderBadgeCount(toggleAnchor, totalProducts);
  }

  /**
   * Clears existing DOM tiles and re-renders the complete list from storage data.
   * @param {Array<Object>} savedProducts - Array of product objects from chrome.storage.
   */
  function syncUIFromStorageArray(savedProducts) {
    if (!productsContainer) return;

    // Flush existing DOM elements before repopulating
    const oldTiles = productsContainer.querySelectorAll('.collected-product-tile');
    oldTiles.forEach(tile => tile.remove());

    // Reverse array so newer additions preserve visually correct stack order
    const reversedProducts = [...savedProducts].reverse();
    reversedProducts.forEach((prod) => {
      displaySelectedProduct(prod.imageUrl, prod.productUrl, prod.productTitle || "Product", productsContainer);
    });

    updateLogoBadge(savedProducts.length);
  }

  // Fetch initial saved products from local storage on load
  chrome.storage.local.get({ savedProducts: [] }, (result) => {
    syncUIFromStorageArray(result.savedProducts);
  });

  // Real-time synchronization across instances when extension storage updates
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.savedProducts) {
      const updatedProductsList = changes.savedProducts.newValue || [];
      syncUIFromStorageArray(updatedProductsList);
    }
  });

  // Handle tile deletion via event delegation on the product container
  if (productsContainer) {
    productsContainer.addEventListener('click', (event) => {
      const productTile = event.target.closest('.collected-product-tile');
      
      if (productTile) {
        const urlToRemove = productTile.getAttribute('data-product-url');
        productTile.remove(); // Immediate DOM removal for snappy UI responsiveness

        // Re-index remaining tiles in the DOM to update flex ordering and numbered badges
        const remainingTiles = productsContainer.querySelectorAll('.collected-product-tile');
        remainingTiles.forEach((tile, index) => {
          tile.style.order = index + 1;
          const badge = tile.querySelector('.product-tile-number');
          if (badge) badge.textContent = String(index + 1).padStart(2, '0');
        });

        updateLogoBadge();

        // Persist deletion changes back to Chrome extension local storage
        chrome.storage.local.get({ savedProducts: [] }, (result) => {
          const updatedList = result.savedProducts.filter(p => p.productUrl !== urlToRemove);
          chrome.storage.local.set({ savedProducts: updatedList });
        });
      }
    });
  }

  /* --------------------------------------------------------------------------
     UI COMPONENTS (DROPDOWNS & MODE SWITCHER)
     -------------------------------------------------------------------------- */

  // Initialize custom dropdown behavior and option selection
  dropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('.dropdown-trigger');
    const options = dropdown.querySelectorAll('.dropdown-option');
    const display = dropdown.querySelector('.selected-value-display');

    if (!trigger || !display) return;

    function openDropdown() {
      dropdown.classList.remove('is-closing');
      dropdown.classList.add('is-active');
    }

    function closeDropdown() {
      dropdown.classList.add('is-closing');
      dropdown.classList.remove('is-active');
      setTimeout(() => { dropdown.classList.remove('is-closing'); }, 450); // Syncs with CSS closing animation duration
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.contains('is-active') ? closeDropdown() : openDropdown();
    });

    options.forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = option.getAttribute('data-value');
        display.innerText = value === 'create-new' ? "Create List +" : option.innerText;
        closeDropdown();
      });
    });

    // Close open dropdown when clicking outside
    document.addEventListener('click', () => {
      if (dropdown.classList.contains('is-active')) closeDropdown();
    });
  });

  // Toggle selection modes (single element vs. batch multi-selection)
  if (singleModeBtn && multiModeBtn) {
    singleModeBtn.addEventListener('click', () => {
      currentSelectionMode = 'single';
      singleModeBtn.classList.add('active');
      multiModeBtn.classList.remove('active');
    });

    multiModeBtn.addEventListener('click', () => {
      currentSelectionMode = 'multi';
      multiModeBtn.classList.add('active');
      singleModeBtn.classList.remove('active');
    });
  }

  /* --------------------------------------------------------------------------
     TRIGGER PICKER IN ACTIVE TAB & MESSAGE LISTENERS
     -------------------------------------------------------------------------- */

  // Send payload to content script on active tab when user clicks "Add Product"
  if (addProductBtn) {
    addProductBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { 
          action: "START_DECIDIO_PICKER",
          mode: currentSelectionMode 
        });
      }
    });
  }

  // Listen for messages from background/content scripts to restore sidebar state
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "RENDER_PICKED_PRODUCT" || message.action === "DECIDIO_PICKER_CANCELLED") {
      if (sidebarPanel) sidebarPanel.classList.remove('is-collapsed');
      if (toggleAnchor) toggleAnchor.style.display = '';
    }
  });

});

/* --------------------------------------------------------------------------
   DOM TILE RENDER HELPER
   -------------------------------------------------------------------------- */

/**
 * Dynamically constructs and injects a product tile DOM node into the panel container.
 * Uses inline styling for isolated layout properties to complement style.css.
 * 
 * @param {string} imageUrl - Source URL for the product image thumbnail.
 * @param {string} productUrl - Unique target product page link.
 * @param {string} productTitle - Display title for the product card.
 * @param {HTMLElement} container - DOM wrapper element holding the product list.
 */
function displaySelectedProduct(imageUrl, productUrl, productTitle, container) {
  const existingTiles = container.querySelectorAll('.collected-product-tile').length;
  const itemNumber = String(existingTiles + 1).padStart(2, '0'); 

  // Card Outer Container
  const productTile = document.createElement('div');
  productTile.className = 'collected-product-tile';
  productTile.setAttribute('data-product-url', productUrl);
  
  // Tile dimensions and flex layout styles
  productTile.style.position = 'relative';
  productTile.style.width = '120px';
  productTile.style.height = '180px'; 
  productTile.style.display = 'flex';
  productTile.style.flexDirection = 'column';
  productTile.style.boxSizing = 'border-box';
  productTile.style.flexShrink = '0';

  // Image Frame Wrapper
  const imgWrapper = document.createElement('div');
  imgWrapper.style.position = 'relative';
  imgWrapper.style.width = '120px';
  imgWrapper.style.height = '140px';
  imgWrapper.style.borderRadius = '8px';
  imgWrapper.style.overflow = 'hidden';
  imgWrapper.style.border = '1px solid rgba(255, 255, 255, 0.15)';
  imgWrapper.style.background = 'rgba(255, 255, 255, 0.08)';

  // Product Image Element
  const imgPreview = document.createElement('img');
  imgPreview.src = imageUrl;
  imgPreview.style.width = '100%';
  imgPreview.style.height = '100%';
  imgPreview.style.objectFit = 'cover';
  imgPreview.style.display = 'block';

  // Floating Index Number Badge (01, 02, etc.)
  const numberBadge = document.createElement('div');
  numberBadge.className = 'product-tile-number';
  numberBadge.textContent = itemNumber;
  
  numberBadge.style.position = 'absolute';
  numberBadge.style.bottom = '6px';
  numberBadge.style.right = '8px';
  numberBadge.style.color = '#ffffff';
  numberBadge.style.fontSize = '16px';
  numberBadge.style.fontWeight = 'bold';
  numberBadge.style.background = 'rgba(0, 0, 0, 0.65)';
  numberBadge.style.padding = '2px 6px';
  numberBadge.style.borderRadius = '4px';
  numberBadge.style.backdropFilter = 'blur(4px)';
  numberBadge.style.border = '1px solid rgba(255, 255, 255, 0.15)';

  imgWrapper.appendChild(imgPreview);
  imgWrapper.appendChild(numberBadge);

  // Product Title Label Frame
  const titleLabel = document.createElement('div');
  titleLabel.className = 'product-tile-title';
  titleLabel.textContent = productTitle;
  titleLabel.style.width = '100%';
  titleLabel.style.fontSize = '13px';
  titleLabel.style.lineHeight = '1.2';
  titleLabel.style.color = '#e2e8f0';
  titleLabel.style.marginTop = '6px';
  titleLabel.style.textAlign = 'center';
  
  // Multi-line clamping: Truncates to max 2 lines with an ellipsis
  titleLabel.style.minHeight = '2.6em'; 
  titleLabel.style.textOverflow = 'ellipsis';
  titleLabel.style.display = '-webkit-box';
  titleLabel.style['-webkit-line-clamp'] = '2';
  titleLabel.style['-webkit-box-orient'] = 'vertical';
  titleLabel.style.overflow = 'hidden';

  productTile.appendChild(imgWrapper);
  productTile.appendChild(titleLabel);
  
  // Keep the 'Add Product' button anchored at flex position 0
  const addBtn = document.getElementById('addProductBtn');
  if (addBtn) addBtn.style.order = '0'; 
  
  productTile.style.order = existingTiles + 1;
  container.appendChild(productTile);
}