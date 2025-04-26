const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
// const axios = require('axios'); // Keep if used elsewhere, not needed for STT simulation

let mainWindow;
let isVoiceModeActive = false;
let isTranscribing = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'frontend/preload.js'), // Use a preload script
      contextIsolation: true, // Recommended for security
      nodeIntegration: false,  // Keep false
      // enableRemoteModule: false // Disable remote module
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'frontend/index.html'));

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // --- NATIVE STT INITIALIZATION (Simulated) ---
  initializeNativeSTT(); // Placeholder call

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handlers ---

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
    console.log(`Screenshot saved to: ${screenshotPath}`);

    // NOTE: Removed automatic backend analysis upload from capture.
    // Frontend now controls when to send the path for analysis.
    // const formData = new FormData();
    // formData.append('image', fs.createReadStream(screenshotPath));
    // const response = await axios.post('http://localhost:5001/api/analyze-image', formData, { // Use correct port
    //   headers: {
    //     // axios sets Content-Type automatically for FormData
    //   }
    // });

    // Return path only
    return {
      path: screenshotPath
      // analysisResult: response.data
    };
  } catch (error) {
    console.error('Error capturing screen:', error);
    throw error;
  }
});

// Send command to PyMOL (Keep if used)
ipcMain.handle('send-to-pymol', async (event, command) => {
  // This might be less relevant now if using Gemini function calling for PyMOL
  try {
    // Use axios if you added it back, or node's http/https, or node-fetch
    // Example using hypothetical axios post
    const axios = require('axios'); // require it here if only used here
    const response = await axios.post('http://localhost:5001/api/execute-pymol', { // Use correct port
      command: command
    });
    return response.data;
  } catch (error) {
    console.error('Error sending command to PyMOL:', error);
    // Rethrow or return error structure
    throw new Error(`Failed to send command to PyMOL: ${error.message}`);
  }
});

// --- STT IPC Handlers ---

ipcMain.on('stt:toggle-voice-mode', (event) => {
    isVoiceModeActive = !isVoiceModeActive;
    isTranscribing = false; // Ensure transcribing stops if mode is toggled off
    console.log(`Voice Mode Toggled: ${isVoiceModeActive}`);
    if (!isVoiceModeActive) {
        // Conceptually tell native layer to stop listening if it was active but not transcribing
        stopNativeTranscription(); // Call simulation/placeholder
    }
    // Send updated state back to all windows (or just the sender)
    sendVoiceStateUpdate(event.sender);
});

ipcMain.on('stt:start-transcription', (event) => {
    if (isVoiceModeActive && !isTranscribing) {
        console.log("Main: Received start-transcription");
        isTranscribing = true;
        sendVoiceStateUpdate(event.sender);
        // --- Call NATIVE layer to start (Simulated) ---
        startNativeTranscription();
    } else {
         console.log("Main: Ignored start-transcription (voice mode inactive or already transcribing)");
    }
});

ipcMain.on('stt:stop-transcription', (event) => {
    if (isTranscribing) {
        console.log("Main: Received stop-transcription");
        isTranscribing = false;
        // Update UI immediately (listening active, but not transcribing)
        sendVoiceStateUpdate(event.sender);
        // --- Call NATIVE layer to stop (Simulated) ---
        stopNativeTranscription();
        // The native layer should eventually call onFinalResult or onError
    } else {
        console.log("Main: Ignored stop-transcription (was not transcribing)");
    }
});

// Helper to send state updates to renderer
function sendVoiceStateUpdate(webContents) {
    if (webContents && !webContents.isDestroyed()) {
        webContents.send('stt:state-change', { isActive: isVoiceModeActive, isTranscribing: isTranscribing });
    }
}

// --- NATIVE STT SIMULATION ---

let nativeSTT_initialized = false;
let nativeSTT_interimTimer = null;
let nativeSTT_finalTranscript = "";

function initializeNativeSTT() {
    console.log("[Native STT Sim]: Initializing...");
    // Placeholder: In reality, check permissions, load engine etc.
    // On macOS, microphone permission is usually requested on first use by the OS/framework.
    nativeSTT_initialized = true;
    console.log("[Native STT Sim]: Initialized.");
    // Optionally send 'stt-ready' to frontend here
}

function startNativeTranscription() {
    if (!nativeSTT_initialized || !mainWindow) return;
    console.log("[Native STT Sim]: Starting Transcription...");
    nativeSTT_finalTranscript = ""; // Reset
    let counter = 0;
    const simulatedWords = ["Loading", "1HPV", "into", "PyMOL", "now", ".", "Showing", "cartoon", "representation", "."];
    nativeSTT_interimTimer = setInterval(() => {
        if (!isTranscribing) { // Check main process state
             clearInterval(nativeSTT_interimTimer);
             return;
        }
        counter++;
        const interim = simulatedWords.slice(0, counter % (simulatedWords.length + 1)).join(" ");
        nativeSTT_finalTranscript = interim; // Keep track for final result
        console.log("[Native STT Sim]: Sending interim result:", interim);
        if(mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stt:interim-result', interim);
    }, 700); // Simulate word appearing every 700ms
}

function stopNativeTranscription() {
    if (!nativeSTT_initialized || !mainWindow) return;
    console.log("[Native STT Sim]: Stopping Transcription...");
    if (nativeSTT_interimTimer) {
        clearInterval(nativeSTT_interimTimer);
        nativeSTT_interimTimer = null;
    }
    // Send the last generated transcript as final result
    const finalResult = nativeSTT_finalTranscript;
    console.log("[Native STT Sim]: Sending final result:", finalResult);
    if(mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stt:final-result', finalResult);

    // Simulate potential error (uncomment to test)
    // if(mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stt:error', "Simulated engine failure.");
}

function simulateNativeError() { // Helper to test error path
    if (!nativeSTT_initialized || !mainWindow) return;
    console.log("[Native STT Sim]: Simulating an error...");
    if (nativeSTT_interimTimer) {
        clearInterval(nativeSTT_interimTimer);
        nativeSTT_interimTimer = null;
    }
    isTranscribing = false; // Ensure state is reset
    isVoiceModeActive = false;
    sendVoiceStateUpdate(mainWindow.webContents);
    if(mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stt:error', "Simulated STT Engine Error");
}

// --- End STT Simulation ---