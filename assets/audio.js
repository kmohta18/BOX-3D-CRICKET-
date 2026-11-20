import { gameConfig, saveGameConfig } from '../config.js';

/**
 * Pure Web Audio API Procedural Sound Engine & Multi-Bus Mixer (assets/audio.js)
 * Zero external audio files or network requests.
 *
 * Synthesizes:
 * - Bat Hit (3 variants: 'sweet', 'thick_edge', 'thin_edge') scaled by bat speed & timing + stereo pan
 * - Pitch Bounce (surface-aware) & Outfield Bounce
 * - Ball on Pads (hollow muffled thud)
 * - Stumps & Bails Timber Clatter
 * - Keeper's Gloves Pop & Catch Thud
 * - Outfield Ball Rolling Grass Rustle & Boundary Rope Impact
 * - Running Footsteps & Rhythmic Breathing
 * - Umpire Signal Tone & Crisp UI Clicks
 * - Loopable Procedural Menu Music (warm ambient synth pad & marimba arpeggio)
 * - Continuous Crowd Ambience Loop scaled by Match Tension
 * - Crowd Reactions: Four Roar, Six Mega-Roar, Near-Miss Gasp, Dropped-Catch Groan, Wicket Cheer, Close-Chase Tension
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.initialized = false;
    this.userInteracted = false;
    this.tabHidden = typeof document !== 'undefined' ? Boolean(document.hidden) : false;

    // Mixer buses
    this.masterGain = null;
    this.effectsGain = null;
    this.crowdGain = null;
    this.musicGain = null;
    this.commentaryGain = null;

    // Reusable noise buffers
    this.whiteNoiseBuf = null;
    this.pinkNoiseBuf = null;

    // Crowd ambience loop nodes
    this.crowdAmbienceSource = null;
    this.crowdAmbienceFilter = null;
    this.crowdAmbienceNodeGain = null;
    this.matchTension = 0.22; // 0.0 (calm) -> 1.0 (nail-biting final over chase)

    // Menu music loop state
    this.menuMusicActive = false;
    this.menuMusicTimer = null;
    this.menuMusicStep = 0;

    // Rolling sound throttle
    this.lastRollSoundMs = 0;
    this.lastStepSoundMs = 0;
    this.stepCounter = 0;

    this.setupInteractionAndVisibilityListeners();
  }

  get enabled() {
    return !gameConfig.audio.muted;
  }

  set enabled(val) {
    gameConfig.audio.muted = !val;
    this.syncMixerGains();
    saveGameConfig();
  }

  setupInteractionAndVisibilityListeners() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const unlock = () => {
      this.userInteracted = true;
      this.init();
    };

    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true, passive: true });
    window.addEventListener('touchstart', unlock, { once: true, passive: true });

    document.addEventListener('visibilitychange', () => {
      this.tabHidden = Boolean(document.hidden);
      this.syncMixerGains();
      if (this.ctx) {
        if (this.tabHidden && this.ctx.state === 'running') {
          this.ctx.suspend().catch(() => {});
        } else if (!this.tabHidden && this.userInteracted && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      }
    });
  }

  init() {
    if (!this.userInteracted) {
      this.userInteracted = true;
    }
    if (this.ctx) {
      if (!this.tabHidden && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.syncMixerGains();
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.effectsGain = this.ctx.createGain();
      this.crowdGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.commentaryGain = this.ctx.createGain();

      this.effectsGain.connect(this.masterGain);
      this.crowdGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.commentaryGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.buildSharedNoiseBuffers();
      this.syncMixerGains();
      this.startCrowdAmbienceLoop();
      this.initialized = true;
    } catch {
      // Ignore Web Audio errors in headless environments
    }
  }

  buildSharedNoiseBuffers() {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    const len = sr * 3;

    // 1. White noise buffer (3s)
    this.whiteNoiseBuf = this.ctx.createBuffer(1, len, sr);
    const wData = this.whiteNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      wData[i] = Math.random() * 2 - 1;
    }

    // 2. Pink-ish noise buffer (3s) for warm stadium crowd murmur & turf friction
    this.pinkNoiseBuf = this.ctx.createBuffer(1, len, sr);
    const pData = this.pinkNoiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      pData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
      b6 = white * 0.115926;
    }
  }

  /**
   * Updates Master, Effects, Crowd, Music, and Commentary levels & Mute state
   */
  setMixerLevels(partial = {}) {
    Object.assign(gameConfig.audio, partial);
    if (typeof partial.commentary === 'number') {
      gameConfig.commentary.volume = partial.commentary;
    }
    this.syncMixerGains();
    saveGameConfig();
  }

  syncMixerGains() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const a = gameConfig.audio;
    const masterVal = a.muted || this.tabHidden ? 0.0001 : Math.max(0.0001, a.master);

    this.masterGain.gain.setTargetAtTime(masterVal, now, 0.03);
    this.effectsGain.gain.setTargetAtTime(Math.max(0.0001, a.effects), now, 0.03);
    this.crowdGain.gain.setTargetAtTime(Math.max(0.0001, a.crowd), now, 0.03);
    this.musicGain.gain.setTargetAtTime(Math.max(0.0001, a.music), now, 0.04);
    if (this.commentaryGain) {
      const commVol = a.commentary ?? gameConfig.commentary?.volume ?? 0.85;
      this.commentaryGain.gain.setTargetAtTime(Math.max(0.0001, commVol), now, 0.03);
    }

    if (this.crowdAmbienceNodeGain && this.crowdAmbienceFilter) {
      const baseCrowd = 0.08 + this.matchTension * 0.24;
      this.crowdAmbienceNodeGain.gain.setTargetAtTime(baseCrowd, now, 0.25);
      this.crowdAmbienceFilter.frequency.setTargetAtTime(420 + this.matchTension * 540, now, 0.25);
    }
  }

  /**
   * Helper to route a node through a StereoPannerNode (-1 left to +1 right) into a bus
   */
  connectWithPan(sourceNode, targetBus, pan = 0) {
    if (!this.ctx) return;
    const clampedPan = Math.max(-0.95, Math.min(0.95, Number(pan) || 0));
    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(clampedPan, this.ctx.currentTime);
      sourceNode.connect(panner);
      panner.connect(targetBus || this.effectsGain);
    } else {
      sourceNode.connect(targetBus || this.effectsGain);
    }
  }

  canPlay() {
    if (!this.userInteracted || this.tabHidden || gameConfig.audio.muted) return false;
    if (!this.ctx) this.init();
    return Boolean(this.ctx);
  }

  /**
   * Continuous Crowd Ambience Loop whose volume & brightness follow match tension
   */
  startCrowdAmbienceLoop() {
    if (!this.ctx || !this.pinkNoiseBuf || this.crowdAmbienceSource) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.pinkNoiseBuf;
      src.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 520;
      filter.Q.value = 0.75;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.12;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.crowdGain);
      src.start(0);

      this.crowdAmbienceSource = src;
      this.crowdAmbienceFilter = filter;
      this.crowdAmbienceNodeGain = gain;
    } catch {}
  }

  /**
   * Adjusts stadium crowd tension (0.15 calm -> 1.0 nail-biting chase / hat-trick ball)
   */
  setMatchTension(tension = 0.25) {
    this.matchTension = Math.max(0.1, Math.min(1.0, tension));
    this.syncMixerGains();
  }

  /**
   * Starts or stops the soft loopable procedural Menu Music
   */
  setMenuMusicActive(active = false) {
    this.menuMusicActive = Boolean(active);
    if (!this.menuMusicActive) {
      if (this.menuMusicTimer) {
        clearInterval(this.menuMusicTimer);
        this.menuMusicTimer = null;
      }
      return;
    }
    if (this.menuMusicTimer) return;

    // Gentle pentatonic progression (C4, D4, E4, G4, A4, C5)
    const notes = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 392.00, 329.63];
    this.menuMusicTimer = setInterval(() => {
      if (!this.menuMusicActive || !this.canPlay() || gameConfig.audio.music <= 0.01) return;
      const now = this.ctx.currentTime;
      const freq = notes[this.menuMusicStep % notes.length];
      this.menuMusicStep++;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.85);

      osc.connect(gain);
      gain.connect(this.musicGain);
      osc.start(now);
      osc.stop(now + 0.9);
    }, 520);
  }

  /**
   * 1. Bat Hit with 3 distinct variants ('sweet', 'thick_edge', 'thin_edge'),
   * dynamic loudness from bat speed & timing, and stereo pan
   */
  playBatHit(power = 0.8, isSweetSpot = true, variant = null, pan = 0) {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;

    const resolvedVariant =
      variant || (isSweetSpot ? 'sweet' : power > 0.45 ? 'thick_edge' : 'thin_edge');
    const clampedPower = Math.max(0.15, Math.min(1.15, power));

    if (resolvedVariant === 'thin_edge') {
      // Thin edge: high-frequency woody tick/snick
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1450, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.032);
      gain.gain.setValueAtTime(0.28 * clampedPower, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      osc.connect(gain);
      this.connectWithPan(gain, this.effectsGain, pan);
      osc.start(now);
      osc.stop(now + 0.04);

      if (this.whiteNoiseBuf) {
        const nSrc = this.ctx.createBufferSource();
        nSrc.buffer = this.whiteNoiseBuf;
        const filt = this.ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.setValueAtTime(3600, now);
        filt.Q.setValueAtTime(3.2, now);
        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.35 * clampedPower, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
        nSrc.connect(filt);
        filt.connect(nGain);
        this.connectWithPan(nGain, this.effectsGain, pan);
        nSrc.start(now, 0, 0.035);
      }
      return;
    }

    if (resolvedVariant === 'thick_edge') {
      // Thick edge: hollow off-center splice knock
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(88, now + 0.065);
      gain.gain.setValueAtTime(0.42 * clampedPower, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      this.connectWithPan(gain, this.effectsGain, pan);
      osc.start(now);
      osc.stop(now + 0.075);

      if (this.whiteNoiseBuf) {
        const nSrc = this.ctx.createBufferSource();
        nSrc.buffer = this.whiteNoiseBuf;
        const filt = this.ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.setValueAtTime(2200, now);
        filt.Q.setValueAtTime(2.4, now);
        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.38 * clampedPower, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        nSrc.connect(filt);
        filt.connect(nGain);
        this.connectWithPan(nGain, this.effectsGain, pan);
        nSrc.start(now, 0, 0.05);
      }
      return;
    }

    // Sweet Spot Crack: 4-Layer Acoustic Model (Chest Thump + Deep Willow Thump + Blade Resonance + Leather Crack)
    const thumpOsc = this.ctx.createOscillator();
    const thumpGain = this.ctx.createGain();
    thumpOsc.type = 'sine';
    thumpOsc.frequency.setValueAtTime(118 + clampedPower * 24, now);
    thumpOsc.frequency.exponentialRampToValueAtTime(38, now + 0.085);
    thumpGain.gain.setValueAtTime(Math.min(0.95, 0.36 * clampedPower), now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    thumpOsc.connect(thumpGain);
    this.connectWithPan(thumpGain, this.effectsGain, pan);
    thumpOsc.start(now);
    thumpOsc.stop(now + 0.095);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = 225 + clampedPower * 95;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.105);

    gain.gain.setValueAtTime(Math.min(1.0, 0.52 + clampedPower * 0.55), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.112);

    osc.connect(gain);
    this.connectWithPan(gain, this.effectsGain, pan);
    osc.start(now);
    osc.stop(now + 0.118);

    // Layer 2: English Willow sweet-spot harmonic ring
    const ringOsc = this.ctx.createOscillator();
    const ringGain = this.ctx.createGain();
    ringOsc.type = 'sine';
    ringOsc.frequency.setValueAtTime(580 + clampedPower * 135, now);
    ringOsc.frequency.exponentialRampToValueAtTime(295, now + 0.07);
    ringGain.gain.setValueAtTime(0.30 * clampedPower, now);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    ringOsc.connect(ringGain);
    this.connectWithPan(ringGain, this.effectsGain, pan);
    ringOsc.start(now);
    ringOsc.stop(now + 0.08);

    if (this.whiteNoiseBuf) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.whiteNoiseBuf;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1480, now);
      filter.Q.setValueAtTime(1.6, now);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(Math.min(0.98, 0.34 + clampedPower * 0.64), now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.058);

      noise.connect(filter);
      filter.connect(nGain);
      this.connectWithPan(nGain, this.effectsGain, pan);
      noise.start(now, 0, 0.062);
    }
  }

  playEdgeNick(isThick = false, pan = 0) {
    this.playBatHit(isThick ? 0.55 : 0.35, false, isThick ? 'thick_edge' : 'thin_edge', pan);
  }

  /**
   * 2. Ball Bounce on Pitch or Outfield
   */
  playPitchBounce(surface = 'normal', speedKmh = 130, pan = 0) {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';

    const freqMap = {
      hard: 185,
      street: 195,
      green: 145,
      normal: 138,
      night: 148,
      club: 122,
      dusty: 108
    };
    const startFreq = freqMap[surface] || 138;
    const velScale = Math.max(0.4, Math.min(1.1, speedKmh / 135));

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.06);

    gain.gain.setValueAtTime(0.36 * velScale, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    osc.connect(gain);
    this.connectWithPan(gain, this.effectsGain, pan);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  /**
   * 3. Ball on Pads (LBW / Pad impact thud)
   */
  playPadHit(pan = 0) {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(142, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.085);

    gain.gain.setValueAtTime(0.48, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    this.connectWithPan(gain, this.effectsGain, pan);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  /**
   * 4. Ball Hitting Stumps with Bails Flying
   */
  playStumpsHit(pan = 0) {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;
    const freqs = [410, 565, 335, 690, 820];
    freqs.forEach((f, idx) => {
      const t = now + idx * 0.028;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx >= 3 ? 'triangle' : 'square';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.42, t + 0.075);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1950, t);

      gain.gain.setValueAtTime(0.34, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(filter);
      filter.connect(gain);
      this.connectWithPan(gain, this.effectsGain, pan);
      osc.start(t);
      osc.stop(t + 0.085);
    });
  }

  /**
   * 5. Ball Into Keeper's Gloves
   */
  playKeeperGloves(speedKmh = 130, pan = 0) {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(175, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.055);

    const vol = Math.min(0.45, 0.22 + (speedKmh / 150) * 0.22);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    this.connectWithPan(gain, this.effectsGain, pan);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  /**
   * 6. Fielder Catch Thud
   */
  playCatchThud(pan = 0) {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.075);
    gain.gain.setValueAtTime(0.46, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    this.connectWithPan(gain, this.effectsGain, pan);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  /**
   * 7. Ball Rolling on the Outfield Turf
   */
  playBallRolling(speedMs = 8, pan = 0) {
    if (!this.canPlay() || !this.pinkNoiseBuf) return;
    const nowMs = performance.now();
    if (nowMs - this.lastRollSoundMs < 180) return;
    this.lastRollSoundMs = nowMs;

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.pinkNoiseBuf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(950 + Math.min(600, speedMs * 25), now);
    filter.Q.setValueAtTime(1.5, now);

    const gain = this.ctx.createGain();
    const vol = Math.min(0.16, Math.max(0.03, (speedMs / 25) * 0.14));
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    src.connect(filter);
    filter.connect(gain);
    this.connectWithPan(gain, this.effectsGain, pan);
    src.start(now, Math.random() * 1.5, 0.16);
  }

  /**
   * 8. Boundary Rope Impact & Bell Chime
   */
  playBoundaryRope(pan = 0) {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;

    // Cushion thud
    const thud = this.ctx.createOscillator();
    const tGain = this.ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(115, now);
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.11);
    tGain.gain.setValueAtTime(0.45, now);
    tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    thud.connect(tGain);
    this.connectWithPan(tGain, this.effectsGain, pan);
    thud.start(now);
    thud.stop(now + 0.13);

    // Broadcast boundary chime
    [880, 1174.66].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.07);
      g.gain.setValueAtTime(0.18, now + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.28);
      osc.connect(g);
      this.connectWithPan(g, this.effectsGain, pan);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.30);
    });
  }

  /**
   * 9. Footsteps and Breathing While Running Between the Wickets
   */
  playFootstepAndBreath(cadenceHz = 2.5) {
    if (!this.canPlay()) return;
    const nowMs = performance.now();
    const minGapMs = Math.max(150, 750 / Math.max(1.2, cadenceHz));
    if (nowMs - this.lastStepSoundMs < minGapMs) return;
    this.lastStepSoundMs = nowMs;
    this.stepCounter++;

    const now = this.ctx.currentTime;
    const isLeft = this.stepCounter % 2 === 0;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isLeft ? 108 : 122, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.055);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    this.connectWithPan(gain, this.effectsGain, isLeft ? -0.15 : 0.15);
    osc.start(now);
    osc.stop(now + 0.065);

    // Subtle breath every 2nd step
    if (this.stepCounter % 2 === 0 && this.pinkNoiseBuf) {
      const bSrc = this.ctx.createBufferSource();
      bSrc.buffer = this.pinkNoiseBuf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.setValueAtTime(780, now);
      filt.Q.setValueAtTime(2.2, now);
      const bGain = this.ctx.createGain();
      bGain.gain.setValueAtTime(0.08, now);
      bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      bSrc.connect(filt);
      filt.connect(bGain);
      bGain.connect(this.effectsGain);
      bSrc.start(now, 0.2, 0.13);
    }
  }

  /**
   * 10. Umpire Signal Tone & Whistle
   */
  playUmpireSignal(signalType = 'whistle') {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';

    if (signalType === 'no_ball' || signalType === 'free_hit') {
      osc.frequency.setValueAtTime(1950, now);
      osc.frequency.setValueAtTime(2600, now + 0.09);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain);
      gain.connect(this.effectsGain);
      osc.start(now);
      osc.stop(now + 0.28);
      return;
    }

    osc.frequency.setValueAtTime(2750, now);
    osc.frequency.setValueAtTime(2920, now + 0.07);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
    osc.connect(gain);
    gain.connect(this.effectsGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  playWhistle() {
    this.playUmpireSignal('whistle');
  }

  /**
   * 11. Crisp Tactile UI Click
   */
  playUIClick(freq = 1250) {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.022);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
    osc.connect(gain);
    gain.connect(this.effectsGain);
    osc.start(now);
    osc.stop(now + 0.028);
  }

  playCoinFlip() {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, now);
    osc.frequency.exponentialRampToValueAtTime(3200, now + 0.25);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.effectsGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /**
   * 12. Dynamic Crowd Reactions:
   * - 'four': Roar for four
   * - 'six': Bigger multi-layered roar for six
   * - 'wicket': High-energy cheer for a wicket
   * - 'near_miss': Collective sharp gasp ("Ooooh!")
   * - 'dropped_catch': Collective stadium groan ("Awwww!")
   * - 'chase_tension': Rising swell in a close chase
   */
  playCrowdReaction(type = 'four', pan = 0) {
    if (!this.canPlay() || !this.pinkNoiseBuf) return;
    const now = this.ctx.currentTime;

    const presets = {
      four: { dur: 2.1, peakGain: 0.48, fStart: 620, fPeak: 1180, fEnd: 540, q: 1.0 },
      six: { dur: 2.9, peakGain: 0.72, fStart: 680, fPeak: 1520, fEnd: 620, q: 0.85 },
      wicket: { dur: 2.7, peakGain: 0.68, fStart: 640, fPeak: 1420, fEnd: 580, q: 0.9 },
      near_miss: { dur: 1.05, peakGain: 0.42, fStart: 980, fPeak: 720, fEnd: 380, q: 2.4 },
      dropped_catch: { dur: 1.55, peakGain: 0.46, fStart: 640, fPeak: 420, fEnd: 240, q: 2.1 },
      chase_tension: { dur: 2.2, peakGain: 0.38, fStart: 480, fPeak: 920, fEnd: 760, q: 1.2 }
    };
    const p = presets[type] || presets.four;

    const src = this.ctx.createBufferSource();
    src.buffer = this.pinkNoiseBuf;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(p.fStart, now);
    filter.frequency.linearRampToValueAtTime(p.fPeak, now + p.dur * 0.32);
    filter.frequency.linearRampToValueAtTime(p.fEnd, now + p.dur);
    filter.Q.setValueAtTime(p.q, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(p.peakGain, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.001, now + p.dur);

    src.connect(filter);
    filter.connect(gain);
    this.connectWithPan(gain, this.crowdGain, pan * 0.5);
    src.start(now);
    src.stop(now + p.dur + 0.05);

    // Extra celebratory stadium horn chord & rhythmic Indian stadium dhol beats on FOUR, SIX, or WICKET
    if (type === 'six' || type === 'wicket' || type === 'four') {
      const dholBeats = type === 'six' ? [0.06, 0.24, 0.38, 0.56, 0.74, 0.92] : [0.08, 0.28, 0.46, 0.66];
      dholBeats.forEach((delay, idx) => {
        const dOsc = this.ctx.createOscillator();
        const dGain = this.ctx.createGain();
        dOsc.type = 'triangle';
        const isHighBeat = idx % 2 === 1;
        dOsc.frequency.setValueAtTime(isHighBeat ? 168 : 112, now + delay);
        dOsc.frequency.exponentialRampToValueAtTime(isHighBeat ? 82 : 54, now + delay + 0.11);
        dGain.gain.setValueAtTime(0.18, now + delay);
        dGain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.12);
        dOsc.connect(dGain);
        this.connectWithPan(dGain, this.crowdGain, (idx % 2 === 0 ? -0.25 : 0.25) + pan * 0.3);
        dOsc.start(now + delay);
        dOsc.stop(now + delay + 0.13);
      });
    }

    if (type === 'six' || type === 'wicket') {
      const horn = this.ctx.createOscillator();
      const hGain = this.ctx.createGain();
      horn.type = 'sawtooth';
      horn.frequency.setValueAtTime(type === 'six' ? 440 : 392, now + 0.08);
      horn.frequency.linearRampToValueAtTime(type === 'six' ? 587.33 : 523.25, now + 0.45);
      hGain.gain.setValueAtTime(0.001, now + 0.08);
      hGain.gain.linearRampToValueAtTime(0.09, now + 0.18);
      hGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
      horn.connect(hGain);
      this.connectWithPan(hGain, this.crowdGain, pan * 0.4);
      horn.start(now + 0.08);
      horn.stop(now + 1.0);
    }
  }

  playCrowdCheer(intensity = 0.8, duration = 2.2, pan = 0) {
    if (intensity >= 0.98 || duration >= 2.7) {
      this.playCrowdReaction('six', pan);
    } else if (intensity >= 0.88) {
      this.playCrowdReaction('wicket', pan);
    } else {
      this.playCrowdReaction('four', pan);
    }
  }

  /**
   * 13. Broadcast Commentary Cue & Formant Voice Cadence
   * Guarantees audible commentary sound through the Web Audio commentary bus
   * even if the browser/TV blocks or lacks OS SpeechSynthesis voices.
   * @param {string} text
   * @param {boolean} isExcited - High-priority boundary / wicket excitement
   * @param {boolean} withVoiceFormants - Whether to synthesize full syllable formant speech cadence
   */
  playCommentaryVoiceCadence(text = '', isExcited = false, withVoiceFormants = false) {
    if (!this.canPlay()) return;
    const now = this.ctx.currentTime;
    const targetBus = this.commentaryGain || this.effectsGain;

    // 1. Crisp TV Broadcast Commentary Mic Chime (subtle 2-note sports desk stinger)
    const chime1 = this.ctx.createOscillator();
    const chime2 = this.ctx.createOscillator();
    const chimeGain = this.ctx.createGain();
    chime1.type = 'sine';
    chime2.type = 'triangle';
    const baseFreq = isExcited ? 659.25 : 523.25; // E5 or C5
    chime1.frequency.setValueAtTime(baseFreq, now);
    chime1.frequency.setValueAtTime(baseFreq * 1.25, now + 0.055);
    chime2.frequency.setValueAtTime(baseFreq * 1.5, now);
    chime2.frequency.setValueAtTime(baseFreq * 2.0, now + 0.055);

    chimeGain.gain.setValueAtTime(0.001, now);
    chimeGain.gain.linearRampToValueAtTime(isExcited ? 0.14 : 0.09, now + 0.015);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    chime1.connect(chimeGain);
    chime2.connect(chimeGain);
    chimeGain.connect(targetBus);
    chime1.start(now);
    chime2.start(now);
    chime1.stop(now + 0.17);
    chime2.stop(now + 0.17);

    if (!withVoiceFormants) return;

    // 2. Fallback Formant-Filtered Syllable Cadence (when OS TTS voice is unavailable)
    const words = String(text)
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 14);

    let offset = 0.14;
    const basePitch = isExcited ? 158 : 126; // Commentator fundamental pitch Hz
    words.forEach((w, idx) => {
      const sylDur = Math.min(0.16, Math.max(0.075, w.length * 0.022));
      const t0 = now + offset;

      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      const pitchInfl = isExcited
        ? basePitch + Math.sin(idx * 1.3) * 28 + (idx === words.length - 1 ? 24 : 0)
        : basePitch + Math.cos(idx * 1.1) * 14;
      osc.frequency.setValueAtTime(pitchInfl, t0);
      osc.frequency.linearRampToValueAtTime(pitchInfl * 0.94, t0 + sylDur);

      // Vowel formant bandpass filter (F1/F2 vocal tract resonance)
      const formant = this.ctx.createBiquadFilter();
      formant.type = 'bandpass';
      const fFreq = 620 + ((w.charCodeAt(0) || 65) % 7) * 145;
      formant.frequency.setValueAtTime(fFreq, t0);
      formant.Q.setValueAtTime(3.2, t0);

      const sGain = this.ctx.createGain();
      sGain.gain.setValueAtTime(0.001, t0);
      sGain.gain.linearRampToValueAtTime(isExcited ? 0.11 : 0.08, t0 + 0.018);
      sGain.gain.exponentialRampToValueAtTime(0.001, t0 + sylDur);

      osc.connect(formant);
      formant.connect(sGain);
      sGain.connect(targetBus);

      osc.start(t0);
      osc.stop(t0 + sylDur + 0.01);

      offset += sylDur + 0.028;
    });
  }

  /**
   * 14. Cloud TV Spoken Commentary Streamer (/api/tts -> Web Audio commentaryGain / HTML5 Audio)
   * Works on 100% of Smart TV browsers (Android TV, Google TV, Tizen, webOS, Fire TV) even when
   * window.speechSynthesis.getVoices() is empty!
   */
  async playCloudTTSAudio(text = '', tl = 'en-IN', playbackRate = 1.06, interrupt = false) {
    if (this.muted || gameConfig.audio.muted || this._cloudTtsUnavailable) return false;
    const hostName = typeof window !== 'undefined' ? String(window.location?.hostname || '') : '';
    if (
      hostName.endsWith('github.io') ||
      hostName === 'appassets.androidplatform.net' ||
      (typeof window !== 'undefined' && window.location?.protocol === 'file:')
    ) {
      this._cloudTtsUnavailable = true;
      return false;
    }
    const cleanText = String(text || '')
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 190);
    if (!cleanText) return false;

    if (!interrupt && this.activeCloudTTSPlaying) {
      return true;
    }
    if (interrupt) {
      this.stopCloudTTSAudio();
    }

    const url = `/api/tts?tl=${encodeURIComponent(tl)}&text=${encodeURIComponent(cleanText)}`;
    this.activeCloudTTSPlaying = true;

    try {
      this.init();
      const resp = await fetch(url);
      if (resp.status === 404) {
        this._cloudTtsUnavailable = true;
        this.activeCloudTTSPlaying = false;
        return false;
      }
      if (!resp.ok) throw new Error('TTS HTTP error');
      const arrayBuf = await resp.arrayBuffer();

      if (this.ctx && this.ctx.state !== 'closed') {
        if (this.ctx.state === 'suspended') {
          try {
            await this.ctx.resume();
          } catch {}
        }
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuf.slice(0));
        if (interrupt) this.stopCloudTTSAudio();

        const src = this.ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.playbackRate.value = Math.max(0.85, Math.min(1.3, playbackRate));

        const boostGain = this.ctx.createGain();
        boostGain.gain.value = 1.35;
        src.connect(boostGain);
        boostGain.connect(this.commentaryGain || this.effectsGain || this.masterGain);

        this.activeCloudTTSSource = src;
        this.activeCloudTTSPlaying = true;
        src.onended = () => {
          if (this.activeCloudTTSSource === src) {
            this.activeCloudTTSSource = null;
            this.activeCloudTTSPlaying = false;
          }
        };
        src.start(0);
        return true;
      }
    } catch {
      // Fallback to HTML5 Audio element if Web Audio decode fails
    }

    try {
      if (interrupt) this.stopCloudTTSAudio();
      const audio = new Audio(url);
      const masterVol = gameConfig.audio.muted ? 0 : (gameConfig.audio.master ?? 0.85);
      const commVol = gameConfig.commentary.volume ?? gameConfig.audio.commentary ?? 0.9;
      audio.volume = Math.max(0, Math.min(1, masterVol * commVol));
      audio.playbackRate = Math.max(0.85, Math.min(1.3, playbackRate));
      this.activeCloudTTSAudioEl = audio;
      this.activeCloudTTSPlaying = true;
      audio.onended = () => {
        if (this.activeCloudTTSAudioEl === audio) {
          this.activeCloudTTSAudioEl = null;
          this.activeCloudTTSPlaying = false;
        }
      };
      audio.onerror = () => {
        this.activeCloudTTSPlaying = false;
      };
      await audio.play();
      return true;
    } catch {
      this.activeCloudTTSPlaying = false;
      this.playCommentaryVoiceCadence(cleanText, interrupt, true);
      return false;
    }
  }

  stopCloudTTSAudio() {
    this.activeCloudTTSPlaying = false;
    if (this.activeCloudTTSSource) {
      try {
        this.activeCloudTTSSource.stop();
      } catch {}
      this.activeCloudTTSSource = null;
    }
    if (this.activeCloudTTSAudioEl) {
      try {
        this.activeCloudTTSAudioEl.pause();
        this.activeCloudTTSAudioEl.currentTime = 0;
      } catch {}
      this.activeCloudTTSAudioEl = null;
    }
  }
}

export const sound = new SoundEngine();
