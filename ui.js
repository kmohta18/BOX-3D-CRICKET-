import { generateQRCodeSVG } from './assets/qr.js';
import { FICTIONAL_TEAMS } from './modes.js';

/**
 * Broadcast HUD, On-Screen Debug Telemetry Panel, Pre-Selected Shot Mode UI & Scorecard (ui.js)
 */

export const I18N = {
  en: {
    overs: 'OVERS',
    crr: 'CRR',
    rrr: 'REQ',
    target: 'TARGET',
    freeHit: 'FREE HIT',
    powerplay: 'POWERPLAY',
    speed: 'SPEED',
    timing: 'TIMING',
    batSpeed: 'SWING',
    pairPhone: 'Pair Phone (QR)',
    calibrate: 'Calibrate (3s)',
    matchSetup: 'Match Setup',
    scorecard: 'Scorecard & Wheel',
    settings: 'Settings',
    hideDock: '▾ Hide Controls (H)',
    showDock: '▴ Show Controls (H)'
  },
  hi: {
    overs: 'ओवर',
    crr: 'रन रेट',
    rrr: 'जरूरी रेट',
    target: 'लक्ष्य',
    freeHit: 'फ्री हिट',
    powerplay: 'पावरप्ले',
    speed: 'रफ़्तार',
    timing: 'टाइमिंग',
    batSpeed: 'बल्ला गति',
    pairPhone: 'फ़ोन जोड़ें (QR)',
    calibrate: 'कैलिब्रेट (3s)',
    matchSetup: 'मैच मोड',
    scorecard: 'स्कोरकार्ड और व्हील',
    settings: 'सेटिंग्स',
    hideDock: '▾ कंट्रोल छुपाएं (H)',
    showDock: '▴ कंट्रोल दिखाएं (H)'
  }
};

export class UIManager {
  constructor(app) {
    this.app = app;
    this.lang = 'en';
    this.dockCollapsed = false;
    this.bannerTimeout = null;
  }

  t(key) {
    return (I18N[this.lang] && I18N[this.lang][key]) || I18N.en[key] || key;
  }

  init() {
    this.populateTeamSelects();
    this.bindEvents();
    this.updateLanguageLabels();
    this.updateShotModeHUD();
    this.updateHUD();
  }

  populateTeamSelects() {
    const selA = document.getElementById('setup-team-a');
    const selB = document.getElementById('setup-team-b');
    if (!selA || !selB) return;

    selA.innerHTML = '';
    selB.innerHTML = '';
    FICTIONAL_TEAMS.forEach((team, idx) => {
      const optA = document.createElement('option');
      optA.value = String(idx);
      optA.textContent = `${team.nameEn} (${team.short})`;
      if (idx === 0) optA.selected = true;
      selA.appendChild(optA);

      const optB = document.createElement('option');
      optB.value = String(idx);
      optB.textContent = `${team.nameEn} (${team.short})`;
      if (idx === 1) optB.selected = true;
      selB.appendChild(optB);
    });
  }

