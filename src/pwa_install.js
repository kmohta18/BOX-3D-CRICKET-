// PWA Service Worker Registration, In-App Install Prompt, Android TV APK Guide & Offline Banner
import { sound } from '../assets/audio.js';

export function initPwaInstall(app, ui) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;

  let deferredPrompt = null;

  const isRunningStandaloneOrApk = () => {
    const standaloneMatch =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
      window.navigator?.standalone === true;
    const isApk =
      Boolean(window.__ANDROID_TV_APK__) ||
      /BoxCricketAndroidTV/i.test(window.navigator?.userAgent || '');
    return Boolean(standaloneMatch || isApk);
  };

  const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator?.userAgent || '');

  // 1. Register lightweight network-first service worker
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Ignore SW errors in restricted preview iframes
    });
  }

  const installBtn = document.getElementById('btn-md-install-app');
  const installBtnLabel = document.getElementById('lbl-md-install-app');
  const modalTriggerBtn = document.getElementById('btn-tv-apk-native-install');
  const iosSection = document.getElementById('tv-apk-ios-guide');
  const liveUrlEl = document.getElementById('tv-apk-live-url');
  const copyUrlBtn = document.getElementById('btn-tv-apk-copy-url');
  const offlineBanner = document.getElementById('pwa-offline-banner');

  const getHostedUrl = () => {
    const shared = app?.net?.sharedUrl || '';
    if (shared && shared.startsWith('http')) return shared.replace(/\/$/, '');
    return window.location.origin.replace('//ais-dev-', '//ais-pre-');
  };

  const syncInstallUI = () => {
    const installed = isRunningStandaloneOrApk();
    if (installBtn) {
      installBtn.classList.toggle('hidden', installed);
    }
    if (installBtnLabel) {
      if (deferredPrompt) {
        installBtnLabel.textContent = 'Install App';
      } else if (isIOS()) {
        installBtnLabel.textContent = 'Install iOS';
      } else {
        installBtnLabel.textContent = 'TV APK';
      }
    }
    if (modalTriggerBtn) {
      modalTriggerBtn.classList.toggle('hidden', !deferredPrompt);
    }
    if (iosSection) {
      iosSection.classList.toggle('hidden', !isIOS());
    }
    if (liveUrlEl) {
      liveUrlEl.textContent = getHostedUrl();
    }
  };

  const syncOnlineBanner = () => {
    if (!offlineBanner) return;
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    offlineBanner.classList.toggle('hidden', online);
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    syncInstallUI();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    syncInstallUI();
    ui?.showStatusToast?.('✅ Box Cricket 3D Installed!', true);
  });

  window.addEventListener('online', syncOnlineBanner);
  window.addEventListener('offline', syncOnlineBanner);

  const triggerNativeInstall = async () => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredPrompt = null;
        syncInstallUI();
        return true;
      }
    } catch {}
    return false;
  };

  const openInstallOrApkModal = () => {
    sound.playUIClick?.(1180);
    syncInstallUI();
    ui?.openModal?.('modal-tv-apk');
  };

  installBtn?.addEventListener('click', async () => {
    sound.playUIClick?.(1180);
    if (deferredPrompt) {
      const ok = await triggerNativeInstall();
      if (ok) return;
    }
    openInstallOrApkModal();
  });

  modalTriggerBtn?.addEventListener('click', async () => {
    sound.playUIClick?.(1220);
    await triggerNativeInstall();
  });

  copyUrlBtn?.addEventListener('click', async () => {
    sound.playUIClick?.(1180);
    const url = getHostedUrl();
    try {
      await navigator.clipboard.writeText(url);
      copyUrlBtn.textContent = '✅ Copied Live URL!';
      setTimeout(() => {
        copyUrlBtn.textContent = '📋 Copy Hosted URL';
      }, 1800);
    } catch {
      ui?.showStatusToast?.(`URL: ${url}`, true);
    }
  });

  document.getElementById('btn-close-tv-apk')?.addEventListener('click', () => {
    sound.playUIClick?.(980);
    ui?.closeModal?.('modal-tv-apk');
  });

  syncInstallUI();
  syncOnlineBanner();

  // Re-sync URL after /api/info resolves sharedUrl
  setTimeout(syncInstallUI, 1200);

  return { syncInstallUI, openInstallOrApkModal, triggerNativeInstall };
}
