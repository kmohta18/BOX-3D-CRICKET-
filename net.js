/**
 * WebSocket Relay & Phone Pairing Network Manager (net.js)
 * Connects Host Screen (index.html) and Phone Controllers (controller.html)
 * at 60-100 Hz over WebSocket with BroadcastChannel local fallback,
 * 4-letter room codes, RTT latency ping, pre-selected Shot Mode (GROUND/FLY) sync,
 * haptic vibration, and 30s reconnect pause.
 */

export class NetworkManager {
  constructor(role = 'host') {
    this.role = role; // 'host' | 'controller' | 'online_peer'
    this.roomCode = this.generateRoomCode();
    this.ws = null;
    this.bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('box_cricket_3d_bus') : null;
    this.connected = false;
    this.controllers = {
      p1: { connected: false, lastSeen: 0, latencyMs: 12, role: 'bat' },
      p2: { connected: false, lastSeen: 0, latencyMs: 14, role: 'bowl' }
    };
    this.onlinePeerConnected = false;

    // 30-second disconnect grace timer
    this.disconnectPaused = false;
    this.disconnectDeadline = 0;

    // URL modes for QR code generation: 'origin' (default first) | 'shared' | 'lan'
    this.urlMode = 'origin';
    this.originBaseUrl = window.location.origin;
    this.sharedBaseUrl = window.location.origin.replace('//ais-dev-', '//ais-pre-');
    this.lanBaseUrl = window.location.origin;
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
      onPauseChange: null,
      onOnlineState: null
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
          // Keep exact current browser origin (e.g. https://boxcricket.ai.studio) as Origin URL!
          this.originBaseUrl = window.location.origin;
          this.sharedBaseUrl = window.location.origin.replace('//ais-dev-', '//ais-pre-');
        }
      }
    } catch {
      this.originBaseUrl = window.location.origin;
      this.sharedBaseUrl = window.location.origin.replace('//ais-dev-', '//ais-pre-');
    }
    return this.getControllerUrl();
  }

  getActiveBaseUrl() {
    if (this.customBaseUrl && this.customBaseUrl.trim().startsWith('http')) {
      return this.customBaseUrl.trim().replace(/\/$/, '');
    }
    if (this.urlMode === 'origin') {
      return (this.originBaseUrl || window.location.origin).replace(/\/$/, '');
    }
    if (this.urlMode === 'lan') {
      return (this.lanBaseUrl || this.originBaseUrl || window.location.origin).replace(/\/$/, '');
    }
    return (this.sharedBaseUrl || this.originBaseUrl || window.location.origin).replace(/\/$/, '');
  }

  getControllerUrl(slot = 'p1') {
    const base = this.getActiveBaseUrl();
    return slot === 'p1'
      ? `${base}/c?r=${this.roomCode}`
      : `${base}/c?r=${this.roomCode}&slot=${slot}`;
  }

  connect(customRoomCode = null, slot = 'p1') {
    if (customRoomCode) {
      this.roomCode = customRoomCode.trim().toUpperCase().slice(0, 4);
    }
    this.slot = slot;

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
        this.connected = false;
        setTimeout(() => this.connect(this.roomCode, this.slot), 2000);
      };

      this.ws.onerror = () => {};
    } catch {}
  }

  send(payload) {
    const msg = { ...payload, room: this.roomCode };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
    if (this.bc) {
      this.bc.postMessage(msg);
    }
  }

  vibratePhone(slot = 'p1', pattern = [65]) {
    this.send({
      type: 'vibrate',
      slot,
      pattern
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

  handleMessage(msg) {
    if (!msg || (msg.room && msg.room !== this.roomCode)) return;

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

    if (msg.type === 'controller_disconnect') {
      this.triggerDisconnectPause(slot);
      return;
    }

    if (msg.type === 'online_state' && this.callbacks.onOnlineState) {
      this.onlinePeerConnected = true;
      this.callbacks.onOnlineState(msg.state);
    }
  }

  triggerDisconnectPause(slot = 'p1') {
    const ctrl = this.controllers[slot];
    if (ctrl && ctrl.connected) {
      ctrl.connected = false;
      this.disconnectPaused = true;
      this.disconnectDeadline = performance.now() + 30000;
      if (this.callbacks.onControllerStatus) this.callbacks.onControllerStatus(this.controllers);
      if (this.callbacks.onPauseChange) this.callbacks.onPauseChange(true, 30);
    }
  }

  updateHeartbeat() {
    const now = performance.now();
    ['p1', 'p2'].forEach((slot) => {
      const ctrl = this.controllers[slot];
      if (ctrl.connected && now - ctrl.lastSeen > 4500) {
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
