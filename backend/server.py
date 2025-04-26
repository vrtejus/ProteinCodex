import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
from dotenv import load_dotenv
# Correct imports based on the new google-genai SDK documentation
from google import genai # Use 'from google import genai'
from google.genai import types # types are now directly under google.genai
from PIL import Image
import io
import base64
import traceback
import time

# --- Local Imports ---
from pymol_client import PyMOLClient # Ensure this import is correct

# --- Load Environment Variables ---
load_dotenv()
# *** IMPORTANT: The new SDK typically uses GOOGLE_API_KEY, not GEMINI_API_KEY ***
# Check for GOOGLE_API_KEY first, then fallback to GEMINI_API_KEY for compatibility
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
if not GOOGLE_API_KEY:
    print("CRITICAL ERROR: GOOGLE_API_KEY (or GEMINI_API_KEY) not found in environment variables.")
    print("Please create a .env file in the project root with GOOGLE_API_KEY=your_api_key_here")
    exit(1)

# --- Initialize Flask & Extensions ---
app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=10 * 1024 * 1024) # 10MB limit

# --- Initialize PyMOL Client ---
pymol_client_global = None
try:
    pymol_client_global = PyMOLClient('localhost', 9876)
    print("PyMOLClient initialized.")
except Exception as client_init_err:
    print(f"Warning: Failed to initialize PyMOLClient: {client_init_err}")
    # App continues, but PyMOL commands will fail

# --- Define the Python function for PyMOL execution (Tool) ---
def execute_pymol_command(command: str) -> str:
    """
    Executes a command via the PyMOLClient and returns the received status dictionary as a JSON string.
    """
    print(f"--- Tool Function: Attempting PyMOL command: {command} ---")
    global pymol_client_global
    if pymol_client_global is None:
        error_dict = {"status": "error", "error": "PyMOL client connection is not available.", "command": command}
        return json.dumps(error_dict)
    try:
        # pymol_client.execute_command should return the dictionary received from pymol_server
        result_dict = pymol_client_global.execute_command(command)
        print(f"--- Tool Function: Received dict from PyMOLClient: {result_dict} ---")

        if not isinstance(result_dict, dict):
             print(f"Warning: Expected dict from PyMOLClient, got {type(result_dict)}. Converting to error.")
             error_dict = {"status": "error", "error": "Unexpected response format from PyMOL server.", "command": command, "raw_response": str(result_dict)}
             json_to_return = json.dumps(error_dict)
        else:
             # *** Directly return the received dictionary as a JSON string ***
             json_to_return = json.dumps(result_dict)

        print(f"[Tool Function] Returning JSON to SDK: {json_to_return[:500]}...") # Log truncated
        return json_to_return

    except ConnectionError as conn_err:
        print(f"PyMOL Connection Error during function call: {conn_err}")
        error_dict = {"status": "error", "error": f"Could not connect to PyMOL. ({str(conn_err)})", "command": command}
        json_to_return = json.dumps(error_dict)
        print(f"[Tool Function] Returning Error JSON to SDK: {json_to_return}")
        return json_to_return
    except Exception as e:
        print(f"Error executing PyMOL command '{command}' via PyMOLClient: {e}")
        traceback.print_exc()
        error_dict = {"status": "error", "error": str(e), "command": command, "traceback": traceback.format_exc()[:500]}
        json_to_return = json.dumps(error_dict)
        print(f"[Tool Function] Returning Error JSON to SDK: {json_to_return}")
        return json_to_return

# --- Initialize Gemini Client (New SDK Style) ---
# --- Initialize Gemini Client (New SDK Style) ---
try:
    # Use the API key directly if GOOGLE_API_KEY env var isn't set/preferred
    # client = genai.Client(api_key=GOOGLE_API_KEY)
    # Or rely on the environment variable GOOGLE_API_KEY
    # *** Use GOOGLE_API_KEY from environment ***
    API_KEY_TO_USE = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
    if not API_KEY_TO_USE:
         raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY not found in environment")

    # *** Incorrect way - caused the TypeError ***
    # client = genai.Client(API_KEY_TO_USE)

    # *** Correct way - use the keyword argument 'api_key' ***
    client = genai.Client(api_key=API_KEY_TO_USE) # Use keyword argument

    print("google.genai Client initialized successfully.")
except ValueError as ve:
    print(f"CRITICAL ERROR: Failed to initialize google.genai Client: {ve}")
    exit(1)
except Exception as client_err:
    print(f"CRITICAL ERROR: An unexpected error occurred initializing google.genai Client: {client_err}")
    traceback.print_exc()
    exit(1)

