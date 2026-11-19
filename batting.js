import * as THREE from 'three';
import { CREASE_Z } from './physics.js';
import { getDifficultyProfile } from './config.js';

/**
 * 360-Degree Batting Mechanics, Pre-Selected Shot Mode (GROUND / FLY),
 * Accelerometer Step-Cadence Running Engine & Low-Lag Sensor Pipeline (batting.js)
 */

const _qCurrent = new THREE.Quaternion();
const _qStanceInv = new THREE.Quaternion();
const _qRel = new THREE.Quaternion();
const _qWorldDelta = new THREE.Quaternion();
const _qPredDelta = new THREE.Quaternion();
const _qPredicted = new THREE.Quaternion();
const _deviceEuler = new THREE.Euler(0, 0, 0, 'ZXY');
const _relEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _omegaAxis = new THREE.Vector3();
const _omegaDevice = new THREE.Vector3();
const _omegaWorld = new THREE.Vector3();
const _localVelVec = new THREE.Vector3();

export const SHOT_TYPES = {
  STRAIGHT_DRIVE: { id: 'straight', shotKey: 'straight_drive', anim: 'drive', nameEn: 'STRAIGHT DRIVE', nameHi: 'स्ट्रेट ड्राइव' },
  COVER_DRIVE: { id: 'cover', shotKey: 'cover_drive', anim: 'drive_cover', nameEn: 'COVER DRIVE', nameHi: 'कवर ड्राइव' },
  INSIDE_OUT_LOFT: { id: 'insideout', shotKey: 'inside_out_loft', anim: 'drive_cover_loft', nameEn: 'INSIDE-OUT LOFT', nameHi: 'इनसाइड-आउट लॉफ्ट' },
  ON_DRIVE: { id: 'ondrive', shotKey: 'on_drive', anim: 'drive_on_whip', nameEn: 'ON DRIVE', nameHi: 'ऑन ड्राइव' },
  LEG_FLICK: { id: 'flick', shotKey: 'leg_flick', anim: 'flick', nameEn: 'MID-WICKET FLICK', nameHi: 'मिड-विकेट फ्लिक' },
  SQUARE_CUT: { id: 'cut', shotKey: 'square_cut', anim: 'cut', nameEn: 'SQUARE CUT', nameHi: 'स्क्वायर कट' },
  LOFTED_CUT: { id: 'loftedcut', shotKey: 'lofted_cut', anim: 'cut_loft', nameEn: 'LOFTED SQUARE CUT', nameHi: 'लॉफ्टेड स्क्वायर कट' },
  PULL_SHOT: { id: 'pull', shotKey: 'pull_shot', anim: 'pull', nameEn: 'PULL SHOT', nameHi: 'पुल शॉट' },
  HOOK_SHOT: { id: 'hook', shotKey: 'hook_shot', anim: 'hook_loft', nameEn: 'SWIVEL HOOK', nameHi: 'हुक शॉट' },
  SWEEP_SHOT: { id: 'sweep', shotKey: 'sweep_shot', anim: 'sweep', nameEn: 'SWEEP SHOT', nameHi: 'स्वीप शॉट' },
  SLOG_SWEEP: { id: 'slogsweep', shotKey: 'slog_sweep', anim: 'slog_sweep', nameEn: 'SLOG SWEEP', nameHi: 'स्लॉग स्वीप' },
  LATE_CUT: { id: 'latecut', shotKey: 'late_cut', anim: 'cut_late', nameEn: 'LATE CUT', nameHi: 'लेट कट' },
  UPPER_CUT: { id: 'uppercut', shotKey: 'upper_cut', anim: 'upper_cut', nameEn: 'UPPER CUT', nameHi: 'अपर कट' },
  REVERSE_SWEEP: { id: 'reversesweep', shotKey: 'reverse_sweep', anim: 'reverse_sweep', nameEn: 'REVERSE SWEEP', nameHi: 'रिवर्स स्वीप' },
  PADDLE_SWEEP: { id: 'paddlesweep', shotKey: 'paddle_sweep', anim: 'paddle_flick', nameEn: 'PADDLE FLICK', nameHi: 'पैडल फ्लिक' },
  FINE_GLANCE: { id: 'fineglance', shotKey: 'fine_glance', anim: 'glance', nameEn: 'FINE LEG GLANCE', nameHi: 'फाइन लेग ग्लांस' },
  SCOOP_SHOT: { id: 'scoop', shotKey: 'scoop_shot', anim: 'scoop', nameEn: 'DILSCOOP', nameHi: 'स्कूप शॉट' },
  RAMP_SHOT: { id: 'ramp', shotKey: 'ramp_shot', anim: 'ramp', nameEn: 'RAMP SHOT', nameHi: 'रैम्प शॉट' },
  HELICOPTER_LOFT: { id: 'helicopter', shotKey: 'helicopter_loft', anim: 'helicopter', nameEn: 'HELICOPTER SHOT', nameHi: 'हेलिकॉप्टर शॉट' },
  LOFTED_DRIVE: { id: 'loft', shotKey: 'lofted_six', anim: 'loft', nameEn: 'LOFTED STRAIGHT SIX', nameHi: 'लॉफ्टेड स्ट्रेट सिक्स' },
  DEFENCE: { id: 'defence', shotKey: 'defence', anim: 'defence', nameEn: 'SOLID DEFENCE', nameHi: 'डिफेंस' }
};

export const TIMING_WINDOWS_MS = {
  rookie: { perfect: 148, good: 260, mistime: 370 },
  easy: { perfect: 148, good: 260, mistime: 370 },
  medium: { perfect: 118, good: 222, mistime: 335 },
  pro: { perfect: 118, good: 222, mistime: 335 },
  hard: { perfect: 92, good: 182, mistime: 285 },
  legend: { perfect: 92, good: 182, mistime: 285 }
};

export const STEPS_PER_RUN = 20;

export class BattingSystem {
  constructor() {
    // Pre-selected Shot Mode ('ground' | 'fly')
    this.shotMode = 'ground'; // Default GROUND
    this.modeLocked = false;  // Locks at bowler's release moment
    this.handedness = 'right'; // 'right' | 'left' (mirrors off/leg shot classification)

    // Power Surge / ON FIRE Streak State (3 boundaries or perfect hits -> 2 balls of ON FIRE boost!)
    this.streakCount = 0;
    this.onFireBallsLeft = 0;

    // Stance & Crease position
    this.screenRightSign = -1; // -1 in Broadcast camera (looking +Z, so Screen-Right is -X); +1 in Pro/Overhead camera
    this.creaseX = 0.0;       // Lateral guard (-0.52m to +0.52m)
    this.manualCreaseOffsetX = 0.0; // Persistent manual step/drag offset so 85Hz sensor stream never wipes STEP L/R
    this.sensorCreaseOffsetX = 0.0; // Live phone tilt lateral offset
    this.creaseZOffset = 0.0; // Forward (+0.55m) or Back (-0.45m)
    this.footwork = 'neutral';
    this.bodyPivotYaw = 0.0;  // Visual pivot of batsman feet & shoulders toward 360° shot direction

    // Calibration State
    this.isCalibrating = false;
    this.calibProgress = 0;
    this.isCalibrated = false;
    this.hasAutoStance = false;
    this.stanceAlpha = 0;
    this.stanceBeta = 70;
    this.stanceGamma = 0;
    this.phoneRightDeg = 0;   // Positive = Phone tilted/turned RIGHT, Negative = Phone tilted/turned LEFT
    this.qStance = new THREE.Quaternion();
    this.currentQuat = new THREE.Quaternion();
    this.batVisualQuat = new THREE.Quaternion();

    // Raw & Calibrated Sensor Telemetry (for on-screen Debug Panel)
    this.rawAlpha = 0;
    this.rawBeta = 0;
    this.rawGamma = 0;
    this.calYawDeg = 0;
    this.calPitchDeg = 0;
    this.calRollDeg = 0;

    // Low-Lag Filtered Gyroscope & 360° Horizontal Swing Plane Tracking
    this.filteredOmega = new THREE.Vector3(0, 0, 0); // deg/s (pitchRate, yawRate, rollRate)
    this.filteredAccel = new THREE.Vector3(0, 0, 0);
    this.angularSpeedDeg = 0;
    this.peakSwingSpeedDeg = 0;
    this.swingPlaneYaw = 0;        // Full 360° angle in radians (-PI to +PI; 0 = straight down ground)
    this.swingDirectionDeg = 0;    // Full 360° angle in degrees (-180° to +180°)
    this.swingPlanePitchDeg = 0;   // Swing vertical trajectory: flat (~0-8°) vs rising low-to-high (>15°)
    this.isRisingSwing = false;
    this.backliftAngle = 0.25;
    this.lastLaunchAngleDeg = 0;

    // Swing detection state
    this.isSwinging = false;
    this.swingStartTime = 0;
    this.swingPeakTime = 0;
    this.swingStartPitchDeg = 0;
    this.lastSwingTime = 0;
    this.manualSwingAimLockUntil = 0;
    this.wheelAimLockedThisBall = false;
    this.needsSoftStanceRecenter = false;
    this.steadyStanceTimer = 0;
    this.worldGyroRightRate = 0;
    this.autoTrackBallEnabled = true;
    this.manualCreaseOverrideThisBall = false;
    this.lastFlickTime = 0;
    this.manualSwingArmed = false;
    this.shotExecutedThisBall = false;
    this.activeShotType = SHOT_TYPES.STRAIGHT_DRIVE;
    this.sensitivity = 1.0;

    // Real Running Between the Wickets (Accelerometer Step Detection & Cadence)
    this.runWindowActive = false;
    this.bowlingActive = false;
    this.gravityEst = 9.81;
    this.highPassAccel = 0;
    this.stepAboveThreshold = false;
    this.lastStepTime = 0;
    this.stepTimestamps = []; // Rolling timestamps within last 1.2s for cadence (steps/sec)
    this.cadenceSps = 0;      // Current running cadence in steps/second
    this.accumulatedStepsThisRun = 0; // 20 steps = 1 run
    this.totalStepsThisBall = 0;
    this.holdRunActive = false; // Keyboard R or on-screen/phone HOLD RUN button fallback
    this.holdStepAccum = 0;

    // Keyboard, 360° Angle Wheel & Touch Direction State
    this.keys = {
      left: false,
      right: false,
      up: false,
      down: false
    };
    this.aimDirectionX = 0;
    this.aimDirectionZ = 1; // +1 = forward (0°), -1 = behind wicket (180°)
    this.virtualStickActive = false;
    this.custom360AimDeg = 0; // Screen angle in degrees (-180..+180, 0 = Straight toward bowler)
    this.autoResetAimEveryBall = true; // Resets wheel angle to 0° Straight after each ball
    this.shotAssistGapSnap = true; // Snaps angle up to 10° toward nearest fielding gap when ON
    this.controllerLayoutHand = 'right'; // 'right' = Wheel Left / Buttons Right, 'left' = Swapped
    this.stepOutCharge = false; // Toggleable Step-Out / Charge Down Pitch stance (z offset +0.42m)

    // Last contact telemetry for HUD & Debug Panel
    this.lastContact = {
      timingLabelEn: 'READY',
      timingLabelHi: 'तैयार',
      timingOffsetMs: 0,
      timingQuality: 0,
      batSpeedDeg: 0,
      exitSpeedKmh: 0,
      launchAngleDeg: 0,
      shotDirectionDeg: 0,
      shotMode: 'ground',
      swingPlaneLabel: 'FLAT (0°)',
      contactType: 'None',
      shotKey: 'straight_drive',
      shotAnim: 'drive',
      shotNameEn: 'STRAIGHT DRIVE',
      shotNameHi: 'स्ट्रेट ड्राइव',
      didHit: false,
      outcome: 'none'
    };
  }

  isOnFire() {
    return this.onFireBallsLeft > 0;
  }

  resetStreak() {
    this.streakCount = 0;
    this.onFireBallsLeft = 0;
  }

