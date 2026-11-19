import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = 3000;
const app = express();
const server = http.createServer(app);

function getLanIp(): string {
  const nets = os.networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        candidates.push(net.address);
      }
    }
  }
  // Prefer 192.168.x.x or 10.x.x.x Wi-Fi/LAN addresses over virtual bridge IPs
  const wifiIp =
    candidates.find((ip) => ip.startsWith('192.168.')) ||
    candidates.find((ip) => ip.startsWith('10.')) ||
    candidates[0];
  return wifiIp || '127.0.0.1';
}

app.get('/api/info', (req, res) => {
  const lanIp = getLanIp();
  const hostHeader = req.get('x-forwarded-host') || req.get('host') || `localhost:${PORT}`;
  const protoHeader = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();

  let baseUrl = `${protoHeader}://${hostHeader}`;
  if (
    process.env.APP_URL &&
    process.env.APP_URL.startsWith('http') &&
    !process.env.APP_URL.includes('MY_APP_URL')
  ) {
    baseUrl = process.env.APP_URL.replace(/\/$/, '');
  }

  // If running on localhost, use LAN IP so phones on same Wi-Fi can reach it
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    baseUrl = `http://${lanIp}:${PORT}`;
  }

  // Provide shared URL (ais-pre-*) when hosted on AI Studio preview so phones don't hit dev auth wall
  const sharedUrl = baseUrl.replace('//ais-dev-', '//ais-pre-');

  res.json({
    ip: lanIp,
    port: PORT,
    url: sharedUrl,
    devUrl: baseUrl,
    lanUrl: `http://${lanIp}:${PORT}`
  });
});

const ttsCache = new Map<string, Buffer>();
const TTS_CACHE_MAX = 120;

// Cloud TV Spoken Commentary TTS proxy endpoint for Smart TV browsers where window.speechSynthesis has no local voices
app.get('/api/tts', async (req, res) => {
  try {
    const rawText = String(req.query.text || '').trim().slice(0, 200);
    const tl = String(req.query.tl || 'en-IN').trim();
    if (!rawText) {
      res.status(400).end();
      return;
    }
    const cacheKey = `${tl}::${rawText}`;
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      // Refresh LRU position
      ttsCache.delete(cacheKey);
      ttsCache.set(cacheKey, cached);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached);
      return;
    }

    const ttsUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
      tl
    )}&q=${encodeURIComponent(rawText)}`;
    const upstream = await fetch(ttsUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 12; SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    ttsCache.set(cacheKey, buf);
    if (ttsCache.size > TTS_CACHE_MAX) {
      const oldestKey = ttsCache.keys().next().value;
      if (oldestKey !== undefined) ttsCache.delete(oldestKey);
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});

// Short route /c for low-density, instant-scan QR codes (/c?r=XXXX)
app.get('/c', (_req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'controller.html'));
});

const BLOCKED_STATIC_PATHS = new Set([
  '/server.ts',
  '/server.py',
  '/package.json',
  '/package-lock.json',
  '/tsconfig.json',
  '/vite.config.ts'
]);

app.get('/manifest.webmanifest', (_req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.resolve(process.cwd(), 'manifest.webmanifest'));
});

app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.resolve(process.cwd(), 'sw.js'));
});

app.use((req, res, next) => {
  const reqPath = req.path || '';
  const isWellKnown = reqPath.startsWith('/.well-known/');
  if (BLOCKED_STATIC_PATHS.has(reqPath) || (reqPath.startsWith('/.') && !isWellKnown)) {
    res.status(403).end('Forbidden');
    return;
  }
  next();
});

// Serve plain ES modules directly from workspace root
app.use(express.static(path.resolve(process.cwd()), { dotfiles: 'ignore' }));

// WebSocket Relay matching server.py room protocol
interface ClientMeta {
  room: string;
  role: string;
  slot: string;
  superseded?: boolean;
}

const rooms = new Map<string, Set<WebSocket>>();
const clientMeta = new WeakMap<WebSocket, ClientMeta>();

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16384 });

function broadcastToRoom(room: string, sender: WebSocket, message: string) {
  const peers = rooms.get(room);
  if (!peers) return;
  for (const client of peers) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function replaceStaleSameSlotSocket(room: string, role: string, slot: string, incomingWs: WebSocket) {
  const peers = rooms.get(room);
  if (!peers) return;
  for (const peer of peers) {
    if (peer === incomingWs) continue;
    const meta = clientMeta.get(peer);
    if (meta && meta.role === role && meta.slot === slot) {
      meta.superseded = true;
      peers.delete(peer);
      try {
        peer.close(4001, 'Superseded by reconnect');
      } catch {}
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
  let room = (url.searchParams.get('room') || url.searchParams.get('r') || 'CRIC').toUpperCase().slice(0, 4);
  let role = url.searchParams.get('role') || 'controller';
  let slot = url.searchParams.get('slot') || 'p1';

  if (!rooms.has(room)) rooms.set(room, new Set());
  replaceStaleSameSlotSocket(room, role, slot, ws);
  rooms.get(room)!.add(ws);
  clientMeta.set(ws, { room, role, slot, superseded: false });

  ws.on('message', (data) => {
    const text = data.toString();
    try {
      const parsed = JSON.parse(text);
      if (parsed.role && typeof parsed.role === 'string') {
        role = parsed.role;
      }
      if (parsed.slot && typeof parsed.slot === 'string') {
        slot = parsed.slot;
      }
      if (parsed.room && typeof parsed.room === 'string') {
        const nextRoom = parsed.room.toUpperCase().slice(0, 4);
        if (nextRoom !== room) {
          rooms.get(room)?.delete(ws);
          room = nextRoom;
          if (!rooms.has(room)) rooms.set(room, new Set());
          replaceStaleSameSlotSocket(room, role, slot, ws);
          rooms.get(room)!.add(ws);
        }
      }
      const prevMeta = clientMeta.get(ws);
      clientMeta.set(ws, { room, role, slot, superseded: prevMeta?.superseded || false });
    } catch {
      // Forward raw message
    }
    broadcastToRoom(room, ws, text);
  });

  ws.on('close', () => {
    rooms.get(room)?.delete(ws);
    if (rooms.get(room)?.size === 0) rooms.delete(room);
    const meta = clientMeta.get(ws);
    if (!meta || meta.superseded) return;
    if (meta.role === 'controller') {
      broadcastToRoom(
        room,
        ws,
        JSON.stringify({
          type: 'controller_disconnect',
          room,
          slot: meta.slot
        })
      );
    } else if (meta.role === 'online_peer' || meta.role === 'host') {
      broadcastToRoom(
        room,
        ws,
        JSON.stringify({
          type: 'online_peer_disconnect',
          room,
          role: meta.role
        })
      );
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Box Cricket 3D Live Server listening on http://0.0.0.0:${PORT}`);
});
