from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# Enable CORS so extension can talk to localhost:8000
CORS(app)

@app.route('/classify', methods=['POST'])
def classify_product():
    data = request.json
    print("\n--- [BACKEND LOG] CLASSIFY ENDPOINT HIT ---")
    print(f"Product Name: {data.get('name')}")

    # Extract the text the extension sent over
    scraped_text = data.get('raw_webpage_text', '')
    print(f"Scraped Text Length: {len(scraped_text)} characters")
    
    # Prints the actual text to the terminal
    print("\n--- VISIBLE TEXT CAPTURED BY EXTENSION ---")
    print(scraped_text[:1000]) # Prints the first 1000 characters
    print("-------------------------------------------\n")
    
    # Save it to a file so you can copy/paste it into ai manually
    # I feel like this would make testing easier without spending gemini tokens (yet)
    with open("scraped_dump.txt", "w", encoding="utf-8") as f:
        f.write(scraped_text)
        
    print("Saved raw text to 'scraped_dump.txt'!")

    # We will pretend it's a known product type to trigger the harmonizer next
    return jsonify({"product_type": "laptop"})

@app.route('/harmonize', methods=['POST'])
def harmonize_product():
    data = request.json
    print("\n--- [BACKEND LOG] HARMONIZE ENDPOINT HIT ---")
    
    # Here is the layout components.js expects
    # Price is wrapped in an array [ ] so .join() won't crash.
    mock_canonical_response = {
        "Category": "Laptop",
        "Name": f"Harmonized: {data.get('name')}",
        "Specs": {
            "Price": ["$1,299.00"],
            "Processor": "Apple M3 Chip",
            "Memory": "16GB Unified RAM",
            "Storage": "512GB SSD",
            "Display": "14.2-inch Liquid Retina"
        }
    }
    return jsonify(mock_canonical_response)

if __name__ == '__main__':
    print("Starting decidio mock backend on http://localhost:8000...")
    app.run(port=8000, debug=True)