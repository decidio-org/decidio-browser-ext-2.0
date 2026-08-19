/* ==========================================================================
   PICKER CLASS (INTEGRATED WITH DRIVER.JS)
   ========================================================================== */

/**
 * Interactive element picker for target product image selection on web pages.
 * Renders an isolated Shadow DOM overlay with dynamic clip-path target highlighting
 * and supports both single-item and batch-item picking modes.
 */
class DecidioContentPicker {
  /**
   * Initializes instance state, DOM element references, and animation frame throttling flags.
   */
  constructor() {
    this.isActive = false;          // Tracks whether the picker overlay is active
    this.selectionMode = 'single';  // 'single' | 'multi'
    this.selectedBatch = [];        // Stores accumulated items in multi-selection mode
    this.currentTarget = null;      // Currently hovered target HTMLImageElement
    this.hostElement = null;        // Container injected into host document
    this.shadowRoot = null;         // Isolated Shadow DOM root
    this.highlightBox = null;       // Highlighting element surrounding hovered target
    this.overlay = null;            // Fullscreen backdrop with clip-path cutout
    this.multiPill = null;          // Floating UI panel for batch selection controls
    this.badge = null;              // Mouse-following logo badge element
    this.lastMouseX = 0;            // Last recorded viewport X coordinate
    this.lastMouseY = 0;            // Last recorded viewport Y coordinate
    this.isTickPending = false;     // Throttle flag for requestAnimationFrame loop
    this.lastRect = null;           // Cached DOMRect to prevent unnecessary layout writes
  }

  /**
   * Starts the content picker in either single or batch selection mode.
   * 
   * @param {'single' | 'multi'} [mode='single'] - Selection mode operation.
   */
  start(mode = 'single') {
    if (this.isActive) this.stop();
    this.isActive = true;
    this.selectionMode = mode;
    this.selectedBatch = [];
    this.currentTarget = null;
    this.lastRect = null;

    // Minimize extension sidebar to clear screen real estate
    if (typeof minimizeSidebar === 'function') minimizeSidebar();

    this.createShadowUI();
    this.attachEventListeners();
    document.body.style.cursor = 'crosshair';

    // Fade in dark overlay on next animation frame
    requestAnimationFrame(() => {
      if (this.overlay) this.overlay.classList.add('active');
    });
  }

  /**
   * Deactivates the picker, cleans up Shadow DOM nodes, restores event listeners, and brings back sidebar.
   */
  stop() {
    if (!this.isActive) return;
    this.isActive = false;
    this.detachEventListeners();
    document.body.style.cursor = '';

    // Remove host element and clear Shadow DOM references
    if (this.hostElement) {
      this.hostElement.remove();
      this.hostElement = null;
      this.shadowRoot = null;
      this.badge = null;
    }

    // Restore minimized extension sidebar
    if (typeof restoreSidebar === 'function') restoreSidebar();
  }

  /**
   * Creates isolated Shadow DOM container and populates styles, overlay, highlight box, and batch controls.
   */
  createShadowUI() {
    // Top-level host element covering full screen
    this.hostElement = document.createElement('div');
    this.hostElement.id = 'decidio-picker-host';
    Object.assign(this.hostElement.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '2147483647',
      pointerEvents: 'none'
    });

    // Create isolated Shadow DOM root to prevent host page CSS pollution
    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

    // Scoped CSS stylesheet for picker UI components
    const style = document.createElement('style');
    style.textContent = `
      .decidio-overlay {
        position: fixed;
        top: 0; 
        left: 0;
        width: 100vw; 
        height: 100vh;
        background: rgba(15, 23, 42, 0.4);
        z-index: 2147483645;
        cursor: crosshair;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
        clip-path: var(--decidio-cutout, polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%));
        will-change: clip-path;
      }
      .decidio-overlay.active {
        opacity: 1;
      }
      .decidio-highlight-box {
        position: fixed;
        z-index: 2147483646;
        outline: 3px solid #ffffff;
        box-shadow: 0 0 0 4px #3A6FAC, 0 20px 40px rgba(0, 0, 0, 0.4);
        pointer-events: none;
        display: none;
        border-radius: 4px;
        transition: outline-color 0.25s ease;
        will-change: top, left, width, height;
      }
      .decidio-highlight-box.show {
        display: block;
      }
      .decidio-hover-badge {
        position: fixed;
        top: 0;
        left: 0;
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
        opacity: 0;
        transition: opacity 0.15s ease;
        will-change: transform;
      }
      .decidio-hover-badge.show {
        opacity: 1;
      }
      .decidio-blue-dot { color: #3A6FAC; }
      .decidio-multi-pill {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(45, 46, 48, 0.95);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 30px;
        padding: 8px 18px;
        display: flex;
        align-items: center;
        gap: 12px;
        color: #ffffff;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        pointer-events: auto;
        z-index: 2147483647;
      }
      .decidio-finish-btn {
        background: #3b82f6;
        color: #ffffff;
        border: none;
        border-radius: 16px;
        padding: 6px 14px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.2s ease;
      }
      .decidio-finish-btn:hover { background: #2563eb; }
    `;

