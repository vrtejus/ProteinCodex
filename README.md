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
git clone https://github.com/yourusername/ProteinCodex.git
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

### PyMOL Commands

To send commands directly to PyMOL, prefix your message with `/pymol`, for example:
```
/pymol fetch 1hpv
/pymol show surface
/pymol color spectrum
```

### Screenshot Analysis

1. Click the camera icon in the chat input or use the "Capture View" button in the visualization panel
2. The application will capture the current PyMOL window
3. Type a message to analyze the captured image, e.g., "What binding sites do you see in this protein structure?"

### Common Commands

- **Load a protein structure**: `/pymol fetch 1hpv` (replace 1hpv with any PDB ID)
- **Change representation**: `/pymol show surface` or `/pymol show cartoon`
- **Color by property**: `/pymol spectrum b, rainbow`
- **Select residues**: `/pymol select active_site, resn HIS+ASP+SER and within 5 of het`
- **Clear everything**: `/pymol reinitialize`

## PyMOL Plugin Requirements

The PyMOL plugin should:

1. Listen on port 9876
2. Accept JSON-formatted commands: `{"cmd": "your_pymol_command_here"}`
3. Return execution results as JSON

## Architecture

- **Frontend**: Electron-based UI with HTML, CSS, and JavaScript
- **Backend**: Flask server that handles:
  - Communication with PyMOL
  - API calls to Gemini 2.5 Flash
  - Screenshot processing
  - Chat history management

## License

MIT