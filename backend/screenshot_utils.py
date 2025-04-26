import os
import base64
import time
from PIL import Image, ImageGrab
import io
import cv2
import numpy as np
from datetime import datetime

def capture_window_by_title(window_title):
    """
    This is a placeholder since direct window capture by title is platform-specific.
    In a real implementation, you'd use platform-specific libraries:
    - Windows: win32gui, win32ui
    - macOS: Quartz, Cocoa
    - Linux: Xlib, GTK
    
    For this example, we'll assume PyMOL is the active window and capture the entire screen.
    """
    try:
        # This is a simplified approach - in reality, you'd need platform-specific code
        screenshot = ImageGrab.grab()
        return screenshot
    except Exception as e:
        print(f"Error capturing window: {str(e)}")
        return None

def save_screenshot(window_title="PyMOL", output_dir="temp"):
    """
    Capture a screenshot of a window with the given title and save it to a file.
    Returns the path to the saved screenshot.
    """
    try:
        # Create output directory if it doesn't exist
        os.makedirs(output_dir, exist_ok=True)
        
        # Capture the window
        screenshot = capture_window_by_title(window_title)
        
        if screenshot is None:
            return None
        
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{window_title.replace(' ', '_')}_{timestamp}.png"
        filepath = os.path.join(output_dir, filename)
        
        # Save the screenshot
        screenshot.save(filepath, "PNG")
        
        return filepath
    except Exception as e:
        print(f"Error saving screenshot: {str(e)}")
        return None

def encode_image_base64(image_path):
    """
    Convert an image file to a base64 string.
    """
    try:
        with open(image_path, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
            return encoded_string
    except Exception as e:
        print(f"Error encoding image: {str(e)}")
        return None

def decode_base64_image(base64_string):
    """
    Convert a base64 string to a PIL Image.
    """
    try:
        image_data = base64.b64decode(base64_string)
        image = Image.open(io.BytesIO(image_data))
        return image
    except Exception as e:
        print(f"Error decoding image: {str(e)}")
        return None
