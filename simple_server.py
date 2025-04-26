from flask import Flask, send_file, redirect
import os
import webbrowser

app = Flask(__name__, static_folder='.')

@app.route('/')
def index():
    return send_file('web_index.html')

@app.route('/<path:path>')
def serve_file(path):
    if os.path.exists(path):
        return send_file(path)
    else:
        return f"File not found: {path}", 404

if __name__ == '__main__':
    # Open the web browser
    webbrowser.open('http://localhost:8000')
    
    # Start the Flask server
    print("Starting web demo server on http://localhost:8000")
    print("Press Ctrl+C to stop the server")
    app.run(host='0.0.0.0', port=8000, debug=False)