# --- Constants ---
# The specific model name for the preview version
MODEL_NAME = "models/gemini-2.5-flash-preview-04-17" # Using the requested specific version

# Verify model availability (optional but recommended)
try:
    model_info = client.models.get(model=MODEL_NAME)
    print(f"Verified access to model: {model_info.name}")
    # print(f"Supported generation methods: {model_info.supported_generation_methods}")
except Exception as model_check_err:
     print(f"Warning: Could not verify model '{MODEL_NAME}' availability: {model_check_err}")
     print("Proceeding, but generation might fail if the model name is incorrect or inaccessible.")
     # Fallback?
     # MODEL_NAME = "models/gemini-1.5-flash-latest" # Or other known working model
     # print(f"Attempting to use fallback model: {MODEL_NAME}")


# --- Main Processing Logic ---
def process_message_with_gemini(user_message, image_path=None):
    """
    Processes a message using the google.genai Client, potentially invoking
    the PyMOL tool via automatic function calling.
    """
    global client # Use the global client instance
    start_time = time.time()
    print(f"\nProcessing message with google.genai Client ({MODEL_NAME})...")

    try:
        # --- Prepare content parts ---
        # Uses types from google.genai.types
        content_parts = []
        if image_path and os.path.exists(image_path):
            try:
                abs_image_path = os.path.abspath(image_path)
                if not os.path.exists(abs_image_path):
                    raise FileNotFoundError(f"Image not found: {abs_image_path}")
                with Image.open(abs_image_path) as img:
                    img.verify()
                    mime_type = Image.MIME.get(img.format, 'image/png')
                print(f"Preparing image part: {abs_image_path} (MIME: {mime_type})")
                image_part = types.Part.from_uri(mime_type=mime_type, uri=f"file://{abs_image_path}")
                content_parts.append(image_part) # Image first
                content_parts.append(types.Part.from_text(text=user_message))
            except FileNotFoundError as fnf_err:
                 print(f"Error: {fnf_err}")
                 return f"Error processing request: Could not find image at `{image_path}`."
            except Exception as img_err:
                 print(f"Warning: Failed to process image {image_path}: {img_err}")
                 traceback.print_exc()
                 # *** Corrected Text Part (when image processing fails) ***
                 content_parts.append(types.Part.from_text(
                     text=f"{user_message} (Note: Unable to process attached image)" # Use text=
                 ))
        else:
            # No image, just text
            # *** Corrected Text Part (when no image) ***
            content_parts.append(types.Part.from_text(text=user_message)) # Use text=

        if not content_parts: return "Error: No message content."

        # --- Configure the generation request ---
        # Configure with tools inside the GenerateContentConfig
        generation_config = types.GenerateContentConfig(
            tools=[execute_pymol_command],  # Tools moved here inside config
            temperature=0.1                 # Other parameters
        )

        print(f"Sending content to {MODEL_NAME} via client.models.generate_content...")
        # *** The correct way to pass tools using config parameter ***
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=content_parts,         # Pass the list of Part objects
            config=generation_config,       # Pass the config containing tools
            # stream=False                  # Default is False
        )
        print("--- google.genai Response Received ---")

        # Extract the final text response
        final_text = ""
        try:
            final_text = response.text # .text should work after auto function calling
        except ValueError: # Handle potential errors/blocks
            print("Warning: Could not directly access response.text.")
            if response.prompt_feedback and response.prompt_feedback.block_reason:
                 final_text = f"Content blocked: {response.prompt_feedback.block_reason}. {response.prompt_feedback.block_reason_message or ''}"
            else:
                 final_text = "Error: Received unexpected response structure."
                 print(f"Unexpected response: {response}")

        processing_time = time.time() - start_time
        print(f"Gemini processing finished in {processing_time:.2f}s.")
        return final_text

    except Exception as e:
        print(f"CRITICAL Error during Gemini processing: {str(e)}")
        traceback.print_exc()
        return f"Sorry, an error occurred with the AI model: {str(e)}"


# --- Flask Routes (Largely unchanged, they call the updated processing logic) ---

