// Overlay container
const overlayRoot = document.createElement('div');
overlayRoot.id = 'decidio-root';
document.body.appendChild(overlayRoot);

// Create both the hover text badge and the trailing box
const hoverBadge = document.createElement('div');
hoverBadge.className = 'decidio-hover-badge';
hoverBadge.innerText = 'decidio.';
document.body.appendChild(hoverBadge);

const hoverBox = document.createElement('div');
hoverBox.className = 'decidio-hover-box'; 
document.body.appendChild(hoverBox);

// For the heading area with the search bar
const globalVisualStyle = document.createElement('style');
globalVisualStyle.id = 'decidio-global-visuals';
globalVisualStyle.textContent = ``;
document.head.appendChild(globalVisualStyle);

let cardLayer = 1;
let isExtensionActive = false;

function bringToFront(card) {
  cardLayer++;
  card.style.zIndex = cardLayer;
}

function isElementBlocked(element) {
  if (!element || !isExtensionActive) return false;
  
  // Won't block extension cards, target product cards, or listing details
  if (
    element.closest('#decidio-root') || 
    element.closest('.product-card') || 
    element.closest('.product-card-container') ||
    element.closest('.s-result-item') ||            // Amazon search results
    element.closest('[data-component-type="s-search-result"]') || // Amazon listing pattern
    element.closest('[class*="ListItem-c11n"]') ||   // Zillow listing items
    element.closest('article')                       // Broad article card wrapper
  ) {
    return false;
  }

  // Check exact element properties
  const tagName = element.tagName;
  const type = (element.getAttribute('type') || '').toLowerCase();
  const role = (element.getAttribute('role') || '').toLowerCase();
  const name = (element.getAttribute('name') || '').toLowerCase();
  const id = (element.id || '').toLowerCase();
  const className = (typeof element.className === 'string' ? element.className : '').toLowerCase();

  const searchPatterns = ['search', 'query', 'sq', 'keyword', 'nav-search', 'searchbox'];
  const filterPatterns = ['filter', 'facet', 'sort', 'refinement', 'dropdown', 's-messaging', 'filter-container'];

  if (tagName === 'INPUT' && (type === 'search' || type === 'text' && searchPatterns.some(p => name.includes(p) || id.includes(p) || className.includes(p)))) {
    return true;
  }

  if (role === 'search' || role === 'combobox' || type === 'submit') {
    if (searchPatterns.some(p => id.includes(p) || className.includes(p))) return true;
  }

  // Climb up parent hierarchy to catch layout sections without catching whole page grids
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const pTagName = parent.tagName;
    const pId = (parent.id || '').toLowerCase();
    const pClass = (typeof parent.className === 'string' ? parent.className : '').toLowerCase();
    const pRole = (parent.getAttribute('role') || '').toLowerCase();

    // Catch Top Menus & Site Headers
    if (pTagName === 'HEADER' || pTagName === 'NAV' || pRole === 'navigation' || pRole === 'menubar' || pId.includes('nav') || pClass.includes('nav') || pClass.includes('header')) {
      return true;
    }
    // Catch Sidebars/Filter zones
    if (pTagName === 'ASIDE' || pId.includes('sidebar') || pId.includes('filter') || pClass.includes('sidebar') || pClass.includes('filter') || pClass.includes('search-page-filter')) {
      return true;
    }

    parent = parent.parentElement;
  }

  return false;
}

// Visual layout painter to toggle styles when activated
function toggleVisualLocks(apply) {
  const elements = document.querySelectorAll('header, nav, aside, [role="search"], #navbar, #nav-belt, .search-wrapper, [class*="sidebar"], [class*="filter"]');
  elements.forEach(el => {
    if (apply) {
      if (!el.closest('.s-result-item, [class*="ListItem-c11n"], .product-card-container')) {
        el.classList.add('decidio-locked');
      }
    } else {
      el.classList.remove('decidio-locked');
    }
  });
}

// Listen for the message from background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggle_decidio.") {
    isExtensionActive = !isExtensionActive;
    
    if (isExtensionActive) {
      console.log("decidio. is now ACTIVE");
      toggleVisualLocks(true);
    } else {
      console.log("decidio. is now INACTIVE");
      const existingCards = document.querySelectorAll('.product-card');
      existingCards.forEach(card => card.remove());
      
      hoverBadge.classList.remove('visible');
      hoverBox.classList.remove('visible');
      toggleVisualLocks(false);
    }
  }
});

