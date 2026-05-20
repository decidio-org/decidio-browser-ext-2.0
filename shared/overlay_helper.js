// This runs the moment the extension is opened
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

    // Once everything has loaded, now send the product data
    window.parent.postMessage({ type: "OVERLAY_READY  "}, "*");
});

/*
* The const USE_MOCK_FILE will be used to similate the AI's JSON output.
* To prevent the usage of tokens for prompting the AI, this will make it 
* easier to test formating issues with how the table with the product specs
* will appear
*/

const USE_MOCK_FILE = true; // Setting this to false will allow you to use the AI

window.addEventListener("message", async (event) => {
  if (event.data.type === "PRODUCT_DATA") {
    const data = event.data.data;
    
    const loader = document.getElementById('loader');
    const aiDisplay = document.getElementById('aiDisplay');
    const selectionArea = document.getElementById('selectionArea');
    const addBtn = document.getElementById('addToListBtn');

    loader.style.display = 'flex';
    aiDisplay.innerHTML = ""; // Clear old content

    try {

      let aiResult;

      if (USE_MOCK_FILE) {
        // 1. Get the path for the sample.json file
        const mockFileUrl = chrome.runtime.getURL('sample.json');
        // 2. Fetch it locally
        const response = await fetch(mockFileUrl);
        aiResult = await response.json();

        // Artificial delay to test if the "loading" layout is working correctly
        await new Promise(resolve => setTimeout(resolve, 600));

      } else {
        // Original functionality with the Gemini AI
        // 1. Send the scraped specs to your Python AI server
        const response = await fetch(`http://localhost:8000/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            html_content: data.html_content
          })
        });

        aiResult = await response.json();
      }

      loader.style.display = 'none';

      // 2. Setup the Add Button
      if (addBtn) {
        addBtn.onclick = () => {
          alert(`Added ${aiResult.Name || data.product_name} to your Decidio list!`);
        };
      }

      /* // 3. Trigger the typing animation with the AI's response
      // aiResult.analysis should be the summary text returned by server.py
      typeEffect(aiDisplay, aiResult.description_summary, () => {
          setupSelectionArea(data, selectionArea);
      }); */

      // From here, we extract the "Specs" object from the JSON and build the table for the extention
      if (aiResult.Specs) {
        renderSpecsTable(aiDisplay, aiResult.Specs);
      } else {
        aiDisplay.innerHTML = "<p style='color: #666; '>No specifications found in JSON structure.</p>";
      }

      // If keeping the dropdown menu for colors or user confirmation, add line to trigger the function

    } catch (err) {
        console.error(err);
        aiDisplay.innerHTML = "<span class='fade-char' style='color: #ff4d4d;'>Error loading data. Check developer tools</span>";
        loader.style.display = 'none';
    }
  }
});

/**
 * The renderSpecsTable function
 * 
 * This function dynamically builds a specifications table from a structured JSON object
 */
function renderSpecsTable(containerElement, specsObject) {
  const table = document.createElement('table');

  // Formating the table:
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.marginTop = '10px' // Placeholder for later changes.....
  table.style.fontFamily = 'Arial, sans-serif'; //Placeholder for true font....

  for (const [specType, valueArray] of Object.entries(specsObject)) {
    const row = document.createElement('tr');

    row.style.borderBottom = '1px solid #eee'; // Border thickness

    // Left Cell: Spec type (Bold)
    const typeCell = document.createElement('td');

    typeCell.style.padding = '8px 4px';
    typeCell.style.fontWeight = 'bold';
    typeCell.style.verticalAlign = 'top';
    typeCell.style.width = '45%';
    typeCell.textContent = specType;

    // Right Cell: Value
    const valueCell = document.createElement('td');

    valueCell.style.padding = '8px 4px';
    valueCell.style.verticalAlign = 'top';
    valueCell.style.width = '55%';

    // "Flatten" array values into strings
    valueCell.textContent = Array.isArray(valueArray) ? valueArray.join(', ') : valueArray;

    row.appendChild(typeCell);
    row.appendChild(valueCell);
    table.appendChild(row);
  }

  containerElement.appendChild(table);
}


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
        span.className = "fade-char"; // Linked to the CSS in overlay.html
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
 * 
 * -------------- CURRENTLY NOT BEING USED IN THIS TESTING --------------
 * 
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
 * 
 * -- NOTE: --------------------------------------------------------
 *  This may need to be fixed later to the following logic?
 *  
 *  If the product is something not in the database, then
 *  we save the JSON to the database. 
 */
function downloadJson(obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `harmonized_${obj.product_name?.replace(/\s+/g, '_') || 'product'}.json`;
  a.click();
}
