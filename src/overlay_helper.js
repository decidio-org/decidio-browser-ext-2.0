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
        await sleep(600);

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

      // Product name heading
      const productName = document.createElement('h2');

      productName.style.margin = '0 0 10px 0';
      productName.style.fontSize = '22px';
      productName.style.fontWeight = 'bold';
      productName.style.fontFamily = 'Arial, sans-serif'; // Placeholder font
      productName.textContent =aiResult.Name;
      aiDisplay.appendChild(productName);

      // Dark line to seperate the section
      aiDisplay.appendChild(createDarkLine());

      // Image Section CURRENTLY A PLACEHOLDER
      const image = document.createElement('div');

      image.style.width = '100%';
      image.style.height = '150px';
      image.style.margin = '15px 0';
      aiDisplay.appendChild(image);
      
      aiDisplay.appendChild(createDarkLine());

      // Description Heading
      const descHeading = document.createElement('h3');

      descHeading.className = 'fade-in';
      descHeading.style.margin = '15px 0 5px 0';
      descHeading.style.fontSize = '20px';
      descHeading.style.fontWeight = 'bold';
      descHeading.style.fontFamily = 'Arial, sans-serif'; // Placeholder font
      descHeading.textContent = 'Description';
      aiDisplay.appendChild(descHeading);

      // Description Text
      const descText = document.createElement('p');

      descText.style.margin = '0 0 15px 0';
      descText.style.fontSize = '16px';
      descText.style.lineHeight = '1.4';
      descText.style.fontFamily = 'Arial, sans-serif'; // Font placeholder
      descText.textContent = aiResult.Description;

      // CSS Line clamping for three lines
      descText.style.display = '-webkit-box';
      descText.style.webkitBoxOrient = 'vertical';
      descText.style.webkitLineClamp = '3';
      descText.style.overflow = 'hidden';
      descText.style.cursor = 'pointer'; // Clickable
      descText.title = "Expand"; // Hovering over triggers this

      // Fade In transition
      descText.style.opacity = '0';
      descText.style.transition = 'opacity 1.5s ease-in-out';

      descText.onclick = () => {
        if (descText.style.webkitLineClamp === '3') {
          // Expand text
          descText.style.webkitLineClamp = 'unset';
          descText.style.cursor = 'default';
        } else {
          // Shrink it back
          descText.style.webkitLineClamp = '3';
          descText.style.cursor = 'pointer';
        }
      };

      aiDisplay.appendChild(descText);

      // Trigger the description fade-in
      requestAnimationFrame(() => {
        descText.style.opacity = '1';
      });

      // Allow description to fade before continuing
      await sleep(1200);
      autoScroll(aiDisplay);

      aiDisplay.appendChild(createDarkLine());

      // Specifications heading
      const specsHeading = document.createElement('h3');

      specsHeading.className = 'fade-in';
      specsHeading.style.margin = '15px 0 10px 0';
      specsHeading.style.fontSize = '20px';
      specsHeading.style.fontWeight = 'bold';
      specsHeading.style.fontFamily = 'Arial, sans-serif'; // Placeholder
      specsHeading.textContent = 'Specifications';
      aiDisplay.appendChild(specsHeading);

      // From here, we extract the "Specs" object from the JSON and build the table for the extention
      if (aiResult.Specs) {
        await renderSpecsTable(aiDisplay, aiResult.Specs);
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
 * Helper function to generate consistent dividing lines
 */
function createDarkLine() {
  const line = document.createElement('hr');

  line.style.border = 'none';
  line.style.borderTop = '2px solid #eee'; // Includes thickness & color
  line.style.marign = '10px 0';

  return line;
}

/**
 * Dynamically builds a specifications table from a structured JSON object
 */
async function renderSpecsTable(containerElement, specsObject) {
  const table = document.createElement('table');

  // Formating the table:
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.marginTop = '0px' // Placeholder for later changes.....
  table.style.fontFamily = 'Arial, sans-serif'; //Placeholder for true font....

  containerElement.appendChild(table);

  // Will use Object.entries which returns an array so we can loop through with an index
  const specsEntries = Object.entries(specsObject);

  for (let i = 0; i < specsEntries.length; i++) {
    const [specType, valueArray] = specsEntries[i];
    const rawVal = Array.isArray(valueArray) ? valueArray.join(', ') : String(valueArray);

    const row = document.createElement('tr');
    row.style.borderBottom = '1px solid #eee'; // Border thickness

    // Left Cell: Spec type (Bold)
    const typeCell = document.createElement('td');

    typeCell.className = 'fade-key';
    typeCell.style.padding = '8px 4px';
    typeCell.style.fontWeight = 'bold';
    typeCell.style.verticalAlign = 'top';
    typeCell.style.width = '45%';
    typeCell.style.textAlign = 'left';

    // Right Cell: Value
    const valueCell = document.createElement('td');

    valueCell.className = 'fade-value';
    valueCell.style.padding = '8px 4px';
    valueCell.style.verticalAlign = 'top';
    valueCell.style.width = '55%';
    valueCell.style.textAlign = 'right';

    row.appendChild(typeCell);
    row.appendChild(valueCell);
    table.appendChild(row);

    await typeTextEffect(typeCell, specType, containerElement);
    await typeTextEffect(valueCell, rawVal, containerElement);
    await sleep(30); // How fast the row comes in
  }
}

/**
 * Character-by-character typewriter loop that scrolls the container element
 */
async function typeTextEffect(element, fullText, scrollContainer) {
  const characters = fullText.split("");
  element.textContent = ""; // Clear initial text layout space

  for (const char of characters) {
    element.textContent += char;
    autoScroll(scrollContainer);
    await sleep(15); // Speed adjustments (lower is faster typing)
  }
}

/**
 * Ensures scrolling updates smoothly downward as elements inject content.
 * If the user scrolls up, the auto scroll stops. The auto scroll will resume
 * if the user scrolls back down. The words will continue to fade in regardless.
 */
function autoScroll(container) {
  if (!container) return;

  // Accounts for padding and font heights
  const threshold = 50; 
  const totalHeight = container.scrollHeight;
  const visibleHeight = container.clientHeight;
  const currentScrollTop = container.scrollTop;
  // Checks if the user is actively watching the bottom edge
  const isAtBottom = (totalHeight - visibleHeight - currentScrollTop) <= threshold;

  // Only moves the camera view if the user is at the bottom.
  // If false, the loop keeps typing text below, but leaves the user's view alone.
  if (isAtBottom) {
    container.scrollTop = totalHeight;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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