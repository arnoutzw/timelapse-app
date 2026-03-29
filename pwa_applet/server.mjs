import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RingClient } from '../lib/ring-client.mjs';
import { captureSnapshotBuffer } from '../lib/snapshot-capture.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = process.env.STREAM_CONFIG_PATH || path.join(__dirname, 'streams.config.json');

const app = express();
const port = Number(process.env.PORT || 3000);
const MEDIA_ROOT = path.join(__dirname, 'media');
const RECORDINGS_DIR = path.join(MEDIA_ROOT, 'recordings');
const TIMELAPSES_DIR = path.join(MEDIA_ROOT, 'timelapses');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(MEDIA_ROOT));

[MEDIA_ROOT, RECORDINGS_DIR, TIMELAPSES_DIR].forEach((directory) => {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
});

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.streams) || parsed.streams.length === 0) {
    throw new Error(`No streams found in ${CONFIG_PATH}`);
  }

  return {
    ring: {
      tokenPath: parsed.ring?.tokenPath || process.env.RING_TOKEN_PATH,
    },
    streams: parsed.streams.map((stream, index) => {
      if (!stream.id || !stream.name) {
        throw new Error(`Stream at index ${index} is missing id or name`);
      }

      return {
        id: String(stream.id),
        name: String(stream.name),
        cameraName: stream.cameraName || '',
        notes: stream.notes ? String(stream.notes) : '',
        startupConnect: Boolean(stream.startupConnect),
        captureIntervalMs: Math.max(15000, Number(stream.captureIntervalMs || 15000)),
        captureMethod: stream.captureMethod || 'auto',
      };
    }),
  };
}

const config = loadConfig();

// Shared Ring client
let ringClient = null;

async function getRingClient() {
  if (!ringClient) {
    ringClient = new RingClient(config.ring.tokenPath);
    await ringClient.init();
  }
  return ringClient;
}

function publicStream(stream) {
  return {
    id: stream.id,
    name: stream.name,
    url: `ring://${stream.cameraName || stream.id}`,
    notes: stream.notes,
    startupConnect: stream.startupConnect,
  };
}

function createInitialState(stream) {
  return {
    stream,
    camera: null,
    connected: false,
    connecting: false,
    lastError: '',
    lastFrame: null,
    lastFrameAt: null,
    captureTimer: null,
    recordingProcess: null,
    timelapseProcess: null,
    recording: {
      active: false,
      fileName: null,
      startedAt: null,
    },
    timelapse: {
      active: false,
      fileName: null,
      startedAt: null,
      intervalMs: stream.captureIntervalMs,
      fps: 20,
      lastCaptureAt: null,
    },
  };
}

const streamStates = new Map(config.streams.map((stream) => [stream.id, createInitialState(stream)]));
const wsClients = new Set();

function getStatePayload(state) {
  return {
    id: state.stream.id,
    name: state.stream.name,
    url: `ring://${state.stream.cameraName || state.stream.id}`,
    notes: state.stream.notes,
    startupConnect: state.stream.startupConnect,
    connected: state.connected,
    connecting: state.connecting,
    hasFrame: Boolean(state.lastFrame),
    lastFrameAt: state.lastFrameAt,
    lastError: state.lastError,
    recording: state.recording,
    timelapse: state.timelapse,
  };
}

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wsClients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

function broadcastStreamState(state) {
  broadcast({ type: 'stream_state', data: getStatePayload(state) });
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function waitForProcessClose(processRef) {
  return new Promise((resolve) => {
    processRef.once('close', resolve);
  });
}

function listMediaFilesForStream(streamId, type) {
  const directory = type === 'timelapse' ? TIMELAPSES_DIR : RECORDINGS_DIR;
  const prefix = `${safeId(streamId)}_`;

  return fs.readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.mp4'))
    .map((name) => {
      const absolutePath = path.join(directory, name);
      const stat = fs.statSync(absolutePath);
      return {
        name,
        type,
        createdAt: stat.mtimeMs,
        size: stat.size,
        url: `/media/${type === 'timelapse' ? 'timelapses' : 'recordings'}/${encodeURIComponent(name)}`,
      };
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

function getMediaPayload(streamId) {
  return {
    streamId,
    recordings: listMediaFilesForStream(streamId, 'recording'),
    timelapses: listMediaFilesForStream(streamId, 'timelapse'),
  };
}

function createOutputProcess({ streamId, type, inputFps, outputPath }) {
  const ffmpegArgs = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'mjpeg',
    '-framerate', String(inputFps),
    '-i', 'pipe:0',
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-movflags', '+faststart',
    outputPath,
  ];

  const processRef = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  processRef.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      console.error(`[ffmpeg:${type}:${streamId}] ${text}`);
    }
  });

  return processRef;
}

