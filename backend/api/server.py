import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
import google.generativeai as genai
from dotenv import load_dotenv
import sys

# Add the parent directory to the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pymol.client import PyMOLClient
from screenshot.capture import capture_screenshot

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Configure Gemini API
API_KEY = os.getenv("GEMINI_API_KEY")
if API_KEY:
    genai.configure(api_key=API_KEY)
else:
    print("Warning: GEMINI_API_KEY not found in environment variables")

# Initialize PyMOL client
pymol_client = PyMOLClient(host='localhost', port=9876)

@app.route('/api/chat', methods=['POST'])
def chat():
    """Process a chat message and return the AI response"""
    data = request.json
    user_message = data.get('message', '')
    
    try:
        # Initialize Gemini model
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        # Generate response
        response = model.generate_content(user_message)
        
        return jsonify({
            'response': response.text
        })
    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500

@app.route('/api/execute-pymol', methods=['POST'])
def execute_pymol():
    """Execute a command in PyMOL"""
    data = request.json
    command = data.get('command', '')
    
    try:
        response = pymol_client.send_command(command)
        return jsonify({
            'response': response
        })
    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500

@app.route('/api/capture-screenshot', methods=['GET'])
def get_screenshot():
    """Capture a screenshot of the PyMOL window"""
    try:
        screenshot_path = capture_screenshot()
        return jsonify({
            'screenshot_path': screenshot_path
        })
    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500

@app.route('/api/analyze-image', methods=['POST'])
def analyze_image():
    """Send an image to Gemini for analysis"""
    data = request.json
    image_path = data.get('image_path', '')
    prompt = data.get('prompt', 'Analyze this protein structure image')
    
    try:
        # Initialize Gemini model
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        # Load image
        with open(image_path, 'rb') as f:
            image_data = f.read()
        
        # Generate response with image
        response = model.generate_content([prompt, image_data])
        
        return jsonify({
            'analysis': response.text
        })
    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500

if __name__ == '__main__':
    socketio.run(app, host='127.0.0.1', port=5000, debug=True)