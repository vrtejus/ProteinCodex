import os
import time
import datetime
import pyautogui
from PIL import Image
import sys

def capture_screenshot(window_title="PyMOL", save_dir=None):
    """Capture a screenshot of the PyMOL window
    
    Args:
        window_title (str): Title of the PyMOL window (for future window-specific capture)
        save_dir (str): Directory to save the screenshot. If None, uses a temp directory
        
    Returns:
        str: Path to the saved screenshot
    """
    try:
        # Create screenshot directory if it doesn't exist
        if save_dir is None:
            # Use a temp directory based on the user's home folder
            home_dir = os.path.expanduser("~")
            save_dir = os.path.join(home_dir, "ProteinCodex", "screenshots")
        
        os.makedirs(save_dir, exist_ok=True)
        
        # Generate a unique filename with timestamp
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"pymol_screenshot_{timestamp}.png"
        filepath = os.path.join(save_dir, filename)
        
        # Take the screenshot
        # Note: In a production app, you would need platform-specific code
        # to focus and capture only the PyMOL window
        
        # For now, we'll use a basic full-screen capture
        # with a small delay to allow for window switching
        time.sleep(0.5)  # Allow time to switch to the PyMOL window
        
        # Capture the screen
        screenshot = pyautogui.screenshot()
        screenshot.save(filepath)
        
        print(f"Screenshot saved to {filepath}")
        return filepath
        
    except Exception as e:
        print(f"Error capturing screenshot: {str(e)}", file=sys.stderr)
        raise

def get_screenshot_region(window_title="PyMOL"):
    """
    Future implementation: Get the region of the screen containing the PyMOL window
    This would need to use platform-specific window management functions
    """
    # This is a placeholder for future implementation
    # For now, we'd return coordinates for the entire screen
    
    screen_width, screen_height = pyautogui.size()
    return (0, 0, screen_width, screen_height)