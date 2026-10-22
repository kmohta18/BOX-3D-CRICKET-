import * as THREE from 'three';
import { CREASE_Z } from './physics.js';
import { getDifficultyProfile, gameConfig } from './config.js';

/**
 * Bowling Mechanics, 22 Delivery Variations, Difficulty-Scaled Tactical AI & Phone Overarm Detector (bowling.js)
 * Implements hold-for-runup, peak angular speed release detection,
 * 22 authentic pace/swing/cutter/spin variations, tactical set-ups, and Assist (Off/Light/Full).
 */

export const BOWLER_TYPES = {
  fast: {
    id: 'fast',
    nameEn: 'Fast Pace (130-155 km/h)',
    nameHi: 'तेज़ गेंदबाज़ (130-155)',
    minKmh: 128,
    maxKmh: 154
  },
  medium: {
    id: 'medium',
    nameEn: 'Medium Swing (105-130 km/h)',
    nameHi: 'मीडियम स्विंग (105-130)',
    minKmh: 105,
    maxKmh: 130
  },
  spin: {
    id: 'spin',
    nameEn: 'Spin Wizard (68-96 km/h)',
    nameHi: 'स्पिनर (68-96)',
    minKmh: 68,
    maxKmh: 96
  }
};

/**
 * 22 Authentic Bowling Variations (12 Pace/Swing/Seam + 10 Off-Spin/Wrist-Spin)
 * Tier 1 (1..3): Rookie stock deliveries
 * Tier 2 (4..6): Club variations
 * Tier 3 (7..10): Pro variations
 * Tier 4 (11..22): Legend complete repertoire with late movement & deception
 */
