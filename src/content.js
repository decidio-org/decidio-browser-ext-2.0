/**
 * The content.js file
 * 
 * This file is responsible for managing the content script that runs in the context of web pages. 
 * It also handles communication between content script and background, as well as the activation/deactivation
 * of Decidio Picker/Decidio Interaction mode.
 */

function activateExtensionUI() {
  console.log("Activating Extension UI...");
  if (document.getElementById('decidio-extension-root')) return;

  const extensionRoot = document.createElement('div');
  extensionRoot.id = 'decidio-extension-root';

  const iframe = document.createElement('iframe');
  iframe.id = 'decidio-main-frame';
  iframe.src = chrome.runtime.getURL('index.html'); 

  iframe.style.position = 'fixed';
  iframe.style.top = '0';
  iframe.style.right = '-450px'; 
  iframe.style.width = '430px'; 
  iframe.style.height = '100vh';
  iframe.style.border = 'none';
  iframe.style.zIndex = '2147483647'; 
  iframe.style.backgroundColor = 'transparent';
  iframe.style.colorScheme = 'none';
  iframe.style.transition = 'right 0.3s ease-in-out'; 

  extensionRoot.appendChild(iframe);
  document.body.appendChild(extensionRoot);

  setTimeout(() => {
    iframe.style.right = '0px'; 
  }, 50);
}

function deactivateExtensionUI() {
  console.log("Deactivating Extension UI...");
  if (decidioPickerInstance) {
    decidioPickerInstance.stop();
  }
  const extensionRoot = document.getElementById('decidio-extension-root');
  if (extensionRoot) {
    const iframe = document.getElementById('decidio-main-frame');
    if (iframe) {
      iframe.style.right = '-450px';
      setTimeout(() => extensionRoot.remove(), 300); 
    } else {
      extensionRoot.remove();
    }
  }
}

chrome.runtime.sendMessage({ action: "GET_EXTENSION_STATE" }, (response) => {
  if (chrome.runtime.lastError) return; 
  if (response && response.isExtensionActive) {
    activateExtensionUI();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggle_decidio.") {
    if (request.state === true) {
      activateExtensionUI();
    } else {
      deactivateExtensionUI();
    }
  }
});

