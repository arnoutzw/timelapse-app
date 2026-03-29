const state = {
  streams: [],
  streamMap: new Map(),
  selectedId: null,
  media: null,
};

const streamList = document.getElementById('streamList');
const viewerImage = document.getElementById('viewerImage');
const emptyState = document.getElementById('emptyState');
const viewerTitle = document.getElementById('viewerTitle');
const viewerMeta = document.getElementById('viewerMeta');
const viewerStatus = document.getElementById('viewerStatus');
const viewerNotes = document.getElementById('viewerNotes');
const connectButton = document.getElementById('connectButton');
const disconnectButton = document.getElementById('disconnectButton');
const restartButton = document.getElementById('restartButton');
const openSourceButton = document.getElementById('openSourceButton');
const refreshButton = document.getElementById('refreshButton');
const installButton = document.getElementById('installButton');
const statusSummary = document.getElementById('statusSummary');
const recordStartButton = document.getElementById('recordStartButton');
const recordStopButton = document.getElementById('recordStopButton');
const timelapseStartButton = document.getElementById('timelapseStartButton');
const timelapseStopButton = document.getElementById('timelapseStopButton');
const timelapseIntervalInput = document.getElementById('timelapseIntervalInput');
const timelapseFpsInput = document.getElementById('timelapseFpsInput');
const recordingStatus = document.getElementById('recordingStatus');
const timelapseStatus = document.getElementById('timelapseStatus');
const reloadMediaButton = document.getElementById('reloadMediaButton');
const recordingsList = document.getElementById('recordingsList');
const timelapsesList = document.getElementById('timelapsesList');

let deferredInstallPrompt = null;

function formatTime(timestamp) {
  if (!timestamp) return 'No frame yet';
  return `Last frame ${new Date(timestamp).toLocaleString()}`;
}

function getSelectedStream() {
  return state.streamMap.get(state.selectedId) || null;
}

