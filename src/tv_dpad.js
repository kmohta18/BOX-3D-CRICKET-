// Universal Zero-Lag Spatial D-Pad Navigation Engine for Smart TV / Android TV Browsers
// Supports ▲ ▼ ◀ ▶ (DPAD), OK/Enter/Select, and Back/Escape across all 3 screens, modals & pause menu.

export function initTvDpadNavigation(app, ui) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;

  let activeFocusedEl = null;

  const enableTvRing = () => {
    document.body?.classList.add('tv-nav-active');
  };

  // Start with TV ring enabled so TV users immediately see the highlighted focus on boot
  enableTvRing();

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') {
        document.body?.classList.remove('tv-nav-active');
      }
    },
    { passive: true }
  );

  const isElementVisibleAndFocusable = (el) => {
    if (!el || el.disabled) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('.hidden, .md-hidden, [hidden]')) return false;
    // Do not focus inside closed <details> except the <summary> itself
    const details = el.closest('details');
    if (details && !details.open && el.tagName !== 'SUMMARY') return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 6 && rect.height >= 6;
  };

  const getScopeFocusables = (scope) => {
    if (!scope) return [];
    const selector = [
      'button:not([disabled])',
      'a[href]',
      'select:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'summary',
      '[tabindex]:not([tabindex="-1"])'
    ].join(', ');
    return Array.from(scope.querySelectorAll(selector)).filter(isElementVisibleAndFocusable);
  };

  const isVisible = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    if (el.classList.contains('hidden') || el.classList.contains('md-hidden')) return null;
    return el;
  };

  const getActiveScope = () => {
    // 1. Highest priority transient/modal overlays
    const priorityIds = [
      'hud-drs-hawkeye-modal',
      'hud-over-wagon-popup',
      'modal-squad-select',
      'modal-qr',
      'modal-calibrate',
      'modal-scorecard',
      'modal-settings',
      'modal-online-1v1',
      'modal-tv-apk',
      'modal-setup'
    ];
    for (const id of priorityIds) {
      const el = isVisible(id);
      if (el) return { id, el };
    }

    // 2. Corner Pause Menu dropdown during live match
    const corner = isVisible('corner-menu-dropdown');
    if (corner) return { id: 'corner-menu-dropdown', el: corner };

    // 3. 3-Screen Menu Flow: Screen 2 (Game Modes) & Screen 1 (Main Menu)
    const modes = isVisible('md-modes');
    if (modes) return { id: 'md-modes', el: modes };

    const home = isVisible('md-home');
    if (home) return { id: 'md-home', el: home };

    return null;
  };

  const setFocusHighlight = (el) => {
    if (activeFocusedEl && activeFocusedEl !== el) {
      activeFocusedEl.classList.remove('tv-focus-active');
    }
    activeFocusedEl = el || null;
    if (el) {
      el.classList.add('tv-focus-active');
    }
  };

  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && t instanceof HTMLElement && isElementVisibleAndFocusable(t)) {
      setFocusHighlight(t);
    }
  });

  document.addEventListener('focusout', (e) => {
    if (e.target === activeFocusedEl) {
      e.target?.classList?.remove('tv-focus-active');
    }
  });

  const focusElement = (el) => {
    if (!el || !isElementVisibleAndFocusable(el)) return false;
    enableTvRing();
    setFocusHighlight(el);
    try {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch {
      try {
        el.focus();
      } catch {}
    }
    return true;
  };

  const focusScope = (scopeId, preferredSelector = null) => {
    const scopeEl = scopeId ? document.getElementById(scopeId) : getActiveScope()?.el;
    if (!scopeEl) return false;
    const focusables = getScopeFocusables(scopeEl);
    if (!focusables.length) return false;

    let target = null;
    if (preferredSelector) {
      const candidate = scopeEl.querySelector(preferredSelector);
      if (candidate && isElementVisibleAndFocusable(candidate)) {
        target = candidate;
      }
    }
    if (!target) {
      // Check data-tv-default marker
      const def = scopeEl.querySelector('[data-tv-default]');
      if (def && isElementVisibleAndFocusable(def)) {
        target = def;
      }
    }
    if (!target) target = focusables[0];
    return focusElement(target);
  };

  const findBestSpatialNext = (current, dir, candidates) => {
    const r1 = current.getBoundingClientRect();
    const cx1 = r1.left + r1.width * 0.5;
    const cy1 = r1.top + r1.height * 0.5;

    let best = null;
    let bestScore = Infinity;

    for (const cand of candidates) {
      if (cand === current) continue;
      const r2 = cand.getBoundingClientRect();
      const cx2 = r2.left + r2.width * 0.5;
      const cy2 = r2.top + r2.height * 0.5;

      const dx = cx2 - cx1;
      const dy = cy2 - cy1;

      let primary = 0;
      let ortho = 0;
      let overlap = false;

      if (dir === 'right') {
        if (dx <= 6 && r2.right <= r1.right + 4) continue;
        if (dx <= 2) continue;
        primary = dx;
        ortho = Math.abs(dy);
        overlap = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top) > 4;
      } else if (dir === 'left') {
        if (dx >= -6 && r2.left >= r1.left - 4) continue;
        if (dx >= -2) continue;
        primary = -dx;
        ortho = Math.abs(dy);
        overlap = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top) > 4;
      } else if (dir === 'down') {
        if (dy <= 6 && r2.bottom <= r1.bottom + 4) continue;
        if (dy <= 2) continue;
        primary = dy;
        ortho = Math.abs(dx);
        overlap = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left) > 4;
      } else if (dir === 'up') {
        if (dy >= -6 && r2.top >= r1.top - 4) continue;
        if (dy >= -2) continue;
        primary = -dy;
        ortho = Math.abs(dx);
        overlap = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left) > 4;
      }

      // Edge-to-edge gap improves accuracy for wide vs narrow cards in the same row/col
      let gap = primary;
      if (dir === 'right') gap = Math.max(0, r2.left - r1.right) + primary * 0.25;
      else if (dir === 'left') gap = Math.max(0, r1.left - r2.right) + primary * 0.25;
      else if (dir === 'down') gap = Math.max(0, r2.top - r1.bottom) + primary * 0.25;
      else if (dir === 'up') gap = Math.max(0, r1.top - r2.bottom) + primary * 0.25;

      const score = gap + ortho * (overlap ? 1.15 : 2.8) - (overlap ? 180 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    return best;
  };

  const handleBackAction = () => {
    const scope = getActiveScope();
    if (!scope) {
      // Live match -> open Corner Pause Menu so remote-only players can pause/adjust/exit!
      if (ui && typeof ui.toggleCornerMenu === 'function') {
        ui.toggleCornerMenu(true);
        return true;
      }
      return false;
    }

    const { id } = scope;
    if (id === 'hud-over-wagon-popup') {
      ui?.hideOverWagonWheelPopup?.();
      return true;
    }
    if (id === 'corner-menu-dropdown') {
      ui?.toggleCornerMenu?.(false);
      return true;
    }
    if (id === 'modal-setup') {
      if (app?.matchPlayConfirmed) {
        ui?.closeModal?.('modal-setup');
      } else if (window.__middledMenu?.showModes) {
        ui?.closeAllModals?.(true);
        window.__middledMenu.showModes();
      } else {
        ui?.goToHomeScreen?.();
      }
      return true;
    }
    if (id === 'md-modes') {
      window.__middledMenu?.show?.();
      return true;
    }
    if (id === 'modal-qr') {
      if (app?.matchPlayConfirmed) {
        ui?.closeModal?.('modal-qr');
      } else {
        ui?.closeAllModals?.(true);
        ui?.goToHomeScreen?.();
      }
      return true;
    }
    if (['modal-settings', 'modal-online-1v1', 'modal-tv-apk', 'modal-scorecard', 'modal-calibrate', 'modal-squad-select'].includes(id)) {
      if (id === 'modal-calibrate' && app?.batting) {
        app.batting.isCalibrating = false;
      }
      ui?.closeModal?.(id);
      if ((!app?.matchPlayConfirmed || ui?._inMenuFlow) && !ui?.isAnyModalOpen?.()) {
        ui?.goToHomeScreen?.();
      }
      return true;
    }
    // At #md-home (Main Menu): keep cleanly on Main Menu
    return id === 'md-home';
  };

  const getKeyDirection = (e) => {
    const k = e.key;
    const c = e.code;
    const kc = e.keyCode || e.which;
    if (k === 'ArrowUp' || c === 'ArrowUp' || kc === 38 || kc === 19) return 'up';
    if (k === 'ArrowDown' || c === 'ArrowDown' || kc === 40 || kc === 20) return 'down';
    if (k === 'ArrowLeft' || c === 'ArrowLeft' || kc === 37 || kc === 21) return 'left';
    if (k === 'ArrowRight' || c === 'ArrowRight' || kc === 39 || kc === 22) return 'right';
    return null;
  };

  const isSelectKey = (e) => {
    const k = e.key;
    const c = e.code;
    const kc = e.keyCode || e.which;
    return k === 'Enter' || c === 'Enter' || c === 'NumpadEnter' || k === 'Select' || kc === 13 || kc === 23 || kc === 66;
  };

  const isBackKey = (e) => {
    const k = e.key;
    const c = e.code;
    const kc = e.keyCode || e.which;
    if (k === 'Escape' || c === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || k === 'XF86Back' || kc === 4 || kc === 27 || kc === 461) {
      return true;
    }
    if ((k === 'Backspace' || c === 'Backspace' || kc === 8) && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      return true;
    }
    return false;
  };

  window.addEventListener(
    'keydown',
    (e) => {
      const scope = getActiveScope();

      // Back button handling (both in menus/modals and live gameplay pause)
      if (isBackKey(e)) {
        const ae = document.activeElement;
        if (ae && ae.tagName === 'INPUT' && ae.type !== 'range' && ae.type !== 'checkbox' && (e.key === 'Backspace' || e.code === 'Backspace')) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        handleBackAction();
        return;
      }

      // Live gameplay: D-Pad / OK handled by game engine (src/main.js), except Pause shortcut
      if (!scope) return;

      enableTvRing();
      const dir = getKeyDirection(e);
      const ae = document.activeElement;

      // Range sliders: Left/Right adjusts slider value; Up/Down moves to next control
      if (ae && ae.tagName === 'INPUT' && ae.type === 'range' && (dir === 'left' || dir === 'right')) {
        e.preventDefault();
        e.stopPropagation();
        const step = parseFloat(ae.step) || (parseFloat(ae.max) - parseFloat(ae.min)) / 20 || 1;
        const cur = parseFloat(ae.value) || 0;
        const min = parseFloat(ae.min) ?? 0;
        const max = parseFloat(ae.max) ?? 100;
        const nextVal = Math.max(min, Math.min(max, cur + (dir === 'right' ? step : -step)));
        ae.value = String(nextVal);
        ae.dispatchEvent(new Event('input', { bubbles: true }));
        ae.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      // Text inputs: allow typing & Left/Right caret; Up/Down escapes cleanly
      if (ae && ae.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(ae.type)) {
        if (dir === 'left' || dir === 'right') return;
        if (isSelectKey(e)) return;
      }

      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        const focusables = getScopeFocusables(scope.el);
        if (!focusables.length) return;

        if (!ae || !scope.el.contains(ae) || !isElementVisibleAndFocusable(ae)) {
          focusScope(scope.id);
          return;
        }

        const next = findBestSpatialNext(ae, dir, focusables);
        if (next) {
          focusElement(next);
        }
        return;
      }

      if (isSelectKey(e) || (e.code === 'Space' && scope.id !== 'modal-qr' && ae?.tagName !== 'INPUT')) {
        const focusables = getScopeFocusables(scope.el);
        const cur = ae && scope.el.contains(ae) && isElementVisibleAndFocusable(ae) ? ae : focusables[0];
        if (!cur) return;

        e.preventDefault();
        e.stopPropagation();

        if (cur.tagName === 'SELECT') {
          const opts = Array.from(cur.options).filter((o) => !o.disabled);
          if (opts.length > 0) {
            const curIdx = cur.selectedIndex;
            const nextIdx = (curIdx + 1) % cur.options.length;
            cur.selectedIndex = nextIdx;
            cur.dispatchEvent(new Event('change', { bubbles: true }));
            const txt = cur.options[nextIdx]?.textContent?.trim();
            if (txt && ui?.showStatusToast) {
              ui.showStatusToast(txt, true);
            }
          }
          return;
        }

        if (cur.tagName === 'INPUT' && cur.type === 'checkbox') {
          cur.checked = !cur.checked;
          cur.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }

        cur.click();
      }
    },
    true
  );

  const api = {
    getActiveScope,
    focusScope,
    focusElement,
    handleBackAction
  };
  window.__tvDpad = api;

  // Native Android TV APK Back Button Hook: returns 'home' at Main Menu (enabling double-back exit) or 'handled'
  window.__androidTvBackPress = () => {
    const scope = getActiveScope();
    if (scope && scope.id === 'md-home') {
      return 'home';
    }
    handleBackAction();
    return 'handled';
  };

  return api;
}
