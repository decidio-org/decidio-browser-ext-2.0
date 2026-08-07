/* ==========================================================================
   UI COMPONENTS
   ========================================================================== */

function createFloatingToggleButton() {
  if (document.getElementById('decidio-toggle-btn')) return;

  const toggleBtn = document.createElement('div');
  toggleBtn.id = 'decidio-toggle-btn';
  toggleBtn.innerHTML = `d<span style="color: #3b82f6;">.</span>`;
  
  toggleBtn.style.cssText = `
    position: fixed;
    top: 20px;
    right: 24px;
    width: 56px;
    height: 56px;
    background-color: rgba(45, 46, 48, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(197, 191, 191, 0.2);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-family: Arial, sans-serif;
    font-size: 26px;
    font-weight: 800;
    cursor: pointer;
    z-index: 2147483647;
    user-select: none;
    transition: transform 0.2s ease;
  `;

  toggleBtn.addEventListener('mouseenter', () => {
    toggleBtn.style.transform = 'scale(1.05)';
  });
  toggleBtn.addEventListener('mouseleave', () => {
    toggleBtn.style.transform = 'scale(1)';
  });

  toggleBtn.addEventListener('click', () => {
    const extensionRoot = document.getElementById('decidio-extension-root');
    if (extensionRoot) {
      deactivateExtensionUI();
    } else {
      activateExtensionUI();
    }
  });

  document.body.appendChild(toggleBtn);
  updateFloatingToggleBadge();
}

function removeFloatingToggleButton() {
  const toggleBtn = document.getElementById('decidio-toggle-btn');
  if (toggleBtn) {
    toggleBtn.remove();
  }
}

function activateExtensionUI() {
  if (document.getElementById('decidio-extension-root')) return;

  const extensionRoot = document.createElement('div');
  extensionRoot.id = 'decidio-extension-root';
  Object.assign(extensionRoot.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    width: '430px',
    height: '100vh',
    zIndex: '2147483646',
    pointerEvents: 'none'
  });

  const iframe = document.createElement('iframe');
  iframe.id = 'decidio-main-frame';
  iframe.src = chrome.runtime.getURL('index.html'); 
  Object.assign(iframe.style, {
    position: 'absolute',
    top: '0',
    right: '-450px',
    width: '100%',
    height: '100%',
    border: 'none',
    backgroundColor: 'transparent',
    transition: 'right 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
    pointerEvents: 'auto'
  });

  extensionRoot.appendChild(iframe);
  document.body.appendChild(extensionRoot);

  requestAnimationFrame(() => {
    iframe.style.right = '0px';
  });
}

function deactivateExtensionUI() {
  if (window.decidioPickerInstance) {
    window.decidioPickerInstance.stop();
  }

  const extensionRoot = document.getElementById('decidio-extension-root');
  const iframe = document.getElementById('decidio-main-frame');

  if (extensionRoot && iframe) {
    iframe.style.pointerEvents = 'none';
    iframe.style.right = '-450px';

    setTimeout(() => {
      if (extensionRoot) {
        extensionRoot.remove();
      }
    }, 300);
  } else if (extensionRoot) {
    extensionRoot.remove();
  }
}

function updateFloatingToggleBadge(countOverride) {
  const toggleBtn = document.getElementById('decidio-toggle-btn') || document.getElementById('decidioToggle');
  if (!toggleBtn) return;

  if (typeof countOverride === 'number') {
    renderBadgeCount(toggleBtn, countOverride);
  } else {
    chrome.storage.local.get({ savedProducts: [] }, (result) => {
      renderBadgeCount(toggleBtn, result.savedProducts.length);
    });
  }
}

function minimizeSidebar() {
  const iframe = document.getElementById('decidio-main-frame');
  if (iframe) {
    iframe.style.right = '-450px';
  }
}

function restoreSidebar() {
  const iframe = document.getElementById('decidio-main-frame');
  if (iframe) {
    iframe.style.right = '0px';
  }
}