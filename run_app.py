import os
import sys
import subprocess
import time
import webbrowser
import signal

def start_server():
    print("Starting Flask server...")
    server_process = subprocess.Popen(
        ["python", "backend/server.py"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    time.sleep(2)  # Give the server time to start
    return server_process

def start_electron():
    print("Starting Electron app...")
    electron_process = subprocess.Popen(
        ["npm", "start"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    return electron_process

def main():
    # Start the Flask server
    server_process = start_server()
    
    # Start the Electron app
    electron_process = start_electron()
    
    try:
        # Wait for both processes
        server_process.wait()
        electron_process.wait()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server_process.terminate()
        electron_process.terminate()
        server_process.wait()
        electron_process.wait()

if __name__ == "__main__":
    main()