import json
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# Enable CORS so extension can talk to localhost:8000
CORS(app)

# This section needs review.......
@app.route('/classify', methods=['POST'])
def classify_product():
    data = request.json
    print("\n--- [BACKEND LOG] CLASSIFY ENDPOINT HIT ---")
    print(f"Product Name: {data.get('name')}")
    print(f"Product URL: {data.get('url')}")

    # Pull variables out safely with fallbacks
    url = data.get('url')
    images = data.get('images', [])
    name = data.get('name')
    brand = data.get('brand') or ""  # Extracted if provided, otherwise empty
    price_obj = data.get('price', { "amount": 0.0, "currency": "USD" })
    raw_specs = data.get('raw_specs', {})
    raw_features = data.get('raw_features', [])

    # Construct the JSON structure
    json_dump_payload = {
        "url": url,
        "images": images,
        "product_type": "clothing",  # Or whatever classification
        "name": name,
        "brand": brand,
        "price": price_obj,
        "raw_specs": raw_specs,
        "raw_features": raw_features
    }

    # Save it into a JSON file
    with open("scraped_dump.json", "w", encoding="utf-8") as f:
        json.dump(json_dump_payload, f, indent=2, ensure_ascii=False)

    # Return "clothing" so types line up
    return jsonify({"product_type": "clothing", "confidence": 0.98})


# I believe this whole section can be deleted....
@app.route('/harmonize', methods=['POST'])
def harmonize_product():
    data = request.json
    print("\n--- [BACKEND LOG] HARMONIZE ENDPOINT HIT ---")
    print(f"Processing payload for product type: {data.get('product_type')}")
    
    # Here is the layout that is expected
    mock_canonical_response = {
        "product_type": data.get('product_type', 'clothing'),
        "attributes": {
            "Brand":            { "value": data.get('brand') or "PacSun", "tier": "required" },
            "Model":            { "value": data.get('name'), "tier": "required" },
            "Price":            { "value": data.get('price'), "tier": "required" }, # Matches the {amount, currency} object shape
            "Processor":        { "value": "N/A", "raw_value": "N/A", "tier": "optional" },
            "Memory":           { "value": "N/A", "raw_value": "N/A", "tier": "optional" },
            "Storage":          { "value": "N/A", "raw_value": "N/A", "tier": "optional" }
        },
        "missing_required": [] 
    }
    print("Sending official schema payload back to extension.")
    return jsonify(mock_canonical_response)

if __name__ == '__main__':
    print("Starting decidio mock backend on http://localhost:8000...")
    app.run(port=8000, debug=True)