async function stopRecording(state) {
  if (!state.recordingProcess) return;

  const processRef = state.recordingProcess;
  state.recordingProcess = null;

  if (processRef.stdin && !processRef.stdin.destroyed) {
    processRef.stdin.end();
  }

  await waitForProcessClose(processRef);
  state.recording = {
    active: false,
    fileName: state.recording.fileName,
    startedAt: state.recording.startedAt,
  };
  broadcastStreamState(state);
}

async function stopTimelapse(state) {
  if (!state.timelapseProcess) return;

  const processRef = state.timelapseProcess;
  state.timelapseProcess = null;

  if (processRef.stdin && !processRef.stdin.destroyed) {
    processRef.stdin.end();
  }

  await waitForProcessClose(processRef);
  state.timelapse = {
    ...state.timelapse,
    active: false,
    lastCaptureAt: null,
  };
  broadcastStreamState(state);
}

function stopCaptureLoop(state) {
  if (state.captureTimer) {
    clearInterval(state.captureTimer);
    state.captureTimer = null;
  }
}

async function disconnectStream(state) {
  stopCaptureLoop(state);
  await Promise.all([stopRecording(state), stopTimelapse(state)]);

  state.camera = null;
  state.connected = false;
  state.connecting = false;
  state.lastFrame = null;
  state.lastFrameAt = null;
  broadcastStreamState(state);
}

async function startCaptureLoop(state) {
  const captureInterval = state.stream.captureIntervalMs;
  const method = state.stream.captureMethod;

  const doCapture = async () => {
    if (!state.connected || !state.camera) return;

    try {
      const result = await captureSnapshotBuffer(state.camera, { method });
      const frameBase64 = result.buffer.toString('base64');

      state.lastFrame = frameBase64;
      state.lastFrameAt = Date.now();

      // Feed to recording FFmpeg process
      if (state.recordingProcess?.stdin && !state.recordingProcess.stdin.destroyed) {
        state.recordingProcess.stdin.write(result.buffer);
      }

      // Feed to timelapse FFmpeg process (respecting interval)
      if (state.timelapse.active && state.timelapseProcess?.stdin && !state.timelapseProcess.stdin.destroyed) {
        const lastCaptureAt = state.timelapse.lastCaptureAt || 0;
        if (state.lastFrameAt - lastCaptureAt >= state.timelapse.intervalMs) {
          state.timelapse.lastCaptureAt = state.lastFrameAt;
          state.timelapseProcess.stdin.write(result.buffer);
          broadcastStreamState(state);
        }
      }

      // Broadcast frame to WebSocket clients
      broadcast({
        type: 'stream_frame',
        data: {
          id: state.stream.id,
          frame: frameBase64,
          lastFrameAt: state.lastFrameAt,
        },
      });
    } catch (error) {
      console.error(`[capture:${state.stream.id}] ${error.message}`);
      state.lastError = error.message;
      broadcastStreamState(state);
    }
  };

  // Capture first frame immediately
  await doCapture();

  // Then at interval
  state.captureTimer = setInterval(doCapture, captureInterval);
}

async function connectStream(state) {
  if (state.connected || state.connecting) {
    return getStatePayload(state);
  }

  state.connecting = true;
  state.lastError = '';
  broadcastStreamState(state);

  try {
    const client = await getRingClient();
    state.camera = client.getCamera(state.stream.cameraName || undefined);

    console.log(`[${state.stream.id}] Connected to Ring camera: "${state.camera.name}"`);

    state.connected = true;
    state.connecting = false;
    broadcastStreamState(state);

    // Start periodic snapshot capture loop
    startCaptureLoop(state).catch((error) => {
      console.error(`[${state.stream.id}] Capture loop error: ${error.message}`);
    });

    return getStatePayload(state);
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    state.connecting = false;
    await disconnectStream(state);
    state.lastError = error instanceof Error ? error.message : String(error);
    broadcastStreamState(state);
    throw error;
  }
}

function getStateOr404(id, res) {
  const state = streamStates.get(id);
  if (!state) {
    res.status(404).json({ error: `Unknown stream "${id}"` });
    return null;
  }
  return state;
}

// --- REST API (identical surface to original) ---

app.get('/api/streams', (req, res) => {
  res.json({
    streams: config.streams.map(publicStream),
    states: Array.from(streamStates.values(), getStatePayload),
  });
});

