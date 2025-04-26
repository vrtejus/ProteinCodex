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
        this.voiceButton = document.getElementById('voice-btn'); // Get voice button

        // State
        this.isProcessing = false;
        this.currentChatId = null; // Initialize chatId as null
        this.lastScreenshotPath = null; // For image attachments
        this.sttState = { isActive: false, isTranscribing: false }; // Combined state object
        // Basic local storage for messages per chat (can be enhanced later)
        this.chatMessagesStore = {}; // { chatId: [{ role, content }, ...], ... }

        // Initialize
        this.initEventListeners();
        this.startNewChat(); // Start with a new chat session on load
        this.autoResizeInput();
        this.initVoiceInput(); // Initialize voice listeners
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
        
        // New chat button
        this.newChatButton.addEventListener('click', () => this.startNewChat());

        // Voice Button Click - Now explicitly toggles activation
        this.voiceButton.addEventListener('click', () => this.toggleVoiceActivation());

        // Sample prompts (attach listener dynamically in startNewChat)

        // Capture button
        this.captureButton.addEventListener('click', () => this.captureScreenshot());

        // Chat history switching (Basic implementation)
        this.chatHistory.addEventListener('click', (e) => {
            if (e.target && e.target.classList.contains('chat-item')) {
                const chatIdToLoad = e.target.dataset.id;
                if (chatIdToLoad && chatIdToLoad !== this.currentChatId) {
                    this.loadChat(chatIdToLoad);
                }
            }
        });
    }

    /**
     * Initialize listeners for voice input (Spacebar detection)
     */
    // Rename and refactor
    initVoiceInput() {
        // Global keydown listener
        document.addEventListener('keydown', (e) => {
            if (e.code !== 'Space' || this.sttState.isTranscribing || e.repeat) {
                return; // Only handle Spacebar, ignore if already transcribing or key repeat
            }

            const isInputFocused = document.activeElement === this.chatInput;
            const isInputEmpty = this.chatInput.value.trim() === '';

            // Scenario 1: Voice mode already active -> Start transcription
            if (this.sttState.isActive) {
                console.log("Space down: Voice mode active, starting transcription.");
                if (isInputFocused) e.preventDefault(); // Prevent space char
                this.startTranscription();
            }
            // Scenario 2: Voice mode inactive BUT input empty or not focused -> Activate and Start
            else if (!isInputFocused || isInputEmpty) {
                console.log("Space down: Auto-activating voice mode and starting transcription.");
                if (isInputFocused) e.preventDefault(); // Prevent space char if activating from empty input
                this.setVoiceActivation(true); // Activate mode first
                this.startTranscription();     // Then start
            }
            // Scenario 3: Voice inactive, input focused and has text -> Do nothing (allow normal space typing)
            else {
                 console.log("Space down: Normal space typing allowed.");
            }
        });

        // Global keyup listener
        document.addEventListener('keyup', (e) => {
            // Check if spacebar is released AND we were transcribing
            if (e.code === 'Space' && this.sttState.isTranscribing) {
                console.log("Space up: Stopping transcription and sending message.");
                this.stopTranscriptionAndSend(); // New method
            }
        });

        // Listen for state changes from Main process (e.g., transcription actually stopped by helper)
        window.electronAPI.onVoiceStateChange(state => {
            // Primarily update isTranscribing based on main process/helper state
            // isActive is now mostly controlled by the renderer's toggleVoiceActivation
            if (this.sttState.isTranscribing !== state.isTranscribing) {
                 console.log("STT State Change from Main:", state);
                 this.sttState.isTranscribing = state.isTranscribing;
                 this.updateVoiceButtonUI();
                }
        });

        // Listen for transcription results
        window.electronAPI.onSttInterimResult(transcript => {
            this.chatInput.value = transcript; // Update input with interim results
            this.autoResizeInput(); // Resize input as text changes
        });
        window.electronAPI.onSttFinalResult(transcript => {
            this.chatInput.value = transcript; // Set final result
            this.chatInput.focus(); // Focus input after transcription
        });
        window.electronAPI.onSttError(error => {
            console.error("STT Error:", error);
            this.addMessageToUI('assistant', `Speech Recognition Error: ${error}`);
            if(this.currentChatId) this.storeMessage(this.currentChatId, 'assistant', `Speech Recognition Error: ${error}`);
            // Reset state visually on error
            this.sttState = { isActive: false, isTranscribing: false };
            this.updateVoiceButtonUI();
        });
    }

    /**
     * Attach listeners to dynamically added sample prompts
     */
    attachSamplePromptListeners() {
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
        // Ensure we have a chat ID - shouldn't happen if startNewChat runs first, but good practice
        if (!this.currentChatId) {
            console.warn("No currentChatId set, starting a new chat first.");
            this.startNewChat(); // Ensure a chat exists
        }
        if ((!message && !this.lastScreenshotPath) || this.isProcessing) return;

        this.isProcessing = true;

        // Add user message to UI and local store
        this.addMessageToUI('user', message);
        this.storeMessage(this.currentChatId, 'user', message);

        // Clear input
        this.chatInput.value = '';
        this.chatInput.style.height = 'auto';
        
        // Show typing indicator
        const typingIndicator = this.addTypingIndicator();

        const messageToSend = message; // Capture message before clearing input potentially
        const imagePathToSend = this.lastScreenshotPath; // Capture image path
        this.lastScreenshotPath = null; // Clear path immediately after capturing for sending
        document.getElementById('screenshot-preview-container')?.remove(); // Clear preview

        try {
            let apiResponse; // Use a generic name

            // Check if it's a PyMOL command
            // Let the backend handle /pymol prefix vs Gemini processing now
            apiResponse = await api.sendMessage(messageToSend, this.currentChatId, imagePathToSend);

            // Check if this was the first message of the chat to add to history sidebar
            const isFirstMessage = !(this.chatMessagesStore[this.currentChatId]?.length > 1); // Check before adding assistant msg

            // Remove typing indicator
            this.messagesContainer.removeChild(typingIndicator);

            // Add assistant response to UI and local store
            this.addMessageToUI('assistant', apiResponse.response);
            this.storeMessage(this.currentChatId, 'assistant', apiResponse.response);

            // Add chat to history sidebar if it's the first user message
            if (isFirstMessage && messageToSend) { // Only add if user sent text
                this.addChatToHistorySidebar(this.currentChatId, messageToSend);
            }

            // Refresh PyMOL view if likely successful (optional)
            if (!apiResponse.response.toLowerCase().includes("error")) {
                this.tryRefreshPyMOLView();
            }

        } catch (error) {
            console.error('Error sending message:', error);
            
            // Remove typing indicator
            this.messagesContainer.removeChild(typingIndicator);

            // Add error message
            const errorText = `Error: ${error.message || String(error)}`;
            this.addMessageToUI('assistant', errorText);
            this.storeMessage(this.currentChatId, 'assistant', errorText); // Store error too
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

        const shouldScroll = this.messagesContainer.scrollTop + this.messagesContainer.clientHeight >= this.messagesContainer.scrollHeight - 50;

        // Create message element
        const messageEl = document.createElement('div');
        messageEl.className = `message message-${role}`; // Use specific classes

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

        // Scroll to bottom only if already near the bottom
        if (shouldScroll) {
            this.scrollToBottom();
        }
    }
    
    /**
     * Add typing indicator
     * @returns {HTMLElement} - The typing indicator element
     */
    addTypingIndicator() {
        const messageEl = document.createElement('div');
        messageEl.className = 'message message-assistant typing-indicator-container'; // Add class for easier removal

        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.innerText = 'P'; // Or use an icon
        
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
     * @param {string} chatId - The ID of the chat
     */
    addChatToHistorySidebar(chatId, title) {
        // Avoid adding if it already exists
        if (this.chatHistory.querySelector(`.chat-item[data-id="${chatId}"]`)) {
            return;
        }

        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item active';
        chatItem.innerText = title.substring(0, 28) + (title.length > 28 ? '...' : '');
        chatItem.dataset.id = chatId; // Use the actual chatId

        // Deactivate other items
        this.setActiveChatItem(chatId);

        // Add to top of history
        this.chatHistory.prepend(chatItem);
    }

    setActiveChatItem(chatId) {
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });
        const currentItem = this.chatHistory.querySelector(`.chat-item[data-id="${chatId}"]`);
        currentItem?.classList.add('active');
    }
    
    /**
     * Start a new chat
     */
    startNewChat() {
        // Clear messages
        this.messagesContainer.innerHTML = '';

        // Add intro message (keep existing structure)
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
        
        // Generate and set NEW chat ID
        this.currentChatId = String(Date.now());
        console.log("Starting new chat with ID:", this.currentChatId);
        this.lastScreenshotPath = null;
        document.getElementById('screenshot-preview-container')?.remove();

        // Clear input
        this.chatInput.value = '';
        this.chatInput.style.height = 'auto';

        // Don't clear backend history automatically unless specifically requested
        // api.clearHistory(this.currentChatId).catch(err => console.error('Error clearing history:', err));

        // Ensure chatMessagesStore entry exists
        if (!this.chatMessagesStore[this.currentChatId]) {
            this.chatMessagesStore[this.currentChatId] = [];
        }

        // Deactivate all items in sidebar (new chat isn't added until first message)
        this.setActiveChatItem(null);

        // Deactivate voice mode when starting new chat
        this.setVoiceActivation(false);
        // Re-attach event listeners to sample prompts
        this.attachSamplePromptListeners();
    }

    /**
     * Load messages for a specific chat ID
     * @param {string} chatId
     */
    loadChat(chatId) {
        if (!chatId || !this.chatMessagesStore[chatId]) {
            console.warn(`Chat history not found locally for chatId: ${chatId}. Starting new.`);
            this.startNewChat(); // Or handle differently, maybe fetch from server if implemented
            return;
        }

        console.log(`Loading chat: ${chatId}`);
        this.currentChatId = chatId;
        this.messagesContainer.innerHTML = ''; // Clear current messages

        // Load messages from local store
        const messages = this.chatMessagesStore[chatId];
        messages.forEach(msg => {
            this.addMessageToUI(msg.role, msg.content);
        });

        // Reset temporary state
        this.lastScreenshotPath = null;
        document.getElementById('screenshot-preview-container')?.remove();
        this.chatInput.value = '';
        this.chatInput.style.height = 'auto';

        // Highlight the active chat item in the sidebar
        this.setActiveChatItem(chatId);

        this.scrollToBottom();
        this.chatInput.focus();
    }

    /**
     * Store a message in the local message store
     * @param {string} chatId
     * @param {string} role
     * @param {string} content
     */
    storeMessage(chatId, role, content) {
        if (!chatId) return; // Don't store if no chat ID
        if (!this.chatMessagesStore[chatId]) {
            this.chatMessagesStore[chatId] = [];
        }
        // Avoid storing empty messages unless it's maybe an assistant response placeholder?
        // Simple implementation: only store non-empty content
        if (content || role === 'assistant') { // Store assistant messages even if temporarily empty/error
             this.chatMessagesStore[chatId].push({ role, content });
        }
    }

    /**
     * Capture a screenshot of PyMOL
     */
    async captureScreenshot() {
        try {
            if (!window.electronAPI || typeof window.electronAPI.captureScreen !== 'function') {
                 this.addMessageToUI('assistant', 'Screenshot capture is only available in the Electron app.');
                 this.storeMessage(this.currentChatId, 'assistant', 'Screenshot capture is only available in the Electron app.');
                 return;
            }
            // Use Electron IPC to capture screen
            const result = await window.electronAPI.captureScreen('PyMOL'); // Use await

            if (result && result.path) {
                this.lastScreenshotPath = result.path;
                pymolUI.updateScreenshot(result.path);
                this.displayScreenshotPreview(result.path); // Show preview
                this.chatInput.value = 'Analyze this protein structure and describe what you see.';
                this.chatInput.focus();
                this.autoResizeInput();
            } else {
                 throw new Error("Screenshot capture failed or returned no path.");
            }

        } catch (error) {
            console.error('Error capturing screenshot:', error);
            this.addMessageToUI('assistant', `Error capturing screenshot: ${error.message}`);
            this.storeMessage(this.currentChatId, 'assistant', `Error capturing screenshot: ${error.message}`);
        }
    }

    /**
    * Add a preview of the captured screenshot above the input bar.
    * @param {string} path - The file path of the screenshot.
    */
    displayScreenshotPreview(path) {
        document.getElementById('screenshot-preview-container')?.remove(); // Remove old one
        const inputContainer = document.querySelector('.chat-input-container');
        const previewContainer = document.createElement('div');
        previewContainer.id = 'screenshot-preview-container';
        previewContainer.className = 'screenshot-preview'; // Add class for styling
        const img = document.createElement('img');
        img.src = `file://${path}`; // Use file protocol for local files in Electron
        img.alt = 'Screenshot preview';
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '×';
        closeButton.onclick = () => {
            previewContainer.remove();
            this.lastScreenshotPath = null; // Clear path if preview removed
        };
        previewContainer.appendChild(img);
        previewContainer.appendChild(closeButton);
        inputContainer.insertBefore(previewContainer, inputContainer.firstChild);
    }

    // --- Voice Input Methods ---

    /** Explicitly toggles voice mode activation */
    toggleVoiceActivation() {
        const newState = !this.sttState.isActive;
        this.setVoiceActivation(newState);
    }

    /** Sets voice activation state and notifies main process */
    setVoiceActivation(activate) {
        if (this.sttState.isActive === activate) return; // No change

        this.sttState.isActive = activate;
        console.log(`Renderer: Setting Voice Mode Active: ${this.sttState.isActive}`);
        if (!activate && this.sttState.isTranscribing) {
            // If deactivating while transcribing, stop transcription
            this.stopTranscription(false); // Don't auto-send if deactivated via button
        }
        this.updateVoiceButtonUI();
        // Inform main process about the desired state (optional, but good practice)
        // window.electronAPI.setVoiceModeActive(this.sttState.isActive);
    }

    startTranscription() {
        // Called when spacebar is held (and conditions met)
        if (this.sttState.isTranscribing) return; // Already started
        console.log('Renderer: Requesting start transcription');
        this.sttState.isTranscribing = true;
        this.updateVoiceButtonUI();
        window.electronAPI.startTranscription();
    }

    /** Stops transcription (e.g., on button toggle) without sending */
    stopTranscription(shouldSend = false) {
        if (!this.sttState.isTranscribing) return;
        console.log(`Renderer: Requesting stop transcription (send=${shouldSend})`);
        this.sttState.isTranscribing = false; // Visually update immediately
        this.updateVoiceButtonUI();
        window.electronAPI.stopTranscription(); // Tell main to stop helper
        // Sending logic is now separate (in stopTranscriptionAndSend)
    }

    /** Stops transcription AND sends message (called on spacebar up) */
    stopTranscriptionAndSend() {
        this.stopTranscription(true); // Stop backend transcription first
        // Send message immediately after stopping (using text currently in input)
        console.log("Renderer: Sending message after transcription stop.");
        this.sendMessage();
    }

    updateVoiceButtonUI() {
        this.voiceButton.classList.remove('listening-active', 'transcribing');
        const icon = this.voiceButton.querySelector('i');
        icon.className = 'fas fa-microphone'; // Reset icon

        if (this.sttState.isTranscribing) {
            this.voiceButton.classList.add('listening-active', 'transcribing');
            icon.className = 'fas fa-waveform'; // Or keep mic and use animation
        } else if (this.sttState.isActive) {
            this.voiceButton.classList.add('listening-active');
            // Icon changes handled by class styles now
        }
    }
}

// Create chat UI instance
const chatUI = new ChatUI();




// Helper function (could be moved)
function tryRefreshPyMOLView() {
    if (window.electronAPI && typeof window.electronAPI.captureScreen === 'function') {
        // Use a small delay to allow PyMOL to potentially update
        setTimeout(() => pymolUI.refreshView(), 500);
    }
}