  registerDeliveryStreakOutcome({ runsScored = 0, isBoundary = false, isWicket = false }) {
    const wasOnFire = this.onFireBallsLeft > 0;
    if (isWicket || (runsScored === 0 && !isBoundary)) {
      this.streakCount = 0;
      this.onFireBallsLeft = 0;
      return { triggeredOnFire: false, isOnFire: false, streakCount: 0, onFireBallsLeft: 0 };
    }

    if (wasOnFire) {
      this.onFireBallsLeft = Math.max(0, this.onFireBallsLeft - 1);
      if (this.onFireBallsLeft === 0) {
        this.streakCount = isBoundary ? 1 : 0;
      }
      return {
        triggeredOnFire: false,
        isOnFire: this.onFireBallsLeft > 0,
        streakCount: this.streakCount,
        onFireBallsLeft: this.onFireBallsLeft
      };
    }

    const goodBallHit = isBoundary || (this.lastContact.didHit && this.lastContact.timingQuality >= 0.85 && runsScored >= 2);
    if (goodBallHit) {
      this.streakCount = Math.min(3, this.streakCount + 1);
      if (this.streakCount >= 3) {
        this.onFireBallsLeft = 2; // Next 2 deliveries get ON FIRE Power Surge!
        return {
          triggeredOnFire: true,
          isOnFire: true,
          streakCount: 3,
          onFireBallsLeft: this.onFireBallsLeft
        };
      }
    }
    return {
      triggeredOnFire: false,
      isOnFire: false,
      streakCount: this.streakCount,
      onFireBallsLeft: 0
    };
  }

  setHandedness(hand = 'right') {
    this.handedness = hand === 'left' ? 'left' : 'right';
  }

  setShotMode(mode, force = false) {
    // Allow switching GROUND / LOFT / DEFEND anytime before the ball is actually hit!
    if (this.shotExecutedThisBall && this.modeLocked && !force) return false;
    const normalized = mode === 'loft' ? 'fly' : mode === 'defence' ? 'defend' : mode;
    if (normalized === 'ground' || normalized === 'fly' || normalized === 'defend') {
      this.shotMode = normalized;
      return true;
    }
    return false;
  }

  getShotModeLabel() {
    if (this.shotMode === 'fly') return 'LOFT';
    if (this.shotMode === 'defend') return 'DEFEND';
    return 'GROUND';
  }

  lockShotMode() {
    // Only lock after contact is executed; pre-contact mode switching remains open
    this.modeLocked = Boolean(this.shotExecutedThisBall);
  }

  unlockShotMode() {
    this.modeLocked = false;
  }

  /**
   * Solution 1 + Solution 2 Combo:
   * Deterministic skill-based footwork from 360° shot direction & ball length (zero random RNG penalty!).
   * - Forward hemisphere (drives, flicks, straight lofts, sweeps) => 'front' footwork
   * - Square/behind hemisphere on short/back-of-length balls (pulls, hooks, cuts) => 'back' footwork
   */
  toggleStepOutCharge(forceState = null) {
    this.stepOutCharge = typeof forceState === 'boolean' ? forceState : !this.stepOutCharge;
    if (this.stepOutCharge) {
      this.footwork = 'front';
      this.creaseZOffset = 0.42;
    } else {
      this.footwork = this.computeSmartFootwork(this.swingPlaneYaw, null);
      this.creaseZOffset = this.footwork === 'front' ? 0.16 : -0.16;
    }
    return this.stepOutCharge;
  }

  computeSmartFootwork(yawRad = this.swingPlaneYaw, ball = null) {
    if (this.keys.up || this.stepOutCharge) return 'front';
    if (this.keys.down) return 'back';

    const absDeg = Math.abs(THREE.MathUtils.radToDeg(yawRad || 0));
    if (ball && ball.state === 'bowled') {
      const bounceZ = ball.pitchBouncePos?.z ?? 4.5;
      const isShortBall = ball.bouncedOnPitch && bounceZ < 3.2;
      if (isShortBall) {
        return absDeg >= 30 ? 'back' : 'front';
      }
      // Full, Yorker, or Good-length delivery: forward drives/lofts/flicks & scoops use front foot; square cuts/pulls use back foot
      if (absDeg <= 78 || absDeg > 148) {
        return 'front';
      }
      return 'back';
    }

    // Solution 2: Pre-delivery Angle Wheel / Stance mapping (Front hemisphere <= 72° => 'front', Square/Behind > 72° => 'back')
    return absDeg <= 72 ? 'front' : 'back';
  }

  setWheelAimDeg(deg = 0, fromUserWheel = true) {
    const wrapped = ((((Number(deg) || 0) + 180) % 360) + 360) % 360 - 180;
    this.custom360AimDeg = Math.round(wrapped);
    this.virtualStickActive = true;
    if (fromUserWheel) {
      this.wheelAimLockedThisBall = true;
    }
    const dirSign = this.screenRightSign || -1;
    const worldRad = THREE.MathUtils.degToRad(this.custom360AimDeg * dirSign);
    this.swingPlaneYaw = Math.atan2(Math.sin(worldRad), Math.cos(worldRad));
    this.swingDirectionDeg = Math.round(THREE.MathUtils.radToDeg(this.swingPlaneYaw));
    this.aimDirectionX = Math.sin(THREE.MathUtils.degToRad(this.custom360AimDeg));
    this.aimDirectionZ = Math.cos(THREE.MathUtils.degToRad(this.custom360AimDeg));
    if (!this.keys.up && !this.keys.down) {
      this.footwork = this.computeSmartFootwork(this.swingPlaneYaw, null);
      this.creaseZOffset = this.stepOutCharge ? 0.42 : this.footwork === 'front' ? 0.16 : -0.16;
    }
    return this.custom360AimDeg;
  }

  getGapSnapLimitDeg(difficulty = 'pro') {
    const diffProfile = getDifficultyProfile(difficulty);
    const assist = diffProfile ? diffProfile.battingAssist : 'light';
    return assist === 'full' ? 10.5 : assist === 'light' ? 7.5 : 4.5;
  }

  computeGapSnappedYaw(rawYawRad, fielders, maxSnapDeg = 7.5) {
    if (!this.shotAssistGapSnap || maxSnapDeg <= 0.1 || !Array.isArray(fielders) || fielders.length < 2) {
      return rawYawRad;
    }
    const angles = fielders
      .map((f) => {
        const fx = f?.pos?.x ?? 0;
        const fz = (f?.pos?.z ?? 0) - CREASE_Z;
        return Math.atan2(fx, -fz);
      })
      .sort((a, b) => a - b);

    let bestMid = rawYawRad;
    let bestScore = -Infinity;
    for (let i = 0; i < angles.length; i++) {
      const a1 = angles[i];
      const a2 = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
      const gapWidth = a2 - a1;
      if (gapWidth < THREE.MathUtils.degToRad(14)) continue;
      const midRaw = a1 + gapWidth * 0.5;
      const mid = Math.atan2(Math.sin(midRaw), Math.cos(midRaw));
      const diff = Math.atan2(Math.sin(mid - rawYawRad), Math.cos(mid - rawYawRad));
      const absDiff = Math.abs(diff);
      if (absDiff <= THREE.MathUtils.degToRad(24)) {
        const score = gapWidth - absDiff * 1.45;
        if (score > bestScore) {
          bestScore = score;
          bestMid = mid;
        }
      }
    }

    if (bestScore === -Infinity) return rawYawRad;
    const delta = Math.atan2(Math.sin(bestMid - rawYawRad), Math.cos(bestMid - rawYawRad));
    const maxSnapRad = THREE.MathUtils.degToRad(maxSnapDeg);
    const snapped = rawYawRad + THREE.MathUtils.clamp(delta, -maxSnapRad, maxSnapRad);
    return Math.atan2(Math.sin(snapped), Math.cos(snapped));
  }

  resetForNextBall({ preserveWheelAim = false, resetCreaseX = false } = {}) {
    this.isSwinging = false;
    this.swingPeakTime = 0;
    this.lastSwingTime = 0;
    this.peakSwingSpeedDeg = 0;
    this.manualSwingArmed = false;
    this.shotExecutedThisBall = false;
    this.activeShotType = SHOT_TYPES.STRAIGHT_DRIVE;
    this.modeLocked = false;
    this.manualSwingAimLockUntil = 0;
    this.backliftAngle = 0.25;
    this.bodyPivotYaw = 0;
    this.creaseZOffset = 0;
    this.sensorCreaseOffsetX = 0;
    this.needsSoftStanceRecenter = true;
    this.steadyStanceTimer = 0;
    this.worldGyroRightRate = 0;
    if (resetCreaseX) {
      this.creaseX = 0;
      this.manualCreaseOffsetX = 0;
      this.manualCreaseOverrideThisBall = false;
      this.phoneRightDeg = 0;
      this.stepOutCharge = false;
    } else {
      this.creaseX = THREE.MathUtils.clamp(this.manualCreaseOffsetX || this.creaseX || 0, -0.62, 0.62);
    }
    this.footwork = this.stepOutCharge ? 'front' : 'neutral';
    if (this.stepOutCharge) {
      this.creaseZOffset = 0.42;
    }
    if (!preserveWheelAim && this.autoResetAimEveryBall !== false) {
      this.wheelAimLockedThisBall = false;
      this.custom360AimDeg = 0;
      this.swingPlaneYaw = 0;
      this.swingDirectionDeg = 0;
      this.aimDirectionX = 0;
      this.aimDirectionZ = 1;
    }
    this.lastContact.didHit = false;
    this.lastContact.outcome = 'none';
    this.runWindowActive = false;
    this.cadenceSps = 0;
    this.accumulatedStepsThisRun = 0;
    this.totalStepsThisBall = 0;
    this.stepTimestamps = [];
    this.holdStepAccum = 0;
  }

  startRunWindow() {
    this.runWindowActive = true;
    this.isSwinging = false;
    this.cadenceSps = 0;
    this.accumulatedStepsThisRun = 0;
    this.totalStepsThisBall = 0;
    this.stepTimestamps = [];
    const nowSec = performance.now() * 0.001;
    this.runWindowStartTime = nowSec;
    this.lastStepTime = nowSec;
    this.holdStepAccum = 0;
  }

  stopRunWindow() {
    this.runWindowActive = false;
    this.cadenceSps = 0;
    this.holdRunActive = false;
  }

  registerStep(nowSec = performance.now() * 0.001) {
    if (!this.runWindowActive || this.isSwinging || this.bowlingActive) return false;
    // 400ms post-swing cooldown so the physical follow-through of the bat swing never triggers an accidental run
    if (nowSec - (this.runWindowStartTime || 0) < 0.40) return false;
    if (nowSec - (this.lastSwingTime || 0) < 0.40) return false;
    if (nowSec - this.lastStepTime < 0.16) return false;
    this.lastStepTime = nowSec;
    this.accumulatedStepsThisRun += 1;
    this.totalStepsThisBall += 1;
    this.stepTimestamps.push(nowSec);
    // Keep steps within rolling 1.2s window
    while (this.stepTimestamps.length > 0 && nowSec - this.stepTimestamps[0] > 1.2) {
      this.stepTimestamps.shift();
    }
    this.cadenceSps = THREE.MathUtils.clamp(this.stepTimestamps.length / 1.0, 1.2, 6.5);
    return true;
  }

  startCalibration() {
    this.isCalibrating = true;
    this.calibProgress = 0;
  }

  instantZeroStance() {
    this.buildDeviceQuaternion(this.rawAlpha, this.rawBeta, this.rawGamma);
    this.qStance.copy(_qCurrent);
    this.stanceAlpha = this.rawAlpha;
    this.stanceBeta = this.rawBeta;
    this.stanceGamma = this.rawGamma;
    this.phoneRightDeg = 0;
    this.worldGyroRightRate = 0;
    this.wheelAimLockedThisBall = false;
    this.custom360AimDeg = 0;
    this.swingPlaneYaw = 0;
    this.swingDirectionDeg = 0;
    this.hasAutoStance = true;
    this.hasHardwareStance = true;
    this.isCalibrated = true;
    this.needsSoftStanceRecenter = false;
    this.steadyStanceTimer = 0;
  }

