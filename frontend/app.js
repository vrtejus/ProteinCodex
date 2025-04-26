/**
 * Main application entry point
 */
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're running in Electron
    const isElectron = () => {
        return window && window.process && window.process.type;
    };

    // Initialize the app
    initApp();

    function initApp() {
        console.log('Initializing ProteinCodex application...');
        
        // Add welcome message
        if (window.chatComponent) {
            window.chatComponent.addMessage(
                'Welcome to ProteinCodex! You can ask questions about protein structures, ' + 
                'enter PyMOL commands, or analyze protein images. Try loading a structure from ' +
                'the sidebar to get started.', 
                'ai'
            );
        }
        
        // Set up IPC if running in Electron
        if (isElectron()) {
            setupIPC();
        }
    }
    
    function setupIPC() {
        // Make sure we have access to the Electron IPC renderer
        const { ipcRenderer } = window.require('electron');
        
        // Listen for backend messages
        ipcRenderer.on('backend-message', (event, message) => {
            console.log('Message from backend:', message);
            
            if (window.chatComponent) {
                window.chatComponent.addMessage(message, 'ai');
            }
        });
        
        // Send a message to the backend to indicate the renderer is ready
        ipcRenderer.send('renderer-ready');
    }
});