function formatDuration(startedAt) {
  if (!startedAt) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function setSummary() {
  const values = Array.from(state.streamMap.values());
  const connected = values.filter((item) => item.connected).length;
  const connecting = values.filter((item) => item.connecting).length;
  statusSummary.textContent = `${connected}/${values.length} connected${connecting ? `, ${connecting} starting` : ''}`;
}

function renderList() {
  streamList.innerHTML = '';

  state.streams.forEach((stream) => {
    const live = state.streamMap.get(stream.id) || stream;
    const button = document.createElement('button');
    button.className = `stream-card${state.selectedId === stream.id ? ' active' : ''}`;
    button.type = 'button';
    button.dataset.streamId = stream.id;

    const statusClass = live.connecting ? 'starting' : live.connected ? 'online' : live.lastError ? 'error' : 'offline';
    const statusText = live.connecting ? 'Starting' : live.connected ? 'Live' : live.lastError ? 'Error' : 'Offline';

    button.innerHTML = `
      <div class="stream-card__top">
        <div>
          <p class="stream-card__name">${stream.name}</p>
          <p class="stream-card__id">${stream.id}</p>
        </div>
        <span class="badge ${statusClass}">${statusText}</span>
      </div>
      <p class="stream-card__url">${stream.url}</p>
      <p class="stream-card__meta">${formatTime(live.lastFrameAt)}</p>
    `;

    button.addEventListener('click', () => {
      state.selectedId = stream.id;
      localStorage.setItem('selectedStreamId', stream.id);
      render();
      loadMedia().catch(() => undefined);
    });

    streamList.appendChild(button);
  });
}

function renderViewer() {
  const selected = getSelectedStream();
  if (!selected) return;

  viewerTitle.textContent = selected.name;
  viewerMeta.textContent = selected.url;
  viewerNotes.textContent = selected.notes || 'Configured through streams.config.json';

  const statusClass = selected.connecting ? 'starting' : selected.connected ? 'online' : selected.lastError ? 'error' : 'offline';
  const statusText = selected.connecting
    ? 'Connecting to Ring camera'
    : selected.connected
      ? formatTime(selected.lastFrameAt)
      : selected.lastError
        ? selected.lastError
        : 'Disconnected';

  viewerStatus.className = `viewer-status ${statusClass}`;
  viewerStatus.textContent = statusText;

  connectButton.disabled = selected.connecting || selected.connected;
  disconnectButton.disabled = !selected.connected && !selected.connecting;
  restartButton.disabled = selected.connecting;
  openSourceButton.disabled = false;
  recordStartButton.disabled = selected.connecting || !selected.connected || selected.recording?.active;
  recordStopButton.disabled = !selected.recording?.active;
  timelapseStartButton.disabled = selected.connecting || !selected.connected || selected.timelapse?.active;
  timelapseStopButton.disabled = !selected.timelapse?.active;

  recordingStatus.textContent = selected.recording?.active
    ? `Recording to ${selected.recording.fileName} for ${formatDuration(selected.recording.startedAt)}.`
    : 'Ready to record.';

  timelapseStatus.textContent = selected.timelapse?.active
    ? `Timelapse ${selected.timelapse.fileName} capturing every ${Math.round(selected.timelapse.intervalMs / 1000)} seconds at ${selected.timelapse.fps} fps output.`
    : `Sampling every ${timelapseIntervalInput.value} seconds at ${timelapseFpsInput.value} fps output.`;

  if (selected.lastFrame) {
    viewerImage.src = `data:image/jpeg;base64,${selected.lastFrame}`;
    viewerImage.hidden = false;
    emptyState.hidden = true;
  } else {
    viewerImage.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = selected.connected || selected.connecting
      ? 'Waiting for the first snapshot from Ring...'
      : 'Select Connect to start capturing snapshots from this camera.';
  }
}

function render() {
  renderList();
  renderViewer();
  setSummary();
}

async function callApi(path, method = 'POST') {
  const response = await fetch(path, { method });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function mergeStatePatch(patch) {
  const current = state.streamMap.get(patch.id) || {};
  state.streamMap.set(patch.id, { ...current, ...patch });
}

async function loadStreams() {
  const payload = await callApi('/api/streams', 'GET');
  state.streams = payload.streams;
  payload.states.forEach(mergeStatePatch);

  const remembered = localStorage.getItem('selectedStreamId');
  state.selectedId = state.streamMap.has(remembered) ? remembered : payload.streams[0]?.id || null;
  render();
  await loadMedia();
}

async function actOnSelected(action) {
  const selected = getSelectedStream();
  if (!selected) return;

  try {
    const response = await callApi(`/api/streams/${encodeURIComponent(selected.id)}/${action}`);
    if (response.state) {
      mergeStatePatch(response.state);
    }
    if (response.media) {
      state.media = response.media;
      renderMedia();
    }
    render();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mergeStatePatch({ id: selected.id, lastError: message, connecting: false });
    render();
  }
}

function renderMediaList(container, items, emptyText) {
  container.innerHTML = '';

  if (!items?.length) {
    const empty = document.createElement('p');
    empty.className = 'media-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('a');
    card.className = 'media-item';
    card.href = item.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.innerHTML = `
      <span class="media-item__name">${item.name}</span>
      <span class="media-item__meta">${new Date(item.createdAt).toLocaleString()}</span>
      <span class="media-item__meta">${Math.max(1, Math.round(item.size / 1024))} KB</span>
    `;
    container.appendChild(card);
  });
}

function renderMedia() {
  renderMediaList(recordingsList, state.media?.recordings, 'No recordings yet.');
  renderMediaList(timelapsesList, state.media?.timelapses, 'No timelapses yet.');
}

async function loadMedia() {
  const selected = getSelectedStream();
  if (!selected) return;

  const payload = await callApi(`/api/streams/${encodeURIComponent(selected.id)}/media`, 'GET');
  state.media = payload;
  renderMedia();
}

connectButton.addEventListener('click', () => actOnSelected('connect'));
disconnectButton.addEventListener('click', () => actOnSelected('disconnect'));
restartButton.addEventListener('click', () => actOnSelected('restart'));
refreshButton.addEventListener('click', () => loadStreams());
reloadMediaButton.addEventListener('click', () => loadMedia());
recordStartButton.addEventListener('click', () => actOnSelected('recording/start'));
recordStopButton.addEventListener('click', () => actOnSelected('recording/stop'));
timelapseIntervalInput.addEventListener('input', () => renderViewer());
timelapseFpsInput.addEventListener('input', () => renderViewer());
timelapseStartButton.addEventListener('click', async () => {
  const selected = getSelectedStream();
  if (!selected) return;

  try {
    const response = await fetch(`/api/streams/${encodeURIComponent(selected.id)}/timelapse/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intervalMs: Number(timelapseIntervalInput.value) * 1000,
        fps: Number(timelapseFpsInput.value),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    mergeStatePatch(payload.state);
    state.media = payload.media;
    renderMedia();
    render();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mergeStatePatch({ id: selected.id, lastError: message, connecting: false });
    render();
  }
});
timelapseStopButton.addEventListener('click', () => actOnSelected('timelapse/stop'));

openSourceButton.addEventListener('click', () => {
  const selected = getSelectedStream();
  if (!selected) return;
  window.open(selected.url, '_blank', 'noopener,noreferrer');
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((error) => {
    console.error('Service worker registration failed', error);
  });
}

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'bootstrap') {
    message.data.states.forEach(mergeStatePatch);
    render();
    return;
  }

  if (message.type === 'stream_state') {
    mergeStatePatch(message.data);
    render();
    if (state.selectedId === message.data.id) {
      loadMedia().catch(() => undefined);
    }
    return;
  }

  if (message.type === 'stream_frame') {
    mergeStatePatch({
      id: message.data.id,
      lastFrame: message.data.frame,
      lastFrameAt: message.data.lastFrameAt,
      connected: true,
      lastError: '',
    });

    if (state.selectedId === message.data.id) {
      renderViewer();
    }

    renderList();
    setSummary();
    return;
  }
});

loadStreams().catch((error) => {
  statusSummary.textContent = error instanceof Error ? error.message : String(error);
});
