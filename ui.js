import { generateQRCodeSVG } from './assets/qr.js';
import { FICTIONAL_TEAMS } from './modes.js';
import { ASSET_LICENSES } from './assets/models_and_anims.js';
import {
  gameConfig,
  saveGameConfig,
  normalizeDifficultyKey,
  getDifficultyProfile,
  rollRunChaseTarget
} from './config.js';
import { sound } from './assets/audio.js';
import { commentary } from './commentary.js';
import { initTvDpadNavigation } from './src/tv_dpad.js';
import { initPwaInstall } from './src/pwa_install.js';

/**
 * TV Broadcast Lower-Third Scoreboard, Corner Menu, Transient Timing Meter,
 * Live Commentary Captions, Audio Mixer, 22-Variation Selector & Scorecard (ui.js)
 */

export const I18N = {
  en: {
    overs: 'OVERS',
    crr: 'RUN RATE',
    rrr: 'REQ',
    target: 'TARGET',
    freeHit: 'FREE HIT',
    powerplay: 'PP',
    speed: 'SPEED',
    timing: 'TIMING',
    batSpeed: 'SWING',
    menu: 'Menu',
    pairPhone: 'Pair Phone (QR)',
    calibrate: 'Calibrate (3s)',
    matchSetup: 'Match Setup',
    scorecard: 'Scorecard & Wheel',
    settings: 'Settings',
    hideDock: 'Controls Dock (H)',
    showDock: 'Controls Dock (H)'
  },
  hi: {
    overs: 'ओवर',
    crr: 'रन रेट',
    rrr: 'जरूरी रेट',
    target: 'लक्ष्य',
    freeHit: 'फ्री हिट',
    powerplay: 'PP',
    speed: 'रफ़्तार',
    timing: 'टाइमिंग',
    batSpeed: 'बल्ला गति',
    menu: 'मेनू',
    pairPhone: 'फ़ोन जोड़ें (QR)',
    calibrate: 'कैलिब्रेट (3s)',
    matchSetup: 'मैच मोड',
    scorecard: 'स्कोरकार्ड और व्हील',
    settings: 'सेटिंग्स',
    hideDock: 'कंट्रोल डॉक (H)',
    showDock: 'कंट्रोल डॉक (H)'
  }
};

