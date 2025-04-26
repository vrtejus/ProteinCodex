import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
import dotenv # Use import dotenv to call find_dotenv
# Correct imports for google-genai SDK
from google import genai # Use 'from google import genai'
from google.genai import types # types are now directly under google.genai
from PIL import Image
import io
import base64
import traceback
import time
from typing import Optional # Added missing import for type hint

# --- Local Imports ---
from pymol_client import PyMOLClient # Ensure this import is correct

# --- Load Environment Variables ---
dotenv.load_dotenv()
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

# --- Load PyMOL Reference ---
PYMOL_REFERENCE_FILE = "pymol_command_ref.txt"
PYMOL_REFERENCE_CONTENT = ""

# Try to load the reference file from the working directory or a few locations
ref_file_path = os.path.join(os.getcwd(), PYMOL_REFERENCE_FILE)
try:
    with open(ref_file_path, 'r') as f:
        PYMOL_REFERENCE_CONTENT = f.read()
    print(f"Successfully loaded PyMOL reference from '{ref_file_path}' ({len(PYMOL_REFERENCE_CONTENT)} chars).")
except FileNotFoundError:
    print(f"CRITICAL WARNING: PyMOL reference file '{PYMOL_REFERENCE_FILE}' not found at expected location '{ref_file_path}'. Context injection will fail.")
    PYMOL_REFERENCE_CONTENT = "Error: PyMOL Reference file not loaded." # Provide fallback content
except Exception as ref_err:
    print(f"CRITICAL WARNING: Error loading PyMOL reference file '{ref_file_path}': {ref_err}")
    PYMOL_REFERENCE_CONTENT = f"Error loading PyMOL Reference: {ref_err}" # Provide fallback content

# --- Define System Instruction (incorporating the reference) ---
SYSTEM_INSTRUCTION_BASE = """You are an expert assistant for the PyMOL molecular visualization software.
Your primary goal is to help users interact with PyMOL by generating appropriate commands for the `execute_pymol_command` tool based on the PyMOL Command Reference provided below.
ALWAYS consult this reference before generating a command. Ensure command syntax, name, and parameters strictly follow the reference. Use `fetch` for PDB IDs and `load` for local files. If the user's request is ambiguous or needs a command not in the reference, ask for clarification or state you cannot fulfill it based *only* on the reference. Do not invent commands.
"""
SYSTEM_INSTRUCTION = f"{SYSTEM_INSTRUCTION_BASE}\n\nPYMOL COMMAND REFERENCE:\n---\n{PYMOL_REFERENCE_CONTENT}\n---"

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
try:
    API_KEY_TO_USE = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
    if not API_KEY_TO_USE:
         raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY not found in environment")

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
MODEL_NAME = "models/gemini-2.5-flash-preview-04-17" # The specific model name
# MODEL_NAME = "gemini-2.5-pro-preview-03-25" # Use the correct model name

# --- In-memory storage for active chat sessions ---
# Dictionary mapping chat_id (string) to a list of `types.Content` objects (the history)
active_chats = {}

