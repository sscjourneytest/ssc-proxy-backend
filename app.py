import os
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# This line is CRITICAL: It allows your website domain to talk to this server
CORS(app)

@app.route('/get-source')
def get_source():
    target_url = request.args.get('url')
    if not target_url:
        return jsonify({"error": "No URL provided"}), 400
    
    try:
        # We use a User-Agent to make the request look like a real browser
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(target_url, headers=headers, timeout=15)
        response.raise_for_status()
        return jsonify({"source": response.text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # Railway provides the PORT environment variable automatically
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