  autoTrackBallPosition(ball, dt = 0.016, difficulty = 'medium') {
    if (!this.autoTrackBallEnabled || this.manualCreaseOverrideThisBall) return;
    if (!ball || ball.state !== 'bowled' || this.shotExecutedThisBall) return;
    if (this.keys.left || this.keys.right) return;

    const diffProfile = getDifficultyProfile(difficulty);
    const assist = diffProfile ? diffProfile.battingAssist : 'light';

    // Scale auto-tracking by difficulty so swing, seam & spin genuinely challenge line on Medium/Hard!
    // Easy (full): comfortable tracking; Medium (light): subtle lean; Hard (off): minimal drift — manual footwork shines!
    const isProjectedWide = Math.abs(ball.targetX || 0) > 0.52;
    const baseTrackLimit = assist === 'full' ? 0.36 : assist === 'light' ? 0.22 : 0.10;
    const trackLimit = isProjectedWide ? Math.min(0.18, baseTrackLimit) : baseTrackLimit;
    const dampRate = assist === 'full' ? 9.5 : assist === 'light' ? 5.2 : 2.8;
    const predictedX = ball.pos.x + (ball.pos.z < CREASE_Z - 0.55 ? (ball.vel.x || 0) * 0.04 : 0);
    const targetX = THREE.MathUtils.clamp(predictedX, -trackLimit, trackLimit);
    this.manualCreaseOffsetX = THREE.MathUtils.damp(this.manualCreaseOffsetX, targetX, dampRate, dt);
    this.creaseX = this.manualCreaseOffsetX;
  }

  buildDeviceQuaternion(alphaDeg, betaDeg, gammaDeg) {
    const a = THREE.MathUtils.degToRad(alphaDeg || 0);
    const b = THREE.MathUtils.degToRad(betaDeg || 0);
    const g = THREE.MathUtils.degToRad(gammaDeg || 0);
    // Exact W3C DeviceOrientation intrinsic ZXY order: Rz(alpha) * Rx(beta) * Ry(gamma)
    _deviceEuler.set(b, g, a, 'ZXY');
    _qCurrent.setFromEuler(_deviceEuler);
    return _qCurrent;
  }

  /**
   * Computes full 360° horizontal swing direction in [-PI, +PI] (0 = straight down ground over bowler)
   * directly from 3D Quaternion World-Up twist + World-space horizontal gyro sweep velocity so
   * whichever direction the batsman swings/points the phone as a bat, the shot goes cleanly there!
   */
  compute360SwingDirection(fromHardwareGyro = false) {
    const dirSign = this.screenRightSign || -1;
    const poseRightDeg = this.phoneRightDeg || 0;
    const gyroRightRate = this.worldGyroRightRate || 0;

    // Apply ±6° straight sweet-spot deadzone so natural wrist tremor during straight drives stays dead straight
    const dampedPoseDeg =
      Math.abs(poseRightDeg) <= 6
        ? poseRightDeg * 0.25
        : Math.sign(poseRightDeg) * (1.5 + (Math.abs(poseRightDeg) - 6) * 0.96);

    // Horizontal angular velocity sweep lead (~100ms) in World horizontal plane
    const gyroSweepDeg = THREE.MathUtils.clamp(gyroRightRate * 0.10, -95, 95);
    const effectiveGyroSweep =
      Math.abs(dampedPoseDeg) > 45 && gyroSweepDeg * dampedPoseDeg < 0
        ? gyroSweepDeg * 0.25
        : gyroSweepDeg;

    let combinedRightDeg = THREE.MathUtils.clamp(
      dampedPoseDeg + effectiveGyroSweep,
      -172,
      172
    );

    // When swinging physically with hardware gyro, ALWAYS respect the user's bat swing direction!
    // Only fall back to wheel aim when NOT from hardware gyro (or if no hardware stance exists).
    if (!fromHardwareGyro && this.wheelAimLockedThisBall && typeof this.custom360AimDeg === 'number') {
      combinedRightDeg = this.custom360AimDeg;
    }

    // Map screen-right angle into 3D world yaw using dirSign (-1 in Broadcast TV view, +1 in Pro view)
    const worldYawRad = THREE.MathUtils.degToRad(combinedRightDeg * dirSign);
    return Math.atan2(Math.sin(worldYawRad), Math.cos(worldYawRad));
  }

  /**
   * Maps any 360-degree angle (-PI to +PI) to authentic cricket shots & fielding zones,
   * automatically mirroring Off-Side and Leg-Side for Left-Handed batsmen.
   */
  classifyShot(yawRad, isLofted, speedDeg, isShortBall = false, isFullBall = false, isSpinOrSlow = false) {
    if (speedDeg < 165) return SHOT_TYPES.DEFENCE;

    // For a Right-Handed batter, +yawRad (right) is Off-Side, -yawRad (left) is Leg-Side.
    // For a Left-Handed batter, mirror the sign so +yawRad (right) is Leg-Side and -yawRad (left) is Off-Side!
    const handSign = this.handedness === 'left' ? -1 : 1;
    const tacticalDeg = THREE.MathUtils.radToDeg(yawRad) * handSign; // + = Off Side, - = Leg Side
    const absDeg = Math.abs(tacticalDeg);

    // 1. Straight Zone (~0° to 24°)
    if (absDeg <= 24) {
      if (isLofted) {
        return tacticalDeg < -10 && isFullBall ? SHOT_TYPES.HELICOPTER_LOFT : SHOT_TYPES.LOFTED_DRIVE;
      }
      return SHOT_TYPES.STRAIGHT_DRIVE;
    }

    // 2. Forward Off / Leg Drives, Inside-Out Lofts, On-Whip & Knee-Drop Slog-Sweeps (~24° to 64°)
    if (absDeg <= 64) {
      if (tacticalDeg > 0) {
        return isLofted ? SHOT_TYPES.INSIDE_OUT_LOFT : SHOT_TYPES.COVER_DRIVE;
      }
      if (isLofted) {
        return absDeg >= 36 ? SHOT_TYPES.SLOG_SWEEP : (isFullBall ? SHOT_TYPES.HELICOPTER_LOFT : SHOT_TYPES.LOFTED_DRIVE);
      }
      if (isShortBall && absDeg >= 34) {
        return SHOT_TYPES.PULL_SHOT;
      }
      return absDeg <= 48 ? SHOT_TYPES.ON_DRIVE : SHOT_TYPES.LEG_FLICK;
    }

    // 3. Square Off / Leg Cuts, Lofted Cuts, Pulls, Hooks & Sweeps (~64° to 120°)
    if (absDeg <= 120) {
      if (tacticalDeg > 0) {
        if (isLofted) {
          return isShortBall ? SHOT_TYPES.UPPER_CUT : SHOT_TYPES.LOFTED_CUT;
        }
        return SHOT_TYPES.SQUARE_CUT;
      }
      if (isLofted) {
        return isShortBall || absDeg >= 82 ? SHOT_TYPES.HOOK_SHOT : SHOT_TYPES.SLOG_SWEEP;
      }
      if (isShortBall) {
        return SHOT_TYPES.PULL_SHOT;
      }
      if (isSpinOrSlow) {
        return SHOT_TYPES.SWEEP_SHOT;
      }
      return SHOT_TYPES.LEG_FLICK;
    }

    // 4. Behind the Wicket (~120° to 154°): Late Cut, Upper Cut, Reverse Sweep, Paddle Flick, Helicopter Whip, Hook
    if (absDeg <= 154) {
      if (tacticalDeg > 0) {
        if (isLofted) {
          return isSpinOrSlow ? SHOT_TYPES.REVERSE_SWEEP : SHOT_TYPES.UPPER_CUT;
        }
        return SHOT_TYPES.LATE_CUT;
      }
      if (isLofted) {
        return isShortBall ? SHOT_TYPES.HOOK_SHOT : SHOT_TYPES.HELICOPTER_LOFT;
      }
      return isShortBall ? SHOT_TYPES.PULL_SHOT : SHOT_TYPES.PADDLE_SWEEP;
    }

    // 5. 154° to 180° directly behind the keeper/slips
    if (!isLofted) {
      return tacticalDeg >= 0 ? SHOT_TYPES.LATE_CUT : SHOT_TYPES.FINE_GLANCE;
    }
    return tacticalDeg >= 0 ? SHOT_TYPES.RAMP_SHOT : SHOT_TYPES.SCOOP_SHOT;
  }