export const DELIVERY_VARIATIONS = {
  // ================= PACE & SWING VARIATIONS (12) =================
  outswinger: {
    id: 'outswinger',
    tier: 1,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Outswinger',
    nameHi: 'आउटस्विंगर',
    speedScale: 0.94,
    targetX: 0.16,
    bounceZ: 4.5,
    wristRoll: 0.65,
    swingCurl: 0.72,
    lateSwing: false,
    seamCut: 0.12,
    spinTurn: 0,
    topSpin: 0.1,
    bounceMod: 1.0,
    dipFactor: 0
  },
  inswinger: {
    id: 'inswinger',
    tier: 1,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Inswinger',
    nameHi: 'इनस्विंगर',
    speedScale: 0.94,
    targetX: -0.05,
    bounceZ: 4.8,
    wristRoll: -0.68,
    swingCurl: -0.75,
    lateSwing: false,
    seamCut: -0.12,
    spinTurn: 0,
    topSpin: 0.12,
    bounceMod: 0.98,
    dipFactor: 0
  },
  bouncer: {
    id: 'bouncer',
    tier: 2,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Bouncer',
    nameHi: 'बाउंसर',
    speedScale: 1.0,
    targetX: -0.08,
    bounceZ: 1.35,
    wristRoll: 0.15,
    swingCurl: 0.1,
    lateSwing: false,
    seamCut: 0.08,
    spinTurn: 0,
    topSpin: -0.35,
    bounceMod: 1.24,
    dipFactor: 0
  },
  yorker: {
    id: 'yorker',
    tier: 2,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Toe-Crushing Yorker',
    nameHi: 'यॉर्कर',
    speedScale: 0.98,
    targetX: 0.02,
    bounceZ: 8.25,
    wristRoll: -0.25,
    swingCurl: -0.28,
    lateSwing: true,
    seamCut: 0,
    spinTurn: 0,
    topSpin: 0.25,
    bounceMod: 0.85,
    dipFactor: 0.25
  },
  off_cutter: {
    id: 'off_cutter',
    tier: 3,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Off-Cutter',
    nameHi: 'ऑफ-कटर',
    speedScale: 0.84,
    targetX: 0.24,
    bounceZ: 4.1,
    wristRoll: -0.55,
    swingCurl: -0.1,
    lateSwing: false,
    seamCut: -0.78,
    spinTurn: -0.35,
    topSpin: 0.2,
    bounceMod: 0.94,
    dipFactor: 0.15
  },
  leg_cutter: {
    id: 'leg_cutter',
    tier: 3,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Leg-Cutter',
    nameHi: 'लेग-कटर',
    speedScale: 0.85,
    targetX: 0.05,
    bounceZ: 4.2,
    wristRoll: 0.55,
    swingCurl: 0.1,
    lateSwing: false,
    seamCut: 0.78,
    spinTurn: 0.35,
    topSpin: 0.2,
    bounceMod: 0.96,
    dipFactor: 0.15
  },
  slower_ball: {
    id: 'slower_ball',
    tier: 3,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Slower Ball',
    nameHi: 'स्लोअर बॉल',
    speedScale: 0.74,
    targetX: 0.14,
    bounceZ: 5.2,
    wristRoll: -0.35,
    swingCurl: -0.22,
    lateSwing: false,
    seamCut: -0.32,
    spinTurn: -0.2,
    topSpin: 0.55,
    bounceMod: 0.88,
    dipFactor: 0.45
  },
  reverse_swing: {
    id: 'reverse_swing',
    tier: 4,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Late Reverse Swing',
    nameHi: 'रिवर्स स्विंग',
    speedScale: 1.0,
    targetX: 0.18,
    bounceZ: 5.8,
    wristRoll: -0.88,
    swingCurl: -1.05,
    lateSwing: true,
    seamCut: -0.28,
    spinTurn: 0,
    topSpin: 0.18,
    bounceMod: 0.96,
    dipFactor: 0.22
  },
  wide_yorker: {
    id: 'wide_yorker',
    tier: 4,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Wide Yorker',
    nameHi: 'वाइड यॉर्कर',
    speedScale: 0.96,
    targetX: 0.34,
    bounceZ: 8.3,
    wristRoll: 0.32,
    swingCurl: 0.28,
    lateSwing: true,
    seamCut: 0.18,
    spinTurn: 0,
    topSpin: 0.2,
    bounceMod: 0.84,
    dipFactor: 0.2
  },
  in_swinging_yorker: {
    id: 'in_swinging_yorker',
    tier: 4,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Inswinging Yorker',
    nameHi: 'इनस्विंगिंग यॉर्कर',
    speedScale: 0.99,
    targetX: 0.15,
    bounceZ: 8.35,
    wristRoll: -0.92,
    swingCurl: -1.12,
    lateSwing: true,
    seamCut: -0.22,
    spinTurn: 0,
    topSpin: 0.3,
    bounceMod: 0.82,
    dipFactor: 0.35
  },
  slower_bouncer: {
    id: 'slower_bouncer',
    tier: 4,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Slower Bouncer',
    nameHi: 'स्लोअर बाउंसर',
    speedScale: 0.76,
    targetX: 0.08,
    bounceZ: 1.65,
    wristRoll: -0.45,
    swingCurl: 0,
    lateSwing: false,
    seamCut: -0.45,
    spinTurn: -0.25,
    topSpin: 0.42,
    bounceMod: 1.14,
    dipFactor: 0.3
  },
  knuckleball: {
    id: 'knuckleball',
    tier: 4,
    bowlerTypes: ['fast', 'medium'],
    nameEn: 'Knuckleball',
    nameHi: 'नकलबॉल',
    speedScale: 0.78,
    targetX: 0.1,
    bounceZ: 5.4,
    wristRoll: 0.05,
    swingCurl: 0.15,
    lateSwing: true,
    seamCut: 0.25,
    spinTurn: 0,
    topSpin: 0.65,
    bounceMod: 0.86,
    dipFactor: 0.58
  },

  // ================= SPIN VARIATIONS (10) =================
  off_break: {
    id: 'off_break',
    tier: 1,
    bowlerTypes: ['spin'],
    nameEn: 'Off-Break',
    nameHi: 'ऑफ-ब्रेक',
    speedScale: 0.86,
    targetX: 0.26,
    bounceZ: 4.9,
    wristRoll: -0.78,
    swingCurl: 0.18,
    lateSwing: false,
    seamCut: -0.2,
    spinTurn: -0.85,
    topSpin: 0.35,
    bounceMod: 1.02,
    dipFactor: 0.32
  },
  leg_break: {
    id: 'leg_break',
    tier: 2,
    bowlerTypes: ['spin'],
    nameEn: 'Leg-Break',
    nameHi: 'लेग-ब्रेक',
    speedScale: 0.84,
    targetX: -0.12,
    bounceZ: 4.7,
    wristRoll: 0.88,
    swingCurl: -0.22,
    lateSwing: false,
    seamCut: 0.25,
    spinTurn: 0.96,
    topSpin: 0.42,
    bounceMod: 1.08,
    dipFactor: 0.38
  },
  arm_ball: {
    id: 'arm_ball',
    tier: 3,
    bowlerTypes: ['spin'],
    nameEn: 'Arm Ball',
    nameHi: 'आर्म बॉल',
    speedScale: 0.98,
    targetX: 0.04,
    bounceZ: 5.3,
    wristRoll: 0.18,
    swingCurl: 0.32,
    lateSwing: false,
    seamCut: 0.05,
    spinTurn: 0.05,
    topSpin: 0.15,
    bounceMod: 0.88,
    dipFactor: 0.12
  },
  googly: {
    id: 'googly',
    tier: 3,
    bowlerTypes: ['spin'],
    nameEn: 'Googly',
    nameHi: 'गुगली',
    speedScale: 0.88,
    targetX: 0.22,
    bounceZ: 4.8,
    wristRoll: -0.86,
    swingCurl: 0.22,
    lateSwing: true,
    seamCut: -0.3,
    spinTurn: -0.92,
    topSpin: 0.45,
    bounceMod: 1.04,
    dipFactor: 0.38
  },
  topspinner: {
    id: 'topspinner',
    tier: 3,
    bowlerTypes: ['spin'],
    nameEn: 'Topspinner',
    nameHi: 'टॉप-स्पिनर',
    speedScale: 0.90,
    targetX: 0.02,
    bounceZ: 4.5,
    wristRoll: 0.1,
    swingCurl: 0.05,
    lateSwing: false,
    seamCut: 0,
    spinTurn: 0.08,
    topSpin: 0.95,
    bounceMod: 1.22,
    dipFactor: 0.55
  },
  doosra: {
    id: 'doosra',
    tier: 4,
    bowlerTypes: ['spin'],
    nameEn: 'Doosra',
    nameHi: 'दूसरा',
    speedScale: 0.90,
    targetX: 0.0,
    bounceZ: 4.8,
    wristRoll: 0.82,
    swingCurl: -0.18,
    lateSwing: true,
    seamCut: 0.25,
    spinTurn: 0.86,
    topSpin: 0.38,
    bounceMod: 1.03,
    dipFactor: 0.32
  },
  carrom_ball: {
    id: 'carrom_ball',
    tier: 4,
    bowlerTypes: ['spin'],
    nameEn: 'Carrom Ball',
    nameHi: 'कैरम बॉल',
    speedScale: 0.96,
    targetX: -0.06,
    bounceZ: 5.1,
    wristRoll: 0.75,
    swingCurl: -0.1,
    lateSwing: true,
    seamCut: 0.3,
    spinTurn: 0.78,
    topSpin: 0.12,
    bounceMod: 0.90,
    dipFactor: 0.18
  },
  flipper: {
    id: 'flipper',
    tier: 4,
    bowlerTypes: ['spin'],
    nameEn: 'Flipper',
    nameHi: 'फ्लिपर',
    speedScale: 1.04,
    targetX: 0.0,
    bounceZ: 5.8,
    wristRoll: 0.15,
    swingCurl: 0.08,
    lateSwing: false,
    seamCut: 0.08,
    spinTurn: 0.12,
    topSpin: -0.85,
    bounceMod: 0.72,
    dipFactor: -0.1
  },
  slider: {
    id: 'slider',
    tier: 4,
    bowlerTypes: ['spin'],
    nameEn: 'Slider',
    nameHi: 'स्लाइडर',
    speedScale: 0.97,
    targetX: 0.08,
    bounceZ: 5.2,
    wristRoll: 0.22,
    swingCurl: 0.15,
    lateSwing: false,
    seamCut: 0.15,
    spinTurn: 0.18,
    topSpin: -0.55,
    bounceMod: 0.82,
    dipFactor: 0.1
  },
  undercutter: {
    id: 'undercutter',
    tier: 4,
    bowlerTypes: ['spin'],
    nameEn: 'Undercutter',
    nameHi: 'अंडरकटर',
    speedScale: 0.95,
    targetX: 0.12,
    bounceZ: 5.0,
    wristRoll: -0.65,
    swingCurl: 0.1,
    lateSwing: false,
    seamCut: -0.35,
    spinTurn: -0.68,
    topSpin: -0.75,
    bounceMod: 0.74,
    dipFactor: 0.08
  }
};

