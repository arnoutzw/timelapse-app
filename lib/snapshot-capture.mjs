import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const lastCaptureByCamera = new Map();
const MIN_INTERVAL_MS = 15_000;

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
  const size = await saveBufferToFile(imageBuffer, outputPath);
  return { path: outputPath, size, method: 'snapshot_api', timestamp: new Date().toISOString() };
}

async function captureViaLiveView(camera, outputPath) {
  const stream = await camera.startLiveCall();
  try {
    const ffmpegArgs = [
      '-y',
      '-i', stream.url,
      '-frames:v', '1',
      '-q:v', '2',
      outputPath,
    ];
    await spawnWithOutput('ffmpeg', ffmpegArgs);
    const stats = await fs.promises.stat(outputPath);
    return { path: outputPath, size: stats.size, method: 'live_view_fallback', timestamp: new Date().toISOString() };
  } finally {
    await stream.stop();
  }
}

export async function captureSnapshot({ camera, outputPath, allowLiveViewFallback = true }) {
  const cameraKey = camera.id || camera.name || 'unknown-camera';
  await enforceRateLimit(cameraKey);

  try {
    return await captureViaSnapshotApi(camera, outputPath);
  } catch (error) {
    if (!allowLiveViewFallback) throw error;
    return captureViaLiveView(camera, outputPath);
  }
}

export function getSnapshotMinIntervalMs() {
  return MIN_INTERVAL_MS;
}
