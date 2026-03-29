# Ring Timelapse Package (Standalone)

This project captures timelapse frames directly from Ring cameras using `ring-client-api`.
It removes the Home Assistant + Puppeteer + Chromium dependency chain and uses native Node.js + FFmpeg.

## Implementation Order (Built in Sequence)

1. **`lib/ring-client.mjs`**
   - Loads refresh token from disk.
   - Initializes `RingApi`.
   - Persists rotated refresh tokens immediately.
   - Provides camera discovery and lookup helpers.
2. **`cli/setup-auth.mjs`**
   - One-time CLI wizard to save a refresh token.
   - Validates token by listing discovered cameras.
3. **`lib/snapshot-capture.mjs`**
   - Primary strategy: snapshot API capture.
   - Secondary strategy: live-view + FFmpeg single-frame fallback.
   - Enforces per-camera minimum 15s capture interval.
4. **`snapshot.mjs`**
   - Thin CLI entry point that wires dotenv + Ring client + snapshot capture.
5. **`lib/timelapse-engine.mjs`**
   - Interval scheduler, capture loop, and FFmpeg stitching into MP4.

## Extra Recommendations Included

- **Provider abstraction ready**: capture logic is isolated in `snapshot-capture.mjs`, enabling future provider swaps.
- **Safe token persistence**: token writes are atomic (`tmp` + `fsync` + `rename`) and mode-hardened (`0600`).
- **Rate-limit guardrails**: fixed 15s minimum interval guard per camera with enforced wait.
- **Operational diagnostics**: capture result includes method, timestamp, path, and byte size.
- **Safer rollout support**: code is modular so a feature flag path can route between legacy and Ring-native implementations.

## Environment

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

```dotenv
RING_TOKEN_PATH=/data/ring-token.json
RING_CAMERA_NAME=Indoor Cam
```

## Usage

### 1) Setup auth token

```bash
node cli/setup-auth.mjs --token-path /data/ring-token.json
```

### 2) Capture one snapshot

```bash
node snapshot.mjs ./snapshot.jpg
```

### 3) Use timelapse engine from your app

Import `TimelapseEngine` from `lib/timelapse-engine.mjs` and run `start()`/`stop()`.
