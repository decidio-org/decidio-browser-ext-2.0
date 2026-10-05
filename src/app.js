/**
 * app.js
 * 
 * Manages the iframe UI: sidebar panel visibility, tile rendering, tile removal,
 * the list bar, and triggering the picker on the active tab.
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
  const productsContainer = document.getElementById('products-container');

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


  /**
   * Tells the host page where the panel sits inside this frame, so it can
   * clip its frosted iframe to the same shape. Re-sent whenever the panel's
   * size changes — which is also what happens when it swaps between the
   * sign-in form and the workspace.
   */
  function reportPanelRect() {
    if (!sidebarPanel) return;
    const r = sidebarPanel.getBoundingClientRect();
    if (!r.width || !r.height) return;
    window.parent.postMessage({
      action: 'DECIDIO_PANEL_RECT',
      rect: {
        top: r.top, left: r.left, width: r.width, height: r.height,
        radius: parseFloat(getComputedStyle(sidebarPanel).borderTopLeftRadius) || 0
      }
    }, '*');
  }
  if (sidebarPanel && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(reportPanelRect).observe(sidebarPanel);
  }
  window.addEventListener('resize', reportPanelRect);

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
     const authWaitlistBack = document.getElementById('authWaitlistBack');
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
       // Every way out of the waiting list leaves it asking again, not stuck on
       // the confirmation of a join from earlier in the session.
       const title = document.getElementById('authWaitlistTitle');
       const body = document.getElementById('authWaitlistBody');
       if (title) title.textContent = 'Decidio is invite only';
       if (body) body.textContent = "Leave your email and we'll send you a code when a place opens up.";
       if (authWaitlistBack) authWaitlistBack.textContent = 'I have a code';
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

         // The whole panel becomes the confirmation rather than one line of it
         // changing under an unchanged heading — joining is the end of this
         // flow, so it should read as done.
         const title = document.getElementById('authWaitlistTitle');
         const body = document.getElementById('authWaitlistBody');
         if (title) title.textContent = "Thanks — you're on the list";
         if (body) {
           body.textContent = "We'll email " + email + " as soon as a place opens up. "
             + "You can close this and come back with the code.";
         }
         authWaitlistBtn.textContent = 'Added';
         authWaitlistBtn.disabled = true;
         if (authWaitlistBack) authWaitlistBack.textContent = 'Back to sign in';
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

     if (authWaitlistBack) {
       authWaitlistBack.addEventListener('click', () => {
         // hideWaitlist puts the panel back to its asking state.
         hideWaitlist();
         clearAuthError();
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
  // True while the create-list field is open, so "New List" carries the
  // highlight for as long as it is the thing being acted on.
  let pendingCreate = false;

  /**
   * Renders `availableLists` down the middle of the panel, after the app's own
   * My Collections. Replaced the footer's horizontal strip: that showed one
   * name at a time with the rest behind a scroll, and this screen exists to
   * show what you have.
   *
   * "New list" sits at the end rather than the start — the strip led with it
   * because a carousel has no end, but a column does, and leading a list of
   * your collections with something that is not one of them reads oddly.
   */
  function renderCollections() {
    const host = document.getElementById('collectionsList');
    if (!host) return;

    host.innerHTML = '';

    availableLists.forEach((list, i) => {
      const btn = document.createElement('button');
      btn.className = 'collection-name';
      btn.dataset.value = list.id;
      if (!pendingCreate && String(list.id) === String(selectedListId)) {
        btn.classList.add('is-selected');
      }

      // "01." "02." — the numbered index the app's own My Collections sets
      // beside each name.
      const num = document.createElement('span');
      num.className = 'collection-num';
      num.textContent = String(i + 1).padStart(2, '0') + '.';

      const label = document.createElement('span');
      label.className = 'collection-label';
      label.textContent = list.name || 'Untitled list';

      btn.appendChild(num);
      btn.appendChild(label);
      host.appendChild(btn);
    });

    const add = document.createElement('button');
    add.className = 'collection-name is-new';
    add.dataset.value = 'create-new';
    // Kept in the same two-column shape as the rows above, with the number
    // slot empty, so every label starts on one line down the left.
    add.innerHTML = '<span class="collection-num"></span>'
      + '<span class="collection-label">New list</span>';
    host.appendChild(add);
  }

  // Kept under its old name so the many call sites that just mean "repaint the
  // list of lists" do not all have to change.
  const renderListBar = renderCollections;

  /* ---------- Queue ---------------------------------------------------------
     What was collected into a list but never got a name. The app keeps the
     same thing in ARSessionStore and offers a retry per row; here the retry
     re-reads the product page, which is the one source of a name that is
     still available once the page the item was framed on has gone.
     ------------------------------------------------------------------------ */
  const queueView = document.getElementById('queueView');
  const queueList = document.getElementById('queueList');
  const queueEmpty = document.getElementById('queueEmpty');
  const queueOpenBtn = document.getElementById('queueOpenBtn');
  const queueCountEl = document.getElementById('queueCount');

  const queueKey = (listId) => 'listQueue_' + listId;

  function readQueue(listId) {
    return new Promise((resolve) => {
      const key = queueKey(listId);
      try {
        chrome.storage.local.get({ [key]: [] }, (r) => resolve((r && r[key]) || []));
      } catch (e) { resolve([]); }
    });
  }

  function writeQueue(listId, rows) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set({ [queueKey(listId)]: rows }, resolve); }
      catch (e) { resolve(); }
    });
  }

  async function addToQueue(listId, items) {
    const rows = await readQueue(listId);

    // Anything that came with a name of its own goes into the list straight
    // away — collecting should not need a second confirmation. The queue
    // still records it, so it can be taken back out with the row's ×.
    // Anything unnamed waits here instead; it has nothing to be filed under.
    const ready = items.filter((it) => it.state ? it.state === 'complete' : !!it.productTitle);
    if (ready.length) await saveCollectedToList(listId, ready);

    for (const it of items) {
      const isReady = ready.includes(it);
      rows.push({
        id: 'q' + Date.now() + Math.random().toString(36).slice(2, 7),
        thumb: it.imageUrl || null,
        title: it.productTitle || null,
        productUrl: it.productUrl || null,
        state: it.state === 'pending' ? 'pending' : (isReady ? 'added' : 'failed'),
        error: it.error || null,
        addedAt: Date.now()
      });
    }
    await writeQueue(listId, rows);
  }

  /**
   * Takes an item back out of a list.
   *
   * Matched on its product URL and name, because that is all the queue row
   * carries. The cloud path would want the product id the API returned, which
   * is not kept locally yet — so on a signed-in session the row leaves the
   * queue but the item stays in the cloud list until that id is stored.
   */
  async function removeFromList(listId, row) {
    const key = 'devListItems_' + listId;
    const items = await new Promise((resolve) => {
      try { chrome.storage.local.get({ [key]: [] }, (r) => resolve((r && r[key]) || [])); }
      catch (e) { resolve([]); }
    });

    let dropped = false;
    const kept = items.filter((it) => {
      if (dropped) return true;                 // only the one copy
      const same = (it.productUrl || null) === (row.productUrl || null)
        && (it.productTitle || null) === (row.title || null);
      if (same) { dropped = true; return false; }
      return true;
    });

    await new Promise((resolve) => {
      try { chrome.storage.local.set({ [key]: kept }, resolve); } catch (e) { resolve(); }
    });
  }

  /** The number beside the menu entry, for the list in view. */
  async function refreshQueueCount() {
    if (!queueCountEl) return;
    const id = openListId || selectedListId;
    if (!id) { queueCountEl.textContent = ''; return; }
    const rows = await readQueue(id);
    queueCountEl.textContent = rows.length ? ' ' + rows.length : '';
  }

  function queueStateLabel(row) {
    if (row.state === 'pending') return 'Identifying…';
    if (row.state === 'added') return 'Added to list';
    return row.error === 'No name found on the page' ? "Couldn't identify" : (row.error || "Couldn't identify");
  }

  async function renderQueue() {
    if (!queueList) return;
    const id = openListId || selectedListId;
    const rows = id ? await readQueue(id) : [];

    queueList.innerHTML = '';
    if (queueEmpty) queueEmpty.hidden = rows.length > 0;

    const esc = (v) => String(v == null ? '' : v).replace(/[<>&"]/g, (c) => (
      { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
    ));

    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'queue-row is-' + row.state;
      el.dataset.id = row.id;
      el.innerHTML = `
        ${row.thumb ? `<img class="queue-thumb" src="${esc(row.thumb)}" alt="">`
                    : '<span class="queue-thumb"></span>'}
        <span class="queue-text">
          <span class="queue-name">${esc(row.title || 'Unnamed item')}</span>
          <span class="queue-state">${esc(queueStateLabel(row))}</span>
        </span>
        ${row.state === 'added'
            ? ''
            : (row.productUrl ? '<button class="queue-retry" data-id="' + esc(row.id) + '">Retry</button>' : '')}
        <button class="queue-discard" data-id="${esc(row.id)}" aria-label="Remove" title="Remove">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>`;
      queueList.appendChild(el);
    }
    refreshQueueCount();
  }

  /**
   * Reads a name out of the product page itself.
   *
   * The page the item was framed on is long gone by the time anyone opens the
   * queue, so the only thing left to ask is the product URL. Parsed the same
   * way the picker parses a live page — structured data first, then the
   * page's own title — rather than guessing from the URL.
   *
   * @param {string} url
   * @returns {Promise<string|null>}
   */
  async function fetchTitleFor(url) {
    let html;
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) return null;
      html = await res.text();
    } catch (e) {
      return null;   // blocked by CORS, offline, or the page is gone
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');

    for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(node.textContent);
        const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
        for (const it of items) {
          const t = it && it['@type'];
          const types = Array.isArray(t) ? t : [t];
          if ((types.includes('Product') || types.includes('IndividualProduct')) && it.name) {
            return typeof it.name === 'string' ? it.name : null;
          }
        }
      } catch (e) { /* malformed block — try the next */ }
    }

    const og = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
    if (og && og.trim()) return og.trim();

    const h1 = doc.querySelector('h1')?.textContent;
    if (h1 && h1.trim()) return h1.trim().replace(/\s+/g, ' ');

    const title = doc.querySelector('title')?.textContent;
    return title && title.trim() ? title.trim() : null;
  }

  /** Retry one row: name it, and on success move it into the list. */
  async function retryQueueRow(rowId, btn) {
    const id = openListId || selectedListId;
    if (!id) return;

    const rows = await readQueue(id);
    const row = rows.find((r) => r.id === rowId);
    if (!row || !row.productUrl) return;

    if (btn) { btn.disabled = true; btn.textContent = 'Trying…'; }
    const name = await fetchTitleFor(row.productUrl);

    if (!name) {
      if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
      showCollectStatus("Still couldn't read that page.", true);
      return;
    }

    // Now that it has a name it is filed, the same as one that arrived with
    // one, and the row stays as the way to take it back out.
    await saveCollectedToList(id, [{
      imageUrl: row.thumb, productUrl: row.productUrl, productTitle: name
    }]);
    row.title = name;
    row.state = 'added';
    row.error = null;
    await writeQueue(id, rows);
    renderQueue();
    // The list has gained a row, but refreshing it here would also reset the
    // header to the list's name while the queue is still the screen in view.
    // closeQueue refreshes instead, on the way back.
  }

  /**
   * Throws a row away — and, for one that was filed on arrival, takes it back
   * out of the list too. The × is the single undo for collecting something by
   * mistake, so it has to undo the whole of it.
   */
  async function discardQueueRow(rowId) {
    const id = openListId || selectedListId;
    if (!id) return;

    const rows = await readQueue(id);
    const row = rows.find((r) => r.id === rowId);
    if (row && row.state === 'added') await removeFromList(id, row);

    await writeQueue(id, rows.filter((r) => r.id !== rowId));
    renderQueue();
  }

  if (queueList) {
    queueList.addEventListener('click', (e) => {
      const retry = e.target.closest('.queue-retry');
      if (retry) { retryQueueRow(retry.dataset.id, retry); return; }
      const discard = e.target.closest('.queue-discard');
      if (discard) discardQueueRow(discard.dataset.id);
    });
  }

  function closeQueue() {
    if (!queueView) return;
    queueView.hidden = true;
    if (sidebarPanel) sidebarPanel.classList.remove('is-queue');
    // Anything the queue resolved went into the list, so the list is repainted
    // on the way out rather than while it is still behind the queue.
    if (openListId) openList(openListId);
    else setHeaderTitle(null);
  }

  async function openQueue() {
    if (!queueView) return;
    if (!openListId && !selectedListId) {
      showCollectStatus('Choose a list first.', true);
      return;
    }
    setMenuOpen(false);
    const t = document.getElementById('queueTitle');
    if (t) t.textContent = listNameFor(openListId || selectedListId);
    await renderQueue();
    setHeaderTitle('Queue');
    queueView.hidden = false;
    if (sidebarPanel) sidebarPanel.classList.add('is-queue');
  }

  if (queueOpenBtn) queueOpenBtn.addEventListener('click', openQueue);

  /* ---------- An opened list ------------------------------------------------
     Tapping a name opens it: the header takes the list's name in place of
     "My Collections", the column of names gives way to that list's items, and
     the back arrow comes back here instead of closing the panel.
     ------------------------------------------------------------------------ */
  let openListId = null;

  function listNameFor(id) {
    const list = availableLists.find((l) => String(l.id) === String(id));
    return (list && list.name) || 'Untitled list';
  }

  /** The items filed into a list. */
  function readListItems(listId) {
    return new Promise((resolve) => {
      const key = 'devListItems_' + listId;
      try {
        chrome.storage.local.get({ [key]: [] }, (r) => resolve((r && r[key]) || []));
      } catch (e) { resolve([]); }
    });
  }

  async function openList(listId) {
    if (!listId) return;
    openListId = listId;
    selectedListId = listId;

    setHeaderTitle(listNameFor(listId));
    if (sidebarPanel) sidebarPanel.classList.add('is-in-list');

    const items = await readListItems(listId);
    if (productsContainer) {
      productsContainer.querySelectorAll('.collected-product-tile').forEach((t) => t.remove());
      // Newest first, the order the collected rows already use.
      [...items].reverse().forEach((it) => {
        displaySelectedProduct(it.imageUrl, it.productUrl, it.productTitle || 'Product', productsContainer);
      });
    }

    const empty = document.getElementById('listEmpty');
    if (empty) empty.hidden = items.length > 0;
    refreshQueueCount();
  }

  /** Back out of an opened list to the column of names. */
  function closeList() {
    openListId = null;
    if (sidebarPanel) sidebarPanel.classList.remove('is-in-list');
    setHeaderTitle(null);
    const empty = document.getElementById('listEmpty');
    if (empty) empty.hidden = true;
    if (productsContainer) {
      productsContainer.querySelectorAll('.collected-product-tile').forEach((t) => t.remove());
    }
    renderCollections();
  }

  /**
   * Ends a creation, however it ended. There is no name row to close any more
   * — the sheet is the whole flow — so this just stops "New list" being the
   * live target and repaints.
   */
  function endCreate() {
    pendingCreate = false;
    renderCollections();
  }

  document.addEventListener('click', (e) => {
    const name = e.target.closest && e.target.closest('.collection-name');
    if (!name) return;

    if (name.dataset.value === 'create-new') {
      // Straight to the sheet — the name is typed there, next to what the list
      // is for, rather than on a prompt that has to be cleared first.
      pendingCreate = true;
      renderCollections();
      openNotesForCreate();
      return;
    }
    pendingCreate = false;
    selectedListId = name.dataset.value;
    renderListBar();
    openList(name.dataset.value);

    // The footer stays live while notes are up, so the list under them can
    // change out from under the screen. Notes belong to a list, so follow it:
    // the edit view reloads against the newly selected one (flushing whatever
    // was typed against the old one first), and a half-finished creation is
    // abandoned, since picking an existing list is a decision not to make a
    // new one.
    if (notesView && !notesView.hidden) {
      if (notesMode === 'create') {
        closeNotes();
        endCreate();
      } else {
        flushNotes();
        openNotesForEdit();
      }
    }
  });

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
      renderListBar();
      selectDefaultListIfNone();
      return;
    }
    try {
      const data = await apiRequest('/api/lists');
      // The endpoint has been seen returning both a bare array and a wrapper;
      // accept either rather than depending on which.
      availableLists = withDefaultList(
        Array.isArray(data) ? data : (data?.lists || data?.items || []));
      renderListBar();
      selectDefaultListIfNone();
    } catch (err) {
      // Not surfaced as an error banner: this fires on every panel open,
      // including when signed out. The default still stands so the section is
      // usable rather than blank.
      availableLists = withDefaultList([]);
      renderListBar();
      selectDefaultListIfNone();
    }
  }

  /**
   * Preselects "My Collection" so the plus works without picking a list first,
   * and so the bar opens with a real name centred.
   *
   * Matched by NAME rather than by DEFAULT_LIST.id: when the backend returns a
   * list already called "My Collection", withDefaultList keeps the server's
   * copy and its own id, so the hardcoded 'default' id matched no button at
   * all — nothing carried .is-selected, and the strip sat at scroll 0, which
   * left "New List" sitting in the centre instead.
   */
  function selectDefaultListIfNone() {
    if (selectedListId) return;

    const preferred =
      availableLists.find((l) => (l.name || '').toLowerCase() === DEFAULT_LIST.name.toLowerCase()) ||
      availableLists[0];

    if (preferred) selectedListId = preferred.id;
    renderListBar();
  }

  async function createListNamed(name, description = '') {
    if (usingDevSession()) {
      const lists = await readDevLists();
      const created = { id: 'dev-' + Date.now(), name, description };
      lists.push(created);
      await new Promise((resolve) => {
        try { chrome.storage.local.set({ devLists: lists }, resolve); }
        catch (e) { resolve(); }
      });
      await loadLists();
      return created;
    }

    // description is the one note field the API has a home for; preferences
    // has no field yet and stays local (see setNotesOpen).
    const created = await apiRequest('/api/lists', {
      method: 'POST',
      body: { name, description }
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

  const collectBtn = document.getElementById('collectBtn');

  /**
   * Files everything collected into the selected list.
   *
   * There is no button for this any more: the footer's plus used to be a
   * second press confirming where the items went, and with the list chosen in
   * the body there is nothing left for it to confirm. So collecting files the
   * items itself, as soon as the picker hands them back.
   */
  async function fileCollectedItems() {
    if (!selectedListId) {
      showCollectStatus('Choose a list first.', true);
      return;
    }

    const stored = await new Promise((resolve) => {
      try {
        chrome.storage.local.get({ savedProducts: [] }, (r) => resolve((r && r.savedProducts) || []));
      } catch (e) { resolve([]); }
    });
    if (!stored.length) return;

    // Everything the aperture collects lands in the list's queue first,
    // named or not. The queue is where a batch is looked over before it is
    // kept — each row can be added to the list or thrown away — rather than
    // items appearing in the list the moment they are framed.
    await addToQueue(selectedListId, stored);
    try { chrome.storage.local.set({ savedProducts: [] }); } catch (e) {}
    refreshQueueCount();
    if (queueView && !queueView.hidden) renderQueue();
  }



  loadLists();

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
      // The arrow goes up ONE level, and only closes the panel from the top.
      // Checked outermost first, because more than one of these can be true at
      // once — notes opened from inside a list leave that list open behind
      // them, and the menu can be opened over either.
      if (panelMenu && !panelMenu.hidden) {
        setMenuOpen(false);
        return;
      }

      if (queueView && !queueView.hidden) {
        closeQueue();
        return;
      }

      if (notesView && !notesView.hidden) {
        // Backing out of a creation abandons it, as Escape does.
        const wasCreating = notesMode === 'create';
        closeNotes();
        if (wasCreating) endCreate();
        return;
      }

      if (openListId) {
        closeList();
        return;
      }

      window.parent.postMessage({ action: 'DECIDIO_MINIMIZE_SIDEBAR' }, '*');
    });
  }

  /* --------------------------------------------------------------------------
     MENU + APPEARANCE (Aero / Twilight)
     -------------------------------------------------------------------------- */

  // Hamburger in the top right, after HomeOverlayMenuBar: opens the menu over
  // the workspace and turns into the X that closes it.
  const sidebarMenuBtn = document.getElementById('sidebarMenuBtn');
  const panelMenu = document.getElementById('panelMenu');
  const appearanceToggle = document.getElementById('appearanceToggle');
  const appearanceLabel = document.getElementById('appearanceLabel');

  function setMenuOpen(open) {
    if (!panelMenu || !sidebarMenuBtn) return;
    panelMenu.hidden = !open;
    sidebarMenuBtn.classList.add('has-toggled');
    sidebarMenuBtn.classList.toggle('is-open', open);
    sidebarMenuBtn.setAttribute('aria-expanded', String(open));
    sidebarMenuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    sidebarMenuBtn.title = open ? 'Close menu' : 'Menu';
    if (open && appearanceToggle) appearanceToggle.focus();
  }

  if (sidebarMenuBtn) {
    sidebarMenuBtn.addEventListener('click', () => setMenuOpen(panelMenu && panelMenu.hidden));
  }

  /* ------------------------------------------------------------------
     NOTES
     ------------------------------------------------------------------
     The app's New Collection screen, per list. Notes are the list's own,
     so they are keyed by list id and reloaded whenever the selected list
     changes underneath the view.

     Saving is debounced on every keystroke rather than deferred to a
     close or a backgrounding: in the app that deferral is a known way to
     lose an edit (CLAUDE.md, pending work 1), and a browser tab can be
     closed at any moment with no equivalent of applicationDidEnterBackground.
     ------------------------------------------------------------------ */
  const notesView = document.getElementById('notesView');
  const notesTitle = document.getElementById('notesTitle');
  const notesDescription = document.getElementById('notesDescription');
  const notesPreferences = document.getElementById('notesPreferences');
  const notesSaved = document.getElementById('notesSaved');
  const headerTitle = document.getElementById('headerTitle');
  const notesOpenBtn = document.getElementById('notesOpenBtn');
  const notesDoneBtn = document.getElementById('notesDoneBtn');

  const notesKey = (listId) => 'listNotes_' + listId;
  let notesSaveTimer = null;
  let notesSavedTimer = null;
  let notesListId = null;
  // 'edit' saves as you type against an existing list; 'create' holds the
  // name typed on the previous step and writes nothing until the check is
  // pressed, because there is no list id to write against yet.
  let notesMode = 'edit';

  /** Grows a field to fit its text, so nothing scrolls inside a section. */
  function autoGrow(field) {
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = field.scrollHeight + 'px';
  }

  function readNotes(listId) {
    return new Promise((resolve) => {
      const key = notesKey(listId);
      try {
        chrome.storage.local.get({ [key]: null }, (r) => resolve((r && r[key]) || {}));
      } catch (e) { resolve({}); }
    });
  }

  function flushNotes() {
    if (notesSaveTimer) { clearTimeout(notesSaveTimer); notesSaveTimer = null; }
    if (notesMode === 'create' || !notesListId) return;
    const key = notesKey(notesListId);
    const value = {
      description: notesDescription ? notesDescription.value : '',
      preferences: notesPreferences ? notesPreferences.value : '',
      updatedAt: Date.now()
    };
    try { chrome.storage.local.set({ [key]: value }); } catch (e) {}

    if (notesSaved) {
      notesSaved.textContent = 'Saved';
      notesSaved.classList.add('is-shown');
      clearTimeout(notesSavedTimer);
      notesSavedTimer = setTimeout(() => notesSaved.classList.remove('is-shown'), 1200);
    }
  }

  function queueNotesSave() {
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(flushNotes, 400);
  }

  // The wordmark's size. A title is set at this to start with, and only ever
  // steps down from it.
  const HEADER_TITLE_MAX = 32;
  const HEADER_TITLE_MIN = 18;

  /**
   * Shrinks a title until it fits the header row.
   *
   * Titles are list names, so their length is whatever the user typed. They
   * are set at the wordmark's size and only stepped down when that would
   * overflow, which keeps every short name — the usual case — identical in
   * size to the wordmark it replaced.
   */
  function fitHeaderTitle() {
    if (!headerTitle || headerTitle.hidden) return;

    let size = HEADER_TITLE_MAX;
    headerTitle.style.fontSize = size + 'px';
    // scrollWidth only exceeds clientWidth once the text genuinely overflows,
    // which is exactly the condition to shrink on.
    while (headerTitle.scrollWidth > headerTitle.clientWidth && size > HEADER_TITLE_MIN) {
      size -= 1;
      headerTitle.style.fontSize = size + 'px';
    }
  }

  /** Swaps the header's wordmark for a screen title, or back. */
  function setHeaderTitle(text) {
    if (!headerTitle || !sidebarPanel) return;
    headerTitle.hidden = !text;
    sidebarPanel.classList.toggle('is-titled', !!text);
    if (text) {
      headerTitle.firstChild.textContent = text;
      fitHeaderTitle();
    }
  }

  function closeNotes() {
    if (!notesView) return;
    flushNotes();
    notesView.hidden = true;
    notesMode = 'edit';
    // Notes can be opened from inside a list, and closing them goes back to
    // that list — so the header returns to its name, not to the wordmark.
    setHeaderTitle(openListId ? listNameFor(openListId) : null);
    if (notesDoneBtn) notesDoneBtn.hidden = true;
    if (collectBtn) collectBtn.hidden = false;
  }

  /** Puts the view on screen, whichever mode filled it. */
  function showNotes() {
    setMenuOpen(false);
    notesView.hidden = false;
    if (notesDoneBtn) notesDoneBtn.hidden = false;
    if (collectBtn) collectBtn.hidden = true;
    // Sized only once visible — a hidden textarea has no scrollHeight.
    autoGrow(notesDescription);
    autoGrow(notesPreferences);
    // Naming comes first when there is no name yet.
    const first = notesMode === 'create' ? notesTitle : notesDescription;
    if (first) first.focus();
  }

  /**
   * Step two of creating a list: the name has been typed, nothing exists yet.
   * Both fields start empty and the check creates the list.
   */
  function openNotesForCreate() {
    if (!notesView) return;
    notesMode = 'create';
    notesListId = null;
    setHeaderTitle('New Collection');
    if (notesTitle) {
      notesTitle.value = '';
      notesTitle.readOnly = false;
    }
    if (notesDescription) notesDescription.value = '';
    if (notesPreferences) notesPreferences.value = '';
    if (notesSaved) notesSaved.classList.remove('is-shown');
    showNotes();
  }

  /** Editing the notes of a list that already exists. */
  async function openNotesForEdit() {
    if (!notesView) return;
    if (!selectedListId) {
      showCollectStatus('Choose a list first.', true);
      return;
    }

    notesMode = 'edit';
    // Notes belong to whichever list is selected now, not whichever was
    // selected when the view was last open.
    notesListId = selectedListId;
    const list = availableLists.find((l) => String(l.id) === String(selectedListId));
    setHeaderTitle('Notes');
    if (notesTitle) {
      notesTitle.value = (list && list.name) || '';
      notesTitle.readOnly = true;
    }

    const stored = await readNotes(notesListId);
    if (notesDescription) notesDescription.value = stored.description || '';
    if (notesPreferences) notesPreferences.value = stored.preferences || '';
    showNotes();
  }

  /**
   * The check at the bottom. In edit mode it just closes; in create mode it is
   * the action that actually makes the list, so a failure has to keep the view
   * up with everything typed still in it.
   */
  async function confirmNotes() {
    if (notesMode !== 'create') {
      closeNotes();
      return;
    }

    // The name is the one required part, and it is on this screen now, so this
    // is where it is checked.
    const name = notesTitle ? notesTitle.value.trim() : '';
    if (!name) {
      if (notesTitle) notesTitle.focus();
      showCollectStatus('Name your list first.', true);
      return;
    }

    const description = notesDescription ? notesDescription.value.trim() : '';
    const preferences = notesPreferences ? notesPreferences.value.trim() : '';

    if (notesDoneBtn) notesDoneBtn.disabled = true;
    try {
      const created = await createListNamed(name, description);
      const id = created?.id || created?.list_id || null;

      if (id) {
        selectedListId = id;
        if (!availableLists.some((l) => String(l.id) === String(id))) {
          availableLists.push({ id, name });
        }
        // Preferences have no field on the API, so they are kept locally
        // against the id the list just got. Description is stored here too so
        // reopening the notes shows what was typed without a round trip.
        try {
          chrome.storage.local.set({
            [notesKey(id)]: { description, preferences, updatedAt: Date.now() }
          });
        } catch (e) {}
      }

      closeNotes();
      endCreate();
      renderListBar();
      // A list you just described is one you want to be in.
      if (id) openList(id);
    } catch (err) {
      showCollectStatus(err.message || 'Could not create that list.', true);
    } finally {
      if (notesDoneBtn) notesDoneBtn.disabled = false;
    }
  }

  for (const field of [notesDescription, notesPreferences]) {
    if (!field) continue;
    field.addEventListener('input', () => { autoGrow(field); queueNotesSave(); });
    field.addEventListener('blur', flushNotes);
  }

  if (notesOpenBtn) notesOpenBtn.addEventListener('click', openNotesForEdit);
  if (notesDoneBtn) notesDoneBtn.addEventListener('click', confirmNotes);

  // A closing tab gets one last synchronous chance to write.
  window.addEventListener('pagehide', flushNotes);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (queueView && !queueView.hidden) {
      closeQueue();
      return;
    }
    if (notesView && !notesView.hidden) {
      // Escaping out of creation abandons it — nothing has been made yet.
      // Read the mode before closeNotes resets it.
      const wasCreating = notesMode === 'create';
      closeNotes();
      if (wasCreating) endCreate();
      return;
    }
    if (panelMenu && !panelMenu.hidden) {
      setMenuOpen(false);
      if (sidebarMenuBtn) sidebarMenuBtn.focus();
      return;
    }
    // Same ladder the back arrow walks.
    if (openListId) closeList();
  });

  /**
   * Applies Aero (white) or Twilight (near-black) — the app's two
   * MatteBackground modes. The entry names the mode it will switch TO, as the
   * app's own menu does ("Switch to Aero" while dark).
   *
   * @param {'aero'|'twilight'} mode
   */
  function applyAppearance(mode) {
    const aero = mode === 'aero';
    if (sidebarPanel) sidebarPanel.classList.toggle('is-aero', aero);
    if (appearanceLabel) appearanceLabel.textContent = aero ? 'Switch to Twilight' : 'Switch to Aero';
  }

  if (appearanceToggle) {
    appearanceToggle.addEventListener('click', () => {
      const next = sidebarPanel && sidebarPanel.classList.contains('is-aero') ? 'twilight' : 'aero';
      applyAppearance(next);
      // Remembered across panel opens and tabs, like the app's AppearanceStore.
      try { chrome.storage.local.set({ panelAppearance: next }); } catch (e) { /* orphaned context */ }
    });
  }

  applyAppearance('twilight');
  try {
    chrome.storage.local.get({ panelAppearance: 'twilight' }, (r) => {
      if (!chrome.runtime.lastError && r) applyAppearance(r.panelAppearance);
    });
  } catch (e) { /* keep the default */ }

  /* --------------------------------------------------------------------------
     COLLECTED ITEMS: LIST VIEW ONLY
     -------------------------------------------------------------------------- */

  // Only list view is available; products are always shown in list format.
  if (productsContainer) {
    productsContainer.classList.remove('is-view-carousel');
    productsContainer.classList.add('is-view-list');
  }

  // Send payload to content script on active tab when user clicks "Add Product"
  if (collectBtn) {
    collectBtn.addEventListener('click', async () => {
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

    // Collecting now files the items itself — see fileCollectedItems.
    if (message.action === "RENDER_PICKED_PRODUCT") fileCollectedItems();

    // The picker's footer carousel can change the target list while the panel
    // is hidden; mirror it here so the dropdown does not disagree on return.
    if (message.action === "DECIDIO_PICKER_LIST_CHANGED") {
      selectedListId = message.listId;
      renderListBar();
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

  productTile.style.order = existingTiles + 1;
  container.appendChild(productTile);
}
