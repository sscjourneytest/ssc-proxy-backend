import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from playwright.sync_api import sync_playwright

app = Flask(__name__)
CORS(app)

def fetch_source_cleaned(url):
    # FIX: Logic to handle URL typos like http// or missing colons
    if url.startswith("http") and "//" in url and ":" not in url.split("//")[0]:
        url = url.replace("http//", "http://").replace("https//", "https://")
    
    with sync_playwright() as p:
        # Launch browser with arguments to make it run better on Railway/Cloud
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = context.new_page()
        
        try:
            # wait_until="networkidle" waits for all images and scripts to load
            # timeout is 60 seconds to ensure slow SSC servers respond
            response = page.goto(url, wait_until="networkidle", timeout=60000)
            
            # Check if the page actually exists
            if response.status == 404:
                return "Error: Section not found (404)"
            
            content = page.content()
            browser.close()
            return content
        except Exception as e:
            # Ensure browser closes on failure to prevent Railway memory leaks
            if 'browser' in locals():
                browser.close()
            return f"Error: {str(e)}"

@app.route('/get-source')
def get_source():
    target_url = request.args.get('url')
    if not target_url:
        return jsonify({"error": "No URL provided"}), 400
    
    print(f"Fetching: {target_url}") # Helps you see progress in Railway Logs
    
    source_code = fetch_source_cleaned(target_url)
    
    # Check if the result is an error message
    if source_code.startswith("Error:"):
        return jsonify({
            "error": "Failed to fetch from SSC",
            "details": source_code
        }), 500
    
    return jsonify({"source": source_code})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
