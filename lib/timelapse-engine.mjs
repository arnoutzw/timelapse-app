import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { captureSnapshot, getSnapshotMinIntervalMs } from './snapshot-capture.mjs';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

export class TimelapseEngine {
  constructor({ camera, outputDir, intervalMs, durationMs, framerate = 30, captureStrategy }) {
    this.camera = camera;
    this.outputDir = outputDir;
    this.intervalMs = Math.max(intervalMs, getSnapshotMinIntervalMs());
    this.durationMs = durationMs;
    this.framerate = framerate;
    this.captureStrategy = captureStrategy;
    this.frameCount = 0;
    this.errors = 0;
    this.startedAt = null;
    this.timer = null;
    this.stopTimeout = null;
  }

  getStatus() {
    return {
      active: !!this.timer,
      startedAt: this.startedAt,
      frameCount: this.frameCount,
      errors: this.errors,
      intervalMs: this.intervalMs,
      minIntervalMs: getSnapshotMinIntervalMs(),
    };
  }

  async start() {
    if (this.timer) return;
    fs.mkdirSync(this.outputDir, { recursive: true });
    this.startedAt = new Date().toISOString();

    const tick = async () => {
      const fileName = `frame_${String(this.frameCount + 1).padStart(6, '0')}.jpg`;
      const outputPath = path.join(this.outputDir, fileName);
      try {
        await captureSnapshot({ camera: this.camera, outputPath, strategy: this.captureStrategy });
        this.frameCount += 1;
      } catch (error) {
        this.errors += 1;
        console.warn(`[timelapse] frame capture failed: ${error.message}`);
      }
    };

    await tick();
    this.timer = setInterval(tick, this.intervalMs);
    this.stopTimeout = setTimeout(() => this.stop().catch((e) => console.error(e)), this.durationMs);
  }

  async stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    clearTimeout(this.stopTimeout);
    this.timer = null;

    const outputVideo = path.join(this.outputDir, `timelapse_${Date.now()}.mp4`);
    await run('ffmpeg', [
      '-y',
      '-framerate', String(this.framerate),
      '-pattern_type', 'glob',
      '-i', `${this.outputDir}/*.jpg`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputVideo,
    ]);

    return outputVideo;
  }
}
