const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { inspectAndExtractZip, encodeGif } = require('./gif-engine');
const { captureBannerFrames } = require('./capture-worker');

const app = express();
const PORT = 38291;

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Store active banner info in memory
let currentBanner = null;

// Inspect uploaded banner ZIP
app.post('/api/inspect', (req, res) => {
  try {
    const { base64Zip, fileName } = req.body;
    if (!base64Zip) return res.status(400).json({ success: false, error: 'No file data provided' });

    const buffer = Buffer.from(base64Zip.replace(/^data:application\/(zip|x-zip-compressed);base64,/, ''), 'base64');
    const tempZipPath = path.join(os.tmpdir(), `upload_${Date.now()}.zip`);
    fs.writeFileSync(tempZipPath, buffer);

    const extractDir = path.join(os.tmpdir(), `banner_ext_${Date.now()}`);
    const info = inspectAndExtractZip(tempZipPath, extractDir);

    currentBanner = {
      ...info,
      fileName: fileName || 'banner.zip'
    };

    res.json({
      success: true,
      fileName: currentBanner.fileName,
      width: currentBanner.width,
      height: currentBanner.height,
      durationSec: currentBanner.durationSec || 5
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SSE progress endpoint
let activeProgressRes = null;
app.get('/api/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  activeProgressRes = res;
  req.on('close', () => { activeProgressRes = null; });
});

function sendProgress(stage, percent) {
  if (activeProgressRes) {
    activeProgressRes.write(`data: ${JSON.stringify({ stage, percent })}\n\n`);
  }
}

// Convert
app.post('/api/convert', async (req, res) => {
  if (!currentBanner) return res.status(400).json({ success: false, error: 'No banner loaded' });

  try {
    const {
      width,
      height,
      fps = 25,
      durationSec = 5,
      finalBufferSec = 1,
      allowStaticFrames = false,
      loopable = true,
      loopCount = 0,
      paletteSize = 256,
      compression = 'medium'
    } = req.body;

    const relHtml = path.relative(currentBanner.extractedDir, currentBanner.htmlPath).replace(/\\/g, '/');

    sendProgress('Starting animation capture...', 10);

    const frames = await captureBannerFrames({
      bannerDir: currentBanner.extractedDir,
      htmlFile: relHtml,
      width: parseInt(width, 10),
      height: parseInt(height, 10),
      fps: parseInt(fps, 10),
      durationSec: parseFloat(durationSec),
      finalBufferSec: parseFloat(finalBufferSec),
      onProgress: (p) => {
        const mappedPercent = Math.round(10 + (p.percent * 0.55));
        sendProgress(`Capturing frame ${p.current} / ${p.total}...`, mappedPercent);
      }
    });

    sendProgress('Encoding and quantizing GIF palette...', 75);

    const actualLoopCount = loopable ? 0 : (parseInt(loopCount, 10) || 1);
    const result = await encodeGif({
      frames,
      width: parseInt(width, 10),
      height: parseInt(height, 10),
      maxColors: parseInt(paletteSize, 10),
      allowStaticFrames: Boolean(allowStaticFrames),
      loopCount: actualLoopCount
    });

    sendProgress('Done!', 100);

    const base64Gif = `data:image/gif;base64,${result.buffer.toString('base64')}`;

    res.json({
      success: true,
      gifBase64: base64Gif,
      byteLength: result.buffer.length,
      frameCount: result.frameCount,
      savedFrames: result.savedFrames
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Banner to GIF Studio running at ${url}`);
  // Automatically open default browser (Edge / Chrome)
  exec(`start ${url}`);
});