  /**
   * Processes 60-100Hz phone sensor packets with:
   * - Gimbal-free stance calibration (q_stance^-1 * q_current + direct wrapped Euler deltas)
   * - Consistent Left/Right mapping in both TV Broadcast and Batsman camera views
   * - Non-destructive crease offset so STEP L / STEP R buttons are never overwritten
   */
  ingestSensorPacket(data, dt = 0.014, hooks = {}) {
    this.rawAlpha = Number(data.alpha) || 0;
    this.rawBeta = Number(data.beta) || 0;
    this.rawGamma = Number(data.gamma) || 0;

    this.buildDeviceQuaternion(this.rawAlpha, this.rawBeta, this.rawGamma);

    const isDefaultSyntheticPacket =
      this.rawAlpha === 0 && this.rawBeta === 75 && this.rawGamma === 0;
    if ((!this.hasAutoStance || (!this.hasHardwareStance && !isDefaultSyntheticPacket)) && !this.isCalibrating) {
      this.qStance.copy(_qCurrent);
      this.stanceAlpha = this.rawAlpha;
      this.stanceBeta = this.rawBeta;
      this.stanceGamma = this.rawGamma;
      this.hasAutoStance = true;
      if (!isDefaultSyntheticPacket) {
        this.hasHardwareStance = true;
      }
      this.isCalibrated = true;
    }

    const fastAlpha = 0.78;
    const gx = (Number(data.gx) || 0) * this.sensitivity;
    const gy = (Number(data.gy) || 0) * this.sensitivity;
    const gz = (Number(data.gz) || 0) * this.sensitivity;

    this.filteredOmega.x = THREE.MathUtils.lerp(this.filteredOmega.x, gx, fastAlpha);
    this.filteredOmega.y = THREE.MathUtils.lerp(this.filteredOmega.y, gy, fastAlpha);
    this.filteredOmega.z = THREE.MathUtils.lerp(this.filteredOmega.z, gz, fastAlpha);

    const ax = Number(data.ax) || 0;
    const ay = Number(data.ay) || 0;
    const az = Number(data.az) || 0;
    this.filteredAccel.x = THREE.MathUtils.lerp(this.filteredAccel.x, ax, fastAlpha);
    this.filteredAccel.y = THREE.MathUtils.lerp(this.filteredAccel.y, ay, fastAlpha);
    this.filteredAccel.z = THREE.MathUtils.lerp(this.filteredAccel.z, az, fastAlpha);

    const omegaMag = this.filteredOmega.length();
    this.angularSpeedDeg = omegaMag;

    // 3-Second Upright Calibration
    if (this.isCalibrating) {
      if (omegaMag < 75) {
        this.calibProgress = Math.min(1.0, this.calibProgress + dt / 3.0);
        if (this.calibProgress >= 1.0) {
          this.qStance.copy(_qCurrent);
          this.stanceAlpha = this.rawAlpha;
          this.stanceBeta = this.rawBeta;
          this.stanceGamma = this.rawGamma;
          this.manualCreaseOffsetX = 0;
          this.sensorCreaseOffsetX = 0;
          this.creaseX = 0;
          this.hasAutoStance = true;
          this.hasHardwareStance = true;
          this.isCalibrating = false;
          this.isCalibrated = true;
          if (hooks.onCalibrationComplete) hooks.onCalibrationComplete();
        }
      } else {
        this.calibProgress = Math.max(0, this.calibProgress - dt * 0.35);
      }
      return;
    }

    // Apply calibration in local stance frame: q_rel = inverse(q_stance) * q_current
    _qStanceInv.copy(this.qStance).invert();
    _qRel.copy(_qStanceInv).multiply(_qCurrent).normalize();

    // True 3D World-space angular velocity (device axes: X=betaRate, Y=gammaRate, Z=alphaRate)
    _omegaDevice.set(this.filteredOmega.x, this.filteredOmega.z, this.filteredOmega.y);
    _omegaWorld.copy(_omegaDevice).applyQuaternion(_qCurrent);
    this.worldGyroRightRate = -_omegaWorld.z;

    const predictionSec = 0.022;
    const omegaRadMag = THREE.MathUtils.degToRad(omegaMag);
    if (omegaRadMag > 0.05) {
      _omegaAxis
        .set(
          THREE.MathUtils.degToRad(_omegaDevice.x),
          THREE.MathUtils.degToRad(_omegaDevice.y),
          THREE.MathUtils.degToRad(_omegaDevice.z)
        )
        .normalize();
      _qPredDelta.setFromAxisAngle(_omegaAxis, omegaRadMag * predictionSec);
      _qPredicted.copy(_qRel).multiply(_qPredDelta).normalize();
    } else {
      _qPredicted.copy(_qRel);
    }

    this.currentQuat.slerp(_qPredicted, 0.85);
    _relEuler.setFromQuaternion(this.currentQuat, 'YXZ');

    // Compute 3D World-Up Horizontal Twist Angle from calibrated stance: q_worldDelta = q_current * inverse(q_stance)
    _qWorldDelta.copy(_qCurrent).multiply(_qStanceInv).normalize();
    const rawTwistZ = 2 * Math.atan2(_qWorldDelta.z, _qWorldDelta.w);
    const twistZRad = Math.atan2(Math.sin(rawTwistZ), Math.cos(rawTwistZ));
    let worldPoseRightDeg = THREE.MathUtils.clamp(-THREE.MathUtils.radToDeg(twistZRad), -170, 170);

    // Wrapped Euler deltas for pitch telemetry & backlift display
    let dAlpha = ((((this.rawAlpha - this.stanceAlpha) + 180) % 360) + 360) % 360 - 180;
    const dBeta = THREE.MathUtils.clamp(this.rawBeta - this.stanceBeta, -90, 90);
    let dGamma = ((((this.rawGamma - this.stanceGamma) + 180) % 360) + 360) % 360 - 180;

    // Gentle drift cleanup ONLY when batter is holding steady near their forward 0° stance (< 16° off-center)
    // Never erases a deliberate Cover / Leg-side bat aim!
    if (!this.isSwinging && !isDefaultSyntheticPacket && omegaMag < 24 && Math.abs(worldPoseRightDeg) < 16) {
      if (this.needsSoftStanceRecenter && !hooks.canSwing) {
        this.steadyStanceTimer = (this.steadyStanceTimer || 0) + dt;
        if (this.steadyStanceTimer >= 0.35) {
          this.stanceAlpha = this.rawAlpha;
          this.stanceBeta = this.rawBeta;
          this.stanceGamma = this.rawGamma;
          this.qStance.copy(_qCurrent);
          this.needsSoftStanceRecenter = false;
          this.steadyStanceTimer = 0;
          worldPoseRightDeg = 0;
          dAlpha = 0;
          dGamma = 0;
        }
      } else if (Math.abs(worldPoseRightDeg) < 7) {
        this.qStance.slerp(_qCurrent, Math.min(1, dt * 0.35));
      }
    } else {
      this.steadyStanceTimer = 0;
    }

    this.calPitchDeg = dBeta;
    this.calYawDeg = -worldPoseRightDeg;
    this.calRollDeg = dGamma;
    this.phoneRightDeg = worldPoseRightDeg;

    const nowSec = performance.now() * 0.001;

    // ==================== PART C: RUNNING WINDOW (BUTTON-DRIVEN ONLY) ====================
    if (this.runWindowActive) {
      return;
    }

    // Map calibrated orientation to 3D bat visual pose & Smart Auto-Footwork
    const dirSign = this.screenRightSign || -1;
    const pitchRad = THREE.MathUtils.degToRad(this.calPitchDeg);
    this.backliftAngle = THREE.MathUtils.clamp(pitchRad + 0.22, -0.95, 1.45);

    // Live Bat Aim Preview in Stance: smoothly point 3D bat & radar cone wherever the phone is turned as a bat!
    const hasPendingEarlySwing = Boolean(this.manualSwingArmed && !this.shotExecutedThisBall);
    if (
      !this.isSwinging &&
      !hasPendingEarlySwing &&
      !this.wheelAimLockedThisBall &&
      this.hasHardwareStance &&
      nowSec > (this.manualSwingAimLockUntil || 0)
    ) {
      const stanceAimDeg = Math.abs(this.phoneRightDeg) <= 6 ? 0 : this.phoneRightDeg;
      const targetWorldYaw = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(stanceAimDeg, -165, 165) * dirSign);
      this.swingPlaneYaw = THREE.MathUtils.lerp(this.swingPlaneYaw, Math.atan2(Math.sin(targetWorldYaw), Math.cos(targetWorldYaw)), Math.min(1, dt * 15));
      this.swingDirectionDeg = Math.round(THREE.MathUtils.radToDeg(this.swingPlaneYaw));
      this.custom360AimDeg = Math.round(this.swingDirectionDeg * dirSign);
    }

    if (!this.keys.up && !this.keys.down) {
      this.footwork = this.computeSmartFootwork(this.swingPlaneYaw, null);
      this.creaseZOffset = this.stepOutCharge ? 0.42 : this.footwork === 'front' ? 0.16 : -0.16;
    }

    // Phone tilt NEVER drifts batsman left/right creaseX — autoTrackBallPosition aligns batter to the ball!
    this.sensorCreaseOffsetX = 0;

    // Subtle pre-delivery bat-tap ("knocking the crease") when batter lightly taps phone downward in stance
    if (
      !this.isSwinging &&
      omegaMag > 38 &&
      omegaMag <= 98 &&
      this.filteredOmega.x < -28 &&
      nowSec - (this.lastCreaseTapTime || 0) > 0.38
    ) {
      this.lastCreaseTapTime = nowSec;
      this.backliftAngle = -0.18;
      if (hooks.onCreaseTap) hooks.onCreaseTap();
    }

    // ==================== PART B: INSTANT 360-DEGREE SWING DETECTION ====================
    // Filter out slow/moderate upward backlift preparation so cocking the wrists back doesn't misfire the downswing!
    const lateralOmega = Math.hypot(this.filteredOmega.y, this.filteredOmega.z);
    const isPureBackliftPrep =
      this.filteredOmega.x > 42 &&
      lateralOmega < this.filteredOmega.x * 0.82 &&
      omegaMag < 215;

    const canTriggerGyroSwing = hooks.canSwing !== false;
    if (
      canTriggerGyroSwing &&
      !isPureBackliftPrep &&
      omegaMag > 138 &&
      !this.isSwinging &&
      nowSec - this.lastSwingTime > 0.18
    ) {
      this.isSwinging = true;
      this.swingDispatched = false;
      this.wheelAimLockedThisBall = false; // Physical mobile swing always takes over from wheel!
      this.swingStartTime = nowSec;
      this.swingStartPitchDeg = this.calPitchDeg;
      // Track TRUE measured omegaMag as peak (never artificially clamp to 340 before peak check!)
      this.peakSwingSpeedDeg = omegaMag;
      this.swingPeakTime = nowSec;
      this.manualSwingAimLockUntil = nowSec + 1.45;
      this.swingPlaneYaw = this.compute360SwingDirection(true);
      this.swingDirectionDeg = Math.round(THREE.MathUtils.radToDeg(this.swingPlaneYaw));
      this.custom360AimDeg = Math.round(this.swingDirectionDeg * dirSign);
    }

