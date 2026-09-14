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

/**
 * Google OAuth 2.0 **client ID** for this extension.
 *
 * Deliberately left blank — fill it in from Google Cloud Console. A client ID
 * is public by design (it ships in every OAuth redirect), so it is safe to
 * commit. The client SECRET is NOT used here and must never be put in an
 * extension: anything shipped to a browser is readable by anyone who installs
 * it. This flow needs no secret — launchWebAuthFlow uses the implicit id_token
 * grant, which is designed for exactly this "public client" case.
 *
 * Setup, once:
 *   1. Google Cloud Console -> Credentials -> Create OAuth client ID
 *   2. Application type: Web application
 *   3. Authorised redirect URI: paste what chrome.identity.getRedirectURL()
 *      returns for this extension (https://<extension-id>.chromiumapp.org/).
 *      Log it once from the panel console if you need it.
 *   4. Paste the client ID below.
 *
 * The button stays hidden until BOTH this is set and the backend reports
 * google in GET /auth/providers, so a half-finished setup cannot present a
 * control that then fails.
 */
const GOOGLE_OAUTH_CLIENT_ID = '';

/**
 * DEV ONLY — accept any credentials without contacting the backend.
 *
 * Lets the workspace, picker and Collect flow be worked on without a real
 * account or network. It is an AUTH BYPASS, so it is fenced two ways:
 *
 *   1. This flag. Set to false to disable outright.
 *   2. isUnpackedInstall() below. Even with the flag on, the bypass refuses to
 *      run in an extension installed from the Chrome Web Store, so it cannot
 *      take effect for real users if it is ever shipped switched on.
 *
 * The session it creates carries a deliberately invalid token, so anything
 * that actually calls the API will still fail with 401 — this only gets you
 * past the sign-in screen, it does not fake a real backend session.
 */
/**
 * Invitation codes accepted at signup, for the closed-beta onboarding flow.
 *
 * NOT a security control. These are checked in the browser, so anyone can read
 * them out of the shipped extension — they gate the onboarding EXPERIENCE, not
 * account creation. The backend still decides whether a signup succeeds. If
 * invites ever need to actually restrict access, the check has to move to
 * /auth/signup and be enforced server-side; nothing here can do that.
 */
const INVITE_CODES = ['DECIDIO2026', 'EARLYACCESS', 'FOUNDER'];

const DEV_AUTH_BYPASS = true;

/**
 * True for a "Load unpacked" install. Web Store builds carry an update_url in
 * their computed manifest; local unpacked ones never do. Used to keep the dev
 * bypass inert in anything a real user could install.
 */
function isUnpackedInstall() {
  try {
    return !('update_url' in chrome.runtime.getManifest());
  } catch (e) {
    return false;   // if we cannot prove it is unpacked, assume it is not
  }
}

