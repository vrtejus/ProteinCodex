const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  captureScreen: (windowTitle) => ipcRenderer.invoke('capture-screen', windowTitle),
  sendToPyMOL: (command) => ipcRenderer.invoke('send-to-pymol', command), // Keep if needed
  // --- STT Channels ---
  // Renamed for clarity, now explicitly sets state based on renderer logic
  setVoiceModeActive: (isActive) => ipcRenderer.send('stt:set-voice-mode-active', isActive),
  startTranscription: () => ipcRenderer.send('stt:start-transcription'),
  stopTranscription: (sendFinal) => ipcRenderer.send('stt:stop-transcription', sendFinal), // Add flag? Maybe not needed if renderer sends
  onVoiceStateChange: (callback) => ipcRenderer.on('stt:state-change', (_event, state) => callback(state)), // state: {isGloballyActive (maybe?), isTranscribing}
  onSttInterimResult: (callback) => ipcRenderer.on('stt:interim-result', (_event, transcript) => callback(transcript)),
  onSttFinalResult: (callback) => ipcRenderer.on('stt:final-result', (_event, transcript) => callback(transcript)),
  onSttError: (callback) => ipcRenderer.on('stt:error', (_event, error) => callback(error)),
});

// Expose ipcRenderer partially if needed for other things (use with caution)