@app.route('/api/chat', methods=['POST'])
def chat():
    start_time = time.time()
    data = request.json
    if not data: return jsonify({"error": "Invalid request"}), 400
    user_message = data.get('message', '')
    image_path = data.get('image_path', None)

    print(f"\n--- API Chat Request ---")
    print(f"Msg: '{user_message[:100]}...' | Img: {image_path}")

    if not user_message and not image_path:
        return jsonify({"error": "Empty request"}), 400

    # Direct PyMOL command check
    if user_message.startswith('/pymol '):
        pymol_command = user_message[7:].strip()
        print(f"Direct PyMOL cmd: '{pymol_command}'")
        if not pymol_command:
             response_text = "Provide command after /pymol."
        else:
            result_json = execute_pymol_command(pymol_command) # Use tool func
            try:
                 result_data = json.loads(result_json)
                 status = result_data.get("status", "error")
                 if status == "success":
                      response_text = f"PyMOL OK: `{pymol_command}`\n```json\n{json.dumps(result_data.get('result', {}), indent=2)}\n```"
                 else:
                      response_text = f"PyMOL Error: `{pymol_command}`\n```json\n{json.dumps(result_data, indent=2)}\n```"
            except json.JSONDecodeError:
                 response_text = f"PyMOL Raw Resp:\n```\n{result_json}\n```"
    else:
        # Process with Gemini (using the new client and auto tools)
        response_text = process_message_with_gemini(user_message, image_path)

    end_time = time.time()
    print(f"Chat request processed in {end_time - start_time:.2f}s")
    return jsonify({"response": response_text})


@app.route('/api/execute-pymol', methods=['POST'])
def execute_pymol_direct():
    data = request.json
    if not data: return jsonify({"success": False, "error": "Invalid request"}), 400
    command = data.get('command', '')
    if not command: return jsonify({"success": False, "error": "No command"}), 400

    print(f"--- Direct PyMOL Execute: '{command}' ---")
    result_json = execute_pymol_command(command) # Use the tool function
    try:
        result_data = json.loads(result_json)
        success = result_data.get("status") == "success"
        if success:
            return jsonify({"success": True, "result": result_data.get("result")})
        else:
            error_msg = result_data.get("error", "Unknown PyMOL error")
            status_code = 503 if "connect" in error_msg.lower() else 500
            return jsonify({"success": False, "error": error_msg}), status_code
    except json.JSONDecodeError:
         return jsonify({"success": False, "error": "Invalid internal response"}), 500


@app.route('/api/analyze-image', methods=['POST'])
def analyze_image():
    """Analyzes an uploaded image using the main Gemini processing function."""
    start_time = time.time()
    print(f"\n--- API Analyze Image Request ---")
    if 'image' not in request.files: return jsonify({"error": "No image file"}), 400

    image_file = request.files['image']
    prompt = request.form.get('prompt', 'Analyze this image.')

    temp_dir = os.path.join(os.getcwd(), 'temp')
    os.makedirs(temp_dir, exist_ok=True)
    filename = f"analyze_{os.urandom(8).hex()}.png" # Assume png or detect
    temp_image_path = os.path.join(temp_dir, filename)

    analysis_result = "Error analyzing image."
    try:
        image_file.save(temp_image_path)
        print(f"Saved temp image: {temp_image_path}")
        # Use the main processing function
        analysis_result = process_message_with_gemini(prompt, temp_image_path)
        end_time = time.time()
        print(f"Image analysis done in {end_time - start_time:.2f}s")
        return jsonify({"analysis": analysis_result})
    except Exception as e:
         print(f"Error in analyze-image endpoint: {e}")
         traceback.print_exc()
         return jsonify({"error": f"Failed to analyze: {str(e)}"}), 500
    finally:
        if os.path.exists(temp_image_path):
            try: os.remove(temp_image_path)
            except OSError as rm_err: print(f"Warn: Failed remove {temp_image_path}: {rm_err}")


@app.route('/api/clear-history', methods=['POST'])
def clear_history():
    print("Clear history called (no server-side state to clear).")
    return jsonify({"success": True})


# --- Main Execution Block ---
if __name__ == '__main__':
    os.makedirs('temp', exist_ok=True)
    port = 5001
    print(f"--- ProteinCodex Backend (google-genai SDK) ---")
    print(f"Starting Flask server on http://0.0.0.0:{port}")
    print(f"Using Gemini Model: {MODEL_NAME}")
    print(f"PyMOL Server expected at: localhost:9876")
    print(f"PyMOL Client Initialized: {'Yes' if pymol_client_global else 'No'}")
    print("---------------------------------------------")

    try:
        socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True)
    except OSError as e:
        if "Address already in use" in str(e): print(f"\nCRITICAL ERROR: Port {port} is already in use.")
        else: print(f"\nCRITICAL ERROR starting server: {e}")
        exit(1)
    except Exception as run_err:
         print(f"\nCRITICAL ERROR during server run: {run_err}")
         traceback.print_exc()
         exit(1)