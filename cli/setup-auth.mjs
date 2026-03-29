#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { RingClient, writeRefreshToken } from '../lib/ring-client.mjs';

function argValue(flag, defaultValue) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : defaultValue;
}

async function main() {
  const tokenPath = argValue('--token-path', process.env.RING_TOKEN_PATH || '/data/ring-token.json');
  const rl = readline.createInterface({ input, output });

  try {
    console.log('Ring refresh token setup');
    console.log('1) Generate or retrieve a Ring refresh token.');
    console.log('2) Paste it below to store it securely for this app.');

    const refreshToken = (await rl.question('Refresh token: ')).trim();
    if (!refreshToken) {
      throw new Error('No refresh token provided.');
    }

    writeRefreshToken(tokenPath, refreshToken);
    console.log(`Saved token to ${tokenPath}`);

    const client = await new RingClient({ tokenPath }).init();
    const cameras = client.listCameras();
    if (cameras.length === 0) {
      console.log('No cameras found on this account.');
    } else {
      console.log('Discovered cameras:');
      cameras.forEach((camera) => console.log(`- ${camera.name} (${camera.id})`));
    }

    console.log('Setup complete.');
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exit(1);
});
