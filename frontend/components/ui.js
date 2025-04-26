/**
 * General UI utilities for ProteinCodex
 */

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Apply custom renderer for code blocks
    marked.setOptions({
        highlight: function(code, language) {
            // Simple syntax highlighting effect
            return code
                .replace(/\/\/(.*)/g, '<span class="comment">//$1</span>')
                .replace(/('.*?')/g, '<span class="string">$1</span>')
                .replace(/(\b(function|return|if|for|while|else|var|let|const)\b)/g, '<span class="keyword">$1</span>');
        }
    });
    
    // Make windows resizable
    const initResizable = () => {
        const sidebar = document.querySelector('.sidebar');
        const visualizationPanel = document.querySelector('.visualization-panel');
        const mainContent = document.querySelector('.main-content');
        
        // Resize sidebar
        const sidebarResizer = document.createElement('div');
        sidebarResizer.className = 'resizer sidebar-resizer';
        sidebar.appendChild(sidebarResizer);
        
        // Resize visualization panel
        const visualizationResizer = document.createElement('div');
        visualizationResizer.className = 'resizer visualization-resizer';
        visualizationPanel.insertBefore(visualizationResizer, visualizationPanel.firstChild);
        
        let sidebarWidth = parseInt(getComputedStyle(sidebar).width, 10);
        let visualizationWidth = parseInt(getComputedStyle(visualizationPanel).width, 10);
        let mainContentWidth = parseInt(getComputedStyle(mainContent).width, 10);
        
        // Sidebar resize handler
        const sidebarResize = (e) => {
            const dx = e.clientX - sidebar.getBoundingClientRect().right;
            sidebarWidth = Math.max(200, Math.min(400, sidebarWidth + dx));
            sidebar.style.width = `${sidebarWidth}px`;
        };
        
        // Visualization panel resize handler
        const visualizationResize = (e) => {
            const dx = e.clientX - visualizationPanel.getBoundingClientRect().left;
            visualizationWidth = Math.max(200, Math.min(500, visualizationWidth - dx));
            visualizationPanel.style.width = `${visualizationWidth}px`;
        };
        
        // Add event listeners for resizing
        sidebarResizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.addEventListener('mousemove', sidebarResize);
            document.addEventListener('mouseup', () => {
                document.removeEventListener('mousemove', sidebarResize);
            }, { once: true });
        });
        
        visualizationResizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.addEventListener('mousemove', visualizationResize);
            document.addEventListener('mouseup', () => {
                document.removeEventListener('mousemove', visualizationResize);
            }, { once: true });
        });
    };
    
    // Initialize resizable panels
    //initResizable();
    
    // Handle command history with up/down arrows
    const chatInput = document.getElementById('chat-input');
    let commandHistory = [];
    let currentHistoryIndex = -1;
    
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            // Add command to history if it's a new command
            const command = chatInput.value.trim();
            if (command && (commandHistory.length === 0 || commandHistory[0] !== command)) {
                commandHistory.unshift(command);
                if (commandHistory.length > 50) { // Limit history size
                    commandHistory.pop();
                }
            }
            currentHistoryIndex = -1;
        } else if (e.key === 'ArrowUp') {
            // Navigate command history upward
            if (commandHistory.length > 0 && currentHistoryIndex < commandHistory.length - 1) {
                currentHistoryIndex++;
                chatInput.value = commandHistory[currentHistoryIndex];
                chatUI.autoResizeInput();
                // Move cursor to end
                setTimeout(() => {
                    chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
                }, 0);
                e.preventDefault();
            }
        } else if (e.key === 'ArrowDown') {
            // Navigate command history downward
            if (currentHistoryIndex > -1) {
                currentHistoryIndex--;
                chatInput.value = currentHistoryIndex === -1 ? '' : commandHistory[currentHistoryIndex];
                chatUI.autoResizeInput();
                // Move cursor to end
                setTimeout(() => {
                    chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
                }, 0);
                e.preventDefault();
            }
        }
    });
    
    // Check for dark mode preference
    const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)');
    if (prefersDarkMode.matches) {
        document.body.classList.add('dark-mode');
    }
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Cmd/Ctrl+/ for new chat
        if ((e.metaKey || e.ctrlKey) && e.key === '/') {
            e.preventDefault();
            chatUI.startNewChat();
        }
        // Cmd/Ctrl+S for screenshot
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            pymolUI.refreshView();
        }
    });
});
