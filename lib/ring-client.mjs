import { RingApi } from 'ring-client-api';
import fs from 'fs';
import path from 'path';

const DEFAULT_TOKEN_PATH = process.env.RING_TOKEN_PATH || path.join(process.cwd(), 'data', 'ring-token.json');

export class RingClient {
  constructor(tokenPath = DEFAULT_TOKEN_PATH) {
    this.tokenPath = tokenPath;
    this.api = null;
    this.cameras = [];
  }

  async init() {
    const tokenData = this._loadToken();

    this.api = new RingApi({
      refreshToken: tokenData.refreshToken,
      cameraStatusPollingSeconds: 20,
    });

    // Persist rotated refresh tokens immediately
    this.api.onRefreshTokenUpdated.subscribe({
      next: ({ newRefreshToken }) => {
        this._saveToken(newRefreshToken);
        console.log('[ring-client] Refresh token updated and persisted');
      },
    });

    this.cameras = await this.api.getCameras();
    console.log(`[ring-client] Found ${this.cameras.length} camera(s): ${this.cameras.map((c) => c.name).join(', ')}`);

    return this;
  }

  getCamera(name) {
    if (!this.cameras.length) {
      throw new Error('No Ring cameras found on this account');
    }

    if (!name) {
      return this.cameras[0];
    }

    const match = this.cameras.find(
      (c) => c.name.toLowerCase() === name.toLowerCase() || String(c.id) === String(name),
    );

    if (!match) {
      const available = this.cameras.map((c) => `"${c.name}" (id: ${c.id})`).join(', ');
      throw new Error(`Camera "${name}" not found. Available: ${available}`);
    }

    return match;
  }

  getCameras() {
    return this.cameras;
  }

  _loadToken() {
    if (!fs.existsSync(this.tokenPath)) {
      throw new Error(
        `Ring token file not found at ${this.tokenPath}\n` +
        'Run "node cli/setup-auth.mjs" to authenticate with Ring for the first time.',
      );
    }

    const raw = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));

    if (!raw.refreshToken) {
      throw new Error(`Token file at ${this.tokenPath} is missing refreshToken`);
    }

    return raw;
  }

  _saveToken(refreshToken) {
    const dir = path.dirname(this.tokenPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(
      this.tokenPath,
      JSON.stringify({ refreshToken, updatedAt: new Date().toISOString() }, null, 2),
    );
  }

  async disconnect() {
    if (this.api) {
      this.api.disconnect();
    }
  }
}