# --- Main Processing Logic ---
def process_message_with_gemini(chat_id: str, user_message: str, image_path=None):
    """
    Processes a message using the google.genai Client's generate_content method.
    Manages history manually and includes system instruction + tools in the config for each call.
    """
    global client, active_chats, MODEL_NAME # Use the global client
    start_time = time.time()
    print(f"\nProcessing message for chat_id: {chat_id} with client.models.generate_content...")
    print(f"Using model: {MODEL_NAME}")

    try:
        is_first_message = chat_id not in active_chats
        # --- Prepare content parts for THIS turn ---
        current_turn_parts = []
        # Prepare user message part first
        user_message_part = types.Part.from_text(text=user_message)

        if image_path and os.path.exists(image_path):
            try:
                # ... (image loading logic - keep as is) ...
                abs_image_path = os.path.abspath(image_path)
                if not os.path.exists(abs_image_path): raise FileNotFoundError(f"Image not found: {abs_image_path}")
                with Image.open(abs_image_path) as img:
                    mime_type = Image.MIME.get(img.format, 'image/png')
                image_part = types.Part.from_uri(mime_type=mime_type, uri=f"file://{abs_image_path}")
                current_turn_parts.append(image_part) # Image first
                current_turn_parts.append(user_message_part) # Then text
            except FileNotFoundError as fnf_err:
                 print(f"Error: {fnf_err}")
                 return f"Error processing request: Could not find image at `{image_path}`."
            except Exception as img_err:
                 print(f"Warning: Failed to process image {image_path}: {img_err}")
                 traceback.print_exc()
                 # If image fails, just send text with a note
                 current_turn_parts.append(types.Part.from_text(
                     text=f"{user_message} (Note: Unable to process attached image)"
                 ))
        else:
            # No image, just the user text part
            current_turn_parts.append(user_message_part)

        # Create the Content object for the current user turn
        current_user_content = types.Content(role="user", parts=current_turn_parts)

        # --- Get or Initialize Chat History ---
        if is_first_message:
            print(f"New chat ID: {chat_id}. Initializing history list.")
            current_history = []
            active_chats[chat_id] = current_history
        else:
            current_history = active_chats[chat_id]
            # Log history before sending
            print(f"--- History for chat {chat_id} BEFORE sending (Turns: {len(current_history)}) ---")
            for i, entry in enumerate(current_history):
                parts_summary = [f"Part(type={type(p).__name__}, len={len(p.text) if hasattr(p, 'text') else 'N/A'})" for p in entry.parts]
                print(f"  Turn {i} - Role: {entry.role}, Parts: {parts_summary}")
            print(f"-------------------------------------------------")


        # --- Construct the 'contents' list for this API call (History + Current Turn) ---
        # History + current user turn content
        api_contents = current_history + [current_user_content]

        # --- Configure the generation request ---
        # *** Include system_instruction and tools directly in the config ***
        generation_config = types.GenerateContentConfig(
            # System instruction as a Content object (role 'system' might be implicitly handled or ignored here, text is key)
            system_instruction=types.Content(role="system", parts=[types.Part.from_text(text=SYSTEM_INSTRUCTION)]),
            tools=[execute_pymol_command],
            temperature=0.1
        )

        print(f"Sending {len(api_contents)} content block(s) to generate_content...")
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=api_contents,
            config=generation_config,
            # NOTE: Automatic function calling is NOT explicitly enabled here.
            # We need to MANUALLY handle the function call loop if generate_content returns one.
        )
        print("--- google.genai Response Received ---")

        # --- Manually Handle Function Call Loop ---
        # Check if the response contains a function call request
        try:
            response_part = response.candidates[0].content.parts[0]
        except (IndexError, AttributeError):
             print("Warning: Could not access response part for function call check.")
             if response.prompt_feedback and response.prompt_feedback.block_reason:
                  final_text = f"Content blocked: {response.prompt_feedback.block_reason}. {response.prompt_feedback.block_reason_message or ''}"
             elif response.candidates and response.candidates[0].finish_reason != types.FinishReason.STOP:
                  final_text = f"Assistant stopped responding due to: {response.candidates[0].finish_reason.name}"
             else:
                  final_text = "Error: Received an unexpected or incomplete response from the AI model."
                  print(f"Unexpected chat response structure: {response}")
             # Append user message and this error response to history before returning
             active_chats[chat_id].append(current_user_content) # <<< Use current_user_content here
             active_chats[chat_id].append(types.Content(role="model", parts=[types.Part.from_text(final_text)])) # Approximate model response
             return final_text # Return the error/block message

        if hasattr(response_part, 'function_call') and response_part.function_call:
            # --- Function Call Requested ---
            function_call = response_part.function_call
            print(f"Function call requested: {function_call.name}")
            print(f"Arguments: {dict(function_call.args)}")

            # Append the user message and the model's function call request to history
            active_chats[chat_id].append(current_user_content) # <<< Use current_user_content here
            active_chats[chat_id].append(types.Content(role="model", parts=[response_part])) # Store the part containing the call

            # Execute the function (Your execute_pymol_command)
            # This function MUST return a JSON string
            function_result_json = execute_pymol_command(**dict(function_call.args))

            # Prepare the function response part for the next API call
            function_response_part = types.Part.from_function_response(
                name=function_call.name,
                # The response needs to be a dictionary structure for from_function_response
                # The content of the dictionary is what your function returned (as a JSON string)
                # Let's parse the JSON string back into a dict here
                response=json.loads(function_result_json)
            )

            # Append the function response part to history (as role 'tool' or 'function')
            # The SDK examples use 'tool', let's try that.
            active_chats[chat_id].append(types.Content(role="tool", parts=[function_response_part]))

            # --- Make the SECOND API call with the history including the function response ---
            print("Making second call to generate_content with function response...")
            # History now includes: original_user -> model_func_call -> tool_func_response
            second_response = client.models.generate_content(
                model=MODEL_NAME,
                contents=active_chats[chat_id], # Send the updated history
                config=generation_config, # Include config again
            )
            print("--- Second google.genai Response Received ---")

            # Extract final text from the second response
            try:
                final_text = second_response.text
                # Append this final model response to history
                active_chats[chat_id].append(second_response.candidates[0].content) # Store the Content object
            except ValueError: # Handle potential errors/blocks
                 # ... (similar error handling as before for final_text extraction) ...
                 final_text = "Error processing function response." # Simplified error
                 # Append an approximate model response to history
                 active_chats[chat_id].append(types.Content(role="model", parts=[types.Part.from_text(final_text)]))

        else:
            # --- No Function Call -> Direct Text Response ---
            print("Received direct text response (no function call).")
            # Extract text safely
            final_text = "Error: Could not extract text from response." # Default in case of error below
            try:
                final_text = response.text # Should exist if no function call
                # Append user message and this model response to history
                active_chats[chat_id].append(current_user_content) # <<< Use current_user_content here
                active_chats[chat_id].append(response.candidates[0].content) # Store the Content object
            except (ValueError, IndexError, AttributeError, TypeError):
                print(f"Error extracting text from direct response: {response}")
                active_chats[chat_id].append(current_user_content) # Still store user turn if possible
                active_chats[chat_id].append(types.Content(role="model", parts=[types.Part.from_text(text=final_text)]))


        processing_time = time.time() - start_time
        print(f"Gemini processing finished in {processing_time:.2f}s.")
        return final_text

    except Exception as e:
        print(f"CRITICAL Error during Gemini processing: {str(e)}")
        traceback.print_exc()
        return f"Sorry, an error occurred with the AI model: {str(e)}"

