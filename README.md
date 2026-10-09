# 🎬 HTML Banner to GIF Studio

A desktop & local web application that converts HTML5 animated banner ads (ZIP format) into highly optimized GIF previews for client presentations and QA.

---

## 🌟 Key Features

- **Automatic Metadata & Dimension Extraction**: Reads `<meta name="ad.size">`, `#container` inline styles, or root CSS from the ZIP's `index.html`.
- **GSAP / Timeline Clock Synchronization**: Pauses and deterministically steps (`seek`) through the animation timeline, eliminating frame drops or speed discrepancies.
- **Auto-Calculated Duration**: Inspects GSAP timelines and labels to detect total animation run time.
- **Variable Frame Delay ("Allow Static Frames")**: Merges consecutive static/motionless frames into a single frame with extended display delay (Photoshop style) to minimize file size.
- **Custom Color Palette Reduction**: Supports 256, 128, 64, 32, and 16 indexed color quantization (spec-compliant power-of-two padding).
- **Final Buffer Time & Custom Looping**: Configurable pause after animation finishes, with infinite or finite loop controls.
- **Live GIF Weight Estimator**: Calibrated heuristic calculating expected GIF weight in real time.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- Microsoft Edge or Google Chrome installed (used for headless frame capture)

### Installation
1. Clone this repository:
   ```bash
   git clone <YOUR_REPO_URL>
   cd banner-to-gif-app
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the App
- **Windows (Quick Start)**: Double-click [`start.bat`](start.bat)
- **Command Line**:
   ```bash
   npm start
   ```
The app will launch at `http://localhost:38291` in your default browser.

---

## 📁 Project Structure

```
banner-to-gif-app/
├── public/
│   └── index.html         # Web application UI & live weight estimation
├── capture-worker.js      # Headless browser capture with deterministic GSAP seek
├── gif-engine.js          # ZIP unpacking, dimension/duration parsing, and GIF quantization
├── server.js              # Local Express backend server
├── start.bat              # One-click Windows launcher
├── package.json           # Dependencies and scripts
└── .gitignore             # Files excluded from GitHub
```

---

## 📄 License
MIT
