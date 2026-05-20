let overlayContainer = null;

// content.js
function scrapeDetailedSpecs() {
  // Grab common spec containers (tables and lists)
  const specElements = document.querySelectorAll('table, ul, .specs, #detailBullets_feature_div');
  let rawSpecs = "";

  specElements.forEach(el => {
      rawSpecs += el.innerText + "\n";
  });

  // If no tables found, grab the main product container text
  if (rawSpecs.length < 100) {
      rawSpecs = document.querySelector('body')?.innerText.slice(0, 5000); 
  }

  return {
      html_content: rawSpecs
  };
}


chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "TOGGLE_OVERLAY") {
    if (!overlayContainer) {
      // Create the container
      overlayContainer = document.createElement('div');
      overlayContainer.id = "decidio-root";
      
      // Style the container to cover the whole screen
      Object.assign(overlayContainer.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '2147483647', // Ensure it stays on top
        border: 'none',
        display: 'block'
      });

      // Create the iframe to hold your overlay.html
      const iframe = document.createElement('iframe');
      iframe.src = chrome.runtime.getURL("overlay.html");

      /**
       * We now wait for the iframe to ask for the data. Prevents issues with the helper file not 
       * loading in time before the data gets to it.
       */
      /* iframe.onload = () => {
        iframe.contentWindow.postMessage({ 
            type: "PRODUCT_DATA", 
            data: scrapeDetailedSpecs() 
        }, "*");
      }; */
      

      Object.assign(iframe.style, {
        width: '100%',
        height: '100%',
        border: 'none',
        background: 'transparent'
      });

      overlayContainer.appendChild(iframe);
      document.body.appendChild(overlayContainer);
    } else {
      // Toggle visibility if it already exists
      const isHidden = overlayContainer.style.display === 'none';
      overlayContainer.style.display = isHidden ? 'block' : 'none';
      
      // If user goes to different screen, reset
      if (isHidden) {
        const existingIframe = overlayContainer.querySelector('iframe');
        existingIframe.contentWindow.postMessage({ 
            type: "PRODUCT_DATA", 
            data: scrapeDetailedSpecs() 
        }, "*");
    }
    }
  }
});

// Listen for a "Close" message from the iframe
window.addEventListener("message", (event) => {
  if (event.data === "CLOSE_OVERLAY" && overlayContainer) {
    overlayContainer.style.display = 'none';
  }

  // NEW LOGIC: Listen for the overlay to be ready, then send over product data 
  if (event.data.type == "OVERLAY_READY" && overlayContainer) {
    const iframe = overlayContainer.querySelector('iframe');

    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: "PRODUCT_DATA",
        data: scrapeDetailedSpecs()
      }, "*");
    }
  }
});