import socket
import threading
import json
import traceback
import sys
import time
from pymol import cmd
import io # Import io for capturing output

class PyMOLServer:
    def __init__(self, host='localhost', port=9876):
        self.host = host
        self.port = port
        self.server_socket = None
        self.running = False
        self.thread = None
        
    def start(self):
        """Start the PyMOL server"""
        try:
            self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.server_socket.bind((self.host, self.port))
            self.server_socket.listen(5)
            
            self.running = True
            self.thread = threading.Thread(target=self._accept_connections)
            self.thread.daemon = True
            self.thread.start()
            
            print(f"PyMOL server started on {self.host}:{self.port}")
            return True
        except Exception as e:
            print(f"Error starting PyMOL server: {str(e)}")
            traceback.print_exc()
            return False
    
    def stop(self):
        """Stop the PyMOL server"""
        self.running = False
        if self.server_socket:
            self.server_socket.close()
        print("PyMOL server stopped")
    
    def _accept_connections(self):
        """Accept client connections"""
        while self.running:
            try:
                client_socket, address = self.server_socket.accept()
                client_thread = threading.Thread(
                    target=self._handle_client,
                    args=(client_socket, address)
                )
                client_thread.daemon = True
                client_thread.start()
            except Exception as e:
                if self.running:
                    print(f"Error accepting connection: {str(e)}")
                break
    
    def _handle_client(self, client_socket, address):
        """Handle a client connection"""
        print(f"\n[PyMOLServer] Handling connection from {address}")
        full_data_str = "" # Store decoded data for logging
        try:
            # Receive data
            data = b""
            client_socket.settimeout(5.0) # Set a timeout for receiving data
            while True:
                try:
                    chunk = client_socket.recv(4096)
                    if not chunk:
                        print("[PyMOLServer] Client closed connection before sending data.")
                        break # Connection closed
                    data += chunk
                    # Try to parse incrementally, break when valid JSON found
                    try:
                        full_data_str = data.decode('utf-8')
                        message = json.loads(full_data_str)
                        print(f"[PyMOLServer] Received valid JSON after {len(data)} bytes.")
                        break # Successfully parsed, stop receiving
                    except json.JSONDecodeError:
                        # Not complete JSON yet, continue receiving
                        print(f"[PyMOLServer] Received chunk ({len(chunk)} bytes), waiting for more...")
                        continue
                    except UnicodeDecodeError:
                         print(f"[PyMOLServer] Received non-UTF8 data chunk?") # Log if decoding fails mid-stream
                         continue # Or handle error differently
                except socket.timeout:
                    print("[PyMOLServer] Socket receive timeout.")
                    if not data: # Timeout before any data
                         return
                    # If some data received, try parsing what we have one last time
                    try:
                        full_data_str = data.decode('utf-8')
                        message = json.loads(full_data_str)
                        print("[PyMOLServer] Received valid JSON after timeout.")
                    except (json.JSONDecodeError, UnicodeDecodeError) as e:
                         print(f"[PyMOLServer] Error parsing incomplete/invalid data after timeout: {e}")
                         print(f"[PyMOLServer] Raw data received: {data!r}")
                         message = None # Indicate parsing failure
                    break # Exit loop after timeout

            if not data or not 'message' in locals() or message is None:
                print("[PyMOLServer] No valid message received.")
                return

            # *** Log the received and parsed message ***
            print(f"[PyMOLServer] Raw data received: {data!r}")
            print(f"[PyMOLServer] Parsed message: {message}")

            # Process the command
            response = self._process_command(message)
            print(f"[PyMOLServer] Sending response: {response}") # Log response being sent

            # Send response
            response_bytes = json.dumps(response).encode('utf-8')
            client_socket.sendall(response_bytes)
            print(f"[PyMOLServer] Response sent ({len(response_bytes)} bytes).")

        except Exception as e:
            error_message = str(e)
            print(f"[PyMOLServer] Error handling client {address}: {error_message}")
            traceback.print_exc()
            try:
                # Attempt to send error back to client
                err_resp = json.dumps({"error": f"Server error: {error_message}", "raw_data": full_data_str}).encode('utf-8')
                client_socket.sendall(err_resp)
            except Exception as send_err:
                print(f"[PyMOLServer] Could not send error response to client: {send_err}")
        finally:
            print(f"[PyMOLServer] Closing connection from {address}")
            client_socket.close()
    
    def _process_command(self, message):
        """Process a PyMOL command by executing it as Python code."""
        command_to_run = "" # Keep track for error reporting
        try:
            if "cmd" not in message:
                print("[PyMOLServer] Error: 'cmd' key missing in message.")
                return {"status": "error", "error": "Invalid message format: 'cmd' key missing."}

            command_to_run = message["cmd"] # The raw command string like "fetch 1hpv"
            print(f"[PyMOLServer] Received command string: {command_to_run}")

            # --- Prepare Python code to execute the command string ---
            # We need to ensure it runs within PyMOL's context.
            # Using cmd.do() is the standard way to execute command strings safely.
            # Let's try to capture stdout/stderr from cmd.do if possible.

            execution_output = io.StringIO()
            execution_error = io.StringIO()
            success_flag = False
            result_data = None

            # Use cmd.lock_api for thread safety
            with cmd.lock_api:
                # Redirect stdout and stderr temporarily (within PyMOL's context)
                original_stdout = sys.stdout
                original_stderr = sys.stderr
                sys.stdout = execution_output
                sys.stderr = execution_error
                try:
                    # Separate command word and arguments for specific checks
                    command_to_run_stripped = command_to_run.strip()
                    parts = command_to_run_stripped.split(None, 1)
                    command_word = parts[0].lower()
                    command_args = parts[1] if len(parts) > 1 else ""

                    # --- Execute Command ---
                    print(f"[PyMOLServer] Processing command word: '{command_word}'")
                    if command_word == "fetch" and command_args:
                        # *** Use synchronous cmd.fetch for reliability ***
                        pdb_code = command_args.split()[0] # Get the PDB code
                        obj_name = pdb_code.lower() # PyMOL often uses lowercase for fetched objects
                        print(f"[PyMOLServer] Executing via cmd.fetch('{pdb_code}', name='{obj_name}')")
                        cmd.fetch(pdb_code, name=obj_name, type='pdb', async_=0) # async_=0 makes it synchronous
                    else:
                        # For other commands, use cmd.do
                        print(f"[PyMOLServer] Executing via cmd.do('{command_to_run_stripped}')")
                        cmd.do(command_to_run_stripped)

                    success_flag = True
                    print(f"[PyMOLServer] PyMOL command execution completed (Python level).")

                    # Add specific checks after execution if needed
                    if command_word == "fetch":
                        # Verification after SYNCHRONOUS fetch call
                        # obj_name was defined earlier for the cmd.fetch call
                        # Check if it ACTUALLY loaded after the synchronous call
                        loaded_objects = [name.lower() for name in cmd.get_names("objects")]

                        if obj_name and obj_name in loaded_objects:
                                   atom_count = cmd.count_atoms(f"({obj_name})")
                                   result_data = {"fetch_status": "success", "object": obj_name, "atoms": atom_count}
                                   print(f"[PyMOLServer] Fetch successful: {result_data}")
                        elif obj_name: # Only report error if an object name was expected
                            # If fetch was used but object not found, it's an error
                            success_flag = False # Mark as failure
                            result_data = {"execution_error": f"Object '{obj_name}' not found after synchronous fetch attempt. Check PDB ID and network."}
                            print(f"[PyMOLServer] Warning: Object '{obj_name}' not found after fetch.")

                    # Add other post-execution checks if needed (e.g., for 'load')

                except Exception as exec_err:
                    print(f"[PyMOLServer] Exception during cmd.do('{command_to_run}'): {exec_err}")
                    traceback.print_exc(file=execution_error) # Capture traceback to stderr string
                    success_flag = False
                    result_data = {"execution_error": str(exec_err)}
                finally:
                    # Restore original stdout and stderr
                    sys.stdout = original_stdout
                    sys.stderr = original_stderr

            output_str = execution_output.getvalue()
            error_str = execution_error.getvalue()

            print(f"[PyMOLServer] Captured stdout:\n{output_str}")
            print(f"[PyMOLServer] Captured stderr:\n{error_str}")

            if success_flag:
                response = {
                    "status": "success",
                    "command_executed": command_to_run,
                    "result": result_data if result_data else "Command completed.", # Include specific results if captured
                    "stdout": output_str,
                    "stderr": error_str # Include stderr even on success, might contain warnings
                }
            else:
                 response = {
                    "status": "error",
                    "command_executed": command_to_run,
                    "error": result_data.get("execution_error", "Execution failed") if result_data else "Execution failed",
                    "stdout": output_str,
                    "stderr": error_str
                }

            return response

        except Exception as e:
            error_msg = traceback.format_exc()
            print(f"[PyMOLServer] Unexpected error in _process_command for '{command_to_run}': {error_msg}")
            return {"status": "error", "command": command_to_run, "error": f"Server processing error: {str(e)}", "traceback": error_msg[:500]}

# PyMOL plugin initialization function
def __init_plugin__(app=None):
    # Create a menu item in PyMOL
    from pymol.plugins import addmenuitemqt
    addmenuitemqt('Start ProteinCodex Server', start_server)
    
    # If you want to start the server automatically, uncomment this line:
    # start_server()
    
    print("ProteinCodex PyMOL plugin initialized")

# Function to start the server
def start_server():
    global server
    if 'server' in globals() and server.running:
        print("Server is already running")
        return
    
    server = PyMOLServer()
    server.start()

# To use this as a standalone script
if __name__ == "__main__":
    print("--- Starting PyMOL Server Standalone ---")
    server = PyMOLServer()
    if server.start():
        print("Server started. Waiting for connections...")
        try:
            # Keep the main thread alive
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nShutting down server...")
            server.stop()
            print("Server stopped.")
    else:
        print("Failed to start server.")