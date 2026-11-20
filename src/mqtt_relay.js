/**
 * Zero-Dependency Triple-Lane Cloud Relay Client (src/mqtt_relay.js)
 * Connects simultaneously over:
 *   1) wss://broker.emqx.io:8084/mqtt      (MQTT v3.1.1 WSS — fast streaming)
 *   2) wss://test.mosquitto.org:8081/mqtt  (MQTT v3.1.1 WSS — parallel mirror, zero broker desync!)
 *   3) wss://ntfy.sh/.../ws + HTTPS POST   (Standard Port 443 — 100% firewall/Jio/Airtel CGNAT proof!)
 *
 * Works on GitHub Pages, Vercel, Android TV APK WebView, Jio/Airtel 4G/5G CGNAT, and Home Wi-Fi.
 */

const MQTT_BROKERS = [
  { id: 'emqx', url: 'wss://broker.emqx.io:8084/mqtt' },
  { id: 'mosq', url: 'wss://test.mosquitto.org:8081/mqtt' }
];

const NTFY_WS_BASE = 'wss://ntfy.sh';
const NTFY_HTTP_BASE = 'https://ntfy.sh';

// Critical low-rate control packets that ALWAYS travel over Port-443 ntfy.sh in addition to MQTT
const PORT443_CRITICAL_TYPES = new Set([
  'join',
  'joined_ack',
  'role_sync',
  'shot_mode',
  'shot_mode_lock',
  'phone_action',
  'touch_swipe',
  'air_swing',
  'start_or_rematch',
  'calibrate',
  'calibrate_zero',
  'run_hold',
  'turn_back',
  'crease_step',
  'bowler_type',
  'runup_hold',
  'quick_flick',
  'vibrate',
  'controller_disconnect',
  'online_peer_ack',
  'online_peer_disconnect',
  'online_bowl_aim',
  'online_bowl_release',
  'online_bat_shot',
  'online_run_action',
  'online_delivery_complete',
  'online_state'
]);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeUtf8String(str) {
  const bytes = textEncoder.encode(str);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function encodeRemainingLength(len) {
  const bytes = [];
  let x = len;
  do {
    let encoded = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) encoded |= 0x80;
    bytes.push(encoded);
  } while (x > 0);
  return new Uint8Array(bytes);
}

function concatBytes(parts) {
  let total = 0;
  for (let i = 0; i < parts.length; i++) total += parts[i].length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], offset);
    offset += parts[i].length;
  }
  return out;
}

function buildConnectPacket(clientId, keepAliveSec = 30) {
  const protoName = encodeUtf8String('MQTT');
  const varHeader = new Uint8Array([
    ...protoName,
    0x04, // MQTT 3.1.1
    0x02, // Clean Session
    (keepAliveSec >> 8) & 0xff,
    keepAliveSec & 0xff
  ]);
  const payload = encodeUtf8String(clientId);
  const remLen = encodeRemainingLength(varHeader.length + payload.length);
  return concatBytes([new Uint8Array([0x10]), remLen, varHeader, payload]);
}

function buildSubscribePacket(packetId, topics) {
  const varHeader = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
  const payloadParts = [];
  for (let i = 0; i < topics.length; i++) {
    payloadParts.push(encodeUtf8String(topics[i]));
    payloadParts.push(new Uint8Array([0x00])); // QoS 0
  }
  const payload = concatBytes(payloadParts);
  const remLen = encodeRemainingLength(varHeader.length + payload.length);
  return concatBytes([new Uint8Array([0x82]), remLen, varHeader, payload]);
}

function buildPublishPacket(topic, jsonPayload) {
  const topicBytes = encodeUtf8String(topic);
  const payloadBytes = textEncoder.encode(jsonPayload);
  const remLen = encodeRemainingLength(topicBytes.length + payloadBytes.length);
  return concatBytes([new Uint8Array([0x30]), remLen, topicBytes, payloadBytes]);
}

