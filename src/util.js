/**
 * util.js
 * 
 * Contains shared utility functions used across the extension context.
 */

/**
 * Renders, updates, or removes a numeric badge on a specified DOM element.
 * Handles positioning constraints on the parent element to ensure accurate relative placement.
 * 
 * @param {HTMLElement} targetElement - The parent container/button to attach the badge to.
 * @param {number} count - The integer value to display on the badge. If <= 0, existing badge is removed.
 */
function renderBadgeCount(targetElement, count) {
  // Guard clause: abort if target element is null or undefined
  if (!targetElement) return;

  // Search for an existing badge child element within the target
  let badge = targetElement.querySelector('.decidio-badge-count');

  if (count > 0) {
    // Ensure parent element allows relative positioning so badge anchors correctly
    const currentPos = window.getComputedStyle(targetElement).position;
    if (currentPos === 'static') {
      targetElement.style.position = 'relative';
    }
    
    // Prevent parent clipping from cutting off badge overflow at borders
    targetElement.style.overflow = 'visible';

    // Build and insert badge element if it doesn't already exist
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'decidio-badge-count';
      
      // Inline styling for badge appearance, layering, and alignment
      badge.style.cssText = `
        position: absolute;
        top: -10px;
        right: -10px;
        background-color: #B8363D;
        color: #ffffff;
        border-radius: 50%;
        font-size: 13px;
        font-weight: 800;
        min-width: 26px;
        height: 26px;
        padding: 0 4px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647; /* Ensure badge displays over parent content */
        pointer-events: none; /* Ignore click events to let parent handle them */
        line-height: 1;
        font-family: Arial, sans-serif;
      `;
      targetElement.appendChild(badge);
    }
    
    // Update badge display count
    badge.textContent = String(count);
  } else if (badge) {
    // Clean up badge from DOM when count falls to 0 or below
    badge.remove();
  }
}