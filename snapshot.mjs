#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';
import { RingClient } from './lib/ring-client.mjs';
import { captureSnapshot } from './lib/snapshot-capture.mjs';

const outputArg = process.argv[2];
const outputPath = outputArg || path.resolve(process.cwd(), `snapshot_${Date.now()}.jpg`);
const cameraName = process.env.RING_CAMERA_NAME;

const client = await new RingClient({ tokenPath: process.env.RING_TOKEN_PATH }).init();
const camera = await client.getCamera(cameraName);

const result = await captureSnapshot({ camera, outputPath });
console.log(JSON.stringify(result, null, 2));
