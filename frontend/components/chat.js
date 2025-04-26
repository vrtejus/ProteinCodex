/**
 * Chat component for ProteinCodex
 * Handles chat UI and message exchange
 */
class ChatUI {
    constructor() {
        // DOM elements
        this.messagesContainer = document.getElementById('chat-messages');
        this.chatInput = document.getElementById('chat-input');
        this.sendButton = document.getElementById('send-btn');
        this.newChatButton = document.getElementById('new-chat-btn');
        this.chatHistory = document.getElementById('chat-history');
        this.captureButton = document.getElementById('capture-btn');
        
        // State
        this.isProcessing = false;
        this.chatId = Date.now().toString();
        this.lastScreenshotPath = null;
        
        // Initialize
        this.initEventListeners();
        this.autoResizeInput();
    }
    
    /**
     * Initialize event listeners
     */
    initEventListeners() {
        // Send message on button click
        this.sendButton.addEventListener('click', () => this.sendMessage());
        
        // Send message on Enter key (but allow Shift+Enter for new line)
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Handle new chat button
        this.newChatButton.addEventListener('click', () => this.startNewChat());
        
        // Handle sample prompts
        document.querySelectorAll('.prompt-item').forEach(item => {
            item.addEventListener('click', () => {
                const prompt = item.getAttribute('data-prompt');
                this.chatInput.value = prompt;
                this.chatInput.focus();
                this.autoResizeInput();
            });
        });
        
        // Handle image capture button
        this.captureButton.addEventListener('click', () => this.captureScreenshot());
    }
    
    /**
     * Auto-resize the input textarea
     */
    autoResizeInput() {
        this.chatInput.style.height = 'auto';
        this.chatInput.style.height = (this.chatInput.scrollHeight) + 'px';
        
        this.chatInput.addEventListener('input', () => {
            this.chatInput.style.height = 'auto';
            this.chatInput.style.height = (this.chatInput.scrollHeight) + 'px';
        });
    }
    