export const VARIATION_LIST = Object.values(DELIVERY_VARIATIONS);

// Tactical set-up sequences used by Pro and Legend AI bowlers
const TACTICAL_PLANS = {
  pace: [
    ['outswinger', 'outswinger', 'in_swinging_yorker'],
    ['bouncer', 'yorker', 'slower_ball'],
    ['inswinger', 'outswinger', 'off_cutter'],
    ['outswinger', 'slower_bouncer', 'reverse_swing'],
    ['leg_cutter', 'wide_yorker', 'knuckleball']
  ],
  spin: [
    ['leg_break', 'leg_break', 'googly'],
    ['off_break', 'off_break', 'doosra'],
    ['off_break', 'arm_ball', 'carrom_ball'],
    ['leg_break', 'topspinner', 'flipper'],
    ['off_break', 'undercutter', 'slider']
  ]
};

export class BowlingSystem {
  constructor() {
    this.bowlerType = 'fast';     // 'fast' | 'medium' | 'spin'
    this.assistMode = 'off';      // 'off' | 'light' | 'full'
    this.bowlerSide = 'over';     // 'over' (right of stumps) | 'around' (left of stumps)
    this.selectedVariationId = 'outswinger';

    // Run-up, delivery jump & follow-through state
    this.state = 'ready';         // 'ready' | 'runup' | 'arm_swing' | 'released'
    this.runupProgress = 0;       // 0.0 to 1.0
    this.runupZ = -CREASE_Z - 6.5;
    this.jumpY = 0;               // Vertical gather leap at delivery stride
    this.followThroughProgress = 0; // Post-release follow-through down the pitch
    this.lastStepIndex = -1;
    this.armAngle = 0;

    // Phone overarm sensor tracking
    this.holdingRunupBtn = false;
    this.peakOmegaDeg = 0;
    this.releaseYawDeg = 0;
    this.releasePitchDeg = 0;
    this.releaseRollRate = 0;
    this.refYawDeg = null;

    // Pitch target marker (for overhead/broadcast aim & Light/Full assist target)
    this.aimTargetX = 0.05;       // -0.85m to +0.85m
    this.aimBounceZ = 4.6;        // -1.5m (bouncer) to +8.6m (yorker)
    this.wristSpinInput = 0.25;   // -1.0 (in-swing / off-spin) to +1.0 (out-swing / leg-spin)

    // Tactical AI memory
    this.activePlan = null;
    this.planStep = 0;
    this.lastVariationId = 'outswinger';
    this.overLooseBallUsed = false;

    // Last delivery stats for HUD & Commentary
    this.lastDelivery = {
      speedKmh: 134,
      lengthLabelEn: 'GOOD LENGTH',
      lengthLabelHi: 'गुड लेंथ',
      swingLabelEn: 'OUTSWINGER',
      variationId: 'outswinger',
      variationNameEn: 'Outswinger',
      variationNameHi: 'आउटस्विंगर',
      deliveryPreview: 'hidden',
      type: 'fast'
    };
  }

