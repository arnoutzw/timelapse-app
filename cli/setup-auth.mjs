#!/usr/bin/env node

import { RingApi } from 'ring-client-api';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

const TOKEN_PATH = process.env.RING_TOKEN_PATH || path.join(process.cwd(), 'data', 'ring-token.json');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

async function main() {
  console.log('=== Ring Camera — One-Time Authentication Setup ===\n');
  console.log('This will authenticate with your Ring account using email + password + 2FA.');
  console.log('After setup, a refresh token is saved so you never need to do this again.\n');

  const email = await ask('Ring email: ');
  const password = await ask('Ring password: ');

  console.log('\nAuthenticating with Ring... (you will receive a 2FA code via SMS or email)');

  // First attempt — will fail with 2FA required
  let refreshToken;

  try {
    const api = new RingApi({ email, password });
    // This triggers the 2FA challenge
    await api.getCameras();
    // If we get here without 2FA, extract the token
    refreshToken = api.restClient.refreshToken;
  } catch (error) {
    if (error.message?.includes('2fa') || error.message?.includes('Verification Code')) {
      const code = await ask('\nEnter 2FA code: ');

      try {
        const api = new RingApi({ email, password, systemId: `ring-snapshot-${Date.now()}` });
        // Provide the 2FA code
        const response = await api.restClient.request({
          method: 'POST',
          url: 'https://oauth.ring.com/oauth/token',
          json: {
            grant_type: 'password',
            username: email,
            password,
            client_id: 'ring_official_android',
            scope: 'client',
            '2fa-support': 'true',
            '2fa-code': code,
          },
        });
        refreshToken = response.refresh_token;
      } catch (innerError) {
        // Alternative: use ring-client-api's built-in 2FA flow
        const api = new RingApi({
          email,
          password,
          controlCenterDisplayName: 'ring-snapshot-timelapse',
        });

        api.onRefreshTokenUpdated.subscribe({
          next: ({ newRefreshToken }) => {
            refreshToken = newRefreshToken;
          },
        });

        try {
          await api.getCameras();
          if (!refreshToken) refreshToken = api.restClient?.refreshToken;
        } catch (retryError) {
          console.error('\nAuthentication failed:', retryError.message);
          console.error('\nTip: Make sure the 2FA code is correct and try again.');
          console.error('If using ring-client-api >= 12, you may need to generate a refresh token');
          console.error('using the official method. See: https://github.com/dgreif/ring/wiki/Refresh-Tokens');
          process.exit(1);
        }
      }
    } else {
      console.error('\nAuthentication failed:', error.message);
      process.exit(1);
    }
  }

  if (!refreshToken) {
    console.error('\nFailed to obtain refresh token. Try generating one manually:');
    console.error('https://github.com/dgreif/ring/wiki/Refresh-Tokens');
    process.exit(1);
  }

  // Save token
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    TOKEN_PATH,
    JSON.stringify({ refreshToken, updatedAt: new Date().toISOString() }, null, 2),
  );

  console.log(`\nToken saved to: ${TOKEN_PATH}`);

  // Verify by listing cameras
  console.log('\nVerifying connection...');
  const verifyApi = new RingApi({ refreshToken });
  const cameras = await verifyApi.getCameras();
  console.log(`\nFound ${cameras.length} camera(s):`);
  cameras.forEach((cam) => {
    console.log(`  - "${cam.name}" (id: ${cam.id}, model: ${cam.model})`);
  });

  verifyApi.disconnect();
  console.log('\nSetup complete! You can now run the snapshot/timelapse tools.');

  rl.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('Setup failed:', error);
  rl.close();
  process.exit(1);
});
