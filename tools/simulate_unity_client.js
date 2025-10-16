// Unity telemetry simulator: connects to the relay server and streams rich frame data + resource catalog.
// Usage: node simulate_unity_client.js ws://<server-ip>:8080 http://<server-ip>:8080

const WebSocket = require('ws');
const fetch = require('node-fetch');
const FormData = require('form-data');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node simulate_unity_client.js <wsUrl> <httpUrl>');
  process.exit(1);
}

const wsUrl = args[0];
const httpUrl = args[1];

const clientId = 'sim-' + Math.random().toString(36).substr(2, 6);
const ws = new WebSocket(wsUrl);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const baseThumbB64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUQEBIVFhUVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lICUtLS8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAOEA4QMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAABAgMEBQYAB//EADkQAAIBAwIEBAQEBwAAAAAAAAECAwAEEQUhEjFBEyJRYXGBFDJCkaGxwfAHFSMzQ1Lx/8QAGgEBAAMBAQEAAAAAAAAAAAAAAAECAwQFBv/EACgRAAICAgICAgIDAAAAAAAAAAABAhEDIRIxQQQTUWEUcYEUgZGh8P/aAAwDAQACEQMRAD8A9yjYqQqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqUqf/2Q==';

const resourceCatalog = [
  {
    id: 'tex-ground',
    name: 'Ground_Albedo',
    type: 'Texture2D',
    width: 2048,
    height: 2048,
    sizeKB: 2750,
    format: 'DXT5',
    thumbnailUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABzElEQVR4Xu2aP0vbUBTHP4UOovwHBQ6dSZ7dRzpoEww2hIUySxEC4iI4n9BsuD9oEMNCmSZElCTL+2U4Yg2gj+OINpXLE2t7P2/2d3d39fX3uZ3fB9D3Puec75z7rn3nEsAK6CXQkEuARDdNYlpC9ifzuuFJ0hvt8m2A3S7BRJ/Uw3S7ATp6v96LXYDPmfH3zsbwPOzZYJ9Wq0WwBxHLe/Qeomc654A8Cah+ObJWy8AIHnWwGgVSdY1hYm7CBy6NFL/krtk8iLCXQWbDPa2PutXwFzm3NRl3vzFoJDG4w9m63Zu0rX86+lJTFuFYwB8NOJfhu77vEw7i3q1fHDZBiwr/kGj37iPa1z2Qd9+BvULKz3m3r2t0twVBRGJpn/B7C6P2Q2E60fSBZtufz2SxYL2Ut6oddrst1mx2+RhmKyIPgGF3zSxGBoygMRgGDIChmAAOMYBjCgmMIBnCANMIAzwgDPCAI8IAzwgCPCA8Ea7BToy2KBPbzsUDyjSNYqiLskOVZl+rsDIVqtdo4/X6/1Kp1v+dp/p9NJPJBbDbbdDb7fb3W6/XY8Hq9TzqdbrFYLDYbDbTbb7PZrI6nQ6nY7HY9Go9FoNBpFItFotFgsFgMBgMhkMhWq3G43m83m83m83m82m00mk0mk0mk0mk0gk8lm8vl8vlcrlcLotFotFoPB4PBoaDAYDAYRl8Af8TjqTplMqRwAAAABJRU5ErkJggg=='
  },
  {
    id: 'tex-hero',
    name: 'Hero_Diffuse',
    type: 'Texture2D',
    width: 1024,
    height: 1024,
    sizeKB: 980,
    format: 'ASTC_6x6',
    thumbnailUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAv0lEQVR4nO3XsQ2DQBAF0TPQmpAksFDJcZaJJMBkG0kWyYWoYqAJMTIsN5iPX+7Oy+A8At1Zv53d3X14AwM7t8fsXDO5nACCM4Zt16kxtO5gAAMEYQFgNgDEEYDFALQRCAsQRALEA0GwBjA0RgM0IAG0lYA2CMA7SWANgtANktgDYKwDZLYA2C4AzaLIDYK8BslsA2CsA+XY+8BoXzppAduLhd5nbc2u12Ow6Hw6jUYjIw5ms1mM4nE4XC7XbDZbDZ7P53JZLL7fbDY7nU6n8/m8zmaz+dzuVzOZ/P5fD4bDAYDAYDAYDAYDAYDJZDKZTCYTCYRCKRSKRRKJBLJZFJpPJZPL5fL5fD4fD4/H4/F4PAw+p9OJRKJRKJRKJRKJBLJZDKZTCYTCYRCKRSKRf4MdbluqtT8HpAAAAAElFTkSuQmCC'
  },
  {
    id: 'mesh-hero',
    name: 'Hero_Mesh',
    type: 'Mesh',
    vertexCount: 18500,
    triangleCount: 31000,
    sizeKB: 2200
  },
  {
    id: 'mat-hero',
    name: 'Hero_Material',
    type: 'Material',
    shader: 'HDRP/Lit',
    sizeKB: 120
  }
];

