/**
 * WebSocket Relay & Phone Pairing Network Manager (net.js)
 * Connects Host Screen (index.html) and Phone Controllers (controller.html)
 * at 60-100 Hz over WebSocket with BroadcastChannel local fallback,
 * 4-letter room codes, RTT latency ping, pre-selected Shot Mode (GROUND/FLY) sync,
 * haptic vibration, and 30s reconnect pause.
 */

import { MqttRelayClient } from './src/mqtt_relay.js';

const PUBLIC_GITHUB_PAGES_BASE = 'https://kmohta18.github.io/BOX-3D-CRICKET-';
const PEERJS_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

function getStaticAppBaseUrl() {
  if (typeof window === 'undefined') return PUBLIC_GITHUB_PAGES_BASE;
  const host = window.location.hostname || '';
  if (host === 'appassets.androidplatform.net') {
    return PUBLIC_GITHUB_PAGES_BASE;
  }
  const path = (window.location.pathname || '/').replace(/\/(?:index\.html|controller\.html)?$/, '');
  return `${window.location.origin}${path}`.replace(/\/$/, '');
}

function isStaticOrApkOrigin() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname || '';
  return (
    Boolean(window.Wavedash) ||
    host === 'appassets.androidplatform.net' ||
    host.endsWith('.github.io') ||
    host.endsWith('.vercel.app') ||
    host.endsWith('.netlify.app') ||
    host.endsWith('.pages.dev')
  );
}

let peerJsLoadPromise = null;
function ensurePeerJsLoaded() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerJsLoadPromise) return peerJsLoadPromise;

  const sources = [
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
  ];

  peerJsLoadPromise = new Promise((resolve) => {
    let idx = 0;
    const tryNext = () => {
      if (window.Peer) return resolve(window.Peer);
      if (idx >= sources.length) return resolve(null);
      const s = document.createElement('script');
      s.src = sources[idx++];
      s.async = true;
      s.onload = () => resolve(window.Peer || null);
      s.onerror = () => tryNext();
      document.head.appendChild(s);
    };
    // Give deferred script tag in <head> a brief moment before injecting fallback
    setTimeout(() => {
      if (window.Peer) resolve(window.Peer);
      else tryNext();
    }, 150);
  });
  return peerJsLoadPromise;
}

