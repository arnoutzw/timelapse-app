import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const lastCaptureByCamera = new Map();
const MIN_INTERVAL_MS = 15_000;

export const CAPTURE_STRATEGY = {
  SNAPSHOT_PRIMARY: 'snapshot_primary',
  LIVE_VIEW_PRIMARY: 'live_view_primary',
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnWithOutput(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} failed (${code}): ${stderr || stdout}`));
      }
    });
  });
}

async function enforceRateLimit(cameraKey) {
  const now = Date.now();
  const last = lastCaptureByCamera.get(cameraKey);
  if (!last) {
    lastCaptureByCamera.set(cameraKey, now);
    return;
  }

  const delta = now - last;
  if (delta < MIN_INTERVAL_MS) {
    await wait(MIN_INTERVAL_MS - delta);
  }

  lastCaptureByCamera.set(cameraKey, Date.now());
}

async function saveBufferToFile(buffer, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, buffer);
  const stats = await fs.promises.stat(outputPath);
  return stats.size;
}

async function captureViaSnapshotApi(camera, outputPath) {
  const imageBuffer = await camera.getSnapshot();
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error('Snapshot API returned empty image data');
  }

  const size = await saveBufferToFile(imageBuffer, outputPath);
  return { path: outputPath, size, method: 'snapshot_api', timestamp: new Date().toISOString() };
}

function getLiveStreamUrl(stream) {
  return stream?.url || stream?.streamUrl || stream?.sipOptions?.to || stream?.sipSession?.rtspUrl;
}

async function captureViaLiveView(camera, outputPath) {
  const stream = await camera.startLiveCall();
  try {
    const liveUrl = getLiveStreamUrl(stream);
    if (!liveUrl) {
      throw new Error('Unable to determine live stream URL from Ring live call session');
    }

    const ffmpegArgs = [
      '-y',
      '-i', liveUrl,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ];
    await spawnWithOutput('ffmpeg', ffmpegArgs);
    const stats = await fs.promises.stat(outputPath);
    return { path: outputPath, size: stats.size, method: 'live_view_frame_grab', timestamp: new Date().toISOString() };
  } finally {
    if (typeof stream?.stop === 'function') {
      await stream.stop();
    }
  }
}

function getDefaultStrategy() {
  if (process.env.RING_NO_PROTECT === '1' || process.env.RING_NO_PROTECT === 'true') {
    return CAPTURE_STRATEGY.LIVE_VIEW_PRIMARY;
  }
  return CAPTURE_STRATEGY.SNAPSHOT_PRIMARY;
}

export async function captureSnapshot({
  camera,
  outputPath,
  allowLiveViewFallback = true,
  strategy = getDefaultStrategy(),
}) {
  const cameraKey = camera.id || camera.name || 'unknown-camera';
  await enforceRateLimit(cameraKey);

  const primary = strategy === CAPTURE_STRATEGY.LIVE_VIEW_PRIMARY ? captureViaLiveView : captureViaSnapshotApi;
  const fallback = strategy === CAPTURE_STRATEGY.LIVE_VIEW_PRIMARY ? captureViaSnapshotApi : captureViaLiveView;

  try {
    return await primary(camera, outputPath);
  } catch (primaryError) {
    if (!allowLiveViewFallback) {
      throw primaryError;
    }

    try {
      const result = await fallback(camera, outputPath);
      return { ...result, primaryError: primaryError.message };
    } catch (fallbackError) {
      throw new Error(`Primary and fallback capture failed. Primary: ${primaryError.message}. Fallback: ${fallbackError.message}`);
    }
  }
}

export function getSnapshotMinIntervalMs() {
  return MIN_INTERVAL_MS;
}
