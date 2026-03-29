import puppeteer from 'puppeteer';
import fs from 'fs';

const HA_BASE = 'http://homeassistant.local:8123';
const HA_URL  = `${HA_BASE}/dashboard-kweektent/0`;
const TOKEN   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJiYjgzNzgwYjFiYWQ0OWQzOGY4MGQ5YmRlYjczNzc2NSIsImlhdCI6MTc3NDU3OTQzNSwiZXhwIjoyMDg5OTM5NDM1fQ.xWt9CR4K1ruPVe5ZqsEG2pB2cEDPUwWTrCNDqrXH2rk';
const OUT     = process.argv[2] || `snapshot_${Date.now()}.jpg`;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage();

// Inject auth in the correct HA frontend format
await page.evaluateOnNewDocument((token, hassUrl) => {
  localStorage.setItem('hassTokens', JSON.stringify({
    hassUrl,
    clientId: hassUrl + '/',
    expires: Date.now() + 1000 * 60 * 60 * 24 * 365, // 1 year (ms)
    refresh_token: '',
    access_token: token,
    token_type: 'Bearer',
  }));
}, TOKEN, HA_BASE);

await page.goto(HA_URL, { waitUntil: 'load', timeout: 30000 });

// Screenshot right after load to check auth state
await page.screenshot({ path: '/tmp/ha_debug.png' });
console.log('Early screenshot: /tmp/ha_debug.png');

// Wait for HA SPA to render dashboard
console.log('Waiting for dashboard...');
await page.waitForFunction(() => {
  const ha = document.querySelector('home-assistant');
  if (!ha?.shadowRoot) return false;
  const main = ha.shadowRoot.querySelector('home-assistant-main');
  if (!main?.shadowRoot) return false;
  return !!main.shadowRoot.querySelector('ha-panel-lovelace');
}, { timeout: 30000 });
console.log('Dashboard ready.');

await page.screenshot({ path: '/tmp/ha_debug2.png' });
console.log('Dashboard screenshot: /tmp/ha_debug2.png');

// Wait for WebRTC video stream
console.log('Waiting for video stream...');
await page.waitForFunction(() => {
  function findVideos(root, res = []) {
    root.querySelectorAll('video').forEach(v => res.push(v));
    root.querySelectorAll('*').forEach(n => { if (n.shadowRoot) findVideos(n.shadowRoot, res); });
    return res;
  }
  const v = findVideos(document).find(v => v.srcObject);
  return v && v.readyState >= 2 && v.videoWidth > 0;
}, { timeout: 45000 });
console.log('Stream live.');

const jpegBase64 = await page.evaluate(() => {
  function findVideos(root, res = []) {
    root.querySelectorAll('video').forEach(v => res.push(v));
    root.querySelectorAll('*').forEach(n => { if (n.shadowRoot) findVideos(n.shadowRoot, res); });
    return res;
  }
  const video = findVideos(document).find(v => v.srcObject);
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
});

fs.writeFileSync(OUT, Buffer.from(jpegBase64, 'base64'));
console.log(`Saved: ${OUT}`);
await browser.close();