app.post('/api/streams/:id/connect', async (req, res) => {
  const state = getStateOr404(req.params.id, res);
  if (!state) return;

  try {
    const result = await connectStream(state);
    res.json({ ok: true, state: result });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/streams/:id/disconnect', async (req, res) => {
  const state = getStateOr404(req.params.id, res);
  if (!state) return;

  await disconnectStream(state);
  res.json({ ok: true, state: getStatePayload(state) });
});

app.post('/api/streams/:id/restart', async (req, res) => {
  const state = getStateOr404(req.params.id, res);
  if (!state) return;

  try {
    await disconnectStream(state);
    const result = await connectStream(state);
    res.json({ ok: true, state: result });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/streams/:id/recording/start', async (req, res) => {
  const state = getStateOr404(req.params.id, res);
  if (!state) return;

  if (!state.connected) {
    res.status(400).json({ error: 'Connect the stream before recording.' });
    return;
  }

  if (state.recording.active) {
    res.json({ ok: true, state: getStatePayload(state), media: getMediaPayload(state.stream.id) });
    return;
  }

  const fileName = `${safeId(state.stream.id)}_${Date.now()}.mp4`;
  const outputPath = path.join(RECORDINGS_DIR, fileName);
  state.recordingProcess = createOutputProcess({
    streamId: state.stream.id,
    type: 'recording',
    inputFps: 12,
    outputPath,
  });

  state.recording = { active: true, fileName, startedAt: Date.now() };
  broadcastStreamState(state);
  res.json({ ok: true, state: getStatePayload(state), media: getMediaPayload(state.stream.id) });
});

app.post('/api/streams/:id/recording/stop', async (req, res) => {
  const state = getStateOr404(req.params.id, res);
  if (!state) return;

  await stopRecording(state);
  res.json({ ok: true, state: getStatePayload(state), media: getMediaPayload(state.stream.id) });
});

app.post('/api/streams/:id/timelapse/start', async (req, res) => {
  const state = getStateOr404(req.params.id, res);
  if (!state) return;

  if (!state.connected) {
    res.status(400).json({ error: 'Connect the stream before starting a timelapse.' });
    return;
  }

  if (state.timelapse.active) {
    res.json({ ok: true, state: getStatePayload(state), media: getMediaPayload(state.stream.id) });
    return;
  }

  const intervalMs = Math.max(15000, Number(req.body?.intervalMs || 15000));
  const fps = Math.max(1, Math.min(60, Number(req.body?.fps || 20)));
  const fileName = `${safeId(state.stream.id)}_${Date.now()}.mp4`;
  const outputPath = path.join(TIMELAPSES_DIR, fileName);

  state.timelapseProcess = createOutputProcess({
    streamId: state.stream.id,
    type: 'timelapse',
    inputFps: fps,
    outputPath,
  });

  state.timelapse = {
    active: true,
    fileName,
    startedAt: Date.now(),
    intervalMs,
    fps,
    lastCaptureAt: null,
  };
  broadcastStreamState(state);
  res.json({ ok: true, state: getStatePayload(state), media: getMediaPayload(state.stream.id) });
});

app.post('/api/streams/:id/timelapse/stop', async (req, res) => {
  const state = getStateOr404(req.params.id, res);
  if (!state) return;

  await stopTimelapse(state);
  res.json({ ok: true, state: getStatePayload(state), media: getMediaPayload(state.stream.id) });
});

app.get('/api/streams/:id/media', (req, res) => {
  const state = getStateOr404(req.params.id, res);
  if (!state) return;

  res.json(getMediaPayload(state.stream.id));
});

app.get('/api/streams/:id/frame.jpg', (req, res) => {
  const state = streamStates.get(req.params.id);
  if (!state?.lastFrame) {
    res.status(404).json({ error: 'No frame available yet' });
    return;
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(state.lastFrame, 'base64'));
});

app.get('/api/health', async (req, res) => {
  try {
    const client = ringClient;
    const cameras = client ? client.getCameras() : [];
    res.json({
      status: 'ok',
      ring: {
        authenticated: Boolean(client),
        cameras: cameras.map((c) => ({ name: c.name, id: c.id, model: c.model })),
      },
      streams: {
        total: streamStates.size,
        connected: Array.from(streamStates.values()).filter((s) => s.connected).length,
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    mode: 'ring-direct',
    streamCount: config.streams.length,
  });
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(port, () => {
  console.log(`Ring Timelapse PWA listening on http://localhost:${port}`);
  console.log(`Using config: ${CONFIG_PATH}`);
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({
    type: 'bootstrap',
    data: {
      states: Array.from(streamStates.values(), getStatePayload),
    },
  }));
  ws.on('close', () => wsClients.delete(ws));
});

// Auto-connect streams marked for startup
for (const state of streamStates.values()) {
  if (state.stream.startupConnect) {
    connectStream(state).catch((error) => {
      console.error(`Failed to auto-connect ${state.stream.id}:`, error.message);
    });
  }
}
