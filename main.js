const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net'); // Added for Unix sockets
const { spawn, ChildProcess } = require('child_process'); // Added for spawning helper
const os = require('os'); // Added to generate socket path

let mainWindow;

// --- STT State Management ---
let isVoiceModeActive = false;
let isTranscribing = false;

// --- Native Helper Process Management ---
let speechHelperProcess = null; // Reference to the spawned process
let speechServerSocketPath = path.join(os.tmpdir(), `proteincodex-stt-${Date.now()}.sock`); // Unique socket path
let sttSocketClient = null; // Our client connection TO the helper's server
let sttConnectionRetryTimeout = null;
const HELPER_APP_NAME = 'SpeechHelper'; // Name of the compiled Swift executable
const HELPER_PATH = path.join(app.getAppPath(), 'native', HELPER_APP_NAME); // EXPECTED location after build/packaging
const DEV_HELPER_PATH = path.join(__dirname, 'native', HELPER_APP_NAME); // Location during development

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'frontend/preload.js'),
      additionalArguments: [`--app-path=${app.getAppPath()}`]
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'frontend/index.html'));

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
    terminateSpeechHelper(); // Clean up helper when window closes
  });
}

app.whenReady().then(() => {
  // Attempt to spawn the native helper process on startup
  console.log('App ready, spawning speech helper...');
  spawnSpeechHelper();

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
  // Ensure helper is terminated on quit
  terminateSpeechHelper();
});

// --- IPC Handlers ---


// Handle screenshot capture request
ipcMain.handle('capture-screen', async (event, windowTitle) => {
  try {
    const displays = screen.getAllDisplays();
    const primaryDisplay = displays[0]; // Get primary display

    // Get list of window sources
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: {
        width: primaryDisplay.size.width,
        height: primaryDisplay.size.height
      }
    });

    // Find the PyMOL window
    const pymolSource = sources.find(source => source.name.includes(windowTitle));

    if (!pymolSource) {
      throw new Error(`Window "${windowTitle}" not found`);
    }

    // Save the screenshot to disk
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const screenshotPath = path.join(tempDir, `screenshot_${timestamp}.png`);

    // Get the thumbnail/image from the source
    const image = pymolSource.thumbnail;
    fs.writeFileSync(screenshotPath, image.toPNG());
    console.log(`Screenshot saved to: ${screenshotPath}`);

    // Return path only
    return {
      path: screenshotPath
    };

  } catch (error) {
    // Rethrow the error so the frontend promise rejects correctly
    console.error('Error capturing screen in main.js:', error.message);
    throw new Error(`Screen capture failed: ${error.message}`);
  }
});

// Send command to PyMOL (Keep if used)
ipcMain.handle('send-to-pymol', async (event, command) => {
  // Still potentially useful for direct /pymol commands if implemented
  try {
    const axios = require('axios'); // require it here if only used here
    const response = await axios.post('http://localhost:5001/api/execute-pymol', { // Use correct port
      command: command
    });
    if (!response || !response.data) {
        throw new Error("No response data from backend");
    }
    return response.data;
  } catch (error) {
    console.error('Error sending command to PyMOL:', error);
    throw error;
  }
});

// --- STT IPC Handlers ---

// Renderer now tells main the desired state, main doesn't toggle blindly
// We might not even need this if main only cares about start/stop commands
// ipcMain.on('stt:set-voice-mode-active', (event, isActive) => {
//     console.log(`Main: Received set-voice-mode-active: ${isActive}`);
//     // If turning off while transcribing, stop it
//     if (!isActive && isTranscribing) {
//         console.log("Main: Voice mode deactivated during transcription, stopping helper.");
//         stopNativeTranscription(); // Stop helper
//         isTranscribing = false; // Update internal state
//     }
//     // We don't strictly need to track isActive in main if renderer manages it,
//     // but could be useful for future logic.
//     // isVoiceModeActive = isActive;
//     sendVoiceStateUpdate(event.sender); // Acknowledge state change back? Maybe not needed.
// });

