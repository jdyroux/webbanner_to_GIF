const express = require('express');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

/**
 * Starts a transient local static web server to serve the extracted banner.
 */
function createBannerServer(directory) {
  const app = express();
  app.use(express.static(directory));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close()
      });
    });
  });
}

/**
 * Captures frames from the HTML banner.
 */
async function captureBannerFrames({
  bannerDir,
  htmlFile,
  width,
  height,
  fps = 25,
  durationSec = 5,
  finalBufferSec = 1,
  onProgress = () => {}
}) {
  const server = await createBannerServer(bannerDir);
  const targetUrl = `${server.url}/${htmlFile}`;

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    defaultViewport: {
      width: parseInt(width, 10),
      height: parseInt(height, 10),
      deviceScaleFactor: 1
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--allow-file-access-from-files'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: parseInt(width, 10), height: parseInt(height, 10) });

  await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });

  // Dynamically check timeline duration if window.tl or GSAP exists
  let dynamicDuration = null;
  try {
    dynamicDuration = await page.evaluate(() => {
      if (window.tl && typeof window.tl.duration === 'function') {
        const d = window.tl.duration();
        if (d > 0) return d;
      }
      return null;
    });
  } catch (e) {}

  const effectiveDuration = dynamicDuration ? Math.max(parseFloat(durationSec), dynamicDuration) : parseFloat(durationSec);

  // Step-accurate GSAP / CSS Clock Synchronization
  await page.evaluate(() => {
    // Pause any active GSAP / TweenMax timeline
    if (window.tl && typeof window.tl.pause === 'function') {
      window.tl.pause(0);
    } else if (window.TweenMax && typeof window.TweenMax.globalTimeScale === 'function') {
      window.TweenMax.pauseAll();
    }
  });

  const frameIntervalSec = 1 / fps;
  const frameIntervalMs = 1000 / fps;
  const totalDurationSec = effectiveDuration + parseFloat(finalBufferSec);
  const totalFrames = Math.round(totalDurationSec * fps);
  const frames = [];

  for (let i = 0; i < totalFrames; i++) {
    const currentTimeSec = i * frameIntervalSec;

    // Advance timeline to exact timestamp
    await page.evaluate((t) => {
      if (window.tl && typeof window.tl.seek === 'function') {
        window.tl.seek(t, false);
      }
    }, currentTimeSec);

    // Capture screenshot as PNG buffer
    const screenshotBuf = await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: parseInt(width, 10),
        height: parseInt(height, 10)
      }
    });

    frames.push({
      pngBuffer: Buffer.from(screenshotBuf),
      durationMs: frameIntervalMs
    });

    onProgress({
      current: i + 1,
      total: totalFrames,
      percent: Math.round(((i + 1) / totalFrames) * 100)
    });
  }

  await browser.close();
  server.close();

  return frames;
}

module.exports = {
  captureBannerFrames
};