  getVariationsForBowler(bowlerType = this.bowlerType) {
    return VARIATION_LIST.filter((v) => v.bowlerTypes.includes(bowlerType));
  }

  setVariation(variationId) {
    if (DELIVERY_VARIATIONS[variationId]) {
      this.selectedVariationId = variationId;
      const v = DELIVERY_VARIATIONS[variationId];
      this.aimTargetX = v.targetX;
      this.aimBounceZ = v.bounceZ;
      this.wristSpinInput = v.wristRoll;
    }
  }

  cycleVariation(step = 1) {
    const list = this.getVariationsForBowler(this.bowlerType);
    if (list.length === 0) return null;
    const idx = list.findIndex((v) => v.id === this.selectedVariationId);
    const next = list[(Math.max(0, idx) + step + list.length) % list.length];
    this.setVariation(next.id);
    return next;
  }

  toggleBowlerSide(forceSide = null) {
    if (forceSide === 'over' || forceSide === 'around') {
      this.bowlerSide = forceSide;
    } else {
      this.bowlerSide = this.bowlerSide === 'over' ? 'around' : 'over';
    }
    return this.bowlerSide;
  }

  resetForNextBall() {
    this.state = 'ready';
    this.runupProgress = 0;
    this.runupZ = -CREASE_Z - 6.5;
    this.jumpY = 0;
    this.followThroughProgress = 0;
    this.lastStepIndex = -1;
    this.armAngle = 0;
    this.peakOmegaDeg = 0;
    this.refYawDeg = null;
  }

