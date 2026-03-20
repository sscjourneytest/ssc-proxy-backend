import os
import urllib.parse
from flask import Flask, request, jsonify
from flask_cors import CORS
from playwright.sync_api import sync_playwright

app = Flask(__name__)
CORS(app)

def fetch_ssc_source(raw_url):
    # Fix 1: Decode the URL in case it was double-encoded by the browser
    url = urllib.parse.unquote(raw_url)
    
    # Fix 2: Force correct protocol format
    if "http//" in url: url = url.replace("http//", "http://")
    if "https//" in url: url = url.replace("https//", "https://")

    with sync_playwright() as p:
        try:
            # Fix 3: Launch with specific arguments for Railway/Linux
            browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox'])
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            )
            page = context.new_page()
            
            # Wait for the page to load (60s timeout)
            # 'networkidle' ensures images are loaded
            response = page.goto(url, wait_until="networkidle", timeout=60000)
            
            if not response or response.status != 200:
                return f"Error: SSC Server returned status {response.status if response else 'No Response'}"

            html_content = page.content()
            browser.close()
            return html_content
        except Exception as e:
            if 'browser' in locals(): browser.close()
            return f"Error: {str(e)}"

@app.route('/get-source')
def get_source():
    target_url = request.args.get('url')
    if not target_url:
        return jsonify({"error": "No URL"}), 400
    
    print(f"DEBUG: Processing URL -> {target_url}")
    
    source = fetch_ssc_source(target_url)
    
    if source.startswith("Error:"):
        return jsonify({"error": source}), 500
    
    return jsonify({"source": source})

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))