let frameIndex = 0;

ws.on('open', async () => {
  console.log('ws open');
  ws.send(JSON.stringify({ role: 'unity', clientId }));
  await sleep(200); // allow server to register
  sendResourceSnapshot();
  startSending();
});

ws.on('message', (m) => {
  console.log('recv:', m.toString());
});

ws.on('close', () => console.log('ws closed'));
ws.on('error', (e) => console.error('ws err', e));

async function uploadDummyThumb() {
  const buf = Buffer.from(baseThumbB64, 'base64');
  const formData = new FormData();
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

function sendResourceSnapshot(extra = {}) {
  ws.send(
    JSON.stringify({
      type: 'resource_snapshot',
      clientId,
      resources: resourceCatalog.map((r) => ({ ...r, ...extra[r.id] }))
    })
  );
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

async function startSending() {
  while (ws.readyState === WebSocket.OPEN) {
    frameIndex++;
    const ts = Date.now();

    // vary metrics slightly each frame
    const fps = randomRange(55, 62);
    const cpuMain = randomRange(8, 14);
    const cpuRender = randomRange(4, 9);
    const gpu = randomRange(10, 15);
    const memUsed = randomRange(1400, 1550);

    let thumbUrl = null;
    if (frameIndex % 45 === 0) {
      thumbUrl = await uploadDummyThumb();
    }

    const frameMsg = {
      type: 'frame',
      clientId,
      frameIndex,
      timestamp: ts,
      buildVersion: '1.2.0-dev',
      sceneName: frameIndex % 300 < 150 ? 'MainHub' : 'Dungeon_Room01',
      dt: +(1 / fps).toFixed(4),
      metrics: {
        fps: +fps.toFixed(2),
        cpu: { mainThreadMs: +cpuMain.toFixed(2), renderThreadMs: +cpuRender.toFixed(2) },
        gpu: { frameMs: +gpu.toFixed(2) },
        memory: { totalMB: 2048, usedMB: +memUsed.toFixed(1), texturesMB: 512, meshesMB: 280, audioMB: 120, gcAllocKB: Math.round(randomRange(120, 220)) },
        rendering: {
          drawCalls: Math.round(randomRange(1100, 1300)),
          triangles: Math.round(randomRange(2.2e6, 2.6e6)),
          batches: Math.round(randomRange(450, 520)),
          shadowCasters: Math.round(randomRange(40, 55))
        },
        environment: {
          battery: { level: Math.round(randomRange(55, 90)), isCharging: frameIndex % 120 < 30 },
          temperatureC: randomRange(34, 38).toFixed(1)
        }
      },
      camera: {
        name: 'MainCamera',
        position: { x: +(Math.sin(frameIndex / 40) * 12).toFixed(2), y: 2.1, z: +(Math.cos(frameIndex / 40) * 12).toFixed(2) },
        forward: { x: 0, y: 0, z: -1 },
        fov: 60
      },
      quality: {
        lodBias: 1.5,
        renderPipeline: 'URP',
        dynamicResolutionScale: 1.0
      },
      resources: ['tex-ground', 'tex-hero', 'mesh-hero', 'mat-hero'],
      events: frameIndex % 120 === 0 ? [{ type: 'GC', durationMs: randomRange(12, 18).toFixed(2) }] : [],
      thumbnailUrl: thumbUrl
    };

    ws.send(JSON.stringify(frameMsg));
    console.log('sent frame', frameIndex, 'thumb', thumbUrl ? 'yes' : 'no');

    // Occasionally nudge resource catalog to simulate updates (e.g., streaming new mip)
    if (frameIndex % 120 === 0) {
      const delta = Math.round(randomRange(20, 60));
      resourceCatalog[0].sizeKB += delta;
      sendResourceSnapshot({
        'tex-ground': { sizeKB: resourceCatalog[0].sizeKB }
      });
    }

    await sleep(200);
  }
}