  /**
   * Called by phone controller when user holds or releases the Run-Up button
   */
  setRunupButtonState(isHeld) {
    if (isHeld && this.state === 'ready') {
      this.holdingRunupBtn = true;
      this.state = 'runup';
      this.peakOmegaDeg = 0;
      this.refYawDeg = null;
    } else if (!isHeld) {
      this.holdingRunupBtn = false;
    }
  }

  /**
   * Processes 60-100Hz phone sensor packets during bowling
   * Release is detected when angular speed drops after its peak while running up.
   */
  ingestBowlingSensor(data, dt, onReleaseCallback) {
    if (this.state !== 'runup' && this.state !== 'arm_swing') return;

    const gx = data.gx || 0;
    const gy = data.gy || 0;
    const gz = data.gz || 0;
    const omegaMag = Math.hypot(gx, gy, gz);

    if (this.refYawDeg === null && typeof data.alpha === 'number') {
      this.refYawDeg = data.alpha;
    }

    // Track peak angular speed during overarm swing
    if (omegaMag > 160) {
      this.state = 'arm_swing';
      if (omegaMag >= this.peakOmegaDeg) {
        this.peakOmegaDeg = omegaMag;
        let deltaYaw = (data.alpha || 0) - (this.refYawDeg || 0);
        if (deltaYaw > 180) deltaYaw -= 360;
        if (deltaYaw < -180) deltaYaw += 360;
        this.releaseYawDeg = deltaYaw + (data.gamma || 0) * 0.35;
        this.releasePitchDeg = data.beta || 45;
        this.releaseRollRate = THREE.MathUtils.clamp(gz / 320, -1, 1);
      } else if (this.peakOmegaDeg > 190 && omegaMag < this.peakOmegaDeg * 0.68) {
        this.state = 'released';
        const delivery = this.computeDeliveryFromPhone();
        if (onReleaseCallback) onReleaseCallback(delivery);
      }
    }
  }

  computeDeliveryFromPhone() {
    const profile = BOWLER_TYPES[this.bowlerType] || BOWLER_TYPES.fast;
    const variation =
      DELIVERY_VARIATIONS[this.selectedVariationId] ||
      this.getVariationsForBowler(this.bowlerType)[0] ||
      DELIVERY_VARIATIONS.outswinger;

    const normSpeed = THREE.MathUtils.clamp((this.peakOmegaDeg - 180) / 560, 0.05, 1.0);
    const rawSpeed = THREE.MathUtils.lerp(profile.minKmh, profile.maxKmh, normSpeed);
    const speedKmh = rawSpeed * (variation.speedScale || 1.0);

    let rawTargetX = THREE.MathUtils.clamp((this.releaseYawDeg / 28) * 0.85, -1.05, 1.05);
    const normPitch = THREE.MathUtils.clamp((this.releasePitchDeg - 15) / 75, 0, 1);
    let rawBounceZ = THREE.MathUtils.lerp(8.6, 0.5, normPitch);

    let assistBlend = 0.0;
    if (this.assistMode === 'light') assistBlend = 0.38;
    else if (this.assistMode === 'full') assistBlend = 0.78;

    const finalTargetX = THREE.MathUtils.lerp(rawTargetX, this.aimTargetX, assistBlend);
    const finalBounceZ = THREE.MathUtils.lerp(rawBounceZ, this.aimBounceZ, assistBlend);
    const wristRoll = this.releaseRollRate || variation.wristRoll || this.wristSpinInput;

    const overstepped = this.assistMode === 'off' && this.runupProgress > 1.03;

    return this.buildDeliveryPayload(
      speedKmh,
      finalTargetX,
      finalBounceZ,
      wristRoll,
      overstepped,
      variation,
      getDifficultyProfile(gameConfig.difficulty)
    );
  }