# --- Flask Routes (Largely unchanged, they call the updated processing logic) ---

@app.route('/api/chat', methods=['POST']) # Endpoint name is fine
def handle_chat(): # Renamed function
    start_time = time.time()
    data = request.json
    if not data: return jsonify({"error": "Invalid request"}), 400
    user_message = data.get('message', '')
    image_path = data.get('image_path', None)
    chat_id = data.get('chatId', 'default') # Use a default value if not provided
    
    print(f"\n--- API Chat Request ---")
    print(f"Chat ID: {chat_id} | Msg: '{user_message[:100]}...' | Img: {image_path}")

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
        # Process with Gemini (using the chat session for this chat_id)
        response_text = process_message_with_gemini(chat_id, user_message, image_path)

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
    chat_id = request.form.get('chatId', 'analyze') # Use a specific ID for analysis/one-off
    
    temp_dir = os.path.join(os.getcwd(), 'temp')
    os.makedirs(temp_dir, exist_ok=True)
    filename = f"analyze_{os.urandom(8).hex()}.png" # Assume png or detect
    temp_image_path = os.path.join(temp_dir, filename)

    analysis_result = "Error analyzing image."
    try:
        image_file.save(temp_image_path)
        print(f"Saved temp image: {temp_image_path}")
        # Use the main processing function
        analysis_result = process_message_with_gemini(chat_id, prompt, temp_image_path)
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
    # This endpoint now needs a chat_id to clear a specific chat
    data = request.json if request.is_json else None # Handle cases where body might be empty/not JSON
    chat_id_to_clear = data.get('chatId') if data else None
    if chat_id_to_clear and chat_id_to_clear in active_chats:
        del active_chats[chat_id_to_clear]
        print(f"Cleared chat history for chat_id: {chat_id_to_clear}")
        return jsonify({"success": True, "message": f"Chat history cleared for {chat_id_to_clear}."})
    elif chat_id_to_clear:
        # Chat ID is valid but doesn't exist in active_chats (nothing to clear)
        print(f"No active chat found for chat_id: {chat_id_to_clear}, nothing to clear.")
        return jsonify({"success": True, "message": f"No active chat with ID {chat_id_to_clear}."})
    else:
        # Optionally clear ALL chats? Or require a chat ID.
        # active_chats.clear()
        # print("Cleared ALL active chat sessions.") # Be careful with this
        # return jsonify({"success": True, "message": "All chat sessions cleared."})
        return jsonify({"success": False, "error": "Missing 'chatId' to clear specific history."}), 400


# --- Main Execution Block ---
if __name__ == '__main__':
    # ... (Keep __main__ block exactly as before) ...
    os.makedirs('temp', exist_ok=True)
    port = 5001 # Keep consistent port
    print(f"--- ProteinCodex Backend (google-genai SDK - Chat w/ History) ---") # Updated log message
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