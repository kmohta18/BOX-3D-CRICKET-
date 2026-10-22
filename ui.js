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
    this.setupMode = gameConfig.modeId === 't20' ? 't20' : 'run_chase';
    this.setupStep = 1;
    this.rolledChaseTarget = rollRunChaseTarget(gameConfig.difficulty);
    this.t20TossDone = false;
    this.t20UserWonToss = false;
  }

  t(key) {
    return (I18N[this.lang] && I18N[this.lang][key]) || I18N.en[key] || key;
  }

  init() {
    this.setUISize(this.uiSize);
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
    this.updateLanguageLabels();
    this.updateShotModeHUD();
    this.updateHUD();
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
    setVal('setting-dof', gameConfig.dofEnabled ? 'on' : 'off');
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

    for (let i = 1; i <= 4; i++) {
      const panel = document.getElementById(`setup-step-panel-${i}`);
      if (panel) panel.classList.toggle('hidden', i !== this.setupStep);
    }

    document.querySelectorAll('[data-setup-step-tab]').forEach((tab) => {
      const tabStep = Number(tab.getAttribute('data-setup-step-tab'));
      const active = tabStep === this.setupStep;
      tab.className = `px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
        active
          ? 'bg-amber-400 text-slate-950 shadow'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
      }`;
    });

    const subtitles = {
      1: 'Step 1 of 4 · Choose Game Format & Challenge Level',
      2: 'Step 2 of 4 · Choose Your Team & Opponent Team',
      3: 'Step 3 of 4 · Select 3D Indian Stadium, Time & Pitch',
      4: 'Step 4 of 4 · Match Summary, Coin Toss / Target & Start'
    };
    const subEl = document.getElementById('setup-wizard-subtitle');
    if (subEl) subEl.textContent = subtitles[this.setupStep] || subtitles[1];

    const prevBtn = document.getElementById('btn-setup-prev-step');
    const nextBtn = document.getElementById('btn-setup-next-step');
    const startBtn = document.getElementById('btn-start-match');
    const quickBtn = document.getElementById('btn-setup-quick-start');

    if (prevBtn) prevBtn.classList.toggle('hidden', this.setupStep === 1);
    if (nextBtn) {
      nextBtn.classList.toggle('hidden', this.setupStep === 4);
      const nextLabels = {
        1: 'Next: Choose Teams →',
        2: 'Next: Stadium & Pitch →',
        3: 'Next: Toss & Start →'
      };
      nextBtn.textContent = nextLabels[this.setupStep] || 'Next Step →';
    }
    if (startBtn) startBtn.classList.toggle('hidden', this.setupStep !== 4);
    if (quickBtn) quickBtn.classList.toggle('hidden', this.setupStep === 4);

    this.syncSetupWizardCards();
  }

  syncSetupWizardCards() {
    const diff = normalizeDifficultyKey(document.getElementById('setup-difficulty')?.value || gameConfig.difficulty);
    document.querySelectorAll('[data-diff-card]').forEach((btn) => {
      const d = btn.getAttribute('data-diff-card');
      const active = d === diff;
      const borderMap = {
        easy: 'bg-emerald-500/15 border-emerald-400 text-white shadow-lg',
        medium: 'bg-amber-400/15 border-amber-400 text-white shadow-lg',
        hard: 'bg-rose-500/15 border-rose-400 text-white shadow-lg'
      };
      btn.className = `p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
        active
          ? borderMap[d] || borderMap.medium
          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
      }`;
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
      btn.className = `p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
        active
          ? 'bg-emerald-500/15 border-emerald-400 text-white shadow-lg'
          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
      }`;
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

    // Update Step 4 Summary Banner
    const matchupEl = document.getElementById('setup-summary-matchup');
    if (matchupEl && teamA && teamB) {
      matchupEl.textContent = `${teamA.nameEn} (${teamA.short}) vs ${teamB.nameEn} (${teamB.short})`;
    }
    const metaEl = document.getElementById('setup-summary-meta');
    if (metaEl) {
      const modeStr = this.setupMode === 't20' ? `T20 Match (${t20OversVal} Overs)` : '5-Over Run Chase';
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
    const isT20 = modeId === 't20';
    this.setupMode = isT20 ? 't20' : 'run_chase';
    gameConfig.modeId = this.setupMode;
    saveGameConfig();

    const modeSel = document.getElementById('setup-mode');
    if (modeSel) modeSel.value = this.setupMode;
    const t20OversVal = Number(document.getElementById('setup-t20-overs')?.value) || 20;
    const oversSel = document.getElementById('setup-overs');
    if (oversSel) oversSel.value = isT20 ? String(t20OversVal) : '5';

    const btnChase = document.getElementById('btn-setup-mode-chase');
    const btnT20 = document.getElementById('btn-setup-mode-t20');
    if (btnChase) {
      btnChase.className = `p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
        !isT20
          ? 'bg-amber-400/15 border-amber-400 text-white shadow-lg'
          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
      }`;
    }
    if (btnT20) {
      btnT20.className = `p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
        isT20
          ? 'bg-sky-400/15 border-sky-400 text-white shadow-lg'
          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
      }`;
    }

    const step1OversWrap = document.getElementById('setup-step1-t20-overs-wrap');
    if (step1OversWrap) step1OversWrap.classList.toggle('hidden', !isT20);

    const chaseCard = document.getElementById('setup-chase-card');
    const tossCard = document.getElementById('setup-toss-card');
    if (chaseCard) chaseCard.classList.toggle('hidden', isT20);
    if (tossCard) tossCard.classList.toggle('hidden', !isT20);

    const startBtn = document.getElementById('btn-start-match');
    if (startBtn) {
      startBtn.textContent = isT20 ? `Start T20 Match (${t20OversVal} Overs)` : 'Start 5-Over Run Chase';
    }
    this.syncSetupWizardCards();
  }

  refreshRunChaseTargetPreview(rollNew = true) {
    const diff = normalizeDifficultyKey(
      document.getElementById('setup-difficulty')?.value || gameConfig.difficulty
    );
    const profile = getDifficultyProfile(diff);
    if (
      rollNew ||
      !this.rolledChaseTarget ||
      this.rolledChaseTarget < profile.chaseTargetMin ||
      this.rolledChaseTarget > profile.chaseTargetMax
    ) {
      this.rolledChaseTarget = rollRunChaseTarget(diff);
    }
    const descEl = document.getElementById('setup-chase-desc');
    if (descEl) {
      descEl.textContent = `Opponent already batted 5 overs. ${profile.nameEn} Target Range: ${profile.chaseTargetMin}–${profile.chaseTargetMax} Runs.`;
    }
    const badgeEl = document.getElementById('setup-chase-target-badge');
    if (badgeEl) {
      badgeEl.textContent = `Target: ${this.rolledChaseTarget} Runs`;
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
    if (this.cornerMenuOpen) {
      this.showDeliveryPreview(
        {
          customStatusText: '⏸ GAME PAUSED · MENU OPEN',
          lengthCategory: 'good'
        },
        'always'
      );
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
    toast.className = `fixed bottom-14 right-3 z-30 pointer-events-none opacity-100 translate-y-0 transition-all duration-200 flex items-center gap-2 bg-slate-950/95 border ${
      isPositive ? 'border-emerald-500/80' : 'border-amber-500/80'
    } rounded-lg px-3 py-1.5 shadow-xl text-xs font-medium text-slate-100`;
    if (dot) {
      dot.className = `w-2 h-2 rounded-full ${isPositive ? 'bg-emerald-400' : 'bg-amber-400'}`;
    }

    if (this.statusToastTimeout) clearTimeout(this.statusToastTimeout);
    this.statusToastTimeout = setTimeout(() => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', 'translate-y-1');
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
    const menuDot = document.getElementById('menu-conn-dot');
    const qrMenuDot = document.getElementById('qr-menu-conn-dot');
    const qrMenuLbl = document.getElementById('qr-menu-conn-lbl');

    if (menuDot) {
      menuDot.className = `inline-block w-2 h-2 rounded-full transition-colors ${
        connected ? 'bg-emerald-400 ring-2 ring-emerald-500/40' : 'bg-slate-500 ring-1 ring-slate-700'
      }`;
      menuDot.title = connected ? `Phone Connected (${latencyMs}ms)` : 'Phone Disconnected';
    }
    if (qrMenuDot) {
      qrMenuDot.className = `inline-block w-2 h-2 rounded-full ${
        connected ? 'bg-emerald-400' : 'bg-slate-500'
      }`;
    }
    if (qrMenuLbl) {
      qrMenuLbl.textContent = connected ? 'ONLINE' : 'QR';
      qrMenuLbl.className = `text-[10px] font-mono ${connected ? 'text-emerald-400 font-bold' : 'text-amber-300'}`;
    }

    const gateTitle = document.getElementById('qr-play-gate-title');
    if (gateTitle) {
      if (connected) {
        gateTitle.textContent = `✅ PHONE CONTROLLER CONNECTED (${latencyMs}ms) · PRESS ▶ PLAY MATCH TO BEGIN!`;
        gateTitle.className = 'font-display font-bold text-xs sm:text-sm text-emerald-400';
      } else {
        gateTitle.textContent = '⏸ MATCH PAUSED UNTIL YOU PRESS PLAY';
        gateTitle.className = 'font-display font-bold text-xs sm:text-sm text-amber-300';
      }
    }

    if (connected && !this.wasPhoneConnected) {
      this.wasPhoneConnected = true;
      // Only auto-close modal-qr if the match play gate was already confirmed earlier;
      // before the first ball, keep the Ready-to-Play popup open so the player can get into stance and press PLAY!
      const qrModal = document.getElementById('modal-qr');
      if (qrModal && !qrModal.classList.contains('hidden') && this.app.matchPlayConfirmed) {
        this.closeModal('modal-qr');
      }
      this.showStatusToast('Phone connected! Press PLAY when ready.', true);
    } else if (!connected && this.wasPhoneConnected) {
      this.wasPhoneConnected = false;
      this.showStatusToast('Phone disconnected — open Pair Phone to reconnect', false);
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

    // Requirement A.1: Close modals on Esc key, Tab for Scorecard, D for Debug, M for Match Setup
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.activeModalId || this.isAnyModalOpen()) {
          e.preventDefault();
          this.app.batting.isCalibrating = false;
          this.closeAllModals();
        } else if (this.cornerMenuOpen) {
          this.toggleCornerMenu(false);
        }
        return;
      }
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.repeat) return;
      if (e.code === 'KeyD' && !this.app.batting.keys.right) {
        this.toggleDebugPanel();
      } else if (e.code === 'KeyM') {
        this.setSetupStep(1);
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
      if (this.activeModalId || this.isAnyModalOpen()) {
        this.app.batting.isCalibrating = false;
        this.closeAllModals(true);
      }
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

    // Sticky bottom bar "Back to Menu / Match Setup" buttons
    document.getElementById('btn-scorecard-back-menu')?.addEventListener('click', () => {
      this.closeModal('modal-scorecard');
      this.setSetupStep(1);
      this.openModal('modal-setup');
    });
    document.getElementById('btn-settings-back-menu')?.addEventListener('click', () => {
      this.closeModal('modal-settings');
      this.toggleCornerMenu(true);
    });

    // Reconnect Pause Banner buttons
    document.getElementById('btn-pause-repair')?.addEventListener('click', () => {
      this.openQRModal();
    });
    document.getElementById('btn-pause-resume')?.addEventListener('click', () => {
      this.app.net.disconnectPaused = false;
      document.getElementById('pause-reconnect-banner')?.classList.add('hidden');
    });

    // Hold-to-Run (R) button in Live Running Bar
    const holdRunBtn = document.getElementById('btn-hud-hold-run');
    if (holdRunBtn) {
      const startHold = (e) => {
        e.preventDefault();
        if (typeof this.app.setRunButtonHeld === 'function') this.app.setRunButtonHeld(true);
        if (typeof this.app.setHoldRun === 'function') this.app.setHoldRun(true);
      };
      const stopHold = (e) => {
        e.preventDefault();
        if (typeof this.app.setRunButtonHeld === 'function') this.app.setRunButtonHeld(false);
        if (typeof this.app.setHoldRun === 'function') this.app.setHoldRun(false);
      };
      holdRunBtn.addEventListener('pointerdown', startHold);
      holdRunBtn.addEventListener('pointerup', stopHold);
      holdRunBtn.addEventListener('pointerleave', stopHold);
      holdRunBtn.addEventListener('pointercancel', stopHold);
    }

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
      this.toggleCornerMenu(false);
      this.openQRModal();
    });
    document.getElementById('btn-close-qr')?.addEventListener('click', () => {
      if (!this.app.matchPlayConfirmed) {
        this.app.confirmPlayAndStartMatch();
      } else {
        this.closeModal('modal-qr');
      }
    });

    document.getElementById('btn-qr-play-now')?.addEventListener('click', () => {
      sound.playUIClick();
      this.app.confirmPlayAndStartMatch();
    });

    document.getElementById('btn-qr-back-setup')?.addEventListener('click', () => {
      sound.playUIClick();
      this.setSetupStep(1);
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
      this.toggleCornerMenu(false);
      this.syncSettingsControlsFromConfig();
      this.refreshRunChaseTargetPreview(true);
      this.setSetupStep(1);
      this.openModal('modal-setup');
    });
    document.getElementById('btn-close-setup')?.addEventListener('click', () => this.closeModal('modal-setup'));

    document.getElementById('btn-open-scorecard')?.addEventListener('click', () => {
      sound.playUIClick();
      this.toggleCornerMenu(false);
      this.renderScorecardAndWagonWheel();
      this.openModal('modal-scorecard');
    });
    document.getElementById('btn-close-scorecard')?.addEventListener('click', () => this.closeModal('modal-scorecard'));

    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      sound.playUIClick();
      this.toggleCornerMenu(false);
      this.populateSpeechVoicesSelect();
      this.syncSettingsControlsFromConfig();
      this.openModal('modal-settings');
    });
    document.getElementById('btn-close-settings')?.addEventListener('click', () => this.closeModal('modal-settings'));

    // 4-Step Wizard Navigation Tabs & Prev / Next / Quick Start Buttons
    document.querySelectorAll('[data-setup-step-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        sound.playUIClick();
        const step = Number(tab.getAttribute('data-setup-step-tab')) || 1;
        this.setSetupStep(step);
      });
    });

    document.getElementById('btn-setup-prev-step')?.addEventListener('click', () => {
      sound.playUIClick();
      this.setSetupStep(this.setupStep - 1);
    });

    document.getElementById('btn-setup-next-step')?.addEventListener('click', () => {
      sound.playUIClick();
      this.setSetupStep(this.setupStep + 1);
    });

    document.getElementById('btn-setup-quick-start')?.addEventListener('click', () => {
      sound.playUIClick();
      if (this.setupMode === 't20' && !this.t20TossDone) {
        this.setSetupStep(4);
        this.app.performCoinToss('HEADS');
        return;
      }
      this.app.startConfiguredMatchFromUI();
      this.openQRModal();
    });

    // 2-Mode Selection (Run Chase 5 Overs & T20 20 Overs)
    document.querySelectorAll('[data-setup-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playUIClick();
        const modeId = btn.getAttribute('data-setup-mode');
        this.updateSetupModeUI(modeId);
        if (modeId === 'run_chase') {
          this.refreshRunChaseTargetPreview(true);
        }
      });
    });

    document.getElementById('setup-mode')?.addEventListener('change', (e) => {
      this.updateSetupModeUI(e.target.value);
      if (e.target.value === 'run_chase') {
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
      // If user selected T20 mode and hasn't flipped the coin yet, trigger the Coin Toss first!
      if (this.setupMode === 't20' && !this.t20TossDone) {
        this.app.performCoinToss('HEADS');
        return;
      }
      this.app.startConfiguredMatchFromUI();
      this.openQRModal();
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
      if (e.target.checked) {
        commentary.trigger('match_start', {
          teamA: this.app.match.teamA.nameEn,
          teamB: this.app.match.teamB.nameEn,
          batsman: this.app.match.getActiveStriker()?.name || 'Striker',
          bowler: this.app.match.getActiveBowler()?.name || 'Bowler'
        }, true);
      } else {
        commentary.stopSpeech();
      }
    });
    document.getElementById('setting-comm-lang')?.addEventListener('change', (e) => {
      commentary.setSettings({ language: e.target.value, voiceURI: 'auto' });
      this.populateSpeechVoicesSelect();
      if (gameConfig.commentary.spoken) {
        commentary.trigger('six', {
          batsman: this.app.match.getActiveStriker()?.name || 'Sharma',
          bowler: this.app.match.getActiveBowler()?.name || 'Rao',
          shot: 'lofted drive'
        }, true);
      }
    });
    document.getElementById('setting-comm-freq')?.addEventListener('change', (e) => {
      commentary.setSettings({ frequency: e.target.value });
    });
    document.getElementById('setting-comm-voice')?.addEventListener('change', (e) => {
      commentary.setSettings({ voiceURI: e.target.value });
      if (gameConfig.commentary.spoken) {
        commentary.trigger('four', {
          batsman: this.app.match.getActiveStriker()?.name || 'Sharma',
          bowler: this.app.match.getActiveBowler()?.name || 'Rao',
          shot: 'cover drive'
        }, true);
      }
    });
    document.getElementById('btn-test-comm-voice')?.addEventListener('click', () => {
      sound.init();
      commentary.setSettings({ spoken: true });
      const commSp = document.getElementById('setting-comm-spoken');
      if (commSp) commSp.checked = true;
      commentary.trigger('six', {
        batsman: this.app.match.getActiveStriker()?.name || 'Sharma',
        bowler: this.app.match.getActiveBowler()?.name || 'Rao',
        shot: 'huge six over long-on'
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
    const isLocked = batting.modeLocked;

    const glyphEl = document.getElementById('hud-shot-mode-glyph');
    const iconEl = document.getElementById('hud-shot-mode-icon');
    const lockEl = document.getElementById('hud-shot-mode-lock');

    if (glyphEl) {
      glyphEl.textContent = isGround ? '→' : '↗';
      glyphEl.className = `text-[11px] leading-none ${isGround ? 'text-emerald-400' : 'text-amber-400'}`;
    }
    if (iconEl) {
      iconEl.textContent = isGround ? 'GROUND' : 'FLY';
      iconEl.className = `font-display text-[10px] sm:text-[11px] font-bold ${
        isGround ? 'text-emerald-400' : 'text-amber-400'
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
        !isGround ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:text-white'
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
        ? 'TURNING BACK'
        : state.stoppedMidPitch
          ? `STOPPED (${progressPct}%)`
          : `${stepsInRun}/20 steps`;
    }
    if (cadEl) {
      const cad = state.cadenceHz ?? b?.cadenceSps ?? 0;
      cadEl.textContent = `${cad.toFixed(1)}/s`;
    }
    if (countEl) {
      const r = state.runsCompleted ?? this.app.runsCompletedThisBall ?? 0;
      countEl.textContent = `${r} RUN${r === 1 ? '' : 'S'}`;
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
      stoppedMidPitch: this.app.runnerStoppedMidPitch || false
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

    // 1. Team codes with score and wickets, e.g. "MET v DYN 240/3"
    const batShort = match.battingTeam.short;
    const bowlShort = match.bowlingTeam.short;
    const scoreEl = document.getElementById('hud-score');
    if (scoreEl) {
      scoreEl.textContent = `${batShort} v ${bowlShort} ${match.runs}/${match.wickets}`;
    }

    // Powerplay / Free Hit compact badge
    const flagsEl = document.getElementById('hud-match-flags');
    if (flagsEl) {
      if (match.freeHit) {
        flagsEl.textContent = 'FREE HIT';
        flagsEl.classList.remove('hidden');
      } else if (match.isPowerplayActive()) {
        flagsEl.textContent = 'PP';
        flagsEl.classList.remove('hidden');
      } else {
        flagsEl.classList.add('hidden');
      }
    }

    // 2. Overs, e.g. "OVERS 38.2"
    const oversEl = document.getElementById('hud-overs');
    if (oversEl) {
      oversEl.textContent = match.getOversFormatted();
    }

    // 3. Target or situation text ("NEED 54 FROM 46 BALLS" in 2nd innings, or run rate in 1st innings)
    const crrEl = document.getElementById('hud-crr');
    if (crrEl) {
      if (match.innings === 2 && match.firstInningsScore !== null) {
        const target = match.firstInningsScore + 1;
        const needRuns = Math.max(0, target - match.runs);
        const remBalls = Math.max(0, match.totalOvers * 6 - match.legalBalls);
        crrEl.textContent = `NEED ${needRuns} FROM ${remBalls} BALLS`;
      } else {
        crrEl.textContent = `${this.t('crr')} ${match.getCurrentRunRate()}`;
      }
    }

    // 4. Batsmen: Striker (with small bat icon) and Non-Striker, e.g. "Sharma 112 (120)" & "Verma 24 (24)*"
    const striker = match.getActiveStriker();
    const nonStriker = match.getActiveNonStriker();
    const strikerEl = document.getElementById('hud-striker');
    const nonStrikerEl = document.getElementById('hud-nonstriker');
    if (strikerEl && striker) {
      strikerEl.textContent = `${shortSurname(striker.name)} ${striker.runs} (${striker.balls})`;
    }
    if (nonStrikerEl && nonStriker) {
      nonStrikerEl.textContent = `${shortSurname(nonStriker.name)} ${nonStriker.runs} (${nonStriker.balls})*`;
    }

    // 5. Bowler with figures, e.g. "Rao 2-34 (7.2)", and last 6 balls as small dots
    const bowler = match.getActiveBowler();
    const bowlerEl = document.getElementById('hud-bowler');
    if (bowlerEl && bowler) {
      const bOvers = `${Math.floor(bowler.balls / 6)}.${bowler.balls % 6}`;
      bowlerEl.textContent = `${shortSurname(bowler.name)} ${bowler.wickets}-${bowler.runs} (${bOvers})`;
    }

    const dotsContainer = document.getElementById('hud-over-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      const balls = match.currentOverBalls.slice(-6);
      for (let i = 0; i < 6; i++) {
        const val = balls[i];
        const span = document.createElement('span');
        span.className =
          'inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-mono font-bold tabular-nums ';
        if (!val) {
          span.className += 'bg-slate-800/90 text-slate-500 border border-slate-700/70';
          span.textContent = '·';
        } else if (val === 'W') {
          span.className += 'bg-red-600 text-white';
          span.textContent = 'W';
        } else if (val === '4' || val === '6') {
          span.className += 'bg-amber-400 text-slate-950';
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

    // Transient Timing Meter (appears for ~1.5s above the bar after each shot, then fades out)
    const timingEl = document.getElementById('hud-timing');
    if (timingEl) {
      const label = this.lang === 'hi' ? batting.lastContact.timingLabelHi : batting.lastContact.timingLabelEn;
      timingEl.textContent = `${label.split(' ')[0]} (${batting.lastContact.launchAngleDeg}°)`;
    }

    const timingBar = document.getElementById('hud-timing-bar');
    if (timingBar) {
      const pct = Math.round(batting.lastContact.timingQuality * 100);
      timingBar.style.width = `${Math.max(8, pct)}%`;
    }

    if (batting.shotExecutedThisBall && !this.wasShotExecutedLastCheck) {
      this.showTimingToast();
    }
    this.wasShotExecutedLastCheck = Boolean(batting.shotExecutedThisBall);

    this.updateShotModeHUD();
    this.updateRunningHUD();
    this.renderFieldRadar();
    this.syncPhoneMatchHUD();
  }

  syncPhoneMatchHUD() {
    if (!this.app?.net) return;
    const match = this.app.match;
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
    this.app.net.syncMatchStateToControllers({ scoreText, needText, ballStatus });
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

    // Helper to convert 3D world (x, z) to 2D Radar coordinates matching active camera orientation
    const toRadarXY = (wx, wz) => {
      const rx = cx + ((wx * dirSign) / maxFieldRadius) * radius;
      const ry = cy + ((wz * -dirSign) / maxFieldRadius) * radius;
      return [rx, ry];
    };

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

    // 5. Draw Striker (Gold dot)
    const strikerX = this.app.batting?.creaseX || 0;
    const [sx, sy] = toRadarXY(strikerX, 8.8);
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
    ctx.fill();

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
  }

  updateLivePhoneTelemetry(omegaDeg, footwork, p1Connected, latencyMs) {
    this.onPhoneConnectionChange(Boolean(p1Connected), latencyMs);

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
    this.renderFieldRadar();
    this.updateDebugPanel();
  }

  showEventBanner(title, subtitle = '', colorClass = 'text-amber-400') {
    const banner = document.getElementById('hud-event-banner');
    const titleEl = document.getElementById('hud-event-title');
    const subEl = document.getElementById('hud-event-sub');
    if (!banner || !titleEl) return;

    const shortLabel = normalizeShortEventLabel(title);
    titleEl.textContent = shortLabel;
    titleEl.className = `font-display text-2xl md:text-3xl font-extrabold tracking-wider ${colorClass}`;
    if (subEl) {
      if (subtitle) {
        subEl.textContent = subtitle;
        subEl.classList.remove('hidden');
      } else {
        subEl.classList.add('hidden');
      }
    }
    banner.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
    banner.classList.add('opacity-100', 'scale-100');

    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => {
      banner.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
      banner.classList.remove('opacity-100', 'scale-100');
    }, 1800);
  }

  setCommentary(textEn, textHi = '') {
    const el = document.getElementById('hud-commentary');
    if (!el) return;
    el.textContent = this.lang === 'hi' && textHi ? textHi : textEn;
  }

  isAnyModalOpen() {
    const ids = ['modal-qr', 'modal-calibrate', 'modal-setup', 'modal-squad-select', 'modal-scorecard', 'modal-settings'];
    return ids.some((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    });
  }

  openModal(id) {
    const ids = ['modal-qr', 'modal-calibrate', 'modal-setup', 'modal-squad-select', 'modal-scorecard', 'modal-settings'];
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
  }

  closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
    }
    if (this.activeModalId === id) {
      this.activeModalId = null;
    }
    // If the user dismissed Match Setup before confirming the Play Gate, show the Ready-to-Play + QR Gate!
    if (id === 'modal-setup' && !this.app.matchPlayConfirmed) {
      this.openQRModal();
      return;
    }
    if (!this.isAnyModalOpen()) {
      sound.setMenuMusicActive(false);
    }
  }

  closeAllModals() {
    const wasSetupOpen = !document.getElementById('modal-setup')?.classList.contains('hidden');
    const wasQrOpen = !document.getElementById('modal-qr')?.classList.contains('hidden');
    const ids = ['modal-qr', 'modal-calibrate', 'modal-setup', 'modal-squad-select', 'modal-scorecard', 'modal-settings'];
    ids.forEach((id) => {
      document.getElementById(id)?.classList.add('hidden');
    });
    this.activeModalId = null;
    if (wasSetupOpen && !this.app.matchPlayConfirmed) {
      this.openQRModal();
      return;
    }
    if (wasQrOpen && !this.app.matchPlayConfirmed) {
      this.app.confirmPlayAndStartMatch();
      return;
    }
    sound.setMenuMusicActive(false);
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
}
