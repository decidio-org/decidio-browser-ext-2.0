// This runs the moment the side panel is opened
document.addEventListener("DOMContentLoaded", () => {
  const card = document.querySelector('.card');
  const aiDisplay = document.getElementById('aiDisplay');
  const showLessBtn = document.getElementById('showLessBtn');
  const scrollTopBtn = document.getElementById('scrollTopBtn');

// Exit Logic
    document.getElementById('exitBtn').onclick = () => {
        window.parent.postMessage("CLOSE_OVERLAY", "*");
    };

    // Mini mode
    showLessBtn.onclick = (e) => {
        e.stopPropagation(); 
        card.classList.add('mini-mode');
    };

    // Expand when clicking the bubble
    card.onclick = () => {
        if (card.classList.contains('mini-mode')) {
            card.classList.remove('mini-mode');
        }
    };

    // Monitor the AI Display for scrolling
    aiDisplay.onscroll = () => {
        if (aiDisplay.scrollTop > 100) {
            scrollTopBtn.style.display = "flex";
        } else {
            scrollTopBtn.style.display = "none";
        }
    };

    // Smooth scroll back to start
    scrollTopBtn.onclick = () => {
        aiDisplay.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Future menu
    document.getElementById('menuBtn').onclick = () => {
        alert('Menu logic goes here!');
    };

    // Close on background click
    window.onclick = (event) => {
        if (event.target === document.body) {
            window.parent.postMessage("CLOSE_OVERLAY", "*");
        }
    };
});

window.addEventListener("message", async (event) => {
  if (event.data.type === "PRODUCT_DATA") {
    const data = event.data.data;
    
    const loader = document.getElementById('loader');
    const aiDisplay = document.getElementById('aiDisplay');
    const selectionArea = document.getElementById('selectionArea');
    const addBtn = document.getElementById('addToListBtn');

    loader.style.display = 'flex';
    aiDisplay.innerHTML = ""; // Clear old text

    try {
      // 1. Send the scraped specs to your Python AI server
      const response = await fetch(`http://localhost:8000/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html_content: data.html_content
        })
      });

      const aiResult = await response.json();
      loader.style.display = 'none';

      // 2. Setup the Add Button
      if (addBtn) {
        addBtn.onclick = () => {
          alert(`Added ${data.product_name} to your list!`);
        };
      }

      // 3. Trigger the typing animation with the AI's response
      // aiResult.analysis should be the summary text returned by server.py
      typeEffect(aiDisplay, aiResult.description_summary, () => {
          setupSelectionArea(data, selectionArea);
      });

    } catch (err) {
        console.error(err);
        aiDisplay.innerHTML = "<span class='fade-char' style='color: #ff4d4d;'>AI Analysis Error. check chrome developer</span>";
        loader.style.display = 'none';
    }
  }
});

/**
 * Creates a "Fade-In" typing effect by wrapping every letter in a span
 */
function typeEffect(element, text, callback, speed = 25) {
  element.innerHTML = "";
  let i = 0;

  function typing() {
    if (i < text.length) {
      const char = text.charAt(i);
      const span = document.createElement("span");
      
      if (char === "\n") {
        element.appendChild(document.createElement("br"));
      } else {
        span.textContent = char;
        span.className = "fade-char"; // Linked to the CSS in panel.html
        element.appendChild(span);
      }
      element.scrollTop = element.scrollHeight;
      
      i++;
      setTimeout(typing, speed);
    } else if (callback) {
      setTimeout(callback, 400); // Slight pause before dropdowns appear
    }
  }
  typing();
}

/**
 * Populates dropdowns and handles the Save button
 */
function setupSelectionArea(data, selectionArea) {
    const colorDrop = document.getElementById('colorDropdown');
    const accentDrop = document.getElementById('accentDropdown');
    
    // Fill Color Dropdown
    colorDrop.innerHTML = '';
    const colors = data.specifications?.colors || ["No colors found"];
    colors.forEach(color => {
      let opt = document.createElement('option');
      opt.value = color; opt.innerHTML = color;
      colorDrop.appendChild(opt);
    });

    // Fill Accent Dropdown
    accentDrop.innerHTML = '';
    const foundAccent = data.specifications?.accents || "None";
    let accentOpt = document.createElement('option');
    accentOpt.value = foundAccent; accentOpt.innerHTML = foundAccent;
    accentDrop.appendChild(accentOpt);

    // Fade the whole area in
    selectionArea.style.display = 'block';

    document.getElementById('confirmBtn').onclick = () => {
        const finalData = {
            ...data,
            confirmed_color: colorDrop.value,
            confirmed_accent: accentDrop.value,
            timestamp: new Date().toISOString()
        };
        downloadJson(finalData);
    };
}

/**
 * Downloads the final harmonized file
 */
function downloadJson(obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `harmonized_${obj.product_name?.replace(/\s+/g, '_') || 'product'}.json`;
  a.click();
}