  /**
   * Keyboard / Touch manual release at current aim marker with selected variation
   */
  triggerManualDelivery(paceFactor = 0.84) {
    this.state = 'released';
    const profile = BOWLER_TYPES[this.bowlerType] || BOWLER_TYPES.fast;
    const validVars = this.getVariationsForBowler(this.bowlerType);
    let variation = DELIVERY_VARIATIONS[this.selectedVariationId];
    if (!variation || !variation.bowlerTypes.includes(this.bowlerType)) {
      variation = validVars[0] || DELIVERY_VARIATIONS.outswinger;
      this.selectedVariationId = variation.id;
    }

    const baseSpeed = THREE.MathUtils.lerp(profile.minKmh, profile.maxKmh, paceFactor);
    const speedKmh = baseSpeed * (variation.speedScale || 1.0);
    const jitter = this.assistMode === 'full' ? 0.02 : this.assistMode === 'light' ? 0.06 : 0.11;
    const targetX = this.aimTargetX + (Math.random() - 0.5) * jitter;
    const bounceZ = this.aimBounceZ + (Math.random() - 0.5) * jitter * 4;
    const wristRoll = variation.wristRoll ?? this.wristSpinInput;

    return this.buildDeliveryPayload(
      speedKmh,
      targetX,
      bounceZ,
      wristRoll,
      false,
      variation,
      getDifficultyProfile(gameConfig.difficulty)
    );
  }