export class NetworkManager {
  constructor(role = 'host') {
    this.role = role; // 'host' | 'controller' | 'online_peer'
    this.roomCode = this.generateRoomCode();
    this.ws = null;
    this.mqttRelay = null;
    this.mqttConnected = false;
    this.peer = null;
    this.peerConns = new Set();
    this.p2pReady = false;
    this._p2pRetryTimer = null;
    this.bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('box_cricket_3d_bus') : null;
    this.connected = false;
    this.controllers = {
      p1: { connected: false, lastSeen: 0, latencyMs: 12, role: 'bat' },
      p2: { connected: false, lastSeen: 0, latencyMs: 14, role: 'bowl' }
    };
    this.onlinePeerConnected = false;
    this._clientSessionId = Math.random().toString(36).slice(2, 7);
    this._msgSeq = 0;
    this._seenMsgIds = new Set();

    // 30-second disconnect grace timer
    this.disconnectPaused = false;
    this.disconnectDeadline = 0;

    // URL modes for QR code generation: 'origin' (default first) | 'shared' | 'lan'
    this.urlMode = 'origin';
    const initialBase = getStaticAppBaseUrl();
    this.originBaseUrl = initialBase;
    this.sharedBaseUrl = isStaticOrApkOrigin()
      ? initialBase
      : window.location.origin.replace('//ais-dev-', '//ais-pre-');
    this.lanBaseUrl = initialBase;
    this.customBaseUrl = '';

    this.callbacks = {
      onSensorData: null,
      onControllerStatus: null,
      onCalibrateStart: null,
      onShotModeChange: null,
      onRunupHold: null,
      onRunHold: null,
      onTurnBack: null,
      onBowlerTypeChange: null,
      onQuickFlick: null,
      onTouchSwipe: null,
      onCreaseStep: null,
      onWheelAim: null,
      onPhoneAction: null,
      onPauseChange: null,
      onOnlineState: null,
      onOnlinePeerJoin: null,
      onOnlinePeerDisconnect: null,
      onOnlineBowlAim: null,
      onOnlineBowlRelease: null,
      onOnlineBatShot: null,
      onOnlineRunAction: null,
      onOnlineDeliveryComplete: null
    };

    if (this.bc) {
      this.bc.onmessage = (ev) => this.handleMessage(ev.data);
    }
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  async fetchServerInfo() {
    // On static hosts (GitHub Pages / Vercel) or bundled Android TV APK, skip /api/info and use the HTTPS GitHub Pages URL!
    if (isStaticOrApkOrigin()) {
      const staticBase = getStaticAppBaseUrl();
      this.originBaseUrl = staticBase;
      this.sharedBaseUrl = staticBase;
      this.lanBaseUrl = staticBase;
      this.urlMode = 'origin';
      return this.getControllerUrl();
    }

    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        const info = await res.json();
        if (info.lanUrl) this.lanBaseUrl = info.lanUrl;
        const isLocal =
          window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocal) {
          if (info.devUrl) this.originBaseUrl = info.devUrl;
          if (info.url && !info.url.includes('MY_APP_URL')) {
            this.sharedBaseUrl = info.url;
          }
          this.urlMode = 'lan';
        } else {
          this.originBaseUrl = window.location.origin;
          this.sharedBaseUrl = window.location.origin.replace('//ais-dev-', '//ais-pre-');
        }
      }
    } catch {
      this.originBaseUrl = getStaticAppBaseUrl();
      this.sharedBaseUrl = this.originBaseUrl;
    }
    return this.getControllerUrl();
  }

  getActiveBaseUrl() {
    if (this.customBaseUrl && this.customBaseUrl.trim().startsWith('http')) {
      return this.customBaseUrl.trim().replace(/\/$/, '');
    }
    if (this.urlMode === 'origin') {
      return (this.originBaseUrl || getStaticAppBaseUrl()).replace(/\/$/, '');
    }
    if (this.urlMode === 'lan') {
      return (this.lanBaseUrl || this.originBaseUrl || getStaticAppBaseUrl()).replace(/\/$/, '');
    }
    return (this.sharedBaseUrl || this.originBaseUrl || getStaticAppBaseUrl()).replace(/\/$/, '');
  }

  getControllerUrl(slot = 'p1') {
    const base = this.getActiveBaseUrl();
    // Static hosts (GitHub Pages / Vercel) and Android TV APK use controller.html?r=XXXX&p2p=1 (WebRTC PeerJS!)
    const useStaticP2P =
      isStaticOrApkOrigin() ||
      base.includes('.github.io') ||
      base.includes('.vercel.app') ||
      base.includes('.netlify.app');
    if (useStaticP2P) {
      return slot === 'p1'
        ? `${base}/controller.html?r=${this.roomCode}&p2p=1`
        : `${base}/controller.html?r=${this.roomCode}&slot=${slot}&p2p=1`;
    }
    return slot === 'p1'
      ? `${base}/c?r=${this.roomCode}`
      : `${base}/c?r=${this.roomCode}&slot=${slot}`;
  }

  connect(customRoomCode = null, slot = 'p1') {
    if (customRoomCode) {
      this.roomCode = customRoomCode.trim().toUpperCase().slice(0, 4);
    }
    this.slot = slot;

    // 1. Primary Universal Cloud Relay (MQTT-over-WSS): works 100% through Android TV WebView, GitHub Pages, Wi-Fi & 4G/5G CGNAT!
    this.connectMqttRelay(this.roomCode, slot);

    // 2. Optional PeerJS WebRTC P2P lane for direct same-LAN acceleration
    this.connectPeerJS(this.roomCode, slot);

    // Static hosts & bundled offline Android TV APK do not run a local /ws Express relay.
    if (isStaticOrApkOrigin()) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws?room=${this.roomCode}&role=${this.role}&slot=${slot}`;

    try {
      if (this.ws) {
        this.ws.onclose = null;
        this.ws.close();
      }
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        this.send({
          type: 'join',
          room: this.roomCode,
          role: this.role,
          slot: this.slot,
          ts: Date.now()
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch {
          // Ignore malformed packet
        }
      };

      this.ws.onclose = () => {
        this.connected = this.mqttConnected || this.p2pReady;
        setTimeout(() => this.connect(this.roomCode, this.slot), 1200);
      };

      this.ws.onerror = () => {};
    } catch {}
  }

  connectMqttRelay(roomCode = this.roomCode, slot = 'p1') {
    if (this.mqttRelay && this.mqttRelay.roomCode === roomCode && this.mqttRelay.role === this.role && !this.mqttRelay.destroyed) {
      if (!this.mqttRelay.connected && !this.mqttRelay.ws) {
        this.mqttRelay.connect(roomCode);
      }
      return;
    }
    if (this.mqttRelay) {
      this.mqttRelay.destroy();
      this.mqttRelay = null;
    }
    this.mqttRelay = new MqttRelayClient({
      role: this.role,
      roomCode,
      onStatus: (status) => {
        this.mqttConnected = status === 'connected';
        if (this.mqttConnected) {
          this.connected = true;
          if (this.role !== 'host') {
            this.send({
              type: 'join',
              room: this.roomCode,
              role: this.role,
              slot: slot || this.slot || 'p1',
              ts: Date.now()
            });
          }
        }
      },
      onMessage: (msg) => {
        this.handleMessage(msg);
      }
    });
    this.mqttRelay.connect(roomCode);
  }

  async connectPeerJS(roomCode = this.roomCode, slot = 'p1') {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }
    if (this._p2pRetryTimer) {
      clearTimeout(this._p2pRetryTimer);
      this._p2pRetryTimer = null;
    }

    const PeerCtor = await ensurePeerJsLoaded();
    if (!PeerCtor) return;

    const targetHostId = `boxcricket3d-host-${roomCode}`;
    const desiredPeerId = this.role === 'host' ? targetHostId : undefined;

    // Reuse existing open peer if already registered on the exact same host room ID
    if (this.peer && !this.peer.destroyed && this.role === 'host' && this.peer.id === targetHostId) {
      return;
    }

    this.destroyPeerJS();

    try {
      const peer = new PeerCtor(desiredPeerId, {
        debug: 0,
        config: { iceServers: PEERJS_ICE_SERVERS }
      });
      this.peer = peer;

      const attachConn = (conn) => {
        if (!conn) return;
        const onReady = () => {
          this.peerConns.add(conn);
          this.connected = true;
          if (this.role !== 'host') {
            this.send({
              type: 'join',
              room: this.roomCode,
              role: this.role,
              slot: slot || this.slot || 'p1',
              ts: Date.now()
            });
          }
        };
        if (conn.open) onReady();
        else conn.on('open', onReady);

        conn.on('data', (data) => {
          try {
            const msg = typeof data === 'string' ? JSON.parse(data) : data;
            this.handleMessage(msg);
          } catch {}
        });

        const cleanup = () => {
          this.peerConns.delete(conn);
        };
        conn.on('close', cleanup);
        conn.on('error', cleanup);
      };

      peer.on('open', () => {
        this.p2pReady = true;
        this.connected = true;
        if (this.role !== 'host') {
          const outConn = peer.connect(targetHostId, { reliable: true, serialization: 'json' });
          attachConn(outConn);
        }
      });

      peer.on('connection', (incomingConn) => {
        attachConn(incomingConn);
      });

      peer.on('disconnected', () => {
        this.p2pReady = false;
        if (!peer.destroyed) {
          this._p2pRetryTimer = setTimeout(() => {
            try {
              peer.reconnect();
            } catch {}
          }, 2500);
        }
      });

      peer.on('error', (err) => {
        const errType = err?.type || '';
        // Never mutate this.roomCode on PeerJS errors so the displayed TV QR code stays 100% locked to the MQTT relay!
        if (errType === 'peer-unavailable' && this.role !== 'host') {
          this._p2pRetryTimer = setTimeout(() => this.connectPeerJS(this.roomCode, slot), 3500);
          return;
        }
        this.p2pReady = false;
      });
    } catch {
      this.p2pReady = false;
    }
  }

  destroyPeerJS() {
    this.p2pReady = false;
    this.peerConns.forEach((conn) => {
      try {
        conn.close();
      } catch {}
    });
    this.peerConns.clear();
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {}
      this.peer = null;
    }
  }

  send(payload) {
    const msgId = payload?.msgId || `${this.role}_${this.slot || 'p1'}_${this._clientSessionId}_${++this._msgSeq}`;
    const msg = { ...payload, room: this.roomCode, msgId };
    if (this.bc) {
      this.bc.postMessage(msg);
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
    if (this.mqttRelay && this.mqttRelay.connected) {
      this.mqttRelay.send(msg);
    }
    if (this.peerConns.size > 0) {
      this.peerConns.forEach((conn) => {
        if (conn && conn.open) {
          try {
            conn.send(msg);
          } catch {}
        }
      });
    }
  }

  vibratePhone(slot = 'p1', pattern = [65], label = null) {
    this.send({
      type: 'vibrate',
      slot,
      pattern,
      label
    });
  }

  /**
   * Broadcasts Shot Mode ('ground' | 'fly') and Lock state to connected phone controller(s)
   */
  syncShotModeLock(mode = 'ground', locked = false) {
    this.send({
      type: 'shot_mode_lock',
      mode,
      locked
    });
  }

  syncRoleToControllers(p1Role = 'bat', p2Role = 'bowl') {
    this.send({
      type: 'role_sync',
      p1Role,
      p2Role
    });
  }

  syncMatchStateToControllers(hudState = {}) {
    this.send({
      type: 'match_hud',
      ...hudState
    });
  }

  sendOnlineBowlAim(payload = {}) {
    this.send({
      type: 'online_bowl_aim',
      ...payload
    });
  }

  sendOnlineBowlRelease(delivery = {}) {
    this.send({
      type: 'online_bowl_release',
      delivery
    });
  }

  sendOnlineBatShot(shotPayload = {}) {
    this.send({
      type: 'online_bat_shot',
      ...shotPayload
    });
  }

  sendOnlineRunAction(actionPayload = {}) {
    this.send({
      type: 'online_run_action',
      ...actionPayload
    });
  }

  sendOnlineState(state = {}) {
    this.send({
      type: 'online_state',
      state
    });
  }

  handleMessage(msg) {
    if (!msg || (msg.room && msg.room !== this.roomCode)) return;
    if (msg.msgId) {
      if (this._seenMsgIds.has(msg.msgId)) return;
      this._seenMsgIds.add(msg.msgId);
      if (this._seenMsgIds.size > 400) {
        const first = this._seenMsgIds.values().next().value;
        this._seenMsgIds.delete(first);
      }
    }

    const slot = msg.slot || 'p1';
    const ctrl = this.controllers[slot] || this.controllers.p1;

    if (msg.type === 'join' && msg.role === 'controller') {
      ctrl.connected = true;
      ctrl.lastSeen = performance.now();
      if (this.disconnectPaused) {
        this.disconnectPaused = false;
        if (this.callbacks.onPauseChange) this.callbacks.onPauseChange(false, 0);
      }
      if (this.callbacks.onControllerStatus) {
        this.callbacks.onControllerStatus(this.controllers);
      }
      this.send({ type: 'joined_ack', slot, p1Role: this.controllers.p1.role, p2Role: this.controllers.p2.role });
      return;
    }

    if (msg.slot === 'p1' || msg.slot === 'p2') {
      ctrl.lastSeen = performance.now();
      // Auto-mark controller connected if any valid controller packet arrives (recovers cleanly if join fired before TV subscribed!)
      if (
        this.role === 'host' &&
        !ctrl.connected &&
        msg.type !== 'controller_disconnect' &&
        msg.type !== 'joined_ack' &&
        msg.type !== 'pong' &&
        msg.type !== 'match_hud'
      ) {
        ctrl.connected = true;
        if (this.disconnectPaused) {
          this.disconnectPaused = false;
          if (this.callbacks.onPauseChange) this.callbacks.onPauseChange(false, 0);
        }
        if (this.callbacks.onControllerStatus) {
          this.callbacks.onControllerStatus(this.controllers);
        }
        this.send({ type: 'joined_ack', slot, p1Role: this.controllers.p1.role, p2Role: this.controllers.p2.role });
      }
    }

    if (msg.type === 'ping') {
      this.send({ type: 'pong', slot, clientTs: msg.clientTs });
      return;
    }

    if (msg.type === 'pong' && msg.clientTs) {
      ctrl.latencyMs = Math.max(2, Math.round((Date.now() - msg.clientTs) * 0.5));
      return;
    }

    if (msg.type === 'sensor') {
      if (!ctrl.connected) {
        ctrl.connected = true;
        if (this.callbacks.onControllerStatus) this.callbacks.onControllerStatus(this.controllers);
      }
      ctrl.lastSeen = performance.now();
      if (msg.rtt) ctrl.latencyMs = msg.rtt;
      if (this.disconnectPaused) {
        this.disconnectPaused = false;
        if (this.callbacks.onPauseChange) this.callbacks.onPauseChange(false, 0);
      }
      if (this.callbacks.onSensorData) {
        this.callbacks.onSensorData(msg, slot);
      }
      return;
    }

    if (msg.type === 'shot_mode' && this.callbacks.onShotModeChange) {
      this.callbacks.onShotModeChange(msg.mode, slot);
      return;
    }

    if (msg.type === 'calibrate' && this.callbacks.onCalibrateStart) {
      this.callbacks.onCalibrateStart(slot);
      return;
    }

    if (msg.type === 'calibrate_zero' && this.callbacks.onCalibrateZero) {
      this.callbacks.onCalibrateZero(slot);
      return;
    }

    if (msg.type === 'runup_hold' && this.callbacks.onRunupHold) {
      this.callbacks.onRunupHold(Boolean(msg.held), slot);
      return;
    }

    if (msg.type === 'run_hold' && this.callbacks.onRunHold) {
      this.callbacks.onRunHold(Boolean(msg.held), slot);
      return;
    }

    if (msg.type === 'turn_back' && this.callbacks.onTurnBack) {
      this.callbacks.onTurnBack(slot);
      return;
    }

    if (msg.type === 'bowler_type' && this.callbacks.onBowlerTypeChange) {
      this.callbacks.onBowlerTypeChange(msg.bowlerType, slot);
      return;
    }

    if (msg.type === 'quick_flick' && this.callbacks.onQuickFlick) {
      this.callbacks.onQuickFlick(slot);
      return;
    }

    if (msg.type === 'touch_swipe' && this.callbacks.onTouchSwipe) {
      this.callbacks.onTouchSwipe(msg, slot);
      return;
    }

    if (msg.type === 'crease_step' && this.callbacks.onCreaseStep) {
      this.callbacks.onCreaseStep(msg, slot);
      return;
    }

    if (msg.type === 'wheel_aim' && this.callbacks.onWheelAim) {
      this.callbacks.onWheelAim(msg, slot);
      return;
    }

    if (msg.type === 'phone_action' && this.callbacks.onPhoneAction) {
      this.callbacks.onPhoneAction(msg, slot);
      return;
    }

    if (msg.type === 'start_or_rematch' && this.callbacks.onStartOrRematch) {
      this.callbacks.onStartOrRematch(msg, slot);
      return;
    }

    if (msg.type === 'controller_disconnect') {
      this.triggerDisconnectPause(slot);
      return;
    }

    if (msg.type === 'join' && (msg.role === 'online_peer' || msg.role === 'host')) {
      this.onlinePeerConnected = true;
      this.send({
        type: 'online_peer_ack',
        room: this.roomCode,
        senderRole: this.role,
        ts: Date.now()
      });
      if (this.callbacks.onOnlinePeerJoin) {
        this.callbacks.onOnlinePeerJoin(msg);
      }
      return;
    }

    if (msg.type === 'online_peer_ack') {
      this.onlinePeerConnected = true;
      if (this.callbacks.onOnlinePeerJoin) {
        this.callbacks.onOnlinePeerJoin(msg);
      }
      return;
    }

    if (msg.type === 'online_peer_disconnect') {
      this.onlinePeerConnected = false;
      if (this.callbacks.onOnlinePeerDisconnect) {
        this.callbacks.onOnlinePeerDisconnect(msg);
      }
      return;
    }

    if (msg.type === 'online_bowl_aim' && this.callbacks.onOnlineBowlAim) {
      this.onlinePeerConnected = true;
      this.callbacks.onOnlineBowlAim(msg);
      return;
    }

    if (msg.type === 'online_bowl_release' && this.callbacks.onOnlineBowlRelease) {
      this.onlinePeerConnected = true;
      this.callbacks.onOnlineBowlRelease(msg);
      return;
    }

    if (msg.type === 'online_bat_shot' && this.callbacks.onOnlineBatShot) {
      this.onlinePeerConnected = true;
      this.callbacks.onOnlineBatShot(msg);
      return;
    }

    if (msg.type === 'online_run_action' && this.callbacks.onOnlineRunAction) {
      this.onlinePeerConnected = true;
      this.callbacks.onOnlineRunAction(msg);
      return;
    }

    if (msg.type === 'online_delivery_complete' && this.callbacks.onOnlineDeliveryComplete) {
      this.onlinePeerConnected = true;
      this.callbacks.onOnlineDeliveryComplete(msg);
      return;
    }

    if (msg.type === 'online_state' && this.callbacks.onOnlineState) {
      this.onlinePeerConnected = true;
      this.callbacks.onOnlineState(msg.state);
    }
  }

  getOnlineInviteUrl() {
    const base = this.getActiveBaseUrl();
    return `${base}/?room=${this.roomCode}&online=1`;
  }

  triggerDisconnectPause(slot = 'p1') {
    const ctrl = this.controllers[slot];
    if (ctrl && ctrl.connected) {
      ctrl.connected = false;
      this.disconnectPaused = false;
      if (this.callbacks.onControllerStatus) this.callbacks.onControllerStatus(this.controllers);
      if (this.callbacks.onPauseChange) this.callbacks.onPauseChange(false, 0);
    }
  }

  updateHeartbeat() {
    const now = performance.now();
    ['p1', 'p2'].forEach((slot) => {
      const ctrl = this.controllers[slot];
      if (ctrl.connected && now - ctrl.lastSeen > 8500) {
        this.triggerDisconnectPause(slot);
      }
    });

    if (this.disconnectPaused) {
      const remainingSec = Math.ceil((this.disconnectDeadline - now) / 1000);
      if (remainingSec <= 0) {
        this.disconnectPaused = false;
        if (this.callbacks.onPauseChange) this.callbacks.onPauseChange(false, 0);
      } else if (this.callbacks.onPauseChange) {
        this.callbacks.onPauseChange(true, remainingSec);
      }
    }
  }
}
