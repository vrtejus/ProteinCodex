# ProteinCodex

ProteinCodex is a ChatGPT-like interface for interacting with protein structures in PyMOL, powered by AI. The application allows researchers to:

1. Send natural language queries about protein structures to Gemini 2.5 Flash
2. Execute PyMOL commands directly from the chat interface
3. Capture screenshots of PyMOL for AI-powered visual analysis
4. Get intelligent insights about protein structures through multimodal understanding

## Prerequisites

- Python 3.8+
- Node.js 18+
- PyMOL with a custom plugin that listens on port 9876
- Google Gemini API key

## Setup

1. Clone the repository:
```bash
git clone https://github.com/vrtejus/ProteinCodex.git
cd ProteinCodex
```

2. Install backend dependencies:
```bash
pip install -r requirements.txt
```

3. Install frontend dependencies:
```bash
npm install
```

4. Create a `.env` file in the root directory with your Gemini API key:
```
GEMINI_API_KEY=your_api_key_here
```

## Running the Application

1. Ensure your PyMOL plugin is running and listening on port 9876

2. Start the application:
```bash
npm run dev
```

This will start both the Flask backend server and the Electron frontend.

## Usage

### Example

Simple command: Show me the protein studied in https://www.biorxiv.org/content/10.1101/2025.01.17.633529v1.full
Complex compand: Locate one active-state complex solved with a G protein and one with β-arrestin for the same receptor subtype (e.g., 6GDG vs 6PWC for β2-adrenergic).Commands

## Architecture

- **Frontend**: Electron-based UI with HTML, CSS, and JavaScript
- **Backend**: Flask server that handles:
  - Communication with PyMOL
  - API calls to Gemini 2.5 Flash
  - Screenshot processing
  - Chat history management

## License

MIT
