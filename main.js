const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.loadFile('frontend/index.html');

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Handle screenshot capture request
ipcMain.handle('capture-screen', async (event, windowTitle) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1280, height: 800 }
    });
    
    // Find window by title (PyMOL)
    const source = sources.find(source => source.name.includes(windowTitle));
    
    if (!source) {
      throw new Error(`Window with title containing "${windowTitle}" not found`);
    }
    
    // Save screenshot
    const timestamp = Date.now();
    const screenshotPath = path.join(app.getPath('temp'), `pymol-screenshot-${timestamp}.png`);
    
    // Convert NativeImage to buffer and save
    fs.writeFileSync(screenshotPath, source.thumbnail.toPNG());
    
    // Upload to backend
    const formData = new FormData();
    formData.append('image', fs.createReadStream(screenshotPath));
    
    const response = await axios.post('http://localhost:5000/api/analyze-image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    return {
      path: screenshotPath,
      analysisResult: response.data
    };
  } catch (error) {
    console.error('Error capturing screen:', error);
    throw error;
  }
});

// Send command to PyMOL
ipcMain.handle('send-to-pymol', async (event, command) => {
  try {
    const response = await axios.post('http://localhost:5000/api/execute-pymol', {
      command: command
    });
    return response.data;
  } catch (error) {
    console.error('Error sending command to PyMOL:', error);
    throw error;
  }
});
