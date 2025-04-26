/**
 * PyMOL UI component for ProteinCodex
 * Handles visualization and PyMOL interaction
 */
class PyMOLUI {
    constructor() {
        // DOM elements
        this.visualizationPanel = document.getElementById('visualization-panel');
        this.togglePanelButton = document.getElementById('toggle-panel-btn');
        this.refreshViewButton = document.getElementById('refresh-view-btn');
        this.captureViewButton = document.getElementById('capture-view-btn');
        this.analyzeViewButton = document.getElementById('analyze-view-btn');
        this.pymolScreenshot = document.getElementById('pymol-screenshot');
        this.screenshotTimestamp = document.getElementById('screenshot-timestamp');
        
        // State
        this.isPanelVisible = true;
        this.lastScreenshotPath = null;
        
        // Initialize
        this.initEventListeners();
    }
    
    /**
     * Initialize event listeners
     */
    initEventListeners() {
        // Toggle panel visibility
        this.togglePanelButton.addEventListener('click', () => this.togglePanel());
        
        // Refresh view button
        this.refreshViewButton.addEventListener('click', () => this.refreshView());
        
        // Capture view button
        this.captureViewButton.addEventListener('click', () => {
            window.electronAPI.captureScreen('PyMOL')
                .then(result => {
                    this.updateScreenshot(result.path);
                    chatUI.lastScreenshotPath = result.path;
                })
                .catch(error => console.error('Error capturing view:', error));
        });
        
        // Analyze view button
        this.analyzeViewButton.addEventListener('click', () => {
            if (this.lastScreenshotPath) {
                chatUI.chatInput.value = 'Analyze this protein structure and describe what you see.';
                chatUI.autoResizeInput();
                chatUI.sendMessage();
            } else {
                alert('Please capture a screenshot first');
            }
        });
    }
    
    /**
     * Toggle panel visibility
     */
    togglePanel() {
        this.isPanelVisible = !this.isPanelVisible;
        
        if (this.isPanelVisible) {
            this.visualizationPanel.classList.remove('collapsed');
            this.togglePanelButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
        } else {
            this.visualizationPanel.classList.add('collapsed');
            this.togglePanelButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
        }
    }
    
    /**
     * Refresh PyMOL view (capture new screenshot)
     */
    refreshView() {
        window.electronAPI.captureScreen('PyMOL')
            .then(result => this.updateScreenshot(result.path))
            .catch(error => console.error('Error refreshing view:', error));
    }
    
    /**
     * Update screenshot in UI
     * @param {string} path - Path to screenshot
     */
    updateScreenshot(path) {
        if (!path) return;
        
        this.lastScreenshotPath = path;
        
        // Update image
        this.pymolScreenshot.src = `file://${path}`;
        
        // Update timestamp
        const now = new Date();
        this.screenshotTimestamp.innerText = `Captured at ${now.toLocaleTimeString()}`;
    }
    
    /**
     * Run a PyMOL command
     * @param {string} command - PyMOL command to execute
     * @returns {Promise} - Result of command execution
     */
    async runCommand(command) {
        try {
            const result = await api.executePyMOL(command);
            
            // Refresh view after command
            this.refreshView();
            
            return result;
        } catch (error) {
            console.error('Error running PyMOL command:', error);
            throw error;
        }
    }
}

// Create PyMOL UI instance
const pymolUI = new PyMOLUI();

// Expose electron API for renderer process
window.electronAPI = {
    captureScreen: (windowTitle) => {
        return window.ipcRenderer.invoke('capture-screen', windowTitle);
    },
    sendToPyMOL: (command) => {
        return window.ipcRenderer.invoke('send-to-pymol', command);
    }
};