ipcMain.on('stt:start-transcription', (event) => {
    const sender = event.sender;
    if (!isTranscribing) { // Prevent multiple starts
        console.log("Main: Received start-transcription. Sending command to helper.");
        if (sttSocketClient && !sttSocketClient.destroyed) {
            if(sendToSpeechHelper({ command: 'start' })) {
                isTranscribing = true; // Update main process state
                sendVoiceStateUpdate(sender); // Notify renderer transcribing started
            } else {
                console.error("Main: Failed to send 'start' command to helper.");
                sendSttError("Failed to send start command to speech helper.");
                // Reset state
                isTranscribing = false;
                sendVoiceStateUpdate(); // Send reset state back
            }
        } else {
            console.error("Main: Cannot start transcription, no connection to speech helper.");
            sendSttError("Not connected to speech recognition service.");
            isTranscribing = false; // Ensure state is correct
            sendVoiceStateUpdate();
        }
    } else {
         console.log("Main: Ignored start-transcription (already transcribing)");
    }
});

ipcMain.on('stt:request-stop-transcription', (event) => { // Renamed handler
    if (isTranscribing) {
        console.log("Main: Received stop-transcription. Sending command to helper.");
        // The helper sending 'finalResult' will trigger the state update now
        // We don't set isTranscribing = false here anymore. It's set when the helper
        // confirms the end by sending 'finalResult' or 'error'.
        // sendVoiceStateUpdate(sender); // Optional: Update UI faster? Might cause flicker.
        // Tell the helper to stop processing audio for this request
        if (sttSocketClient && !sttSocketClient.destroyed) {
            sendToSpeechHelper({ command: 'stop' }); // Send stop command
        } else {
             console.warn("Main: Cannot send 'stop' command, no connection to speech helper.");
        }
    } else {
        console.log("Main: Ignored stop-transcription (was not transcribing)");
    }
});

// Helper to send state updates to renderer
function sendToRenderer(channel, ...args) {
     if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
         mainWindow.webContents.send(channel, ...args);
     } else {
         console.log(`Main: Cannot send to renderer on channel ${channel}, window not available.`);
     }
}

function sendVoiceStateUpdate() { // Removed webContents arg, sends to mainWindow
    sendToRenderer('stt:state-change', { isTranscribing: isTranscribing }); // Only send isTranscribing? isActive is renderer-managed
}

function sendSttError(errorMessage) { // Removed webContents arg
     console.error("Main: Sending STT Error to renderer:", errorMessage);
     sendToRenderer('stt:error', errorMessage);
}

// --- Native Helper Process and Socket Communication ---

function getHelperPath() {
    // Check if running in development or packaged app
    const devPath = path.join(__dirname, 'native', HELPER_APP_NAME);
    // In a packaged app, __dirname might be inside an asar archive.
    // A common pattern is to place native binaries in the app's root or a specific dir.
    // Adjust this based on your electron-builder config (e.g., extraResources)
    const prodPath = path.join(app.getAppPath(), 'native', HELPER_APP_NAME);
    const resourcesPath = path.join(process.resourcesPath, 'native', HELPER_APP_NAME); // Alternative for packaged apps

    if (fs.existsSync(devPath)) {
        console.log("Using DEV helper path:", devPath);
        return devPath;
    } else if (fs.existsSync(prodPath)) {
         console.log("Using PROD (app path) helper path:", prodPath);
         return prodPath;
    } else if (fs.existsSync(resourcesPath)) {
        console.log("Using PROD (resources) helper path:", resourcesPath);
        return resourcesPath;
    } else {
        console.error("Speech Helper executable not found at expected locations:", [devPath, prodPath, resourcesPath]);
        return null; // Indicate not found
    }
}