// Hover badge & trailing rectangle logic
document.addEventListener('mousemove', (e) => {
  if (!isExtensionActive) return;

  if (e.target.closest('.product-card') || e.target.closest('#decidio-root') || e.target.closest('.decidio-hover-badge')) {
    hoverBadge.classList.remove('visible');
    hoverBox.classList.remove('visible');
    return;
  }

  // If hovering over an explicitly blocked layout area, hide extension indicators
  if (isElementBlocked(e.target)) {
    hoverBadge.classList.remove('visible');
    hoverBox.classList.remove('visible');
    return;
  }

  // Look for target clickable items
  const clickableCard = e.target.closest('a, .product-card-container, .s-result-item, [class*="ListItem-c11n"], [role="button"]');
  const hasText = e.target.innerText && e.target.innerText.trim().length > 0;

  if (clickableCard && hasText) {
    const rect = clickableCard.getBoundingClientRect();

    hoverBox.classList.add('visible');
    hoverBox.style.width = `${rect.width}px`;
    hoverBox.style.height = `${rect.height}px`;
    hoverBox.style.left = `${rect.left + window.scrollX}px`;
    hoverBox.style.top = `${rect.top + window.scrollY}px`;

    hoverBadge.classList.add('visible');
    hoverBadge.style.left = `${e.clientX + 15}px`; 
    hoverBadge.style.top = `${e.clientY + 15}px`;
  } else {
    hoverBadge.classList.remove('visible');
    hoverBox.classList.remove('visible');
  }
});

document.addEventListener('mouseleave', () => {
  hoverBadge.classList.remove('visible');
  hoverBox.classList.remove('visible');
});

document.addEventListener('mousedown', (e) => {
  if (!isExtensionActive) return;

  if (isElementBlocked(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    console.log("decidio. blocked mousedown event:", e.target);
  }
}, true);

// Clicking logic
document.addEventListener('click', (e) => {
  if (!isExtensionActive) return;

  // Stop searches and filtering
  if (isElementBlocked(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    console.log("decidio. blocked a navigation step:", e.target);
    return;
  }

  if (e.target.classList.contains('close-button')) {
    e.preventDefault();
    e.stopPropagation();
    const cardToClose = e.target.closest('.product-card');
    if (cardToClose) cardToClose.remove();
    return;
  }

  const clickedCard = e.target.closest('.product-card');
  if (clickedCard) {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(clickedCard);
    return; 
  }

  if (e.target.classList.contains('decidio-hover-badge') || e.target.closest('.decidio-hover-box')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Allow clicks to pass through freely to generate cards if it's a structural item match
  const isProductCard = e.target.closest('a, .product-card-container, .s-result-item, [class*="ListItem-c11n"]');
  if (!isProductCard) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const activeCards = document.querySelectorAll('.product-card');
  if (activeCards.length >= 5) {
    alert("You've reached the maximum limit of 5 product overlays. Close one to add another..");
    return;
  }

  const productTitle = e.target.innerText ? e.target.innerText.trim() : "Unknown Product";
  if (!productTitle) return;

  const card = document.createElement('div');
  card.className = 'product-card';
  card.style.top = `${e.pageY + 15}px`;
  card.style.left = `${e.pageX - 20}px`;
  bringToFront(card);
  card.innerHTML = `
    <button class="close-button">&times;</button>
    <div class="overlay-main">
      <h4 class="title">${productTitle}</h4>
      <p class="desc">Placeholder for future text here</p>
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

  document.body.appendChild(card);
  
  hoverBadge.classList.remove('visible');
  hoverBox.classList.remove('visible');

}, true);

// Keeps search fields unclickable when browser is active
document.addEventListener('keydown', (e) => {
  if (isElementBlocked(e.target)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);
// If user tabs into the search bar via keyboard, stop it
document.addEventListener('focusin', (e) => {
  if (!isExtensionActive) return;

  if (isElementBlocked(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    e.target.blur();
    console.log("decidio. deflected focus from search bar.");
  }
}, true);