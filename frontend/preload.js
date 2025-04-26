const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  captureScreen: (windowTitle) => ipcRenderer.invoke('capture-screen', windowTitle),
  sendToPyMOL: (command) => ipcRenderer.invoke('send-to-pymol', command), // Keep if needed
  // --- STT Channels ---
  toggleVoiceMode: () => ipcRenderer.send('stt:toggle-voice-mode'),
  startTranscription: () => ipcRenderer.send('stt:start-transcription'),
  stopTranscription: () => ipcRenderer.send('stt:stop-transcription'),
  onVoiceStateChange: (callback) => ipcRenderer.on('stt:state-change', (_event, state) => callback(state)), // state: {isActive, isTranscribing}
  onSttInterimResult: (callback) => ipcRenderer.on('stt:interim-result', (_event, transcript) => callback(transcript)),
  onSttFinalResult: (callback) => ipcRenderer.on('stt:final-result', (_event, transcript) => callback(transcript)),
  onSttError: (callback) => ipcRenderer.on('stt:error', (_event, error) => callback(error)),
});

// Expose ipcRenderer partially if needed for other things (use with caution)