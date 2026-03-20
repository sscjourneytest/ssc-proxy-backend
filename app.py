import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from playwright.sync_api import sync_playwright

app = Flask(__name__)
CORS(app)

def fetch_with_fallback(url):
    with sync_playwright() as p:
        # Launch a real browser in the background
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = context.new_page()
        
        try:
            # wait_until="networkidle" makes the backend wait for all images to finish loading
            page.goto(url, wait_until="networkidle", timeout=60000)
            content = page.content()
            browser.close()
            return content
        except Exception as e:
            browser.close()
            return str(e)

@app.route('/get-source')
def get_source():
    target_url = request.args.get('url')
    if not target_url:
        return jsonify({"error": "No URL provided"}), 400
    
    source_code = fetch_with_fallback(target_url)
    
    if "Timeout" in source_code or "Error" in source_code:
        return jsonify({"error": "SSC site is too slow or link is wrong", "details": source_code}), 500
    
    return jsonify({"source": source_code})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
