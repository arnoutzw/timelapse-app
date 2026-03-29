import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const MIN_INTERVAL_MS = 15_000;

// Per-camera rate limit tracking
const lastCaptureMap = new Map();

/**
 * Capture a snapshot from a Ring camera.
 *
 * Strategy:
 *  1. Try Ring Snapshot API (fast, no live session)
 *  2. Fall back to live view frame-grab via FFmpeg
 *
 * @param {import('ring-client-api').RingCamera} camera
 * @param {string} outputPath
 * @param {object} [options]
 * @param {'auto'|'snapshot_api'|'live_view'} [options.method='auto']
 * @param {number} [options.timeout=30000]
 * @returns {Promise<{path: string, size: number, timestamp: number, method: string}>}
 */
export async function captureSnapshot(camera, outputPath, options = {}) {
  const { method = 'auto', timeout = 30000 } = options;
  const cameraId = camera.id;

  // Enforce rate limit
  const lastCapture = lastCaptureMap.get(cameraId) || 0;
  const elapsed = Date.now() - lastCapture;
  if (elapsed < MIN_INTERVAL_MS) {
    const wait = MIN_INTERVAL_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let result;

  if (method === 'live_view') {
    result = await captureViaLiveView(camera, outputPath, timeout);
  } else if (method === 'snapshot_api') {
    result = await captureViaSnapshotApi(camera, outputPath, timeout);
  } else {
    // auto: try snapshot API first, fall back to live view
    try {
      result = await captureViaSnapshotApi(camera, outputPath, timeout);
    } catch (snapshotError) {
      console.warn(`[snapshot] Snapshot API failed (${snapshotError.message}), trying live view...`);
      result = await captureViaLiveView(camera, outputPath, timeout);
    }
  }

  lastCaptureMap.set(cameraId, Date.now());
  return result;
}

/**
 * Capture via Ring's Snapshot API (requests camera to take a photo)
 */
async function captureViaSnapshotApi(camera, outputPath, timeout) {
  console.log(`[snapshot] Requesting snapshot from Ring API for "${camera.name}"...`);

  const buffer = await Promise.race([
    camera.getSnapshot(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Snapshot API timeout')), timeout)),
  ]);

  if (!buffer || buffer.length === 0) {
    throw new Error('Snapshot API returned empty buffer');
  }

  fs.writeFileSync(outputPath, buffer);

  const stats = fs.statSync(outputPath);
  console.log(`[snapshot] Saved via Snapshot API: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);

  return {
    path: outputPath,
    size: stats.size,
    timestamp: Date.now(),
    method: 'snapshot_api',
  };
}

/**
 * Capture via live view: start a SIP session, grab one frame with FFmpeg, disconnect.
 */
async function captureViaLiveView(camera, outputPath, timeout) {
  console.log(`[snapshot] Starting live view for "${camera.name}" to grab a frame...`);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Live view frame capture timeout'));
    }, timeout);

    camera.startLiveTranscoding({
      output: [
        '-vframes', '1',
        '-q:v', '2',
        '-y',
        outputPath,
      ],
    }).then((session) => {
      session.onCallEnded.subscribe(() => {
        clearTimeout(timer);

        if (!fs.existsSync(outputPath)) {
          reject(new Error('Live view produced no output file'));
          return;
        }

        const stats = fs.statSync(outputPath);
        if (stats.size === 0) {
          fs.unlinkSync(outputPath);
          reject(new Error('Live view produced empty file'));
          return;
        }

        console.log(`[snapshot] Saved via live view: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);
        resolve({
          path: outputPath,
          size: stats.size,
          timestamp: Date.now(),
          method: 'live_view',
        });
      });
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Capture a frame and return the buffer directly (for streaming to WebSocket/FFmpeg).
 */
export async function captureSnapshotBuffer(camera, options = {}) {
  const { method = 'auto', timeout = 30000 } = options;
  const cameraId = camera.id;

  const lastCapture = lastCaptureMap.get(cameraId) || 0;
  const elapsed = Date.now() - lastCapture;
  if (elapsed < MIN_INTERVAL_MS) {
    const wait = MIN_INTERVAL_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  let buffer;
  let usedMethod;

  if (method === 'snapshot_api' || method === 'auto') {
    try {
      buffer = await Promise.race([
        camera.getSnapshot(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
      ]);
      usedMethod = 'snapshot_api';
    } catch (error) {
      if (method === 'snapshot_api') throw error;
      // fall through to live view
    }
  }

  if (!buffer || buffer.length === 0) {
    buffer = await captureViaLiveViewBuffer(camera, timeout);
    usedMethod = 'live_view';
  }

  lastCaptureMap.set(cameraId, Date.now());

  return {
    buffer,
    timestamp: Date.now(),
    method: usedMethod,
  };
}

/**
 * Live view frame-grab returning a buffer (no file I/O).
 */
async function captureViaLiveViewBuffer(camera, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Live view timeout')), timeout);

    camera.startLiveTranscoding({
      output: [
        '-vframes', '1',
        '-q:v', '2',
        '-f', 'mjpeg',
        'pipe:1',
      ],
    }).then((session) => {
      const chunks = [];

      session.onCallEnded.subscribe(() => {
        clearTimeout(timer);
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          reject(new Error('Live view produced no data'));
          return;
        }
        resolve(buffer);
      });

      // Collect stdout data
      if (session.transcodeProcess?.stdout) {
        session.transcodeProcess.stdout.on('data', (chunk) => chunks.push(chunk));
      }
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