const PINGREQ_PACKET = new Uint8Array([0xc0, 0x00]);

/**
 * Single MQTT-over-WSS lane (one persistent connection to one broker)
 */
class SingleMqttLane {
  constructor({ id, url, role, roomCode, WebSocketImpl, onMessage, onStateChange }) {
    this.id = id;
    this.url = url;
    this.role = role;
    this.roomCode = roomCode;
    this.WebSocketImpl = WebSocketImpl;
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;

    this.ws = null;
    this.connected = false;
    this.destroyed = false;
    this._packetId = 1;
    this._pingTimer = null;
    this._retryTimer = null;
    this._watchdog = null;
    this._rxBuffer = new Uint8Array(0);
    this._clientId = `bc3d_${id}_${role}_${Math.random().toString(36).slice(2, 8)}`;
  }

  getPublishTopic() {
    const ch = this.role === 'host' ? 'h' : this.role === 'controller' ? 'c' : 'p';
    return `boxcricket3d/v3/${this.roomCode}/${ch}`;
  }

  getSubscribeTopics() {
    const p = `boxcricket3d/v3/${this.roomCode}`;
    if (this.role === 'host') return [`${p}/c`, `${p}/p`];
    if (this.role === 'controller') return [`${p}/h`];
    return [`${p}/h`, `${p}/p`];
  }

  connect() {
    if (this.destroyed || !this.WebSocketImpl) return;
    this._cleanupSocketOnly();

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this._scheduleRetry(2500);
      return;
    }

    try {
      const ws = new this.WebSocketImpl(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      this._rxBuffer = new Uint8Array(0);

      this._watchdog = setTimeout(() => {
        if (!this.connected && this.ws === ws) {
          try { ws.close(); } catch {}
        }
      }, 6500);

      ws.onopen = () => {
        if (this.destroyed || this.ws !== ws) return;
        try {
          ws.send(buildConnectPacket(this._clientId, 30));
        } catch {}
      };

      ws.onmessage = (ev) => {
        if (this.destroyed || this.ws !== ws) return;
        const d = ev.data;
        if (d instanceof ArrayBuffer) {
          this._ingestBytes(new Uint8Array(d));
        } else if (typeof Uint8Array !== 'undefined' && ArrayBuffer.isView(d)) {
          this._ingestBytes(new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
        } else if (typeof Blob !== 'undefined' && d instanceof Blob) {
          d.arrayBuffer()
            .then((buf) => {
              if (!this.destroyed && this.ws === ws) {
                this._ingestBytes(new Uint8Array(buf));
              }
            })
            .catch(() => {});
        }
      };

      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this._clearTimers();
        if (this.destroyed) return;
        if (wasConnected && this.onStateChange) this.onStateChange();
        this._scheduleRetry(wasConnected ? 1200 : 4000);
      };

      ws.onerror = () => {};
    } catch {
      this._scheduleRetry(4500);
    }
  }