{
    if (!window.hasDecidioPickerRun) {
        window.hasDecidioPickerRun = true;

        class DecidioContentPicker {
            constructor() {
                this.isActive = false;
                this.overlay = null;
                this.badge = null; 
                this.highlightBox = null; // indicator
                this.currentTarget = null; 
                this.stylesId = 'decidio-picker-styles';
            }

            init() {
                this.injectStyles();
                chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                    if (message.action === "START_DECIDIO_PICKER") {
                        this.start();
                    }
                });
            }

            injectStyles() {
                if (document.getElementById(this.stylesId)) return;
                const style = document.createElement('style');
                style.id = this.stylesId;
                style.textContent = `
                
                .decidio-overlay {
                    position: fixed;
                    top: 0; left: 0;
                    width: 100vw; height: 100vh;
                    background: rgba(15, 23, 42, 0.4); 
                    backdrop-filter: blur(4px);        
                    -webkit-backdrop-filter: blur(4px);
                    z-index: 2147483645;              
                    cursor: crosshair;
                    opacity: 0;
    
                    /* Animate the initial fade-in opacity. */
                    transition: opacity 0.3s ease; 
                    pointer-events: auto;
                    clip-path: var(--decidio-cutout, polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%));
                }
                .decidio-overlay.active { 
                    opacity: 1; 
                }
                    
                /* Snapping indicator frame */
                .decidio-highlight-box {
                    position: fixed;
                    z-index: 2147483646;
                    outline: 3px solid #ffffff;
                    box-shadow: 0 0 0 4px #007bff, 0 20px 40px rgba(0,0,0,0.4);
                    pointer-events: none; /* Clicks pass straight through it */
                    display: none;
                    border-radius: 4px;
                }
                .decidio-highlight-box.show {
                    display: block;
                }

                .decidio-hover-badge {
                    position: fixed;
                    z-index: 2147483648; 
                    display: flex;
                    align-items: center;
                    background: rgba(15, 23, 42, 0.9); 
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: #ffffff;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 11px;
                    font-weight: 600;
                    padding: 4px 10px;
                    border-radius: 12px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                    pointer-events: none; 
                    transform: translate(12px, 12px); 
                    opacity: 0;
                    transition: opacity 0.15s ease;
                }

                .decidio-hover-badge.show {
                    opacity: 1;
                }
                .decidio-blue-dot {
                    color: #007bff;
                }
                `;
                document.head.appendChild(style);
            }

            start() {
                if (this.isActive) return;
                this.isActive = true;

                this.overlay = document.createElement('div');
                this.overlay.className = 'decidio-overlay';
                document.body.appendChild(this.overlay);
                setTimeout(() => this.overlay.classList.add('active'), 10);

                this.highlightBox = document.createElement('div');
                this.highlightBox.className = 'decidio-highlight-box';
                document.body.appendChild(this.highlightBox);

                this.badge = document.createElement('div');
                this.badge.className = 'decidio-hover-badge';
                this.badge.innerHTML = 'decidio<span class="decidio-blue-dot">.</span>';
                document.body.appendChild(this.badge);

                // Track both cursor motion and scroll wheel updates
                document.addEventListener('mousemove', this.handleMouseMove, true);
                window.addEventListener('scroll', this.handleScroll, { passive: true, capture: true });
                document.addEventListener('click', this.handleClick, true);
            }

            stop() {
                if (!this.isActive) return;
                this.isActive = false;

                if (this.overlay) {
                    this.overlay.classList.remove('active');
                    setTimeout(() => this.overlay.remove(), 200);
                }
                if (this.highlightBox) this.highlightBox.remove();
                if (this.badge) this.badge.remove();

                this.currentTarget = null;
                document.removeEventListener('mousemove', this.handleMouseMove, true);
                window.removeEventListener('scroll', this.handleScroll, true);
                document.removeEventListener('click', this.handleClick, true);
            }

            // Image Finder Engine MAY NEED TO BE A SEPERATE FILE LATER TO HAVE AN ACCURATE DETECTION
            findTargetImage(element) {
                if (!element) return null;

                // hit
                if (element.tagName === 'IMG') return element;

                // Look inside the element (if hovered on a modern picture wrapper block)
                const innerImg = element.querySelector('img');
                if (innerImg) return innerImg;

                // Look up to parent wrappers or links
                const parentLink = element.closest('a') || element.closest('[class*="product"]');
                if (parentLink) {
                    const linkedImg = parentLink.querySelector('img');
                    if (linkedImg) return linkedImg;
                }

                return null;
            }

            updateHighlight(target) {
                if (!target || !this.highlightBox || !this.overlay) {
                    if (this.highlightBox) this.highlightBox.classList.remove('show');
                    if (this.badge) this.badge.classList.remove('show');
                    // Reset the overlay back to a standard full screen block
                    if (this.overlay) this.overlay.style.removeProperty('--decidio-cutout');
                    return;
                }

                const rect = target.getBoundingClientRect();
    
                // Position the blue outline frame over the target element
                this.highlightBox.style.left = `${rect.left}px`;
                this.highlightBox.style.top = `${rect.top}px`;
                this.highlightBox.style.width = `${rect.width}px`;
                this.highlightBox.style.height = `${rect.height}px`;
    
                // Compute coordinates to dynamically cut a transparent window into the overlay
                const x1 = rect.left;
                const y1 = rect.top;
                const x2 = rect.right;
                const y2 = rect.bottom;

                // A polygon track that wraps around the viewport screen edge then punches a frame inwards
                const cutoutPath = `polygon(
                    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 
                    ${x1}px ${y1}px, 
                    ${x1}px ${y2}px, 
                    ${x2}px ${y2}px, 
                    ${x2}px ${y1}px, 
                    ${x1}px ${y1}px
                )`;
    
                this.overlay.style.setProperty('--decidio-cutout', cutoutPath);

                this.highlightBox.classList.add('show');
                if (this.badge) this.badge.classList.add('show');
            }

            handleMouseMove = (e) => {
                if (!this.isActive) return;

                // Cache the last known physical coordinates of the mouse
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;

                if (this.badge) {
                    this.badge.style.left = `${e.clientX}px`;
                    this.badge.style.top = `${e.clientY}px`;
                }

                this.checkElementAtCursor(e.clientX, e.clientY);
            }

            handleScroll = () => {
                if (!this.isActive) return;
                if (!this.isScrollingTick) {
                    window.requestAnimationFrame(() => {
                    // Re-evaluate what image is physically under the mouse right now
                    this.checkElementAtCursor(this.lastMouseX, this.lastMouseY);
                    this.isScrollingTick = false;
                    });
                    this.isScrollingTick = true;
                }
            }

            // Split out the element checking logic so both mousemove and scroll can share it
            checkElementAtCursor(x, y) {
                this.overlay.style.pointerEvents = 'none';
                let elementUnderneath = document.elementFromPoint(x, y);
                this.overlay.style.pointerEvents = 'auto';

                const targetImg = this.findTargetImage(elementUnderneath);

                if (targetImg) {
                if (this.currentTarget !== targetImg) {
                    this.currentTarget = targetImg;
                }
                    // Always refresh coordinates to keep it locked during scrolling
                    this.updateHighlight(this.currentTarget);
                } else {
                    if (this.currentTarget !== null) {
                        this.currentTarget = null;
                        this.updateHighlight(null);
                    }
                }
            }

            handleClick = (e) => {
                if (!this.isActive) return;
                
                e.preventDefault();
                e.stopPropagation();

                this.overlay.style.pointerEvents = 'none';
                let elementUnderneath = document.elementFromPoint(e.clientX, e.clientY);
                this.overlay.style.pointerEvents = 'auto';

                const target = this.findTargetImage(elementUnderneath);

                if (target) {
                    const imageUrl = target.currentSrc || target.src;
                    const parentLink = target.closest('a');
                    const productUrl = parentLink ? parentLink.href : window.location.href;
                    
                    chrome.runtime.sendMessage({
                        action: "PRODUCT_IMAGE_PICKED",
                        imageUrl: imageUrl,
                        productUrl: productUrl
                    });
                } else {
                    chrome.runtime.sendMessage({
                        action: "DECIDIO_PICKER_CANCELLED"
                    });
                }

                this.stop();
            }
        }
        
        const decidioPicker = new DecidioContentPicker();
        decidioPicker.init();

        window.decidioPickerInstance = decidioPicker;
    }
}