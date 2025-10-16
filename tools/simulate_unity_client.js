// Simple simulator that connects to telemetry server via WebSocket and periodically sends frame messages and resource snapshots.
// Usage: node simulate_unity_client.js ws://<server-ip>:8080 http://<server-ip>:8080

const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node simulate_unity_client.js <wsUrl> <httpUrl>');
  process.exit(1);
}
const wsUrl = args[0];
const httpUrl = args[1];

const clientId = 'sim-' + Math.random().toString(36).substr(2,6);
const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  console.log('ws open');
  ws.send(JSON.stringify({ role: 'unity', clientId }));
  startSending();
});

ws.on('message', (m) => {
  console.log('recv:', m.toString());
});

ws.on('close', () => console.log('ws closed'));
ws.on('error', (e) => console.error('ws err', e));

let frameIndex = 0;

async function uploadDummyThumb() {
  // create a tiny jpeg buffer
  const b64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUQEBIVFhUVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lICUtLS8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAOEA4QMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAABAgMEBQYAB//EADkQAAIBAwIEBAQEBwAAAAAAAAECAwAEEQUhEjFBEyJRYXGBFDJCkaGxwfAHFSMzQ1Lx/8QAGgEBAAMBAQEAAAAAAAAAAAAAAAECAwQFBv/EACgRAAICAgICAgIDAAAAAAAAAAABAhEDIRIxQQQTUWEUcYEUgZGh8P/aAAwDAQACEQMRAD8A9yjYqQqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqf/2Q==';
  const buf = Buffer.from(b64, 'base64');
  const formData = new (require('form-data'))();
  formData.append('thumb', buf, { filename: 'thumb.jpg', contentType: 'image/jpeg' });
  formData.append('clientId', clientId);
  formData.append('frameIndex', frameIndex.toString());
  try {
    const res = await fetch(httpUrl + '/upload/thumb', { method: 'POST', body: formData });
    const j = await res.json();
    return j.url;
  } catch (e) {
    console.error('thumb upload failed', e.message || e);
    return null;
  }
}

function startSending() {
  setInterval(async () => {
    frameIndex++;
    const ts = Date.now();
    // every 10 frames send a resource snapshot
    if (frameIndex % 10 === 0) {
      const resources = [{ id: 'res-1', name: 'TestTex', type: 'Texture', width: 64, height: 64, sizeKB: 4 }];
      ws.send(JSON.stringify({ type: 'resource_snapshot', clientId, resources }));
    }
    let thumbUrl = null;
    if (frameIndex % 30 === 0) {
      thumbUrl = await uploadDummyThumb();
    }
    const frameMsg = { type: 'frame', clientId, frameIndex, timestamp: ts, sceneName: 'SimScene', dt: 0.016, metrics: { fps: 60, dt: 0.016 }, resources: ['res-1'], thumbnailUrl: thumbUrl };
    ws.send(JSON.stringify(frameMsg));
    console.log('sent frame', frameIndex, 'thumb', thumbUrl);
  }, 200);
}