function shortSurname(fullName = '') {
  const parts = String(fullName).trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

function normalizeShortEventLabel(rawTitle = '') {
  const upper = String(rawTitle).toUpperCase();
  if (upper.includes('SIX')) return 'SIX!';
  if (upper.includes('FOUR')) return 'FOUR!';
  if (upper.includes('FREE HIT')) return 'FREE HIT';
  if (upper.includes('HAT-TRICK')) return 'HAT-TRICK!';
  if (upper.includes('DROPPED')) return 'DROPPED!';
  if (upper.includes('PLAYED ON')) return 'OUT · PLAYED ON!';
  if (upper.includes('BOWLED')) return 'OUT · BOWLED!';
  if (upper.includes('CAUGHT BEHIND')) return 'OUT · CAUGHT BEHIND!';
  if (upper.includes('CAUGHT')) return 'OUT · CAUGHT!';
  if (upper.includes('LBW')) return 'OUT · LBW!';
  if (upper.includes('STUMPED')) return 'OUT · STUMPED!';
  if (upper.includes('RUN OUT')) return 'OUT · RUN OUT!';
  if (upper.includes('HIT WICKET')) return 'OUT · HIT WICKET!';
  if (upper.includes('OUT')) return 'OUT · WICKET!';
  if (upper.includes('WIDE')) return 'WIDE BALL';
  if (upper.includes('NO BALL')) return 'NO BALL · FREE HIT';
  if (upper.includes('FIFTY') || upper.includes('50')) return 'FIFTY · 50!';
  if (upper.includes('HUNDRED') || upper.includes('100') || upper.includes('CENTURY')) return 'CENTURY · 100!';
  return rawTitle;
}

export class UIManager {
  constructor(app) {
    this.app = app;
    this.lang = 'en';
    this.uiSize = gameConfig.uiSize || 'medium'; // 'small' | 'medium' (default) | 'large'
    this.dockCollapsed = true; // Hidden by default (H to toggle)
    this.debugVisible = false; // Hidden by default (D to toggle)
    this.cornerMenuOpen = false;
    this.activeModalId = null;
    this.wasPhoneConnected = false;
    this.bannerTimeout = null;
    this.timingToastTimeout = null;
    this.statusToastTimeout = null;
    this.captionTimeout = null;
    this.deliveryPreviewTimeout = null;
    this.wasShotExecutedLastCheck = false;
    this.setupMode = ['t20', 'last_over', 'run_chase', 'super_over'].includes(gameConfig.modeId)
      ? gameConfig.modeId
      : 'run_chase';
    this.setupStep = 1;
    this.rolledChaseTarget = rollRunChaseTarget(gameConfig.difficulty, this.setupMode);
    this.t20TossDone = false;
    this.t20UserWonToss = false;
    this.drsPromptTimeout = null;
    this.overWagonTimeout = null;
  }

  t(key) {
    return (I18N[this.lang] && I18N[this.lang][key]) || I18N.en[key] || key;
  }

  init() {
    this.setUISize(this.uiSize);
    this.injectProFeaturesUI();
    this.populateTeamSelects();
    this.populateAssetLicenses();
    this.populateBowlingVariationSelect();
    this.populateSpeechVoicesSelect();
    this.syncSettingsControlsFromConfig();
    this.setSetupStep(1);
    commentary.onCaptionCallback = (text) => {
      this.showCommentaryCaption(text);
    };
    this.bindEvents();
    this.bindVirtualJoystickAndPadEvents();
    this.updateLanguageLabels();
    this.updateShotModeHUD();
    this.updateHUD();
    this.syncVirtualControlsVisibility();
    initTvDpadNavigation(this.app, this);
    this.pwaInstall = initPwaInstall(this.app, this);
  }

  setUISize(size = 'medium') {
    this.uiSize = ['small', 'medium', 'large'].includes(size) ? size : 'medium';
    gameConfig.uiSize = this.uiSize;
    saveGameConfig();
    if (document.body) {
      document.body.setAttribute('data-ui-size', this.uiSize);
    }
    const sel = document.getElementById('setting-ui-size');
    if (sel) sel.value = this.uiSize;
  }

  populateBowlingVariationSelect() {
    const sel = document.getElementById('select-bowling-variation');
    if (!sel || !this.app.bowling) return;
    const vars = this.app.bowling.getVariationsForBowler(this.app.bowling.bowlerType);
    sel.innerHTML = '';
    vars.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = this.lang === 'hi' ? `${v.nameHi} (${v.nameEn})` : v.nameEn;
      if (v.id === this.app.bowling.selectedVariationId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  populateSpeechVoicesSelect() {
    const sel = document.getElementById('setting-comm-voice');
    if (!sel) return;
    const voices = commentary.getVoicesForLanguage(gameConfig.commentary.language);
    sel.innerHTML = '<option value="auto">Auto Best Voice (TV + Browser)</option>';
    voices.slice(0, 22).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = v.isCloud ? v.name : `${v.name} (${v.lang})`;
      if (v.voiceURI === gameConfig.commentary.voiceURI) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  syncSettingsControlsFromConfig() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null) el.value = String(val);
    };
    const setChk = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(val);
    };
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    const diff = normalizeDifficultyKey(gameConfig.difficulty);
    setVal('setting-difficulty', diff);
    setVal('setup-difficulty', diff);
    setVal('setup-stadium', gameConfig.stadium || 'eden_gardens');
    setVal('setup-day-night', gameConfig.timeOfDay || 'night');
    setVal('setting-handedness', gameConfig.handedness);
    setVal('setup-handedness', gameConfig.handedness);
    setVal('setting-assist', gameConfig.bowlingAssist);
    setVal('setting-autobowl', gameConfig.autoBowl || 'normal');
    setVal('setting-replays', gameConfig.replays);
    setVal('setting-ui-size', gameConfig.uiSize);
    setVal('setting-quality', gameConfig.graphicsQuality);
    setVal('setting-dof', 'off');
    setVal('setting-sensitivity', gameConfig.sensitivity);
    setTxt('lbl-sensitivity-val', `${Number(gameConfig.sensitivity || 1).toFixed(1)}x`);

    this.updateSetupModeUI(gameConfig.modeId || 'run_chase');
    this.refreshRunChaseTargetPreview(false);
    this.syncSetupWizardCards();

    // Audio mixer sliders
    const a = gameConfig.audio;
    setChk('setting-sound', !a.muted);
    const channels = ['master', 'effects', 'crowd', 'music', 'commentary'];
    channels.forEach((ch) => {
      const pct = Math.round((a[ch] ?? 0.8) * 100);
      setVal(`slider-vol-${ch}`, pct);
      setTxt(`lbl-vol-${ch}`, `${pct}%`);
    });

    // Commentary settings
    const c = gameConfig.commentary;
    setChk('setting-comm-enabled', c.enabled);
    setChk('setting-comm-spoken', c.spoken);
    setVal('setting-comm-lang', c.language);
    setVal('setting-comm-freq', c.frequency);
    setVal('setting-comm-voice', c.voiceURI || 'auto');
  }

  setSetupStep(step = 1) {
    this.setupStep = Math.max(1, Math.min(4, Number(step) || 1));
    this.syncSetupWizardCards();
  }

  syncSetupWizardCards() {
    const diff = normalizeDifficultyKey(document.getElementById('setup-difficulty')?.value || gameConfig.difficulty);
    document.querySelectorAll('[data-diff-card]').forEach((btn) => {
      const d = btn.getAttribute('data-diff-card');
      const active = d === diff;
      const activeClassMap = {
        easy: 'wd-scenario-active-emerald',
        medium: 'wd-scenario-active-amber',
        hard: 'wd-scenario-active-rose'
      };
      btn.className = `wd-scenario-card ${active ? activeClassMap[d] || 'wd-scenario-active-amber' : ''}`;
    });

    const t20OversVal = String(document.getElementById('setup-t20-overs')?.value || '20');
    document.querySelectorAll('[data-t20-overs-btn]').forEach((btn) => {
      const active = btn.getAttribute('data-t20-overs-btn') === t20OversVal;
      btn.className = `px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${
        active
          ? 'bg-sky-400 text-slate-950 border border-sky-300 shadow'
          : 'bg-slate-900 border border-slate-700 text-slate-300 hover:border-slate-500'
      }`;
    });

    const idxA = Number(document.getElementById('setup-team-a')?.value) || 0;
    const idxB = Number(document.getElementById('setup-team-b')?.value) || 1;
    const teamA = FICTIONAL_TEAMS[idxA] || FICTIONAL_TEAMS[0];
    const teamB = FICTIONAL_TEAMS[idxB] || FICTIONAL_TEAMS[1];

    const lblA = document.getElementById('lbl-selected-team-a');
    if (lblA && teamA) lblA.textContent = `${teamA.nameEn} (${teamA.short})`;
    const lblB = document.getElementById('lbl-selected-team-b');
    if (lblB && teamB) lblB.textContent = `${teamB.nameEn} (${teamB.short})`;

    // Sync Wavedash Live VS Header Pill & Step 2 VS Banner
    const livePill = document.getElementById('wd-live-matchup-pill');
    if (livePill && teamA && teamB) {
      livePill.textContent = `${teamA.short} vs ${teamB.short}`;
    }
    const vsTeamA = document.getElementById('wd-vs-team-a');
    if (vsTeamA && teamA) vsTeamA.textContent = `${teamA.nameEn} (${teamA.short})`;
    const vsTeamB = document.getElementById('wd-vs-team-b');
    if (vsTeamB && teamB) vsTeamB.textContent = `${teamB.nameEn} (${teamB.short})`;
    const vsColA = document.getElementById('wd-vs-color-a');
    if (vsColA && teamA) vsColA.style.background = teamA.primaryColor;
    const vsColB = document.getElementById('wd-vs-color-b');
    if (vsColB && teamB) vsColB.style.background = teamB.primaryColor;

    document.querySelectorAll('[data-team-a-card]').forEach((btn) => {
      const active = Number(btn.getAttribute('data-team-a-card')) === idxA;
      btn.className = `p-2.5 rounded-xl border-2 text-left transition-all cursor-pointer flex items-center gap-2 ${
        active
          ? 'bg-amber-400/20 border-amber-400 text-white shadow-md'
          : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700'
      }`;
    });

    document.querySelectorAll('[data-team-b-card]').forEach((btn) => {
      const active = Number(btn.getAttribute('data-team-b-card')) === idxB;
      btn.className = `p-2.5 rounded-xl border-2 text-left transition-all cursor-pointer flex items-center gap-2 ${
        active
          ? 'bg-sky-400/20 border-sky-400 text-white shadow-md'
          : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700'
      }`;
    });

    const stVal = document.getElementById('setup-stadium')?.value || 'eden_gardens';
    document.querySelectorAll('[data-stadium-card]').forEach((btn) => {
      const active = btn.getAttribute('data-stadium-card') === stVal;
      btn.className = `wd-scenario-card ${active ? 'wd-scenario-active-emerald' : ''}`;
    });

    const dnVal = document.getElementById('setup-day-night')?.value || 'night';
    document.querySelectorAll('[data-daynight-card]').forEach((btn) => {
      const active = btn.getAttribute('data-daynight-card') === dnVal;
      btn.className = `py-2.5 px-3 rounded-lg border-2 text-xs font-bold cursor-pointer transition-all ${
        active
          ? 'bg-amber-400/15 border-amber-400 text-amber-300'
          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
      }`;
    });

    const pitchVal = document.getElementById('setup-pitch-type')?.value || 'normal';
    document.querySelectorAll('[data-pitch-card]').forEach((btn) => {
      const active = btn.getAttribute('data-pitch-card') === pitchVal;
      btn.className = `py-1.5 px-2 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
        active
          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
      }`;
    });

    const handVal = document.getElementById('setup-handedness')?.value || 'right';
    document.querySelectorAll('[data-hand-card]').forEach((btn) => {
      const active = btn.getAttribute('data-hand-card') === handVal;
      btn.className = `py-2.5 px-3 rounded-lg border-2 text-xs font-bold cursor-pointer transition-all ${
        active
          ? 'bg-amber-400/15 border-amber-400 text-amber-300'
          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
      }`;
    });

    // Update Step 1 Target Preview Pill
    const step1Preview = document.getElementById('wd-step1-target-preview');
    if (step1Preview) {
      if (this.setupMode === 't20') {
        step1Preview.textContent = `T20 Full Match · ${t20OversVal} Overs / Side`;
      } else if (this.setupMode === 'super_over') {
        step1Preview.textContent = `⚡ Super Over Shootout · 1 Over / Side (2 Wickets Max)`;
      } else if (this.setupMode === 'last_over') {
        step1Preview.textContent = `Last Over Clutch · Target: ${this.rolledChaseTarget || 18} Runs (6 Balls)`;
      } else {
        step1Preview.textContent = `5-Over Chase · Target: ${this.rolledChaseTarget || 48} Runs (30 Balls)`;
      }
    }

    // Update Step 4 Summary Banner
    const matchupEl = document.getElementById('setup-summary-matchup');
    if (matchupEl && teamA && teamB) {
      matchupEl.textContent = `${teamA.nameEn} (${teamA.short}) vs ${teamB.nameEn} (${teamB.short})`;
    }
    const metaEl = document.getElementById('setup-summary-meta');
    if (metaEl) {
      const modeStr =
        this.setupMode === 't20'
          ? `T20 Match (${t20OversVal} Overs)`
          : this.setupMode === 'super_over'
            ? '⚡ Super Over Shootout (1 Over)'
            : this.setupMode === 'last_over'
              ? 'Last Over Thriller (6 Balls)'
              : '5-Over Run Chase';
      const stLabel =
        stVal === 'wankhede'
          ? 'Wankhede'
          : stVal === 'narendra_modi'
            ? 'Narendra Modi'
            : 'Eden Gardens';
      const dnLabel = dnVal === 'day' ? 'Day' : 'Night';
      metaEl.textContent = `${modeStr} · ${diff.toUpperCase()} · ${stLabel} · ${dnLabel}`;
    }
  }

  updateSetupModeUI(modeId = 'run_chase') {
    const validMode = ['t20', 'last_over', 'run_chase', 'super_over'].includes(modeId) ? modeId : 'run_chase';
    const isT20 = validMode === 't20';
    const isSuperOver = validMode === 'super_over';
    const isLastOver = validMode === 'last_over';
    this.setupMode = validMode;
    gameConfig.modeId = this.setupMode;
    saveGameConfig();

    const modeSel = document.getElementById('setup-mode');
    if (modeSel) modeSel.value = this.setupMode;
    const t20OversVal = Number(document.getElementById('setup-t20-overs')?.value) || 20;
    const oversSel = document.getElementById('setup-overs');
    if (oversSel) oversSel.value = isT20 ? String(t20OversVal) : isLastOver || isSuperOver ? '1' : '5';

    const btnChase = document.getElementById('btn-setup-mode-chase');
    const btnLastOver = document.getElementById('btn-setup-mode-last-over');
    const btnT20 = document.getElementById('btn-setup-mode-t20');
    const btnSuperOver = document.getElementById('btn-setup-mode-super-over');
    if (btnChase) {
      btnChase.className = `wd-scenario-card ${validMode === 'run_chase' ? 'wd-scenario-active-amber' : ''}`;
    }
    if (btnLastOver) {
      btnLastOver.className = `wd-scenario-card ${isLastOver ? 'wd-scenario-active-rose' : ''}`;
    }
    if (btnT20) {
      btnT20.className = `wd-scenario-card ${isT20 ? 'wd-scenario-active-sky' : ''}`;
    }
    if (btnSuperOver) {
      btnSuperOver.className = `wd-scenario-card ${isSuperOver ? 'wd-scenario-active-emerald' : ''}`;
    }

    const step1OversWrap = document.getElementById('setup-step1-t20-overs-wrap');
    if (step1OversWrap) step1OversWrap.classList.toggle('hidden', !isT20);

    const chaseCard = document.getElementById('setup-chase-card');
    const tossCard = document.getElementById('setup-toss-card');
    if (chaseCard) chaseCard.classList.toggle('hidden', isT20 || isSuperOver);
    if (tossCard) tossCard.classList.toggle('hidden', !isT20);

    const startBtn = document.getElementById('btn-start-match');
    if (startBtn) {
      startBtn.textContent = isT20
        ? `🏆 START T20 MATCH (${t20OversVal} OVERS)`
        : isSuperOver
          ? '⚡ START SUPER OVER'
          : isLastOver
            ? '🔥 START LAST OVER (6 BALLS)'
            : '🏏 START 5-OVER CHASE';
    }
    this.syncSetupWizardCards();
  }

  refreshRunChaseTargetPreview(rollNew = true) {
    const diff = normalizeDifficultyKey(
      document.getElementById('setup-difficulty')?.value || gameConfig.difficulty
    );
    const profile = getDifficultyProfile(diff);
    const isLastOver = this.setupMode === 'last_over';
    const minT = isLastOver
      ? diff === 'easy'
        ? 12
        : diff === 'hard'
          ? 22
          : 16
      : profile.chaseTargetMin;
    const maxT = isLastOver
      ? diff === 'easy'
        ? 16
        : diff === 'hard'
          ? 28
          : 22
      : profile.chaseTargetMax;

    if (
      rollNew ||
      !this.rolledChaseTarget ||
      this.rolledChaseTarget < minT ||
      this.rolledChaseTarget > maxT
    ) {
      this.rolledChaseTarget = rollRunChaseTarget(diff, this.setupMode);
    }
    const descEl = document.getElementById('setup-chase-desc');
    if (descEl) {
      descEl.textContent = isLastOver
        ? `Final Over Clutch Scenario! 6 balls & 2 wickets in hand. ${profile.nameEn} Target Range: ${minT}–${maxT} Runs.`
        : `Opponent already batted 5 overs. ${profile.nameEn} Target Range: ${minT}–${maxT} Runs.`;
    }
    const badgeEl = document.getElementById('setup-chase-target-badge');
    if (badgeEl) {
      badgeEl.textContent = `Target: ${this.rolledChaseTarget} Runs (${isLastOver ? '6 Balls' : '30 Balls'})`;
    }
    const step1Preview = document.getElementById('wd-step1-target-preview');
    if (step1Preview && (this.setupMode === 'run_chase' || this.setupMode === 'last_over')) {
      step1Preview.textContent = isLastOver
        ? `Last Over Clutch · Target: ${this.rolledChaseTarget} Runs (6 Balls)`
        : `5-Over Chase · Target: ${this.rolledChaseTarget} Runs (30 Balls)`;
    }
  }

  syncStadiumAndDayNightUI(stadiumId, timeOfDay) {
    const stSel = document.getElementById('setup-stadium');
    if (stSel && stadiumId) stSel.value = stadiumId;
    const dnSel = document.getElementById('setup-day-night');
    if (dnSel && timeOfDay) dnSel.value = timeOfDay;

    document.querySelectorAll('[data-stadium]').forEach((b) => {
      const active = b.getAttribute('data-stadium') === stadiumId;
      b.classList.toggle('bg-emerald-500', active);
      b.classList.toggle('text-slate-950', active);
      b.classList.toggle('bg-slate-800', !active);
      b.classList.toggle('text-slate-200', !active);
    });

    const dockDn = document.getElementById('btn-dock-daynight');
    if (dockDn) {
      dockDn.textContent = timeOfDay === 'day' ? 'Day' : 'Night';
      dockDn.className = `px-2 py-1 text-[11px] font-semibold bg-slate-900 border border-slate-700 ${
        timeOfDay === 'day' ? 'text-sky-300' : 'text-amber-300'
      } rounded-md whitespace-nowrap shrink-0 cursor-pointer`;
    }
    this.syncSetupWizardCards();
  }

  showCommentaryCaption(text) {
    const el = document.getElementById('hud-commentary');
    if (el) el.textContent = text;

    const capBox = document.getElementById('hud-commentary-caption');
    const capTxt = document.getElementById('hud-commentary-caption-text');
    if (!capBox || !capTxt) return;

    if (!gameConfig.commentary.enabled) {
      capBox.classList.remove('opacity-100');
      capBox.classList.add('opacity-0');
      return;
    }

    capTxt.textContent = text;
    capBox.classList.remove('opacity-0');
    capBox.classList.add('opacity-100');

    if (this.captionTimeout) clearTimeout(this.captionTimeout);
    this.captionTimeout = setTimeout(() => {
      capBox.classList.remove('opacity-100');
      capBox.classList.add('opacity-0');
    }, 3800);
  }

  showDeliveryPreview(delivery, mode = 'hidden') {
    const badge = document.getElementById('hud-delivery-preview');
    const txt = document.getElementById('hud-delivery-preview-text');
    const dot = document.getElementById('hud-delivery-preview-dot');
    if (!badge || !txt) return;
    if (this.deliveryPreviewTimeout) {
      clearTimeout(this.deliveryPreviewTimeout);
      this.deliveryPreviewTimeout = null;
    }

    if (!delivery || mode === 'hidden') {
      badge.classList.add('hidden');
      return;
    }

    const name = this.lang === 'hi' && delivery.variationNameHi ? delivery.variationNameHi : delivery.variationNameEn || 'Delivery';
    const sideStr = delivery.bowlerSide === 'around' ? 'Around' : 'Over';
    const lenStr = delivery.lengthLabelEn ? `${delivery.lengthLabelEn.split(' ')[0]} · ` : '';
    txt.textContent = delivery.customStatusText || `${lenStr}${name} (${sideStr}) · ${Math.round(delivery.speedKmh || 132)} km/h`;

    if (dot) {
      const cat = delivery.lengthCategory || 'good';
      dot.className = `w-2 h-2 rounded-full animate-pulse ${
        cat === 'full'
          ? 'bg-emerald-400'
          : cat === 'short'
            ? 'bg-red-400'
            : cat === 'yorker'
              ? 'bg-sky-400'
              : 'bg-amber-400'
      }`;
    }

    // Position delivery preview pill cleanly at top-center below scoreboard so it never overlaps the bottom-left Angle Wheel
    badge.style.bottom = 'auto';
    badge.style.left = '50%';
    badge.style.top = 'calc(var(--hud-bar-h, 48px) + 8px)';
    badge.style.transform = 'translateX(-50%)';
    badge.classList.remove('hidden');

    if (mode === 'briefly') {
      this.deliveryPreviewTimeout = setTimeout(() => {
        badge.classList.add('hidden');
      }, 1250);
    }
  }

  updateBowlerSideButton() {
    const btn = document.getElementById('btn-bowler-side');
    if (!btn || !this.app.bowling) return;
    const isAround = this.app.bowling.bowlerSide === 'around';
    btn.textContent = isAround ? 'Around Wicket (V)' : 'Over Wicket (V)';
    btn.className = `px-2 py-1 text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-700 ${
      isAround ? 'text-amber-300' : 'text-emerald-300'
    } rounded-md whitespace-nowrap shrink-0 cursor-pointer`;
  }

  toggleCornerMenu(forceState) {
    this.cornerMenuOpen = typeof forceState === 'boolean' ? forceState : !this.cornerMenuOpen;
    const dropdown = document.getElementById('corner-menu-dropdown');
    if (dropdown) {
      dropdown.classList.toggle('hidden', !this.cornerMenuOpen);
    }
    const shotLbl = document.getElementById('lbl-menu-shotmode');
    if (shotLbl && this.app?.batting) {
      const isFly = this.app.batting.shotMode === 'fly';
      shotLbl.textContent = isFly ? '🚀 Shot: LOFTED' : '🎯 Shot: GROUND';
    }
    const camLbl = document.getElementById('lbl-menu-camera');
    if (camLbl && this.app) {
      const m = this.app.cameraMode || 'broadcast';
      const label = m === 'pro' ? 'Pro' : m === 'overhead' ? 'Overhead' : 'Broadcast';
      camLbl.textContent = `📷 Camera: ${label}`;
    }
    this.syncVirtualControlsVisibility();
    if (this.cornerMenuOpen) {
      this.showDeliveryPreview(
        {
          customStatusText: '⏸ GAME PAUSED · MENU OPEN',
          lengthCategory: 'good'
        },
        'always'
      );
      setTimeout(() => {
        window.__tvDpad?.focusScope?.('corner-menu-dropdown', '[data-tv-default]');
      }, 20);
    } else if (!this.isAnyModalOpen()) {
      this.showDeliveryPreview(null, 'hidden');
    }
  }

  toggleDebugPanel(forceState) {
    this.debugVisible = typeof forceState === 'boolean' ? forceState : !this.debugVisible;
    const panel = document.getElementById('debug-telemetry-panel');
    if (panel) {
      panel.classList.toggle('hidden', !this.debugVisible);
    }
    const stateLbl = document.getElementById('lbl-debug-state');
    if (stateLbl) {
      stateLbl.textContent = this.debugVisible ? 'Visible (D)' : 'Hidden (D)';
      stateLbl.className = `font-mono text-[10px] ${this.debugVisible ? 'text-emerald-400' : 'text-slate-400'}`;
    }
  }

  showTimingToast() {
    const toast = document.getElementById('hud-timing-toast');
    if (!toast) return;
    toast.classList.remove('opacity-0');
    toast.classList.add('opacity-100');
    if (this.timingToastTimeout) clearTimeout(this.timingToastTimeout);
    this.timingToastTimeout = setTimeout(() => {
      toast.classList.remove('opacity-100');
      toast.classList.add('opacity-0');
    }, 1500);
  }

  /**
   * Shows a brief status toast (e.g. "Phone connected" / "Phone disconnected")
   */
  showStatusToast(message, isPositive = true) {
    const toast = document.getElementById('hud-status-toast');
    const dot = document.getElementById('hud-toast-dot');
    const txt = document.getElementById('hud-toast-text');
    if (!toast || !txt) return;

    txt.textContent = message;
    toast.className = `fixed top-14 right-3 z-40 pointer-events-none opacity-100 translate-y-0 transition-all duration-200 flex items-center gap-2 bg-slate-950/95 border ${
      isPositive ? 'border-emerald-500/80' : 'border-amber-500/80'
    } rounded-lg px-3 py-1.5 shadow-xl text-xs font-medium text-slate-100`;
    if (dot) {
      dot.className = `w-2 h-2 rounded-full ${isPositive ? 'bg-emerald-400' : 'bg-amber-400'}`;
    }

    if (this.statusToastTimeout) clearTimeout(this.statusToastTimeout);
    this.statusToastTimeout = setTimeout(() => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', '-translate-y-1');
    }, 2600);
  }

  showToast(message, type = 'success') {
    this.showStatusToast(message, type !== 'warn' && type !== 'error');
  }

  handleControllerConnectionChange(connected, latencyMs = 12) {
    this.onPhoneConnectionChange(connected, latencyMs);
  }

  /**
   * Updates the connection status icon in the corner menu and auto-closes Pair Phone modal on connect
   */
  onPhoneConnectionChange(connected, latencyMs = 12) {
    const connBool = Boolean(connected);
    if (
      this._lastConnState === connBool &&
      Math.abs((this._lastConnLatency || 0) - latencyMs) < 6
    ) {
      return;
    }
    this._lastConnState = connBool;
    this._lastConnLatency = latencyMs;

    const menuDot = document.getElementById('menu-conn-dot');
    const qrMenuDot = document.getElementById('qr-menu-conn-dot');
    const qrMenuLbl = document.getElementById('qr-menu-conn-lbl');

    if (menuDot) {
      menuDot.className = `inline-block w-2 h-2 rounded-full transition-colors ${
        connBool ? 'bg-emerald-400 ring-2 ring-emerald-500/40' : 'bg-slate-500 ring-1 ring-slate-700'
      }`;
      menuDot.title = connBool ? `Phone Connected (${latencyMs}ms)` : 'Phone Disconnected';
    }
    if (qrMenuDot) {
      qrMenuDot.className = `inline-block w-2 h-2 rounded-full ${
        connBool ? 'bg-emerald-400' : 'bg-slate-500'
      }`;
    }
    if (qrMenuLbl) {
      qrMenuLbl.textContent = connBool ? 'ONLINE' : 'QR';
      qrMenuLbl.className = `text-[10px] font-mono ${connBool ? 'text-emerald-400 font-bold' : 'text-amber-300'}`;
    }

    const gateTitle = document.getElementById('qr-play-gate-title');
    if (gateTitle) {
      if (connBool) {
        gateTitle.textContent = `✅ PHONE CONTROLLER CONNECTED (${latencyMs}ms) · PRESS ▶ PLAY MATCH TO BEGIN!`;
        gateTitle.className = 'font-display font-bold text-xs sm:text-sm text-emerald-400';
      } else {
        gateTitle.textContent = '⏸ MATCH PAUSED UNTIL YOU PRESS PLAY';
        gateTitle.className = 'font-display font-bold text-xs sm:text-sm text-amber-300';
      }
    }

    if (connBool && !this.wasPhoneConnected) {
      this.wasPhoneConnected = true;
      // Only auto-close modal-qr if the match play gate was already confirmed earlier;
      // before the first ball, keep the Ready-to-Play popup open so the player can get into stance and press PLAY!
      const qrModal = document.getElementById('modal-qr');
      if (qrModal && !qrModal.classList.contains('hidden') && this.app.matchPlayConfirmed) {
        this.closeModal('modal-qr');
      }
      this.showStatusToast('Phone connected! Virtual stick hidden.', true);
    } else if (!connBool && this.wasPhoneConnected) {
      this.wasPhoneConnected = false;
      this.showStatusToast('Phone disconnected — Virtual stick enabled', false);
    }
    this.syncVirtualControlsVisibility();
  }

  /**
   * Shows the On-Screen Virtual Joystick & Shot Pad ONLY when no Phone Controller is connected
   * and hides it immediately as soon as the mobile controller connects!
   */
  syncVirtualControlsVisibility() {
    const vControls = document.getElementById('hud-virtual-controls');
    if (!vControls) return;
    const phoneConnected = Boolean(this.app?.net?.controllers?.p1?.connected);
    const modalOpen = this.isAnyModalOpen() || Boolean(this.cornerMenuOpen);
    vControls.classList.toggle('hidden', phoneConnected || modalOpen);
  }

  getSectorNameForAngle(deg) {
    const a = ((deg + 180) % 360 + 360) % 360 - 180;
    const b = this.app?.batting;
    const dirSign = b?.screenRightSign || -1;
    const handSign = b?.handedness === 'left' ? -1 : 1;
    // Convert screen wheel angle into batter tactical angle (+ = Off side, - = Leg side)
    const tactical = a * dirSign * handSign;

    const topLbl = document.getElementById('rc-wheel-lbl-top');
    const bottomLbl = document.getElementById('rc-wheel-lbl-bottom');
    const leftLbl = document.getElementById('rc-wheel-lbl-left');
    const rightLbl = document.getElementById('rc-wheel-lbl-right');
    const strikerDot = document.getElementById('rc-wheel-striker-dot');

    // dirSign === -1 => Option B (Default TV Broadcast View: Bowler at Bottom, Keeper at Top)
    // dirSign === +1 => Option A (Batsman View: Bowler at Top, Keeper at Bottom)
    const isBatsmanView = dirSign > 0;
    if (topLbl && bottomLbl) {
      topLbl.textContent = isBatsmanView ? 'STRAIGHT' : 'BEHIND';
      topLbl.setAttribute('fill', isBatsmanView ? 'rgba(167,243,208,0.9)' : 'rgba(253,230,138,0.8)');
      bottomLbl.textContent = isBatsmanView ? 'BEHIND' : 'STRAIGHT';
      bottomLbl.setAttribute('fill', isBatsmanView ? 'rgba(253,230,138,0.8)' : 'rgba(167,243,208,0.9)');
    }
    if (strikerDot) {
      strikerDot.setAttribute('cy', isBatsmanView ? '85' : '65');
    }
    if (leftLbl && rightLbl) {
      const leftIsOff = (-1 * dirSign * handSign) > 0;
      leftLbl.textContent = leftIsOff ? 'OFF' : 'LEG';
      rightLbl.textContent = leftIsOff ? 'LEG' : 'OFF';
    }

    if (tactical >= -18 && tactical <= 18) return 'STRAIGHT';
    if (tactical > 18 && tactical <= 62) return 'COVER';
    if (tactical > 62 && tactical <= 112) return 'POINT';
    if (tactical > 112 && tactical <= 156) return 'THIRD MAN';
    if (tactical < -18 && tactical >= -62) return 'MID-WICKET';
    if (tactical < -62 && tactical >= -112) return 'SQUARE LEG';
    if (tactical < -112 && tactical >= -156) return 'FINE LEG';
    return 'BEHIND KEEPER';
  }

  syncAngleWheelUI() {
    const b = this.app?.batting;
    if (!b) return;
    const deg = Math.round(b.custom360AimDeg || 0);
    const dirSign = b.screenRightSign || -1;
    const lbl = document.getElementById('virtual-joystick-label');
    const wedge = document.getElementById('rc-aim-wedge-group');
    const wheelLine = document.getElementById('rc-wheel-aim-line');
    const wheelCone = document.getElementById('rc-wheel-aim-cone');
    const wheelKnob = document.getElementById('rc-wheel-touch-dot');
    const fieldersGrp = document.getElementById('rc-wheel-fielders-group');

    const sector = this.getSectorNameForAngle(deg);

    if (wedge) {
      wedge.setAttribute('transform', `rotate(${deg} 70 70)`);
    }
    const rad = (deg * Math.PI) / 180;
    const r = 56;
    // In Option B (TV Broadcast View, dirSign = -1): 0° (STRAIGHT) points DOWN (ty > 75).
    // In Option A (Batsman View, dirSign = +1): 0° (STRAIGHT) points UP (ty < 75).
    const tx = 75 + Math.sin(rad) * r;
    const ty = 75 - dirSign * Math.cos(rad) * r;

    if (wheelLine) {
      wheelLine.setAttribute('x2', tx.toFixed(1));
      wheelLine.setAttribute('y2', ty.toFixed(1));
    }
    if (wheelCone) {
      const coneHalf = (16 * Math.PI) / 180;
      const x1 = 75 + Math.sin(rad - coneHalf) * 64;
      const y1 = 75 - dirSign * Math.cos(rad - coneHalf) * 64;
      const x2 = 75 + Math.sin(rad + coneHalf) * 64;
      const y2 = 75 - dirSign * Math.cos(rad + coneHalf) * 64;
      const sweepFlag = dirSign > 0 ? 1 : 0;
      wheelCone.setAttribute(
        'd',
        `M 75 75 L ${x1.toFixed(1)} ${y1.toFixed(1)} A 64 64 0 0 ${sweepFlag} ${x2.toFixed(1)} ${y2.toFixed(1)} Z`
      );
    }
    if (wheelKnob) {
      wheelKnob.setAttribute('cx', tx.toFixed(1));
      wheelKnob.setAttribute('cy', ty.toFixed(1));
    }
    if (fieldersGrp && this.app?.fielding?.fielders) {
      const maxFieldR = 60.0;
      const wheelR = 60.0;
      let dotsHtml = '';
      this.app.fielding.fielders.forEach((f) => {
        const fx = 75 + ((f.pos.x * dirSign) / maxFieldR) * wheelR;
        const fy = 75 + ((f.pos.z * dirSign) / maxFieldR) * wheelR;
        dotsHtml += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="2.3" fill="#38bdf8" opacity="0.88"/>`;
      });
      if (this.app.fielding.keeper) {
        const kx = 75 + ((this.app.fielding.keeper.pos.x * dirSign) / maxFieldR) * wheelR;
        const ky = 75 + ((this.app.fielding.keeper.pos.z * dirSign) / maxFieldR) * wheelR;
        dotsHtml += `<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="2.2" fill="#a7f3d0" opacity="0.9"/>`;
      }
      fieldersGrp.innerHTML = dotsHtml;
    }
    if (lbl && this.app?.match?.userRole !== 'bowl') {
      const sign = deg > 0 ? '+' : '';
      const fwTag = (b.footwork || 'front') === 'back' ? 'BACK' : 'FRONT';
      lbl.textContent = `${sector} · ${sign}${deg}° · ${fwTag}`;
    }
    this.renderFieldRadar();
  }

  applyControllerHandLayout(hand = 'right') {
    const leftPad = document.getElementById('rc-left-pad');
    const rightPad = document.getElementById('rc-right-pad');
    if (this.app?.batting) {
      this.app.batting.controllerLayoutHand = hand;
    }
    if (!leftPad || !rightPad) return;
    if (hand === 'left') {
      leftPad.style.left = 'auto';
      leftPad.style.right = 'max(0.75rem, env(safe-area-inset-right))';
      rightPad.style.right = 'auto';
      rightPad.style.left = 'max(0.75rem, env(safe-area-inset-left))';
    } else {
      leftPad.style.right = 'auto';
      leftPad.style.left = 'max(0.75rem, env(safe-area-inset-left))';
      rightPad.style.left = 'auto';
      rightPad.style.right = 'max(0.75rem, env(safe-area-inset-right))';
    }
  }

  bindVirtualJoystickAndPadEvents() {
    const lbl = document.getElementById('virtual-joystick-label');
    const modeBtn = document.getElementById('btn-vpad-mode');
    const loftBtn = document.getElementById('btn-vpad-loft');
    const defendBtn = document.getElementById('btn-vpad-defend');
    const pushBtn = document.getElementById('btn-vpad-push');
    const swingBtn = document.getElementById('btn-vpad-swing');
    const runBtn = document.getElementById('btn-vpad-run');
    const noRunBtn = document.getElementById('btn-vpad-norun');
    const hdGfxBtn = document.getElementById('btn-toggle-hd-graphics');
    const radarGapBtn = document.getElementById('btn-toggle-radar-aim');

    hdGfxBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1260);
      if (this.app && typeof this.app.setWavedashGraphicsMode === 'function') {
        this.app.setWavedashGraphicsMode(!this.app.wavedashGraphicsMode);
      }
    });

    // 1. Replace old ◀ LEFT / RIGHT ▶ buttons inside #rc-left-pad .rc-dpad-grid with the compact 116px semi-transparent 360° Angle Wheel
    const dpadGrid = document.querySelector('#rc-left-pad .rc-dpad-grid');
    if (dpadGrid) {
      dpadGrid.style.display = 'flex';
      dpadGrid.style.alignItems = 'center';
      dpadGrid.style.justifyContent = 'center';
      dpadGrid.style.gridTemplateColumns = 'none';
      dpadGrid.style.padding = '0px';
      dpadGrid.style.background = 'transparent';
      dpadGrid.style.border = 'none';
      dpadGrid.style.boxShadow = 'none';
      dpadGrid.style.width = '116px';
      dpadGrid.style.height = '116px';
      dpadGrid.innerHTML = `
        <div id="rc-angle-wheel" class="relative w-[116px] h-[116px] rounded-full select-none touch-none cursor-pointer pointer-events-auto"
          style="width: 116px; height: 116px; touch-action: none; background: radial-gradient(circle, rgba(6, 78, 59, 0.48) 0%, rgba(2, 44, 34, 0.72) 72%, rgba(9, 15, 29, 0.88) 100%); border: 1.5px solid rgba(52, 211, 153, 0.55); box-shadow: 0 6px 18px rgba(0,0,0,0.45), inset 0 0 14px rgba(16,185,129,0.18);">
          <svg viewBox="0 0 150 150" class="w-full h-full overflow-visible pointer-events-none">
            <defs>
              <radialGradient id="rcWheelConeGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#34d399" stop-opacity="0.52"/>
                <stop offset="100%" stop-color="#10b981" stop-opacity="0.04"/>
              </radialGradient>
            </defs>
            <!-- Outer boundary & 30-yard dashed ring -->
            <circle cx="75" cy="75" r="64" fill="none" stroke="rgba(16,185,129,0.35)" stroke-width="1.2"/>
            <circle cx="75" cy="75" r="34" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="3 3"/>
            <!-- Crosshair guide lines -->
            <line x1="75" y1="11" x2="75" y2="139" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
            <line x1="11" y1="75" x2="139" y2="75" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
            <!-- Edge Perimeter Direction Labels (Default Broadcast Batting Cam: STRAIGHT at Top, BEHIND at Bottom) -->
            <text id="rc-wheel-lbl-top" x="75" y="10" text-anchor="middle" fill="rgba(167,243,208,0.9)" font-size="6.5" font-weight="900" letter-spacing="0.06em">STRAIGHT</text>
            <text id="rc-wheel-lbl-bottom" x="75" y="146" text-anchor="middle" fill="rgba(253,230,138,0.8)" font-size="6.5" font-weight="900" letter-spacing="0.06em">BEHIND</text>
            <text id="rc-wheel-lbl-left" x="7" y="77" text-anchor="start" fill="rgba(186,230,253,0.8)" font-size="6" font-weight="800">LEG</text>
            <text id="rc-wheel-lbl-right" x="143" y="77" text-anchor="end" fill="rgba(186,230,253,0.8)" font-size="6" font-weight="800">OFF</text>
            <!-- Live Fielder Dots inside Angle Wheel -->
            <g id="rc-wheel-fielders-group"></g>
            <!-- Glowing Aim Cone -->
            <path id="rc-wheel-aim-cone" d="M 75 75 L 57.6 13.4 A 64 64 0 0 1 92.4 13.4 Z" fill="url(#rcWheelConeGrad)" />
            <!-- Small Pitch Rectangle in Center -->
            <rect x="70.5" y="59" width="9" height="32" rx="1.5" fill="rgba(214, 184, 138, 0.85)" stroke="rgba(255,255,255,0.45)" stroke-width="0.8"/>
            <line x1="71.5" y1="64" x2="78.5" y2="64" stroke="rgba(255,255,255,0.65)" stroke-width="0.8"/>
            <line x1="71.5" y1="86" x2="78.5" y2="86" stroke="rgba(255,255,255,0.65)" stroke-width="0.8"/>
            <!-- Striker Crease Position Indicator Dot -->
            <circle id="rc-wheel-striker-dot" cx="75" cy="85" r="3.2" fill="#f59e0b" stroke="#090f1d" stroke-width="1"/>
            <!-- Live Aim Line & Glowing Arrowhead Dot -->
            <line id="rc-wheel-aim-line" x1="75" y1="75" x2="75" y2="19" stroke="#34d399" stroke-width="2.4" stroke-linecap="round"/>
            <circle id="rc-wheel-touch-dot" cx="75" cy="19" r="5" fill="#10b981" stroke="#ecfdf5" stroke-width="1.5"/>
          </svg>
        </div>
      `;
    }

    const wheelEl = document.getElementById('rc-angle-wheel');
    if (wheelEl) {
      let wheelPointerId = null;

      const updateWheelFromTouch = (clientX, clientY) => {
        const rect = wheelEl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const dist = Math.hypot(dx, dy);

        const b = this.app?.batting;
        const bw = this.app?.bowling;
        if (!b) return;
        const dirSign = b.screenRightSign || -1;

        // Bowling role: allow using wheel to place bowling pitch marker OR dial Swing/Spin Curl!
        if (this.app.match?.userRole === 'bowl' && bw) {
          const maxR = Math.max(24, rect.width * 0.42);
          const nx = Math.max(-1, Math.min(1, dx / maxR));
          const ny = Math.max(-1, Math.min(1, dy / maxR));
          bw.aimTargetX = Math.max(-0.62, Math.min(0.62, -nx * dirSign * 0.56));
          bw.aimBounceZ = Math.max(1.2, Math.min(8.4, 4.8 + ny * dirSign * 3.2));
          if (this.app.aimRing) {
            this.app.aimRing.visible = true;
            this.app.aimRing.position.set(bw.aimTargetX, 0.035, bw.aimBounceZ);
          }
          const bowlDeg = Math.round(Math.atan2(dx, -dirSign * dy) * (180 / Math.PI));
          if (typeof b.setWheelAimDeg === 'function') {
            b.setWheelAimDeg(bowlDeg);
          } else {
            b.custom360AimDeg = bowlDeg;
          }
          this.syncAngleWheelUI();
          const curlStr = nx < -0.18 ? 'IN-CURL' : nx > 0.18 ? 'OUT-CURL' : 'STRAIGHT';
          if (lbl) lbl.textContent = `BOWL ${bw.aimBounceZ.toFixed(1)}m · ${curlStr}`;
          if (this.app.online1v1Active && this.app.net) {
            this.app.net.sendOnlineBowlAim({
              aimTargetX: bw.aimTargetX,
              aimBounceZ: bw.aimBounceZ,
              variationId: bw.selectedVariationId,
              bowlerSide: bw.bowlerSide
            });
          }
          return;
        }

        // Batting role:
        // In Option B (Default TV View, dirSign = -1): dragging DOWN (dy > 0) = 0° STRAIGHT, UP (dy < 0) = 180° BEHIND.
        // In Option A (Batsman View, dirSign = +1): dragging UP (dy < 0) = 0° STRAIGHT, DOWN (dy > 0) = 180° BEHIND.
        const forwardScreenY = -dirSign * dy;
        const angleRad = dist < 2 ? 0 : Math.atan2(dx, forwardScreenY);
        const angleDeg = Math.round(angleRad * (180 / Math.PI));
        if (typeof b.setWheelAimDeg === 'function') {
          b.setWheelAimDeg(angleDeg);
        } else {
          b.custom360AimDeg = angleDeg;
          b.swingPlaneYaw = (angleDeg * dirSign) * (Math.PI / 180);
        }
        this.syncAngleWheelUI();
      };

      wheelEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sound.init();
        wheelPointerId = e.pointerId;
        try {
          wheelEl.setPointerCapture(e.pointerId);
        } catch {}
        updateWheelFromTouch(e.clientX, e.clientY);
      });

      wheelEl.addEventListener('pointermove', (e) => {
        if (wheelPointerId === null || e.pointerId !== wheelPointerId) return;
        e.preventDefault();
        e.stopPropagation();
        updateWheelFromTouch(e.clientX, e.clientY);
      });

      const endWheelDrag = (e) => {
        if (wheelPointerId !== null && e.pointerId === wheelPointerId) {
          wheelPointerId = null;
          if (this.app?.batting) {
            // Angle stays locked after finger lifts!
            this.app.batting.virtualStickActive = false;
          }
        }
      };

      wheelEl.addEventListener('pointerup', endWheelDrag);
      wheelEl.addEventListener('pointercancel', endWheelDrag);
    }

    // 2. Inject & Bind Camera Setting ("Batsman View" vs "TV Broadcast Default") + 360° Controls in Settings & Corner Menu
    const settingsModalBody =
      document.querySelector('#modal-settings .modal-body') ||
      document.querySelector('#modal-settings .space-y-2\\.5');
    if (settingsModalBody && !document.getElementById('setting-camera-view')) {
      const extraSettingsHTML = document.createElement('div');
      extraSettingsHTML.className = 'p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2';
      extraSettingsHTML.innerHTML = `
        <div class="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Camera &amp; 360° Angle Wheel Settings</div>
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-xs font-bold text-white">Camera Setting</div>
            <div class="text-[10px] text-slate-400">Broadcast Batting (Close Behind Batter) or Bowler-End TV View</div>
          </div>
          <select id="setting-camera-view" class="bg-slate-900 border border-emerald-500/50 rounded-lg px-2.5 py-1 text-xs font-bold text-emerald-300 cursor-pointer">
            <option value="pro" selected>Broadcast Batting (Default)</option>
            <option value="broadcast">Bowler-End TV View</option>
            <option value="overhead">Overhead 2D View</option>
          </select>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-bold text-white">Auto-Reset Aim Every Ball</div>
            <div class="text-[10px] text-slate-400">Reset Angle Wheel to Straight (0°) after each ball</div>
          </div>
          <button id="setting-aim-autoreset" type="button" class="px-2.5 py-1 rounded text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 cursor-pointer">ON</button>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-bold text-white">Shot Assist (360° Gap Snap)</div>
            <div class="text-[10px] text-slate-400">Snap aim toward nearest fielding gap (scaled by difficulty)</div>
          </div>
          <button id="setting-shot-assist" type="button" class="px-2.5 py-1 rounded text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 cursor-pointer">ON</button>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-bold text-white">Controller Hand Layout</div>
            <div class="text-[10px] text-slate-400">Swap Angle Wheel &amp; Shot Buttons sides</div>
          </div>
          <button id="setting-controller-hand" type="button" class="px-2.5 py-1 rounded text-[10px] font-black uppercase bg-sky-500/20 text-sky-300 border border-sky-400/40 cursor-pointer">RIGHT-HANDED</button>
        </div>
      `;
      settingsModalBody.insertBefore(extraSettingsHTML, settingsModalBody.firstChild);
    }

    // Also add quick "Camera: Broadcast Batting" switch inside the top-right Corner Menu dropdown
    const cornerDropdown = document.getElementById('corner-menu-dropdown');
    if (cornerDropdown && !document.getElementById('btn-menu-camera-view')) {
      const camMenuBtn = document.createElement('button');
      camMenuBtn.id = 'btn-menu-camera-view';
      camMenuBtn.type = 'button';
      camMenuBtn.className =
        'w-full text-left px-3 py-1.5 rounded-lg text-emerald-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer flex items-center justify-between font-semibold';
      camMenuBtn.innerHTML = `
        <span>Camera Angle</span>
        <span id="lbl-menu-camera-view" class="text-[10px] text-amber-300 font-mono">Batting Cam</span>
      `;
      const settingsBtn = document.getElementById('btn-open-settings');
      if (settingsBtn && settingsBtn.parentNode === cornerDropdown) {
        cornerDropdown.insertBefore(camMenuBtn, settingsBtn.nextSibling);
      } else {
        cornerDropdown.appendChild(camMenuBtn);
      }
    }

    const syncAssistAndSettingsButtons = () => {
      const b = this.app?.batting;
      if (!b) return;
      const autoResetBtn = document.getElementById('setting-aim-autoreset');
      const assistBtn = document.getElementById('setting-shot-assist');
      const handBtn = document.getElementById('setting-controller-hand');
      const camSelect = document.getElementById('setting-camera-view');
      const menuCamLbl = document.getElementById('lbl-menu-camera-view');
      const activeCam =
        this.app?.cameraMode === 'follow'
          ? this.app?.savedCameraMode || 'pro'
          : this.app?.cameraMode || 'pro';

      if (camSelect) {
        camSelect.value = activeCam;
      }
      document.querySelectorAll('[data-cam]').forEach((b) => {
        const isAct = b.getAttribute('data-cam') === activeCam;
        b.classList.toggle('bg-amber-500', isAct);
        b.classList.toggle('text-slate-950', isAct);
        b.classList.toggle('bg-slate-800', !isAct);
        b.classList.toggle('text-slate-200', !isAct);
      });
      if (menuCamLbl) {
        menuCamLbl.textContent =
          activeCam === 'pro' ? 'Batting Cam' : activeCam === 'overhead' ? 'Overhead' : 'Bowler End';
      }
      if (autoResetBtn) {
        autoResetBtn.textContent = b.autoResetAimEveryBall ? 'ON' : 'OFF';
        autoResetBtn.className = b.autoResetAimEveryBall
          ? 'px-2.5 py-1 rounded text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 cursor-pointer'
          : 'px-2.5 py-1 rounded text-[10px] font-black uppercase bg-slate-800 text-slate-400 border border-slate-700 cursor-pointer';
      }
      if (assistBtn) {
        assistBtn.textContent = b.shotAssistGapSnap ? 'ON' : 'OFF';
        assistBtn.className = b.shotAssistGapSnap
          ? 'px-2.5 py-1 rounded text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 cursor-pointer'
          : 'px-2.5 py-1 rounded text-[10px] font-black uppercase bg-slate-800 text-slate-400 border border-slate-700 cursor-pointer';
      }
      if (radarGapBtn) {
        radarGapBtn.textContent = b.shotAssistGapSnap ? '360° GAP: ON' : '360° GAP: OFF';
        radarGapBtn.className = b.shotAssistGapSnap
          ? 'px-1.5 py-0.5 rounded bg-emerald-500/25 border border-emerald-400/50 text-[7px] font-black text-emerald-300 uppercase tracking-wider transition pointer-events-auto'
          : 'px-1.5 py-0.5 rounded bg-slate-800/90 border border-slate-600/60 text-[7px] font-black text-slate-300 uppercase tracking-wider transition pointer-events-auto';
      }
      if (handBtn) {
        const isLeft = b.controllerLayoutHand === 'left';
        handBtn.textContent = isLeft ? 'LEFT-HANDED' : 'RIGHT-HANDED';
      }
    };

    document.getElementById('setting-camera-view')?.addEventListener('change', (e) => {
      sound.playUIClick(1180);
      const nextCam = e.target.value || 'pro';
      if (this.app && typeof this.app.setCameraMode === 'function') {
        this.app.setCameraMode(nextCam);
        syncAssistAndSettingsButtons();
        this.syncAngleWheelUI();
        this.showStatusToast(
          nextCam === 'pro'
            ? '📷 Camera: Broadcast Batting View (Behind Batter)'
            : nextCam === 'overhead'
              ? '📷 Camera: Overhead View Active'
              : '📷 Camera: Bowler-End TV View',
          true
        );
      }
    });

    document.getElementById('btn-menu-camera-view')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1180);
      const curCam =
        this.app?.cameraMode === 'follow'
          ? this.app?.savedCameraMode || 'pro'
          : this.app?.cameraMode || 'pro';
      const nextCam = curCam === 'pro' ? 'broadcast' : 'pro';
      if (this.app && typeof this.app.setCameraMode === 'function') {
        this.app.setCameraMode(nextCam);
        syncAssistAndSettingsButtons();
        this.syncAngleWheelUI();
        this.toggleCornerMenu(false);
        this.showStatusToast(
          nextCam === 'pro' ? '📷 Switched to Broadcast Batting View!' : '📷 Switched to Bowler-End TV View!',
          true
        );
      }
    });

    document.getElementById('setting-aim-autoreset')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1080);
      if (this.app?.batting) {
        this.app.batting.autoResetAimEveryBall = !this.app.batting.autoResetAimEveryBall;
        syncAssistAndSettingsButtons();
      }
    });

    const toggleShotAssist = (e) => {
      e?.preventDefault();
      sound.playUIClick(1160);
      if (this.app?.batting) {
        this.app.batting.shotAssistGapSnap = !this.app.batting.shotAssistGapSnap;
        syncAssistAndSettingsButtons();
        this.showStatusToast(
          this.app.batting.shotAssistGapSnap
            ? '🎯 Shot Assist ON: Adaptive Gap Snap'
            : '🎯 Shot Assist OFF: Pure Manual Angle',
          true
        );
      }
    };

    document.getElementById('setting-shot-assist')?.addEventListener('click', toggleShotAssist);
    radarGapBtn?.addEventListener('click', toggleShotAssist);

    document.getElementById('setting-controller-hand')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1220);
      if (this.app?.batting) {
        const nextHand = this.app.batting.controllerLayoutHand === 'left' ? 'right' : 'left';
        this.applyControllerHandLayout(nextHand);
        syncAssistAndSettingsButtons();
        this.showStatusToast(
          nextHand === 'left' ? '🤚 Left-Handed Layout Active' : '🤚 Right-Handed Layout Active',
          true
        );
      }
    });

    syncAssistAndSettingsButtons();
    this.syncAngleWheelUI();

    // Quick Run / Cancel Run Buttons on Right Pad
    runBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sound.playUIClick(1320);
      this.app.triggerActionFromUI('take_extra_run');
    });
    noRunBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sound.playUIClick(720);
      this.app.triggerActionFromUI('turn_back');
    });

    modeBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sound.playUIClick();
      const order = ['ground', 'fly', 'defend'];
      const curIdx = order.indexOf(this.app.batting.shotMode);
      const nextMode = order[(curIdx + 1) % order.length];
      this.app.selectShotMode(nextMode);
    });

    // 3. Pure Tap Shot Type Buttons (DEFEND, PUSH, STROKE, LOFT) with Multi-Touch Support (No swipe/flick logic)
    const bindPureShotTypeButton = (btn, forcedShotMode, tapActionName) => {
      if (!btn) return;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sound.init();

        // In Bowling mode: LOFT button cycles bowling variation; STROKE button bowls delivery
        if (this.app.match?.userRole === 'bowl') {
          if (forcedShotMode === 'fly') {
            sound.playUIClick(1240);
            const bw = this.app.bowling;
            const vars = bw.getVariationsForBowler(bw.bowlerType);
            const idx = vars.findIndex((v) => v.id === bw.selectedVariationId);
            const nextVar = vars[(idx + 1) % vars.length];
            if (nextVar) {
              bw.selectVariation(nextVar.id);
              this.populateBowlingVariationSelect();
              this.showStatusToast(`⚾ Variation: ${nextVar.nameEn}`, true);
            }
          } else {
            sound.playUIClick(1080);
            this.app.triggerActionFromUI('bowl_or_swing');
          }
          return;
        }

        // In Batting mode: Pure tap fires shot along the Angle Wheel's locked angle!
        sound.playUIClick(forcedShotMode === 'fly' ? 1360 : 1080);
        this.app.triggerActionFromUI(tapActionName);
      });
    };

    // Bind STROKE (Ground 4) and LOFT (Aerial 6)
    bindPureShotTypeButton(swingBtn, 'ground', 'stroke_shot');
    bindPureShotTypeButton(loftBtn, 'fly', 'loft_shot');

    // Bind DEFEND (Solid Block in Bat mode / Over-Around Wicket in Bowl mode)
    defendBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sound.playUIClick(860);
      if (this.app.match?.userRole === 'bowl') {
        const nextSide = this.app.bowling.toggleBowlerSide();
        this.updateBowlerSideButton();
        this.showStatusToast(`⚾ Bowler Angle: ${nextSide === 'around' ? 'Around Wicket' : 'Over Wicket'}`, false);
        return;
      }
      this.app.triggerActionFromUI('defend_shot');
    });

    // Bind PUSH (Soft-hands Gap Single in Bat mode / Field Preset in Bowl mode)
    pushBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sound.playUIClick(980);
      if (this.app.match?.userRole === 'bowl') {
        const presets = ['attacking', 'normal', 'defensive'];
        const cur = this.app.fielding.setting || 'normal';
        const nextPreset = presets[(presets.indexOf(cur) + 1) % presets.length];
        this.app.fielding.applyFieldSetting(nextPreset, this.app.match.isPowerplayActive());
        this.app.fielding.resetToHomePositions(this.app.bowling.bowlerType);
        const fieldSelect = document.getElementById('select-field-preset');
        if (fieldSelect) fieldSelect.value = nextPreset;
        this.syncAngleWheelUI();
        this.showStatusToast(`🛡️ Field Preset: ${nextPreset.toUpperCase()}`, false);
        return;
      }
      this.app.triggerActionFromUI('push_shot');
    });
  }

  updateCreaseIndicatorUI() {
    const ind = document.getElementById('rc-crease-indicator');
    const b = this.app?.batting;
    if (!b) return;
    if (ind) {
      const dirSign = b.screenRightSign || -1;
      const screenNorm = Math.max(-1, Math.min(1, (b.creaseX * dirSign) / 0.62));
      const pct = `${(50 + screenNorm * 38).toFixed(1)}%`;
      if (ind.style.left !== pct) ind.style.left = pct;
    }
    const isSteppingOut = Boolean(b.stepOutCharge || b.creaseZOffset >= 0.24);
    const vpadStepBtn = document.getElementById('btn-vpad-step-out');
    if (vpadStepBtn) {
      vpadStepBtn.textContent = isSteppingOut ? '▲ OUT!' : '▲ CHARGE';
      vpadStepBtn.className = isSteppingOut
        ? 'px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 border border-amber-200 font-mono text-[8px] font-black uppercase tracking-wider cursor-pointer pointer-events-auto shadow transition-all animate-pulse'
        : 'px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-600 text-slate-200 font-mono text-[8px] font-extrabold uppercase tracking-wider cursor-pointer pointer-events-auto transition-all';
    }
    const dockStepBtn = document.getElementById('btn-step-out');
    if (dockStepBtn) {
      dockStepBtn.textContent = isSteppingOut ? '▲ Out of Crease!' : '▲ Step Out';
      dockStepBtn.className = isSteppingOut
        ? 'px-2 py-1 text-[11px] font-extrabold bg-amber-400 text-slate-950 border border-amber-200 rounded-md whitespace-nowrap shrink-0 cursor-pointer select-none shadow'
        : 'px-2 py-1 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md whitespace-nowrap shrink-0 cursor-pointer select-none';
    }
    const barStepBtn = document.getElementById('btn-bar-step-out');
    if (barStepBtn) {
      barStepBtn.textContent = isSteppingOut ? '▲OUT!' : '▲Out';
      barStepBtn.className = isSteppingOut
        ? 'px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 border border-amber-200 font-mono text-[10px] font-extrabold cursor-pointer select-none shadow'
        : 'px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[10px] font-bold cursor-pointer select-none';
    }
  }

  populateAssetLicenses() {
    const container = document.getElementById('asset-licenses-list');
    if (!container || !Array.isArray(ASSET_LICENSES)) return;
    container.innerHTML = '';
    ASSET_LICENSES.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'bg-slate-950/80 border border-slate-800 rounded px-2 py-1';
      div.innerHTML = `
        <div class="text-slate-200 font-semibold">${item.name}</div>
        <div class="text-slate-400">${item.source} · <span class="text-emerald-400 font-mono">${item.license}</span></div>
      `;
      container.appendChild(div);
    });
  }

  populateTeamSelects() {
    const selA = document.getElementById('setup-team-a');
    const selB = document.getElementById('setup-team-b');
    const gridA = document.getElementById('grid-team-a-cards');
    const gridB = document.getElementById('grid-team-b-cards');
    if (!selA || !selB) return;

    selA.innerHTML = '';
    selB.innerHTML = '';
    if (gridA) gridA.innerHTML = '';
    if (gridB) gridB.innerHTML = '';

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

      if (gridA) {
        const cardA = document.createElement('button');
        cardA.type = 'button';
        cardA.setAttribute('data-team-a-card', String(idx));
        cardA.className = 'p-2.5 rounded-xl border-2 text-left transition-all cursor-pointer flex items-center gap-2 bg-slate-900/90 border-slate-800 text-slate-300';
        cardA.innerHTML = `
          <span class="w-3.5 h-8 rounded-full shrink-0" style="background:${team.primaryColor}; box-shadow: 0 0 0 2px ${team.secondaryColor}55"></span>
          <div class="min-w-0">
            <div class="font-display font-bold text-xs sm:text-sm text-white leading-tight truncate">${team.short}</div>
            <div class="text-[10px] text-slate-400 truncate">${team.nameEn}</div>
          </div>
        `;
        cardA.addEventListener('click', () => {
          sound.playUIClick();
          selA.value = String(idx);
          if (Number(selB.value) === idx) {
            selB.value = String((idx + 1) % FICTIONAL_TEAMS.length);
          }
          const colEl = document.getElementById('setup-jersey-color');
          const numEl = document.getElementById('setup-jersey-num');
          if (colEl) colEl.value = team.primaryColor;
          if (numEl) numEl.value = String(team.defaultNumber || 18);
          this.syncSetupWizardCards();
        });
        gridA.appendChild(cardA);
      }

      if (gridB) {
        const cardB = document.createElement('button');
        cardB.type = 'button';
        cardB.setAttribute('data-team-b-card', String(idx));
        cardB.className = 'p-2.5 rounded-xl border-2 text-left transition-all cursor-pointer flex items-center gap-2 bg-slate-900/90 border-slate-800 text-slate-300';
        cardB.innerHTML = `
          <span class="w-3.5 h-8 rounded-full shrink-0" style="background:${team.primaryColor}; box-shadow: 0 0 0 2px ${team.secondaryColor}55"></span>
          <div class="min-w-0">
            <div class="font-display font-bold text-xs sm:text-sm text-white leading-tight truncate">${team.short}</div>
            <div class="text-[10px] text-slate-400 truncate">${team.nameEn}</div>
          </div>
        `;
        cardB.addEventListener('click', () => {
          sound.playUIClick();
          selB.value = String(idx);
          if (Number(selA.value) === idx) {
            selA.value = String((idx + 1) % FICTIONAL_TEAMS.length);
          }
          this.syncSetupWizardCards();
        });
        gridB.appendChild(cardB);
      }
    });
  }

  bindEvents() {
    // Small Corner Menu button & outside-click dismissal
    const cornerBtn = document.getElementById('btn-corner-menu');
    const cornerDrop = document.getElementById('corner-menu-dropdown');
    cornerBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCornerMenu();
    });
    document.addEventListener('click', (e) => {
      if (
        this.cornerMenuOpen &&
        cornerDrop &&
        !cornerDrop.contains(e.target) &&
        !cornerBtn?.contains(e.target)
      ) {
        this.toggleCornerMenu(false);
      }
    });

    // Corner Pause Menu extra TV-friendly buttons (Resume, Shot Mode, Camera, Home)
    document.getElementById('btn-menu-resume')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1180);
      this.toggleCornerMenu(false);
    });

    document.getElementById('btn-menu-shotmode')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1180);
      const nextMode = this.app.batting.shotMode === 'ground' ? 'fly' : 'ground';
      this.app.selectShotMode(nextMode);
      const shotLbl = document.getElementById('lbl-menu-shotmode');
      if (shotLbl) {
        shotLbl.textContent = nextMode === 'fly' ? '🚀 Shot: LOFTED' : '🎯 Shot: GROUND';
      }
    });

    document.getElementById('btn-menu-camera')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1180);
      const modes = ['broadcast', 'pro', 'overhead'];
      const next = modes[(modes.indexOf(this.app.cameraMode) + 1) % modes.length];
      this.app.setCameraMode(next);
      const camLbl = document.getElementById('lbl-menu-camera');
      if (camLbl) {
        const label = next === 'pro' ? 'Pro' : next === 'overhead' ? 'Overhead' : 'Broadcast';
        camLbl.textContent = `📷 Camera: ${label}`;
      }
    });

    // Home Screen & Full Screen buttons (Top HUD & Corner Menu)
    document.getElementById('btn-menu-home')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1150);
      this.goToHomeScreen();
    });

    document.getElementById('btn-hud-fullscreen')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1240);
      this.toggleFullScreen();
    });

    document.getElementById('btn-menu-fullscreen')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1240);
      this.toggleCornerMenu(false);
      this.toggleFullScreen();
    });

    const syncFullscreenLabels = () => {
      const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      const hudLbl = document.getElementById('lbl-hud-fullscreen');
      const menuLbl = document.getElementById('lbl-menu-fullscreen');
      if (hudLbl) hudLbl.textContent = isFs ? 'Exit FS' : 'Full Screen';
      if (menuLbl) menuLbl.textContent = isFs ? '⛶ Exit Full Screen' : '⛶ Full Screen';
    };
    document.addEventListener('fullscreenchange', syncFullscreenLabels);
    document.addEventListener('webkitfullscreenchange', syncFullscreenLabels);

    // Hotkeys: Tab for Scorecard, D for Debug, M for Match Setup (Escape/Back handled cleanly by tv_dpad.js)
    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.repeat) return;
      if (e.code === 'KeyD' && !this.app.batting.keys.right) {
        this.toggleDebugPanel();
      } else if (e.code === 'KeyM') {
        this.toggleCornerMenu(false);
        this.openModal('modal-setup');
      } else if (e.code === 'Tab') {
        e.preventDefault();
        const sc = document.getElementById('modal-scorecard');
        if (sc && !sc.classList.contains('hidden')) {
          this.closeModal('modal-scorecard');
        } else {
          this.renderScorecardAndWagonWheel();
          this.openModal('modal-scorecard');
        }
      }
    });

    // Requirement A.1: Close modal on device Back button (popstate)
    window.addEventListener('popstate', () => {
      window.__tvDpad?.handleBackAction?.();
    });

    // Requirement A.1: Close modal on click outside the modal card (on backdrop)
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          if (backdrop.id === 'modal-calibrate') {
            this.app.batting.isCalibrating = false;
          }
          this.closeModal(backdrop.id);
        }
      });
    });

    // Generic [data-close-modal] buttons in sticky headers and sticky footers
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-close-modal');
        if (targetId === 'modal-calibrate') {
          this.app.batting.isCalibrating = false;
        }
        if (targetId) this.closeModal(targetId);
      });
    });

    // Sticky bottom bar "Instant Rematch" & "Back to Menu / Match Setup" buttons
    document.getElementById('btn-scorecard-rematch')?.addEventListener('click', () => {
      sound.playUIClick(1280);
      if (typeof this.app.triggerInstantRematch === 'function') {
        this.app.triggerInstantRematch();
      }
    });
    document.getElementById('btn-scorecard-back-menu')?.addEventListener('click', () => {
      this.goToHomeScreen();
    });
    document.getElementById('btn-settings-back-menu')?.addEventListener('click', () => {
      this.goToHomeScreen();
    });

    // Reconnect Pause Banner buttons
    document.getElementById('btn-pause-repair')?.addEventListener('click', () => {
      this.openQRModal();
    });
    document.getElementById('btn-pause-resume')?.addEventListener('click', () => {
      this.app.net.disconnectPaused = false;
      document.getElementById('pause-reconnect-banner')?.classList.add('hidden');
    });

    // 1-Click Run (R) & No Run (N) buttons in Live Running Bar
    document.getElementById('btn-hud-run')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1180);
      this.app.triggerActionFromUI('take_extra_run');
    });
    document.getElementById('btn-hud-norun')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(820);
      this.app.triggerActionFromUI('turn_back');
    });

    document.getElementById('btn-toggle-dock')?.addEventListener('click', () => {
      this.toggleDock();
      this.toggleCornerMenu(false);
    });

    document.getElementById('btn-menu-debug')?.addEventListener('click', () => {
      this.toggleDebugPanel();
      this.toggleCornerMenu(false);
    });

    document.getElementById('btn-setting-debug')?.addEventListener('click', () => {
      this.toggleDebugPanel();
    });

    // Small Shot Type Indicator Icon inside the broadcast bar
    document.getElementById('btn-shot-mode-chip')?.addEventListener('click', () => {
      const nextMode = this.app.batting.shotMode === 'ground' ? 'fly' : 'ground';
      this.app.selectShotMode(nextMode);
    });

    // Pre-selected Shot Mode buttons in bottom dock (GROUND / FLY)
    document.getElementById('btn-hud-ground')?.addEventListener('click', () => {
      this.app.selectShotMode('ground');
    });
    document.getElementById('btn-hud-fly')?.addEventListener('click', () => {
      this.app.selectShotMode('fly');
    });

    // Primary gameplay buttons in bottom dock + Skip Replay button
    document.getElementById('btn-skip-replay')?.addEventListener('click', () => {
      this.app.skipReplay();
    });
    document.getElementById('btn-action-bowl')?.addEventListener('click', () => {
      this.app.triggerActionFromUI('bowl_or_swing');
    });
    document.getElementById('btn-action-defend')?.addEventListener('click', () => {
      this.app.triggerActionFromUI('defend_shot');
    });
    document.getElementById('btn-action-run')?.addEventListener('click', () => {
      this.app.triggerActionFromUI('take_extra_run');
    });
    document.getElementById('btn-action-norun')?.addEventListener('click', () => {
      this.app.triggerActionFromUI('turn_back');
    });

    // On-Screen Crease Step Left / Step Right Buttons (Dock & Broadcast Bar)
    const bindCreaseStepBtn = (btnId, dir) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        sound.playUIClick(dir < 0 ? 980 : 1120);
        if (dir < 0) {
          this.app.batting.keys.left = true;
        } else {
          this.app.batting.keys.right = true;
        }
        if (typeof this.app.stepBatsmanCrease === 'function') {
          this.app.stepBatsmanCrease(dir);
        }
      });
      const release = () => {
        if (dir < 0) {
          this.app.batting.keys.left = false;
        } else {
          this.app.batting.keys.right = false;
        }
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    };
    bindCreaseStepBtn('btn-step-left', -1);
    bindCreaseStepBtn('btn-step-right', 1);
    bindCreaseStepBtn('btn-bar-step-left', -1);
    bindCreaseStepBtn('btn-bar-step-right', 1);

    // On-Screen Step-Out / Charge Down Pitch Toggle Buttons (Virtual Pad, Dock & Broadcast Bar)
    const triggerStepOutToggle = (e) => {
      e?.preventDefault();
      sound.playUIClick(1240);
      if (typeof this.app?.toggleBatsmanStepOut === 'function') {
        this.app.toggleBatsmanStepOut();
      }
    };
    document.getElementById('btn-vpad-step-out')?.addEventListener('pointerdown', triggerStepOutToggle);
    document.getElementById('btn-step-out')?.addEventListener('click', triggerStepOutToggle);
    document.getElementById('btn-bar-step-out')?.addEventListener('click', triggerStepOutToggle);

    // Quick Simulate Current Over Buttons (Dock & Broadcast Bar)
    const triggerSimOver = () => {
      sound.playUIClick(1380);
      if (typeof this.app.simulateCurrentOver === 'function') {
        this.app.simulateCurrentOver();
      }
    };
    document.getElementById('btn-sim-over')?.addEventListener('click', triggerSimOver);
    document.getElementById('btn-bar-sim-over')?.addEventListener('click', triggerSimOver);

    // Interactive Catch / Direct-Hit Reflex QTE Tap Button
    document.getElementById('btn-hud-qte-tap')?.addEventListener('click', () => {
      if (typeof this.app.triggerFieldingReflexQTE === 'function') {
        this.app.triggerFieldingReflexQTE();
      }
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

    // Stadium switcher (3 Indian Stadiums + Day/Night toggle)
    document.querySelectorAll('[data-stadium]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playUIClick();
        const st = btn.getAttribute('data-stadium');
        this.app.setStadium(st, this.app.match.timeOfDay);
        this.syncStadiumAndDayNightUI(st, this.app.match.timeOfDay);
      });
    });

    document.getElementById('btn-dock-daynight')?.addEventListener('click', () => {
      sound.playUIClick();
      const nextTime = this.app.match.timeOfDay === 'day' ? 'night' : 'day';
      this.app.setStadium(this.app.match.stadium, nextTime);
      this.syncStadiumAndDayNightUI(this.app.match.stadium, nextTime);
    });

    document.getElementById('setup-stadium')?.addEventListener('change', (e) => {
      sound.playUIClick();
      const st = e.target.value;
      const dn = document.getElementById('setup-day-night')?.value || this.app.match.timeOfDay;
      this.app.setStadium(st, dn);
      this.syncStadiumAndDayNightUI(st, dn);
    });

    document.getElementById('setup-day-night')?.addEventListener('change', (e) => {
      sound.playUIClick();
      const dn = e.target.value;
      const st = document.getElementById('setup-stadium')?.value || this.app.match.stadium;
      this.app.setStadium(st, dn);
      this.syncStadiumAndDayNightUI(st, dn);
    });

    document.getElementById('select-field-preset')?.addEventListener('change', (e) => {
      this.app.setFieldPreset(e.target.value);
    });

    document.getElementById('select-pitch-type')?.addEventListener('change', (e) => {
      if (typeof this.app.setPitchType === 'function') {
        this.app.setPitchType(e.target.value);
      }
    });

    document.getElementById('btn-bowler-side')?.addEventListener('click', () => {
      sound.playUIClick();
      this.app.toggleBowlerSide();
    });

    document.getElementById('select-bowler-type')?.addEventListener('change', (e) => {
      sound.playUIClick();
      this.app.setBowlerType(e.target.value);
      this.populateBowlingVariationSelect();
    });

    document.getElementById('select-bowling-variation')?.addEventListener('change', (e) => {
      sound.playUIClick();
      this.app.bowling.setVariation(e.target.value);
    });

    // Corner Menu Modals
    document.getElementById('btn-open-qr')?.addEventListener('click', () => {
      sound.playUIClick();
      this._inMenuFlow = false;
      this.toggleCornerMenu(false);
      this.openQRModal();
    });
    document.getElementById('btn-close-qr')?.addEventListener('click', () => {
      sound.playUIClick();
      if (!this.app.matchPlayConfirmed || this._inMenuFlow) {
        this.goToHomeScreen();
      } else {
        this.closeModal('modal-qr');
      }
    });

    document.getElementById('btn-qr-play-now')?.addEventListener('click', () => {
      sound.playUIClick();
      this._inMenuFlow = false;
      this.app.confirmPlayAndStartMatch();
    });

    document.getElementById('btn-qr-back-setup')?.addEventListener('click', () => {
      sound.playUIClick();
      this.openModal('modal-setup');
    });

    document.getElementById('btn-open-calibrate')?.addEventListener('click', () => {
      sound.playUIClick();
      this.toggleCornerMenu(false);
      this.app.startCalibrationFlow();
    });
    document.getElementById('btn-cancel-calibrate')?.addEventListener('click', () => {
      this.app.batting.isCalibrating = false;
      this.closeModal('modal-calibrate');
    });

    document.getElementById('btn-open-modes')?.addEventListener('click', () => {
      sound.playUIClick();
      this._inMenuFlow = false;
      this.toggleCornerMenu(false);
      this.syncSettingsControlsFromConfig();
      this.refreshRunChaseTargetPreview(true);
      this.openModal('modal-setup');
    });
    document.getElementById('btn-close-setup')?.addEventListener('click', () => this.closeModal('modal-setup'));

    document.getElementById('btn-setup-back-modes')?.addEventListener('click', () => {
      sound.playUIClick(980);
      if (window.__middledMenu?.showModes) {
        window.__middledMenu.showModes();
      } else {
        this.closeModal('modal-setup');
      }
    });

    document.getElementById('btn-setup-open-qr')?.addEventListener('click', () => {
      sound.playUIClick();
      this.app.startConfiguredMatchFromUI(false);
      this.openQRModal();
    });

    // Fast TV D-Pad Team Steppers (◀ / ▶ & Swap)
    const stepTeamSelect = (which, delta) => {
      sound.playUIClick();
      const sA = document.getElementById('setup-team-a');
      const sB = document.getElementById('setup-team-b');
      if (!sA || !sB || FICTIONAL_TEAMS.length < 2) return;
      const n = FICTIONAL_TEAMS.length;
      let idxA = Number(sA.value) || 0;
      let idxB = Number(sB.value) || 1;
      if (which === 'a') {
        idxA = (idxA + delta + n) % n;
        if (idxA === idxB) idxA = (idxA + delta + n) % n;
        sA.value = String(idxA);
        sA.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        idxB = (idxB + delta + n) % n;
        if (idxB === idxA) idxB = (idxB + delta + n) % n;
        sB.value = String(idxB);
        sB.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    document.getElementById('btn-team-a-prev')?.addEventListener('click', () => stepTeamSelect('a', -1));
    document.getElementById('btn-team-a-next')?.addEventListener('click', () => stepTeamSelect('a', 1));
    document.getElementById('btn-team-b-prev')?.addEventListener('click', () => stepTeamSelect('b', -1));
    document.getElementById('btn-team-b-next')?.addEventListener('click', () => stepTeamSelect('b', 1));
    document.getElementById('btn-swap-teams')?.addEventListener('click', () => {
      sound.playUIClick(1180);
      const sA = document.getElementById('setup-team-a');
      const sB = document.getElementById('setup-team-b');
      if (!sA || !sB) return;
      const tmp = sA.value;
      sA.value = sB.value;
      sB.value = tmp;
      sA.dispatchEvent(new Event('change', { bubbles: true }));
    });

    document.getElementById('btn-open-scorecard')?.addEventListener('click', () => {
      sound.playUIClick();
      this.toggleCornerMenu(false);
      this.renderScorecardAndWagonWheel();
      this.openModal('modal-scorecard');
    });
    document.getElementById('btn-close-scorecard')?.addEventListener('click', () => this.closeModal('modal-scorecard'));

    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      sound.playUIClick();
      this._inMenuFlow = false;
      this.toggleCornerMenu(false);
      this.populateSpeechVoicesSelect();
      this.syncSettingsControlsFromConfig();
      this.openModal('modal-settings');
    });
    document.getElementById('btn-close-settings')?.addEventListener('click', () => this.closeModal('modal-settings'));

    // 3-Mode Selection (Run Chase 5 Overs, 1-Over Finisher Thriller & T20)
    document.querySelectorAll('[data-setup-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playUIClick();
        const modeId = btn.getAttribute('data-setup-mode');
        this._userRerolledTarget = false;
        this.updateSetupModeUI(modeId);
        if (modeId === 'run_chase' || modeId === 'last_over') {
          this.refreshRunChaseTargetPreview(true);
        }
      });
    });

    document.getElementById('setup-mode')?.addEventListener('change', (e) => {
      this._userRerolledTarget = false;
      this.updateSetupModeUI(e.target.value);
      if (e.target.value === 'run_chase' || e.target.value === 'last_over') {
        this.refreshRunChaseTargetPreview(true);
      }
    });

    // T20 Overs Quick Buttons on Step 1
    document.querySelectorAll('[data-t20-overs-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playUIClick();
        const oversVal = btn.getAttribute('data-t20-overs-btn') || '20';
        const t20Sel = document.getElementById('setup-t20-overs');
        const oversSel = document.getElementById('setup-overs');
        if (t20Sel) t20Sel.value = oversVal;
        if (oversSel) oversSel.value = oversVal;
        this.updateSetupModeUI('t20');
      });
    });

    // Step 3 Visual Cards: Stadium, Day/Night, Pitch, Batter Hand
    document.querySelectorAll('[data-stadium-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playUIClick();
        const st = btn.getAttribute('data-stadium-card') || 'eden_gardens';
        const stSel = document.getElementById('setup-stadium');
        if (stSel) stSel.value = st;
        const dn = document.getElementById('setup-day-night')?.value || this.app.match.timeOfDay;
        this.app.setStadium(st, dn);
        this.syncStadiumAndDayNightUI(st, dn);
      });
    });

    document.querySelectorAll('[data-daynight-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playUIClick();
        const dn = btn.getAttribute('data-daynight-card') || 'night';
        const dnSel = document.getElementById('setup-day-night');
        if (dnSel) dnSel.value = dn;
        const st = document.getElementById('setup-stadium')?.value || this.app.match.stadium;
        this.app.setStadium(st, dn);
        this.syncStadiumAndDayNightUI(st, dn);
      });
    });

    document.querySelectorAll('[data-pitch-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playUIClick();
        const p = btn.getAttribute('data-pitch-card') || 'normal';
        const pSel = document.getElementById('setup-pitch-type');
        if (pSel) pSel.value = p;
        if (typeof this.app.setPitchType === 'function') {
          this.app.setPitchType(p);
        }
        this.syncSetupWizardCards();
      });
    });

    document.querySelectorAll('[data-hand-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playUIClick();
        const h = btn.getAttribute('data-hand-card') || 'right';
        gameConfig.handedness = h;
        saveGameConfig();
        const setupHand = document.getElementById('setup-handedness');
        const settingHand = document.getElementById('setting-handedness');
        if (setupHand) setupHand.value = h;
        if (settingHand) settingHand.value = h;
        if (typeof this.app.setHandedness === 'function') {
          this.app.setHandedness(h);
        }
        this.syncSetupWizardCards();
      });
    });

    document.getElementById('btn-reroll-target')?.addEventListener('click', () => {
      sound.playUIClick();
      this._userRerolledTarget = true;
      this.refreshRunChaseTargetPreview(true);
    });

    // Team A & Team B selection (prevent duplicate teams & sync default jersey color/number)
    const selTeamA = document.getElementById('setup-team-a');
    const selTeamB = document.getElementById('setup-team-b');
    selTeamA?.addEventListener('change', () => {
      sound.playUIClick();
      const idxA = Number(selTeamA.value) || 0;
      if (selTeamB && Number(selTeamB.value) === idxA) {
        selTeamB.value = String((idxA + 1) % FICTIONAL_TEAMS.length);
      }
      const team = FICTIONAL_TEAMS[idxA];
      if (team) {
        const colEl = document.getElementById('setup-jersey-color');
        const numEl = document.getElementById('setup-jersey-num');
        if (colEl) colEl.value = team.primaryColor;
        if (numEl) numEl.value = String(team.defaultNumber || 18);
      }
      this.syncSetupWizardCards();
    });
    selTeamB?.addEventListener('change', () => {
      sound.playUIClick();
      const idxB = Number(selTeamB.value) || 0;
      if (selTeamA && Number(selTeamA.value) === idxB) {
        selTeamA.value = String((idxB + 1) % FICTIONAL_TEAMS.length);
      }
      this.syncSetupWizardCards();
    });

    // Official T20 Coin Toss Buttons (Call HEADS / Call TAILS / Elect Bat or Bowl) + T20 Overs Selector
    document.getElementById('setup-t20-overs')?.addEventListener('change', (e) => {
      sound.playUIClick();
      const oversSel = document.getElementById('setup-overs');
      if (oversSel) oversSel.value = e.target.value;
      const startBtn = document.getElementById('btn-start-match');
      if (startBtn && this.setupMode === 't20') {
        startBtn.textContent = `Start T20 Match (${e.target.value} Overs)`;
      }
      this.syncSetupWizardCards();
    });

    document.querySelectorAll('[data-coin-call]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const call = btn.getAttribute('data-coin-call') || 'HEADS';
        this.app.performCoinToss(call);
      });
    });
    document.getElementById('btn-flip-coin')?.addEventListener('click', () => {
      this.app.performCoinToss('HEADS');
    });

    const electBatBtn = document.getElementById('btn-toss-elect-bat');
    const electBowlBtn = document.getElementById('btn-toss-elect-bowl');
    const setTossRoleChoice = (role) => {
      sound.playUIClick();
      const roleSel = document.getElementById('setup-role');
      if (roleSel) roleSel.value = role;
      if (electBatBtn && electBowlBtn) {
        electBatBtn.className = `px-4 py-2 text-xs sm:text-sm font-bold rounded-xl cursor-pointer ${
          role === 'bat' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
        }`;
        electBowlBtn.className = `px-4 py-2 text-xs sm:text-sm font-bold rounded-xl cursor-pointer ${
          role === 'bowl' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
        }`;
      }
      const resEl = document.getElementById('toss-result-text');
      const teamAName = FICTIONAL_TEAMS[Number(selTeamA?.value) || 0]?.nameEn || 'Your Team';
      if (resEl) {
        resEl.textContent = `${teamAName} won the toss and elected to ${role.toUpperCase()} first!`;
      }
    };
    electBatBtn?.addEventListener('click', () => setTossRoleChoice('bat'));
    electBowlBtn?.addEventListener('click', () => setTossRoleChoice('bowl'));

    document.getElementById('btn-start-match')?.addEventListener('click', () => {
      sound.playUIClick();
      // If user selected T20 mode and hasn't flipped the coin yet, trigger the 3D Coin Toss first!
      if (this.setupMode === 't20' && !this.t20TossDone) {
        this.app.performCoinToss('HEADS');
        return;
      }
      this.closeAllModals(true);
      this.app.startConfiguredMatchFromUI(true);
      this.app.confirmPlayAndStartMatch();
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
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy Link';
          }, 1800);
        }
      } catch {
        if (copyBtn) copyBtn.textContent = 'Select Link';
      }
    });

    document.getElementById('setting-sensitivity')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.app.batting.sensitivity = val;
      gameConfig.sensitivity = val;
      saveGameConfig();
      const lbl = document.getElementById('lbl-sensitivity-val');
      if (lbl) lbl.textContent = `${val.toFixed(1)}x`;
    });

    // Difficulty selectors (Settings & Match Setup Cards stay in sync and roll a new random chase target in range!)
    const onDifficultyChange = (rawVal) => {
      const norm = normalizeDifficultyKey(rawVal);
      gameConfig.difficulty = norm;
      this.app.match.difficulty = norm;
      this._userRerolledTarget = false;
      saveGameConfig();
      const s1 = document.getElementById('setting-difficulty');
      const s2 = document.getElementById('setup-difficulty');
      if (s1) s1.value = norm;
      if (s2) s2.value = norm;
      this.refreshRunChaseTargetPreview(true);
      this.syncSetupWizardCards();
      sound.playUIClick();
    };
    document.getElementById('setting-difficulty')?.addEventListener('change', (e) => onDifficultyChange(e.target.value));
    document.getElementById('setup-difficulty')?.addEventListener('change', (e) => onDifficultyChange(e.target.value));
    document.querySelectorAll('[data-diff-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        onDifficultyChange(btn.getAttribute('data-diff-card') || 'medium');
      });
    });

    document.getElementById('setting-handedness')?.addEventListener('change', (e) => {
      gameConfig.handedness = e.target.value;
      saveGameConfig();
      if (typeof this.app.setHandedness === 'function') {
        this.app.setHandedness(e.target.value);
      } else {
        this.app.batting.setHandedness(e.target.value);
      }
      const setupHand = document.getElementById('setup-handedness');
      if (setupHand) setupHand.value = e.target.value;
      this.syncSetupWizardCards();
    });

    document.getElementById('setup-handedness')?.addEventListener('change', (e) => {
      gameConfig.handedness = e.target.value;
      saveGameConfig();
      if (typeof this.app.setHandedness === 'function') {
        this.app.setHandedness(e.target.value);
      } else {
        this.app.batting.setHandedness(e.target.value);
      }
      const settingHand = document.getElementById('setting-handedness');
      if (settingHand) settingHand.value = e.target.value;
      this.syncSetupWizardCards();
    });

    document.getElementById('setting-assist')?.addEventListener('change', (e) => {
      this.app.bowling.assistMode = e.target.value;
      gameConfig.bowlingAssist = e.target.value;
      saveGameConfig();
    });

    document.getElementById('setting-autobowl')?.addEventListener('change', (e) => {
      gameConfig.autoBowl = e.target.value;
      saveGameConfig();
      if (e.target.value !== 'manual' && this.app.physics.state === 'idle') {
        this.app.scheduleAutoBowl(0.8);
      }
    });

    document.getElementById('setting-replays')?.addEventListener('change', (e) => {
      gameConfig.replays = e.target.value;
      saveGameConfig();
      if (typeof this.app.setReplaySetting === 'function') {
        this.app.setReplaySetting(e.target.value);
      }
    });

    document.getElementById('setting-quality')?.addEventListener('change', (e) => {
      gameConfig.graphicsQuality = e.target.value;
      saveGameConfig();
      if (typeof this.app.applyGraphicsQualityPreset === 'function') {
        this.app.applyGraphicsQualityPreset(e.target.value);
      }
    });

    document.getElementById('setting-dof')?.addEventListener('change', (e) => {
      this.app.dofEnabled = e.target.value === 'on' || e.target.checked === true;
      gameConfig.dofEnabled = this.app.dofEnabled;
      saveGameConfig();
      if (this.app.bokehPass) {
        this.app.bokehPass.enabled = Boolean(this.app.dofEnabled && this.app.qualityPreset !== 'low');
      }
    });

    document.getElementById('setting-resolution')?.addEventListener('change', (e) => {
      this.app.applyGraphicsSettings(e.target.value, document.getElementById('setting-fps')?.value || '60');
    });

    document.getElementById('setting-fps')?.addEventListener('change', (e) => {
      this.app.applyGraphicsSettings(document.getElementById('setting-resolution')?.value || '1080p', e.target.value);
    });

    document.getElementById('setting-ui-size')?.addEventListener('change', (e) => {
      this.setUISize(e.target.value);
    });

    document.getElementById('setting-lang')?.addEventListener('change', (e) => {
      this.lang = e.target.value;
      this.updateLanguageLabels();
      this.populateBowlingVariationSelect();
      this.updateHUD();
    });

    // Audio Mixer sliders (Master, Effects, Crowd, Music, Commentary) + Mute toggle
    document.getElementById('setting-sound')?.addEventListener('change', (e) => {
      this.app.setSoundEnabled(e.target.checked);
    });

    const mixerChannels = ['master', 'effects', 'crowd', 'music', 'commentary'];
    mixerChannels.forEach((ch) => {
      const slider = document.getElementById(`slider-vol-${ch}`);
      const lbl = document.getElementById(`lbl-vol-${ch}`);
      slider?.addEventListener('input', (e) => {
        const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
        if (lbl) lbl.textContent = `${pct}%`;
        sound.setMixerLevels({ [ch]: pct / 100 });
      });
    });

    // Commentary Settings (Captions and Spoken TTS are 100% independent!)
    document.getElementById('setting-comm-enabled')?.addEventListener('change', (e) => {
      const captionsOn = Boolean(e.target.checked);
      commentary.setSettings({ enabled: captionsOn });
      if (!captionsOn) {
        const capBox = document.getElementById('hud-commentary-caption');
        if (capBox) {
          capBox.classList.remove('opacity-100');
          capBox.classList.add('opacity-0');
        }
      }
    });
    document.getElementById('setting-comm-spoken')?.addEventListener('change', (e) => {
      commentary.setSettings({ spoken: Boolean(e.target.checked) });
      if (!e.target.checked) {
        commentary.stopSpeech();
      }
    });
    document.getElementById('setting-comm-lang')?.addEventListener('change', (e) => {
      commentary.setSettings({ language: e.target.value, voiceURI: 'auto' });
      this.populateSpeechVoicesSelect();
    });
    document.getElementById('setting-comm-freq')?.addEventListener('change', (e) => {
      commentary.setSettings({ frequency: e.target.value });
    });
    document.getElementById('setting-comm-voice')?.addEventListener('change', (e) => {
      commentary.setSettings({ voiceURI: e.target.value });
    });
    document.getElementById('btn-test-comm-voice')?.addEventListener('click', () => {
      sound.init();
      commentary.setSettings({ spoken: true });
      const commSp = document.getElementById('setting-comm-spoken');
      if (commSp) commSp.checked = true;
      commentary.trigger('six', {
        batsman: this.app.match.getActiveStriker()?.name || 'Sharma',
        bowler: this.app.match.getActiveBowler()?.name || 'Rao',
        shot: 'huge six over long-on',
        __testVoicePreview: true
      }, true);
    });
  }

  toggleDock() {
    this.dockCollapsed = !this.dockCollapsed;
    const body = document.getElementById('bottom-dock-body');
    if (body) body.classList.toggle('hidden', this.dockCollapsed);
  }

  updateLanguageLabels() {
    const setTxt = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.textContent = this.t(key);
    };
    setTxt('lbl-overs-title', 'overs');
    setTxt('lbl-crr-title', 'crr');
    setTxt('lbl-speed-title', 'speed');
    setTxt('lbl-timing-title', 'timing');
    setTxt('lbl-corner-menu', 'menu');
  }

  /**
   * Updates the Small Shot Type Indicator Icon inside the Broadcast Bar & Bottom Dock GROUND / FLY buttons
   */
  updateShotModeHUD() {
    const batting = this.app.batting;
    const isGround = batting.shotMode === 'ground';
    const isFly = batting.shotMode === 'fly';
    const isDefend = batting.shotMode === 'defend';
    const isLocked = batting.modeLocked;

    const glyphEl = document.getElementById('hud-shot-mode-glyph');
    const iconEl = document.getElementById('hud-shot-mode-icon');
    const lockEl = document.getElementById('hud-shot-mode-lock');

    if (glyphEl) {
      glyphEl.textContent = isDefend ? '🛡' : isGround ? '→' : '↗';
      glyphEl.className = `text-[11px] leading-none ${
        isDefend ? 'text-sky-400' : isGround ? 'text-emerald-400' : 'text-amber-400'
      }`;
    }
    if (iconEl) {
      iconEl.textContent = isDefend ? 'DEFEND' : isGround ? 'GROUND' : 'LOFT';
      iconEl.className = `font-display text-[10px] sm:text-[11px] font-bold ${
        isDefend ? 'text-sky-400' : isGround ? 'text-emerald-400' : 'text-amber-400'
      }`;
    }
    if (lockEl) {
      lockEl.textContent = isLocked ? '🔒' : '🔓';
      lockEl.className = `font-mono text-[9px] ${isLocked ? 'text-amber-400' : 'text-slate-400'}`;
    }

    const btnGround = document.getElementById('btn-hud-ground');
    const btnFly = document.getElementById('btn-hud-fly');
    if (btnGround && btnFly) {
      btnGround.className = `px-2.5 py-1 text-[11px] font-bold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
        isGround ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
      } ${isLocked ? 'opacity-60' : ''}`;

      btnFly.className = `px-2.5 py-1 text-[11px] font-bold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
        isFly ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:text-white'
      } ${isLocked ? 'opacity-60' : ''}`;
    }

    const vpadModeBtn = document.getElementById('btn-vpad-mode');
    if (vpadModeBtn) {
      vpadModeBtn.textContent = isDefend ? 'DEFEND' : isGround ? 'GROUND' : 'LOFT';
      vpadModeBtn.className = `px-2.5 py-1 rounded-lg font-display font-extrabold text-[11px] shadow-lg cursor-pointer active:scale-95 transition-transform ${
        isDefend
          ? 'bg-sky-400 text-slate-950'
          : isGround
            ? 'bg-emerald-500 text-slate-950'
            : 'bg-amber-400 text-slate-950'
      } ${isLocked ? 'opacity-60' : ''}`;
    }
  }

  /**
   * Updates the Live Running Step-Cadence Bar while ball is in play
   */
  updateRunningBar(state = {}) {
    const bar = document.getElementById('hud-running-bar');
    if (!bar) return;
    if (!state.active) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');

    const fillEl = document.getElementById('hud-run-fill');
    const stepsEl = document.getElementById('hud-run-steps');
    const cadEl = document.getElementById('hud-run-cadence');
    const countEl = document.getElementById('hud-run-count');

    const progressPct = Math.min(100, Math.round((state.progress || 0) * 100));
    const b = this.app.batting;
    const stepsInRun = Math.min(20, b?.accumulatedStepsThisRun || Math.round((state.progress || 0) * 20));
    if (fillEl) {
      fillEl.style.width = `${progressPct}%`;
      fillEl.className = `h-full transition-all duration-75 ${
        state.returning ? 'bg-amber-400' : state.stoppedMidPitch ? 'bg-red-400' : 'bg-emerald-400'
      }`;
    }
    if (stepsEl) {
      stepsEl.textContent = state.returning
        ? '🛑 RETURNING'
        : this.app.runnersInMotion
          ? `🏃 SPRINT (${progressPct}%)`
          : 'IN CREASE';
    }
    if (cadEl) {
      const cad = state.cadenceHz ?? b?.cadenceSps ?? 0;
      cadEl.textContent = `${cad.toFixed(1)}/s`;
    }
    if (countEl) {
      const r = state.runsCompleted ?? this.app.runsCompletedThisBall ?? 0;
      countEl.textContent = `${r} RUN${r === 1 ? '' : 'S'}`;
    }

    const callEl = document.getElementById('hud-run-call');
    if (callEl) {
      const risk = state.riskLevel || this.app.runRiskLevel || 'safe';
      if (risk === 'danger') {
        callEl.textContent = '🔴 DANGER · NO RUN!';
        callEl.className =
          'px-2 py-0.5 rounded bg-rose-500/30 border border-rose-400 text-rose-200 font-bold text-[10px] tracking-wide whitespace-nowrap animate-pulse';
      } else if (risk === 'tight') {
        callEl.textContent = '🟡 TIGHT SINGLE';
        callEl.className =
          'px-2 py-0.5 rounded bg-amber-500/25 border border-amber-400/70 text-amber-200 font-bold text-[10px] tracking-wide whitespace-nowrap';
      } else {
        callEl.textContent = '🟢 SAFE RUN';
        callEl.className =
          'px-2 py-0.5 rounded bg-emerald-500/25 border border-emerald-400/60 text-emerald-300 font-bold text-[10px] tracking-wide whitespace-nowrap';
      }
    }
  }

  updateRunningHUD() {
    const b = this.app.batting;
    const isActive = Boolean(
      b?.runWindowActive ||
      this.app.runnersInMotion ||
      this.app.runnerStoppedMidPitch
    );
    this.updateRunningBar({
      active: isActive,
      runsCompleted: this.app.runsCompletedThisBall || 0,
      progress: this.app.runnerProgress || 0,
      cadenceHz: b?.cadenceSps || 0,
      returning: this.app.runnerReturning || false,
      stoppedMidPitch: this.app.runnerStoppedMidPitch || false,
      riskLevel: this.app.runRiskLevel || 'safe'
    });
  }

  /**
   * Updates the On-Screen Sensor & Shot Debug Panel (toggled with D key)
   */
  updateDebugPanel() {
    if (!this.debugVisible) return;
    const b = this.app.batting;
    const c = b.lastContact;

    const modeEl = document.getElementById('dbg-mode');
    if (modeEl) {
      const planeStr = b.isRisingSwing ? 'RISING' : 'FLAT';
      const lockStr = b.modeLocked ? ' [LOCKED]' : '';
      const modeName = b.shotMode === 'fly' ? 'LOFT' : b.shotMode === 'defend' ? 'DEFEND' : 'GROUND';
      modeEl.textContent = `${modeName} · ${planeStr}${lockStr}`;
      modeEl.className =
        b.shotMode === 'fly'
          ? 'text-amber-400 font-bold'
          : b.shotMode === 'defend'
            ? 'text-sky-400 font-bold'
            : 'text-emerald-400 font-bold';
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

    const dirEl = document.getElementById('dbg-shot-dir');
    if (dirEl) {
      const deg = c.shotDirectionDeg ?? b.swingDirectionDeg ?? 0;
      const sign = deg > 0 ? '+' : '';
      const shortShot = (c.shotNameEn || b.activeShotType?.nameEn || 'STRAIGHT').replace(' SHOT', '').replace(' DRIVE', '');
      dirEl.textContent = `${sign}${deg}° · ${shortShot}`;
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

    const runEl = document.getElementById('dbg-run-steps');
    if (runEl) {
      runEl.textContent = `${b.accumulatedStepsThisRun}/20 · ${(b.cadenceSps || 0).toFixed(1)}/s`;
    }
  }

  updateSensorDebugPanel() {
    this.updateDebugPanel();
  }

  updateHUD() {
    const match = this.app.match;
    const batting = this.app.batting;
    const bowling = this.app.bowling;

    // 1. Reference-style Team Chips + Score/Wickets
    const batShort = match.battingTeam.short;
    const bowlShort = match.bowlingTeam.short;
    const batChipEl = document.getElementById('hud-team-chip-bat');
    const bowlChipEl = document.getElementById('hud-team-chip-bowl');
    if (batChipEl) {
      batChipEl.textContent = batShort;
      if (match.battingTeam.primary) {
        batChipEl.style.backgroundColor = match.battingTeam.primary;
        batChipEl.style.color = '#ffffff';
        batChipEl.style.textShadow = '0 1px 2px rgba(0,0,0,0.85)';
      }
    }
    if (bowlChipEl) {
      bowlChipEl.textContent = bowlShort;
    }
    const scoreEl = document.getElementById('hud-score');
    if (scoreEl) {
      scoreEl.textContent = `${match.runs}/${match.wickets}`;
    }

    // Powerplay / Free Hit compact badge + Persistent Glowing Free Hit Top Pill (Bug #4 Fix)
    const flagsEl = document.getElementById('hud-match-flags');
    const freeHitPill = document.getElementById('hud-free-hit-pill');
    if (freeHitPill) {
      freeHitPill.classList.toggle('hidden', !match.freeHit);
    }
    if (flagsEl) {
      if (match.freeHit) {
        flagsEl.textContent = '🔥 FREE HIT';
        flagsEl.className =
          'px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-rose-500 text-slate-950 font-mono text-[8px] font-black uppercase tracking-wider shadow animate-pulse';
        flagsEl.classList.remove('hidden');
      } else if (match.isPowerplayActive()) {
        flagsEl.textContent = 'PP';
        flagsEl.className =
          'px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-mono text-[8px] font-bold uppercase tracking-wider';
        flagsEl.classList.remove('hidden');
      } else {
        flagsEl.classList.add('hidden');
      }
    }

    // 2. Overs
    const oversEl = document.getElementById('hud-overs');
    if (oversEl) {
      oversEl.textContent = `${match.getOversFormatted()}/${match.totalOvers}`;
    }

    // 3. Target or situation text ("NEED 54 (46b)" in 2nd innings, or run rate in 1st innings)
    const crrEl = document.getElementById('hud-crr');
    if (crrEl) {
      if (match.innings === 2 && match.firstInningsScore !== null) {
        const target = match.firstInningsScore + 1;
        const needRuns = Math.max(0, target - match.runs);
        const remBalls = Math.max(0, match.totalOvers * 6 - match.legalBalls);
        crrEl.textContent = `NEED ${needRuns} (${remBalls}b)`;
      } else {
        crrEl.textContent = `RR ${match.getCurrentRunRate()}`;
      }
    }

    // 4. Batsmen: Striker (with small bat icon) and Non-Striker
    const striker = match.getActiveStriker();
    const nonStriker = match.getActiveNonStriker();
    const strikerEl = document.getElementById('hud-striker');
    const nonStrikerEl = document.getElementById('hud-nonstriker');
    if (strikerEl && striker) {
      strikerEl.textContent = `${shortSurname(striker.name)} ${striker.runs}(${striker.balls})`;
    }
    if (nonStrikerEl && nonStriker) {
      nonStrikerEl.textContent = `${shortSurname(nonStriker.name)} ${nonStriker.runs}(${nonStriker.balls})`;
    }

    // 5. Bowler with figures, rhythm/confidence icon, and last 6 balls as circular badges
    const bowler = match.getActiveBowler();
    const bowlerEl = document.getElementById('hud-bowler');
    if (bowlerEl && bowler) {
      const bOvers = `${Math.floor(bowler.balls / 6)}.${bowler.balls % 6}`;
      const conf = bowler.confidence ?? 70;
      const rhythmBadge = conf >= 82 ? '⚡' : conf <= 42 ? '💦' : '';
      bowlerEl.textContent = `${rhythmBadge}${shortSurname(bowler.name)} ${bowler.wickets}-${bowler.runs} (${bOvers})`;
      bowlerEl.title = `Bowler Rhythm: ${Math.round(conf)}% · Stamina: ${Math.round(bowler.stamina ?? 100)}%`;
    }

    const isBowlRole = match.userRole === 'bowl';
    const vpadSwingLbl = document.getElementById('lbl-vpad-swing');
    const vpadSwingSub = document.getElementById('sub-vpad-swing');
    const vpadLoftSub = document.getElementById('sub-vpad-loft');
    const vpadDefLbl = document.getElementById('lbl-vpad-defend');
    const vpadDefSub = document.getElementById('sub-vpad-defend');
    const vpadPushLbl = document.getElementById('lbl-vpad-push');
    const vpadPushSub = document.getElementById('sub-vpad-push');

    if (vpadSwingLbl) vpadSwingLbl.textContent = isBowlRole ? 'BOWL' : 'STROKE';
    if (vpadSwingSub) vpadSwingSub.textContent = isBowlRole ? 'RELEASE' : 'DRIVE · 4';
    if (vpadLoftSub) vpadLoftSub.textContent = isBowlRole ? 'VARIATION' : 'SIX · POWER';
    if (vpadDefLbl) vpadDefLbl.textContent = isBowlRole ? '🔄 SIDE' : '🛡️ DEF';
    if (vpadDefSub) vpadDefSub.textContent = isBowlRole ? (bowling.bowlerSide === 'around' ? 'AROUND' : 'OVER') : 'BLOCK';
    if (vpadPushLbl) vpadPushLbl.textContent = isBowlRole ? '🛡️ FIELD' : '⚡ PUSH';
    if (vpadPushSub) vpadPushSub.textContent = isBowlRole ? (this.app.fielding?.setting || 'BAL').toUpperCase().slice(0, 5) : 'GAP 1s';

    const fieldPresetSel = document.getElementById('select-field-preset');
    if (fieldPresetSel && this.app.fielding) {
      if (fieldPresetSel.value !== this.app.fielding.setting) {
        fieldPresetSel.value = this.app.fielding.setting;
      }
      fieldPresetSel.title = 'Select Fielding Preset';
      fieldPresetSel.classList.remove('opacity-70');
    }

    this.updateCreaseIndicatorUI();

    const dotsContainer = document.getElementById('hud-over-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      const balls = match.currentOverBalls.slice(-6);
      for (let i = 0; i < 6; i++) {
        const val = balls[i];
        const span = document.createElement('span');
        span.className =
          'inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-mono font-extrabold tabular-nums shadow-sm ';
        if (!val) {
          span.className += 'bg-slate-900/90 text-slate-600 border border-slate-700/80';
          span.textContent = '•';
        } else if (val === 'W' || String(val).includes('W')) {
          span.className += 'bg-rose-600 text-white border border-rose-300/80 shadow-[0_0_6px_rgba(225,29,72,0.6)]';
          span.textContent = 'W';
        } else if (val === '6' || String(val).includes('6')) {
          span.className += 'bg-amber-400 text-slate-950 border border-amber-200 shadow-[0_0_6px_rgba(251,191,36,0.6)]';
          span.textContent = val;
        } else if (val === '4' || String(val).includes('4')) {
          span.className += 'bg-emerald-400 text-slate-950 border border-emerald-200';
          span.textContent = val;
        } else if (val === '0' || val === '·') {
          span.className += 'bg-slate-800 text-slate-400 border border-slate-600/70';
          span.textContent = '•';
        } else {
          span.className += 'bg-sky-500/30 text-sky-200 border border-sky-400/60';
          span.textContent = val;
        }
        dotsContainer.appendChild(span);
      }
    }

    const speedEl = document.getElementById('hud-speed');
    if (speedEl) {
      speedEl.textContent = `${bowling.lastDelivery.speedKmh.toFixed(0)} km/h`;
    }

    const pitchWearEl = document.getElementById('hud-pitch-wear');
    const ballPhys = this.app.ball || this.app.physics;
    if (pitchWearEl && ballPhys) {
      const profile =
        typeof ballPhys.getPitchProfile === 'function'
          ? ballPhys.getPitchProfile()
          : typeof ballPhys.getActiveProfile === 'function'
            ? ballPhys.getActiveProfile()
            : { nameEn: 'Balanced' };
      const wearPct = Math.round((ballPhys.pitchWear || 0.05) * 100);
      const label = profile.labelEn || profile.nameEn || 'Balanced';
      const shortName = label.split(' ')[0];
      const rpm = ballPhys.spinRpm || Math.round(bowling.lastDelivery?.spinRpm || 1350);
      pitchWearEl.textContent = `Pitch: ${shortName} · Wear ${wearPct}% · Spin ${rpm} rpm`;
    }

    // Transient Timing Meter (centered Early <-> Perfect <-> Late needle for ~1.5s after each shot)
    const offsetMs = Number(batting.lastContact.timingOffsetMs) || 0;
    const timingEl = document.getElementById('hud-timing');
    if (timingEl) {
      const label = this.lang === 'hi' ? batting.lastContact.timingLabelHi : batting.lastContact.timingLabelEn;
      const msSign = offsetMs > 0 ? '+' : '';
      const msTag = batting.lastContact.didHit ? `${msSign}${offsetMs}ms` : `${batting.lastContact.launchAngleDeg}°`;
      timingEl.textContent = `${label.split(' ')[0]} · ${msTag}`;
    }

    const timingBar = document.getElementById('hud-timing-bar');
    if (timingBar) {
      // 0ms = 50% (Sweet Spot Center), -240ms = 8% (Early), +240ms = 92% (Late)
      const normOffset = Math.max(-1, Math.min(1, offsetMs / 240));
      const needleLeftPct = Math.round(50 + normOffset * 42);
      timingBar.style.left = `${needleLeftPct}%`;
    }

    if (batting.shotExecutedThisBall && !this.wasShotExecutedLastCheck) {
      this.showTimingToast();
    }
    this.wasShotExecutedLastCheck = Boolean(batting.shotExecutedThisBall);

    // Update ON FIRE / Power Surge Streak Badge & Career Rank Badge in Broadcast Bar
    const streakEl = document.getElementById('hud-streak-chip');
    if (streakEl && batting) {
      const onFire = typeof batting.isOnFire === 'function' && batting.isOnFire();
      if (onFire) {
        streakEl.textContent = `🔥 ON FIRE (${batting.onFireBallsLeft}B)`;
        streakEl.className =
          'px-2 py-0.5 rounded bg-gradient-to-r from-amber-500 to-rose-500 border border-amber-200 text-[10px] font-mono font-extrabold text-slate-950 whitespace-nowrap shadow-md animate-pulse';
      } else {
        const cnt = batting.streakCount || 0;
        streakEl.textContent = `🔥 ${cnt}/3`;
        streakEl.className = `px-2 py-0.5 rounded border text-[10px] font-mono font-bold whitespace-nowrap transition-all ${
          cnt >= 2
            ? 'bg-amber-500/20 border-amber-400 text-amber-300'
            : 'bg-slate-800/90 border-slate-700 text-slate-300'
        }`;
      }
    }

    this.updateShotModeHUD();
    this.updateRunningHUD();
    this.renderFieldRadar();
    this.syncPhoneMatchHUD();
  }

  syncPhoneMatchHUD() {
    if (!this.app?.net) return;
    const match = this.app.match;
    const batting = this.app.batting;
    const batShort = match.battingTeam.short;
    const bowlShort = match.bowlingTeam.short;
    const scoreText = `${batShort} v ${bowlShort} ${match.runs}/${match.wickets} (${match.getOversFormatted()})`;
    let needText = `CRR ${match.getCurrentRunRate()}`;
    if (match.innings === 2 && match.firstInningsScore !== null) {
      const needRuns = Math.max(0, match.firstInningsScore + 1 - match.runs);
      const remBalls = Math.max(0, match.totalOvers * 6 - match.legalBalls);
      needText = `NEED ${needRuns} (${remBalls}b)`;
    }
    const pState = this.app.physics?.state || 'idle';
    const ballStatus =
      pState === 'bowled'
        ? 'SWING NOW!'
        : pState === 'runup'
          ? 'BOWLER IN...'
          : pState === 'hit' || pState === 'fielded'
            ? 'BALL IN PLAY · RUN!'
            : 'READY';
    const onFire = typeof batting?.isOnFire === 'function' && batting.isOnFire();
    const streakText = onFire
      ? `🔥 ON FIRE (${batting.onFireBallsLeft}B)`
      : `🔥 ${batting?.streakCount || 0}/3`;
    const gateState = !this.app.matchPlayConfirmed
      ? 'waiting_play'
      : match.isMatchOver
        ? 'match_over'
        : 'playing';
    const drsPromptEl = document.getElementById('hud-drs-prompt');
    const drsAvailable = Boolean(
      drsPromptEl &&
      !drsPromptEl.classList.contains('hidden') &&
      !this.app.drsActive &&
      this.app.lastDRSCandidate &&
      (match.drsReviewsRemaining ?? 0) > 0
    );
    const qteActive = Boolean(this.app.qteActive);
    const squadOpen = !document.getElementById('modal-squad-select')?.classList.contains('hidden');
    const wagonOpen = !document.getElementById('hud-over-wagon-popup')?.classList.contains('hidden');
    const scorecardOpen = !document.getElementById('modal-scorecard')?.classList.contains('hidden');
    const activeModal = squadOpen
      ? 'squad'
      : wagonOpen
        ? 'wagon'
        : scorecardOpen
          ? 'scorecard'
          : null;

    const dirSign = batting?.screenRightSign || -1;
    const fielders = [];
    if (this.app.fielding?.fielders) {
      this.app.fielding.fielders.forEach((f) => {
        fielders.push([Math.round(f.pos.x * 10) / 10, Math.round(f.pos.z * 10) / 10]);
      });
    }
    if (this.app.fielding?.keeper) {
      fielders.push([
        Math.round(this.app.fielding.keeper.pos.x * 10) / 10,
        Math.round(this.app.fielding.keeper.pos.z * 10) / 10
      ]);
    }

    let lastShotFeedback = '';
    if (batting?.shotExecutedThisBall && batting?.lastContact) {
      const lc = batting.lastContact;
      if (lc.didHit) {
        lastShotFeedback = `🏏 ${lc.timingLabelEn} · ${lc.exitSpeedKmh} km/h · ${lc.shotNameEn}`;
      } else {
        lastShotFeedback = `⚠️ ${lc.timingLabelEn} (${lc.timingOffsetMs > 0 ? 'Late' : 'Early'})`;
      }
    }

    const payload = {
      scoreText,
      needText,
      ballStatus,
      userRole: match.userRole || 'bat',
      streakText,
      isOnFire: onFire,
      gateState,
      aimDeg: Math.round(batting?.custom360AimDeg || 0),
      wheelLocked: Boolean(batting?.wheelAimLockedThisBall),
      shotMode: batting?.shotMode || 'ground',
      footwork: batting?.footwork || 'front',
      stepOutCharge: Boolean(batting?.stepOutCharge),
      isFreeHit: Boolean(match.freeHit),
      dirSign,
      handedness: batting?.handedness || 'right',
      cameraMode: this.app?.cameraMode === 'follow' ? (this.app?.savedCameraMode || 'pro') : (this.app?.cameraMode || 'pro'),
      drsAvailable,
      qteActive,
      activeModal,
      lastShotFeedback,
      fielders
    };
    const sig = JSON.stringify(payload);
    if (this._lastPhoneHudSig === sig) return;
    this._lastPhoneHudSig = sig;
    this.app.net.syncMatchStateToControllers(payload);
  }

  /**
   * Renders the Live 2D Field Radar (Mini-Map) in the top-left corner of the HUD
   */
  renderFieldRadar() {
    const canvas = document.getElementById('hud-field-radar');
    if (!canvas || !this.app?.fielding) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 4;
    const maxFieldRadius = 60.0;
    const dirSign = this.app.batting?.screenRightSign || -1;

    ctx.clearRect(0, 0, w, h);

    // 1. Outfield turf circle & boundary rope
    ctx.fillStyle = '#064e3b';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#10b981';
    ctx.stroke();

    // 2. 30-yard inner circle
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Pitch strip in the center
    ctx.fillStyle = '#d6b88a';
    ctx.fillRect(cx - 2.5, cy - 8, 5, 16);

    // Helper to convert 3D world (x, z) to 2D Radar coordinates matching active camera orientation (Option B TV Cam & Option A Batsman View)
    const toRadarXY = (wx, wz) => {
      const rx = cx + ((wx * dirSign) / maxFieldRadius) * radius;
      const ry = cy + ((wz * dirSign) / maxFieldRadius) * radius;
      return [rx, ry];
    };

    // 3b. Draw Selected 360° Angle Wheel Aim Line & Wedge on Top-Left Radar (Display-Only Mini-Map)
    if (this.app.match?.userRole !== 'bowl' && this.app.batting) {
      const b = this.app.batting;
      const rawYaw = b.swingPlaneYaw || 0;
      const maxSnapDeg =
        typeof b.getGapSnapLimitDeg === 'function'
          ? b.getGapSnapLimitDeg(this.app.match?.difficulty || 'pro')
          : 3;
      const effectiveYaw =
        b.shotAssistGapSnap && typeof b.computeGapSnappedYaw === 'function'
          ? b.computeGapSnappedYaw(rawYaw, this.app.fielding.fielders, maxSnapDeg)
          : rawYaw;
      const screenAngleRad = effectiveYaw * dirSign;
      const dxScreen = Math.sin(screenAngleRad);
      const dyScreen = -dirSign * Math.cos(screenAngleRad);
      const canvasAngle = Math.atan2(dyScreen, dxScreen);
      const wedgeSpread = (11 * Math.PI) / 180;
      const pivotY = dirSign > 0 ? cy + 4 : cy - 4;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, pivotY);
      ctx.arc(cx, pivotY, radius - 2, canvasAngle - wedgeSpread, canvasAngle + wedgeSpread);
      ctx.closePath();
      ctx.fillStyle = b.shotMode === 'fly' ? 'rgba(245, 158, 11, 0.24)' : 'rgba(52, 211, 153, 0.24)';
      ctx.fill();

      const tipX = cx + dxScreen * (radius - 2);
      const tipY = pivotY + dyScreen * (radius - 2);
      ctx.beginPath();
      ctx.moveTo(cx, pivotY);
      ctx.lineTo(tipX, tipY);
      ctx.strokeStyle = b.shotMode === 'fly' ? 'rgba(251, 191, 36, 0.92)' : 'rgba(52, 211, 153, 0.92)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    // 4. Draw 9 Fielders + Wicketkeeper
    ctx.fillStyle = '#38bdf8';
    this.app.fielding.fielders.forEach((f) => {
      const [fx, fy] = toRadarXY(f.pos.x, f.pos.z);
      ctx.beginPath();
      ctx.arc(fx, fy, 2.3, 0, Math.PI * 2);
      ctx.fill();
    });

    if (this.app.fielding.keeper) {
      const [kx, ky] = toRadarXY(this.app.fielding.keeper.pos.x, this.app.fielding.keeper.pos.z);
      ctx.fillStyle = '#a7f3d0';
      ctx.beginPath();
      ctx.arc(kx, ky, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Draw Live Striker (Gold dot) & Non-Striker (Orange/Emerald dot) moving along the pitch
    const strikerX = this.app.batting?.creaseX || 0;
    const strikerZ =
      typeof this.app.strikerMeshZ === 'number'
        ? this.app.strikerMeshZ
        : this.app.strikerMesh?.position?.z ?? 8.8;
    const nonStrikerX = -0.75;
    const nonStrikerZ =
      typeof this.app.nonStrikerMeshZ === 'number'
        ? this.app.nonStrikerMeshZ
        : this.app.nonStrikerMesh?.position?.z ?? -8.5;

    const [sx, sy] = toRadarXY(strikerX, strikerZ);
    const [nsx, nsy] = toRadarXY(nonStrikerX, nonStrikerZ);

    // If batsmen are actively running between wickets, draw a live motion trail line on the pitch
    if (this.app.runnersInMotion) {
      ctx.save();
      ctx.strokeStyle = this.app.runnerReturning ? 'rgba(244, 63, 94, 0.85)' : 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 1.5]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(nsx, nsy);
      ctx.stroke();
      ctx.restore();
    }

    // Non-Striker dot
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.arc(nsx, nsy, this.app.runnersInMotion ? 2.6 : 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Striker dot (Gold with crisp dark outline)
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(sx, sy, this.app.runnersInMotion ? 3.1 : 2.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#090f1d';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // 6. Draw Live Ball (White/Red glowing dot)
    if (this.app.physics && this.app.physics.state !== 'idle') {
      const [bx, by] = toRadarXY(this.app.physics.pos.x, this.app.physics.pos.z);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(bx, by, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const presetEl = document.getElementById('hud-radar-preset');
    if (presetEl && this.app.fielding.setting) {
      presetEl.textContent = this.app.fielding.setting.toUpperCase().slice(0, 6);
    }
  }

  /**
   * Opens Squad Selection Modal for picking Next Batsman (after Wicket) or Next Bowler (after Over)
   */
  openSquadSelectionModal(type = 'batsman') {
    const match = this.app.match;
    if (match.isMatchOver) return;
    const titleEl = document.getElementById('title-modal-squad');
    const subEl = document.getElementById('sub-modal-squad');
    const listEl = document.getElementById('squad-select-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (type === 'batsman') {
      const available = match.getAvailableBatsmen();
      const currentStriker = match.getActiveStriker();
      if (titleEl) titleEl.textContent = 'Wicket Fell · Select Next Batsman';
      if (subEl) subEl.textContent = `${match.battingTeam.nameEn} (${match.runs}/${match.wickets}) · Pick incoming batter`;

      const candidates = currentStriker && !currentStriker.isOut ? [currentStriker, ...available] : available;
      if (candidates.length === 0) return;

      candidates.forEach((player, idx) => {
        const isCurrent = player.index === match.strikerIndex;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
          isCurrent
            ? 'bg-amber-400/20 border-amber-400 text-white font-bold'
            : 'bg-slate-950 hover:bg-slate-900 border-slate-800 text-slate-200'
        }`;
        btn.innerHTML = `
          <div>
            <span class="font-display font-bold text-xs">${player.name}</span>
            <span class="text-[10px] text-slate-400 ml-1.5">#${player.index + 1}</span>
          </div>
          <span class="font-mono text-[10px] ${isCurrent ? 'text-amber-300' : 'text-emerald-400'}">
            ${isCurrent ? 'READY *' : 'Send In →'}
          </span>
        `;
        btn.addEventListener('click', () => {
          sound.playUIClick();
          match.selectNextBatsman(player.index);
          this.app.rebuildTeamCharacters();
          this.updateHUD();
          this.closeModal('modal-squad-select');
        });
        listEl.appendChild(btn);
      });
      this.openModal('modal-squad-select');
    } else if (type === 'bowler') {
      const available = match.getAvailableBowlers();
      if (available.length === 0) return;
      if (titleEl) titleEl.textContent = `End of Over ${Math.floor(match.legalBalls / 6)} · Select Next Bowler`;
      if (subEl) subEl.textContent = `${match.bowlingTeam.nameEn} · Max ${match.bowlerMaxOvers} overs per bowler`;

      available.forEach((b) => {
        const isCurrent = b.rosterIndex === match.currentBowlerIndex;
        const bOvers = `${Math.floor(b.balls / 6)}.${b.balls % 6}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
          isCurrent
            ? 'bg-sky-500/20 border-sky-400 text-white font-bold'
            : 'bg-slate-950 hover:bg-slate-900 border-slate-800 text-slate-200'
        }`;
        btn.innerHTML = `
          <div>
            <span class="font-display font-bold text-xs">${b.name}</span>
            <span class="font-mono text-[10px] text-slate-400 ml-2">${b.wickets}-${b.runs} (${bOvers} Ov)</span>
          </div>
          <span class="font-mono text-[10px] ${isCurrent ? 'text-sky-300' : 'text-emerald-400'}">
            ${isCurrent ? 'SELECTED' : 'Bowl Next →'}
          </span>
        `;
        btn.addEventListener('click', () => {
          sound.playUIClick();
          match.selectNextBowler(b.rosterIndex);
          this.app.rebuildTeamCharacters();
          this.updateHUD();
          this.closeModal('modal-squad-select');
        });
        listEl.appendChild(btn);
      });
      this.openModal('modal-squad-select');
    }

    if (this.squadAutoSelectTimer) clearTimeout(this.squadAutoSelectTimer);
    this.squadAutoSelectTimer = setTimeout(() => {
      const sqModal = document.getElementById('modal-squad-select');
      if (sqModal && !sqModal.classList.contains('hidden')) {
        const autoBtn = document.getElementById('btn-squad-auto');
        if (autoBtn) {
          autoBtn.click();
        } else {
          this.closeModal('modal-squad-select');
        }
      }
    }, 4500);
  }

  updateLivePhoneTelemetry(omegaDeg, footwork, p1Connected, latencyMs) {
    this.onPhoneConnectionChange(Boolean(p1Connected), latencyMs);

    const now = performance.now();
    if (now - (this._lastTelemetryDomMs || 0) < 110) {
      return;
    }
    this._lastTelemetryDomMs = now;

    const phoneBadge = document.getElementById('hud-phone-status');
    if (phoneBadge) {
      if (p1Connected) {
        phoneBadge.textContent = `Phone (${latencyMs}ms) · ${Math.round(omegaDeg)}°/s · ${footwork.toUpperCase()}`;
        phoneBadge.className = 'text-emerald-400';
      } else {
        phoneBadge.textContent = `Room ${this.app.net.roomCode}`;
        phoneBadge.className = 'text-slate-400';
      }
    }

    const qrLiveStatus = document.getElementById('qr-live-status');
    if (qrLiveStatus) {
      if (p1Connected) {
        qrLiveStatus.textContent = `Connected (${latencyMs}ms)`;
        qrLiveStatus.className = 'text-[11px] font-mono font-bold text-emerald-400';
      } else {
        qrLiveStatus.textContent = `Room ${this.app.net.roomCode} · Waiting...`;
        qrLiveStatus.className = 'text-[11px] font-mono font-bold text-amber-400';
      }
    }

    this.updateRunningHUD();
    if (this.app?.physics?.state && this.app.physics.state !== 'idle') {
      this.renderFieldRadar();
    }
    this.updateDebugPanel();
  }

  goToHomeScreen() {
    this._modalCacheTime = 0;
    this._inMenuFlow = true;
    this.toggleCornerMenu(false);
    this.closeAllModals(true);
    if (window.__middledMenu && typeof window.__middledMenu.show === 'function') {
      window.__middledMenu.show();
    } else {
      const mdHome = document.getElementById('md-home');
      if (mdHome) {
        mdHome.classList.remove('md-hidden');
        this.syncVirtualControlsVisibility?.();
        window.__tvDpad?.focusScope?.('md-home', '[data-tv-default]');
      } else {
        this.openModal('modal-setup');
      }
    }
  }

  async toggleFullScreen() {
    try {
      const doc = document;
      const el = doc.documentElement;
      const isFs = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (!isFs) {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
        if (window.screen?.orientation?.lock) {
          window.screen.orientation.lock('landscape').catch(() => {});
        }
        this.showStatusToast('⛶ Full Screen Active', true);
      } else {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          doc.webkitExitFullscreen();
        }
        this.showStatusToast('⛶ Exited Full Screen', true);
      }
    } catch (_) {
      this.showStatusToast('⛶ Full Screen not supported in this frame', true);
    }
  }

  showEventBanner(title, subtitle = '', colorClass = 'text-amber-400') {
    const banner = document.getElementById('hud-event-banner');
    const titleEl = document.getElementById('hud-event-title');
    const subEl = document.getElementById('hud-event-sub');
    if (!banner || !titleEl) return;

    const shortLabel = normalizeShortEventLabel(title);
    titleEl.textContent = shortLabel === 'SIX' ? 'SIX!' : shortLabel === 'FOUR' ? 'FOUR!' : shortLabel;
    titleEl.className = `font-display text-3xl md:text-5xl font-black tracking-widest drop-shadow-[0_4px_18px_rgba(0,0,0,0.85)] ${colorClass}`;
    if (subEl) {
      if (subtitle) {
        subEl.textContent = subtitle;
        subEl.classList.remove('hidden');
      } else {
        subEl.classList.add('hidden');
      }
    }
    banner.classList.remove('opacity-0', 'pointer-events-none', 'scale-90', 'scale-95');
    banner.classList.add('opacity-100', 'scale-105');

    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => {
      banner.classList.add('opacity-0', 'pointer-events-none', 'scale-90');
      banner.classList.remove('opacity-100', 'scale-105');
    }, 1900);
  }

  setCommentary(textEn, textHi = '') {
    const el = document.getElementById('hud-commentary');
    if (!el) return;
    el.textContent = this.lang === 'hi' && textHi ? textHi : textEn;
  }

  isAnyModalOpen() {
    const now = performance.now();
    if (this._modalCacheTime && now - this._modalCacheTime < 75) {
      return this._modalCacheVal;
    }
    this._modalCacheTime = now;
    const mdHome = document.getElementById('md-home');
    if (mdHome && !mdHome.classList.contains('md-hidden')) {
      this._modalCacheVal = true;
      return true;
    }
    const mdModes = document.getElementById('md-modes');
    if (mdModes && !mdModes.classList.contains('md-hidden')) {
      this._modalCacheVal = true;
      return true;
    }
    const ids = [
      'modal-qr',
      'modal-calibrate',
      'modal-setup',
      'modal-squad-select',
      'modal-scorecard',
      'modal-settings',
      'modal-online-1v1',
      'modal-tv-apk',
      'hud-over-wagon-popup',
      'hud-drs-hawkeye-modal'
    ];
    const open = ids.some((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    });
    this._modalCacheVal = open;
    return open;
  }

  openModal(id) {
    this._modalCacheTime = 0;
    this.hideOverWagonWheelPopup?.();
    document.getElementById('md-home')?.classList.add('md-hidden');
    document.getElementById('md-modes')?.classList.add('md-hidden');
    const ids = [
      'modal-qr',
      'modal-calibrate',
      'modal-setup',
      'modal-squad-select',
      'modal-scorecard',
      'modal-settings',
      'modal-online-1v1',
      'modal-tv-apk'
    ];
    ids.forEach((otherId) => {
      if (otherId !== id) {
        document.getElementById(otherId)?.classList.add('hidden');
      }
    });
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('hidden');
      this.activeModalId = id;
      sound.setMenuMusicActive(true);
      try {
        if (window.history && typeof window.history.pushState === 'function') {
          window.history.pushState({ modal: id }, '');
        }
      } catch {}
    }
    this.syncVirtualControlsVisibility();
    this.syncPhoneMatchHUD();
    setTimeout(() => {
      window.__tvDpad?.focusScope?.(id, '[data-tv-default]');
    }, 20);
  }

  closeModal(id, silent = false) {
    this._modalCacheTime = 0;
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
    }
    if (this.activeModalId === id) {
      this.activeModalId = null;
    }
    if (silent) {
      this.syncVirtualControlsVisibility();
      this.syncPhoneMatchHUD();
      return;
    }
    // If dismissed while navigating menu flow or before a match has started, step back cleanly
    if ((!this.app.matchPlayConfirmed || this._inMenuFlow) && !this.isAnyModalOpen()) {
      if (id === 'modal-setup' && window.__middledMenu?.showModes) {
        window.__middledMenu.showModes();
      } else {
        this.goToHomeScreen();
      }
      return;
    }
    if (!this.isAnyModalOpen()) {
      sound.setMenuMusicActive(false);
      if (this.app.matchPlayConfirmed && this.app.physics?.state === 'idle' && !this.app.autoBowlScheduled && !this.app.match?.isMatchOver) {
        this.app.scheduleAutoBowl(1.1);
      }
    }
    this.syncVirtualControlsVisibility();
    this.syncPhoneMatchHUD();
  }

  closeAllModals(silent = false) {
    this._modalCacheTime = 0;
    document.getElementById('md-home')?.classList.add('md-hidden');
    document.getElementById('md-modes')?.classList.add('md-hidden');
    const ids = ['modal-qr', 'modal-calibrate', 'modal-setup', 'modal-squad-select', 'modal-scorecard', 'modal-settings', 'modal-online-1v1', 'modal-tv-apk'];
    ids.forEach((id) => {
      document.getElementById(id)?.classList.add('hidden');
    });
    this.activeModalId = null;
    if (!silent && (!this.app.matchPlayConfirmed || this._inMenuFlow)) {
      this.goToHomeScreen();
      return;
    }
    sound.setMenuMusicActive(false);
    this.syncVirtualControlsVisibility();
  }

  openQRModal() {
    this.renderQRModalContent();
    this.openModal('modal-qr');
  }

  renderQRModalContent() {
    const activeMode = this.app.net.urlMode || 'origin';
    document.querySelectorAll('[data-qr-mode]').forEach((b) => {
      const isAct = b.getAttribute('data-qr-mode') === activeMode;
      b.classList.toggle('bg-amber-400', isAct);
      b.classList.toggle('text-slate-950', isAct);
      b.classList.toggle('text-slate-300', !isAct);
    });

    const urlP1 = this.app.net.getControllerUrl('p1');
    const qrContainer = document.getElementById('qr-svg-container');
    if (qrContainer) {
      const qrSize = window.innerHeight < 460 ? 128 : 168;
      qrContainer.innerHTML = generateQRCodeSVG(urlP1, qrSize);
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

    const resultBadge = document.getElementById('scorecard-match-result');
    if (resultBadge) {
      if (match.isMatchOver && (match.winnerTextEn || match.winnerTextHi)) {
        resultBadge.textContent = this.lang === 'hi' && match.winnerTextHi ? match.winnerTextHi : match.winnerTextEn;
        resultBadge.classList.remove('hidden');
      } else if (match.innings === 2 && match.legalBalls === 0 && match.firstInningsScore !== null) {
        resultBadge.textContent = `INNINGS BREAK · TARGET ${match.firstInningsScore + 1} RUNS`;
        resultBadge.classList.remove('hidden');
      } else {
        resultBadge.classList.add('hidden');
      }
    }

    // Populate 1st Innings vs 2nd Innings Score Summary Strip
    const summaryEl = document.getElementById('scorecard-innings-summary');
    if (summaryEl) {
      if (match.innings === 2 && match.firstInningsScore !== null) {
        const firstTeam = match.firstInningsTeamNameEn || match.bowlingTeam.nameEn;
        const firstOvers = match.firstInningsOvers || `${match.totalOvers}.0`;
        const secondTeam = match.battingTeam.nameEn;
        const target = match.firstInningsScore + 1;
        const statusText = match.isMatchOver
          ? (this.lang === 'hi' && match.winnerTextHi ? match.winnerTextHi : match.winnerTextEn)
          : `Target: ${target} Runs · Need ${Math.max(0, target - match.runs)} off ${Math.max(0, match.totalOvers * 6 - match.legalBalls)} balls`;

        summaryEl.innerHTML = `
          <div class="flex flex-wrap items-center gap-3">
            <div class="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700">
              <span class="text-slate-400 text-[10px] uppercase mr-1">1st Inn:</span>
              <span class="font-display font-bold text-slate-200">${firstTeam}</span>
              <span class="font-mono font-bold text-amber-300 ml-1">${match.firstInningsScore}/${match.firstInningsWickets} (${firstOvers} Ov)</span>
            </div>
            <div class="px-2.5 py-1 rounded-lg bg-slate-900 border border-emerald-500/40">
              <span class="text-slate-400 text-[10px] uppercase mr-1">2nd Inn:</span>
              <span class="font-display font-bold text-white">${secondTeam}</span>
              <span class="font-mono font-bold text-emerald-400 ml-1">${match.runs}/${match.wickets} (${match.getOversFormatted()} Ov)</span>
            </div>
          </div>
          <div class="font-display font-bold text-xs ${match.isMatchOver ? 'text-emerald-400' : 'text-amber-300'}">
            ${statusText}
          </div>
        `;
      } else {
        summaryEl.innerHTML = `
          <div class="px-2.5 py-1 rounded-lg bg-slate-900 border border-amber-500/40">
            <span class="text-slate-400 text-[10px] uppercase mr-1">1st Innings:</span>
            <span class="font-display font-bold text-white">${match.battingTeam.nameEn}</span>
            <span class="font-mono font-bold text-amber-300 ml-1">${match.runs}/${match.wickets} (${match.getOversFormatted()} / ${match.totalOvers} Ov)</span>
          </div>
          <div class="font-mono text-[11px] text-slate-300">
            CRR: ${match.getCurrentRunRate()} · Bowling: ${match.bowlingTeam.nameEn}
          </div>
        `;
      }
    }

    // Populate Match MVP & Longest Six Banner
    const careerBanner = document.getElementById('scorecard-career-banner');
    if (careerBanner) {
      const mvp = typeof match.getMatchMVP === 'function' ? match.getMatchMVP() : null;
      const mvpText = mvp
        ? `🏅 Match MVP: <span class="text-white font-bold">${mvp.name}</span> <span class="text-amber-300 font-mono">(${mvp.summary})</span>`
        : '🏅 Play on to crown Match MVP';
      const longestSix = match.longestSixMeters || 0;

      careerBanner.innerHTML = `
        <div class="text-xs text-slate-200">
          ${mvpText}
        </div>
        <div class="font-mono text-xs text-slate-300">
          🚀 Longest Six: <strong class="text-amber-300">${longestSix > 0 ? `${longestSix}m` : '—'}</strong>
        </div>
      `;
    }

    // At the exact Innings Break (0 balls bowled in 2nd innings of T20), show the completed 1st Innings card
    const showFirstInningsCard =
      match.modeId === 't20' &&
      match.innings === 2 &&
      match.legalBalls === 0 &&
      Array.isArray(match.firstInningsCard) &&
      match.firstInningsCard.length > 0;

    const activeBattingCard = showFirstInningsCard ? match.firstInningsCard : match.battingCard;
    const activeBowlingCard =
      showFirstInningsCard && Array.isArray(match.firstInningsBowlingCard)
        ? match.firstInningsBowlingCard
        : match.bowlingCard;
    const cardTeamName = showFirstInningsCard
      ? match.firstInningsTeamNameEn || match.bowlingTeam.nameEn
      : match.battingTeam.nameEn;

    const batTitleEl = document.getElementById('scorecard-batting-title');
    if (batTitleEl) {
      batTitleEl.textContent = `${cardTeamName} Batting Card (${showFirstInningsCard ? '1st Innings' : `Innings ${match.innings}`})`;
    }

    const tbody = document.getElementById('scorecard-batting-body');
    if (tbody) {
      tbody.innerHTML = '';
      activeBattingCard.forEach((row, idx) => {
        const tr = document.createElement('tr');
        const isStriker = !showFirstInningsCard && idx === match.strikerIndex && !row.isOut;
        tr.className = `border-b border-slate-800/80 ${isStriker ? 'bg-slate-800/60 text-amber-300 font-semibold' : 'text-slate-200'}`;
        const sr = row.balls > 0 ? ((row.runs / row.balls) * 100).toFixed(1) : '0.0';
        const status = this.lang === 'hi' ? row.statusHi : row.statusEn;
        const statusColor = row.isOut
          ? 'text-red-400 font-semibold'
          : isStriker || (!showFirstInningsCard && idx === match.nonStrikerIndex)
            ? 'text-emerald-400 font-semibold'
            : 'text-slate-400';
        tr.innerHTML = `
          <td class="py-1 px-1.5">${row.name}${isStriker ? ' *' : ''}</td>
          <td class="py-1 px-1.5 text-[10px] ${statusColor}">${status}</td>
          <td class="py-1 px-1.5 text-right font-mono tabular-nums">${row.runs}</td>
          <td class="py-1 px-1.5 text-right font-mono tabular-nums">${row.balls}</td>
          <td class="py-1 px-1.5 text-right font-mono tabular-nums">${row.fours}</td>
          <td class="py-1 px-1.5 text-right font-mono tabular-nums">${row.sixes}</td>
          <td class="py-1 px-1.5 text-right font-mono tabular-nums">${sr}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    const bowlBody = document.getElementById('scorecard-bowling-body');
    if (bowlBody) {
      bowlBody.innerHTML = '';
      activeBowlingCard.forEach((b) => {
        const overs = `${Math.floor(b.balls / 6)}.${b.balls % 6}`;
        const econ = b.balls > 0 ? ((b.runs / b.balls) * 6).toFixed(2) : '0.00';
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-800/80 text-slate-200';
        tr.innerHTML = `
          <td class="py-1 px-1.5">${b.name}</td>
          <td class="py-1 px-1.5 text-right font-mono tabular-nums">${overs}</td>
          <td class="py-1 px-1.5 text-right font-mono tabular-nums">${b.runs}</td>
          <td class="py-1 px-1.5 text-right font-mono tabular-nums">${b.wickets}</td>
          <td class="py-1 px-1.5 text-right font-mono tabular-nums">${econ}</td>
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
    const r = Math.min(cx, cy) - 12;

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
    ctx.fillRect(cx - 4, cy - 14, 8, 28);

    match.wagonWheel.forEach((shot) => {
      const normDist = Math.min(1.0, shot.distance / 52.0);
      const ex = cx + Math.sin(shot.angleRad) * (normDist * r);
      const ey = cy - Math.cos(shot.angleRad) * (normDist * r);

      ctx.strokeStyle = shot.runs === 6 ? '#f59e0b' : shot.runs === 4 ? '#38bdf8' : '#e2e8f0';
      ctx.lineWidth = shot.runs >= 4 ? 2.4 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 8);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(ex, ey, 3.0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /**
   * Injects Pro Broadcast Features UI:
   * - Online 1v1 PvP Live Multiplayer Lobby Modal & Top-Bar Quick Button
   * - Super Over Shootout Option in Match Setup
   * - DRS Review Button & 3-Step Animated Hawk-Eye Ball Tracking Overlay
   * - Over-End 360° Wagon Wheel & Pitch Map Summary Popup + Top-Left Radar Toggle
   * - Interactive Bowling Release Timing Meter Bar
   */
  injectProFeaturesUI() {
    // 1. Add Super Over option to #setup-mode select and Step 1 scenario grid
    const modeSel = document.getElementById('setup-mode');
    if (modeSel && !modeSel.querySelector('option[value="super_over"]')) {
      const opt = document.createElement('option');
      opt.value = 'super_over';
      opt.textContent = '⚡ Super Over Shootout (1 Over)';
      modeSel.appendChild(opt);
    }

    const t20Btn = document.getElementById('btn-setup-mode-t20');
    if (t20Btn && t20Btn.parentElement && !document.getElementById('btn-setup-mode-super-over')) {
      const superBtn = document.createElement('button');
      superBtn.id = 'btn-setup-mode-super-over';
      superBtn.type = 'button';
      superBtn.setAttribute('data-setup-mode', 'super_over');
      superBtn.className = 'wd-scenario-card';
      superBtn.innerHTML = `
        <div class="flex items-center justify-between mb-1">
          <span class="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/50 text-[9px] font-black text-emerald-300 uppercase">TIE-BREAKER</span>
          <span class="font-mono text-[10px] text-emerald-300 font-bold">6 BALLS · 2 WKTS</span>
        </div>
        <div class="font-display font-black text-sm text-white">⚡ SUPER OVER SHOOTOUT</div>
        <div class="text-[11px] text-slate-400 mt-0.5">Sudden-death 1-Over shootout! Bat 1st &amp; defend or chase under floodlights.</div>
      `;
      t20Btn.parentElement.appendChild(superBtn);
    }

    // 2. Add Top-Bar "🌐 1v1" Multiplayer Button & Corner Menu Entry
    const cornerBtn = document.getElementById('btn-corner-menu');
    if (cornerBtn && cornerBtn.parentElement && !document.getElementById('btn-topbar-online-1v1')) {
      const pvpBtn = document.createElement('button');
      pvpBtn.id = 'btn-topbar-online-1v1';
      pvpBtn.type = 'button';
      pvpBtn.className =
        'px-2 py-1 rounded-lg bg-gradient-to-r from-sky-500/25 to-emerald-500/25 hover:from-sky-500/40 hover:to-emerald-500/40 border border-sky-400/60 text-[10px] font-display font-extrabold text-sky-200 flex items-center gap-1 shadow cursor-pointer shrink-0';
      pvpBtn.innerHTML = `<span id="online-1v1-top-dot" class="w-1.5 h-1.5 rounded-full bg-sky-400"></span><span>🌐 1v1 PvP</span>`;
      pvpBtn.addEventListener('click', (e) => {
        e.preventDefault();
        sound.playUIClick(1240);
        this.syncOnline1v1ModalUI();
        this.openModal('modal-online-1v1');
      });
      cornerBtn.parentElement.insertBefore(pvpBtn, cornerBtn);
    }

    // 3. Add "🎯 WAGON" button next to Top-Left Radar to view 360° Wagon Wheel anytime
    const radarGapBtn = document.getElementById('btn-toggle-radar-aim');
    if (radarGapBtn && radarGapBtn.parentElement && !document.getElementById('btn-radar-wagon-wheel')) {
      const wagonBtn = document.createElement('button');
      wagonBtn.id = 'btn-radar-wagon-wheel';
      wagonBtn.type = 'button';
      wagonBtn.className =
        'px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-400/50 text-[7px] font-black text-amber-300 uppercase tracking-wider transition pointer-events-auto cursor-pointer ml-1';
      wagonBtn.textContent = '🎯 WAGON';
      wagonBtn.addEventListener('click', (e) => {
        e.preventDefault();
        sound.playUIClick(1180);
        const match = this.app?.match;
        const summary = match?.lastCompletedOverSummary || {
          overNumber: Math.max(1, Math.ceil((match?.legalBalls || 1) / 6)),
          runsInOver: match?.runs || 0,
          wicketsInOver: match?.wickets || 0,
          balls: match?.currentOverBalls || [],
          wagonShots: match?.wagonWheel || [],
          scoreStr: `${match?.runs || 0}/${match?.wickets || 0}`,
          battingTeamShort: match?.battingTeam?.short || 'BAT',
          bowlerName: match?.getActiveBowler()?.name || 'Bowler'
        };
        this.showOverWagonWheelPopup(summary, false);
      });
      radarGapBtn.parentElement.appendChild(wagonBtn);
    }

    // 4. Inject Interactive Overlays & Online 1v1 Modal into document.body
    if (!document.getElementById('pro-features-overlays')) {
      const wrap = document.createElement('div');
      wrap.id = 'pro-features-overlays';
      wrap.innerHTML = `
        <!-- Interactive Bowling Release Timing Meter (Shown during Bowler Run-up in Bowl Mode) -->
        <div id="hud-bowling-release-meter" class="hidden fixed left-1/2 -translate-x-1/2 bottom-36 z-30 pointer-events-none flex flex-col items-center gap-1 bg-slate-950/90 border border-sky-400/60 rounded-xl px-3.5 py-2 shadow-2xl">
          <div class="text-[9px] font-display font-extrabold uppercase tracking-wider text-sky-300">⚡ TAP BOWL IN GREEN ZONE FOR PERFECT RELEASE</div>
          <div class="relative w-44 h-3 rounded-full bg-slate-800 border border-slate-700 overflow-hidden">
            <div class="absolute top-0 bottom-0 left-[74%] width-[18%] w-[18%] bg-emerald-400/80"></div>
            <div class="absolute top-0 bottom-0 left-[64%] w-[10%] bg-amber-400/60"></div>
            <div class="absolute top-0 bottom-0 left-[92%] w-[8%] bg-rose-500/70"></div>
            <div id="hud-bowling-release-cursor" class="absolute top-0 bottom-0 w-1.5 bg-white shadow-[0_0_8px_#fff]" style="left: 0%"></div>
          </div>
        </div>

        <!-- DRS Third Umpire Review Prompt Button -->
        <div id="hud-drs-prompt" class="hidden fixed left-1/2 -translate-x-1/2 top-20 z-40 flex items-center gap-2.5 bg-slate-950/95 border-2 border-amber-400 rounded-2xl px-4 py-2 shadow-2xl">
          <div class="text-xs font-display font-extrabold text-white">
            <span class="text-amber-300">CLOSE DECISION!</span> Challenge Umpire Call?
            <span id="hud-drs-Timer-lbl" class="ml-1 font-mono text-[10px] text-slate-300">(2 Left)</span>
          </div>
          <button id="btn-trigger-drs" type="button" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-emerald-400 text-slate-950 font-display font-black text-xs shadow-lg cursor-pointer active:scale-95 transition">
            📺 DRS REVIEW (T)
          </button>
        </div>

        <!-- 3-Step DRS Hawk-Eye Ball-Tracking Broadcast Overlay -->
        <div id="hud-drs-hawkeye-modal" class="hidden fixed inset-0 z-50 bg-slate-950/92 flex items-center justify-center p-4">
          <div class="w-full max-w-md bg-slate-900 border-2 border-sky-400/70 rounded-2xl p-4 shadow-2xl space-y-3 text-center">
            <div class="flex items-center justify-between border-b border-slate-800 pb-2">
              <span class="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-400/50 text-[10px] font-mono font-bold text-sky-300">THIRD UMPIRE · HAWK-EYE DRS</span>
              <span id="drs-hawkeye-dismissal-type" class="font-display font-bold text-xs text-amber-300">LBW REVIEW</span>
            </div>
            <canvas id="drs-hawkeye-canvas" width="340" height="150" class="w-full h-36 rounded-xl bg-slate-950 border border-slate-800 mx-auto"></canvas>
            <div class="grid grid-cols-3 gap-2 text-left">
              <div class="p-2 rounded-lg bg-slate-950 border border-slate-800">
                <div class="text-[9px] text-slate-400 uppercase font-mono">1. PITCHING</div>
                <div id="drs-step-pitching" class="font-display font-extrabold text-xs text-slate-500 mt-0.5">CHECKING...</div>
              </div>
              <div class="p-2 rounded-lg bg-slate-950 border border-slate-800">
                <div class="text-[9px] text-slate-400 uppercase font-mono">2. IMPACT</div>
                <div id="drs-step-impact" class="font-display font-extrabold text-xs text-slate-500 mt-0.5">WAITING...</div>
              </div>
              <div class="p-2 rounded-lg bg-slate-950 border border-slate-800">
                <div class="text-[9px] text-slate-400 uppercase font-mono">3. WICKETS</div>
                <div id="drs-step-wickets" class="font-display font-extrabold text-xs text-slate-500 mt-0.5">WAITING...</div>
              </div>
            </div>
            <div id="drs-final-decision-banner" class="py-2 px-3 rounded-xl bg-slate-950 border border-slate-800 font-display font-black text-base text-amber-300 tracking-wider">
              📡 TRACKING BALL TRAJECTORY...
            </div>
          </div>
        </div>

        <!-- Over-End 360° Wagon Wheel & Pitch Map Summary Popup -->
        <div id="hud-over-wagon-popup" class="hidden fixed inset-0 z-40 bg-slate-950/88 flex items-center justify-center p-4">
          <div class="w-full max-w-md bg-slate-900/95 border border-emerald-500/50 rounded-2xl p-4 shadow-2xl space-y-3">
            <div class="flex items-center justify-between border-b border-slate-800 pb-2">
              <div>
                <div id="over-wagon-title" class="font-display font-black text-sm text-white">END OF OVER 1 · 360° WAGON WHEEL</div>
                <div id="over-wagon-sub" class="text-[11px] text-emerald-300 font-mono">12 Runs · 0 Wickets</div>
              </div>
              <button id="btn-close-over-wagon" type="button" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 cursor-pointer">✕ Close</button>
            </div>
            <div class="flex flex-col sm:flex-row items-center gap-3">
              <canvas id="over-wagon-canvas" width="180" height="180" class="w-40 h-40 rounded-full bg-slate-950 border border-emerald-500/40 shrink-0"></canvas>
              <div class="flex-1 space-y-2 w-full">
                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Over Deliveries</div>
                <div id="over-wagon-balls" class="flex flex-wrap gap-1.5"></div>
                <div class="pt-1 space-y-1 text-[11px] text-slate-300">
                  <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span><span>SIXES (Aerial 6)</span></div>
                  <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block"></span><span>FOURS (Boundary 4)</span></div>
                  <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-slate-200 inline-block"></span><span>1s / 2s / 3s</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Real-Time Online 1v1 PvP Multiplayer Modal -->
        <div id="modal-online-1v1" class="modal-backdrop hidden fixed inset-0 z-50 bg-slate-950/92 flex items-center justify-center p-3 sm:p-4">
          <div class="w-full max-w-lg bg-slate-900 border border-sky-500/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div class="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-400/50 text-[10px] font-mono font-bold text-sky-300">LIVE WEBSOCKET PvP</span>
                <h2 class="font-display font-black text-sm sm:text-base text-white">🌐 Real-Time Online 1v1 Multiplayer</h2>
              </div>
              <button type="button" data-close-modal="modal-online-1v1" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 cursor-pointer">✕</button>
            </div>
            <div class="p-4 overflow-y-auto space-y-3 text-xs text-slate-300">
              <div class="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                <div>
                  <div class="text-[10px] text-slate-400 uppercase font-mono">Your 1v1 Room Code</div>
                  <div id="online-1v1-room-code" class="font-mono font-black text-2xl text-amber-300 tracking-widest">----</div>
                </div>
                <div class="flex flex-col items-end gap-1.5">
                  <span id="online-1v1-peer-badge" class="px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-400/50 text-[10px] font-mono font-bold text-amber-300">⏳ Waiting for Friend...</span>
                  <button id="btn-copy-online-invite" type="button" class="px-3 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-display font-extrabold text-[11px] cursor-pointer">📋 Copy 1v1 Invite Link</button>
                </div>
              </div>

              <div class="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
                <div class="font-display font-bold text-white text-xs">Join Friend's 1v1 Room Code</div>
                <div class="flex items-center gap-2">
                  <input id="input-online-1v1-code" type="text" maxlength="4" placeholder="ABCD" class="w-28 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 font-mono font-bold text-sm text-white uppercase tracking-widest"/>
                  <button id="btn-join-online-1v1" type="button" class="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-extrabold text-xs cursor-pointer">Join Room</button>
                </div>
              </div>

              <div class="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
                <div class="font-display font-bold text-white text-xs">Select Your Role &amp; Start Live 1v1 Match</div>
                <div class="text-[11px] text-slate-400">One player Bats with the 360° Angle Wheel while the other player Bowls live (places Pitch Bullseye, picks Variation &amp; Release Timing)!</div>
                <div class="grid grid-cols-2 gap-2 pt-1">
                  <button id="btn-start-online-bat" type="button" data-tv-default="true" class="py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 font-display font-black text-xs shadow-lg cursor-pointer">
                    🏏 BAT FIRST (1v1)
                  </button>
                  <button id="btn-start-online-bowl" type="button" class="py-2.5 px-3 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-400 text-slate-950 font-display font-black text-xs shadow-lg cursor-pointer">
                    ⚾ BOWL FIRST (1v1)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);
    }

    // Bind Pro Feature Overlay Events
    document.getElementById('btn-trigger-drs')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playUIClick(1320);
      if (typeof this.app?.triggerDRSReview === 'function') {
        this.app.triggerDRSReview();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target?.tagName)) {
        const promptEl = document.getElementById('hud-drs-prompt');
        if (promptEl && !promptEl.classList.contains('hidden')) {
          e.preventDefault();
          this.app?.triggerDRSReview?.();
        }
      }
    });

    document.getElementById('btn-close-over-wagon')?.addEventListener('click', () => {
      this.hideOverWagonWheelPopup();
    });

    document.getElementById('btn-copy-online-invite')?.addEventListener('click', async () => {
      const url = this.app?.net?.getOnlineInviteUrl
        ? this.app.net.getOnlineInviteUrl()
        : `${window.location.origin}/?room=${this.app?.net?.roomCode || ''}&online=1`;
      const btn = document.getElementById('btn-copy-online-invite');
      try {
        await navigator.clipboard.writeText(url);
        if (btn) {
          btn.textContent = '✅ Link Copied!';
          setTimeout(() => {
            btn.textContent = '📋 Copy 1v1 Invite Link';
          }, 1800);
        }
      } catch {
        this.showStatusToast(`Invite URL: ${url}`, true);
      }
    });

    document.getElementById('btn-join-online-1v1')?.addEventListener('click', () => {
      const inp = document.getElementById('input-online-1v1-code');
      const code = inp?.value?.trim()?.toUpperCase() || '';
      if (code.length === 4 && this.app) {
        sound.playUIClick(1240);
        this.app.joinCustomRoom(code);
        this.app.online1v1Active = true;
        this.syncOnline1v1ModalUI();
        this.showStatusToast(`🌐 Joined 1v1 Room ${code}!`, true);
      }
    });

    document.getElementById('btn-start-online-bat')?.addEventListener('click', () => {
      sound.playUIClick(1340);
      this.closeModal('modal-online-1v1');
      this.app?.startOnline1v1Match?.(this.app?.net?.roomCode, true, 'bat');
    });

    document.getElementById('btn-start-online-bowl')?.addEventListener('click', () => {
      sound.playUIClick(1340);
      this.closeModal('modal-online-1v1');
      this.app?.startOnline1v1Match?.(this.app?.net?.roomCode, true, 'bowl');
    });
  }

  updateBowlingReleaseMeter(progress = 0, visible = false) {
    const meter = document.getElementById('hud-bowling-release-meter');
    const cursor = document.getElementById('hud-bowling-release-cursor');
    if (!meter || !cursor) return;
    if (!visible) {
      meter.classList.add('hidden');
      return;
    }
    meter.classList.remove('hidden');
    const pct = Math.max(0, Math.min(100, progress * 100));
    cursor.style.left = `${pct.toFixed(1)}%`;
  }

  syncOnline1v1ModalUI() {
    const roomEl = document.getElementById('online-1v1-room-code');
    const badgeEl = document.getElementById('online-1v1-peer-badge');
    const topDot = document.getElementById('online-1v1-top-dot');
    const code = this.app?.net?.roomCode || '----';
    const connected = Boolean(this.app?.onlinePeerConnected || this.app?.net?.onlinePeerConnected);

    if (roomEl) roomEl.textContent = code;
    if (badgeEl) {
      if (connected) {
        badgeEl.textContent = '🟢 Opponent Connected · Ready for 1v1!';
        badgeEl.className =
          'px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/60 text-[10px] font-mono font-bold text-emerald-300';
      } else {
        badgeEl.textContent = `⏳ Room ${code} · Waiting for Opponent...`;
        badgeEl.className =
          'px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-400/50 text-[10px] font-mono font-bold text-amber-300';
      }
    }
    if (topDot) {
      topDot.className = connected
        ? 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping'
        : 'w-1.5 h-1.5 rounded-full bg-sky-400';
    }
  }

  showDRSReviewPrompt(snap, reviewsLeft = 1) {
    const promptEl = document.getElementById('hud-drs-prompt');
    const lblEl = document.getElementById('hud-drs-Timer-lbl');
    if (!promptEl) return;
    const rem = snap?.reviewsLeft ?? reviewsLeft ?? 1;
    if (lblEl) {
      lblEl.textContent = `(${rem} Review${rem === 1 ? '' : 's'} Left)`;
    }
    promptEl.classList.remove('hidden');
    this.syncPhoneMatchHUD();
    if (this.drsPromptTimeout) clearTimeout(this.drsPromptTimeout);
    this.drsPromptTimeout = setTimeout(() => {
      this.hideDRSReviewPrompt();
    }, 6000);
  }

  hideDRSReviewPrompt() {
    const promptEl = document.getElementById('hud-drs-prompt');
    if (promptEl) promptEl.classList.add('hidden');
    if (this.drsPromptTimeout) {
      clearTimeout(this.drsPromptTimeout);
      this.drsPromptTimeout = null;
    }
    this.syncPhoneMatchHUD();
  }

  playDRSHawkEyeSequence(snap, onComplete) {
    this.hideDRSReviewPrompt();
    const modal = document.getElementById('hud-drs-hawkeye-modal');
    const typeEl = document.getElementById('drs-hawkeye-dismissal-type');
    const pitchEl = document.getElementById('drs-step-pitching');
    const impactEl = document.getElementById('drs-step-impact');
    const wicketsEl = document.getElementById('drs-step-wickets');
    const finalEl = document.getElementById('drs-final-decision-banner');
    const canvas = document.getElementById('drs-hawkeye-canvas');

    if (!modal || !canvas) {
      if (onComplete) {
        onComplete({
          isOverturned: false,
          umpireCall: false,
          reasonText: 'WICKETS HITTING'
        });
      }
      return;
    }

    modal.classList.remove('hidden');
    const dType = String(snap?.wicketTypeEn || snap?.dismissalType || 'LBW').toUpperCase();
    if (typeEl) typeEl.textContent = `${dType} · HAWK-EYE REVIEW`;
    if (pitchEl) {
      pitchEl.textContent = 'CHECKING...';
      pitchEl.className = 'font-display font-extrabold text-xs text-slate-400 mt-0.5';
    }
    if (impactEl) {
      impactEl.textContent = 'WAITING...';
      impactEl.className = 'font-display font-extrabold text-xs text-slate-400 mt-0.5';
    }
    if (wicketsEl) {
      wicketsEl.textContent = 'WAITING...';
      wicketsEl.className = 'font-display font-extrabold text-xs text-slate-400 mt-0.5';
    }
    if (finalEl) {
      finalEl.textContent = '📡 HAWK-EYE BALL TRACKING IN PROGRESS...';
      finalEl.className =
        'py-2 px-3 rounded-xl bg-slate-950 border border-slate-800 font-display font-black text-sm text-sky-300 tracking-wider';
    }

    // Determine realistic Hawk-Eye / Crease-Cam verdict deterministically from physics evaluation in snap
    const isRunOutOrStumped = dType.includes('RUN OUT') || dType.includes('STUMPED');
    const isOverturned = typeof snap?.isOverturned === 'boolean' ? snap.isOverturned : false;
    const isUmpireCall = Boolean(snap?.umpireCall);
    const pitchingText = isRunOutOrStumped
      ? 'BAILS: ZING LED FLASH'
      : Math.abs(snap?.pitchX ?? 0) > 0.19
        ? 'PITCHING: OUTSIDE'
        : 'PITCHING: IN LINE';
    const impactText = isRunOutOrStumped
      ? isOverturned
        ? 'CREASE: BAT GROUNDED'
        : `CREASE: SHORT (${Math.round((snap?.runnerProgress ?? 0.55) * 100)}%)`
      : dType.includes('CAUGHT')
        ? isOverturned
          ? 'ULTRAEDGE: FLAT LINE'
          : 'ULTRAEDGE: SPIKE!'
        : Math.abs(snap?.impactX ?? 0) > 0.16
          ? 'IMPACT: OUTSIDE'
          : 'IMPACT: IN LINE';
    const wicketsText = isRunOutOrStumped
      ? isOverturned
        ? 'BAT IN GROUND!'
        : 'SHORT OF CREASE · OUT!'
      : isOverturned
        ? 'WICKETS: MISSING!'
        : isUmpireCall
          ? "WICKETS: UMPIRE'S CALL"
          : 'WICKETS: HITTING!';

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    let progress = 0;

    const drawHawkEyeFrame = (p) => {
      ctx.clearRect(0, 0, w, h);
      // Pitch strip perspective
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(214, 184, 138, 0.22)';
      ctx.beginPath();
      ctx.moveTo(40, h - 18);
      ctx.lineTo(w - 40, h - 18);
      ctx.lineTo(w - 75, 24);
      ctx.lineTo(75, 24);
      ctx.closePath();
      ctx.fill();

      // In-line zone strip
      ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
      ctx.fillRect(w / 2 - 22, 24, 44, h - 42);

      // Stumps at far end
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.5;
      [-10, 0, 10].forEach((ox) => {
        ctx.beginPath();
        ctx.moveTo(w / 2 + ox, 54);
        ctx.lineTo(w / 2 + ox, 24);
        ctx.stroke();
      });

      // Real physics-driven ball trajectory from snap.pitchX, snap.bounceZ, snap.impactX, snap.impactY
      const pitchXVal = typeof snap?.pitchX === 'number' ? snap.pitchX : 0;
      const bounceZVal = typeof snap?.bounceZ === 'number' ? snap.bounceZ : 4.8;
      const impactXVal = typeof snap?.impactX === 'number' ? snap.impactX : 0;
      const impactYVal = typeof snap?.impactY === 'number' ? snap.impactY : isOverturned ? 0.82 : 0.42;

      const startX = 44 + Math.max(-18, Math.min(18, pitchXVal * 40));
      const startY = h - 26;
      const bounceNormZ = Math.max(0.28, Math.min(0.82, (bounceZVal + 2.0) / 11.5));
      const bounceX = startX + (w - 96) * bounceNormZ;
      const bounceY = h - 20;
      const endX = w - 48 + Math.max(-24, Math.min(24, impactXVal * 65));
      const endY = isOverturned
        ? 14
        : Math.max(22, Math.min(52, 54 - (impactYVal / 0.71) * 30));

      ctx.strokeStyle = isOverturned ? '#38bdf8' : '#f43f5e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      const curX = startX + (endX - startX) * p;
      const curY =
        p < bounceNormZ
          ? startY + (bounceY - startY) * (p / bounceNormZ)
          : bounceY + (endY - bounceY) * ((p - bounceNormZ) / Math.max(0.15, 1 - bounceNormZ));
      ctx.lineTo(Math.min(curX, bounceX), p < bounceNormZ ? curY : bounceY);
      if (p > bounceNormZ) {
        ctx.lineTo(curX, curY);
      }
      ctx.stroke();

      // Highlight pitch bounce spot
      if (p >= bounceNormZ) {
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(bounceX, bounceY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(curX, curY, 5, 0, Math.PI * 2);
      ctx.fill();
    };

    const animTimer = setInterval(() => {
      progress = Math.min(1, progress + 0.05);
      drawHawkEyeFrame(progress);
    }, 65);

    setTimeout(() => {
      if (pitchEl) {
        pitchEl.textContent = pitchingText;
        pitchEl.className = 'font-display font-extrabold text-xs text-emerald-400 mt-0.5';
      }
      sound.playUIClick(980);
    }, 750);

    setTimeout(() => {
      if (impactEl) {
        impactEl.textContent = impactText;
        impactEl.className = `font-display font-extrabold text-xs ${
          isOverturned ? 'text-emerald-400' : 'text-rose-400'
        } mt-0.5`;
      }
      sound.playUIClick(1120);
    }, 1550);

    setTimeout(() => {
      clearInterval(animTimer);
      drawHawkEyeFrame(1);
      if (wicketsEl) {
        wicketsEl.textContent = wicketsText;
        wicketsEl.className = `font-display font-extrabold text-xs ${
          isOverturned ? 'text-emerald-400' : 'text-rose-400'
        } mt-0.5`;
      }
      if (finalEl) {
        if (isOverturned) {
          finalEl.textContent = '🟢 DECISION OVERTURNED · NOT OUT!';
          finalEl.className =
            'py-2 px-3 rounded-xl bg-emerald-500/20 border border-emerald-400 font-display font-black text-base text-emerald-300 tracking-wider';
        } else {
          finalEl.textContent = '🔴 UMPIRE CALL STANDS · OUT!';
          finalEl.className =
            'py-2 px-3 rounded-xl bg-rose-500/20 border border-rose-400 font-display font-black text-base text-rose-300 tracking-wider';
        }
      }
    }, 2350);

    setTimeout(() => {
      modal.classList.add('hidden');
      if (onComplete) {
        onComplete({
          isOverturned,
          umpireCall: isUmpireCall,
          reasonText: `${pitchingText} · ${impactText} · ${wicketsText}`
        });
      }
    }, 3700);
  }

  showOverWagonWheelPopup(summary, autoHide = true) {
    const popup = document.getElementById('hud-over-wagon-popup');
    const titleEl = document.getElementById('over-wagon-title');
    const subEl = document.getElementById('over-wagon-sub');
    const ballsEl = document.getElementById('over-wagon-balls');
    const canvas = document.getElementById('over-wagon-canvas');
    if (!popup || !canvas || !summary) return;

    if (titleEl) {
      titleEl.textContent = `END OF OVER ${summary.overNumber || 1} · 360° WAGON WHEEL`;
    }
    if (subEl) {
      subEl.textContent = `${summary.battingTeamShort || ''} ${summary.scoreStr || ''} · ${summary.runsInOver || 0} Runs, ${summary.wicketsInOver || 0} Wkt (${summary.bowlerName || 'Bowler'})`;
    }
    if (ballsEl) {
      ballsEl.innerHTML = '';
      (summary.balls || []).forEach((b) => {
        const badge = document.createElement('span');
        badge.className = `px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
          b === '6' || b === '4'
            ? 'bg-amber-400 text-slate-950'
            : b === 'W'
              ? 'bg-rose-600 text-white'
              : 'bg-slate-800 text-slate-200 border border-slate-700'
        }`;
        badge.textContent = b;
        ballsEl.appendChild(badge);
      });
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 10;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#064e3b';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#10b981';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#d6b88a';
    ctx.fillRect(cx - 3, cy - 10, 6, 20);

    const shots =
      Array.isArray(summary.wagonShots) && summary.wagonShots.length > 0
        ? summary.wagonShots
        : this.app?.match?.wagonWheel || [];

    shots.forEach((shot) => {
      const normDist = Math.min(1.0, (shot.distance || 28) / 52.0);
      const ex = cx + Math.sin(shot.angleRad || 0) * (normDist * r);
      const ey = cy - Math.cos(shot.angleRad || 0) * (normDist * r);

      ctx.strokeStyle = shot.runs === 6 ? '#f59e0b' : shot.runs === 4 ? '#38bdf8' : '#e2e8f0';
      ctx.lineWidth = shot.runs >= 4 ? 2.4 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 4);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(ex, ey, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    popup.classList.remove('hidden');
    this.syncPhoneMatchHUD();
    if (this.overWagonTimeout) clearTimeout(this.overWagonTimeout);
    if (autoHide) {
      this.overWagonTimeout = setTimeout(() => {
        this.hideOverWagonWheelPopup();
      }, 3600);
    }
  }

  hideOverWagonWheelPopup() {
    const popup = document.getElementById('hud-over-wagon-popup');
    if (popup) popup.classList.add('hidden');
    if (this.overWagonTimeout) {
      clearTimeout(this.overWagonTimeout);
      this.overWagonTimeout = null;
    }
    this.syncPhoneMatchHUD();
  }
}