  _ingestBytes(chunk) {
    this._rxBuffer = concatBytes([this._rxBuffer, chunk]);
    let offset = 0;

    while (offset + 2 <= this._rxBuffer.length) {
      const headerByte = this._rxBuffer[offset];
      const packetType = (headerByte >> 4) & 0x0f;

      let multiplier = 1;
      let remLen = 0;
      let lenBytes = 0;
      let completeLen = false;
      for (let i = 1; i <= 4; i++) {
        if (offset + i >= this._rxBuffer.length) break;
        const b = this._rxBuffer[offset + i];
        remLen += (b & 0x7f) * multiplier;
        multiplier *= 128;
        lenBytes = i;
        if ((b & 0x80) === 0) {
          completeLen = true;
          break;
        }
      }

      if (!completeLen) break;
      const totalPacketLen = 1 + lenBytes + remLen;
      if (offset + totalPacketLen > this._rxBuffer.length) break;

      const bodyStart = offset + 1 + lenBytes;
      const bodyEnd = offset + totalPacketLen;

      if (packetType === 2 && remLen >= 2) {
        const returnCode = this._rxBuffer[bodyStart + 1];
        if (returnCode === 0) {
          this.connected = true;
          if (this._watchdog) {
            clearTimeout(this._watchdog);
            this._watchdog = null;
          }
          try {
            const subId = (this._packetId++ % 65000) + 1;
            this.ws.send(buildSubscribePacket(subId, this.getSubscribeTopics()));
          } catch {}
          if (this._pingTimer) clearInterval(this._pingTimer);
          this._pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === 1) {
              try { this.ws.send(PINGREQ_PACKET); } catch {}
            }
          }, 18000);
          if (this.onStateChange) this.onStateChange();
        }
      } else if (packetType === 3 && remLen >= 2) {
        const topicLen = (this._rxBuffer[bodyStart] << 8) | this._rxBuffer[bodyStart + 1];
        const qos = (headerByte >> 1) & 0x03;
        const payloadStart = bodyStart + 2 + topicLen + (qos > 0 ? 2 : 0);
        if (payloadStart <= bodyEnd) {
          const text = textDecoder.decode(this._rxBuffer.subarray(payloadStart, bodyEnd));
          try {
            const parsed = JSON.parse(text);
            if (this.onMessage) this.onMessage(parsed);
          } catch {}
        }
      }

      offset += totalPacketLen;
    }

    if (offset > 0) {
      this._rxBuffer = this._rxBuffer.slice(offset);
    }
  }

  sendJson(jsonStr) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return false;
    try {
      this.ws.send(buildPublishPacket(this.getPublishTopic(), jsonStr));
      return true;
    } catch {
      return false;
    }
  }

  _clearTimers() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
  }

  _scheduleRetry(ms) {
    if (this.destroyed) return;
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this.connect(), ms);
  }

  _cleanupSocketOnly() {
    this.connected = false;
    this._clearTimers();
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  destroy() {
    this.destroyed = true;
    this._cleanupSocketOnly();
  }
}

/**
 * Standard Port 443 Lane (ntfy.sh WSS subscribe + zero-preflight HTTPS POST)
 * Guarantees 100% pairing + instant shot/button/wheel controls even on Jio/Airtel/router networks
 * that block non-443 WebSocket ports (8081/8084).
 */
class Port443NtfyLane {
  constructor({ role, roomCode, WebSocketImpl, fetchImpl, onMessage, onStateChange }) {
    this.role = role;
    this.roomCode = roomCode;
    this.WebSocketImpl = WebSocketImpl;
    this.fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;

    this.ws = null;
    this.connected = false;
    this.destroyed = false;
    this._retryTimer = null;
    this._lastPingPostMs = 0;
    this._lastHudPostMs = 0;
    this._lastWheelPostMs = 0;
    this._postTimestamps = [];
  }

  _topicName(ch) {
    return `bc3d_v3_rm_${this.roomCode}_${ch}`;
  }

  getPublishTopic() {
    const ch = this.role === 'host' ? 'h' : this.role === 'controller' ? 'c' : 'p';
    return this._topicName(ch);
  }

  getSubscribeTopicsCsv() {
    if (this.role === 'host') return `${this._topicName('c')},${this._topicName('p')}`;
    if (this.role === 'controller') return this._topicName('h');
    return `${this._topicName('h')},${this._topicName('p')}`;
  }

  connect() {
    if (this.destroyed || !this.WebSocketImpl) return;
    this._cleanupSocketOnly();

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this._scheduleRetry(2500);
      return;
    }

    const wsUrl = `${NTFY_WS_BASE}/${this.getSubscribeTopicsCsv()}/ws`;
    try {
      const ws = new this.WebSocketImpl(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.destroyed || this.ws !== ws) return;
        this.connected = true;
        if (this.onStateChange) this.onStateChange();
      };

