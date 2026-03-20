import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from playwright.sync_api import sync_playwright

app = Flask(__name__)
CORS(app)

def fetch_source(url):
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        page = context.new_page()
        
        try:
            # Go to URL and WAIT for the network to be idle (all images/scripts loaded)
            page.goto(url, wait_until="networkidle", timeout=60000)
            
            # Get the full loaded HTML
            content = page.content()
            browser.close()
            return content
        except Exception as e:
            browser.close()
            raise e

@app.route('/get-source')
def get_source():
    target_url = request.args.get('url')
    if not target_url:
        return jsonify({"error": "No URL"}), 400
    
    try:
        source_code = fetch_source(target_url)
        return jsonify({"source": source_code})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
