import { captureSnapshot } from './snapshot-capture.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const MIN_INTERVAL_MS = 15_000;

export class TimelapseEngine {
  /**
   * @param {import('ring-client-api').RingCamera} camera
   * @param {object} options
   * @param {string} options.snapshotsDir - Directory to store individual JPEGs
   * @param {string} options.outputVideo - Output MP4 path
   * @param {number} [options.intervalMs=30000] - Capture interval (min 15000)
   * @param {number} [options.totalDurationMs=3600000] - Total capture duration
   * @param {number} [options.framerate=30] - Output video framerate
   * @param {'auto'|'snapshot_api'|'live_view'} [options.captureMethod='auto']
   */
  constructor(camera, options) {
    this.camera = camera;
    this.snapshotsDir = options.snapshotsDir;
    this.outputVideo = options.outputVideo;
    this.framerate = options.framerate || 30;
    this.captureMethod = options.captureMethod || 'auto';
    this.totalDurationMs = options.totalDurationMs || 3_600_000;

    this.intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs || 30_000);
    if (options.intervalMs && options.intervalMs < MIN_INTERVAL_MS) {
      console.warn(`[timelapse] Interval ${options.intervalMs}ms is below minimum ${MIN_INTERVAL_MS}ms, clamped to ${MIN_INTERVAL_MS}ms`);
    }

    this.active = false;
    this.frameCount = 0;
    this.startedAt = null;
    this.lastCaptureAt = null;
    this._timer = null;
    this._stopResolve = null;
  }

  getStatus() {
    return {
      active: this.active,
      frameCount: this.frameCount,
      elapsedMs: this.startedAt ? Date.now() - this.startedAt : 0,
      lastCaptureAt: this.lastCaptureAt,
      intervalMs: this.intervalMs,
      totalDurationMs: this.totalDurationMs,
    };
  }

  async start() {
    if (this.active) return;

    this.active = true;
    this.frameCount = 0;
    this.startedAt = Date.now();
    this.lastCaptureAt = null;

    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }

    const totalFrames = Math.floor(this.totalDurationMs / this.intervalMs);
    console.log(`[timelapse] Starting: ${totalFrames} frames at ${this.intervalMs / 1000}s intervals, ${this.framerate} fps output`);

    return new Promise((resolve) => {
      this._stopResolve = resolve;

      const captureFrame = async () => {
        if (!this.active) return;

        const elapsed = Date.now() - this.startedAt;
        if (elapsed >= this.totalDurationMs) {
          const result = await this.stop();
          return;
        }

        this.frameCount++;
        const framePath = path.join(this.snapshotsDir, `snapshot_${String(this.frameCount).padStart(5, '0')}.jpg`);

        try {
          await captureSnapshot(this.camera, framePath, {
            method: this.captureMethod,
            timeout: Math.min(this.intervalMs - 2000, 30000),
          });
          this.lastCaptureAt = Date.now();
          console.log(`[timelapse] Frame ${this.frameCount}/${totalFrames} (${Math.round(elapsed / 1000)}s elapsed)`);
        } catch (error) {
          console.error(`[timelapse] Frame ${this.frameCount} failed: ${error.message}`);
          this.frameCount--; // Don't count failed frames
        }

        if (this.active) {
          this._timer = setTimeout(captureFrame, this.intervalMs);
        }
      };

      captureFrame();
    });
  }

  async stop() {
    if (!this.active) return null;

    this.active = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    const duration = Date.now() - this.startedAt;
    console.log(`[timelapse] Capture complete: ${this.frameCount} frames in ${Math.round(duration / 1000)}s`);

    if (this.frameCount === 0) {
      console.warn('[timelapse] No frames captured, skipping video generation');
      const result = { videoPath: null, frameCount: 0, duration };
      if (this._stopResolve) this._stopResolve(result);
      return result;
    }

    // Stitch with FFmpeg
    console.log(`[timelapse] Generating video: ${this.outputVideo}`);
    const outputDir = path.dirname(this.outputVideo);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await this._runFfmpeg();

    const stats = fs.statSync(this.outputVideo);
    console.log(`[timelapse] Video created: ${this.outputVideo} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

    const result = { videoPath: this.outputVideo, frameCount: this.frameCount, duration };
    if (this._stopResolve) this._stopResolve(result);
    return result;
  }

  _runFfmpeg() {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-framerate', String(this.framerate),
        '-i', path.join(this.snapshotsDir, 'snapshot_%05d.jpg'),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast',
        '-movflags', '+faststart',
        this.outputVideo,
      ]);

      ffmpeg.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) process.stderr.write(`[ffmpeg] ${text}\n`);
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });

      ffmpeg.on('error', reject);
    });
  }
}