  bindEvents() {
    document.getElementById('btn-toggle-dock')?.addEventListener('click', () => this.toggleDock());

    // Pre-selected Shot Mode buttons in HUD (GROUND / FLY)
    document.getElementById('btn-hud-ground')?.addEventListener('click', () => {
      this.app.selectShotMode('ground');
    });
    document.getElementById('btn-hud-fly')?.addEventListener('click', () => {
      this.app.selectShotMode('fly');
    });

    // Primary gameplay buttons in bottom dock
    document.getElementById('btn-action-bowl')?.addEventListener('click', () => {
      this.app.triggerActionFromUI('bowl_or_swing');
    });
    document.getElementById('btn-action-defend')?.addEventListener('click', () => {
      this.app.triggerActionFromUI('defend_shot');
    });
    document.getElementById('btn-action-run')?.addEventListener('click', () => {
      this.app.triggerActionFromUI('take_extra_run');
    });

    // Camera cycling
    document.querySelectorAll('[data-cam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const camMode = btn.getAttribute('data-cam');
        this.app.setCameraMode(camMode);
        document.querySelectorAll('[data-cam]').forEach((b) => {
          b.classList.toggle('bg-amber-500', b === btn);
          b.classList.toggle('text-slate-950', b === btn);
          b.classList.toggle('bg-slate-800', b !== btn);
          b.classList.toggle('text-slate-200', b !== btn);
        });
      });
    });

    // Stadium switcher
    document.querySelectorAll('[data-stadium]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const st = btn.getAttribute('data-stadium');
        this.app.setStadium(st);
        document.querySelectorAll('[data-stadium]').forEach((b) => {
          b.classList.toggle('bg-emerald-500', b === btn);
          b.classList.toggle('text-slate-950', b === btn);
          b.classList.toggle('bg-slate-800', b !== btn);
          b.classList.toggle('text-slate-200', b !== btn);
        });
      });
    });

    document.getElementById('select-field-preset')?.addEventListener('change', (e) => {
      this.app.setFieldPreset(e.target.value);
    });

    document.getElementById('select-bowler-type')?.addEventListener('change', (e) => {
      this.app.setBowlerType(e.target.value);
    });

    // Modals
    document.getElementById('btn-open-qr')?.addEventListener('click', () => this.openQRModal());
    document.getElementById('btn-close-qr')?.addEventListener('click', () => this.closeModal('modal-qr'));

    document.getElementById('btn-open-calibrate')?.addEventListener('click', () => this.app.startCalibrationFlow());
    document.getElementById('btn-cancel-calibrate')?.addEventListener('click', () => {
      this.app.batting.isCalibrating = false;
      this.closeModal('modal-calibrate');
    });

    document.getElementById('btn-open-modes')?.addEventListener('click', () => this.openModal('modal-setup'));
    document.getElementById('btn-close-setup')?.addEventListener('click', () => this.closeModal('modal-setup'));

    document.getElementById('btn-open-scorecard')?.addEventListener('click', () => {
      this.renderScorecardAndWagonWheel();
      this.openModal('modal-scorecard');
    });
    document.getElementById('btn-close-scorecard')?.addEventListener('click', () => this.closeModal('modal-scorecard'));

    document.getElementById('btn-open-settings')?.addEventListener('click', () => this.openModal('modal-settings'));
    document.getElementById('btn-close-settings')?.addEventListener('click', () => this.closeModal('modal-settings'));

    document.getElementById('setup-mode')?.addEventListener('change', (e) => {
      const modeId = e.target.value;
      const oversSelect = document.getElementById('setup-overs');
      if (!oversSelect) return;
      oversSelect.innerHTML = '';
      const opts = modeId === 'oneday' ? [10, 20, 30, 50] : modeId === 't20' ? [20] : [5];
      opts.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = String(o);
        opt.textContent = `${o} Overs (Max ${Math.max(1, Math.floor(o / 5))} / bowler)`;
        oversSelect.appendChild(opt);
      });
    });

    document.getElementById('btn-flip-coin')?.addEventListener('click', () => {
      this.app.performCoinToss();
    });

    document.getElementById('btn-start-match')?.addEventListener('click', () => {
      this.app.startConfiguredMatchFromUI();
      this.closeModal('modal-setup');
    });

    document.getElementById('btn-join-room')?.addEventListener('click', () => {
      const input = document.getElementById('input-room-code');
      if (input && input.value.trim().length === 4) {
        this.app.joinCustomRoom(input.value.trim().toUpperCase());
        this.renderQRModalContent();
      }
    });

    document.querySelectorAll('[data-qr-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-qr-mode');
        this.app.net.urlMode = mode;
        this.app.net.customBaseUrl = '';
        const customInput = document.getElementById('input-custom-host');
        if (customInput) customInput.value = '';
        document.querySelectorAll('[data-qr-mode]').forEach((b) => {
          b.classList.toggle('bg-amber-400', b === btn);
          b.classList.toggle('text-slate-950', b === btn);
          b.classList.toggle('text-slate-300', b !== btn);
        });
        this.renderQRModalContent();
      });
    });

    document.getElementById('input-custom-host')?.addEventListener('input', (e) => {
      this.app.net.customBaseUrl = e.target.value.trim();
      this.renderQRModalContent();
    });

    document.getElementById('btn-copy-qr-url')?.addEventListener('click', async () => {
      const urlP1 = this.app.net.getControllerUrl('p1');
      const copyBtn = document.getElementById('btn-copy-qr-url');
      try {
        await navigator.clipboard.writeText(urlP1);
        if (copyBtn) {
          copyBtn.textContent = 'Copied Link!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy Pairing Link';
          }, 1800);
        }
      } catch {
        if (copyBtn) copyBtn.textContent = 'Select Link Above';
      }
    });

    document.getElementById('setting-sensitivity')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.app.batting.sensitivity = val;
      const lbl = document.getElementById('lbl-sensitivity-val');
      if (lbl) lbl.textContent = `${val.toFixed(1)}x`;
    });

    document.getElementById('setting-assist')?.addEventListener('change', (e) => {
      this.app.bowling.assistMode = e.target.value;
    });

    document.getElementById('setting-resolution')?.addEventListener('change', (e) => {
      this.app.applyGraphicsSettings(e.target.value, document.getElementById('setting-fps')?.value || '60');
    });

    document.getElementById('setting-fps')?.addEventListener('change', (e) => {
      this.app.applyGraphicsSettings(document.getElementById('setting-resolution')?.value || '1080p', e.target.value);
    });

    document.getElementById('setting-lang')?.addEventListener('change', (e) => {
      this.lang = e.target.value;
      this.updateLanguageLabels();
      this.updateHUD();
    });

    document.getElementById('setting-sound')?.addEventListener('change', (e) => {
      this.app.setSoundEnabled(e.target.checked);
    });
  }

  toggleDock() {
    this.dockCollapsed = !this.dockCollapsed;
    const body = document.getElementById('bottom-dock-body');
    const btn = document.getElementById('btn-toggle-dock');
    if (body) body.classList.toggle('hidden', this.dockCollapsed);
    if (btn) btn.textContent = this.dockCollapsed ? this.t('showDock') : this.t('hideDock');
  }

  updateLanguageLabels() {
    document.getElementById('lbl-overs-title').textContent = this.t('overs');
    document.getElementById('lbl-crr-title').textContent = this.t('crr');
    document.getElementById('lbl-speed-title').textContent = this.t('speed');
    document.getElementById('lbl-timing-title').textContent = this.t('timing');
    document.getElementById('btn-open-qr').textContent = this.t('pairPhone');
    document.getElementById('btn-open-calibrate').textContent = this.t('calibrate');
    document.getElementById('btn-open-modes').textContent = this.t('matchSetup');
    document.getElementById('btn-open-scorecard').textContent = this.t('scorecard');
    document.getElementById('btn-open-settings').textContent = this.t('settings');

    const btnToggle = document.getElementById('btn-toggle-dock');
    if (btnToggle) {
      btnToggle.textContent = this.dockCollapsed ? this.t('showDock') : this.t('hideDock');
    }
  }

  /**
   * Updates the HUD Shot Mode icon & Bottom Dock GROUND / FLY toggle state
   */
  updateShotModeHUD() {
    const batting = this.app.batting;
    const isGround = batting.shotMode === 'ground';
    const isLocked = batting.modeLocked;

    const iconEl = document.getElementById('hud-shot-mode-icon');
    const lockEl = document.getElementById('hud-shot-mode-lock');
    if (iconEl) {
      iconEl.textContent = isGround ? 'GROUND (0–8°)' : 'FLY (20–50°)';
      iconEl.className = `font-display text-xs font-bold ${isGround ? 'text-emerald-400' : 'text-amber-400'}`;
    }
    if (lockEl) {
      lockEl.textContent = isLocked ? 'LOCKED' : 'UNLOCKED';
      lockEl.className = `font-mono text-[10px] ${isLocked ? 'text-amber-400 font-bold' : 'text-slate-400'}`;
    }

    const btnGround = document.getElementById('btn-hud-ground');
    const btnFly = document.getElementById('btn-hud-fly');
    if (btnGround && btnFly) {
      btnGround.className = `px-3 py-1.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
        isGround ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
      } ${isLocked ? 'opacity-60' : ''}`;

      btnFly.className = `px-3 py-1.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
        !isGround ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:text-white'
      } ${isLocked ? 'opacity-60' : ''}`;
    }
  }

  /**
   * Updates the On-Screen Sensor & Shot Debug Panel every frame
   */
  updateDebugPanel() {
    const b = this.app.batting;
    const c = b.lastContact;

    const modeEl = document.getElementById('dbg-mode');
    if (modeEl) {
      const planeStr = b.isRisingSwing ? 'RISING' : 'FLAT';
      const lockStr = b.modeLocked ? ' [LOCKED]' : '';
      modeEl.textContent = `${b.shotMode.toUpperCase()} · ${planeStr}${lockStr}`;
      modeEl.className = b.shotMode === 'fly' ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold';
    }

    const rawEl = document.getElementById('dbg-raw');
    if (rawEl) {
      rawEl.textContent = `${Math.round(b.rawAlpha)}° / ${Math.round(b.rawBeta)}° / ${Math.round(b.rawGamma)}°`;
    }

    const calEl = document.getElementById('dbg-cal');
    if (calEl) {
      calEl.textContent = `${Math.round(b.calYawDeg)}° / ${Math.round(b.calPitchDeg)}° / ${Math.round(b.calRollDeg)}°`;
    }

    const speedEl = document.getElementById('dbg-speed');
    if (speedEl) {
      speedEl.textContent = `${Math.round(b.angularSpeedDeg)} °/s (Pk ${Math.round(b.peakSwingSpeedDeg || c.batSpeedDeg)})`;
    }

    const timingEl = document.getElementById('dbg-timing');
    if (timingEl) {
      const sign = c.timingOffsetMs > 0 ? '+' : '';
      timingEl.textContent = `${sign}${c.timingOffsetMs} ms (${c.timingLabelEn.split(' ')[0]})`;
    }

    const launchEl = document.getElementById('dbg-launch');
    if (launchEl) {
      launchEl.textContent = `${c.launchAngleDeg.toFixed(1)}° · ${c.contactType}`;
    }
  }

  updateHUD() {
    const match = this.app.match;
    const batting = this.app.batting;
    const bowling = this.app.bowling;

    const teamShort = match.battingTeam.short;
    const scoreEl = document.getElementById('hud-score');
    if (scoreEl) {
      scoreEl.textContent = `${teamShort} ${match.runs}/${match.wickets}`;
    }

    const oversEl = document.getElementById('hud-overs');
    if (oversEl) {
      oversEl.textContent = `${match.getOversFormatted()} / ${match.totalOvers}`;
    }

    const crrEl = document.getElementById('hud-crr');
    if (crrEl) {
      const rrr = match.getRequiredRunRate();
      crrEl.textContent = rrr ? `${match.getCurrentRunRate()} · REQ ${rrr}` : match.getCurrentRunRate();
    }

    const statusEl = document.getElementById('hud-match-flags');
    if (statusEl) {
      const flags = [];
      if (match.isPowerplayActive()) flags.push(this.t('powerplay'));
      if (match.freeHit) flags.push(this.t('freeHit'));
      if (match.innings === 2 && match.firstInningsScore !== null) {
        flags.push(`${this.t('target')} ${match.firstInningsScore + 1}`);
      }
      statusEl.textContent = flags.join(' · ') || `${match.battingTeam.nameEn} vs ${match.bowlingTeam.nameEn}`;
    }

    const striker = match.getActiveStriker();
    const bowler = match.getActiveBowler();
    const playerStrip = document.getElementById('hud-players-strip');
    if (playerStrip && striker && bowler) {
      const bOvers = `${Math.floor(bowler.balls / 6)}.${bowler.balls % 6}`;
      playerStrip.textContent = `BAT: ${striker.name} ${striker.runs}*(${striker.balls})  ·  BOWL: ${bowler.name} ${bowler.wickets}-${bowler.runs} (${bOvers})`;
    }

    const dotsContainer = document.getElementById('hud-over-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      const balls = match.currentOverBalls.slice(-6);
      for (let i = 0; i < 6; i++) {
        const val = balls[i];
        const span = document.createElement('span');
        span.className = 'inline-flex items-center justify-center w-6 h-6 rounded text-xs font-mono font-bold tabular-nums ';
        if (!val) {
          span.className += 'bg-slate-800/80 text-slate-500 border border-slate-700/60';
          span.textContent = '·';
        } else if (val === 'W') {
          span.className += 'bg-red-600 text-white';
          span.textContent = 'W';
        } else if (val === '4' || val === '6') {
          span.className += 'bg-amber-500 text-slate-950';
          span.textContent = val;
        } else {
          span.className += 'bg-slate-700 text-slate-100';
          span.textContent = val;
        }
        dotsContainer.appendChild(span);
      }
    }

    const speedEl = document.getElementById('hud-speed');
    if (speedEl) {
      speedEl.textContent = `${bowling.lastDelivery.speedKmh.toFixed(1)} km/h`;
    }

    const timingEl = document.getElementById('hud-timing');
    if (timingEl) {
      const label = this.lang === 'hi' ? batting.lastContact.timingLabelHi : batting.lastContact.timingLabelEn;
      timingEl.textContent = `${label} (${batting.lastContact.launchAngleDeg}°)`;
    }

    const timingBar = document.getElementById('hud-timing-bar');
    if (timingBar) {
      const pct = Math.round(batting.lastContact.timingQuality * 100);
      timingBar.style.width = `${Math.max(8, pct)}%`;
    }

    this.updateShotModeHUD();
  }

  updateLivePhoneTelemetry(omegaDeg, footwork, p1Connected, latencyMs) {
    const phoneBadge = document.getElementById('hud-phone-status');
    if (phoneBadge) {
      if (p1Connected) {
        phoneBadge.textContent = `Phone Linked (${latencyMs}ms) · ${Math.round(omegaDeg)}°/s · ${footwork.toUpperCase()}`;
        phoneBadge.className = 'text-emerald-400';
      } else {
        phoneBadge.textContent = `Keyboard / Touch Active · Room ${this.app.net.roomCode}`;
        phoneBadge.className = 'text-slate-400';
      }
    }

    const qrLiveStatus = document.getElementById('qr-live-status');
    if (qrLiveStatus) {
      if (p1Connected) {
        qrLiveStatus.textContent = `Phone Connected! Room ${this.app.net.roomCode} (${latencyMs}ms)`;
        qrLiveStatus.className = 'mb-2.5 text-xs font-mono font-bold text-emerald-400';
      } else {
        qrLiveStatus.textContent = `Waiting for phone scan · Room ${this.app.net.roomCode}`;
        qrLiveStatus.className = 'mb-2.5 text-xs font-mono font-bold text-amber-400';
      }
    }

    this.updateDebugPanel();
  }

  showEventBanner(title, subtitle = '', colorClass = 'text-amber-400') {
    const banner = document.getElementById('hud-event-banner');
    const titleEl = document.getElementById('hud-event-title');
    const subEl = document.getElementById('hud-event-sub');
    if (!banner || !titleEl || !subEl) return;

    titleEl.textContent = title;
    titleEl.className = `text-3xl md:text-5xl font-extrabold tracking-tight ${colorClass}`;
    subEl.textContent = subtitle;
    banner.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
    banner.classList.add('opacity-100', 'scale-100');

    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => {
      banner.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
      banner.classList.remove('opacity-100', 'scale-100');
    }, 2300);
  }

  setCommentary(textEn, textHi = '') {
    const el = document.getElementById('hud-commentary');
    if (!el) return;
    el.textContent = this.lang === 'hi' && textHi ? textHi : textEn;
  }

  openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
  }

  closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
  }

  openQRModal() {
    this.renderQRModalContent();
    this.openModal('modal-qr');
  }

  renderQRModalContent() {
    const urlP1 = this.app.net.getControllerUrl('p1');
    const qrContainer = document.getElementById('qr-svg-container');
    if (qrContainer) {
      qrContainer.innerHTML = generateQRCodeSVG(urlP1, 250);
    }
    const urlText = document.getElementById('qr-url-text');
    if (urlText) {
      urlText.textContent = urlP1;
      urlText.href = urlP1;
    }
    const openCtrlBtn = document.getElementById('btn-open-ctrl-tab');
    if (openCtrlBtn) {
      openCtrlBtn.href = `/controller.html?r=${this.app.net.roomCode}`;
    }
    const roomEl = document.getElementById('qr-room-code');
    if (roomEl) {
      roomEl.textContent = this.app.net.roomCode;
    }
  }

  renderScorecardAndWagonWheel() {
    const match = this.app.match;
    const tbody = document.getElementById('scorecard-batting-body');
    if (tbody) {
      tbody.innerHTML = '';
      match.battingCard.forEach((row, idx) => {
        const tr = document.createElement('tr');
        const isStriker = idx === match.strikerIndex && !row.isOut;
        tr.className = `border-b border-slate-800 ${isStriker ? 'bg-slate-800/60 text-amber-300 font-semibold' : 'text-slate-200'}`;
        const sr = row.balls > 0 ? ((row.runs / row.balls) * 100).toFixed(1) : '0.0';
        const status = this.lang === 'hi' ? row.statusHi : row.statusEn;
        tr.innerHTML = `
          <td class="py-1.5 px-2">${row.name}${isStriker ? ' *' : ''}</td>
          <td class="py-1.5 px-2 text-xs text-slate-400">${status}</td>
          <td class="py-1.5 px-2 text-right font-mono tabular-nums">${row.runs}</td>
          <td class="py-1.5 px-2 text-right font-mono tabular-nums">${row.balls}</td>
          <td class="py-1.5 px-2 text-right font-mono tabular-nums">${row.fours}</td>
          <td class="py-1.5 px-2 text-right font-mono tabular-nums">${row.sixes}</td>
          <td class="py-1.5 px-2 text-right font-mono tabular-nums">${sr}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    const bowlBody = document.getElementById('scorecard-bowling-body');
    if (bowlBody) {
      bowlBody.innerHTML = '';
      match.bowlingCard.forEach((b) => {
        const overs = `${Math.floor(b.balls / 6)}.${b.balls % 6}`;
        const econ = b.balls > 0 ? ((b.runs / b.balls) * 6).toFixed(2) : '0.00';
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-800 text-slate-200';
        tr.innerHTML = `
          <td class="py-1.5 px-2">${b.name}</td>
          <td class="py-1.5 px-2 text-right font-mono tabular-nums">${overs}</td>
          <td class="py-1.5 px-2 text-right font-mono tabular-nums">${b.runs}</td>
          <td class="py-1.5 px-2 text-right font-mono tabular-nums">${b.wickets}</td>
          <td class="py-1.5 px-2 text-right font-mono tabular-nums">${econ}</td>
        `;
        bowlBody.appendChild(tr);
      });
    }

    const canvas = document.getElementById('wagon-wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 16;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#064e3b';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#10b981';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#d6b88a';
    ctx.fillRect(cx - 5, cy - 18, 10, 36);

    match.wagonWheel.forEach((shot) => {
      const normDist = Math.min(1.0, shot.distance / 52.0);
      const ex = cx + Math.sin(shot.angleRad) * (normDist * r);
      const ey = cy - Math.cos(shot.angleRad) * (normDist * r);

      ctx.strokeStyle = shot.runs === 6 ? '#f59e0b' : shot.runs === 4 ? '#38bdf8' : '#e2e8f0';
      ctx.lineWidth = shot.runs >= 4 ? 2.6 : 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 10);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(ex, ey, 3.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
