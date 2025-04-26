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
                
                # Send command to PyMOL
                message = json.dumps({"cmd": command})
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
                        break  # Valid JSON received
                    except json.JSONDecodeError:
                        continue  # Wait for more data
                
                sock.close()
                
                # Parse response
                try:
                    result = json.loads(response.decode('utf-8'))
                    return result
                except json.JSONDecodeError:
                    return {"error": "Invalid response from PyMOL", "raw": response.decode('utf-8')}
                    
            except Exception as e:
                if 'sock' in locals():
                    sock.close()
                raise Exception(f"Error executing PyMOL command: {str(e)}")
    
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