function spawnSpeechHelper() {
    if (speechHelperProcess) {
        console.log('Speech helper process already running.');
        return;
    }

    const helperExecutablePath = getHelperPath();
    if (!helperExecutablePath) {
        sendSttError("Native speech helper application not found.");
        return;
    }

    console.log(`Spawning speech helper: ${helperExecutablePath} with socket: ${speechServerSocketPath}`);
    try {
        // Ensure socket doesn't exist from previous run
        if (fs.existsSync(speechServerSocketPath)) {
            fs.unlinkSync(speechServerSocketPath);
        }

        speechHelperProcess = spawn(helperExecutablePath, [speechServerSocketPath], {
            stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, pipe stdout/stderr
        });

        speechHelperProcess.stdout.on('data', (data) => {
            console.log(`[SpeechHelper STDOUT]: ${data.toString().trim()}`);
        });

        speechHelperProcess.stderr.on('data', (data) => {
            console.error(`[SpeechHelper STDERR]: ${data.toString().trim()}`);
            // Maybe send critical errors to renderer?
             // sendSttError(`Helper Error: ${data.toString().trim()}`);
        });

        speechHelperProcess.on('spawn', () => {
             console.log('Speech helper process spawned successfully.');
             // Attempt to connect after a short delay
             setTimeout(connectToSpeechHelper, 1000); // Give helper time to start server
        });

        speechHelperProcess.on('error', (err) => {
            console.error('Failed to start speech helper process:', err);
            speechHelperProcess = null;
            sendSttError(`Failed to start speech helper: ${err.message}`);
        });

        speechHelperProcess.on('close', (code, signal) => {
            console.log(`Speech helper process closed with code ${code}, signal ${signal}`);
            speechHelperProcess = null;
            if (sttSocketClient) {
                sttSocketClient.destroy();
                sttSocketClient = null;
            }
            // Optionally try to restart it or notify user
             if (code !== 0 && signal !== 'SIGTERM') { // Don't show error if terminated normally
                 sendSttError(`Speech helper exited unexpectedly (code: ${code}).`);
             }
        });

    } catch (error) {
         console.error("Error spawning speech helper:", error);
         sendSttError(`Error spawning speech helper: ${error.message}`);
    }
}