document.addEventListener('DOMContentLoaded', () => {

  // Primary UI control elements & state references
  const toggleAnchor = document.getElementById('decidioToggle');
  const sidebarPanel = document.getElementById('decidioSidebarPanel');
  const addProductBtn = document.getElementById('addProductBtn');
  const productsContainer = document.getElementById('products-container');
  const dropdowns = document.querySelectorAll('.list-dropdown-component');

  // Selection mode state ('single' vs 'multi') sent to the content script picker
  // Default to 'multi' mode
  let currentSelectionMode = 'multi';

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
     const authInvite = document.getElementById('authInvite');
     const authWaitlist = document.getElementById('authWaitlist');
     const authWaitlistBtn = document.getElementById('authWaitlistBtn');
     const authSubmitBtn = document.getElementById('authSubmitBtn');
     const authForgotBtn = document.getElementById('authForgotBtn');
     const authGoogleBtn = document.getElementById('authGoogleBtn');
     const authAppleBtn = document.getElementById('authAppleBtn');
     const authSwitchBtn = document.getElementById('authSwitchBtn');
     const authSwitchLabel = document.getElementById('authSwitchLabel');
     const authError = document.getElementById('authError');
   
     const AUTH_FIELDS = [authHandle, authEmail, authPassword, authConfirm, authInvite];
   
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
       hideWaitlist();
     }

     /* ---------- Invite gate ---------- */

     function showWaitlist() {
       if (authWaitlist) authWaitlist.classList.add('is-visible');
       // Strips the rest of the form down to just the email field (see
       // .is-waitlist in decidio-theme.css). Joining a waiting list has
       // nothing to do with passwords, invite codes or social buttons, and
       // leaving them on screen made this read as an error on a signup form
       // rather than a different thing to do.
       if (sidebarPanel) sidebarPanel.classList.add('is-waitlist');
     }

     function hideWaitlist() {
       if (authWaitlist) authWaitlist.classList.remove('is-visible');
       if (sidebarPanel) sidebarPanel.classList.remove('is-waitlist');
       if (authWaitlistBtn) {
         authWaitlistBtn.disabled = false;
         authWaitlistBtn.textContent = 'Join the waiting list';
       }
     }

     /**
      * @param {string} code
      * @returns {boolean} Whether the code is one we accept.
      */
     function isValidInviteCode(code) {
       return INVITE_CODES.includes((code || '').trim().toUpperCase());
     }

     if (authWaitlistBtn) {
       authWaitlistBtn.addEventListener('click', () => {
         const email = (authEmail && authEmail.value.trim()) || '';

         if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
           showAuthError('Please enter a valid email address.');
           // showAuthError does not clear the waitlist state, so the panel
           // stays where it is and only the message changes.
           return;
         }
         if (authError) authError.classList.remove('is-visible');

         // Captured locally — there is no waiting-list endpoint on the API yet
         // (GET /auth/providers advertises password only). Stored so the address
         // is not lost, and so whatever ships later can pick it up.
         try {
           chrome.storage.local.set({
             waitlistEmail: email,
             waitlistJoinedAt: new Date().toISOString()
           });
         } catch (e) { /* orphaned context — the confirmation below still shows */ }

         const body = document.getElementById('authWaitlistBody');
         if (body) body.textContent = "You're on the list. We'll email " + email + " when a place opens up.";
         authWaitlistBtn.textContent = 'Added';
         authWaitlistBtn.disabled = true;
       });
     }

     // Direct route to the waiting list, without having to fail a code first.
     const authNoCodeBtn = document.getElementById('authNoCodeBtn');
     if (authNoCodeBtn) {
       authNoCodeBtn.addEventListener('click', () => {
         if (authError) authError.classList.remove('is-visible');
         showWaitlist();
       });
     }

     const authWaitlistBack = document.getElementById('authWaitlistBack');
     if (authWaitlistBack) {
       authWaitlistBack.addEventListener('click', () => {
         hideWaitlist();
         clearAuthError();
         const body = document.getElementById('authWaitlistBody');
         if (body) body.textContent = "Leave your email and we'll send you a code when a place opens up.";
       });
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
   
         // DEV BYPASS — skips validation and the network entirely. See
         // DEV_AUTH_BYPASS above for why this cannot fire in a store build.
         // The invite gate is checked before the bypass for signup, so the
         // flow can actually be exercised with the bypass on.
         if (authMode === 'signup' && !isValidInviteCode(authInvite && authInvite.value)) {
           showAuthError('That invitation code was not recognised.');
           showWaitlist();
           return;
         }

         if (DEV_AUTH_BYPASS && isUnpackedInstall()) {
           console.warn(
             '[decidio] DEV_AUTH_BYPASS is on — signed in without contacting the ' +
             'backend. The stored token is not valid, so API calls will 401. ' +
             'Set DEV_AUTH_BYPASS = false in app.js to turn this off.');
           await persistSession({
             access_token: 'dev-bypass-not-a-real-token',
             token_type: 'bearer',
             user_id: 'dev-local',
             created: false
           });
           AUTH_FIELDS.forEach((f) => { if (f) f.value = ''; });
           showWorkspaceView();
           return;
         }
   
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

         // Invite gate — signup only, and only once the rest of the form is
         // valid, so a bad code is not reported before an empty password is.
         if (authMode === 'signup' && !isValidInviteCode(authInvite && authInvite.value)) {
           showAuthError('That invitation code was not recognised.');
           showWaitlist();
           return;
         }
   
         const payload = { email, password };
   
         if (authMode === 'signup') {
           // Optional chaining: there is no #authHandle input in index.html, so
           // this was throwing on every signup ("cannot read properties of
           // null") and surfacing as an unexplained error in the auth bar.
           // Falls back to deriving the handle from the email, which is what
           // the no-input case was always meant to do.
           payload.handle = authHandle?.value.trim() || deriveHandle(email);
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
   
     /**
      * Asks the backend which sign-in methods it actually offers, and reveals
      * the social buttons only for those. GET /auth/providers returns e.g.
      * { password: true, social: [] } — an empty social array today, which is
      * why these stay hidden until the backend is configured. Driving the UI
      * off the server means no code change is needed here when that happens.
      */
     async function applyAvailableProviders() {
       let providers;
       try {
         providers = await apiRequest('/auth/providers');
       } catch (err) {
         return;  // offline or unreachable — leave social hidden, password still works
       }

       const social = Array.isArray(providers && providers.social) ? providers.social : [];
       const googleReady = social.includes('google') && Boolean(GOOGLE_OAUTH_CLIENT_ID);

       // Apple has no client implementation here yet, so it stays hidden even
       // if the backend starts advertising it — better than a button that
       // looks available and does nothing.
       if (googleReady && sidebarPanel) {
         sidebarPanel.classList.add('is-social-enabled');
       }
     }

     /**
      * Obtains a Google ID token via Chrome's identity API.
      *
      * launchWebAuthFlow with response_type=id_token, NOT getAuthToken:
      * getAuthToken returns an OAuth *access* token, while POST /auth/social
      * requires an *id_token* (a signed JWT the backend can verify against
      * Google's public keys without trusting this client).
      *
      * @returns {Promise<string>} The raw id_token.
      */
     function getGoogleIdToken() {
       return new Promise((resolve, reject) => {
         if (!chrome.identity || !chrome.identity.launchWebAuthFlow) {
           reject(new Error('Google sign-in is unavailable in this browser.'));
           return;
         }

         // Single-use random value echoed back inside the signed token, so a
         // token captured from another session cannot be replayed into this one.
         const nonce = crypto.randomUUID();
         const redirectUri = chrome.identity.getRedirectURL();

         const authUrl =
           'https://accounts.google.com/o/oauth2/v2/auth' +
           '?client_id=' + encodeURIComponent(GOOGLE_OAUTH_CLIENT_ID) +
           '&response_type=id_token' +
           '&redirect_uri=' + encodeURIComponent(redirectUri) +
           '&scope=' + encodeURIComponent('openid email profile') +
           '&nonce=' + encodeURIComponent(nonce) +
           '&prompt=select_account';

         chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
           if (chrome.runtime.lastError || !responseUrl) {
             reject(new Error('Google sign-in was cancelled.'));
             return;
           }
           // Implicit flow returns the token in the URL FRAGMENT, which never
           // reaches a server, unlike a query string.
           const fragment = responseUrl.split('#')[1] || '';
           const idToken = new URLSearchParams(fragment).get('id_token');
           if (!idToken) {
             reject(new Error('Google did not return a usable sign-in token.'));
             return;
           }
           resolve(idToken);
         });
       });
     }

     if (authGoogleBtn) {
       authGoogleBtn.addEventListener('click', async () => {
         clearAuthError();
         setAuthLoading(true);
         try {
           const idToken = await getGoogleIdToken();
           // The id_token is forwarded straight to our own backend for
           // verification and exchanged for our own session token. It is never
           // logged, and never stored — only the resulting app token is.
           const data = await apiRequest('/auth/social', {
             method: 'POST',
             body: { provider: 'google', id_token: idToken }
           });
           await persistSession(data);
           AUTH_FIELDS.forEach((f) => { if (f) f.value = ''; });
           showWorkspaceView();
         } catch (err) {
           showAuthError(err.message);
         } finally {
           setAuthLoading(false);
         }
       });
     }

     if (authAppleBtn) {
       authAppleBtn.addEventListener('click', () => {
         showAuthError('Apple sign-in is not set up yet.');
       });
     }

     applyAvailableProviders();
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
      // Only the explicit remove control deletes. The whole tile used to be the
      // delete target, so clicking a product to look at it made it vanish —
      // there was no way to interact with an item without destroying it.
      const removeBtn = event.target.closest('.product-tile-remove');
      if (!removeBtn) return;

      const productTile = removeBtn.closest('.collected-product-tile');

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
     LISTS — real ones, from the API
     --------------------------------------------------------------------------
     The dropdown shipped with three hardcoded names (Wishlist/Shopping/
     Favorites) and "Create List" did nothing, so collected items could never
     actually be saved. These call the same endpoints requests.js declares —
     reimplemented here because requests.js is a CONTENT script and is not
     loaded in this panel iframe, so its functions are not reachable from here.
     -------------------------------------------------------------------------- */

  let availableLists = [];
  let selectedListId = null;

  /** Renders `availableLists` into the dropdown, keeping "Create List" first. */
  function renderListOptions() {
    const menu = document.querySelector('.list-dropdown-component .dropdown-options-list');
    if (!menu) return;

    menu.querySelectorAll('.dropdown-option:not(.create-action-btn)').forEach((el) => el.remove());

    if (!availableLists.length) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-empty';
      empty.textContent = 'No lists yet';
      menu.appendChild(empty);
      return;
    }

    availableLists.forEach((list) => {
      const btn = document.createElement('button');
      btn.className = 'dropdown-option';
      btn.setAttribute('data-value', list.id);
      btn.textContent = list.name || 'Untitled list';
      menu.appendChild(btn);
    });
  }

  /**
   * True when we are running on the fake session the dev bypass creates.
   *
   * Its token is deliberately invalid, so every /api call 401s — which meant
   * lists could not be listed, created or saved to at all while testing. In
   * that mode the list flow runs against chrome.storage instead, so the whole
   * journey is exercisable without a real account. Turning DEV_AUTH_BYPASS off
   * puts every one of these back on the real API with no other change.
   */
  function usingDevSession() {
    return DEV_AUTH_BYPASS && isUnpackedInstall();
  }

  function readDevLists() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ devLists: [] }, (r) => resolve((r && r.devLists) || []));
      } catch (e) { resolve([]); }
    });
  }

  /**
   * The list every account starts with, so the dropdown is never empty and
   * something can be collected into it before any list has been made.
   */
  const DEFAULT_LIST = { id: 'default', name: 'My Collection' };

  /** Prepends the default list unless a list by that name already exists. */
  function withDefaultList(lists) {
    const has = lists.some((l) => (l.name || '').toLowerCase() === DEFAULT_LIST.name.toLowerCase());
    return has ? lists : [DEFAULT_LIST, ...lists];
  }

  async function loadLists() {
    if (usingDevSession()) {
      availableLists = withDefaultList(await readDevLists());
      renderListOptions();
      selectDefaultListIfNone();
      return;
    }
    try {
      const data = await apiRequest('/api/lists');
      // The endpoint has been seen returning both a bare array and a wrapper;
      // accept either rather than depending on which.
      availableLists = withDefaultList(
        Array.isArray(data) ? data : (data?.lists || data?.items || []));
      renderListOptions();
      selectDefaultListIfNone();
    } catch (err) {
      // Not surfaced as an error banner: this fires on every panel open,
      // including when signed out. The default still stands so the section is
      // usable rather than blank.
      availableLists = withDefaultList([]);
      renderListOptions();
      selectDefaultListIfNone();
    }
  }

  /** Preselects the default so the plus works without picking a list first. */
  function selectDefaultListIfNone() {
    if (selectedListId) return;
    const display = document.querySelector('.list-dropdown-component .selected-value-display');
    selectedListId = DEFAULT_LIST.id;
    if (display) display.innerText = DEFAULT_LIST.name;
  }

  async function createListNamed(name) {
    if (usingDevSession()) {
      const lists = await readDevLists();
      const created = { id: 'dev-' + Date.now(), name };
      lists.push(created);
      await new Promise((resolve) => {
        try { chrome.storage.local.set({ devLists: lists }, resolve); }
        catch (e) { resolve(); }
      });
      await loadLists();
      return created;
    }

    const created = await apiRequest('/api/lists', {
      method: 'POST',
      body: { name, description: '' }
    });
    await loadLists();
    return created;
  }

  /**
   * Saves every collected item into `listId`.
   *
   * Two calls per item, because a list holds PRODUCTS, not raw links: the
   * product is registered first (POST /api/products/add), then attached by the
   * id that returns (POST /api/lists/{id}/items).
   *
   * @returns {Promise<{saved:number, failed:number}>}
   */
  async function saveCollectedToList(listId, products) {
    let saved = 0;
    let failed = 0;

    if (usingDevSession()) {
      const key = 'devListItems_' + listId;
      const existing = await new Promise((resolve) => {
        try { chrome.storage.local.get({ [key]: [] }, (r) => resolve((r && r[key]) || [])); }
        catch (e) { resolve([]); }
      });
      await new Promise((resolve) => {
        try { chrome.storage.local.set({ [key]: existing.concat(products) }, resolve); }
        catch (e) { resolve(); }
      });
      return { saved: products.length, failed: 0 };
    }

    for (const product of products) {
      try {
        const created = await apiRequest('/api/products/add', {
          method: 'POST',
          body: {
            source_url: product.productUrl || location.href,
            product_type: 'general',
            name: product.productTitle || 'Product',
            source_site: (() => {
              try { return new URL(product.productUrl).hostname; } catch (e) { return undefined; }
            })(),
            added_via: 'browser_extension'
          }
        });

        const productId = created?.id || created?.product_id || created?._id;
        if (!productId) { failed++; continue; }

        await apiRequest(`/api/lists/${listId}/items`, {
          method: 'POST',
          body: { product_id: productId }
        });
        saved++;
      } catch (err) {
        // One bad item must not abandon the rest of the batch.
        failed++;
      }
    }
    return { saved, failed };
  }

  /** One-line feedback under the Collect area — saving has no other signal. */
  function showCollectStatus(message, isError) {
    let el = document.getElementById('collectStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'collectStatus';
      el.className = 'collect-status';
      const footer = document.querySelector('.sidebar-footer');
      if (footer && footer.parentNode) footer.parentNode.insertBefore(el, footer);
      else return;
    }
    el.textContent = message;
    el.classList.toggle('is-error', Boolean(isError));
    el.classList.add('is-visible');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('is-visible'), 4000);
  }

  // Save everything collected into the selected list.
  const addToListBtn = document.getElementById('addToListBtn');
  if (addToListBtn) {
    addToListBtn.addEventListener('click', async () => {
      if (!selectedListId) {
        showCollectStatus('Choose a list first.', true);
        return;
      }

      const stored = await new Promise((resolve) => {
        try {
          chrome.storage.local.get({ savedProducts: [] }, (r) => resolve((r && r.savedProducts) || []));
        } catch (e) { resolve([]); }
      });

      if (!stored.length) {
        showCollectStatus('Nothing collected yet.', true);
        return;
      }

      addToListBtn.disabled = true;

      const { saved, failed } = await saveCollectedToList(selectedListId, stored);

      if (saved && !failed) {
        // Cleared only on a clean save — a partial one keeps everything, so
        // nothing is lost while it is unclear what did and did not land. The
        // emptied list IS the confirmation, so nothing is announced.
        try { chrome.storage.local.set({ savedProducts: [] }); } catch (e) {}
      } else if (saved && failed) {
        showCollectStatus('Saved ' + saved + ', ' + failed + ' failed. Nothing was cleared.', true);
      } else {
        showCollectStatus('Could not save. Check you are signed in.', true);
      }
      addToListBtn.disabled = false;
    });
  }

  /* ---------- Create a list, inline and on-brand ---------------------------
     window.prompt() draws a native Chrome dialog — its own type, colours and
     buttons, anchored to the top of the browser rather than the panel. This is
     the same field treatment the rest of the panel uses.
     ------------------------------------------------------------------------ */

  const createListRow = document.getElementById('createListRow');
  const createListInput = document.getElementById('createListInput');
  const createListConfirm = document.getElementById('createListConfirm');
  const createListCancel = document.getElementById('createListCancel');

  function openCreateListRow() {
    if (!createListRow) return;
    createListRow.classList.add('is-open');
    if (createListInput) {
      createListInput.value = '';
      createListInput.focus();
    }
  }

  function closeCreateListRow() {
    if (createListRow) createListRow.classList.remove('is-open');
  }

  async function confirmCreateList() {
    const name = (createListInput && createListInput.value.trim()) || '';
    if (!name) {
      if (createListInput) createListInput.focus();
      return;
    }

    const display = document.querySelector('.list-dropdown-component .selected-value-display');
    if (createListConfirm) createListConfirm.disabled = true;

    try {
      const created = await createListNamed(name);
      selectedListId = created?.id || created?.list_id || null;
      if (display) display.innerText = name;
      closeCreateListRow();
    } catch (err) {
      showCollectStatus(err.message || 'Could not create that list.', true);
    } finally {
      if (createListConfirm) createListConfirm.disabled = false;
    }
  }

  if (createListConfirm) createListConfirm.addEventListener('click', confirmCreateList);
  if (createListCancel) createListCancel.addEventListener('click', closeCreateListRow);
  if (createListInput) {
    createListInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmCreateList(); }
      if (e.key === 'Escape') closeCreateListRow();
    });
    // The dropdown closes on any document click; typing in here must not.
    createListInput.addEventListener('click', (e) => e.stopPropagation());
  }

  loadLists();

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
        closeDropdown();

        if (value === 'create-new') {
          openCreateListRow();
          return;
        }

        selectedListId = value;
        display.innerText = option.innerText;
      });
    });

    // Close open dropdown when clicking outside
    document.addEventListener('click', () => {
      if (dropdown.classList.contains('is-active')) closeDropdown();
    });
  });

  // Multi-select is always on; single/multi toggle removed

  /* --------------------------------------------------------------------------
     TRIGGER PICKER IN ACTIVE TAB & MESSAGE LISTENERS
     -------------------------------------------------------------------------- */

  // Hide the panel. The iframe is positioned by the host page, not from in
  // here, so this asks content.js to slide it out — the same message the
  // picker sends when it needs the panel out of the way.
  const sidebarMinimizeBtn = document.getElementById('sidebarMinimizeBtn');
  if (sidebarMinimizeBtn) {
    sidebarMinimizeBtn.addEventListener('click', () => {
      window.parent.postMessage({ action: 'DECIDIO_MINIMIZE_SIDEBAR' }, '*');
    });
  }

  // Menu button (hamburger) in top right — no action yet, placeholder for future
  const sidebarMenuBtn = document.getElementById('sidebarMenuBtn');
  if (sidebarMenuBtn) {
    sidebarMenuBtn.addEventListener('click', () => {
      // TODO: implement menu actions
    });
  }

  /* --------------------------------------------------------------------------
     COLLECTED ITEMS: LIST VIEW ONLY
     -------------------------------------------------------------------------- */

  // Only list view is available; products are always shown in list format.
  if (productsContainer) {
    productsContainer.classList.remove('is-view-carousel');
    productsContainer.classList.add('is-view-list');
  }

  // Send payload to content script on active tab when user clicks "Add Product"
  if (addProductBtn) {
    addProductBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, {
          action: "START_DECIDIO_PICKER",
          mode: currentSelectionMode,
          lists: availableLists.map((l) => ({ id: l.id, name: l.name || 'Untitled list' })),
          selectedListId
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

    // The picker's footer carousel can change the target list while the panel
    // is hidden; mirror it here so the dropdown does not disagree on return.
    if (message.action === "DECIDIO_PICKER_LIST_CHANGED") {
      selectedListId = message.listId;
      const match = availableLists.find((l) => String(l.id) === String(message.listId));
      const display = document.querySelector('.list-dropdown-component .selected-value-display');
      if (match && display) display.innerText = match.name || 'Untitled list';
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

  // Row, not card. Mirrors ARIdentifyPage.itemRow (ARScanView.swift:738):
  // a 70x50 thumbnail, 16pt gap, then two stacked lines of white text, with
  // 16/12 padding and a white hairline rule beneath. Stacking vertically is
  // what lets every collected image be seen at once — the horizontal carousel
  // this replaces showed roughly two at a time and hid the rest behind a
  // sideways scroll.
  const itemNumber = String(existingTiles + 1).padStart(2, '0');

  const productTile = document.createElement('div');
  productTile.className = 'collected-product-tile';
  productTile.setAttribute('data-product-url', productUrl);

  // Thumbnail — fixed 70x50, cover-cropped, square corners.
  const imgWrapper = document.createElement('div');
  imgWrapper.className = 'collected-product-thumb';

  const imgPreview = document.createElement('img');
  imgPreview.src = imageUrl;
  imgPreview.alt = productTitle || 'Collected product';
  imgWrapper.appendChild(imgPreview);

  // Text block: first word emphasised above the full title, as the AR row
  // splits a scanned item's title into brand + product.
  // Index, directly beneath the image and flush left — the app's own placement
  // (%02d, SFProDisplay-Heavy, white). Inside the thumb column rather than the
  // text block so it stays under the picture in BOTH views.
  const numberBadge = document.createElement('div');
  numberBadge.className = 'product-tile-number';
  numberBadge.textContent = itemNumber;

  const thumbColumn = document.createElement('div');
  thumbColumn.className = 'collected-product-thumb-col';
  thumbColumn.appendChild(imgWrapper);
  thumbColumn.appendChild(numberBadge);

  const textBlock = document.createElement('div');
  textBlock.className = 'collected-product-text';

  const brandLine = document.createElement('div');
  brandLine.className = 'product-tile-brand';
  brandLine.textContent = (productTitle || '').split(' ')[0] || 'Product';

  // Editable in place. Extraction is a heuristic over arbitrary markup and will
  // always be wrong somewhere; letting the title be corrected here is far
  // cheaper than a per-site driver, and means a bad guess is never a dead end.
  const titleLabel = document.createElement('div');
  titleLabel.className = 'product-tile-title';
  titleLabel.textContent = productTitle || '';
  titleLabel.setAttribute('contenteditable', 'plaintext-only');
  titleLabel.setAttribute('spellcheck', 'false');
  titleLabel.title = 'Click to edit';

  // Editing must not also open the product — the row itself is a link.
  titleLabel.addEventListener('click', (e) => e.stopPropagation());

  titleLabel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleLabel.blur(); }
    if (e.key === 'Escape') { titleLabel.textContent = productTitle || ''; titleLabel.blur(); }
  });

  titleLabel.addEventListener('blur', () => {
    const next = titleLabel.textContent.trim();
    if (!next) { titleLabel.textContent = productTitle || ''; return; }
    if (next === productTitle) return;

    brandLine.textContent = next.split(' ')[0] || 'Product';

    // Persist against the stored item, matched on productUrl.
    try {
      chrome.storage.local.get({ savedProducts: [] }, (result) => {
        if (chrome.runtime.lastError || !result) return;
        const list = (result.savedProducts || []).map((item) =>
          item.productUrl === productUrl ? { ...item, productTitle: next } : item);
        chrome.storage.local.set({ savedProducts: list });
      });
    } catch (e) { /* orphaned context — the edit still shows for this session */ }
  });

  textBlock.appendChild(brandLine);
  textBlock.appendChild(titleLabel);

  // Explicit remove control, so the tile itself is safe to click.
  const removeBtn = document.createElement('button');
  removeBtn.className = 'product-tile-remove';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', 'Remove');
  removeBtn.title = 'Remove';
  removeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  productTile.appendChild(thumbColumn);
  productTile.appendChild(textBlock);
  productTile.appendChild(removeBtn);

  // Anchored AFTER the collected items, in both views. It used to be pinned
  // first in the carousel (order 0) and last in the list (order 999), so it
  // jumped from one end to the other when the view was switched.
  const addBtn = document.getElementById('addProductBtn');
  if (addBtn) addBtn.style.order = '999';

  productTile.style.order = existingTiles + 1;
  container.appendChild(productTile);
}
