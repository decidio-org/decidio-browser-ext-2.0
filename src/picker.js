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
    this.rail = null;               // compact collected list in the left margin
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
    this.saving = false;
    this.saveError = null;

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
      /* Nothing in the overlay is text to read or copy — it is all controls
         and labels on them. Without this, a click or a small drag on the
         collected column or the footer selects its words, and the browser's
         selection highlight over white type is unreadable. Set on the root so
         it covers every part of the overlay, present and future. */
      :host, :host * {
        -webkit-user-select: none;
        user-select: none;
      }

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
        /* Square. A rounded outline over a rectangular photo leaves the
           picture's own corner poking out past the curve at each corner. */
        border-radius: 0;
        transition: outline-color 0.25s ease;
        will-change: top, left, width, height;
      }
      .decidio-highlight-box.show {
        display: block;
      }
      /* Inert while hovering so the hit-test underneath still sees the page;
         grabbable once frozen, when the box becomes the thing being handled. */
      .decidio-highlight-box.is-frozen {
        pointer-events: none;      /* only the confirm button takes clicks */
        transition: none;
      }

      /* The confirm, in the middle of what is highlighted. A check in a ring,
         at the footer's weight, and nothing else — no label, no plate. It is
         the second click: the first highlights, this one keeps it. */
      /* The button fills the highlight and shows the check at its centre.
         A 56px target in the middle of a product photo is a small thing to
         hit — the second click of a double-click lands wherever the first
         one did, which is rarely dead centre — so the whole of what you
         highlighted confirms it, and the check is what that target looks
         like rather than the only part of it that works. */
      .decidio-confirm {
        position: absolute;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0;
        margin: 0;
        border: none;
        background: none;
        cursor: pointer;
        line-height: 0;
      }
      .decidio-highlight-box.is-frozen .decidio-confirm {
        display: flex;
        pointer-events: auto;
      }
      /* A filled disc, not an outline: a white hairline ring vanished against
         a pale product photo, which is most of them. The disc carries its own
         contrast whatever is behind it, and the check is drawn in Decidio
         Purple on it. */
      .decidio-confirm svg {
        width: 64px;
        height: 64px;
        transition: transform 120ms ease;
        filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.45));
      }
      .decidio-confirm svg circle {
        fill: #ffffff;
        stroke: none;
      }
      .decidio-confirm svg polyline {
        fill: none;
        stroke: #803065;              /* Decidio Purple */
        stroke-width: 2.4;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .decidio-confirm:hover svg { transform: scale(1.1); }
      .decidio-confirm:active svg { transform: scale(0.95); }

      /* ------------------------------------------------------------------
         CROP — NOT SHIPPED
         ------------------------------------------------------------------
         The purple corner brackets and the drag-to-resize crop box that used
         to live here are gone. A selection is now the highlight alone, and
         what gets collected is the whole thing that was highlighted.

         TODO (future work): bring the crop back as a Decidio Premium feature.
         The machinery is still in this file and still correct — beginDrag,
         applyDrag, handleDragMove, handleDragEnd, cropGeometry, drawCrop and
         captureCrop all take a box and crop to it, and commitBoxSelection
         already crops whenever this.box is tighter than the subject. What was
         removed is only the chrome that let a box be dragged: four corner
         brackets appended to the highlight box, each wired to
         beginDrag(e, corner), plus a move handler on the box itself. Restore
         those behind the entitlement check and the rest works as it did.
         ------------------------------------------------------------------ */
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
      /* The rule used to frame the list carousel and faded out with it. The
         carousel is gone — the list is chosen in the panel now — so the rule
         is the footer's own top line and stays put on every page. */

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
        /* The 40px aperture used to set this row's height. With it gone the
           bar collapsed onto the two labels and sat hard against the bottom
           edge, so the height it was giving is now stated. */
        min-height: 44px;
      }
      /* The footer's aperture is gone. It added whatever was framed, which is
         now the check in the middle of the highlight itself — one control for
         one action, and in the place the action is happening rather than at
         the bottom of the screen. The footer is Collected and Done. */
      .decidio-ar-done {
        position: absolute;
        right: 20px;
        background: #ffffff;
        color: #000000;
        border: none;
        /* 12px, the radius the panel uses on its own controls. */
        border-radius: 12px;
        padding: 8px 16px;
        font-family: "SFProDisplay", -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .decidio-ar-done:hover { background: #f0f0f0; }

      /* ---------- Collected rail (left margin) ----------------------------
         The same list the Collected page shows, compacted into the margin so
         what you have already taken stays in view while you take the next
         one. Rows are the Collected page's rows at a smaller gauge: a
         thumbnail, the brand above the name. The page itself is still there
         for the full-size version and for retrying a failure.
         -------------------------------------------------------------------- */
      .decidio-ar-rail {
        position: fixed;
        /* On the right, where the panel lives — the page's own content tends
           to start at the left margin, so the column sat over it there. */
        right: 26px;
        top: 88px;
        /* Height follows the list rather than filling the screen. Pinned to a
           bottom edge, the rule and Done sat at the foot of the viewport with
           a field of nothing between them and a single row. The cap keeps a
           long list clear of where the page's own bottom is. */
        bottom: auto;
        max-height: calc(100vh - 216px);
        z-index: 2147483647;
        width: 268px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        /* No ground of its own. The overlay already dims the page by 0.5, and
           a panel on top of that was a second, darker opacity sitting inside
           the first — two windows over one screen. The list simply sits on
           the dim the overlay already laid down, so there is one surface. */
        background: none;
        border: none;
        box-shadow: none;
        /* Reserved space to LOOK at, not to touch. With pointer events it
           swallowed every selection in the left 268px of the page — the
           column covers real content, and framing something behind it has to
           keep working. The Collected page is the one you interact with. */
        pointer-events: none;
        font-family: "SFProDisplay", -apple-system, BlinkMacSystemFont, sans-serif;
        transition: opacity 0.25s ease;
      }
      .decidio-ar-rail:empty { display: none; }
      .decidio-ar-rail-head {
        flex: 0 0 auto;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        padding: 0 0 10px;
        font-family: "NHaasGroteskDSStd", sans-serif;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: -0.01em;
        color: #ffffff;
        position: relative;
      }
      /* The rules stop short of the column's right edge rather than running
         its full width — drawn as insets so the rows keep their own width and
         the text is not pulled in with them. */
      .decidio-ar-rail-head::after,
      .decidio-ar-rail-row::after {
        content: '';
        position: absolute;
        left: 0;
        right: 34px;
        bottom: 0;
        height: 0.75px;
        background: rgba(255, 255, 255, 0.22);
      }
      /* Newest at the top and the overflow simply clipped: the column cannot
         be scrolled (see pointer-events above), so what it shows is the most
         recent that fit. Everything is on the Collected page. */
      /* The count the bottom bar used to carry, now beside the word it counts. */
      .decidio-ar-rail-count {
        font-family: "SFProDisplay", -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: rgba(255, 255, 255, 0.6);
      }

      /* Done, under a rule, as the bottom bar had it. */
      .decidio-ar-rail-foot {
        flex: 0 0 auto;
        margin-top: 14px;
        padding-top: 14px;
        border-top: 0.75px solid rgba(255, 255, 255, 0.28);
      }
      .decidio-ar-rail-done {
        pointer-events: auto;
        background: #ffffff;
        color: #000000;
        border: none;
        border-radius: 12px;
        padding: 9px 20px;
        cursor: pointer;
        font-family: "SFProDisplay", -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 600;
      }
      .decidio-ar-rail-done:hover { background: #f0f0f0; }
      .decidio-ar-rail-done[disabled] { opacity: 0.6; cursor: default; }
      .decidio-ar-rail-error {
        margin: 0 0 10px;
        color: #ff8a80;
        font-family: "SFProDisplay", -apple-system, sans-serif;
        font-size: 12.5px;
        font-weight: 500;
        line-height: 1.35;
      }

      .decidio-ar-rail-body {
        /* Takes the space its rows need, and no more — it is what the column
           sizes itself around. Past the cap the oldest rows are clipped; the
           Collected page has them all. */
        flex: 0 1 auto;
        min-height: 0;
        overflow: hidden;
      }
      /* Only once there are more rows than fit: the last one dissolves rather
         than being cut through the middle, which is what a hard clip does to
         a row of type and a thumbnail. */
      .decidio-ar-rail-body.is-clipped {
        -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 44px), transparent 100%);
        mask-image: linear-gradient(to bottom, #000 calc(100% - 44px), transparent 100%);
      }
      .decidio-ar-rail-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 11px 0;
        position: relative;
      }
      /* Take an item back out before the batch is ever saved. A ringed ×, as
         the app draws its circled glyphs, so it reads as a control rather
         than as a stray mark on the row. */
      .decidio-ar-rail-remove {
        flex: 0 0 auto;
        margin-left: auto;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        line-height: 0;
        pointer-events: auto;
      }
      .decidio-ar-rail-remove svg {
        width: 22px;
        height: 22px;
        fill: none;
        stroke: rgba(255, 255, 255, 0.7);
        stroke-width: 1.8;
        stroke-linecap: round;
      }
      .decidio-ar-rail-remove:hover svg { stroke: #ffffff; }
      .decidio-ar-rail-row:last-child::after { display: none; }
      .decidio-ar-rail-thumb {
        /* The Collected page's own 70x50 thumbnail. */
        flex: 0 0 70px;
        width: 70px;
        height: 50px;
        object-fit: cover;
        display: block;
        background: rgba(255, 255, 255, 0.14);
      }
      .decidio-ar-rail-text { display: flex; flex-direction: column; min-width: 0; }
      .decidio-ar-rail-brand {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.6);
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .decidio-ar-rail-name {
        font-size: 15px;
        font-weight: 600;
        color: #ffffff;
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .decidio-ar-rail-row.is-pending .decidio-ar-rail-name,
      .decidio-ar-rail-row.is-failed  .decidio-ar-rail-name {
        color: rgba(255, 255, 255, 0.55);
      }
      /* The Collected page is the full-size version of this list, so the rail
         stands down while that page is up rather than doubling it. */
      /* visibility, not just opacity: .is-yielding below sets its own opacity
         at the same specificity and later in the sheet, so on its own an
         opacity rule here lost and the column stayed faintly on screen over
         the Collected page. */
      .decidio-ar-rail.is-hidden {
        opacity: 0;
        visibility: hidden;
      }
      /* And it clears out of the way of whatever is being framed behind it,
         rather than sitting over the picture. Dropped to a trace instead of
         to nothing, so it is clear it has moved aside and not vanished. */
      .decidio-ar-rail.is-yielding { opacity: 0.12; }

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
    // No corner brackets, no drag handles and no confirm: cropping is held
    // back for Premium (see the CROP note in the stylesheet above), and a
    // click on a thing collects it outright. The check that used to sit in
    // the middle only asked for a second press to agree with the first.
    this.confirmBtn = null;
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
      // No bottom bar. Everything it carried — the count, Done, and the rule
      // framing them — is in the collected column now, beside what is being
      // collected rather than at the far edge of the screen.
      this.footer = null;

      this.rail = document.createElement('div');
      this.rail.className = 'decidio-ar-rail';
      // The column is pointer-events: none so it never swallows a selection;
      // its controls opt back in, and their clicks must not reach the page
      // behind them.
      this.rail.addEventListener('click', (e) => {
        const remove = e.target.closest('.decidio-ar-rail-remove');
        const done = e.target.closest('.decidio-ar-rail-done');
        if (!remove && !done) return;
        e.stopPropagation();
        e.preventDefault();
        if (remove) this.removeFromQueue(Number(remove.dataset.id));
        else this.finishBatchSelection();
      }, true);
      this.shadowRoot.appendChild(this.rail);
      this.renderRail();

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

      // No vertical "Collect" signpost on open. It sat down the right edge
      // for two seconds over whatever was there, and the overlay already says
      // what it is for. this.hint stays null; the guarded uses are inert.

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
  /**
   * Shuts the overlay down if this copy has been cut off from the extension.
   *
   * Reloading the extension leaves this code running in any open tab, but
   * unable to reach the extension. An overlay that was open at that moment
   * kept its window-level listeners, and handleClick swallows clicks
   * (preventDefault + stopPropagation) — so every click on the page died
   * there, including Done on the fresh overlay a re-injected copy put up.
   * Done looked fine and did nothing. A cut-off copy now stands down the
   * first time it sees any input, and lets that input through.
   *
   * @returns {boolean} true if it shut down (the caller should do nothing).
   */
  standDownIfOrphaned() {
    let alive = false;
    try { alive = Boolean(chrome.runtime && chrome.runtime.id); } catch (e) { alive = false; }
    if (alive) return false;
    try { this.stop(); } catch (e) {
      // stop() can fail partway once the extension is gone; the listeners
      // are what matter, so take them off directly.
      this.isActive = false;
      try { this.detachEventListeners(); } catch (e2) {}
      if (this.hostElement) { try { this.hostElement.remove(); } catch (e3) {} }
    }
    return true;
  }

  handleMouseMove = (e) => {
    if (!this.isActive) return;
    if (this.standDownIfOrphaned()) return;
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
      this.yieldRailTo(this.box && {
        left: this.box.x - window.scrollX,
        top: this.box.y - window.scrollY,
        width: this.box.w,
        height: this.box.h
      });
      return;
    }

    this.checkElementAtCursor(this.lastMouseX, this.lastMouseY);
    this.yieldRailTo(this.lastRect);
  };

  /**
   * elementFromPoint, but through shadow roots.
   *
   * The plain call stops at a shadow host, so on a site built out of web
   * components every hit resolves to the custom element and never to the
   * <img> inside it — the picker sees nothing to collect and no text to name
   * it with. Walking the open roots gets to the real node. Closed roots have
   * no way in and still return the host, which is the old behaviour.
   *
   * @param {number} x
   * @param {number} y
   * @returns {Element|null}
   */
  deepElementFromPoint(x, y) {
    let node = document.elementFromPoint(x, y);
    // Bounded: a pathological tree should not spin here.
    for (let depth = 0; node && node.shadowRoot && depth < 12; depth++) {
      const inner = node.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === node) break;
      node = inner;
    }
    return node;
  }

  /**
   * Performs hit-testing at target coordinates to identify valid product images under pointer.
   * 
   * @param {number} x - Viewport X coordinate.
   * @param {number} y - Viewport Y coordinate.
   */
  /**
   * Whether a point is over the collected column.
   *
   * Measured rather than hit-tested: the column is pointer-events: none so it
   * never swallows a selection, which also means elementFromPoint looks
   * straight through it and reports the page behind. Without this, running
   * the cursor over the column highlighted whatever happened to be underneath
   * it and a click there picked that up.
   *
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isOverRail(x, y) {
    if (!this.rail || this.rail.classList.contains('is-hidden')) return false;
    if (!this.rail.querySelector('.decidio-ar-rail-row')) return false;   // empty
    const r = this.rail.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  checkElementAtCursor(x, y) {
    // A locked selection owns the box until it is collected or dismissed —
    // tracking the cursor here would drag the highlight off the thing the user
    // is in the middle of adjusting.
    if (this.isFrozen) return;

    // Ignore hovering over picker's own multi-selection UI pill, or over the
    // collected column — both are chrome, and neither should put a highlight
    // round the page behind them.
    const shadowTarget = this.shadowRoot ? this.shadowRoot.elementFromPoint(x, y) : null;
    if ((shadowTarget && shadowTarget.closest('.decidio-ar-footer')) || this.isOverRail(x, y)) {
      this.currentTarget = null;
      this.updateHighlight(null);
      return;
    }

    // Ignore hovering over picker host container
    let elementUnderneath = this.deepElementFromPoint(x, y);
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
      this.yieldRailTo(null);
      return;
    }

    const rect = target.getBoundingClientRect();

    // Before the unchanged-rect check below, which returns early: the column
    // still has to get out of the way of a target it is sitting on.
    this.yieldRailTo(rect);

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
    if (this.standDownIfOrphaned()) return;   // let the click through untouched

    // Check click target within Shadow DOM elements
    const path = e.composedPath ? e.composedPath() : [];
    const clickedInsidePill = path.some(el => 
      el.classList && el.classList.contains('decidio-ar-footer')
    );

    const shadowTarget = this.shadowRoot ? this.shadowRoot.elementFromPoint(e.clientX, e.clientY) : null;
    const clickedShadowUI = shadowTarget &&
      (shadowTarget.closest('.decidio-ar-footer') || shadowTarget.closest('.decidio-ar-rail'));

    // Ignore click events originating on multi-selection UI controls. The
    // collected column is listed too: its × has its own handler, and the
    // stopPropagation below would otherwise swallow the click before the
    // column ever saw it. isOverRail covers the rest of the column, which is
    // pointer-events: none and so invisible to the hit test above.
    if (clickedInsidePill || clickedShadowUI) return;

    // Over the collected column, but not on one of its own controls. The
    // column is pointer-events: none, so without this the click goes straight
    // through to the page — on a card that is a link, that navigates away and
    // takes the whole picker with it. Default prevented, but NOT propagation:
    // the column's own × listener sits below this one and still needs the
    // event.
    if (this.isOverRail(e.clientX, e.clientY)) {
      e.preventDefault();
      return;
    }

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
      // The commit runs here rather than on the check's own listener. This is
      // a CAPTURE listener on window and it calls stopPropagation above, so a
      // click on the check never reached the button at all — the check looked
      // dead. It is the face of the target, not the handler for it: the whole
      // highlight commits, and a click outside drops it.
      if (inside) this.commitBoxSelection();
      else this.releaseSelection();
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

    // One click collects. freezeSelection still exists and still sizes a box
    // to the subject — commitBoxSelection crops to this.box — so the Premium
    // crop can put an adjust step back between these two lines.
    this.freezeSelection(this.currentTarget, e.clientX, e.clientY);
    this.commitBoxSelection();
  };

  /**
   * Keyboard shortcuts: Escape backs out one level (frozen selection first,
   * then the picker itself), and the arrow keys widen/narrow a frozen
   * selection so it can be adjusted without reaching for the pill.
   */
  handleKeyDown = (e) => {
    if (this.isActive && this.standDownIfOrphaned()) return;
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
      /* Stored, not just shown, so it has to be small.

         Crops were full source resolution as PNG — often several hundred KB
         to over a megabyte each, kept twice (the list and Collected Items).
         Extension storage holds 10 MB by default, so a handful of collects
         filled it and from then on every save failed. Capped at 800px on the
         long edge (the panel shows them at a fraction of that) and encoded
         as JPEG: tens of KB instead. */
      const MAX = 800;
      const scale = Math.min(1, MAX / Math.max(g.sw, g.sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(g.sw * scale));
      canvas.height = Math.max(1, Math.round(g.sh * scale));
      const ctx = canvas.getContext('2d');
      // JPEG has no transparency; a cut-out product shot gets white, not black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, g.sx, g.sy, g.sw, g.sh, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      return null;   // tainted canvas, or a video with no frame yet
    }
  }

  /**
   * Second attempt at a crop for an image that tainted the canvas, by
   * re-requesting it with CORS. Resolves to null when the server sends no
   * CORS headers, which is the signal to fall back to a tab capture.
   *
   * @param {Element} node
   * @param {{sx:number, sy:number, sw:number, sh:number}} geom
   * @returns {Promise<string|null>}
   */
  recropWithCors(node, geom) {
    const src = node.currentSrc || node.src;
    if (!src || src.startsWith('data:')) return Promise.resolve(null);

    return new Promise((resolve) => {
      const probe = new Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = () => resolve(this.drawCrop(probe, geom));
      probe.onerror = () => resolve(null);   // no CORS headers — try a capture
      probe.src = src;
    });
  }

  /**
   * Crops the framed region out of a screenshot of the tab.
   *
   * The way in when the page will not let its pictures be read: a capture is
   * of the rendered page, so it works regardless of CORS, canvas tainting, or
   * whether the thing was ever an <img>. Resolution is the viewport's, not
   * the source file's, which is why this runs only after drawCrop has failed.
   *
   * The overlay has to stand down for the shot or the capture would include
   * the dimming, the selection box and the collected column.
   *
   * @param {{x:number,y:number,w:number,h:number}} box - page coordinates.
   * @returns {Promise<string|null>} data URL of the crop, or null.
   */
  async captureCrop(box) {
    if (!box || !box.w || !box.h) return null;

    const chrome_ = typeof chrome !== 'undefined' && chrome.runtime ? chrome : null;
    if (!chrome_) return null;

    const hidden = [this.overlay, this.highlightBox, this.footer, this.rail, this.badge]
      .filter(Boolean);
    const saved = hidden.map((el) => el.style.visibility);
    hidden.forEach((el) => { el.style.visibility = 'hidden'; });

    let shot = null;
    try {
      // Two frames: one for the hide to be painted, one for the capture to be
      // taken against it. A single frame caught the overlay still up.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      shot = await new Promise((resolve) => {
        try {
          chrome_.runtime.sendMessage({ action: 'DECIDIO_CAPTURE_TAB' }, (reply) => {
            if (chrome_.runtime.lastError || !reply || reply.error) return resolve(null);
            resolve(reply.dataUrl || null);
          });
        } catch (e) { resolve(null); }
      });
    } finally {
      hidden.forEach((el, i) => { el.style.visibility = saved[i]; });
    }
    if (!shot) return null;

    const img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = shot;
    });
    if (!img) return null;

    // The capture is the VIEWPORT at device pixels, so the box has to be put
    // back into viewport coordinates and then scaled by whatever ratio the
    // shot came back at — reading it off the image rather than trusting
    // devicePixelRatio, which disagrees on some zoom levels.
    const scale = img.naturalWidth / window.innerWidth;
    const vx = (box.x - window.scrollX) * scale;
    const vy = (box.y - window.scrollY) * scale;
    const vw = box.w * scale;
    const vh = box.h * scale;

    // Nothing off the edges of the shot: a box hanging past the viewport
    // would otherwise draw transparent padding into the crop.
    const sx = Math.max(0, Math.min(vx, img.naturalWidth));
    const sy = Math.max(0, Math.min(vy, img.naturalHeight));
    const sw = Math.max(1, Math.min(vw, img.naturalWidth - sx));
    const sh = Math.max(1, Math.min(vh, img.naturalHeight - sy));

    return this.drawCrop(img, { sx, sy, sw, sh });
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
    // confirmBtn is listed separately: it sets pointer-events: auto in CSS,
    // and a child's own value is not overridden by standing its parent down.
    // Left in, it covers the whole highlight and every sample resolved to the
    // button instead of the page — the item came back named after the page.
    const interactive = [this.highlightBox, this.confirmBtn, this.footer].filter(Boolean);
    const saved = interactive.map((el) => el.style.pointerEvents);
    interactive.forEach((el) => { el.style.pointerEvents = 'none'; });

    try {
      for (let i = 1; i < STEPS; i++) {
        for (let j = 1; j < STEPS; j++) {
          const px = vx + (this.box.w * i) / STEPS;
          const py = vy + (this.box.h * j) / STEPS;
          if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) continue;

          let node = this.deepElementFromPoint(px, py);
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

    // A name taken off the page rather than off the item is the page's name,
    // which on a listing is wrong for every tile on it. On a product page it
    // IS the item's name, so only the listing case counts as unresolved.
    const driver = typeof getActiveDriver === 'function' ? getActiveDriver() : null;
    const onProductPage = !!(driver && typeof driver.isProductPage === 'function'
      && driver.isProductPage());
    const borrowed = ProductPageExtractor.lastTitleSource === 'page' && !onProductPage;

    const link = el.tagName === 'A' ? el : (el.closest('a[href]') || el.querySelector('a[href]'));
    const productUrl = (node && node.tagName === 'IMG')
      ? ProductPageExtractor.extractProductUrl(node, container)
      : (link ? link.href : location.href);

    return { imageUrl: url, productUrl, productTitle: title || null, borrowedTitle: borrowed };
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
    let needsCapture = null;

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
      // framed region, not the whole source image.
      //
      // Three ways in, cheapest first. The canvas crop is exact and full
      // resolution but throws on a cross-origin picture the site serves
      // without CORS headers, which is most of why some sites gave up no
      // image at all. Re-fetching with CORS rescues the ones whose server
      // does allow it. A screenshot of the tab rescues the rest, and anything
      // that was never an <img> in the first place.
      const box = { ...this.box };
      if (picture && picture.node) {
        const geom = this.cropGeometry(picture.node, this.box);
        if (geom) {
          const cropped = this.drawCrop(picture.node, geom);
          if (cropped) {
            item.imageUrl = cropped;
          } else {
            needsCapture = { node: picture.node, geom };
          }
        }
      } else {
        // Nothing resolved as a picture at all — a CSS background, a canvas,
        // an inline SVG. The shot does not care what drew it.
        needsCapture = { node: null, geom: null };
      }

      // With no element to name it, fall back to the picture's own context.
      if (!item.productTitle && picture && picture.node) {
        item.productTitle = ProductPageExtractor.extractTitle(
          picture.node,
          this.findValidProductContainer(picture.node) || picture.node.parentElement
        ) || null;
      }

      const entry = this.enqueueForIdentify(item);

      // Both rescues land after the row is already on screen, so they patch
      // the row itself rather than the item it was built from. The old code
      // patched the item, which by then nothing was reading — the picture
      // never reached the thumbnail.
      if (needsCapture) this.rescuePicture(entry, needsCapture, box);
    }

    this.releaseSelection();
    this.updateFooterState();
  }

  /**
   * Second and third attempts at a picture, for one the canvas would not give
   * up. Runs after the row is on screen and updates it in place, so a slow or
   * refused capture never holds up the picker.
   *
   * @param {Object} entry - the queue row to patch.
   * @param {{node: Element|null, geom: Object|null}} what
   * @param {{x:number,y:number,w:number,h:number}} box - page coordinates,
   *   taken before the selection was released.
   */
  async rescuePicture(entry, what, box) {
    let url = null;

    if (what.node && what.geom) url = await this.recropWithCors(what.node, what.geom);
    if (!url) url = await this.captureCrop(box);
    if (!url) return;

    entry.thumb = url;
    this.renderIdentify();
    this.renderRail();
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
      // True when the only name available described the page, not this item.
      borrowedTitle: !!item.borrowedTitle,
      state: 'pending',
      error: null
    };

    this.queue.unshift(entry);
    this.renderIdentify();
    this.renderRail();
    this.identify(entry);
    return entry;
  }

  /**
   * Drops one row from the collected queue, before any of it is saved.
   *
   * @param {number} id - the row's queue id.
   */
  removeFromQueue(id) {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.id !== id);
    if (this.queue.length === before) return;
    this.renderIdentify();
    this.renderRail();
    this.updateFooterState();
  }

  /**
   * Stands the collected column down while what you are pointing at is behind
   * it.
   *
   * The column sits over real page content, so an image under it cannot be
   * seen while it is being framed. It is a record of what has already been
   * taken, which matters less at that moment than the thing being taken, so
   * it yields and comes back when the target moves away.
   *
   * @param {DOMRect|{left,top,width,height}|null} rect - What is highlighted,
   *   in viewport coordinates, or null when nothing is.
   */
  yieldRailTo(rect) {
    if (!this.rail) return;

    const r = this.rail.getBoundingClientRect();
    if (!r.width || !r.height) return;

    const hits = (a) => a && a.width && a.height &&
      a.left < r.right && a.left + a.width > r.left &&
      a.top < r.bottom && a.top + a.height > r.top;

    // Pointing AT the column brings it fully back rather than fading it: that
    // is when its × is being reached for, and a column at 12% cannot be
    // clicked on purpose. It only stands down for a target behind it that the
    // cursor is somewhere else on.
    const cursorInside =
      this.lastMouseX >= r.left && this.lastMouseX <= r.right &&
      this.lastMouseY >= r.top && this.lastMouseY <= r.bottom;

    // Nothing to get out of the way of while the Collected page is covering
    // the screen — and nothing to put back when it closes, either.
    this.rail.classList.toggle('is-yielding',
      !this.identifyOpen && !cursorInside && hits(rect));
  }

  /**
   * Paints the collected rail — the Collected page's list, compacted.
   *
   * Reads the same queue, so the two can never disagree about what has been
   * taken. Rebuilt wholesale: it is a handful of rows and only changes when
   * one is added or resolves.
   */
  renderRail() {
    if (!this.rail) return;

    const esc = (v) => String(v == null ? '' : v).replace(/[<>&"]/g, (c) => (
      { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
    ));

    const rows = this.queue.map((q) => {
      const thumb = q.thumb
        ? `<img class="decidio-ar-rail-thumb" src="${esc(q.thumb)}" alt="">`
        : '<span class="decidio-ar-rail-thumb"></span>';

      let brand = '';
      let name;
      if (q.state === 'complete') {
        brand = q.brand ? `<span class="decidio-ar-rail-brand">${esc(q.brand)}</span>` : '';
        name = esc(q.title);
      } else if (q.state === 'pending') {
        name = 'Identifying…';
      } else {
        name = 'Not identified';
      }

      return `<div class="decidio-ar-rail-row is-${q.state}">${thumb}
          <span class="decidio-ar-rail-text">${brand}
            <span class="decidio-ar-rail-name">${name}</span>
          </span>
          <button class="decidio-ar-rail-remove" data-id="${q.id}"
                  aria-label="Remove" title="Remove">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9.25"/>
              <line x1="8.8" y1="8.8" x2="15.2" y2="15.2"/>
              <line x1="15.2" y1="8.8" x2="8.8" y2="15.2"/>
            </svg>
          </button>
        </div>`;
    }).join('');

    // :empty hides the whole column, so nothing is written while the queue is
    // empty and the screen stays clear until something has been collected.
    const n = this.queue.length;

    this.rail.innerHTML = rows
      ? `<div class="decidio-ar-rail-head">
           <span>Collected</span>
           <span class="decidio-ar-rail-count">${n} item${n === 1 ? '' : 's'}</span>
         </div>
         <div class="decidio-ar-rail-body">${rows}</div>
         <div class="decidio-ar-rail-foot">
           ${this.saveError ? `<p class="decidio-ar-rail-error">${esc(this.saveError)}</p>` : ''}
           <button class="decidio-ar-rail-done"${this.saving ? ' disabled' : ''}>${
             this.saving ? 'Saving…' : (this.saveError ? 'Try again' : 'Done')}</button>
         </div>`
      : '';

    // Whether the rows outgrew the cap can only be known once they are laid
    // out, so the fade is set from the measurement rather than guessed at.
    const body = this.rail.querySelector('.decidio-ar-rail-body');
    if (body) body.classList.toggle('is-clipped', body.scrollHeight > body.clientHeight + 1);

    // Doubling the Collected page with a smaller copy of itself helps nobody.
    this.rail.classList.toggle('is-hidden', this.identifyOpen);
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
    if (this.rail) this.rail.classList.toggle('is-hidden', this.identifyOpen);
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
    if (this.standDownIfOrphaned()) return;
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
    // Everything, with its state — not just the rows that resolved. A row
    // that failed to identify is still a thing the user framed and meant to
    // keep; dropping it silently lost work. The panel files the resolved ones
    // and parks the rest in that list's queue.
    return this.queue.map((q) => ({
      imageUrl: q.thumb,
      productUrl: q.productUrl,
      productTitle: q.title,
      brand: q.brand || null,
      state: q.state,
      error: q.error || null,
      // The list this was collected FOR, fixed at the moment the overlay
      // opened. Filing used to read the destination off whichever panel
      // happened to pick the batch up — and every tab with Decidio on has a
      // panel, each with its own list selected, so items landed in another
      // tab's list about as often as in this one.
      listId: this.selectedListId || null
    }));
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

      // The page's own name stands in, but the item is not identified by it —
      // so it goes to the list's queue to be finished, rather than into the
      // list under the name of the page it happened to be found on.
      if (entry.borrowedTitle) {
        entry.state = 'failed';
        entry.error = 'Named from the page';
      } else {
        entry.state = 'complete';
      }
    } catch (err) {
      entry.state = 'failed';
      entry.error = err.message;
    }

    this.renderIdentify();
    this.renderRail();
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
    // The count lives in the collected column now; repainting it IS the
    // update. Kept under its old name for the call sites.
    this.renderRail();
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
    // Leaving with nothing collected is a cancel, not an empty save.
    const items = this.identifiedItems();
    if (!items.length) {
      try { chrome.runtime.sendMessage({ action: "DECIDIO_PICKER_CANCELLED" }); } catch (e) {}
      this.stop();
      return;
    }
    if (this.saving) return;            // a second Done while the first is in flight

    /* Saved, or told why not — never neither.

       This used to send the batch and close in the same breath, whether or
       not anything received it. A tab left running an old copy after the
       extension reloaded, a background that was asleep, two tabs filing at
       once: every one of those lost the collect silently, the overlay closed
       as if it had worked, and the list simply did not have the items.

       Now the background files the batch and answers, and only "saved"
       closes the overlay. Anything else — an error, no answer, no connection
       at all — keeps the overlay open with the items still in the column and
       says it could not save, so nothing is ever lost without a word. */
    this.saving = true;
    this.saveError = null;
    this.renderRail();

    let settled = false;
    const fail = (why) => {
      if (settled) return;
      settled = true;
      this.saving = false;
      this.saveError = why;
      this.renderRail();
    };
    const timer = setTimeout(() => fail("Couldn't save — no answer from Decidio."), 6000);

    try {
      chrome.runtime.sendMessage(
        { action: "DECIDIO_SAVE_COLLECTED", listId: this.selectedListId || null, items },
        (reply) => {
          clearTimeout(timer);
          if (settled) return;
          const err = chrome.runtime.lastError;
          if (err || !reply || !reply.ok) {
            // Say what actually went wrong. A blanket "refresh the page" sent
            // people round in circles when the cause was something a refresh
            // could never fix, like storage being full.
            const why = (err && err.message) || (reply && reply.error) || '';
            fail(/quota/i.test(why)
              ? "Couldn't save: Decidio's storage is full."
              : (why ? "Couldn't save: " + why : "Couldn't save. Refresh this page and try again."));
            return;
          }
          settled = true;
          this.saving = false;
          this.stop();
        }
      );
    } catch (e) {
      // Thrown at once when this copy has been cut off from the extension
      // (it was reloaded while this page stayed open).
      clearTimeout(timer);
      fail("Decidio was updated. Refresh this page, then collect again.");
    }
  }
}