    /**
     * Send a message to the API
     */
    async sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message || this.isProcessing) return;
        
        this.isProcessing = true;
        
        // Add user message to UI
        this.addMessageToUI('user', message);
        
        // Clear input
        this.chatInput.value = '';
        this.chatInput.style.height = 'auto';
        
        // Show typing indicator
        const typingIndicator = this.addTypingIndicator();
        
        try {
            let response;
            
            // Check if it's a PyMOL command
            if (message.startsWith('/pymol ')) {
                const command = message.substring(7);
                const result = await api.executePyMOL(command);
                response = {
                    response: `PyMOL executed: ${command}\nResult: ${JSON.stringify(result.result)}`
                };
                
                // Refresh PyMOL view after command
                pymolUI.refreshView();
            } else {
                // Regular chat message
                response = await api.sendMessage(message, this.lastScreenshotPath);
                this.lastScreenshotPath = null; // Clear after use
            }
            
            // Remove typing indicator
            this.messagesContainer.removeChild(typingIndicator);
            
            // Add assistant response to UI
            this.addMessageToUI('assistant', response.response);
            
            // Add chat to history if it's a new chat
            if (this.messagesContainer.querySelectorAll('.message').length === 2) {
                this.addChatToHistory(message);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            
            // Remove typing indicator
            this.messagesContainer.removeChild(typingIndicator);
            
            // Add error message
            this.addMessageToUI('assistant', `Error: ${error.message}`);
        } finally {
            this.isProcessing = false;
            this.scrollToBottom();
        }
    }
    
    /**
     * Add a message to the UI
     * @param {string} role - 'user' or 'assistant'
     * @param {string} content - Message content
     */
    addMessageToUI(role, content) {
        // Remove intro message if present
        const introMessage = this.messagesContainer.querySelector('.intro-message');
        if (introMessage) {
            this.messagesContainer.removeChild(introMessage);
        }
        
        // Create message element
        const messageEl = document.createElement('div');
        messageEl.className = `message ${role}`;
        
        // Create avatar
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.innerText = role === 'user' ? 'U' : 'P';
        
        // Create content container
        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        
        // Create text element with markdown support
        const textEl = document.createElement('div');
        textEl.className = 'message-text';
        textEl.innerHTML = marked.parse(content);
        
        // Assemble message
        contentEl.appendChild(textEl);
        messageEl.appendChild(avatarEl);
        messageEl.appendChild(contentEl);
        
        // Add to messages container
        this.messagesContainer.appendChild(messageEl);
        
        // Scroll to bottom
        this.scrollToBottom();
    }
    
    /**
     * Add typing indicator
     * @returns {HTMLElement} - The typing indicator element
     */
    addTypingIndicator() {
        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant';
        
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.innerText = 'P';
        
        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        
        const typingEl = document.createElement('div');
        typingEl.className = 'typing-indicator';
        
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            typingEl.appendChild(dot);
        }
        
        contentEl.appendChild(typingEl);
        messageEl.appendChild(avatarEl);
        messageEl.appendChild(contentEl);
        
        this.messagesContainer.appendChild(messageEl);
        this.scrollToBottom();
        
        return messageEl;
    }
    
    /**
     * Scroll chat to bottom
     */
    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    /**
     * Add chat to history sidebar
     * @param {string} title - Chat title (first message)
     */
    addChatToHistory(title) {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item active';
        chatItem.innerText = title.length > 28 ? title.substring(0, 25) + '...' : title;
        chatItem.dataset.id = this.chatId;
        
        // Deactivate other chats
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });
        
        this.chatHistory.prepend(chatItem);
    }
    
    /**
     * Start a new chat
     */
    startNewChat() {
        // Clear messages
        this.messagesContainer.innerHTML = '';
        
        // Add intro message
        this.messagesContainer.innerHTML = `
            <div class="intro-message">
                <h2>Welcome to ProteinCodex</h2>
                <p>Your AI-powered protein structure analysis assistant</p>
                
                <div class="sample-prompts">
                    <div class="prompt-group">
                        <h3>Load and visualize proteins</h3>
                        <div class="prompt-item" data-prompt="/pymol fetch 1hpv">
                            Load HIV protease (PDB: 1HPV)
                        </div>
                        <div class="prompt-item" data-prompt="/pymol show surface; color spectrum">
                            Show surface colored by spectrum
                        </div>
                    </div>
                    
                    <div class="prompt-group">
                        <h3>Analyze protein structure</h3>
                        <div class="prompt-item" data-prompt="Capture a screenshot of PyMOL and analyze the protein structure visible">
                            Analyze the current view
                        </div>
                        <div class="prompt-item" data-prompt="What are the key structural features of this protein?">
                            Identify key features
                        </div>
                    </div>
                    
                    <div class="prompt-group">
                        <h3>PyMOL programming</h3>
                        <div class="prompt-item" data-prompt="/pymol color red, chain A; color blue, chain B">
                            Color different chains
                        </div>
                        <div class="prompt-item" data-prompt="/pymol select active_site, resn HIS+GLU+ASP+LYS+TYR and within 5 of het">
                            Select active site residues
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Reset state
        this.chatId = Date.now().toString();
        this.lastScreenshotPath = null;
        
        // Clear input
        this.chatInput.value = '';
        this.chatInput.style.height = 'auto';
        
        // Clear history on server
        api.clearHistory().catch(err => console.error('Error clearing history:', err));
        
        // Re-attach event listeners to sample prompts
        document.querySelectorAll('.prompt-item').forEach(item => {
            item.addEventListener('click', () => {
                const prompt = item.getAttribute('data-prompt');
                this.chatInput.value = prompt;
                this.chatInput.focus();
                this.autoResizeInput();
            });
        });
    }
    
    /**
     * Capture a screenshot of PyMOL
     */
    async captureScreenshot() {
        try {
            // Use Electron IPC to capture screen
            window.electronAPI.captureScreen('PyMOL')
                .then(result => {
                    // Set the screenshot path for next message
                    this.lastScreenshotPath = result.path;
                    
                    // Update the screenshot in the UI
                    pymolUI.updateScreenshot(result.path);
                    
                    // Add suggested prompt
                    this.chatInput.value = 'Analyze this protein structure and describe what you see.';
                    this.chatInput.focus();
                    this.autoResizeInput();
                })
                .catch(error => {
                    console.error('Error capturing screenshot:', error);
                    this.addMessageToUI('assistant', `Error capturing screenshot: ${error.message}`);
                });
        } catch (error) {
            console.error('Error capturing screenshot:', error);
            this.addMessageToUI('assistant', `Error capturing screenshot: ${error.message}`);
        }
    }
}

// Create chat UI instance
const chatUI = new ChatUI();
