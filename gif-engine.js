const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const { PNG } = require('pngjs');
const { GifFrame, GifUtil, GifCodec, BitmapImage } = require('gifwrap');
const quantize = require('quantize');
const { GifWriter } = require('omggif');

/**
 * Extracts ZIP contents to a target folder and inspects index.html for banner dimensions.
 */
function inspectAndExtractZip(zipFilePath, outputExtractDir) {
  if (fs.existsSync(outputExtractDir)) {
    fs.rmSync(outputExtractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputExtractDir, { recursive: true });

  const zip = new AdmZip(zipFilePath);
  zip.extractAllTo(outputExtractDir, true);

  // Find index.html or first .html file
  let htmlPath = null;
  const files = fs.readdirSync(outputExtractDir, { recursive: true });
  for (const f of files) {
    if (f.toLowerCase().endsWith('index.html') || f.toLowerCase().endsWith('.html')) {
      htmlPath = path.join(outputExtractDir, f);
      if (f.toLowerCase().endsWith('index.html')) break;
    }
  }

  let width = 300;
  let height = 250;
  let detectedDuration = 5;

  if (htmlPath && fs.existsSync(htmlPath)) {
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const $ = cheerio.load(htmlContent);

    // 1. Dimension priority: Check #container first, then meta ad.size, then body
    const containerStyle = $('#container').attr('style') || '';
    const contW = containerStyle.match(/width:\s*(\d+)px/i);
    const contH = containerStyle.match(/height:\s*(\d+)px/i);

    if (contW && contH) {
      width = parseInt(contW[1], 10);
      height = parseInt(contH[1], 10);
    } else {
      const adSizeMeta = $('meta[name="ad.size"]').attr('content');
      if (adSizeMeta) {
        const wMatch = adSizeMeta.match(/width=(\d+)/i);
        const hMatch = adSizeMeta.match(/height=(\d+)/i);
        if (wMatch) width = parseInt(wMatch[1], 10);
        if (hMatch) height = parseInt(hMatch[1], 10);
      }
    }

    // 2. Extract Duration from GSAP / TimelineMax / CSS
    detectedDuration = 5;

    // Pattern A: GSAP / TweenMax timeline duration console or labels
    // We can also extract total duration by summing timeline adds/tos or checking .duration()
    const scriptTags = $('script').map((i, el) => $(el).html()).get().join('\n');
    
    // Look for addLabel/to timing like 'frame3+=0.7' + 0.7s
    const gsapMatches = [...scriptTags.matchAll(/\.to\s*\([^,]+,\s*([0-9.]+)[^)]*['"]([^'"]+)['"]/g)];
    if (gsapMatches.length > 0) {
      // Find maximum timeline offset reached
      let maxTime = 0;
      let labelTimes = { frame1: 0 };
      
      // Look for addLabel lines
      const labelMatches = [...scriptTags.matchAll(/\.addLabel\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g)];
      for (const m of labelMatches) {
        const lblName = m[1];
        const offsetExpr = m[2]; // e.g. 'frame1+=0.8'
        const baseMatch = offsetExpr.match(/([a-zA-Z0-9_]+)\+=\s*([0-9.]+)/);
        if (baseMatch) {
          const baseLbl = baseMatch[1];
          const addSec = parseFloat(baseMatch[2]);
          labelTimes[lblName] = (labelTimes[baseLbl] || 0) + addSec;
        } else {
          labelTimes[lblName] = 0;
        }
      }

      for (const gm of gsapMatches) {
        const duration = parseFloat(gm[1]);
        const position = gm[2]; // e.g. 'frame3+=0.5'
        let startTime = 0;
        const posMatch = position.match(/([a-zA-Z0-9_]+)\+=\s*([0-9.]+)/);
        if (posMatch) {
          const baseLbl = posMatch[1];
          const addSec = parseFloat(posMatch[2]);
          startTime = (labelTimes[baseLbl] || 0) + addSec;
        } else if (labelTimes[position] !== undefined) {
          startTime = labelTimes[position];
        } else if (!isNaN(parseFloat(position))) {
          startTime = parseFloat(position);
        }
        maxTime = Math.max(maxTime, startTime + duration);
      }
      if (maxTime > 0) {
        detectedDuration = parseFloat(maxTime.toFixed(2));
      }
    }
  }

  return {
    htmlPath,
    width,
    height,
    durationSec: detectedDuration || 5,
    extractedDir: outputExtractDir
  };
}

/**
 * Compares two PNG buffers pixel by pixel to check if they are visually identical or near identical.
 */
function areBuffersIdentical(bufA, bufB, tolerance = 0) {
  if (bufA.length !== bufB.length) return false;
  if (tolerance === 0) {
    return bufA.equals(bufB);
  }
  let diffCount = 0;
  for (let i = 0; i < bufA.length; i += 4) {
    const dr = Math.abs(bufA[i] - bufB[i]);
    const dg = Math.abs(bufA[i + 1] - bufB[i + 1]);
    const db = Math.abs(bufA[i + 2] - bufB[i + 2]);
    const da = Math.abs(bufA[i + 3] - bufB[i + 3]);
    if (dr + dg + db + da > 4) {
      diffCount++;
      if (diffCount > (bufA.length / 4) * 0.001) return false; // >0.1% diff
    }
  }
  return true;
}

/**
 * Builds an optimized GIF using variable frame duration (holding static frames)
 * and custom color palette depth + quantization.
 */
async function encodeGif({
  frames, // Array of { pngBuffer, durationMs }
  width,
  height,
  maxColors = 256,
  allowStaticFrames = false,
  loopCount = 0, // 0 = infinite
  lossy = 0
}) {
  // 1. Frame deduplication & duration merge if allowStaticFrames is true
  let processedFrames = [];

  for (let i = 0; i < frames.length; i++) {
    const current = frames[i];
    if (allowStaticFrames && processedFrames.length > 0) {
      const last = processedFrames[processedFrames.length - 1];
      if (areBuffersIdentical(last.pngBuffer, current.pngBuffer, 2)) {
        // Accumulate duration onto previous static frame!
        last.durationMs += current.durationMs;
        continue;
      }
    }
    processedFrames.push({
      pngBuffer: current.pngBuffer,
      durationMs: current.durationMs
    });
  }

  // 2. Decode raw pixel buffers
  const rawFrames = [];
  for (const f of processedFrames) {
    const safeBuf = Buffer.isBuffer(f.pngBuffer) ? f.pngBuffer : Buffer.from(f.pngBuffer);
    const png = PNG.sync.read(safeBuf);
    rawFrames.push({
      width: png.width,
      height: png.height,
      data: png.data, // RGBA Buffer
      durationMs: f.durationMs
    });
  }

  // 3. Build indexed frames with omggif & quantize
  const outputBuffer = Buffer.alloc(width * height * rawFrames.length * 2 + 1024 * 1024);
  const gifWriter = new GifWriter(outputBuffer, width, height, { loop: loopCount });

  for (let i = 0; i < rawFrames.length; i++) {
    const rf = rawFrames[i];
    // Collect pixels for quantizer
    const pixels = [];
    const pixelCount = width * height;
    
    // Sample pixels to build palette
    for (let p = 0; p < pixelCount; p++) {
      const offset = p * 4;
      const a = rf.data[offset + 3];
      if (a > 128) {
        pixels.push([rf.data[offset], rf.data[offset + 1], rf.data[offset + 2]]);
      }
    }

    // Color quantization
    const colorMap = quantize(pixels.length > 0 ? pixels : [[0,0,0], [255,255,255]], Math.min(256, Math.max(2, maxColors)));
    const palette = colorMap ? colorMap.palette() : [[0,0,0], [255,255,255]];
    
    // Palette as flat RGB 0xRRGGBB numbers
    const flatPalette = palette.map(([r, g, b]) => (r << 16) | (g << 8) | b);

    // omggif requirement: Palette length MUST be a power of 2 (2, 4, 8, 16, 32, 64, 128, 256)
    let pLen = flatPalette.length;
    let targetPow2 = 2;
    while (targetPow2 < pLen && targetPow2 < 256) {
      targetPow2 *= 2;
    }
    while (flatPalette.length < targetPow2) {
      flatPalette.push(0); // Pad with black
    }

    // Map pixels to palette indices
    const indexedPixels = new Uint8Array(width * height);
    for (let p = 0; p < pixelCount; p++) {
      const offset = p * 4;
      const r = rf.data[offset];
      const g = rf.data[offset + 1];
      const b = rf.data[offset + 2];
      
      // Find nearest color in palette
      const matched = colorMap ? colorMap.map([r, g, b]) : [r, g, b];
      const matchNum = (matched[0] << 16) | (matched[1] << 8) | matched[2];
      let idx = flatPalette.indexOf(matchNum);
      if (idx === -1) idx = 0;
      indexedPixels[p] = idx;
    }

    // Delay in 100ths of a second (centiseconds)
    const delayCenti = Math.max(2, Math.round(rf.durationMs / 10));

    gifWriter.addFrame(0, 0, width, height, indexedPixels, {
      palette: flatPalette,
      delay: delayCenti
    });
  }

  const finalGifBuffer = outputBuffer.subarray(0, gifWriter.end());
  return {
    buffer: finalGifBuffer,
    frameCount: processedFrames.length,
    originalFrameCount: frames.length,
    savedFrames: frames.length - processedFrames.length
  };
}

module.exports = {
  inspectAndExtractZip,
  encodeGif
};
