/**
 * util.js
 * 
 * Contains any shared utility functions used across extension
 */

/**
 * This function renders or removes a numeric badge on the decidio
 * toggle button
 */
function renderBadgeCount(targetElement, count) {
  if (!targetElement) return;

  let badge = targetElement.querySelector('.decidio-badge-count');

  if (count > 0) {
    const currentPos = window.getComputedStyle(targetElement).position;
    if (currentPos === 'static') {
      targetElement.style.position = 'relative';
    }
    targetElement.style.overflow = 'visible';

    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'decidio-badge-count';
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
        z-index: 2147483647;
        pointer-events: none;
        line-height: 1;
        font-family: Arial, sans-serif;
      `;
      targetElement.appendChild(badge);
    }
    badge.textContent = String(count);
  } else if (badge) {
    badge.remove();
  }
}