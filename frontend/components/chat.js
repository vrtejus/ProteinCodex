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
        this.lastScreenshotPath = null;
        // Rename sttState -> voiceState for clarity (includes activation and transcription)
        this.voiceState = { isActive: false, isTranscribing: false, spaceHeld: false };
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
    initVoiceInput() {
        // Global keydown listener
        document.addEventListener('keydown', (e) => {
            if (e.code !== 'Space' || e.repeat) {
                // If space is held while already transcribing, prevent default still
                if (e.code === 'Space' && this.voiceState.isTranscribing && document.activeElement === this.chatInput) {
                     e.preventDefault();
                 }
                return; // Only handle first press of Spacebar
            }

            if (this.voiceState.spaceHeld) { // Already processing space down
                return; // Only handle first press of Spacebar
            }

            const isInputFocused = document.activeElement === this.chatInput;
            const isInputEmpty = this.chatInput.value.trim() === '';

            // Scenario 1: Voice mode already active -> Start transcription
            if (this.voiceState.isActive) {
                console.log("Space down: Voice mode active, starting transcription.");
                if (isInputFocused) e.preventDefault(); // Prevent space char
                this.voiceState.spaceHeld = true; // Mark space as held
                this.startTranscription();
            }
            // Scenario 2: Voice mode inactive BUT input empty or not focused -> Activate and Start
            else if (!isInputFocused || isInputEmpty) {
                console.log("Space down: Auto-activating voice mode and starting transcription.");
                if (isInputFocused) e.preventDefault(); // Prevent space char if activating from empty input
                this.voiceState.spaceHeld = true; // Mark space as held
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
            // Check if spacebar is released AND we initiated transcription with space
            if (e.code === 'Space' && this.voiceState.spaceHeld) {
                console.log("Space up: Requesting stop transcription.");
                this.voiceState.spaceHeld = false; // Mark space as released
                // Request stop, sending will happen on final result
                this.requestStopTranscription();
            }
        });

        // Listen for transcription state changes FROM Main process
        window.electronAPI.onTranscriptionStateChange(isTranscribing => {
            // Primarily update isTranscribing based on main process/helper state
            if (this.voiceState.isTranscribing !== isTranscribing) {
                 console.log("Renderer: Transcription state change from Main:", isTranscribing);
                 this.voiceState.isTranscribing = isTranscribing;
                 this.updateVoiceButtonUI();
                 // If transcription just stopped, maybe re-focus input?
                 // if (!isTranscribing) { this.chatInput.focus(); }
                }
        });

        // Listen for transcription results
        window.electronAPI.onSttInterimResult(this.handleInterimResult.bind(this));
        window.electronAPI.onSttFinalResult(transcript => {
            this.chatInput.value = transcript; // Set final result
            this.autoResizeInput();
            // *** Send the message ONLY when the final result arrives ***
            if (this.chatInput.value.trim()) { // Check if there's actual text
                console.log("Renderer: Received final transcript, sending message.");
                this.sendMessage();
            } else {
                 console.log("Renderer: Received empty/blank final transcript, not sending.");
                 // Ensure transcription state is visually off
                 this.voiceState.isTranscribing = false;
                 this.updateVoiceButtonUI();
            }
             // Focus might be disruptive if user is already typing something else
             // this.chatInput.focus();
        });
        window.electronAPI.onSttError(error => {
            console.error("STT Error:", error);
            this.addMessageToUI('assistant', `Speech Recognition Error: ${error}`);
            if(this.currentChatId) this.storeMessage(this.currentChatId, 'assistant', `Speech Recognition Error: ${error}`); // Log error to chat history
            // Reset state visually on error
            this.voiceState = { isActive: false, isTranscribing: false, spaceHeld: false }; // Reset all state
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
        // Add small buffer to prevent scrollbar flicker on single line
        this.chatInput.style.height = (this.chatInput.scrollHeight + 2) + 'px';
    }
    
    /**
     * Send a message to the API
     */
    async sendMessage() {
        // Ensure we have a chat ID - shouldn't happen if startNewChat runs first, but good practice
        if (!this.currentChatId) { // Check if a chat exists
            console.warn("No currentChatId set, starting a new chat first.");
            this.startNewChat(); // Ensure a chat exists
            return; // Prevent sending on initial auto-chat creation
        }
        const message = this.chatInput.value.trim(); // Read value *now* before clearing
        if ((!message && !this.lastScreenshotPath) || this.isProcessing) return;

        this.isProcessing = true;

        // Add user message to UI and local store
        this.addMessageToUI('user', message);
        this.storeMessage(this.currentChatId, 'user', message);

        // Clear input
        this.chatInput.style.height = 'auto';
        
        // Show typing indicator
        const typingIndicator = this.addTypingIndicator();

        const messageToSend = message; // Capture message before clearing input potentially
        const imagePathToSend = this.lastScreenshotPath; // Capture image path
        this.lastScreenshotPath = null; // Clear path immediately after capturing for sending
        document.getElementById('screenshot-preview-container')?.remove(); // Clear preview
        
        // *** Clear input AFTER capturing messageToSend and imagePathToSend ***
        this.chatInput.value = '';
        this.autoResizeInput(); // Reset height after clearing

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
        if (this.voiceState.isActive) this.setVoiceActivation(false); // Only deactivate if active
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
        const newState = !this.voiceState.isActive;
        this.setVoiceActivation(newState);
    }

    /** Sets voice activation state and notifies main process */
    setVoiceActivation(activate) {
        if (this.voiceState.isActive === activate) return; // No change

        this.voiceState.isActive = activate;
        console.log(`Renderer: Setting Voice Mode Active: ${this.voiceState.isActive}`);
        if (!activate && this.voiceState.isTranscribing) {
            // If deactivating via button while transcribing, request stop
            this.requestStopTranscription(); // Don't auto-send if deactivated via button
        }
        this.updateVoiceButtonUI();
        // Inform main process about the desired state (optional, but good practice)
        // window.electronAPI.setVoiceModeActive(this.voiceState.isActive); // Removed this IPC for now
    }

    startTranscription() {
        // Called when spacebar is held (and conditions met)
        if (this.voiceState.isTranscribing) return; // Already started
        console.log('Renderer: Requesting start transcription');
        this.voiceState.isTranscribing = true; // Optimistically set state
        this.updateVoiceButtonUI();
        window.electronAPI.startTranscription();
    }

    /** Requests the main process/helper to stop transcription */
    requestStopTranscription() {
        if (!this.voiceState.isTranscribing) return;
        console.log(`Renderer: Requesting stop transcription`);
        // Don't change local state here - wait for confirmation from main process
        // via onTranscriptionStateChange or finalResult/error
        window.electronAPI.requestStopTranscription(); // Tell main to stop helper
    }
    
    /** Handles interim results from main process */
    handleInterimResult(transcript) {
         if (this.voiceState.isTranscribing) { // Only update if still supposed to be transcribing
             // Store cursor position
             const start = this.chatInput.selectionStart;
             const end = this.chatInput.selectionEnd;

             // Update value (this might cause focus issues if not careful)
             this.chatInput.value = transcript;
             this.autoResizeInput(); // Resize

             // Try to restore cursor position (might be imperfect)
             try {
                 this.chatInput.setSelectionRange(start, end);
             } catch (e) {
                 // Ignore errors if element detached or focus lost
             }
         }
    }

    updateVoiceButtonUI() {
        this.voiceButton.classList.remove('listening-active', 'transcribing');
        const icon = this.voiceButton.querySelector('i');
        icon.className = 'fas fa-microphone'; // Reset icon

        if (this.voiceState.isTranscribing) {
            this.voiceButton.classList.add('listening-active', 'transcribing');
            icon.className = 'fas fa-waveform'; // Or keep mic and use animation
        } else if (this.voiceState.isActive) {
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