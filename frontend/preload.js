const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  captureScreen: (windowTitle) => ipcRenderer.invoke('capture-screen', windowTitle),
  sendToPyMOL: (command) => ipcRenderer.invoke('send-to-pymol', command),
  // --- STT Channels ---
  // Renderer manages active state locally now, main process only cares about transcription on/off
  // setVoiceModeActive: (isActive) => ipcRenderer.send('stt:set-voice-mode-active', isActive), // Removed
  startTranscription: () => ipcRenderer.send('stt:start-transcription'),
  requestStopTranscription: () => ipcRenderer.send('stt:stop-transcription'),
  // Renamed for clarity, only sends isTranscribing state now
  onTranscriptionStateChange: (callback) => ipcRenderer.on('stt:transcription-state-change', (_event, isTranscribing) => callback(isTranscribing)),
  onSttInterimResult: (callback) => ipcRenderer.on('stt:interim-result', (_event, transcript) => callback(transcript)), // Keep as is
  onSttFinalResult: (callback) => ipcRenderer.on('stt:final-result', (_event, transcript) => callback(transcript)),
  onSttError: (callback) => ipcRenderer.on('stt:error', (_event, error) => callback(error)), // Keep as is
});