    this.shadowRoot.appendChild(style);

    // Overlay element using dynamic cutout polygon
    this.overlay = document.createElement('div');
    this.overlay.className = 'decidio-overlay';
    this.shadowRoot.appendChild(this.overlay);

    // Target highlight outline frame
    this.highlightBox = document.createElement('div');
    this.highlightBox.className = 'decidio-highlight-box';
    this.shadowRoot.appendChild(this.highlightBox);

    // Mouse-following badge indicator
    this.badge = document.createElement('div');
    this.badge.className = 'decidio-hover-badge';
    this.badge.innerHTML = 'decidio<span class="decidio-blue-dot">.</span>';
    this.shadowRoot.appendChild(this.badge);

    // Render multi-item selection counter and finish button if in multi mode
    if (this.selectionMode === 'multi') {
      this.multiPill = document.createElement('div');
      this.multiPill.className = 'decidio-multi-pill';
      this.multiPill.innerHTML = `
        <span>Items picked: <strong id="decidio-count">0</strong></span>
        <button class="decidio-finish-btn" id="decidio-finish">Finish</button>
      `;

      const finishBtn = this.multiPill.querySelector('#decidio-finish');
      finishBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.finishBatchSelection();
      });

      this.shadowRoot.appendChild(this.multiPill);
    }

    document.body.appendChild(this.hostElement);
  }

  /**
   * Binds capture-phase event listeners to intercept pointer/keyboard interactions.
   */
  attachEventListeners() {
    window.addEventListener('mousemove', this.handleMouseMove, { passive: true, capture: true });
    window.addEventListener('scroll', this.handleScroll, { passive: true, capture: true });
    window.addEventListener('click', this.handleClick, true);
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  /**
   * Unbinds global pointer/keyboard event listeners.
   */
  detachEventListeners() {
    window.removeEventListener('mousemove', this.handleMouseMove, true);
    window.removeEventListener('scroll', this.handleScroll, true);
    window.removeEventListener('click', this.handleClick, true);
    window.removeEventListener('keydown', this.handleKeyDown, true);
  }

  /**
   * Tracks mouse position and schedules requestAnimationFrame update.
   */
  handleMouseMove = (e) => {
    if (!this.isActive) return;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    if (!this.isTickPending) {
      window.requestAnimationFrame(this.processFrame);
      this.isTickPending = true;
    }
  };

  /**
   * Recalculates hover target position during scroll events.
   */
  handleScroll = () => {
    if (!this.isActive) return;
    if (!this.isTickPending) {
      window.requestAnimationFrame(this.processFrame);
      this.isTickPending = true;
    }
  };

  /**
   * Animation frame tick handler for positioning mouse badge and processing target detection.
   */
  processFrame = () => {
    this.isTickPending = false;
    if (!this.isActive) return;

    // Offset badge slightly from cursor
    if (this.badge) {
      this.badge.style.transform = `translate3d(${this.lastMouseX + 12}px, ${this.lastMouseY + 12}px, 0)`;
    }

    this.checkElementAtCursor(this.lastMouseX, this.lastMouseY);
  };

  /**
   * Performs hit-testing at target coordinates to identify valid product images under pointer.
   * 
   * @param {number} x - Viewport X coordinate.
   * @param {number} y - Viewport Y coordinate.
   */
  checkElementAtCursor(x, y) {
    // Ignore hovering over picker's own multi-selection UI pill
    const shadowTarget = this.shadowRoot ? this.shadowRoot.elementFromPoint(x, y) : null;
    if (shadowTarget && shadowTarget.closest('.decidio-multi-pill')) {
      this.currentTarget = null;
      this.updateHighlight(null);
      return;
    }

    // Ignore hovering over picker host container
    let elementUnderneath = document.elementFromPoint(x, y);
    if (elementUnderneath && (elementUnderneath === this.hostElement || elementUnderneath.id === 'decidio-picker-host')) {
      this.currentTarget = null;
      this.updateHighlight(null);
      return;
    }

    // Locate valid product image within hovered element context
    const targetImg = this.findTargetImage(elementUnderneath);

    if (targetImg) {
      this.currentTarget = targetImg;
      this.updateHighlight(this.currentTarget);
    } else if (this.currentTarget !== null) {
      this.currentTarget = null;
      this.updateHighlight(null);
    }
  }

  /**
   * Traverses up DOM tree from element to identify an enclosing product card/container.
   * Excludes global layout elements like navigation headers or site footers.
   * 
   * @param {Element} element - DOM element under pointer.
   * @returns {Element|null} Product container element or null if invalid context.
   */
  findValidProductContainer(element) {
    if (!element || element === document.body) return null;

    // Ignore header, navigation, and footer regions
    if (element.closest('nav, [role="navigation"], #site-header, .site-header, #main-header, .main-header, footer')) {
      return null;
    }

    // Query custom Driver configuration if present
    const driver = typeof getActiveDriver === 'function' ? getActiveDriver() : null;

    if (driver?.productItemSelector) {
      const cardContainer = element.closest(driver.productItemSelector);
      if (cardContainer) return cardContainer;
    }

    // Fallback to driver/helper utility function if defined
    if (typeof findProductContainer === 'function') {
      const card = findProductContainer(element);
      if (card) return card;
    }

    // Default container detection for standalone product pages or main content containers
    if (element.tagName === 'IMG') {
      return element.closest('main, #dp, #ppd, .product-detail, .product-single, article') || element.parentElement;
    }

    return element;
  }

  /**
   * Resolves target HTMLImageElement within identified product container.
   * 
   * @param {Element} element - Hovered target element.
   * @returns {HTMLImageElement|null} Identified product image node.
   */
  findTargetImage(element) {
    if (!element) return null;
    const container = this.findValidProductContainer(element);
    if (!container) return null;

    if (element.tagName === 'IMG') return element;
    return container.querySelector('img');
  }

  /**
   * Updates highlight box bounds and calculates overlay clip-path cutout polygon.
   * 
   * @param {Element|null} target - Selected target image element.
   */
  updateHighlight(target) {
    // Clear highlight UI if target is null
    if (!target || !this.highlightBox || !this.overlay) {
      if (this.highlightBox) this.highlightBox.classList.remove('show');
      if (this.badge) this.badge.classList.remove('show');
      if (this.overlay) this.overlay.style.removeProperty('--decidio-cutout');
      this.lastRect = null;
      return;
    }

    const rect = target.getBoundingClientRect();

    // Skip layout writes if target bounds haven't shifted
    if (
      this.lastRect &&
      this.lastRect.left === rect.left &&
      this.lastRect.top === rect.top &&
      this.lastRect.width === rect.width &&
      this.lastRect.height === rect.height
    ) {
      return;
    }

    this.lastRect = rect;

    // Position highlight boundary around element
    this.highlightBox.style.left = `${rect.left}px`;
    this.highlightBox.style.top = `${rect.top}px`;
    this.highlightBox.style.width = `${rect.width}px`;
    this.highlightBox.style.height = `${rect.height}px`;

    const x1 = rect.left;
    const y1 = rect.top;
    const x2 = rect.right;
    const y2 = rect.bottom;

    // Hole-punch cutout path using inverted CSS polygon
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

  /**
   * Intercepts document click events to extract product metadata and trigger extension messaging.
   */
  handleClick = (e) => {
    if (!this.isActive) return;

    // Check click target within Shadow DOM elements
    const path = e.composedPath ? e.composedPath() : [];
    const clickedInsidePill = path.some(el => 
      el.classList && el.classList.contains('decidio-multi-pill')
    );

    const shadowTarget = this.shadowRoot ? this.shadowRoot.elementFromPoint(e.clientX, e.clientY) : null;
    const clickedShadowUI = shadowTarget && shadowTarget.closest('.decidio-multi-pill');

    // Ignore click events originating on multi-selection UI controls
    if (clickedInsidePill || clickedShadowUI) return;

    e.preventDefault();
    e.stopPropagation();

    // Handle clicks outside valid image targets
    if (!this.currentTarget) {
      if (this.selectionMode === 'single') {
        chrome.runtime.sendMessage({ action: "DECIDIO_PICKER_CANCELLED" });
        this.stop();
      }
      return;
    }

    const targetImg = this.currentTarget;
    const container = this.findValidProductContainer(targetImg) || targetImg.parentElement;

    // Extract product metadata using page extractor helper
    const pickedItem = {
      imageUrl: ProductPageExtractor.extractImageUrl(targetImg),
      productUrl: ProductPageExtractor.extractProductUrl(targetImg, container),
      productTitle: ProductPageExtractor.extractTitle(targetImg, container)
    };

    if (this.selectionMode === 'single') {
      // Direct message payload emission for single pick mode
      chrome.runtime.sendMessage({
        action: "PRODUCT_IMAGE_PICKED",
        ...pickedItem
      });
      this.stop();
    } else {
      // Accumulate item payload for batch mode
      this.selectedBatch.push(pickedItem);
      this.updateMultiPillCount();
      
      // Brief success feedback animation (green outline flash)
      if (this.highlightBox) {
        this.highlightBox.style.outlineColor = '#10B981';
        setTimeout(() => {
          if (this.highlightBox) this.highlightBox.style.outlineColor = '#ffffff';
        }, 250);
      }
    }
  };

  /**
   * Keyboard shortcut handler (ESC key cancels selection mode).
   */
  handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      chrome.runtime.sendMessage({ action: "DECIDIO_PICKER_CANCELLED" });
      this.stop();
    }
  };

  /**
   * Updates item counter inside batch selection multi-pill UI element.
   */
  updateMultiPillCount() {
    if (!this.shadowRoot) return;
    const countEl = this.shadowRoot.querySelector('#decidio-count');
    if (countEl) {
      countEl.innerText = this.selectedBatch.length;
    }
  }

  /**
   * Emits collected batch selection payload to background runtime and closes picker.
   */
  finishBatchSelection() {
    chrome.runtime.sendMessage({
      action: "PRODUCT_IMAGES_BATCH_PICKED",
      items: this.selectedBatch
    });
    this.stop();
  }
}