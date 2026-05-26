// Overlay container
const overlayRoot = document.createElement('div');
overlayRoot.id = 'decidio-root';

document.body.appendChild(overlayRoot);

let cardLayer = 1;
let isExtensionActive = false;

// Ensures that when user clicks on one of the overlays, it will come to the "front"
function bringToFront(card) {
  cardLayer++;
  card.style.zIndex = cardLayer;
}

// Listen for the message from background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggle_decidio.") {
    isExtensionActive = !isExtensionActive;
    
    if (isExtensionActive) {
      console.log("decidio. is now ACTIVE");
    } else {
      console.log("decidio. is now INACTIVE");
      
      // Clean up any existing card if we turn it off
      const existingCards = document.querySelectorAll('.product-card');
      existingCards.forEach(card => card.remove());
    }
  }
});

document.addEventListener('click', (e) => {
  if (!isExtensionActive) return;

  // Clicks will only affect the extension not website
  e.preventDefault();
  e.stopPropagation();

  // Check if the user is clicking the close button
  if (e.target.classList.contains('close-button')) {
    e.preventDefault();
    e.stopPropagation();
    
    // Find the card container that holds this specific button
    const cardToClose = e.target.closest('.product-card');
    if (cardToClose) cardToClose.remove();
    return;
  }

  // Clicked an existing card, bring it to the "top"
  const clickedCard = e.target.closest('.product-card');
  if (clickedCard) {
    bringToFront(clickedCard);
    return; 
  }

  // Potential block for users to select only X amount of products? Keep?
  // Currently 5 ----------------------------------------------------------
  const activeCards = document.querySelectorAll('.product-card');
  /* Future revision???? */
  if (activeCards.length >= 5) {
    alert("You've reached the maximum limit of 5 product overlays. Close one to add another..");
    return;
  }

  // Define productTitle by grabbing the text of what was clicked
  // Possibility for only products? Not sure if extension can be clicked on anything...
  const productTitle = e.target.innerText ? e.target.innerText.trim() : "Unknown Product";
  if (!productTitle) return;

  // Card container
  const card = document.createElement('div');
  card.className = 'product-card';

  // Calculate position based on mouse click coordinates
  card.style.top = `${e.pageY + 15}px`;
  card.style.left = `${e.pageX - 20}px`;
  bringToFront(card);
  card.innerHTML = `
    <button class="close-button">&times;</button>
    
    <div class="overlay-main">
      <h4 class="title">${productTitle}</h4>
      <p class="desc">AI Summary and facets will be in this space...</p>
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

}, true);