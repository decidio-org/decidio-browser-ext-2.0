/**
 * ============================================
 * components.js includes the extension card.
 * If any changes are needed to the appearance of the
 * card or buttons this is the place...
 * ===========================================
 */

if (typeof getActiveDriver === 'undefined') {
    console.error('decidio: drivers.js not loaded yet');
  }
  let cardLayer = 1000; // Tracks z-index layer so the newest clicked product card stays on top
  
  // Increment and apply z-index so clicked cards stack
  function bringToFront(card) {
    cardLayer++;
    card.style.zIndex = cardLayer;
  }
  
  /**
   * Generates the extension card
   */
  function createExtenCard(title) {
    const card = document.createElement('article'); 
    card.setAttribute('role', 'dialog');            
    card.setAttribute('aria-label', `Product details: ${title}`); 
    card.setAttribute('aria-modal', 'true'); 
  
    // We add 'is-loading' by default so it spins immediately upon creation.
    card.className = 'product-card is-loading';
  
    bringToFront(card);
  
    // The structure of the card including the 12 blade spans
    card.innerHTML = `
        <div class="card-loader">
            <div class="blade-spinner">
                <span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span>
            </div>
            <div class="loader-text">Analyzing specs with decidio. Intelligence...</div>
        </div>
  
        <button class="close-button">&times;</button>
  
        <div class="overlay-main">
            <h4 class="title">${title}</h4>
            <p class="desc">Product details</p>
            <div class="ai-display-container"></div>
        </div>
  
        <div class="footer">
            <div class="actions">
                <button class="button">Add Recent</button>
                <button class="button">Add New</button>
                <button class="button">Add to Existing</button>
            </div>
            <span class="logo">d.</span>
        </div>
    `;
  
    return card;
  }
  /**
   * ====================================================
   * UI RENDERING: Build the 1‑2‑3 spec layout
   * ====================================================
   */
  async function renderCanonicalSpecs(containerElement, rawJsonPayload) {
    console.log("DATA RECEIVED:", rawJsonPayload);
  
    containerElement.innerHTML = '';
  
    const wrapper = document.createElement('div');
    wrapper.className = 'decidio-spec-block-wrapper';
    wrapper.style.cssText = 'width: 100%; display: flex; flex-direction: column; gap: 12px;';
    containerElement.appendChild(wrapper);
  
    // Extract top-level fields
    const category = rawJsonPayload.Category || "—";
    const name = rawJsonPayload.Name || "—";
  
    // Extract specs from the Specs object
    const specsObj = rawJsonPayload.Specs || {};
  
    // Price is special, always at the second row 1st element
    const price = specsObj.Price ? specsObj.Price.join(", ") : "—";
  
    // Collect all other specs except Price
    const otherSpecs = Object.entries(specsObj)
      .filter(([key]) => key !== "Price")
      .map(([key, val]) => ({
        label: key,
        val: Array.isArray(val) ? val.join(", ") : String(val)
      }));
  
    // Fill remaining 5 slots (1‑2‑3 layout = 6 total)
    const slots = [
      { label: "Category", val: category }, // Row 1
      { label: "Price", val: price },       // Row 2 col 1
      ...otherSpecs.slice(0, 4)             // Row 2 col 2 + Row 3 (3 cells)
    ];
  
    renderSpecGroup(wrapper, "Specifications", slots);
  
    const card = containerElement.closest('.product-card');
    if (card) {
      // Hide the loader overlay entirely
      const loader = card.querySelector('.card-loader');
      if (loader) loader.style.display = 'none';
      
      // Reveal the card elements smoothly
      card.classList.add('loaded');
    }
  }
  
  
  /**
   * ====================================================
   * Render the 1‑2‑3 grid layout
   * ====================================================
   */
  function renderSpecGroup(parentWrapper, headerText, items) {
    const grid = document.createElement('div');
    grid.className = 'spec-grid';
    parentWrapper.appendChild(grid);
  
    // Expected layout:
    // Row 1: 1 cell
    // Row 2: 2 cells
    // Row 3: 3 cells
  
    const layout = [1, 2, 3];
    let index = 0;
  
    layout.forEach(rowSize => {
      const row = document.createElement('div');
      row.className = 'spec-row';
  
      console.log("SPECS RECEIVED:", items);
  
  
      for (let i = 0; i < rowSize; i++) {
        const item = items[index];
        if (!item) break;
  
        const cell = document.createElement('div');
        cell.className = 'spec-cell';
  
        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'text-wrapper';
        labelWrapper.setAttribute('title', item.label);
  
        const label = document.createElement('div');
        label.className = 'fade-key';
        label.textContent = item.label;
  
        labelWrapper.appendChild(label);
  
        const valueWrapper = document.createElement('div');
        valueWrapper.className = 'text-wrapper';
        valueWrapper.setAttribute('title', item.val);
  
        const value = document.createElement('div');
        value.className = 'fade-value';
        value.textContent = item.val;
  
        valueWrapper.appendChild(value);
  
        cell.appendChild(labelWrapper);
        cell.appendChild(valueWrapper);
        row.appendChild(cell);
  
        requestAnimationFrame(() => {
          setTimeout(() => {
            label.classList.add('fade-in');
            value.classList.add('fade-in');
          }, index * 40);
        });
  
        index++;
      }
  
      grid.appendChild(row);
    });
  }