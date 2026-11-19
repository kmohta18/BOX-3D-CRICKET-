// 3-Screen Smart TV Menu Controller: Screen 1 (#md-home) -> Screen 2 (#md-modes) -> Screen 3 (#modal-setup)
import { sound } from '../assets/audio.js';

const STADIUMS = [
  { id: 'eden_gardens', name: 'Eden Gardens' },
  { id: 'wankhede', name: 'Wankhede Stadium' },
  { id: 'narendra_modi', name: 'Narendra Modi' }
];

export function initMiddledMenu(app) {
  const root = document.getElementById('md-home');
  const modesRoot = document.getElementById('md-modes');
  if (!root) {
    app.ui.openModal('modal-setup');
    return null;
  }

  const ui = app.ui;
  const $ = (sel) => root.querySelector(sel);

  const isHomeVisible = () => !root.classList.contains('md-hidden');
  const isModesVisible = () => Boolean(modesRoot && !modesRoot.classList.contains('md-hidden'));

  const refreshVenue = () => {
    const cur = STADIUMS.find((s) => s.id === app.match.stadium) || STADIUMS[0];
    const name = $('#md-venue-name');
    if (name) name.textContent = cur.name;

    const dnText = app.match.timeOfDay === 'day' ? 'Day' : 'Night';
    const lbl = $('#md-daynight-label');
    if (lbl) lbl.textContent = dnText;

    const previewTitle = $('#md-arena-preview-title');
    if (previewTitle) previewTitle.textContent = cur.name;

    const teamA = app.match?.teamA?.short || 'IND';
    const teamB = app.match?.teamB?.short || 'AUS';
    const previewSub = $('#md-arena-preview-sub');
    if (previewSub) {
      previewSub.textContent = `${dnText === 'Day' ? 'Sunny Day' : 'Night Floodlights'} · ${teamA} vs ${teamB}`;
    }

    const modesPill = document.getElementById('md-modes-context-pill');
    if (modesPill) {
      modesPill.textContent = `${cur.name} · ${dnText} · ${teamA} v ${teamB}`;
    }

    const p1Connected = Boolean(app.net?.controllers?.p1?.connected);
    const roomCode = app.net?.roomCode || 'CRIC';
    const pillLbl = $('#md-phone-pill-lbl');
    if (pillLbl) {
      pillLbl.textContent = p1Connected ? `PHONE READY (${roomCode})` : 'PAIR PHONE (QR)';
    }
    const qrSub = $('#md-qr-card-sub');
    if (qrSub) {
      qrSub.textContent = p1Connected
        ? `Connected (Room ${roomCode}) · 3D Gyro Bat Active`
        : `Room ${roomCode} · Scan QR to swing with your phone`;
    }
    const noteEl = $('#md-live-conn-note');
    if (noteEl) {
      noteEl.textContent = p1Connected
        ? `🟢 Phone Controller Connected (${roomCode}) · 🌐 Online 1v1 Ready`
        : `📱 Room ${roomCode}: Pair Phone (QR) for 3D Gyro Bat · 🌐 Online 1v1 Ready`;
    }
  };

  const hide = () => {
    root.classList.add('md-hidden');
    if (modesRoot) modesRoot.classList.add('md-hidden');
    ui.syncVirtualControlsVisibility?.();
    ui.syncPhoneMatchHUD?.();
  };

  const show = () => {
    ui._inMenuFlow = true;
    ui.closeAllModals?.(true);
    if (modesRoot) modesRoot.classList.add('md-hidden');
    root.classList.remove('md-hidden');
    refreshVenue();
    ui.syncVirtualControlsVisibility?.();
    ui.syncPhoneMatchHUD?.();
    setTimeout(() => {
      if (window.__tvDpad?.focusScope) {
        window.__tvDpad.focusScope('md-home', '[data-tv-default]');
      } else {
        $('[data-md="play"]')?.focus({ preventScroll: true });
      }
    }, 20);
  };

  const showModes = () => {
    ui._inMenuFlow = true;
    ui.closeAllModals?.(true);
    root.classList.add('md-hidden');
    if (!modesRoot) {
      ui.openModal('modal-setup');
      return;
    }
    modesRoot.classList.remove('md-hidden');
    refreshVenue();
    ui.syncVirtualControlsVisibility?.();
    ui.syncPhoneMatchHUD?.();
    setTimeout(() => {
      const curMode = ui.setupMode || 'run_chase';
      const pref = `[data-mode-pick="${curMode}"]`;
      if (window.__tvDpad?.focusScope) {
        window.__tvDpad.focusScope('md-modes', pref);
      } else {
        modesRoot.querySelector(pref)?.focus({ preventScroll: true });
      }
    }, 20);
  };

  const setVenue = (id) => {
    app.setStadium(id, app.match.timeOfDay);
    ui.syncStadiumAndDayNightUI(app.match.stadium, app.match.timeOfDay);
    refreshVenue();
  };

  const startQuick = () => {
    sound.playUIClick?.(1240);
    hide();
    ui.updateSetupModeUI('run_chase');
    ui.closeAllModals(true);
    app.startConfiguredMatchFromUI(true);
    app.confirmPlayAndStartMatch();
  };

  const actions = {
    play: () => {
      sound.playUIClick?.(1180);
      showModes();
    },
    quick: startQuick,
    setup: () => {
      sound.playUIClick?.(1180);
      showModes();
    },
    t20: () => {
      sound.playUIClick?.(1180);
      hide();
      ui.updateSetupModeUI('t20');
      ui.openModal('modal-setup');
    },
    qr: () => {
      sound.playUIClick?.(1180);
      hide();
      ui.openQRModal();
    },
    online: () => {
      sound.playUIClick?.(1180);
      hide();
      if (document.getElementById('modal-online-1v1')) {
        ui.syncOnline1v1ModalUI?.();
        ui.openModal('modal-online-1v1');
      } else {
        ui.openQRModal();
      }
    },
    stadium: () => {
      sound.playUIClick?.(1080);
      const i = STADIUMS.findIndex((s) => s.id === app.match.stadium);
      setVenue(STADIUMS[(i + 1) % STADIUMS.length].id);
    },
    daynight: () => {
      sound.playUIClick?.(1080);
      app.toggleNightMode();
      refreshVenue();
    },
    fullscreen: () => {
      sound.playUIClick?.(1120);
      ui.toggleFullScreen?.();
    },
    settings: () => {
      sound.playUIClick?.(1180);
      hide();
      ui.populateSpeechVoicesSelect?.();
      ui.syncSettingsControlsFromConfig?.();
      ui.openModal('modal-settings');
    }
  };

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-md]');
    if (!btn) return;
    actions[btn.dataset.md]?.();
  });

  if (modesRoot) {
    document.getElementById('btn-modes-back')?.addEventListener('click', () => {
      sound.playUIClick?.(980);
      show();
    });

    modesRoot.addEventListener('click', (e) => {
      const card = e.target.closest('[data-mode-pick]');
      if (!card) return;
      sound.playUIClick?.(1260);
      const modeId = card.getAttribute('data-mode-pick') || 'run_chase';
      ui._inMenuFlow = true;
      ui._userRerolledTarget = false;
      hide();
      ui.syncSettingsControlsFromConfig?.();
      ui.updateSetupModeUI(modeId);
      if (modeId === 'run_chase' || modeId === 'last_over') {
        ui.refreshRunChaseTargetPreview(true);
      }
      ui.openModal('modal-setup');
    });
  }

  // Prevent in-game match hotkeys from triggering while browsing Screen 1 or Screen 2
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isHomeVisible() && !isModesVisible()) return;
      if (['Space', 'KeyG', 'KeyF', 'KeyR', 'KeyN'].includes(e.code)) {
        e.stopPropagation();
      }
    },
    true
  );

  document.getElementById('modal-setup')?.classList.add('hidden');
  ui.activeModalId = null;

  window.__middledMenu = { show, showModes, hide, refreshVenue };
  show();
  return { show, showModes, hide, refreshVenue };
}
