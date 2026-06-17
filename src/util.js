/**
 * =========================================
 * Utility Helpers
 * =========================================
 */

/**
 * Keep cards strictly within the visible viewport bounds. This prevents the cards
 * from being unreachable.
 */
function positionCardSafely(card, targetX, targetY, isFixedMode = false) {
  const cardWidth = 280;
  const cardHeight = 280;
  const padding = 16;     // Safe boundary padding from viewport edges

  let maxX, maxY;

  if (isFixedMode) {
    // Lock inside the visible browser window boundaries
    card.style.position = 'fixed';
    maxX = window.innerWidth - cardWidth - padding;
    maxY = window.innerHeight - cardHeight - padding;
  } else {
    // Lock inside the entire scrollable document content height/width
    card.style.position = 'absolute';
    maxX = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - cardWidth - padding;
    maxY = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - cardHeight - padding;
  }

  // Clamp coordinates safely within layout extremes
  let safeX = Math.max(padding, Math.min(targetX, maxX));
  let safeY = Math.max(padding, Math.min(targetY, maxY));

  card.style.left = `${safeX}px`;
  card.style.top = `${safeY}px`;
  card.style.right = 'auto';  
  card.style.bottom = 'auto';
}