    if (this.isSwinging) {
      if (omegaMag >= this.peakSwingSpeedDeg * 0.85) {
        this.peakSwingSpeedDeg = Math.max(this.peakSwingSpeedDeg, omegaMag);
        this.swingPeakTime = nowSec;
        this.manualSwingAimLockUntil = nowSec + 1.45;

        // Compute full 360-degree horizontal swing travel angle (-PI to +PI) from 3D quaternion + sweep velocity
        this.swingPlaneYaw = this.compute360SwingDirection(true);
        this.swingDirectionDeg = Math.round(THREE.MathUtils.radToDeg(this.swingPlaneYaw));
        this.custom360AimDeg = Math.round(this.swingDirectionDeg * dirSign);

        // Vertical swing plane: flat vs rising (low-to-high)
        const pitchRiseDeg = (this.calPitchDeg - this.swingStartPitchDeg) + Math.abs(this.filteredOmega.x) * 0.08;
        this.swingPlanePitchDeg = THREE.MathUtils.clamp(
          this.shotMode === 'fly' ? Math.max(24, pitchRiseDeg) : pitchRiseDeg,
          -20,
          55
        );
        this.isRisingSwing = this.shotMode === 'fly' || this.swingPlanePitchDeg > 10 || Math.abs(this.filteredOmega.x) > 120;

        const effectiveBatSpeed = Math.max(this.peakSwingSpeedDeg, 335);
        this.activeShotType = this.classifyShot(
          this.swingPlaneYaw,
          this.shotMode === 'fly',
          effectiveBatSpeed
        );

        // Capture true peak downswing arc (~42ms window or immediate on high-speed snap >= 310°/s)
        const elapsedSwingSec = nowSec - this.swingStartTime;
        if (!this.swingDispatched && (elapsedSwingSec >= 0.042 || omegaMag >= 310) && hooks.onSwingPeak) {
          this.swingDispatched = true;
          this.peakSwingSpeedDeg = effectiveBatSpeed;
          hooks.onSwingPeak({
            speedDeg: this.peakSwingSpeedDeg,
            yaw: this.swingPlaneYaw,
            directionDeg: this.swingDirectionDeg,
            planePitchDeg: this.swingPlanePitchDeg,
            isRisingSwing: this.isRisingSwing,
            peakTime: this.swingPeakTime,
            shotType: this.activeShotType
          });
        }
      }

      if (omegaMag < this.peakSwingSpeedDeg * 0.55 || nowSec - this.swingStartTime > 0.24) {
        this.isSwinging = false;
        this.lastSwingTime = nowSec;
        this.manualSwingAimLockUntil = nowSec + 1.45;
        this.peakSwingSpeedDeg = Math.max(this.peakSwingSpeedDeg, 335);
        if (!this.swingDispatched && hooks.onSwingPeak) {
          this.swingDispatched = true;
          hooks.onSwingPeak({
            speedDeg: this.peakSwingSpeedDeg,
            yaw: this.swingPlaneYaw,
            directionDeg: this.swingDirectionDeg,
            planePitchDeg: this.swingPlanePitchDeg,
            isRisingSwing: this.isRisingSwing,
            peakTime: this.swingPeakTime,
            shotType: this.activeShotType
          });
        }
      }
    }
  }

  /**
   * Keyboard & Touch 360-Degree Swing Trigger
   * Accepts explicit shotAngleDeg (-180..+180), angleRad (-PI..+PI), or (dirX, dirZ) vector!
   */
  triggerManualSwing({
    speedDeg = 440,
    dirX = 0,
    dirZ = null,
    angleRad = null,
    shotAngleDeg = null,
    planePitchDeg = null,
    isDefensive = false
  }) {
    if (this.runWindowActive) return; // Ignore swings while running between wickets!

    const nowSec = performance.now() * 0.001;
    const dirSign = this.screenRightSign || -1;
    this.lastSwingTime = nowSec;
    this.swingPeakTime = nowSec;
    this.manualSwingArmed = true;
    this.manualSwingAimLockUntil = nowSec + 0.95;
    const effectiveDefend = Boolean(isDefensive || this.shotMode === 'defend');
    this.peakSwingSpeedDeg = effectiveDefend ? 150 : speedDeg;

    if (typeof shotAngleDeg === 'number') {
      const r = THREE.MathUtils.degToRad(shotAngleDeg);
      this.swingPlaneYaw = Math.atan2(Math.sin(r), Math.cos(r));
    } else if (typeof angleRad === 'number') {
      this.swingPlaneYaw = Math.atan2(Math.sin(angleRad), Math.cos(angleRad));
    } else if (typeof dirZ === 'number') {
      this.swingPlaneYaw = Math.atan2(dirX, dirZ);
    } else {
      this.swingPlaneYaw = THREE.MathUtils.clamp(dirX * 1.15, -Math.PI, Math.PI);
    }
    this.swingDirectionDeg = Math.round(THREE.MathUtils.radToDeg(this.swingPlaneYaw));
    this.custom360AimDeg = Math.round(this.swingDirectionDeg * dirSign);

    if (planePitchDeg !== null) {
      this.swingPlanePitchDeg = effectiveDefend ? 2 : planePitchDeg;
    } else {
      this.swingPlanePitchDeg = this.shotMode === 'fly' ? 28 : effectiveDefend ? 2 : 4;
    }
    this.isRisingSwing = this.swingPlanePitchDeg > 11;
    this.activeShotType = effectiveDefend
      ? SHOT_TYPES.DEFENCE
      : this.classifyShot(
          this.swingPlaneYaw,
          this.shotMode === 'fly',
          this.peakSwingSpeedDeg
        );
    this.backliftAngle = effectiveDefend ? -0.32 : -0.68;
  }

  /**
   * Executes a 360-degree swipe/drag shot from the Real Cricket on-screen action buttons
   */
  triggerTouchSwipeShot({ angleRad = 0, power = 1.0, shotMode = 'ground' } = {}) {
    if (this.runWindowActive) return;
    this.setShotMode(shotMode, true);
    const dirSign = this.screenRightSign || -1;
    const worldAngleRad = angleRad * dirSign;
    const speedDeg = Math.round(
      THREE.MathUtils.clamp((shotMode === 'fly' ? 495 : 445) * power, 280, 560)
    );
    const planePitchDeg = shotMode === 'fly' ? 32 : 4;
    this.triggerManualSwing({
      speedDeg,
      angleRad: worldAngleRad,
      planePitchDeg,
      isDefensive: false
    });
  }

  /**
   * Evaluates 360-degree ball-bat contact with:
   * - Pre-selected Shot Mode (GROUND 0-8° vs FLY 20-50°)
   * - Full 360° horizontal swing direction (-180° to +180°)
   * - Difficulty rules for shots behind the wicket (Scoop, Ramp, Reverse Sweep, Late Cut) & wide shots
   */
  evaluateContact(ball, difficulty = 'pro', hooks = {}) {
    if (this.shotExecutedThisBall || ball.state !== 'bowled') return null;

    const nowSec = performance.now() * 0.001;
    const batZ = CREASE_Z - this.creaseZOffset;
    const distZ = Math.abs(ball.pos.z - batZ);

    const timeSinceSwing = nowSec - this.swingPeakTime;
    const swungWithinWindow =
      this.manualSwingArmed ||
      (this.swingPeakTime > 0 && Math.abs(timeSinceSwing) < 0.58) ||
      this.isSwinging;

    if (!swungWithinWindow) return null;
    // Wait until the ball enters the 3D bat-contact zone (batZ - 0.88m) to evaluate exact arrival delta
    if (ball.pos.z < batZ - 0.88) return null;

    this.shotExecutedThisBall = true;
    this.manualSwingArmed = false;

    // 1. Classify Ball Length & Bowler Pace/Spin Context
    const isFullToss = !ball.bouncedOnPitch;
    const bounceZ = ball.pitchBouncePos.z;
    const isYorker = ball.bouncedOnPitch && bounceZ >= 7.5;
    const isFullBall = isFullToss || (ball.bouncedOnPitch && bounceZ >= 5.0 && bounceZ < 7.5);
    const isShortBall = ball.bouncedOnPitch && bounceZ < 3.2;
    const isGoodLength = ball.bouncedOnPitch && bounceZ >= 3.2 && bounceZ < 5.0;
    const isSpinOrSlow = ball.bowlerType === 'spin' || (Number(ball.speedKmh) || 130) < 114;

    const diffProfile = getDifficultyProfile(difficulty);
    const assist = diffProfile ? diffProfile.battingAssist : 'light';
    const handSign = this.handedness === 'left' ? -1 : 1; // In world X & yaw: +handSign = Off side, -handSign = Leg side

    // Bug #1 Fix: Check true lateral distance from batsman's creaseX stance BEFORE applying batting assist magnet!
    // If a ball is bowled Wide (outside Off-Side Wide Guideline 0.55m or Leg-Side Wide -0.34m) and the batter hasn't
    // moved across to cover it (|ball.pos.x - this.creaseX| > 0.36m), OR if any ball is > 0.46m away from the batter,
    // swinging at it produces an authentic Play & Miss so the ball goes to the keeper and is called WIDE!
    const signedBallX = ball.pos.x * handSign;
    const signedCreaseX = this.creaseX * handSign;
    const distFromBatterX = Math.abs(ball.pos.x - this.creaseX);
    const isWideDeliveryLine =
      signedBallX > Math.max(0.55, signedCreaseX + 0.40) ||
      signedBallX < Math.min(-0.34, signedCreaseX - 0.24);

    if (distFromBatterX > 0.46 || (isWideDeliveryLine && distFromBatterX > 0.36)) {
      if (!this.keys.up && !this.keys.down) {
        this.footwork = this.computeSmartFootwork(this.swingPlaneYaw, ball);
        const isLoftSpinCharge = this.footwork === 'front' && this.shotMode === 'fly' && isSpinOrSlow;
        this.creaseZOffset = this.stepOutCharge || isLoftSpinCharge ? 0.42 : this.footwork === 'front' ? 0.18 : -0.18;
      }
      this.lastLaunchAngleDeg = 0;
      this.lastContact = {
        ...this.lastContact,
        timingLabelEn: isWideDeliveryLine ? 'WIDE · OUT OF REACH!' : 'PLAY & MISS (WIDE OF BAT)',
        timingLabelHi: isWideDeliveryLine ? 'वाइड · बल्ले की पहुँच से बाहर!' : 'बल्ले से चूकी गेंद!',
        timingOffsetMs: 0,
        timingQuality: 0,
        batSpeedDeg: Math.round(this.peakSwingSpeedDeg),
        exitSpeedKmh: 0,
        launchAngleDeg: 0,
        shotDirectionDeg: this.swingDirectionDeg,
        shotMode: this.shotMode,
        contactType: 'Play & Miss (Out of Reach)',
        shotKey: this.activeShotType.shotKey,
        shotAnim: this.activeShotType.anim,
        shotNameEn: this.activeShotType.nameEn,
        shotNameHi: this.activeShotType.nameHi,
        didHit: false,
        outcome: 'miss'
      };
      if (hooks.onSwingMiss) hooks.onSwingMiss(this.lastContact);
      return this.lastContact;
    }

    // Bat reach assist scaled tightly by difficulty so swing/spin outside off genuinely challenges the bat!
    const reachMaxBallX = assist === 'full' ? 0.50 : assist === 'light' ? 0.44 : 0.38;
    const reachLerp = assist === 'full' ? 0.68 : assist === 'light' ? 0.42 : 0.22;
    const effectiveReachX =
      Math.abs(ball.pos.x) <= reachMaxBallX
        ? THREE.MathUtils.lerp(this.creaseX, THREE.MathUtils.clamp(ball.pos.x, -0.44, 0.44), reachLerp)
        : this.creaseX;

    // Difficulty-scaled Gap Snap: helpful on Easy (7.5°), tiny nudge on Medium (2.0°), OFF on Hard (0°) so Field Radar truly matters!
    const maxGapSnapDeg = assist === 'full' ? 7.5 : assist === 'light' ? 2.0 : 0.0;
    if (this.shotAssistGapSnap && maxGapSnapDeg > 0 && Array.isArray(hooks.fielders) && this.activeShotType.id !== 'defence') {
      this.swingPlaneYaw = this.computeGapSnappedYaw(this.swingPlaneYaw, hooks.fielders, maxGapSnapDeg);
    }

    // Behind-the-keeper strokes (~152°..180°): allow Scoop & Ramp cleanly on loft + non-short balls,
    // and redirect grounded >152° into behind-square Fine Glance / Late Cut without artificial mistime penalty on full balls.
    const rawAbsDeg = Math.abs(THREE.MathUtils.radToDeg(this.swingPlaneYaw));
    let invalidBehindKeeperAttempt = false;
    if (rawAbsDeg > 152 && this.activeShotType.id !== 'defence') {
      const canPlayScoopOrRamp = this.shotMode === 'fly' && !isShortBall;
      if (!canPlayScoopOrRamp) {
        invalidBehindKeeperAttempt = isShortBall;
        const signYaw = this.swingPlaneYaw >= 0 ? 1 : -1;
        this.swingPlaneYaw = signYaw * THREE.MathUtils.degToRad(138);
      }
    }

    // Re-classify 360° shot with ball length & spin/slow context
    if (this.activeShotType.id !== 'defence') {
      this.activeShotType = this.classifyShot(
        this.swingPlaneYaw,
        this.shotMode === 'fly',
        this.peakSwingSpeedDeg,
        isShortBall,
        isFullBall || isYorker,
        isSpinOrSlow
      );
    }

    const absAngleDeg = Math.abs(THREE.MathUtils.radToDeg(this.swingPlaneYaw));
    const isBehindWicketShot = absAngleDeg > 118;

    // Solution 1 + Solution 2 Combo: Deterministic Smart Auto-Footwork on ball contact (zero RNG penalty!)
    // Normal front-foot stride (0.18m) keeps back foot grounded inside the Popping Crease;
    // holding W/Up-Arrow, toggling Step-Out Charge, or charging down the track in LOFT mode against spin advances out of the crease (0.42m) -> Stumping risk if missed!
    if (!this.keys.up && !this.keys.down) {
      this.footwork = this.computeSmartFootwork(this.swingPlaneYaw, ball);
      const isLoftSpinCharge = this.footwork === 'front' && this.shotMode === 'fly' && isSpinOrSlow && absAngleDeg <= 55;
      this.creaseZOffset = this.stepOutCharge || isLoftSpinCharge ? 0.42 : this.footwork === 'front' ? 0.18 : -0.18;
    }

    // 2. Skill-Based Temporal Timing Window Calculation (Consistent across Touch Button & Phone Swing, no duplicate loft penalty!)
    const onFireActive = this.isOnFire();
    const surgeSweetBoost = onFireActive
      ? (assist === 'full' ? 1.14 : assist === 'light' ? 1.08 : 1.04)
      : 1.0;
    const chargeBoost = this.stepOutCharge || this.creaseZOffset >= 0.24 ? 1.06 : 1.0;
    const surgePowerBoost = (onFireActive
      ? (assist === 'full' ? 1.08 : assist === 'light' ? 1.05 : 1.03)
      : 1.0) * chargeBoost;

    const baseWin = (diffProfile && diffProfile.timingWindowMs) || TIMING_WINDOWS_MS[difficulty] || TIMING_WINDOWS_MS.medium;
    const angleDifficultyScale = (isBehindWicketShot ? 0.92 : 1.0) * surgeSweetBoost;
    const win = {
      perfect: Math.round(baseWin.perfect * angleDifficultyScale),
      good: Math.round(baseWin.good * angleDifficultyScale),
      mistime: Math.round(baseWin.mistime * Math.min(1.12, surgeSweetBoost))
    };

    // Ideal swing/button press is slightly before the ball reaches the batter's true batZ (adjusted for back-foot/charge creaseZOffset!)
    // Compensate for live Wi-Fi controller round-trip / one-way latency stored in window.networkLatencyMs
    const networkLatencyMs = (typeof window !== 'undefined' && window.networkLatencyMs) ? window.networkLatencyMs : 15;
    const latencyOffsetSec = Math.min(0.08, Math.max(0, networkLatencyMs - 20) * 0.00125);
    const batZShift = -this.creaseZOffset; // +0.18m on back-foot short ball, -0.42m on step-out charge
    const incomingVz = Math.max(10, Math.abs(ball.vel?.z || 28));
    const batPlaneTimeOffset = batZShift / incomingVz;
    const idealTapTime = (ball.idealContactTime || nowSec) + batPlaneTimeOffset - (0.085 - latencyOffsetSec);
    const rawTimingGapSec = this.swingPeakTime - idealTapTime;
    // Authentic Early-Swing Risk:
    // - Easy (full assist): gentle floor inside mistime window so beginners still connect occasionally, NEVER free GOOD!
    // - Medium & Hard: NO early-mash forgiveness! Swinging too early (or getting fooled by a Slower Ball / Cutter)
    //   produces a true EARLY MISTIME (leading edge / skyer) or a clean SWING & MISS!
    const isDefenceShot = this.activeShotType.id === 'defence' || this.shotMode === 'defend';
    const timingGapSec =
      assist === 'full'
        ? Math.max(rawTimingGapSec, -((win.mistime - 12) * 0.001))
        : rawTimingGapSec;
    const clockGapMs = Math.abs(Math.round(timingGapSec * 1000));
    const absGapMs = clockGapMs;
    const timingGapMs = timingGapSec < 0 ? -absGapMs : absGapMs;

    // Defence gets a slightly wider safe-block window (+28ms) rewarding tactical survival on tough balls!
    const defBonusMs = isDefenceShot ? 28 : 0;
    const missBufferMs = assist === 'full' ? 60 : assist === 'light' ? 32 : 18;
    const isPerfectTiming = absGapMs <= win.perfect + defBonusMs && distZ <= 1.50;
    const isGoodTiming = !isPerfectTiming && absGapMs <= win.good + defBonusMs && distZ <= 1.66;
    const swungWayTooEarly = timingGapMs < -(win.mistime + missBufferMs + defBonusMs);
    const isCompleteMiss =
      !isPerfectTiming &&
      !isGoodTiming &&
      (swungWayTooEarly || absGapMs > win.mistime + missBufferMs + defBonusMs || distZ > 1.75);

    // 3. Contact Point, Late Swing/Spin Movement Challenge & Sweet Spot vs Bat Edge
    const assistTolerance = (assist === 'full' ? 0.84 : assist === 'light' ? 0.66 : 0.50) * surgeSweetBoost;
    const batSweetSpotX = effectiveReachX;
    const lateralScale = assist === 'full' ? 0.50 : assist === 'light' ? 0.68 : 0.85;
    // High swing, seam cut, or spin turn increases edge danger when timing isn't perfect!
    const ballMoveMag = Math.max(
      Math.abs(ball.swingCurl || 0),
      Math.abs(ball.spinTurn || 0),
      Math.abs(ball.seamCut || 0)
    );
    const movementDifficultyPenalty =
      !isPerfectTiming && !isDefenceShot && ballMoveMag > 0.42
        ? (assist === 'full' ? 0.03 : assist === 'light' ? 0.08 : 0.14) * ballMoveMag
        : 0;
    const lateralError = Math.abs(ball.pos.x - batSweetSpotX) * lateralScale + movementDifficultyPenalty;

    // Yorker blind-loft punishment: swinging wildly in FLY mode at a toe-crushing Yorker without good timing = YORKED!
    const yorkerBlindLoftMiss =
      isYorker &&
      this.shotMode === 'fly' &&
      !isBehindWicketShot &&
      !isPerfectTiming &&
      !isGoodTiming &&
      assist !== 'full';

    const unorthodoxLengthPenalty =
      invalidBehindKeeperAttempt ||
      (isBehindWicketShot && isShortBall && !isPerfectTiming && !isGoodTiming && assist !== 'full');

    if (isCompleteMiss || yorkerBlindLoftMiss || lateralError > assistTolerance) {
      this.lastLaunchAngleDeg = 0;
      const missLabelEn = yorkerBlindLoftMiss
        ? 'YORKED · MISSED UNDER THE BAT!'
        : swungWayTooEarly
          ? 'SWUNG TOO EARLY · BEATEN!'
          : timingGapMs > win.mistime
            ? 'TOO LATE · BEATEN FOR PACE!'
            : 'PLAY & MISS · BEATEN!';
      const missLabelHi = yorkerBlindLoftMiss
        ? 'यॉर्कर पर चूक · बल्ले के नीचे से निकली!'
        : swungWayTooEarly
          ? 'बहुत जल्दी स्विंग · गेंद से चूके!'
          : 'बल्ला चूका · बेहतरीन गेंद!';
      this.lastContact = {
        timingLabelEn: missLabelEn,
        timingLabelHi: missLabelHi,
        timingOffsetMs: timingGapMs,
        timingQuality: 0,
        batSpeedDeg: Math.round(this.peakSwingSpeedDeg),
        exitSpeedKmh: 0,
        launchAngleDeg: 0,
        shotDirectionDeg: this.swingDirectionDeg,
        shotMode: this.shotMode,
        swingPlaneLabel: this.isRisingSwing
          ? `RISING (+${Math.round(this.swingPlanePitchDeg)}°)`
          : `FLAT (${Math.round(this.swingPlanePitchDeg)}°)`,
        contactType: yorkerBlindLoftMiss ? 'Missed Yorker' : swungWayTooEarly ? 'Early Swing Miss' : 'Missed',
        shotKey: this.activeShotType.shotKey,
        shotAnim: this.activeShotType.anim,
        shotNameEn: this.activeShotType.nameEn,
        shotNameHi: this.activeShotType.nameHi,
        didHit: false,
        outcome: 'miss'
      };
      if (hooks.onSwingMiss) hooks.onSwingMiss(this.lastContact);
      return this.lastContact;
    }

    let timingQuality = 1.0;
    let timingLabelEn = 'PERFECT';
    let timingLabelHi = 'परफेक्ट!';
    let contactType = 'Sweet Spot';

    if (isPerfectTiming) {
      timingQuality = lateralError > 0.34 ? 0.94 : 1.0;
      timingLabelEn = onFireActive ? '🔥 ON FIRE · PERFECT!' : 'PERFECT TIMING';
      timingLabelHi = onFireActive ? '🔥 ऑन फायर · परफेक्ट!' : 'सटीक टाइमिंग!';
      contactType = lateralError > 0.34 ? 'Outer Sweet Spot' : 'Sweet Spot';
    } else if (isGoodTiming) {
      timingQuality = lateralError > 0.32 ? 0.82 : 0.89;
      timingLabelEn = timingGapMs < 0 ? 'GOOD (EARLY)' : 'GOOD (LATE)';
      timingLabelHi = timingGapMs < 0 ? 'अच्छा (थोड़ा जल्दी)' : 'अच्छा (थोड़ा देर)';
      contactType = lateralError > 0.32 ? 'Outer Sweet Spot' : 'Sweet Spot';
    } else {
      timingQuality = 0.56;
      timingLabelEn = timingGapMs < 0 ? 'MISTIMED (EARLY)' : 'MISTIMED (LATE)';
      timingLabelHi = timingGapMs < 0 ? 'मिसटाइम (जल्दी)' : 'मिसटाइम (देर)';
    }

    // 4. Point 6: Compute 360° Direction with Realistic Early/Late Timing Offset:
    // - Perfect timing = exact wheel angle (0° shift)
    // - Good timing = slight 0°–5° drift so ball still goes accurately where aimed
    // - Mistimed Early (<0) = shifts toward Leg side by 15°–28°
    // - Mistimed Late (>0) = shifts toward Off side by 15°–28°
    const normBatSpeed = THREE.MathUtils.clamp(this.peakSwingSpeedDeg / 465, 0.30, 1.22);
    let timingYawBias = 0;
    if (!isPerfectTiming && this.activeShotType.id !== 'defence') {
      const sideSign = timingGapMs < 0 ? -handSign : handSign;
      if (isGoodTiming) {
        const goodNorm = THREE.MathUtils.clamp((absGapMs - win.perfect) / Math.max(20, win.good - win.perfect), 0, 1);
        const subtleShiftDeg = THREE.MathUtils.lerp(0, 5, goodNorm);
        timingYawBias = sideSign * THREE.MathUtils.degToRad(subtleShiftDeg);
      } else {
        const errSpan = Math.max(30, win.mistime - win.good);
        const errNorm = THREE.MathUtils.clamp((absGapMs - win.good) / errSpan, 0, 1);
        const shiftDeg = THREE.MathUtils.lerp(14, 28, errNorm);
        timingYawBias = sideSign * THREE.MathUtils.degToRad(shiftDeg);
      }
    }

    let finalYaw = Math.atan2(
      Math.sin(this.swingPlaneYaw + timingYawBias),
      Math.cos(this.swingPlaneYaw + timingYawBias)
    );

    // Pivot batsman body toward the 360° shot direction
    this.bodyPivotYaw = THREE.MathUtils.clamp(finalYaw * 0.54, -1.15, 1.15);

    // Realistic physics: factor incoming ball pace (145 km/h fast ball vs 75 km/h spin) into batted exit speed!
    const incomingBallSpeedMs = THREE.MathUtils.clamp(ball.vel.length(), 14.0, 42.0);
    const paceBonusMs = (incomingBallSpeedMs - 24.0) * 0.19;

    let launchAngleDeg = 0;
    let launchSpeedMs = (14.2 + normBatSpeed * 26.8 + paceBonusMs) * surgePowerBoost;

    ball.state = 'hit';
    ball.bouncedAfterHit = false;
    ball.edged = false;
    ball.edgeType = 'none';
    // Preserve chest/waist contact height on short-ball Pull / Hook / Cut / Upper-Cut so shots launch authentically off the bounce!
    const isCrossBatShortStroke = isShortBall && absAngleDeg >= 30;
    const minContactHeight = isCrossBatShortStroke ? 0.82 : this.shotMode === 'fly' ? 0.54 : 0.24;
    ball.pos.y = Math.max(ball.pos.y, minContactHeight);

    // Signed lateral offset from bat sweet spot:
    // For RHB (handSign = +1): signedOffsetX > 0 is toward the OUTSIDE edge (off side), < 0 is toward INSIDE edge (leg side)
    const signedOffsetX = (ball.pos.x - batSweetSpotX) * handSign;

    // Deceptive Slower Ball / Off-Cutter early-swing detection (classic caught-and-bowled / cover chip trap!)
    const isSlowerVariation =
      ball.variationId === 'slower_ball' ||
      ball.variationId === 'off_cutter' ||
      ball.variationId === 'leg_cutter' ||
      ball.variationId === 'knuckleball' ||
      ball.variationId === 'slower_bouncer' ||
      isSpinOrSlow;
    const earlyLeadingEdgeTrap =
      !isDefenceShot &&
      !isPerfectTiming &&
      !isGoodTiming &&
      timingGapMs < -(win.good * 0.92) &&
      (isSlowerVariation || Math.random() < (assist === 'off' ? 0.55 : 0.35));

    if (isDefenceShot) {
      // ==================== DEFEND MODE (Safe Soft-Hands Block on Tough Balls) ====================
      launchAngleDeg = 1.6;
      launchSpeedMs = 4.5 + normBatSpeed * 2.8;
      contactType = 'Solid Defensive Block';
      timingLabelEn = isPerfectTiming ? 'SOLID DEFENCE' : 'DEFENSIVE BLOCK';
      timingLabelHi = 'मज़बूत डिफेंस!';
      // Even defence can nick a ripping late-mover on Hard if badly mistimed off-line
      if (!isPerfectTiming && !isGoodTiming && lateralError > (assist === 'off' ? 0.34 : 0.44)) {
        ball.edged = true;
        ball.edgeType = 'thin_edge';
        contactType = 'Soft Edge (Defence)';
        timingLabelEn = 'OUTSIDE EDGE · DEFENDING!';
        timingLabelHi = 'डिफेंस में बाहरी किनारा!';
        launchAngleDeg = THREE.MathUtils.randFloat(6.5, 11.5);
        launchSpeedMs = Math.max(12.5, incomingBallSpeedMs * 0.55);
        finalYaw = handSign * THREE.MathUtils.randFloat(2.72, 2.98);
      }
    } else if (this.shotMode === 'ground') {
      // ==================== GROUND MODE (0° - 8° Carpet Drives & Real Edge Risk) ====================
      const flatFactor = THREE.MathUtils.clamp(this.swingPlanePitchDeg / 20, 0, 1);
      launchAngleDeg = THREE.MathUtils.lerp(1.8, 7.0, flatFactor);
      launchSpeedMs *= timingQuality;

      if (isYorker) {
        // Digging out a Yorker on the ground is the smart cricket play (safe, lower exit pace unless perfect)
        launchSpeedMs *= isPerfectTiming ? 0.96 : 0.78;
      } else if (isShortBall && absAngleDeg >= 30 && (isPerfectTiming || isGoodTiming)) {
        // Rolled-wrist Pull / Cut / Hook hammers downward into turf and races to the rope!
        launchSpeedMs *= isPerfectTiming ? 1.15 : 1.07;
        launchAngleDeg = THREE.MathUtils.clamp(launchAngleDeg + 1.8, 3.0, 8.8);
      } else if (isShortBall && absAngleDeg < 26 && !isPerfectTiming && assist !== 'full') {
        // Cramped front-foot push at a rising bouncer loses pace and risks a fend/splice
        launchSpeedMs *= 0.76;
      } else if ((isGoodLength || isFullBall) && !isBehindWicketShot && (isPerfectTiming || isGoodTiming)) {
        launchSpeedMs *= isPerfectTiming ? 1.13 : 1.05;
      }

      const edgeThreshold = (assist === 'full' ? 0.48 : assist === 'light' ? 0.34 : 0.24) * surgeSweetBoost;
      const mistimeEdgeProb = assist === 'full' ? 0.46 : assist === 'light' ? 0.68 : 0.80;
      const goodOffLineEdge =
        isGoodTiming &&
        assist !== 'full' &&
        lateralError > edgeThreshold + 0.06 &&
        Math.random() < (assist === 'off' ? 0.48 : 0.28);

      const isGroundEdge =
        earlyLeadingEdgeTrap ||
        goodOffLineEdge ||
        (!isPerfectTiming && !isGoodTiming && Math.random() < mistimeEdgeProb) ||
        (!isPerfectTiming && !isGoodTiming && lateralError > edgeThreshold) ||
        unorthodoxLengthPenalty;

      if (isGroundEdge) {
        ball.edged = true;
        const isInsideHalf = signedOffsetX < -0.03 || (timingGapMs < -90 && signedOffsetX < 0.07);
        if (earlyLeadingEdgeTrap && !isInsideHalf) {
          // Swung early on a slower ball / spinner => Leading Edge pop-up toward bowler / covers!
          ball.edgeType = 'leading_edge';
          contactType = 'Leading Edge (Early Swing)';
          timingLabelEn = 'LEADING EDGE · POPPED UP!';
          timingLabelHi = 'लीडिंग एज · हवा में आसान कैच!';
          launchAngleDeg = THREE.MathUtils.randFloat(34, 48);
          launchSpeedMs = THREE.MathUtils.randFloat(12.2, 16.8);
          finalYaw = handSign * THREE.MathUtils.randFloat(0.18, 0.78);
        } else if (isInsideHalf && Math.abs(ball.pos.x) < 0.28 && Math.random() < (assist === 'off' ? 0.44 : 0.34)) {
          ball.edgeType = 'played_on';
          contactType = 'Played-On (Inside Edge)';
          timingLabelEn = 'INSIDE EDGE · PLAYED ON!';
          timingLabelHi = 'अंदरूनी किनारा · बोल्ड!';
          launchAngleDeg = 2.0;
          launchSpeedMs = 9.5;
          finalYaw = Math.PI;
          ball.isPlayedOn = true;
          ball.pos.set(0, 0.36, CREASE_Z + 0.35);
          ball.vel.set(0, 0.22, 13.5);
        } else if (isInsideHalf) {
          ball.edgeType = 'inside_edge';
          contactType = 'Inside Edge (Past Leg Stump)';
          timingLabelEn = 'INSIDE EDGE (PAST STUMPS)';
          timingLabelHi = 'अंदरूनी किनारा (स्टंप के पास से)';
          launchAngleDeg = THREE.MathUtils.randFloat(2.0, 5.5);
          launchSpeedMs = Math.max(11.5, incomingBallSpeedMs * THREE.MathUtils.randFloat(0.52, 0.68));
          finalYaw = -handSign * THREE.MathUtils.randFloat(2.25, 2.72);
        } else if (lateralError <= edgeThreshold + 0.14) {
          // Thin Outside Edge -> Fine nick carrying at catchable height (0.48m..1.35m) to Wicketkeeper or First Slip!
          ball.edgeType = 'thin_edge';
          contactType = 'Thin Outside Edge';
          timingLabelEn = 'THIN OUTSIDE EDGE!';
          timingLabelHi = 'बारीक बाहरी किनारा!';
          launchAngleDeg = THREE.MathUtils.randFloat(8.5, 14.2);
          launchSpeedMs = Math.max(14.8, incomingBallSpeedMs * THREE.MathUtils.randFloat(0.62, 0.76));
          finalYaw = handSign * THREE.MathUtils.randFloat(2.74, 2.98);
        } else {
          // Thick Outside Edge -> Flies wider toward Second Slip / Gully / Third Man!
          ball.edgeType = 'thick_edge';
          contactType = 'Thick Outside Edge';
          timingLabelEn = 'THICK OUTSIDE EDGE!';
          timingLabelHi = 'मोटा बाहरी किनारा!';
          launchAngleDeg = THREE.MathUtils.randFloat(7.5, 16.5);
          launchSpeedMs = Math.max(15.5, incomingBallSpeedMs * THREE.MathUtils.randFloat(0.66, 0.82));
          finalYaw = handSign * THREE.MathUtils.randFloat(2.22, 2.64);
        }
      }
    } else {
      // ==================== FLY MODE (High Risk / High Reward Lofted Shots + Length IQ) ====================
      // - Full balls: reward sweet-spot drives & lofted sixes (+6% power).
      // - Good-length balls: demand crisp timing; mistimes hang in the air!
      // - Short balls / Bouncers: Pull/Hook/Cut/Upper-Cut thrive (1.10x), while straight front-foot lofts risk a Top-Edge skyer!
      // - Yorkers: Straight blind loft is jammed (0.68x) unless timed to perfection (Helicopter) or Scooped behind wicket!
      let lengthPowerMod = 1.0;
      let lengthAngleBias = 0;
      let lengthMismatchEdge = false;

      if (isYorker) {
        if (isBehindWicketShot) {
          lengthPowerMod = isPerfectTiming ? 1.04 : 0.84;
          lengthAngleBias = 4.0;
          if (!isPerfectTiming && assist !== 'full') lengthMismatchEdge = true;
        } else {
          // Toe-crushing Yorker: only PERFECT timing digs out a Helicopter loft; Good timing gets jammed for a catchable lob!
          lengthPowerMod = isPerfectTiming ? 0.90 : 0.66;
          lengthAngleBias = isPerfectTiming ? -2.0 : 8.5;
          if (!isPerfectTiming && assist !== 'full') lengthMismatchEdge = true;
        }
      } else if (isFullBall) {
        lengthPowerMod = isBehindWicketShot ? 1.06 : 1.06;
        lengthAngleBias = 1.5;
      } else if (isShortBall) {
        const isPullHookOrCut = absAngleDeg >= 30;
        if (isPullHookOrCut) {
          // Short-ball Pull, Hook & Upper-Cut ride the pace & bounce for crisp sixes over square leg / third man!
          lengthPowerMod = absAngleDeg >= 90 ? 1.11 : 1.07;
          lengthAngleBias = this.activeShotType.id === 'uppercut' ? 4.5 : 1.5;
        } else {
          // Straight front-foot loft against a rising Bouncer => splices off the shoulder of the bat unless perfect!
          lengthPowerMod = 0.78;
          lengthAngleBias = 11.0;
          if (!isPerfectTiming && assist !== 'full') lengthMismatchEdge = true;
        }
      } else if (isGoodLength) {
        lengthPowerMod = this.footwork === 'front' ? 1.01 : 0.99;
        lengthAngleBias = 1.4;
      }

      // Off-center contact scaling: punishes wide reaching swings more authentically on Medium/Hard
      const sweetCenterMod = THREE.MathUtils.clamp(1.0 - Math.max(0, lateralError - 0.12) * 0.44, 0.76, 1.0);
      const flyOuterEdgeRisk = lateralError > (assist === 'full' ? 0.44 : assist === 'light' ? 0.30 : 0.22) * surgeSweetBoost;

      if (isPerfectTiming && !flyOuterEdgeRisk && !unorthodoxLengthPenalty && !lengthMismatchEdge) {
        // PERFECT TIMING IN FLY MODE => Clean high trajectory calibrated to clear the 52m boundary (60.8m from striker crease)!
        const riseNorm = THREE.MathUtils.clamp((this.swingPlanePitchDeg - 10) / 35, 0, 1);
        launchAngleDeg = THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(28.5, 36.5, riseNorm) + lengthAngleBias,
          25,
          40
        );
        launchSpeedMs =
          (16.8 + normBatSpeed * 17.5 + paceBonusMs * 0.60) *
          timingQuality *
          lengthPowerMod *
          sweetCenterMod *
          surgePowerBoost;
      } else if (isGoodTiming && !flyOuterEdgeRisk && !unorthodoxLengthPenalty && !lengthMismatchEdge) {
        // GOOD TIMING IN FLY MODE => Strong lofted hit, but must find the gap or carry deep (boundary riders can catch!)
        launchAngleDeg = THREE.MathUtils.clamp(
          THREE.MathUtils.randFloat(26.5, 36.5) + lengthAngleBias * 0.7,
          23,
          42
        );
        launchSpeedMs =
          (13.8 + normBatSpeed * 14.8 + paceBonusMs * 0.48) *
          timingQuality *
          lengthPowerMod *
          sweetCenterMod *
          surgePowerBoost;
      } else {
        // MISTIMED / LENGTH-MISMATCH / EARLY SLOWER-BALL / WIDE OUTER EDGE IN FLY MODE => Catchable Skyer, Leading Edge, or Slip Slash!
        ball.edged = true;
        if (earlyLeadingEdgeTrap) {
          ball.edgeType = 'leading_edge';
          contactType = 'Leading Edge (Early Swing)';
          timingLabelEn = 'EARLY SWING · LEADING EDGE!';
          timingLabelHi = 'जल्दी स्विंग · हवा में आसान कैच!';
          launchAngleDeg = THREE.MathUtils.randFloat(38, 52);
          launchSpeedMs = THREE.MathUtils.randFloat(12.8, 17.8);
          finalYaw = handSign * THREE.MathUtils.randFloat(0.15, 0.85);
        } else if (flyOuterEdgeRisk && signedOffsetX >= 0) {
          ball.edgeType = 'thick_edge';
          contactType = 'Thick Outside Edge (Slash)';
          timingLabelEn = 'OUTSIDE EDGE · SLASHED IN THE AIR!';
          timingLabelHi = 'बाहरी किनारा · स्लिप/गली की तरफ हवा में!';
          launchAngleDeg = THREE.MathUtils.randFloat(16, 28);
          launchSpeedMs = THREE.MathUtils.randFloat(16.0, 21.5);
          finalYaw = handSign * THREE.MathUtils.randFloat(2.10, 2.65);
        } else if (isYorker && lengthMismatchEdge) {
          ball.edgeType = 'top_edge';
          contactType = 'Jammed Yorker Lob';
          timingLabelEn = 'JAMMED YORKER · LOOPED UP!';
          timingLabelHi = 'यॉर्कर पर फंसा शॉट · कैच का खतरा!';
          launchAngleDeg = THREE.MathUtils.randFloat(32, 46);
          launchSpeedMs = THREE.MathUtils.randFloat(12.2, 16.5);
          finalYaw += (Math.random() - 0.5) * 0.25;
        } else {
          ball.edgeType = 'top_edge';
          contactType = isShortBall && lengthMismatchEdge ? 'Top Edge (Bouncer)' : 'Top Edge (Mistimed FLY)';
          timingLabelEn = isShortBall && lengthMismatchEdge ? 'BOUNCER TOP EDGE · SKIED!' : 'TOP EDGE · IN THE AIR!';
          timingLabelHi = isShortBall && lengthMismatchEdge ? 'बाउंसर पर टॉप एज · हवा में!' : 'टॉप एज · हवा में कैच का खतरा!';
          launchAngleDeg = THREE.MathUtils.randFloat(46, 60);
          launchSpeedMs = THREE.MathUtils.randFloat(13.2, 18.8);
          finalYaw += (Math.random() - 0.5) * 0.35;
        }
      }
    }

    // Compute 3D velocity vector across full 360° from launchAngleDeg and finalYaw:
    // finalYaw = 0 => vz < 0 (straight down ground over bowler)
    // finalYaw = +PI/2 => vx > 0 (right / off side)
    // finalYaw = -PI/2 => vx < 0 (left / leg side)
    // finalYaw = +/-PI => vz > 0 (behind wicket over keeper/slips!)
    if (contactType !== 'Played-On (Inside Edge)') {
      const loftRad = THREE.MathUtils.degToRad(launchAngleDeg);
      const horizSpeed = launchSpeedMs * Math.cos(loftRad);
      const vy = launchSpeedMs * Math.sin(loftRad);
      const vx = Math.sin(finalYaw) * horizSpeed;
      const vz = -Math.cos(finalYaw) * horizSpeed;

      ball.vel.set(vx, vy, vz);
    }

    ball.aerialAfterHit = launchAngleDeg > 10.0;
    ball.shotAngleRad = finalYaw;
    ball.shotPower = normBatSpeed * timingQuality;
    this.lastLaunchAngleDeg = Math.round(launchAngleDeg * 10) / 10;
    this.swingDirectionDeg = Math.round(THREE.MathUtils.radToDeg(finalYaw));

    this.lastContact = {
      timingLabelEn,
      timingLabelHi,
      timingOffsetMs: timingGapMs,
      timingQuality,
      batSpeedDeg: Math.round(this.peakSwingSpeedDeg),
      exitSpeedKmh: Math.round(launchSpeedMs * 3.6),
      launchAngleDeg: this.lastLaunchAngleDeg,
      shotDirectionDeg: this.swingDirectionDeg,
      shotMode: this.shotMode,
      swingPlaneLabel: this.isRisingSwing
        ? `RISING (+${Math.round(this.swingPlanePitchDeg)}°)`
        : `FLAT (${Math.round(this.swingPlanePitchDeg)}°)`,
      contactType,
      shotKey: this.activeShotType.shotKey,
      shotAnim: this.activeShotType.anim,
      shotNameEn: this.activeShotType.nameEn,
      shotNameHi: this.activeShotType.nameHi,
      didHit: true,
      outcome: ball.edged ? 'edge' : 'hit'
    };

    if (hooks.onBallHit) hooks.onBallHit(this.lastContact, ball.edged);
    return this.lastContact;
  }

  /**
   * AI Batsman decision logic when human player is bowling (uses 360° shot repertoire)
   */
  updateAIBatsman(ball, difficulty = 'pro', hooks = {}) {
    if (ball.state !== 'bowled' || this.shotExecutedThisBall) return;

    const skillMap = {
      rookie: { trackSpeed: 0.05, timingJitterMs: 75, powerMin: 320, powerMax: 450, flyChance: 0.25 },
      easy: { trackSpeed: 0.05, timingJitterMs: 75, powerMin: 320, powerMax: 450, flyChance: 0.25 },
      medium: { trackSpeed: 0.10, timingJitterMs: 42, powerMin: 380, powerMax: 510, flyChance: 0.35 },
      pro: { trackSpeed: 0.10, timingJitterMs: 42, powerMin: 380, powerMax: 510, flyChance: 0.35 },
      hard: { trackSpeed: 0.16, timingJitterMs: 22, powerMin: 430, powerMax: 560, flyChance: 0.45 },
      legend: { trackSpeed: 0.16, timingJitterMs: 22, powerMin: 430, powerMax: 560, flyChance: 0.45 }
    };
    const skill = skillMap[difficulty] || skillMap.pro;

    this.creaseX = THREE.MathUtils.lerp(this.creaseX, THREE.MathUtils.clamp(ball.pos.x, -0.42, 0.42), skill.trackSpeed);
    this.manualCreaseOffsetX = this.creaseX;

    if (ball.pos.z >= CREASE_Z - 1.55) {
      const jitterSec = ((Math.random() - 0.5) * 2 * skill.timingJitterMs) / 1000;
      const nowSec = performance.now() * 0.001;
      this.swingPeakTime = ((ball.idealContactTime || nowSec) - 0.085) + jitterSec;
      this.peakSwingSpeedDeg = THREE.MathUtils.randFloat(skill.powerMin, skill.powerMax);

      const isGoodForFly = !ball.bouncedOnPitch || ball.pitchBouncePos.z >= 4.8;
      this.shotMode = isGoodForFly || Math.random() < skill.flyChance ? 'fly' : 'ground';
      this.swingPlanePitchDeg = this.shotMode === 'fly' ? 28 : 4;
      this.isRisingSwing = this.shotMode === 'fly';

      let baseYaw = ball.pos.x > 0.08
        ? THREE.MathUtils.randFloat(0.25, 1.35)
        : ball.pos.x < -0.08
          ? THREE.MathUtils.randFloat(-1.35, -0.25)
          : THREE.MathUtils.randFloat(-0.55, 0.55);

      if (difficulty === 'legend' && Math.random() < 0.18) {
        // Legend AI occasionally plays 360° ramp/scoop behind the wicket
        baseYaw = (Math.random() < 0.5 ? 1 : -1) * THREE.MathUtils.randFloat(2.3, 3.0);
      }

      this.swingPlaneYaw = baseYaw;
      this.swingDirectionDeg = Math.round(THREE.MathUtils.radToDeg(baseYaw));
      this.activeShotType = this.classifyShot(this.swingPlaneYaw, this.isRisingSwing, this.peakSwingSpeedDeg);
      this.backliftAngle = -0.68;
      this.evaluateContact(ball, difficulty, hooks);
    }
  }

  /**
   * Updates keyboard 360° aim vector and step-cadence decay every frame
   */
  updateFrame(dt) {
    const nowSec = performance.now() * 0.001;
    const moveSpeed = 1.6 * dt;
    const dirSign = this.screenRightSign || 1;
    if (this.keys.left) {
      this.manualCreaseOverrideThisBall = true;
      this.manualCreaseOffsetX = THREE.MathUtils.clamp(
        this.manualCreaseOffsetX - moveSpeed * 0.55 * dirSign,
        -0.62,
        0.62
      );
    } else if (this.keys.right) {
      this.manualCreaseOverrideThisBall = true;
      this.manualCreaseOffsetX = THREE.MathUtils.clamp(
        this.manualCreaseOffsetX + moveSpeed * 0.55 * dirSign,
        -0.62,
        0.62
      );
    }
    // Smoothly interpolate creaseX toward manualCreaseOffsetX every frame for butter-smooth touch & keyboard movement
    if (typeof this.manualCreaseOffsetX === 'number') {
      const targetX = THREE.MathUtils.clamp(
        this.manualCreaseOffsetX + (this.sensorCreaseOffsetX || 0),
        -0.62,
        0.62
      );
      this.creaseX = THREE.MathUtils.damp(this.creaseX, targetX, 32, dt);
    }

    // Keep swingPlaneYaw synced to Angle Wheel when not actively swinging and not in post-swing aim lock
    if (
      !this.isSwinging &&
      nowSec > (this.manualSwingAimLockUntil || 0) &&
      typeof this.custom360AimDeg === 'number' &&
      (!this.hasHardwareStance || this.wheelAimLockedThisBall)
    ) {
      const targetYaw = THREE.MathUtils.degToRad(this.custom360AimDeg * dirSign);
      this.swingPlaneYaw = Math.atan2(Math.sin(targetYaw), Math.cos(targetYaw));
      this.swingDirectionDeg = Math.round(THREE.MathUtils.radToDeg(this.swingPlaneYaw));
    }

    if (this.keys.up) {
      this.aimDirectionZ = Math.min(1, this.aimDirectionZ + moveSpeed * 2.2);
      this.creaseZOffset = Math.min(0.52, this.creaseZOffset + moveSpeed);
      this.footwork = 'front';
    } else if (this.keys.down) {
      this.aimDirectionZ = Math.max(-1, this.aimDirectionZ - moveSpeed * 2.2);
      this.creaseZOffset = Math.max(-0.46, this.creaseZOffset - moveSpeed);
      this.footwork = 'back';
    } else {
      // Solution 2: Automatically sync footwork with 360° Angle Wheel hemisphere when W/S keys are not held
      this.footwork = this.computeSmartFootwork(this.swingPlaneYaw, null);
      const targetZOff = this.stepOutCharge ? 0.42 : this.footwork === 'front' ? 0.16 : -0.16;
      this.creaseZOffset = THREE.MathUtils.damp(this.creaseZOffset, targetZOff, 8, dt);
      if (!this.virtualStickActive) {
        this.aimDirectionZ = THREE.MathUtils.damp(this.aimDirectionZ, 1.0, 3.5, dt);
      }
    }

    // Step cadence update & keyboard/button hold-to-run fallback during Run Window
    if (this.runWindowActive) {
      if (this.holdRunActive) {
        // Hold R / Hold Run button simulates steady 4.6 steps/sec sprinting cadence
        const simCadence = 4.6;
        this.cadenceSps = simCadence;
        this.lastStepTime = nowSec;
        this.holdStepAccum += simCadence * dt;
        while (this.holdStepAccum >= 1.0) {
          this.holdStepAccum -= 1.0;
          this.accumulatedStepsThisRun += 1;
          this.totalStepsThisBall += 1;
        }
      } else {
        // Prune step timestamps older than 1.2s; if no step for >0.40s, cadence drops to 0!
        while (this.stepTimestamps.length > 0 && nowSec - this.stepTimestamps[0] > 1.2) {
          this.stepTimestamps.shift();
        }
        if (nowSec - this.lastStepTime > 0.40) {
          this.cadenceSps = 0;
        }
      }
    }

    if (!this.isSwinging && !this.shotExecutedThisBall) {
      this.backliftAngle = THREE.MathUtils.damp(this.backliftAngle, 0.25, 8, dt);
      const aimPivotTarget = THREE.MathUtils.clamp((this.swingPlaneYaw || 0) * 0.22, -0.45, 0.45);
      this.bodyPivotYaw = THREE.MathUtils.damp(this.bodyPivotYaw, aimPivotTarget, 7, dt);
    } else if (!this.isSwinging && nowSec - this.lastSwingTime > 0.65) {
      this.backliftAngle = THREE.MathUtils.damp(this.backliftAngle, 0.25, 8, dt);
      this.bodyPivotYaw = THREE.MathUtils.damp(this.bodyPivotYaw, 0, 5, dt);
    }
  }
}
