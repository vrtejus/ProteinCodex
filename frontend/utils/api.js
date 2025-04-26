/**
 * API client for ProteinCodex
 */
class ApiClient {
  constructor(baseUrl = "http://localhost:5001") {
    this.baseUrl = baseUrl;
    this.headers = {
      "Content-Type": "application/json",
    };
  }

  /**
   * Send a message to the chat API
   * @param {string} message - User message
   * @param {string} imagePath - Optional path to an image to analyze
   * @returns {Promise} - API response
   */
  async sendMessage(message, chatId, imagePath = null) {
    // Add chatId parameter
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: this.headers,
        // Include chatId in the body
        body: JSON.stringify({ message, chatId, image_path: imagePath }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: `API Error: ${response.status} ${response.statusText}`,
        }));
        throw new Error(
          errorData.error ||
            `API Error: ${response.status} ${response.statusText}`
        );
      }
      return await response.json();
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  }

  /**
   * Execute a PyMOL command
   * @param {string} command - PyMOL command to execute
   * @returns {Promise} - API response
   */
  async executePyMOL(command) {
    try {
      const response = await fetch(`${this.baseUrl}/api/execute-pymol`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ command }),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error executing PyMOL command:", error);
      throw error;
    }
  }

  /**
   * Analyze an image with the AI
   * @param {File} imageFile - Image file to analyze
   * @param {string} prompt - Optional prompt for analysis
   * @returns {Promise} - API response
   */
  async analyzeImage(
    imageFile,
    prompt = "Analyze this protein structure image and describe what you see."
  ) {
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      formData.append("prompt", prompt);

      const response = await fetch(`${this.baseUrl}/api/analyze-image`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error analyzing image:", error);
      throw error;
    }
  }

  /**
   * Clear chat history
   * @param {string} chatId - The chat ID to clear history for
   * @returns {Promise} - API response
   */
  async clearHistory(chatId) {
    // Add chatId parameter
    try {
      const response = await fetch(`${this.baseUrl}/api/clear-history`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ chatId }), // Send chatId to clear
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({
            error: `API Error: ${response.status} ${response.statusText}`,
          }));
        throw new Error(
          errorData.error ||
            `API Error: ${response.status} ${response.statusText}`
        );
      }
      return await response.json();
    } catch (error) {
      console.error("Error clearing history:", error);
      throw error;
    }
  }
}

// Create and export API client instance
const api = new ApiClient();
