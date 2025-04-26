import socket
import time

class PyMOLClient:
    """Client for communicating with PyMOL through its XML-RPC server"""
    
    def __init__(self, host='localhost', port=9876, timeout=5):
        """Initialize connection parameters to PyMOL
        
        Args:
            host (str): The hostname where PyMOL is running
            port (int): The port number for PyMOL's XML-RPC server
            timeout (int): Socket timeout in seconds
        """
        self.host = host
        self.port = port
        self.timeout = timeout
    
    def send_command(self, command):
        """Send a command to PyMOL
        
        Args:
            command (str): The PyMOL command to execute
            
        Returns:
            str: The response from PyMOL or an error message
        """
        try:
            # Create a socket connection to PyMOL
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(self.timeout)
            sock.connect((self.host, self.port))
            
            # Send the command
            command_bytes = command.encode('utf-8') + b'\n'
            sock.sendall(command_bytes)
            
            # Wait for a response
            time.sleep(0.1)  # Small delay to allow PyMOL to process the command
            
            # Close the connection
            sock.close()
            
            return f"Command '{command}' sent to PyMOL"
        except Exception as e:
            return f"Error communicating with PyMOL: {str(e)}"
    
    def load_structure(self, pdb_id):
        """Load a protein structure from the PDB
        
        Args:
            pdb_id (str): The PDB ID to load
            
        Returns:
            str: Status message
        """
        command = f"fetch {pdb_id}"
        return self.send_command(command)
    
    def set_view(self, view_settings):
        """Set the viewing angle and parameters
        
        Args:
            view_settings (str): PyMOL view settings
            
        Returns:
            str: Status message
        """
        command = f"set_view {view_settings}"
        return self.send_command(command)
    
    def colorize(self, selection, color_scheme):
        """Apply a color scheme to a selection
        
        Args:
            selection (str): The PyMOL selection to colorize
            color_scheme (str): The color scheme to apply
            
        Returns:
            str: Status message
        """
        command = f"color {color_scheme}, {selection}"
        return self.send_command(command)
    
    def represent(self, representation, selection="all"):
        """Change the representation of a selection
        
        Args:
            representation (str): The representation type (cartoon, stick, etc.)
            selection (str): The PyMOL selection to change
            
        Returns:
            str: Status message
        """
        command = f"{representation} {selection}"
        return self.send_command(command)