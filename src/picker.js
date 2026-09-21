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
    this.currentTarget = null;      // Currently hovered target HTMLImageElement
    this.hostElement = null;        // Container injected into host document
    this.shadowRoot = null;         // Isolated Shadow DOM root
    this.highlightBox = null;       // Highlighting element surrounding hovered target
    this.overlay = null;            // Fullscreen backdrop with clip-path cutout
    this.footer = null;             // Bottom chrome: list carousel + plus, after ARFooter
    this.identifyPage = null;       // Results queue, after ARIdentifyPage
    this.hint = null;               // One-time vertical "Identify" signpost
    this.badge = null;              // Mouse-following logo badge element
    this.lastMouseX = 0;            // Last recorded viewport X coordinate
    this.lastMouseY = 0;            // Last recorded viewport Y coordinate
    this.isTickPending = false;     // Throttle flag for requestAnimationFrame loop
    this.lastRect = null;           // Cached DOMRect to prevent unnecessary layout writes

    // Frozen-selection state, mirroring ARScanView: a click freezes the frame
    // and drops a box, auto-detect snaps that box onto whatever was under the
    // pointer, and from then on the box is the user's to move and resize
    // freely. While frozen the hover hit-test is suspended, otherwise the box
    // would snap back to whatever the cursor drifted over.
    this.isFrozen = false;
    // Box in PAGE coordinates, not viewport — the page scrolls under it, and
    // a viewport-relative box would slide off the thing it was drawn around.
    this.box = null;                // {x, y, w, h}
    this.drag = null;               // active move/resize gesture
    this.lists = [];                // [{id, name}] shown in the footer carousel
    this.selectedListId = null;

    // Identify queue, after ARSessionStore. Collecting an item does not produce
    // a finished result — it enqueues one as `pending` and resolves it, so the
    // queue is the source of truth for what gets saved rather than a silent
    // array filled in behind the user.
    this.queue = [];                // [{id, thumb, title, brand, productUrl, state, error}]
    this.identifyOpen = false;
    this.nextQueueId = 1;
  }

  /** Minimum box edge, px. ARSelectionBox uses 0.08 of the frame; a page is
   *  far larger than a phone viewfinder, so this is a flat floor instead. */
  static get MIN_BOX() { return 40; }

  /**
   * Starts the content picker in either single or batch selection mode.
   * 
   * @param {'single' | 'multi'} [mode='single'] - Selection mode operation.
   */
  start(mode = 'single', lists = [], selectedListId = null) {
    if (this.isActive) this.stop();
    this.isActive = true;
    this.selectionMode = mode;
    this.currentTarget = null;
    this.lastRect = null;
    this.isFrozen = false;
    this.box = null;
    this.drag = null;
    this.lists = Array.isArray(lists) ? lists : [];
    this.selectedListId = selectedListId;
    this.queue = [];
    this.identifyOpen = false;

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

    clearTimeout(this.hintTimer);

    // Remove host element and clear Shadow DOM references
    if (this.hostElement) {
      this.hostElement.remove();
      this.hostElement = null;
      this.shadowRoot = null;
      this.badge = null;
      this.footer = null;
      this.identifyPage = null;
      this.hint = null;
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
    // Faces must be registered on the document, not in here — see
    // ensureDecidioFonts() in ui.js for why a shadow-root @font-face is inert.
    if (typeof ensureDecidioFonts === 'function') ensureDecidioFonts();

    const style = document.createElement('style');
    style.textContent = `
      .decidio-overlay {
        position: fixed;
        top: 0; 
        left: 0;
        width: 100vw; 
        height: 100vh;
        /* black @50%, as ARSelectionBox uses — not the slate-blue tint that
           was here. The cutout below is the same reverseMask idea. */
        background: rgba(0, 0, 0, 0.5);
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
      /* Mirrors ARSelectionBox: a plain white 2pt stroke on a 12pt rounded
         rect, with the emphasis carried by purple corner brackets rather than
         a coloured glow. The old 3px outline + 4px blue ring read as a
         different product. */
      .decidio-highlight-box {
        position: fixed;
        z-index: 2147483646;
        outline: 2px solid #ffffff;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        pointer-events: none;
        display: none;
        border-radius: 12px;
        transition: outline-color 0.25s ease;
        will-change: top, left, width, height;
      }
      .decidio-highlight-box.show {
        display: block;
      }
      /* Inert while hovering so the hit-test underneath still sees the page;
         grabbable once frozen, when the box becomes the thing being handled. */
      .decidio-highlight-box.is-frozen {
        pointer-events: auto;
        cursor: move;
        transition: none;
      }

      /* Corner brackets — the AR view's CornerBracket, redrawn in CSS: 26x26,
         4px stroke, rounded caps, Decidio Purple (#803065). Each is an L made
         from two borders of a corner-anchored box, so it scales with nothing
         and never distorts. Offset by -2px so the bracket sits over the white
         stroke rather than inside it. */
      .decidio-corner {
        position: absolute;
        width: 26px;
        height: 26px;
        border: 4px solid #803065;
        border-radius: 3px;
        pointer-events: none;
      }
      /* ARSelectionBox pads each 26pt bracket out to a 44pt touch target; the
         same padding here via a transparent box drawn around the bracket. */
      .decidio-highlight-box.is-frozen .decidio-corner {
        pointer-events: auto;
        box-sizing: content-box;
        padding: 9px;
        margin: -9px;
      }
      .decidio-highlight-box.is-frozen .decidio-corner.tl { cursor: nwse-resize; }
      .decidio-highlight-box.is-frozen .decidio-corner.br { cursor: nwse-resize; }
      .decidio-highlight-box.is-frozen .decidio-corner.tr { cursor: nesw-resize; }
      .decidio-highlight-box.is-frozen .decidio-corner.bl { cursor: nesw-resize; }
      .decidio-corner.tl { top: -2px; left: -2px;  border-right: none; border-bottom: none;
                           border-top-left-radius: 12px; }
      .decidio-corner.tr { top: -2px; right: -2px; border-left: none;  border-bottom: none;
                           border-top-right-radius: 12px; }
      .decidio-corner.bl { bottom: -2px; left: -2px;  border-right: none; border-top: none;
                           border-bottom-left-radius: 12px; }
      .decidio-corner.br { bottom: -2px; right: -2px; border-left: none;  border-top: none;
                           border-bottom-right-radius: 12px; }
      .decidio-hover-badge {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483648;
        display: flex;
        align-items: center;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #ffffff;
        font-family: "SFProDisplay", -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
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
      /* The wordmark period, in the app's own Decidio Blue (#476DA7). */
      .decidio-blue-dot { color: #476DA7; }
      /* Squared and branded, rather than a rounded grey capsule: nothing in
         the app is pill-shaped, and the count is the thing worth reading here,
         so it leads at display size instead of being buried in a sentence. */
      /* ---------- Bottom chrome, after ARFooter -------------------------
         A rule, the list carousel, a rule, then a bare plus.circle. Pinned to
         the bottom of the viewport the way ARFooter pins to the screen, so it
         never moves with page content.
         ------------------------------------------------------------------ */
      .decidio-ar-footer {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483647;
        pointer-events: auto;
        font-family: "SFProDisplay", -apple-system, BlinkMacSystemFont, sans-serif;
        padding-bottom: 24px;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
      }
      .decidio-ar-rule {
        height: 3px;
        background: #ffffff;
      }
      /* The list carousel is page-0 chrome — ARFooter fades it out as you page
         away from the camera, leaving just the plus. The rules go with it;
         they frame the carousel, not the footer. */
      .decidio-ar-strip, .decidio-ar-rule {
        transition: opacity 0.3s ease;
      }
      .decidio-ar-footer.is-identifying .decidio-ar-strip,
      .decidio-ar-footer.is-identifying .decidio-ar-rule {
        opacity: 0;
        pointer-events: none;
      }

      /* The carousel. ARListCarousel loops an infinite strip under a fixed
         centre; a page can scroll natively, so this is a scroller with the
         same 160px slots and the same edge fade, letting names slide under
         the edges rather than dimming individually. */
      .decidio-ar-strip {
        display: flex;
        overflow-x: auto;
        scrollbar-width: none;
        height: 36px;
        margin: 4px 0;
        /* Half a viewport of padding either side, less half a slot, so ANY
           name can sit dead centre — including the first and last. Without it
           the strip bottoms out against its left edge and the selected name
           stays pinned there instead of centring, which is what ARListCarousel
           gets for free from its infinite triple-copy strip. */
        padding-left: calc(50% - 80px);
        padding-right: calc(50% - 80px);
        -webkit-mask-image: linear-gradient(to right,
          transparent 0%, #000 10%, #000 90%, transparent 100%);
        mask-image: linear-gradient(to right,
          transparent 0%, #000 10%, #000 90%, transparent 100%);
      }
      .decidio-ar-strip::-webkit-scrollbar { display: none; }
      .decidio-ar-name {
        flex: 0 0 160px;
        width: 160px;
        height: 36px;
        background: none;
        border: none;
        cursor: pointer;
        font-family: "NHaasGroteskDSStd", "SFProDisplay", sans-serif;
        font-weight: 700;
        font-size: 20px;
        line-height: 36px;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 0 8px;
      }
      /* Selected name in Decidio Purple — lifted from the app's #803065, which
         sits on a bright camera feed there and goes nearly black against this
         footer's dark plate. Same treatment the panel's blue accent already
         gets for the same reason. */
      .decidio-ar-name.is-selected { color: #C77FAE; }
      .decidio-ar-name:not(.is-selected) { color: rgba(255, 255, 255, 0.55); }
      .decidio-ar-empty {
        flex: 1;
        height: 36px;
        line-height: 36px;
        text-align: center;
        color: rgba(255, 255, 255, 0.6);
        font-size: 15px;
      }

      .decidio-ar-actions {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        padding-top: 20px;
      }
      /* camera.aperture, 40pt white — matching the panel's own Collect
         control. The app's AR footer uses plus.circle here; the aperture is
         carried across from the panel so one symbol means "collect" on both
         surfaces. */
      .decidio-ar-plus {
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        opacity: 0.4;
        transition: opacity 0.2s ease;
      }
      .decidio-ar-plus svg {
        width: 40px;
        height: 40px;
        stroke: #ffffff;
        stroke-width: 1.8;
        stroke-linecap: round;
        fill: none;
      }
      /* The blades step down from the ring, or they close the hexagon in the
         middle at the ring's own weight. */
      .decidio-ar-plus svg line { stroke-width: 1.3; }
      /* Only live once a box is frozen — there is nothing to add before that. */
      .decidio-ar-footer.is-frozen .decidio-ar-plus { opacity: 1; }

      .decidio-ar-done {
        position: absolute;
        right: 20px;
        background: #ffffff;
        color: #000000;
        border: none;
        border-radius: 0;
        padding: 8px 16px;
        font-family: "SFProDisplay", -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .decidio-ar-done:hover { background: #f0f0f0; }

      /* ---------- Vertical "Collect" hint --------------------------------
         ARCameraPage draws a 168pt NHaas Bold "Identify" rotated -90 down the
         left edge, holds it 2s, then fades it over 0.8s — a one-time signpost
         that the next page is off to the side. Same treatment and timing here,
         since the browser has no swipe affordance of its own to make that
         obvious. The word differs deliberately: this reads "Collect", and the
         page it points at is "Collected", matching the extension's own
         vocabulary rather than the app's "Identify".

         Set with vertical writing rather than rotate(-90deg): a rotation about
         the bottom-left corner sweeps the glyph body to the LEFT of the origin
         and straight off the viewport. vertical-rl gives a box that is already
         tall and narrow, so it can be positioned like any other element, and
         the 180deg flip makes it read bottom-to-top as the app's does.

         The size is clamped so the word still fits a short browser window;
         168px would run off the top of anything under ~820px tall.
         ------------------------------------------------------------------ */
      .decidio-ar-hint {
        position: fixed;
        /* Right edge, not the app's left: here the Collected page slides in
           from the right, so the signpost sits on the side it points to. */
        right: 24px;
        /* Sits clear of the footer's top rule. The offset is measured from the
           footer itself rather than hard-coded, because its height moves with
           the carousel and the safe-area padding. */
        bottom: var(--decidio-hint-bottom, 150px);
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        white-space: nowrap;
        font-family: "NHaasGroteskDSStd", "SFProDisplay", sans-serif;
        font-weight: 700;
        font-size: min(168px, calc((100vh - var(--decidio-hint-bottom, 150px) - 56px) / 4.3));
        line-height: 1;
        letter-spacing: -0.02em;
        color: #ffffff;
        pointer-events: none;
        z-index: 2147483646;
        /* Present from the first frame, as ARCameraPage's identifyOpacity
           starts at 1.0. Nothing gates it on a rAF callback: those do not fire
           while the tab is not painting, which left the hint invisible until
           the fade timer removed it entirely. The overlay's own 0.2s fade-in
           carries the entrance. */
        opacity: 1;
      }
      .decidio-ar-hint.is-faded {
        opacity: 0;
        transition: opacity 0.8s ease-out;
      }
      @media (prefers-reduced-motion: reduce) {
        .decidio-ar-hint.is-faded { transition: opacity 0.01s; }
      }

      /* ---------- Collected (page 2 of the app's AR flow) ----------------
         ARIdentifyPage, titled "Collected" here: a 72pt NHaas Bold title over a queue of rows, each a
         70x50 still beside either a spinner, the identified name, or a plain
         failure line. Rows are divided by the same 0.75px white hairline the
         rest of the AR chrome uses.
         ------------------------------------------------------------------ */
      .decidio-ar-identify {
        position: absolute;
        left: 20px;
        display: inline-flex;
        align-items: baseline;
        gap: 7px;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        font-family: "NHaasGroteskDSStd", "SFProDisplay", sans-serif;
        font-weight: 700;
        font-size: 17px;
        color: rgba(255, 255, 255, 0.55);
        transition: color 0.2s ease;
      }
      .decidio-ar-identify:hover,
      .decidio-ar-footer.is-identifying .decidio-ar-identify { color: #ffffff; }
      .decidio-ar-count {
        font-family: "SFProDisplay", -apple-system, sans-serif;
        font-weight: 500;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.55);
      }

      .decidio-id-page {
        position: fixed;
        left: 0;
        right: 0;
        top: 0;
        bottom: 0;
        z-index: 2147483646;
        background: rgba(0, 0, 0, 0.88);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        font-family: "SFProDisplay", -apple-system, BlinkMacSystemFont, sans-serif;
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        /* Sits to the RIGHT of the picker and pages in sideways, because that
           is where it lives in the app: ARScanView is a horizontal paging
           ScrollView of [camera | identify | detail], not a stack of sheets.
           Swiping left from the picker is the same move as swiping left from
           the camera. */
        transform: translateX(100%);
        visibility: hidden;
        transition: transform 0.36s cubic-bezier(0.32, 0.72, 0, 1),
                    visibility 0s linear 0.36s;
      }
      .decidio-id-page.is-open {
        transform: translateX(0);
        visibility: visible;
        transition: transform 0.36s cubic-bezier(0.32, 0.72, 0, 1),
                    visibility 0s;
      }
      /* Follows the pointer 1:1 mid-swipe; the eased transition above only
         takes over once the gesture is released. */
      .decidio-id-page.is-dragging { transition: none; }

      .decidio-id-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 40px 20px 16px;
        flex: 0 0 auto;
      }
      /* 56px against the app's 72 — scaled to a browser overlay rather than a
         phone screen, but the same face and weight carrying the page. */
      .decidio-id-title {
        font-family: "NHaasGroteskDSStd", "SFProDisplay", sans-serif;
        font-weight: 700;
        font-size: 56px;
        line-height: 1;
        letter-spacing: -0.02em;
        color: #ffffff;
      }
      .decidio-id-close {
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        margin-top: 8px;
      }
      .decidio-id-close svg {
        width: 28px; height: 28px;
        stroke: #ffffff; stroke-width: 3;
        stroke-linecap: round; fill: none;
      }

      .decidio-id-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding-bottom: 180px;   /* clears the footer */
      }
      .decidio-id-empty {
        padding: 56px 20px;
        text-align: center;
        font-weight: 700;
        font-size: 18px;
        color: rgba(255, 255, 255, 0.75);
      }
      .decidio-id-rule {
        height: 0.75px;
        background: #ffffff;
        margin: 0 16px;
      }

      .decidio-id-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
      }
      .decidio-id-thumb {
        flex: 0 0 70px;
        width: 70px;
        height: 50px;
        object-fit: cover;
        display: block;
        background: rgba(255, 255, 255, 0.12);
      }
      .decidio-id-thumb.is-blank { display: block; }

      .decidio-id-text { display: flex; flex-direction: column; min-width: 0; }
      /* First word above, full name below — the split ARIdentifyPage uses. */
      .decidio-id-brand {
        font-family: "NHaasGroteskDSStd", "SFProDisplay", sans-serif;
        font-weight: 700;
        font-size: 18px;
        color: #ffffff;
        line-height: 1.15;
      }
      .decidio-id-name {
        font-family: "NHaasGroteskDSStd", "SFProDisplay", sans-serif;
        font-weight: 500;
        font-size: 18px;
        color: #ffffff;
        line-height: 1.15;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .decidio-id-failed {
        font-weight: 700;
        font-size: 18px;
        color: rgba(255, 255, 255, 0.75);
      }

      .decidio-id-spinner {
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: decidio-spin 0.7s linear infinite;
      }
      @keyframes decidio-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .decidio-id-spinner { animation-duration: 2.4s; }
        .decidio-id-page { transition: opacity 0.01s, visibility 0s; }
      }
    `;

    this.shadowRoot.appendChild(style);

    // Overlay element using dynamic cutout polygon
    this.overlay = document.createElement('div');
    this.overlay.className = 'decidio-overlay';
    this.shadowRoot.appendChild(this.overlay);

    // Target highlight outline frame
    this.highlightBox = document.createElement('div');
    this.highlightBox.className = 'decidio-highlight-box';
    // Four corner brackets, as ARSelectionBox draws. Children of the box so
    // they follow it for free when updateHighlight moves/resizes it — no extra
    // positioning work on the hot path.
    ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
      const bracket = document.createElement('div');
      bracket.className = `decidio-corner ${corner}`;
      bracket.addEventListener('mousedown', (e) => this.beginDrag(e, corner));
      this.highlightBox.appendChild(bracket);
    });
    // Anywhere else on the box moves it whole, as ARSelectionBox's moveGesture
    // does on its stroked rectangle.
    this.highlightBox.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('decidio-corner')) return;
      this.beginDrag(e, 'move');
    });
    this.shadowRoot.appendChild(this.highlightBox);

    // Mouse-following badge indicator
    // Cursor-following "decidio." badge — intentionally NOT created. It rode
    // alongside the pointer during picking, competing with the selection box
    // for attention and covering whatever sat just under the cursor, which is
    // exactly the thing being aimed at. The AR view carries no such marker:
    // the reticle alone communicates the mode. Left as null rather than
    // deleted so the guarded `if (this.badge)` call sites keep working and
    // restoring it is a one-block change.
    this.badge = null;

    // Bottom chrome, mirroring ARFooter: a rule, the list carousel, a rule,
    // then the plus. The pill that used to float here had no counterpart in
    // the app — the AR view puts the lists themselves at the bottom of the
    // screen and adds to whichever is centred.
    if (this.selectionMode === 'multi') {
      this.footer = document.createElement('div');
      this.footer.className = 'decidio-ar-footer';

      const names = this.lists.length
        ? this.lists.map((l) => `
            <button class="decidio-ar-name" data-list-id="${l.id}">${
              String(l.name || 'Untitled list').replace(/[<>&]/g, '')
            }</button>`).join('')
        : '<span class="decidio-ar-empty">No lists yet</span>';

      this.footer.innerHTML = `
        <div class="decidio-ar-rule"></div>
        <div class="decidio-ar-strip">${names}</div>
        <div class="decidio-ar-rule"></div>
        <div class="decidio-ar-actions">
          <button class="decidio-ar-identify" id="decidio-identify">
            Collected<span class="decidio-ar-count" id="decidio-count"></span>
          </button>
          <button class="decidio-ar-plus" id="decidio-plus" aria-label="Add to list">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9.25"/>
              <line x1="12.00" y1="7.10"  x2="21.24" y2="12.43"/>
              <line x1="16.24" y1="9.55"  x2="16.24" y2="20.22"/>
              <line x1="16.24" y1="14.45" x2="7.00"  y2="19.78"/>
              <line x1="12.00" y1="16.90" x2="2.76"  y2="11.57"/>
              <line x1="7.76"  y1="14.45" x2="7.76"  y2="3.78"/>
              <line x1="7.76"  y1="9.55"  x2="17.00" y2="4.22"/>
            </svg>
          </button>
          <button class="decidio-ar-done" id="decidio-done">Done</button>
        </div>
      `;

      // stopPropagation throughout: the window-level capture click handler
      // would otherwise read a press on the footer as a click on the page.
      this.footer.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const name = e.target.closest('.decidio-ar-name');
        if (name) {
          this.selectedListId = name.dataset.listId;
          this.updateCarouselSelection();
          chrome.runtime.sendMessage({
            action: 'DECIDIO_PICKER_LIST_CHANGED',
            listId: this.selectedListId
          });
          return;
        }

        if (e.target.closest('#decidio-plus')) this.commitBoxSelection();
        if (e.target.closest('#decidio-done')) this.finishBatchSelection();
        if (e.target.closest('#decidio-identify')) this.toggleIdentify();
      }, true);

      this.shadowRoot.appendChild(this.footer);

      // Page 2 of the app's AR flow, as a panel that slides up over the picker
      // rather than a page you scroll sideways to — a browser overlay has no
      // horizontal pager to live in.
      this.identifyPage = document.createElement('div');
      this.identifyPage.className = 'decidio-id-page';
      this.identifyPage.innerHTML = `
        <div class="decidio-id-head">
          <span class="decidio-id-title">Collected</span>
          <button class="decidio-id-close" id="decidio-id-close" aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18"/>
              <line x1="18" y1="6" x2="6" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="decidio-id-body"></div>
      `;
      this.identifyPage.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('#decidio-id-close')) {
          e.preventDefault();
          this.toggleIdentify(false);
        }
      }, true);

      this.shadowRoot.appendChild(this.identifyPage);

      // One-time signpost, matching ARCameraPage's own onAppear timing:
      // present on open, held 2s, then faded over 0.8s and left alone.
      this.hint = document.createElement('div');
      this.hint.className = 'decidio-ar-hint';
      this.hint.textContent = 'Collect';
      this.shadowRoot.appendChild(this.hint);

      // getBoundingClientRect forces layout, so the footer measures correctly
      // here without waiting a frame — which matters, since a rAF callback
      // would not run at all while the tab is not painting.
      const footerH = this.footer.getBoundingClientRect().height;
      if (footerH) {
        this.hint.style.setProperty('--decidio-hint-bottom', `${Math.round(footerH + 20)}px`);
      }

      this.hintTimer = setTimeout(() => {
        if (this.hint) this.hint.classList.add('is-faded');
      }, 2000);

      this.renderIdentify();
      this.updateCarouselSelection(true);
      this.updateFooterState();
    }

    document.body.appendChild(this.hostElement);
  }

  /**
   * Binds capture-phase event listeners to intercept pointer/keyboard interactions.
   */
  attachEventListeners() {
    window.addEventListener('mousemove', this.handleMouseMove, { passive: true, capture: true });
    window.addEventListener('mousemove', this.handleDragMove, true);
    window.addEventListener('mouseup', this.handleDragEnd, true);
    window.addEventListener('scroll', this.handleScroll, { passive: true, capture: true });
    window.addEventListener('wheel', this.handleWheel, { passive: false, capture: true });
    window.addEventListener('click', this.handleClick, true);
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  /**
   * Unbinds global pointer/keyboard event listeners.
   */
  detachEventListeners() {
    window.removeEventListener('mousemove', this.handleMouseMove, true);
    window.removeEventListener('mousemove', this.handleDragMove, true);
    window.removeEventListener('mouseup', this.handleDragEnd, true);
    window.removeEventListener('wheel', this.handleWheel, true);
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

    // The frozen box is stored in page coordinates, so scrolling changes where
    // it lands on screen even though the box itself has not moved.
    if (this.isFrozen) {
      this.renderBox();
      return;
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
    // A locked selection owns the box until it is collected or dismissed —
    // tracking the cursor here would drag the highlight off the thing the user
    // is in the middle of adjusting.
    if (this.isFrozen) return;

    // Ignore hovering over picker's own multi-selection UI pill
    const shadowTarget = this.shadowRoot ? this.shadowRoot.elementFromPoint(x, y) : null;
    if (shadowTarget && shadowTarget.closest('.decidio-ar-footer')) {
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

    // Locate the product image, or failing that whatever the pointer was most
    // plausibly aimed at (see resolveIntendedTarget).
    const targetImg = this.resolveIntendedTarget(elementUnderneath);

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
   * Resolves what the user was most likely aiming at.
   *
   * findTargetImage only succeeds where a real <img> exists, so anything drawn
   * as a CSS background, an <svg>, a <canvas>, or a card whose picture sits in
   * a sibling subtree used to highlight nothing at all. This falls back to
   * scoring the clicked node's ancestors and taking the best-looking discrete
   * item, so arbitrary objects still resolve to something sensible.
   *
   * @param {Element|null} element - Raw element under the pointer.
   * @returns {Element|null} Best-guess target, or null if nothing qualifies.
   */
  resolveIntendedTarget(element) {
    if (!element || element === document.body || element === document.documentElement) return null;

    const img = this.findTargetImage(element);
    if (img) return img;

    // Same exclusions the container search applies — chrome is never the thing
    // being collected, however well it scores.
    if (element.closest('nav, [role="navigation"], #site-header, .site-header, #main-header, .main-header, footer')) {
      return null;
    }

    let best = null;
    let bestScore = 0;
    let node = element;

    // Six levels is enough to climb out of a text node's wrappers and into the
    // enclosing card without reaching page-level containers.
    for (let depth = 0; node && depth < 6 && node !== document.body; depth++) {
      const score = this.scoreAsItem(node);
      // Strictly-greater keeps the TIGHTEST candidate on ties, since the walk
      // runs innermost first — a card and its padding wrapper score alike, and
      // the inner one is the better selection.
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
      node = node.parentElement;
    }

    return bestScore >= 3 ? best : null;
  }

  /**
   * Rates how much an element looks like one self-contained item rather than a
   * fragment of one or a chunk of page scaffolding.
   *
   * @param {Element} el
   * @returns {number} Higher is a better selection; below 3 is not worth offering.
   */
  scoreAsItem(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 32 || rect.height < 32) return 0;

    const viewportArea = window.innerWidth * window.innerHeight;
    const area = rect.width * rect.height;

    // Page wrappers span most of both axes. They technically contain the item,
    // but selecting one collects the whole page section.
    if (rect.width > window.innerWidth * 0.9 && rect.height > window.innerHeight * 0.9) return 0;

    let score = 0;

    // Something picture-shaped, however it is drawn.
    if (/^(IMG|PICTURE|SVG|CANVAS|VIDEO)$/.test(el.tagName)) {
      score += 4;
    } else if (el.querySelector('img, picture, svg, canvas, video')) {
      score += 3;
    } else {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.includes('url(')) score += 3;
    }

    // Items are captioned; raw media wells are not.
    const text = (el.innerText || '').trim();
    if (text.length >= 3 && text.length <= 300) score += 2;

    // A card that links somewhere is almost always a product.
    if (el.tagName === 'A' || el.querySelector('a[href]') || el.closest('a[href]')) score += 2;

    // Card-sized, not banner-sized and not a thumbnail chip.
    if (area > viewportArea * 0.004 && area < viewportArea * 0.6) score += 1;

    return score;
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
      el.classList && el.classList.contains('decidio-ar-footer')
    );

    const shadowTarget = this.shadowRoot ? this.shadowRoot.elementFromPoint(e.clientX, e.clientY) : null;
    const clickedShadowUI = shadowTarget && shadowTarget.closest('.decidio-ar-footer');

    // Ignore click events originating on multi-selection UI controls
    if (clickedInsidePill || clickedShadowUI) return;

    e.preventDefault();
    e.stopPropagation();

    // With a selection already frozen, a click on empty space discards it and
    // goes back to hovering. Clicking within the box is a no-op, so aiming at
    // the thing you already chose cannot lose it.
    // A drag that ended on this click already did its work — swallow it so a
    // resize does not also read as a click on the page behind the box.
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }

    if (this.isFrozen) {
      const x = e.clientX + window.scrollX;
      const y = e.clientY + window.scrollY;
      const inside = x >= this.box.x && x <= this.box.x + this.box.w &&
                     y >= this.box.y && y <= this.box.y + this.box.h;
      if (!inside) this.releaseSelection();
      return;
    }

    // Handle clicks outside valid image targets
    if (!this.currentTarget) {
      if (this.selectionMode === 'single') {
        chrome.runtime.sendMessage({ action: "DECIDIO_PICKER_CANCELLED" });
        this.stop();
      }
      return;
    }

    // Single mode has no pill, so it has nowhere to host the adjust controls —
    // it keeps the original pick-and-send behaviour.
    if (this.selectionMode === 'single') {
      chrome.runtime.sendMessage({
        action: "PRODUCT_IMAGE_PICKED",
        ...this.extractFromTarget(this.currentTarget)
      });
      this.stop();
      return;
    }

    this.freezeSelection(this.currentTarget, e.clientX, e.clientY);
  };

  /**
   * Keyboard shortcuts: Escape backs out one level (frozen selection first,
   * then the picker itself), and the arrow keys widen/narrow a frozen
   * selection so it can be adjusted without reaching for the pill.
   */
  handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (this.isFrozen) {
        e.preventDefault();
        this.releaseSelection();
        return;
      }
      this.finishBatchSelection();
      return;
    }

    if (this.isFrozen && e.key === 'Enter') {
      e.preventDefault();
      this.commitBoxSelection();
    }
  };

  /**
   * Freezes the current hover target so it can be widened or narrowed before
   * being committed.
   *
   * @param {Element} el - Element the user clicked.
   */
  subjectRect(el) {
    const { node } = this.resolveImageFor(el);
    const host = el.getBoundingClientRect();

    if (!node) return host.width && host.height ? host : null;

    const r = this.imageContentRect(node);
    if (!r || !r.width || !r.height) return host.width && host.height ? host : null;
    return r;
  }

  /**
   * Where an image's pixels are actually painted, in viewport coordinates.
   *
   * An <img> box is not necessarily the picture: object-fit letterboxes the
   * drawn pixels inside it, so a contained portrait in a square slot leaves
   * bars that are part of the element but not part of the image.
   *
   * @param {Element} node
   * @returns {DOMRect|null}
   */
  imageContentRect(node) {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    if (node.tagName !== 'IMG' || !node.naturalWidth || !node.naturalHeight) return r;

    const fit = getComputedStyle(node).objectFit;

    let scale = null;
    if (fit === 'contain') scale = Math.min(r.width / node.naturalWidth, r.height / node.naturalHeight);
    if (fit === 'none') scale = 1;
    if (fit === 'scale-down') scale = Math.min(1, Math.min(r.width / node.naturalWidth, r.height / node.naturalHeight));

    // 'cover' and 'fill' paint the whole box, so the box IS the picture.
    if (scale === null) return r;

    // Clipped to the element for 'none'/'scale-down', which can overflow it.
    const w = Math.min(node.naturalWidth * scale, r.width);
    const h = Math.min(node.naturalHeight * scale, r.height);
    return new DOMRect(r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h);
  }

  /**
   * Renders the part of a picture the box is framing, as a data URL.
   *
   * The app's plus does `frozen.cropped(toNormalized: box)` — the box is a
   * crop, not just an aiming aid — so resizing it has to change the pixels
   * that get collected, not merely which image is chosen.
   *
   * Returns null when the crop cannot be taken: a cross-origin image without
   * CORS headers taints the canvas and toDataURL throws. Callers keep the
   * original URL in that case rather than losing the image altogether.
   *
   * @param {Element} node - img, canvas or video.
   * @param {HTMLImageElement} [source] - CORS-loaded stand-in for `node`.
   * @returns {string|null}
   */
  cropGeometry(node, box) {
    if (!box) return null;
    if (!/^(IMG|CANVAS|VIDEO)$/.test(node.tagName)) return null;

    const content = this.imageContentRect(node);
    if (!content || !content.width || !content.height) return null;

    const natW = node.naturalWidth || node.videoWidth || node.width;
    const natH = node.naturalHeight || node.videoHeight || node.height;
    if (!natW || !natH) return null;

    // Box and picture in the same (viewport) frame, then clipped to the part
    // of the picture the box actually covers.
    const vx = box.x - window.scrollX;
    const vy = box.y - window.scrollY;
    const left = Math.max(vx, content.left);
    const top = Math.max(vy, content.top);
    const right = Math.min(vx + box.w, content.right);
    const bottom = Math.min(vy + box.h, content.bottom);
    if (right - left < 2 || bottom - top < 2) return null;

    // Displayed pixels -> source pixels.
    const kx = natW / content.width;
    const ky = natH / content.height;
    return {
      sx: (left - content.left) * kx,
      sy: (top - content.top) * ky,
      sw: (right - left) * kx,
      sh: (bottom - top) * ky
    };
  }

  /**
   * Draws a previously-measured crop to a canvas.
   *
   * @param {CanvasImageSource} source - The node itself, or a CORS-loaded stand-in.
   * @param {{sx:number, sy:number, sw:number, sh:number}} g
   * @returns {string|null} data URL, or null if the canvas was tainted.
   */
  drawCrop(source, g) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(g.sw));
      canvas.height = Math.max(1, Math.round(g.sh));
      canvas.getContext('2d').drawImage(source, g.sx, g.sy, g.sw, g.sh, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;   // tainted canvas, or a video with no frame yet
    }
  }

  /**
   * Second attempt at a crop for an image that tainted the canvas, by
   * re-requesting it with CORS. Patches the already-collected item in place,
   * so a slow or failed request never holds up the picker — and takes the
   * geometry by argument, since the box itself is released the moment the
   * item is collected.
   *
   * @param {Element} node
   * @param {{sx:number, sy:number, sw:number, sh:number}} geom
   * @param {{imageUrl: string|null}} item
   */
  recropWithCors(node, geom, item) {
    const src = node.currentSrc || node.src;
    if (!src || src.startsWith('data:')) return;

    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      const cropped = this.drawCrop(probe, geom);
      if (cropped) item.imageUrl = cropped;
    };
    probe.onerror = () => { /* no CORS headers — the full image stands */ };
    probe.src = src;
  }

  beginDrag(e, mode) {
    if (!this.isFrozen || !this.box) return;
    e.preventDefault();
    e.stopPropagation();
    this.drag = { mode, startX: e.clientX, startY: e.clientY, startBox: { ...this.box }, moved: false };
  };

  /**
   * Tracks an in-flight move/resize. Bound at the window so the gesture
   * survives the pointer leaving the box, which it does constantly while
   * shrinking one.
   */
  handleDragMove = (e) => {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.startX;
    const dy = e.clientY - this.drag.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.drag.moved = true;
    this.applyDrag(dx, dy);
  };

  handleDragEnd = () => {
    if (!this.drag) return;
    // Only swallow the click that closes a real drag; a plain press on the box
    // should still fall through to handleClick.
    this.justDragged = this.drag.moved;
    this.drag = null;
  };

  freezeSelection(el, clientX, clientY) {
    // Sized to the picture itself wherever there is one, so the box arrives
    // with the subject's own proportions rather than a generic square — a wide
    // banner shot and a tall product shot should not open the same box.
    const r = el ? this.subjectRect(el) : null;
    let box;

    if (r) {
      // Padded per-axis, not by one shared value: a flat pad on a 3:1 banner
      // pulls it toward square, losing exactly the proportions this is meant
      // to preserve. ARScanView pads in normalized space where 3% is already
      // per-axis; this is the same thing in pixels.
      const padX = r.width * 0.03;
      const padY = r.height * 0.03;
      box = {
        x: r.left + window.scrollX - padX,
        y: r.top + window.scrollY - padY,
        w: r.width + padX * 2,
        h: r.height + padY * 2
      };
    } else {
      // Nothing identifiable under the pointer — the provisional square
      // handleFreeze drops before its detector answers.
      const half = 90;
      box = {
        x: clientX + window.scrollX - half,
        y: clientY + window.scrollY - half,
        w: half * 2,
        h: half * 2
      };
    }

    this.isFrozen = true;
    this.box = box;
    this.currentTarget = null;
    if (this.highlightBox) this.highlightBox.classList.add('is-frozen');
    this.renderBox();
    this.updateFooterState();
  }

  /**
   * Drops the frozen box and returns to cursor tracking.
   */
  releaseSelection() {
    this.isFrozen = false;
    this.box = null;
    this.drag = null;
    this.currentTarget = null;
    this.lastRect = null;
    if (this.highlightBox) this.highlightBox.classList.remove('is-frozen');
    this.updateHighlight(null);
    this.updateFooterState();
  }

  /**
   * Paints the frozen box and its scrim cutout.
   *
   * Bypasses updateHighlight because that derives its rect from an element;
   * once the box is the user's to drag there is no element to derive from.
   */
  renderBox() {
    if (!this.box || !this.highlightBox || !this.overlay) return;

    const x1 = this.box.x - window.scrollX;
    const y1 = this.box.y - window.scrollY;
    const x2 = x1 + this.box.w;
    const y2 = y1 + this.box.h;

    this.highlightBox.style.left = `${x1}px`;
    this.highlightBox.style.top = `${y1}px`;
    this.highlightBox.style.width = `${this.box.w}px`;
    this.highlightBox.style.height = `${this.box.h}px`;

    this.overlay.style.setProperty('--decidio-cutout', `polygon(
      0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
      ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px
    )`);

    this.highlightBox.classList.add('show');
  }

  /**
   * Applies a move or corner-resize gesture.
   *
   * Same arithmetic as ARSelectionBox.resizeGesture, including its rule that a
   * box pushed below the minimum pins its moving edge rather than inverting.
   *
   * @param {number} dx - Pointer delta since the gesture began.
   * @param {number} dy
   */
  applyDrag(dx, dy) {
    const { mode, startBox: s } = this.drag;
    const MIN = DecidioContentPicker.MIN_BOX;

    if (mode === 'move') {
      this.box = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h };
      this.renderBox();
      return;
    }

    let { x, y, w, h } = s;
    if (mode === 'tl') { x = s.x + dx; y = s.y + dy; w = s.w - dx; h = s.h - dy; }
    if (mode === 'tr') {              y = s.y + dy; w = s.w + dx; h = s.h - dy; }
    if (mode === 'bl') { x = s.x + dx;              w = s.w - dx; h = s.h + dy; }
    if (mode === 'br') {                            w = s.w + dx; h = s.h + dy; }

    if (w < MIN) { if (mode === 'tl' || mode === 'bl') x = s.x + s.w - MIN; w = MIN; }
    if (h < MIN) { if (mode === 'tl' || mode === 'tr') y = s.y + s.h - MIN; h = MIN; }

    this.box = { x, y, w, h };
    this.renderBox();
  }

  /**
   * Works out what sits inside a freely-drawn box.
   *
   * A dragged rectangle corresponds to no single node, so the box is sampled
   * on a grid and each hit walked up to the largest ancestor still mostly
   * inside it. Scoring then picks between those the same way auto-detect does.
   *
   * @returns {Element|null}
   */
  resolveBoxContent() {
    if (!this.box) return null;

    const vx = this.box.x - window.scrollX;
    const vy = this.box.y - window.scrollY;
    const seen = new Set();
    const STEPS = 5;

    // Every part of this picker that takes pointer events is also a hit for
    // elementFromPoint, which would return the shadow host instead of the page
    // beneath. The footer matters most: it covers the bottom of the viewport,
    // so a box overlapping it lost those samples entirely and could resolve to
    // nothing at all. Stand the whole overlay down for the duration of the scan.
    const interactive = [this.highlightBox, this.footer].filter(Boolean);
    const saved = interactive.map((el) => el.style.pointerEvents);
    interactive.forEach((el) => { el.style.pointerEvents = 'none'; });

    try {
      for (let i = 1; i < STEPS; i++) {
        for (let j = 1; j < STEPS; j++) {
          const px = vx + (this.box.w * i) / STEPS;
          const py = vy + (this.box.h * j) / STEPS;
          if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) continue;

          let node = document.elementFromPoint(px, py);
          if (!node || node === this.hostElement) continue;

          for (let depth = 0; node && depth < 6 && node !== document.body; depth++) {
            seen.add(node);
            node = node.parentElement;
          }
        }
      }
    } finally {
      interactive.forEach((el, i) => { el.style.pointerEvents = saved[i]; });
    }

    let best = null;
    let bestScore = 0;

    for (const el of seen) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;

      // How much of the element the box actually covers. Anything spilling
      // well outside was not what the box was drawn around.
      const ix = Math.max(0, Math.min(r.right, vx + this.box.w) - Math.max(r.left, vx));
      const iy = Math.max(0, Math.min(r.bottom, vy + this.box.h) - Math.max(r.top, vy));
      const contained = (ix * iy) / (r.width * r.height);
      if (contained < 0.6) continue;

      // Bias toward filling the box, so the caption block wins over a bare
      // thumbnail when the user deliberately drew around both.
      const fill = (ix * iy) / (this.box.w * this.box.h);
      const score = this.scoreAsItem(el) + fill * 3;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  }

  /**
   * Pulls a collectable payload out of any element, image or not.
   *
   * ProductPageExtractor is built around an <img>, so a target resolved by
   * scoring (a background-image card, an <svg>) has to surface an image node
   * first, and falls back to its own CSS background when there is none.
   *
   * @param {Element} el
   * @returns {{imageUrl: string|null, productUrl: string|null, productTitle: string|null}}
   */
  extractFromTarget(el) {
    const container = this.findValidProductContainer(el) || el.parentElement || el;
    const { node, url } = this.resolveImageFor(el);

    // extractTitle/extractLocalTitle walk up from whatever anchor they are
    // given and tolerate a non-image one, so the scoring in productPageExtract
    // is reused even when nothing here is an <img>. Anchoring on the image
    // when there IS one keeps its proximity heuristics meaningful.
    const anchor = node && node.tagName === 'IMG' ? node : el;
    const title = ProductPageExtractor.extractTitle(anchor, container);

    const link = el.tagName === 'A' ? el : (el.closest('a[href]') || el.querySelector('a[href]'));
    const productUrl = (node && node.tagName === 'IMG')
      ? ProductPageExtractor.extractProductUrl(node, container)
      : (link ? link.href : location.href);

    return { imageUrl: url, productUrl, productTitle: title || null };
  }

  /**
   * Finds the picture for a target, whatever form it takes.
   *
   * Widening the selection used to lose the image: a card wrapping a
   * background-image div has no background of its own, so reading only the
   * target's own style returned nothing the moment you stepped out one level.
   * The search therefore covers descendants too, and serializes inline SVG
   * art, which is neither an <img> nor a background.
   *
   * @param {Element} el
   * @returns {{node: Element|null, url: string|null}}
   */
  resolveImageFor(el) {
    const img = el.tagName === 'IMG' ? el : el.querySelector('img');
    if (img) return { node: img, url: ProductPageExtractor.extractImageUrl(img) };

    const bgUrl = (n) => {
      if (!n || !n.nodeType) return null;
      const bg = getComputedStyle(n).backgroundImage;
      const m = bg && bg !== 'none' && bg.match(/url\(["']?(.*?)["']?\)/);
      if (!m) return null;
      try { return new URL(m[1], location.href).href; } catch (e) { return m[1]; }
    };

    const own = bgUrl(el);
    if (own) return { node: el, url: own };

    for (const child of el.querySelectorAll('*')) {
      const u = bgUrl(child);
      if (u) return { node: child, url: u };
    }

    const svg = el.tagName === 'SVG' || el.tagName === 'svg' ? el : el.querySelector('svg');
    if (svg) {
      try {
        const markup = new XMLSerializer().serializeToString(svg);
        // encodeURIComponent rather than btoa: the markup may carry characters
        // outside Latin-1, which btoa throws on.
        return { node: svg, url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup) };
      } catch (e) { /* fall through to no image */ }
    }

    return { node: null, url: null };
  }

  /**
   * Commits the frozen selection to the batch and re-arms the picker for the
   * next one. Collect adds an item; it does not end the session — that is what
   * Done does.
   */
  commitBoxSelection() {
    if (!this.isFrozen) return;

    const el = this.resolveBoxContent();
    const picture = this.resolveBoxImage();

    // The item's identity and its picture are resolved separately on purpose.
    // resolveBoxContent needs an element mostly INSIDE the box to name the
    // thing; but a box tightened around part of a photo leaves that photo only
    // partly covered, so the same test would throw away the very image being
    // framed. Whatever the box overlaps most wins the picture.
    if (el || picture) {
      const item = el
        ? this.extractFromTarget(el)
        : { imageUrl: null, productUrl: location.href, productTitle: null };

      if (picture && picture.url) item.imageUrl = picture.url;

      // The box is a crop, as it is in the app — so what gets collected is the
      // framed region, not the whole source image. Measured before the box is
      // released below, since the CORS retry resolves long after that.
      if (picture && picture.node) {
        const geom = this.cropGeometry(picture.node, this.box);
        if (geom) {
          const cropped = this.drawCrop(picture.node, geom);
          if (cropped) {
            item.imageUrl = cropped;
          } else {
            this.recropWithCors(picture.node, geom, item);
          }
        }
      }

      // With no element to name it, fall back to the picture's own context.
      if (!item.productTitle && picture && picture.node) {
        item.productTitle = ProductPageExtractor.extractTitle(
          picture.node,
          this.findValidProductContainer(picture.node) || picture.node.parentElement
        ) || null;
      }

      this.enqueueForIdentify(item);
    }

    this.releaseSelection();
    this.updateFooterState();
  }

  /**
   * Puts a collected item into the identify queue and starts resolving it.
   *
   * Newest first, as ARSessionStore.submit inserts at index 0 — the thing you
   * just framed should be the row you look at.
   *
   * @param {{imageUrl: string|null, productUrl: string|null, productTitle: string|null}} item
   */
  enqueueForIdentify(item) {
    const entry = {
      id: this.nextQueueId++,
      thumb: item.imageUrl,
      productUrl: item.productUrl,
      title: item.productTitle,
      brand: null,
      state: 'pending',
      error: null
    };

    this.queue.unshift(entry);
    this.renderIdentify();
    this.identify(entry);
  }

  /**
   * Shows or hides the identify queue.
   *
   * @param {boolean} [force] - Explicit state; omitted toggles.
   */
  toggleIdentify(force) {
    this.identifyOpen = force === undefined ? !this.identifyOpen : force;
    if (this.identifyPage) {
      this.identifyPage.classList.remove('is-dragging');
      this.identifyPage.style.transform = '';
      this.identifyPage.classList.toggle('is-open', this.identifyOpen);
    }
    if (this.footer) this.footer.classList.toggle('is-identifying', this.identifyOpen);
  }

  /**
   * Horizontal paging between the picker and the Identify list.
   *
   * Trackpad/wheel deltaX is the browser's nearest equivalent of the app's
   * swipe. Vertical scrolling is left alone so the page underneath still
   * scrolls while picking, and paging is suspended while a selection is frozen
   * — the same guard as `.scrollDisabled(frozen != nil)`.
   */
  handleWheel = (e) => {
    if (!this.isActive || this.isFrozen || !this.identifyPage) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

    e.preventDefault();

    const now = Date.now();
    if (now - (this.pageWheelAt || 0) > 220) this.pageWheelDx = 0;
    this.pageWheelAt = now;
    this.pageWheelDx = (this.pageWheelDx || 0) + e.deltaX;

    // Live tracking, so the panel follows the gesture rather than appearing
    // after it. deltaX is positive swiping toward the Identify page.
    const w = window.innerWidth;
    const base = this.identifyOpen ? 0 : w;
    const x = Math.max(0, Math.min(w, base + (this.identifyOpen ? -this.pageWheelDx : -this.pageWheelDx)));

    if (Math.abs(this.pageWheelDx) > 90) {
      this.pageWheelDx = 0;
      this.toggleIdentify(!this.identifyOpen);
      return;
    }

    this.identifyPage.classList.add('is-dragging');
    this.identifyPage.style.visibility = 'visible';
    this.identifyPage.style.transform = `translateX(${x}px)`;

    clearTimeout(this.pageWheelTimer);
    this.pageWheelTimer = setTimeout(() => {
      this.pageWheelDx = 0;
      this.identifyPage.classList.remove('is-dragging');
      this.identifyPage.style.transform = '';
      this.identifyPage.style.visibility = '';
    }, 200);
  };

  /**
   * The queue rows that resolved, in the payload shape the panel expects.
   * Mirrors ARSessionStore.completedItems.
   *
   * @returns {Array<{imageUrl: string|null, productUrl: string|null, productTitle: string|null}>}
   */
  identifiedItems() {
    return this.queue
      .filter((q) => q.state === 'complete')
      .map((q) => ({ imageUrl: q.thumb, productUrl: q.productUrl, productTitle: q.title }));
  }

  /**
   * Paints the identify queue. Rebuilt wholesale rather than diffed — the list
   * is a handful of rows and only changes when one resolves.
   */
  renderIdentify() {
    if (!this.identifyPage) return;

    const body = this.identifyPage.querySelector('.decidio-id-body');
    if (!body) return;

    if (!this.queue.length) {
      body.innerHTML = '<div class="decidio-id-empty">Collect items to identify them</div>';
      this.updateFooterState();
      return;
    }

    const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => (
      { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
    ));

    body.innerHTML = '<div class="decidio-id-rule"></div>' + this.queue.map((q) => {
      let detail;
      if (q.state === 'pending') {
        detail = '<span class="decidio-id-spinner" role="status" aria-label="Identifying"></span>';
      } else if (q.state === 'complete') {
        detail = `<span class="decidio-id-text">
            <span class="decidio-id-brand">${esc(q.brand)}</span>
            <span class="decidio-id-name">${esc(q.title)}</span>
          </span>`;
      } else {
        detail = `<span class="decidio-id-failed">Could not identify</span>`;
      }

      const thumb = q.thumb
        ? `<img class="decidio-id-thumb" src="${esc(q.thumb)}" alt="">`
        : '<span class="decidio-id-thumb is-blank"></span>';

      return `<div class="decidio-id-row is-${q.state}">${thumb}${detail}</div>
              <div class="decidio-id-rule"></div>`;
    }).join('');

    this.updateFooterState();
  }

  /**
   * Resolves one queued item.
   *
   * This is the seam where the app calls Gemini via ItemScanService. The
   * extension has no identification endpoint wired yet, so the answer comes
   * from what the page itself declared while the item was picked. Kept async
   * and state-driven anyway, so swapping in a real request later changes only
   * the body of this method — not the queue, the states, or the UI.
   *
   * @param {{state: string, title: string|null, brand: string|null}} entry
   */
  async identify(entry) {
    try {
      const title = (entry.title || '').trim();
      if (!title) throw new Error('No name found on the page');

      // Same split the app's Identify rows use: first word above, full name
      // below (see ARIdentifyPage.itemRow).
      entry.brand = title.split(/\s+/)[0] || null;
      entry.title = title;
      entry.state = 'complete';
    } catch (err) {
      entry.state = 'failed';
      entry.error = err.message;
    }

    this.renderIdentify();
    this.updateFooterState();
  }

  /**
   * Finds the picture the box is framing, by overlap rather than containment.
   *
   * @returns {{node: Element, url: string}|null}
   */
  resolveBoxImage() {
    if (!this.box) return null;

    const vx = this.box.x - window.scrollX;
    const vy = this.box.y - window.scrollY;
    let best = null;
    let bestArea = 0;

    for (const node of document.querySelectorAll('img, svg, canvas, video, picture')) {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;

      const ix = Math.max(0, Math.min(r.right, vx + this.box.w) - Math.max(r.left, vx));
      const iy = Math.max(0, Math.min(r.bottom, vy + this.box.h) - Math.max(r.top, vy));
      const area = ix * iy;

      if (area > bestArea) {
        bestArea = area;
        best = node;
      }
    }

    // A stray sliver clipping the box edge is not what is being framed.
    if (!best || bestArea < this.box.w * this.box.h * 0.15) return null;

    const { url } = this.resolveImageFor(best);
    return url ? { node: best, url } : null;
  }

  /**
   * Keeps the footer in step with the picker: the plus only means anything
   * while a box is frozen, and the running count sits beside it.
   */
  updateFooterState() {
    if (!this.footer) return;

    this.footer.classList.toggle('is-frozen', this.isFrozen);

    const count = this.footer.querySelector('#decidio-count');
    if (count) {
      const done = this.identifiedItems().length;
      const waiting = this.queue.filter((q) => q.state === 'pending').length;
      count.textContent = waiting
        ? `${done} collected · ${waiting} working`
        : (done ? `${done} collected` : '');
    }
  }

  /**
   * Marks the chosen list in the footer carousel and centres it, the way
   * ARListCarousel keeps the selected name under the middle of the strip.
   */
  updateCarouselSelection(instant = false) {
    if (!this.footer) return;

    const strip = this.footer.querySelector('.decidio-ar-strip');
    if (!strip) return;

    strip.querySelectorAll('.decidio-ar-name').forEach((el) => {
      const on = el.dataset.listId === String(this.selectedListId);
      el.classList.toggle('is-selected', on);
      if (!on) return;

      // Deferred a frame: on first render this runs before the footer has been
      // laid out, so the measurements below are all still zero.
      //
      // Measured from live rects and applied as a RELATIVE scroll, rather than
      // via offsetLeft — the strip is not a positioned element, so offsetLeft
      // resolves against some ancestor further up the shadow tree and does not
      // share an origin with scrollLeft.
      requestAnimationFrame(() => {
        const sr = strip.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        const delta = (er.left + er.width / 2) - (sr.left + sr.width / 2);
        strip.scrollBy({ left: delta, behavior: instant ? 'instant' : 'smooth' });
      });
    });
  }

  /**
   * Emits collected batch selection payload to background runtime and closes picker.
   */
  finishBatchSelection() {
    // Leaving with nothing collected is a cancel, not an empty batch — the
    // panel restores either way, but an empty PRODUCT_IMAGES_BATCH_PICKED
    // would still read as a completed save downstream.
    // Only identified rows are saved — a pending or failed one has no name to
    // file under, and the queue shows exactly which those are.
    const items = this.identifiedItems();
    chrome.runtime.sendMessage(
      items.length
        ? { action: "PRODUCT_IMAGES_BATCH_PICKED", items }
        : { action: "DECIDIO_PICKER_CANCELLED" }
    );
    this.stop();
  }
}