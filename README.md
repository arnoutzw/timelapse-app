# Ring Timelapse

Standalone Ring camera snapshot and timelapse tool. Talks directly to Ring's API — no Home Assistant, no Chromium browser, no subscription required.

## Quick Start

### 1. Install dependencies

```bash
npm install
cd pwa_applet && npm install && cd ..
```

### 2. Authenticate with Ring (one-time)

```bash
node cli/setup-auth.mjs
```

You'll be prompted for your Ring email, password, and a 2FA code. A refresh token is saved to `data/ring-token.json` and auto-rotates — you won't need to do this again.

### 3. Take a snapshot

```bash
node snapshot.mjs                     # saves snapshot_<timestamp>.jpg
node snapshot.mjs my-photo.jpg        # custom filename
```

### 4. Run the PWA dashboard

```bash
node pwa_applet/server.mjs
# Open http://localhost:3000
```

### 5. Run a timelapse

```bash
./timelapse.sh --interval 30 --total-duration 3600 --framerate 30
```

---

## Docker Deployment (Proxmox)

```bash
cp .env.example .env

# First: authenticate (interactive)
docker-compose run --rm ring-timelapse node cli/setup-auth.mjs

# Then: start the dashboard
docker-compose up -d

# View logs
docker-compose logs -f
```

The Docker image is ~300MB (Node + FFmpeg only — no Chromium).

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RING_TOKEN_PATH` | `./data/ring-token.json` | Path to Ring refresh token file |
| `RING_CAMERA_NAME` | *(first camera)* | Camera name filter |
| `CAPTURE_METHOD` | `auto` | `auto`, `snapshot_api`, or `live_view` |
| `PORT` | `3000` | PWA server port |

### streams.config.json

```json
{
  "ring": {
    "tokenPath": "./data/ring-token.json"
  },
  "streams": [
    {
      "id": "kweektent",
      "name": "Kweektent",
      "cameraName": "Indoor Cam",
      "startupConnect": false,
      "captureIntervalMs": 15000,
      "captureMethod": "auto"
    }
  ]
}
```

Set `cameraName` to match the name shown in your Ring app.

---

## Capture Methods

| Method | How it works | Subscription needed? | Speed |
|---|---|---|---|
| `snapshot_api` | Requests a JPEG from Ring's cloud | No* | ~1s |
| `live_view` | Starts a SIP session, grabs one frame via FFmpeg, disconnects | No | ~3-5s |
| `auto` | Tries snapshot API first, falls back to live view | No | Varies |

\* Snapshot API may return stale images without Ring Protect on some devices. Use `live_view` if you see this.

---

## Project Structure

```
ring_snapshot/
├── lib/
│   ├── ring-client.mjs          # Ring auth, token persistence, camera discovery
│   ├── snapshot-capture.mjs     # Dual-strategy capture (snapshot API + live view)
│   └── timelapse-engine.mjs     # Node.js timelapse scheduler
├── cli/
│   └── setup-auth.mjs           # One-time 2FA authentication wizard
├── pwa_applet/
│   ├── server.mjs               # Express + WebSocket server (Ring-native)
│   ├── streams.config.json      # Camera configuration
│   └── public/                  # PWA frontend
├── snapshot.mjs                 # CLI snapshot tool
├── timelapse.sh                 # Shell-based timelapse script
├── Dockerfile                   # Slim Docker image (Node + FFmpeg)
└── docker-compose.yml           # Ready for Proxmox deployment
```

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/streams` | GET | List all streams and states |
| `/api/streams/:id/connect` | POST | Start capturing from camera |
| `/api/streams/:id/disconnect` | POST | Stop capturing |
| `/api/streams/:id/restart` | POST | Reconnect |
| `/api/streams/:id/recording/start` | POST | Start MP4 recording |
| `/api/streams/:id/recording/stop` | POST | Stop recording |
| `/api/streams/:id/timelapse/start` | POST | Start timelapse capture |
| `/api/streams/:id/timelapse/stop` | POST | Stop timelapse |
| `/api/streams/:id/frame.jpg` | GET | Latest JPEG frame |
| `/api/streams/:id/media` | GET | List saved recordings/timelapses |
| `/api/health` | GET | Ring auth status + camera info |

WebSocket at `/` streams real-time frames and state updates.

# timelapse-app