  /**
   * AI Bowler generator scaled by 4 difficulty profiles ('rookie' | 'club' | 'pro' | 'legend')
   * Supports all 22 variations, tactical set-ups, accuracy scatter, and loose balls per over.
   */
  generateAIDelivery(difficulty = gameConfig.difficulty, ballCount = 0, batterHand = gameConfig.handedness) {
    const diffProfile = getDifficultyProfile(difficulty);
    const ballInOver = ballCount % 6;
    if (ballInOver === 0) {
      this.overLooseBallUsed = false;
      this.activePlan = null;
      this.planStep = 0;
    }

    // Rotate bowler style every over
    const types = ['fast', 'medium', 'spin'];
    this.bowlerType = types[Math.floor(ballCount / 6) % types.length];

    // Filter eligible variations by bowler type and difficulty tier
    const maxTier =
      diffProfile.id === 'easy' || diffProfile.id === 'rookie'
        ? 2
        : diffProfile.id === 'medium' || diffProfile.id === 'club'
          ? 3
          : 4;

    const eligible = VARIATION_LIST.filter(
      (v) => v.bowlerTypes.includes(this.bowlerType) && v.tier <= maxTier
    );
    const pool = eligible.length > 0 ? eligible : this.getVariationsForBowler(this.bowlerType);

    let chosenVar = pool[0];

    // Tactical set-ups in Hard (and Pro/Legend)
    if ((diffProfile.id === 'hard' || diffProfile.id === 'legend' || diffProfile.id === 'pro') && Math.random() < 0.72) {
      const planCategory = this.bowlerType === 'spin' ? TACTICAL_PLANS.spin : TACTICAL_PLANS.pace;
      if (!this.activePlan || this.planStep >= this.activePlan.length) {
        this.activePlan = planCategory[Math.floor(Math.random() * planCategory.length)];
        this.planStep = 0;
      }
      const plannedId = this.activePlan[this.planStep++];
      const plannedVar = DELIVERY_VARIATIONS[plannedId];
      if (plannedVar && plannedVar.tier <= maxTier) {
        chosenVar = plannedVar;
      } else {
        chosenVar = pool[Math.floor(Math.random() * pool.length)];
      }
    } else {
      // Rookie/Club: stick with stock ball unless changeProbability triggers
      const prevValid = pool.find((v) => v.id === this.lastVariationId);
      if (prevValid && Math.random() > diffProfile.changeProbability) {
        chosenVar = prevValid;
      } else {
        chosenVar = pool[Math.floor(Math.random() * pool.length)];
      }
    }

    this.lastVariationId = chosenVar.id;
    this.selectedVariationId = chosenVar.id;

    // Pace scaling from difficulty profile & bowler type
    let minPace = diffProfile.paceMinKmh;
    let maxPace = diffProfile.paceMaxKmh;
    if (this.bowlerType === 'spin') {
      minPace = Math.max(66, minPace * 0.62);
      maxPace = Math.min(98, maxPace * 0.64);
    } else if (this.bowlerType === 'medium') {
      minPace = minPace * 0.86;
      maxPace = maxPace * 0.86;
    }

    const baseSpeed = THREE.MathUtils.randFloat(minPace, maxPace);
    const speedKmh = THREE.MathUtils.clamp(baseSpeed * (chosenVar.speedScale || 1.0), 62, 156);

    // Dynamic Over / Around the Wicket tactical angle (like Cricket 24 / Real Cricket)
    if (
      chosenVar.id === 'wide_yorker' ||
      chosenVar.id === 'in_swinging_yorker' ||
      (batterHand === 'left' && (this.bowlerType === 'spin' || ballInOver >= 3))
    ) {
      this.bowlerSide = Math.random() < 0.7 ? 'around' : 'over';
    } else {
      this.bowlerSide = Math.random() < 0.82 ? 'over' : 'around';
    }

    // Mirror targetX & lateral movement for left-handed batters so off-stump corridor stays authentic
    const handMirror = batterHand === 'left' ? -1 : 1;
    let targetX = chosenVar.targetX * handMirror;
    let bounceZ = chosenVar.bounceZ;

    // Check if this ball is a loose ball (half-volley or juicy width on Rookie/Club)
    const looseProb = diffProfile.looseBallsPerOver / 6;
    const isLooseBall = !this.overLooseBallUsed && Math.random() < looseProb;
    if (isLooseBall) {
      this.overLooseBallUsed = true;
      targetX = (Math.random() < 0.5 ? 0.28 : -0.22) * handMirror;
      bounceZ = THREE.MathUtils.randFloat(5.4, 6.6); // Hittable slot half-volley
    } else {
      targetX += (Math.random() - 0.5) * 1.1 * diffProfile.accuracyScatterX;
      bounceZ += (Math.random() - 0.5) * 1.6 * diffProfile.accuracyScatterZ;
    }

    targetX = THREE.MathUtils.clamp(targetX, -0.42, 0.42);
    bounceZ = THREE.MathUtils.clamp(bounceZ, 1.1, 8.65);

    const wristRoll = chosenVar.wristRoll * diffProfile.swingTurnScale * handMirror;

    this.aimTargetX = targetX;
    this.aimBounceZ = bounceZ;

    return this.buildDeliveryPayload(
      speedKmh,
      targetX,
      bounceZ,
      wristRoll,
      false,
      chosenVar,
      diffProfile,
      handMirror
    );
  }

