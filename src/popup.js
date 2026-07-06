const API_URL = "https://decidio-api-production.up.railway.app";

async function authenticateUser(endpoint, email, password) {
  const statusDiv = document.getElementById('status');
  statusDiv.style.color = "#8a8f98";
  statusDiv.textContent = "Authenticating...";

  try {
    const payload = { email, password };
    
    if (endpoint.includes('signup')) {
      payload.handle = email.split('@')[0];
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Auth failed with status code: ${response.status}`);
    }

    const result = await response.json();
    const token = result.token || result.access_token || result.jwtToken;

    if (!token) {
      throw new Error("Authentication successful, but no token was found in the payload response.");
    }

    // Secure the token
    await chrome.storage.local.set({ 'jwtToken': token, 'isExtensionActive': true });
    
    statusDiv.style.color = "#10b981";
    statusDiv.textContent = "Successful log-in.";

    // Notify background to swap icons & disable popup UI
    chrome.runtime.sendMessage({ action: "LOGIN_SUCCESS" });
      // Fallback close if no active tab URL is grabbed
      window.close();

  } catch (err) {
    console.error("decidio: Auth pipeline failed", err);
    statusDiv.style.color = "#ef4444";
    statusDiv.textContent = `Error: ${err.message}`;
  }
}

// Attach listeners for both flows
document.getElementById('loginBtn').addEventListener('click', () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert("Please enter both email and password.");
  
  authenticateUser('/auth/login', email, password);
});

document.getElementById('signupBtn').addEventListener('click', () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert("Please enter both email and password.");
  
  authenticateUser('/auth/signup', email, password);
});