function connectToSpeechHelper() {
    if (sttSocketClient && !sttSocketClient.destroyed) {
        console.log("Already connected/connecting to speech helper.");
        return;
    }
    if (!fs.existsSync(speechServerSocketPath)) {
         console.warn(`Socket path ${speechServerSocketPath} does not exist yet, helper might be slow starting. Retrying in 2s...`);
         clearTimeout(sttConnectionRetryTimeout);
         sttConnectionRetryTimeout = setTimeout(connectToSpeechHelper, 2000);
         return;
    }

    console.log(`Attempting to connect to socket: ${speechServerSocketPath}`);
    sttSocketClient = net.createConnection(speechServerSocketPath);

    let receivedDataBuffer = '';

    sttSocketClient.on('connect', () => {
        console.log('Connected to speech helper socket.');
        clearTimeout(sttConnectionRetryTimeout); // Clear retry timer on success
        // Optionally send a ready message or initial config to helper here
        // sendToSpeechHelper({ command: 'config', data: { lang: 'en-US' }});
    });

    sttSocketClient.on('data', (data) => {
        const receivedString = data.toString('utf-8');
        receivedDataBuffer += receivedString;
        console.log(`Socket data received (Buffer: ${receivedDataBuffer.length} bytes)`);

        // Process buffer for complete JSON messages (newline-delimited)
        let boundary = receivedDataBuffer.indexOf('\n');
        while (boundary !== -1) {
            const jsonString = receivedDataBuffer.substring(0, boundary).trim();
            receivedDataBuffer = receivedDataBuffer.substring(boundary + 1); // Consume message + newline

            if (jsonString) {
                try {
                    const message = JSON.parse(jsonString);
                    console.log("[From Helper]:", JSON.stringify(message)); // Log parsed object
                    // Process message from helper
                    switch (message.type) {
                        case 'interimResult':
                            if (typeof message.transcript === 'string')
                            sendToRenderer('stt:interim-result', message.transcript);
                            break;
                        case 'finalResult':
                            // Helper indicates it's done with *this* transcription
                            if (typeof message.transcript === 'string')
                            isTranscribing = false; // Update state based on helper signal
                            sendVoiceStateUpdate();
                            sendToRenderer('stt:final-result', message.transcript);
                            break;
                        case 'error':
                             isTranscribing = false; // Assume error stops transcription
                             isVoiceModeActive = false; // Turn off voice mode on error
                             sendVoiceStateUpdate();
                             sendSttError(message.message || "Unknown error from speech helper.");
                             break;
                        case 'ready': // Optional: Helper signals it's ready
                             console.log("Speech helper signaled ready.");
                             break;
                         default:
                            console.warn("Received unknown message type from helper:", message.type);
                    }
                } catch (e) {
                    console.error('Main: Error parsing JSON from speech helper:', e);
                    console.error('Received string:', jsonString);
                }
            }
            boundary = receivedDataBuffer.indexOf('\n'); // Check for next message boundary in the remaining buffer
        }
    });

    sttSocketClient.on('error', (err) => {
        console.error('Speech helper socket error:', err.message);
        // Attempt to reconnect or notify user
        sendSttError(`Connection error with speech helper: ${err.message}`);
        // Deactivate voice mode on error
        isTranscribing = false;
        sendVoiceStateUpdate();
        if (sttSocketClient) sttSocketClient.destroy(); // Ensure cleanup
        sttSocketClient = null; // Reset client
        // Optionally try respawning helper
        // terminateSpeechHelper(); spawnSpeechHelper();
        // Or retry connection after delay
        clearTimeout(sttConnectionRetryTimeout);
        sttConnectionRetryTimeout = setTimeout(connectToSpeechHelper, 5000); // Retry after 5s
    });

    sttSocketClient.on('close', () => {
        console.log('Speech helper socket connection closed.');
        if (isTranscribing || isVoiceModeActive) {
             sendSttError("Connection to speech helper closed unexpectedly.");
             // Reset state if connection drops mid-action
        isTranscribing = false;
        sendVoiceStateUpdate();
         }
        sttSocketClient = null; // Ensure client is nulled
        // unless helper process is still running (indicates socket issue)
        if (speechHelperProcess && !speechHelperProcess.killed) {
            console.log("Helper process still running but socket closed, attempting reconnect...");
             clearTimeout(sttConnectionRetryTimeout);
            sttConnectionRetryTimeout = setTimeout(connectToSpeechHelper, 5000);
        }
    });
}

function sendToSpeechHelper(message) {
    if (sttSocketClient && !sttSocketClient.destroyed) {
        try {
            const jsonMessage = JSON.stringify(message);
            console.log(`[To Helper]: ${jsonMessage}`);
            sttSocketClient.write(jsonMessage + '\n'); // Add newline delimiter
            return true;
        } catch (error) {
             console.error("Failed to stringify/send message to helper:", error);
             return false;
        }
    } else {
        console.warn('Cannot send message, not connected to speech helper.');
        return false;
    }
}

function terminateSpeechHelper() {
    console.log('Terminating speech helper process...');
    clearTimeout(sttConnectionRetryTimeout); // Stop connection retries
    if (sttSocketClient) {
        sttSocketClient.destroy(); // Close socket connection
        sttSocketClient = null;
    }
    if (speechHelperProcess) {
        speechHelperProcess.kill('SIGTERM'); // Send termination signal
        speechHelperProcess = null;
        console.log('Speech helper process sent SIGTERM.');
    }
     // Clean up socket file (optional, might be useful for debugging)
    // try {
    //     if (fs.existsSync(speechServerSocketPath)) {
    //         fs.unlinkSync(speechServerSocketPath);
    //         console.log('Cleaned up socket file.');
    //     }
    // } catch (error) {
    //     console.error("Error removing socket file:", error);
    // }
}

// --- End Native Helper & Socket Comm ---