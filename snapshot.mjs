#!/usr/bin/env node

import 'dotenv/config';
import { RingClient } from './lib/ring-client.mjs';
import { captureSnapshot } from './lib/snapshot-capture.mjs';

const OUTPUT = process.argv[2] || `snapshot_${Date.now()}.jpg`;
const CAMERA_NAME = process.env.RING_CAMERA_NAME || '';
const METHOD = process.env.CAPTURE_METHOD || 'auto';

const client = new RingClient();

try {
  await client.init();
  const camera = client.getCamera(CAMERA_NAME || undefined);

  console.log(`Capturing from "${camera.name}"...`);
  const result = await captureSnapshot(camera, OUTPUT, { method: METHOD });

  console.log(`Saved: ${result.path} (${(result.size / 1024).toFixed(1)} KB, method: ${result.method})`);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
} finally {
  await client.disconnect();
}
