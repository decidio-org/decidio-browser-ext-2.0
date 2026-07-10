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
function createExtenCard(productData) {
  const title = productData.name || productData.title || "Unknown Product";

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
          <div class="loader-text">Gathering insights...</div>
      </div>

      <button class="close-button">&times;</button>

      <div class="overlay-main">
          <h4 class="title">${title}</h4>
          <p class="desc">Product details</p>
          <div class="ai-display-container"></div>
      </div>
      <div class="footer">
          <div class="actions">
              <button class="button" id="btn-add-new">
            <span class="circle-plus"></span>
            New List
        </button>
        <button class="button" id="btn-add-existing">
            <span class="circle-plus"></span>
            Existing List
        </button>
        <button class="button" id="btn-add-recent">
            <span class="circle-plus"></span>
            <span class="recent-list-name">Loading recent...</span>
        </button>
          </div>
          <span class="logo">d.</span>
      </div>
  `;

  // Grab our button elements (for recent list)
  const recentBtn = card.querySelector('#btn-add-recent');
  const recentBtnText = card.querySelector('.recent-list-name');
  const existingBtn = card.querySelector('#btn-add-existing');

  let latestListId = null;
  
  async function setupRecentButton() {
      try {
          const response = await getAllLists();
          const lists = response && response.items;
          
          if (lists && Array.isArray(lists) && lists.length > 0) {
              const latestList = lists[0]; 
              latestListId = latestList.id;

              // Setup and show recent shortcut
              recentBtnText.textContent = latestList.name;
              
              // Trying to fix buttons not aligning with the specs.... ===============================================================
              recentBtn.style.removeAttribute ? recentBtn.style.removeAttribute('display') : recentBtn.style.display = '';
              existingBtn.style.removeAttribute ? existingBtn.style.removeAttribute('display') : existingBtn.style.display = '';

          } else {
              // If they have no lists at all, hide the "Recent List" button entirely
              // Maybe we change this later?? 
              recentBtn.style.display = 'none';
              existingBtn.style.display = 'none';
          }
      } catch (err) {
          console.error("Could not load recent list for button shortcut:", err);
          recentBtn.style.display = 'none';
          existingBtn.style.display = 'none';
      }
  }

  setupRecentButton();

  recentBtn.addEventListener('click', async () => {
      if (!latestListId) return;

      try {
          const productId = card.getAttribute('data-product-id');

          await addItemToList(latestListId, productId);
          
          card.remove();
          alert(`Added to your most recent list: "${recentBtnText.textContent}"!`);
      } catch (err) {
          alert('Failed to add to the recent list.');
          console.error(err);
      }
  });

  // Add to New List process
  card.querySelector('#btn-add-new').addEventListener('click', async () => { 
    const listName = prompt("Enter a name for your new list:");
      if (!listName) return; // Cancelled or empty

      try {
          const productId = card.getAttribute('data-product-id');
        const newList = await createList(listName, "Created from extension"); // Allow function for adding a description ====================
        const listId = newList.id;
          await addItemToList(listId, productId);
          
          // Remove the card
          card.remove();
          alert(`Successfully created "${listName}" and added your item!`);
      } catch (err) {
          alert('Failed to complete the new list process.');
          console.error(err);
      }
  });

  // Add to Existing List process
  card.querySelector('#btn-add-existing').addEventListener('click', async () => {
      try {
          const productId = card.getAttribute('data-product-id');
          // Fetch all available lists from the DB
          const response = await getAllLists();
          const lists = response && response.items;

          // Should we let all the buttons be visible to the user even if there is no lists? ================================================
          if (!lists || lists.length === 0) {
              alert("You don't have any lists yet! Try creating a new one first.");
              return;
          }

          // Build a text menu for the prompt window
          let menuText = "Choose a list number:\n";
          lists.forEach((list, index) => {
              menuText += `${index + 1}. ${list.name}\n`;
          });

          const choice = prompt(menuText);
          if (!choice) return; // User hit cancel

          const chosenIndex = parseInt(choice, 10) - 1;
          
          // Validate choice and grab the corresponding list id
          if (chosenIndex >= 0 && chosenIndex < lists.length) {
              const listId = lists[chosenIndex].id;

              // Reuse addItemToList function
              await addItemToList(listId, productId);

              card.remove();
              alert(`Added to "${lists[chosenIndex].name}"!`);
          } else {
              alert("Invalid selection. Please enter a valid number from the list.");
          }
      } catch (err) {
          alert('Failed to add to existing list');
          console.error(err);
      }
  });

  return card;
}
/**
 * ====================================================
 * UI RENDERING: Build the 1‑2‑3 spec layout
 * ====================================================
 */
async function renderCanonicalSpecs(cardElement, rawJsonPayload) {
  console.log("DATA RECEIVED:", rawJsonPayload);
  
  if (!cardElement || !rawJsonPayload) {
    console.error("decidio: Missing card element or json payload!");
    return;
  }

  // Save the incoming database product ID onto the card element container
  if (rawJsonPayload.id) {
    cardElement.setAttribute('data-product-id', rawJsonPayload.id);
  }

  const displayContainer = cardElement.querySelector('.ai-display-container') || cardElement;
  displayContainer.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'decidio-spec-block-wrapper';
  wrapper.style.cssText = 'width: 100%; display: flex; flex-direction: column; gap: 12px;';
  displayContainer.appendChild(wrapper);

  // Extract top-level fields
  const category = rawJsonPayload.product_type || "—";
  const name = rawJsonPayload.name || "—";

  const priceObj = rawJsonPayload.price || {};
  const priceAmount = priceObj.amount || 0;
  const priceCurrency = priceObj.currency || 'USD';
  const formattedPrice = priceAmount > 0 
    ? `${priceCurrency === 'USD' ? '$' : priceCurrency + ' '}${priceAmount}` 
    : "—";

  // Map dynamic backend raw_specs to custom layout array
  const rawSpecsMap = rawJsonPayload.raw_specs || {};
  // Collect all other specs except Price
  const otherSpecs = Object.entries(rawSpecsMap)
    .map(([key, val]) => ({
      label: key,
      val: Array.isArray(val) ? val.join(", ") : String(val)
    }));

  // Fill remaining 5 slots (1‑2‑3 layout = 6 total)
  let slots = [
    {label: "Price", val: formattedPrice}, // Row 1
    ...otherSpecs                          // Row 2 + Row 3 (5 cells)
  ];

  while (slots.length < 6) {
    slots.push({ label: " ", val: " " }); // Safely fills missing specs if the scraper comes up short
  }
  
  // Cut off any overflow specs beyond the 4 allowed
  slots = slots.slice(0, 6);

  renderSpecGroup(wrapper, slots);

  cardElement.classList.remove('is-loading');
  
  const loader = cardElement.querySelector('.card-loader');
  if (loader) loader.style.display = 'none';
  
  if (name) {
    const titleElement = cardElement.querySelector('.title');
    if (titleElement) titleElement.textContent = name;
  }
    
    // Reveal the card elements
    cardElement.classList.add('loaded');
  }


/**
 * ====================================================
 * Render the 1‑2‑3 grid layout
 * ====================================================
 */
function renderSpecGroup(parentWrapper, items) {
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