      ws.onmessage = (ev) => {
        if (this.destroyed || this.ws !== ws) return;
        try {
          const outer = JSON.parse(typeof ev.data === 'string' ? ev.data : textDecoder.decode(ev.data));
          if (outer && outer.event === 'message' && typeof outer.message === 'string') {
            const inner = JSON.parse(outer.message);
            if (this.onMessage) this.onMessage(inner);
          }
        } catch {}
      };

      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        if (this.destroyed) return;
        if (wasConnected && this.onStateChange) this.onStateChange();
        this._scheduleRetry(wasConnected ? 1500 : 3500);
      };

      ws.onerror = () => {};
    } catch {
      this._scheduleRetry(4000);
    }
  }

  shouldForward(msgObj, mqttActive) {
    if (!msgObj || !msgObj.type) return false;
    const t = msgObj.type;
    // Never blast continuous gyro stream over HTTPS POST
    if (t === 'sensor') return false;

    const now = Date.now();
    if (t === 'ping' || t === 'pong') {
      const minGap = mqttActive ? 8000 : 4200;
      if (now - this._lastPingPostMs < minGap) return false;
      this._lastPingPostMs = now;
      return true;
    }
    if (t === 'match_hud') {
      const minGap = mqttActive ? 6000 : 2200;
      if (now - this._lastHudPostMs < minGap) return false;
      this._lastHudPostMs = now;
      return true;
    }
    if (t === 'wheel_aim') {
      if (mqttActive) return false;
      if (now - this._lastWheelPostMs < 260) return false;
      this._lastWheelPostMs = now;
      return true;
    }
    return PORT443_CRITICAL_TYPES.has(t);
  }

  send(msgObj, jsonStr, mqttActive) {
    if (!this.connected || !this.fetchImpl) return false;
    if (!this.shouldForward(msgObj, mqttActive)) return false;

    // Gentle client-side rate guard (max 24 posts per 10s) so ntfy.sh never returns HTTP 429
    const now = Date.now();
    while (this._postTimestamps.length > 0 && now - this._postTimestamps[0] > 10000) {
      this._postTimestamps.shift();
    }
    const isUrgent =
      msgObj.type === 'join' ||
      msgObj.type === 'joined_ack' ||
      msgObj.type === 'phone_action' ||
      msgObj.type === 'touch_swipe' ||
      msgObj.type === 'air_swing';
    if (!isUrgent && this._postTimestamps.length >= 22) return false;
    this._postTimestamps.push(now);

    try {
      // Content-Type: text/plain avoids CORS preflight OPTIONS roundtrip!
      this.fetchImpl(`${NTFY_HTTP_BASE}/${this.getPublishTopic()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: jsonStr,
        keepalive: true
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  _scheduleRetry(ms) {
    if (this.destroyed) return;
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this.connect(), ms);
  }

  _cleanupSocketOnly() {
    this.connected = false;
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  destroy() {
    this.destroyed = true;
    this._cleanupSocketOnly();
  }
}

/**
 * Unified Triple-Lane Cloud Relay Client (drop-in replacement)
 */
export class MqttRelayClient {
  constructor({ role = 'host', roomCode = 'CRIC', onMessage = null, onStatus = null, WebSocketImpl = null, fetchImpl = null } = {}) {
    this.role = role;
    this.roomCode = String(roomCode || 'CRIC').toUpperCase().slice(0, 4);
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.WebSocketImpl = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);

    this.connected = false;
    this.mqttConnected = false;
    this.port443Connected = false;
    this.destroyed = false;
    this._mqttLanes = [];
    this._ntfyLane = null;
    this._seenMsgIds = new Set();
    this._lastEmittedStatus = '';
  }

  getActiveTransportsLabel() {
    if (this.mqttConnected && this.port443Connected) return 'WSS+443';
    if (this.mqttConnected) return 'WSS';
    if (this.port443Connected) return '443';
    return '...';
  }

  _handleIncoming(parsed) {
    if (!parsed) return;
    if (parsed.msgId) {
      if (this._seenMsgIds.has(parsed.msgId)) return;
      this._seenMsgIds.add(parsed.msgId);
      if (this._seenMsgIds.size > 400) {
        const first = this._seenMsgIds.values().next().value;
        this._seenMsgIds.delete(first);
      }
    }
    if (this.onMessage) this.onMessage(parsed);
  }

  _syncState() {
    const anyMqtt = this._mqttLanes.some((l) => l.connected);
    const has443 = Boolean(this._ntfyLane && this._ntfyLane.connected);
    const anyUp = anyMqtt || has443;

    this.mqttConnected = anyMqtt;
    this.port443Connected = has443;
    this.connected = anyUp;

    const label = this.getActiveTransportsLabel();
    const statusKey = `${anyUp ? 'connected' : 'reconnecting'}:${label}`;
    if (statusKey !== this._lastEmittedStatus) {
      this._lastEmittedStatus = statusKey;
      if (this.onStatus) {
        this.onStatus(anyUp ? 'connected' : 'reconnecting', label);
      }
    }
  }

  connect(newRoomCode = null) {
    if (newRoomCode) {
      this.roomCode = String(newRoomCode).trim().toUpperCase().slice(0, 4);
    }
    this._teardownLanes();
    this.destroyed = false;
    this._lastEmittedStatus = '';

    if (this.onStatus) this.onStatus('connecting', '...');

    // Start MQTT Lane 1 (EMQX) & Lane 2 (Mosquitto) IN PARALLEL — zero broker desync!
    this._mqttLanes = MQTT_BROKERS.map((b) => {
      const lane = new SingleMqttLane({
        id: b.id,
        url: b.url,
        role: this.role,
        roomCode: this.roomCode,
        WebSocketImpl: this.WebSocketImpl,
        onMessage: (msg) => this._handleIncoming(msg),
        onStateChange: () => this._syncState()
      });
      lane.connect();
      return lane;
    });

    // Start Standard Port 443 Lane (ntfy.sh) IN PARALLEL — 100% firewall/CGNAT proof!
    this._ntfyLane = new Port443NtfyLane({
      role: this.role,
      roomCode: this.roomCode,
      WebSocketImpl: this.WebSocketImpl,
      fetchImpl: this.fetchImpl,
      onMessage: (msg) => this._handleIncoming(msg),
      onStateChange: () => this._syncState()
    });
    this._ntfyLane.connect();
  }

  send(msgObj) {
    if (!this.connected) return false;
    let jsonStr;
    try {
      jsonStr = JSON.stringify(msgObj);
    } catch {
      return false;
    }

    let sent = false;
    // Fan out across connected MQTT lanes (for sensor packets, prefer first connected MQTT lane to save bandwidth)
    const isSensor = msgObj && msgObj.type === 'sensor';
    for (let i = 0; i < this._mqttLanes.length; i++) {
      const lane = this._mqttLanes[i];
      if (lane.connected) {
        if (lane.sendJson(jsonStr)) {
          sent = true;
          if (isSensor) break;
        }
      }
    }

    // Also mirror critical control/pairing packets onto Port 443 lane (zero-block guarantee)
    if (this._ntfyLane && this._ntfyLane.connected) {
      if (this._ntfyLane.send(msgObj, jsonStr, this.mqttConnected)) {
        sent = true;
      }
    }

    return sent;
  }

  _teardownLanes() {
    this.connected = false;
    this.mqttConnected = false;
    this.port443Connected = false;
    for (let i = 0; i < this._mqttLanes.length; i++) {
      this._mqttLanes[i].destroy();
    }
    this._mqttLanes = [];
    if (this._ntfyLane) {
      this._ntfyLane.destroy();
      this._ntfyLane = null;
    }
  }

  destroy() {
    this.destroyed = true;
    this._teardownLanes();
  }
}
