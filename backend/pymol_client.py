import socket
import json
import time
from threading import Lock

class PyMOLClient:
    def __init__(self, host='localhost', port=9876):
        self.host = host
        self.port = port
        self.lock = Lock()  # For thread safety
        
    def _connect(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)  # 5 seconds timeout
        try:
            sock.connect((self.host, self.port))
            return sock
        except (socket.timeout, ConnectionRefusedError) as e:
            raise ConnectionError(f"Could not connect to PyMOL at {self.host}:{self.port}. Error: {str(e)}")
    
    def execute_command(self, command):
        with self.lock:
            try:
                sock = self._connect()
                print(f"[PyMOLClient] Connected to {self.host}:{self.port}") # Add connect log
                
                # Send command to PyMOL
                message = json.dumps({"cmd": command})
                print(f"[PyMOLClient] Sending command: {message}") # Log the exact message being sent
                sock.sendall(message.encode('utf-8'))
                
                # Wait for response
                response = b""
                while True:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    response += chunk
                    
                    # Check if response is complete
                    try:
                        json.loads(response.decode('utf-8'))
                        print(f"[PyMOLClient] Received complete response: {response.decode('utf-8')}")
                        break  # Valid JSON received
                    except json.JSONDecodeError:
                        print(f"[PyMOLClient] Received partial response ({len(response)} bytes), waiting for more data...")
                        continue  # Wait for more data
                
                sock.close()
                
                # Parse response
                try:
                    result = json.loads(response.decode('utf-8'))
                    print(f"[PyMOLClient] Parsed response: {result}")
                    return result
                except json.JSONDecodeError:
                    error_result = {"error": "Invalid response from PyMOL", "raw": response.decode('utf-8')}
                    print(f"[PyMOLClient] Error parsing response: {error_result}")
                    return error_result
                    
            except ConnectionError as e: # Specific exception
                print(f"[PyMOLClient] Connection Error: {str(e)}")
                raise ConnectionError(f"PyMOL Connection Error: {str(e)}") # Re-raise specific type
            except Exception as e:
                print(f"[PyMOLClient] Error executing command '{command}': {str(e)}")
                if 'sock' in locals() and sock:
                    sock.close()
                raise Exception(f"PyMOL Client Error executing '{command}': {str(e)}")
    
    def load_structure(self, pdb_id_or_path):
        if pdb_id_or_path.lower().endswith(('.pdb', '.cif')):
            # Load from file
            return self.execute_command(f"load {pdb_id_or_path}")
        else:
            # Fetch from PDB
            return self.execute_command(f"fetch {pdb_id_or_path}")
    
    def get_current_view(self):
        return self.execute_command("get_view")
    
    def set_view(self, view_data):
        return self.execute_command(f"set_view {view_data}")
    
    def color_by_property(self, selection="all", property_type="b"):
        return self.execute_command(f"spectrum {property_type}, rainbow, {selection}")
    
    def show_surface(self, selection="all"):
        return self.execute_command(f"show surface, {selection}")
    
    def hide_everything(self):
        return self.execute_command("hide everything")
    
    def center(self, selection="all"):
        return self.execute_command(f"center {selection}")
    
    def zoom(self, selection="all"):
        return self.execute_command(f"zoom {selection}")
    
    def select(self, name, selection):
        return self.execute_command(f"select {name}, {selection}")
