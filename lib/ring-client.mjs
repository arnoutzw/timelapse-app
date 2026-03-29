import fs from 'node:fs';
import path from 'node:path';
import { RingApi } from 'ring-client-api';

const DEFAULT_TOKEN_PATH = process.env.RING_TOKEN_PATH || '/data/ring-token.json';

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function atomicWriteJson(filePath, data) {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmpPath, payload, { mode: 0o600 });
  const fd = fs.openSync(tmpPath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

function readRefreshToken(tokenPath) {
  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      `Ring token file is missing at ${tokenPath}. Run: node cli/setup-auth.mjs --token-path ${tokenPath}`,
    );
  }

  const parsed = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  const refreshToken = typeof parsed === 'string' ? parsed : parsed?.refreshToken;

  if (!refreshToken) {
    throw new Error(`Token file exists at ${tokenPath} but no refreshToken was found.`);
  }

  return refreshToken;
}

export class RingClient {
  constructor({ tokenPath = DEFAULT_TOKEN_PATH, debug = false } = {}) {
    this.tokenPath = tokenPath;
    this.debug = debug;
    this.ringApi = null;
    this.cameras = null;
    this.lastTokenUpdateAt = null;
  }

  async init() {
    const refreshToken = readRefreshToken(this.tokenPath);
    this.ringApi = new RingApi({ refreshToken, debug: this.debug });

    this.ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken, oldRefreshToken }) => {
      if (newRefreshToken && newRefreshToken !== oldRefreshToken) {
        atomicWriteJson(this.tokenPath, {
          refreshToken: newRefreshToken,
          updatedAt: new Date().toISOString(),
        });
        this.lastTokenUpdateAt = new Date().toISOString();
      }
    });

    this.cameras = await this.ringApi.getCameras();
    return this;
  }

  async getCamera(name) {
    if (!this.cameras) {
      throw new Error('Ring client not initialized. Call init() first.');
    }

    if (!name) {
      if (this.cameras.length === 0) {
        throw new Error('No Ring cameras found for this account.');
      }
      return this.cameras[0];
    }

    const normalized = name.toLowerCase();
    const camera = this.cameras.find((c) => c.name?.toLowerCase() === normalized);
    if (!camera) {
      const names = this.cameras.map((c) => c.name).join(', ') || '(none)';
      throw new Error(`Camera "${name}" not found. Available cameras: ${names}`);
    }

    return camera;
  }

  listCameras() {
    return (this.cameras ?? []).map((camera) => ({
      id: camera.id,
      name: camera.name,
      kind: camera.model,
    }));
  }
}

export function writeRefreshToken(tokenPath, refreshToken) {
  atomicWriteJson(tokenPath, {
    refreshToken,
    updatedAt: new Date().toISOString(),
  });
}