  buildDeliveryPayload(
    speedKmh,
    targetX,
    bounceZ,
    wristRoll,
    overstepped,
    variation = DELIVERY_VARIATIONS.outswinger,
    diffProfile = getDifficultyProfile(gameConfig.difficulty),
    handMirror = 1
  ) {
    let lengthLabelEn = 'GOOD LENGTH';
    let lengthLabelHi = 'गुड लेंथ';
    let lengthCategory = 'good';
    let lengthColorHex = 0xf59e0b; // Amber/Gold = Good Length probing corridor
    if (bounceZ >= 7.6) {
      lengthLabelEn = 'YORKER';
      lengthLabelHi = 'यॉर्कर';
      lengthCategory = 'yorker';
      lengthColorHex = 0x38bdf8; // Electric Cyan = Blockhole Yorker
    } else if (bounceZ >= 5.5) {
      lengthLabelEn = 'FULL / SLOT';
      lengthLabelHi = 'फुल लेंथ';
      lengthCategory = 'full';
      lengthColorHex = 0x10b981; // Emerald Green = Driveable Full/Half-Volley
    } else if (bounceZ < 2.4) {
      lengthLabelEn = 'BOUNCER / SHORT';
      lengthLabelHi = 'बाउंसर / शॉर्ट';
      lengthCategory = 'short';
      lengthColorHex = 0xef4444; // Crimson Red = Short / Bouncer
    }

    const scale = diffProfile ? diffProfile.swingTurnScale : 1.0;
    const releaseX = this.bowlerSide === 'over' ? 0.36 : -0.36;
    const delivery = {
      speedKmh: Math.round(speedKmh * 10) / 10,
      targetX,
      bounceZ,
      wristRoll,
      bowlerType: this.bowlerType,
      bowlerSide: this.bowlerSide,
      overstepped,
      releaseX,
      lengthLabelEn,
      lengthLabelHi,
      lengthCategory,
      lengthColorHex,
      variationId: variation.id,
      variationNameEn: variation.nameEn,
      variationNameHi: variation.nameHi,
      swingCurl: (variation.swingCurl || 0) * scale * handMirror,
      lateSwing: Boolean(variation.lateSwing || (diffProfile && diffProfile.lateMovement)),
      seamCut: (variation.seamCut || 0) * scale * handMirror,
      spinTurn: (variation.spinTurn || 0) * scale * handMirror,
      topSpin: variation.topSpin || 0,
      bounceMod: variation.bounceMod || 1.0,
      dipFactor: variation.dipFactor || 0,
      deliveryPreview: diffProfile ? diffProfile.deliveryPreview : 'hidden'
    };
    this.lastDelivery = delivery;
    return delivery;
  }

  updateRunup(dt, onReachCreaseCallback, onFootstepCallback) {
    if (this.state === 'runup' || this.state === 'arm_swing') {
      // Spinners have a brisk 6-step approach; fast bowlers build momentum from top of mark
      const baseRate = this.bowlerType === 'spin' ? 1.15 : this.bowlerType === 'medium' ? 0.98 : 0.92;
      const accelFactor = 0.78 + 0.45 * this.runupProgress;
      this.runupProgress += dt * baseRate * accelFactor;

      const startZ = this.bowlerType === 'spin' ? -CREASE_Z - 3.8 : -CREASE_Z - 6.5;
      this.runupZ = THREE.MathUtils.lerp(startZ, -CREASE_Z, Math.min(1.04, this.runupProgress));

      // Trigger rhythmic run-up footsteps (6 strides)
      const stepIdx = Math.floor(this.runupProgress * 6);
      if (stepIdx > this.lastStepIndex && stepIdx <= 5) {
        this.lastStepIndex = stepIdx;
        if (onFootstepCallback) onFootstepCallback(stepIdx, this.runupProgress);
      }

      // Authentic Delivery Gather Jump / Stride (0.72 -> 0.98)
      if (this.runupProgress >= 0.72 && this.runupProgress <= 0.98) {
        const jumpPhase = (this.runupProgress - 0.72) / 0.26;
        const maxHop = this.bowlerType === 'fast' ? 0.25 : this.bowlerType === 'medium' ? 0.17 : 0.07;
        this.jumpY = Math.sin(jumpPhase * Math.PI) * maxHop;
      } else {
        this.jumpY = 0;
      }

      if (this.runupProgress > 0.65) {
        this.armAngle = (this.runupProgress - 0.65) * Math.PI * 6.0;
      }
      if (this.runupProgress >= 1.0 && onReachCreaseCallback) {
        this.jumpY = 0;
        onReachCreaseCallback();
      }
    } else if (this.state === 'released') {
      // Natural post-release follow-through deceleration down the side of the pitch
      this.jumpY = 0;
      if (this.followThroughProgress < 1.0) {
        this.followThroughProgress = Math.min(1.0, this.followThroughProgress + dt * 1.45);
        const easeOut = 1 - Math.pow(1 - this.followThroughProgress, 2);
        const followDist = this.bowlerType === 'spin' ? 0.75 : 1.85;
        this.runupZ = -CREASE_Z + easeOut * followDist;
      }
    }
  }
}
