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
const _qPredDelta = new THREE.Quaternion();
const _qPredicted = new THREE.Quaternion();
const _deviceEuler = new THREE.Euler(0, 0, 0, 'ZXY');
const _relEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _omegaAxis = new THREE.Vector3();
const _localVelVec = new THREE.Vector3();

export const SHOT_TYPES = {
  STRAIGHT_DRIVE: { id: 'straight', shotKey: 'straight_drive', anim: 'drive', nameEn: 'STRAIGHT DRIVE', nameHi: 'स्ट्रेट ड्राइव' },
  COVER_DRIVE: { id: 'cover', shotKey: 'cover_drive', anim: 'drive', nameEn: 'COVER DRIVE', nameHi: 'कवर ड्राइव' },
  ON_DRIVE: { id: 'ondrive', shotKey: 'on_drive', anim: 'drive', nameEn: 'ON DRIVE', nameHi: 'ऑन ड्राइव' },
  LEG_FLICK: { id: 'flick', shotKey: 'leg_flick', anim: 'pull', nameEn: 'MID-WICKET FLICK', nameHi: 'मिड-विकेट फ्लिक' },
  SQUARE_CUT: { id: 'cut', shotKey: 'square_cut', anim: 'cut', nameEn: 'SQUARE CUT', nameHi: 'स्क्वायर कट' },
  PULL_SHOT: { id: 'pull', shotKey: 'pull_shot', anim: 'pull', nameEn: 'PULL SHOT', nameHi: 'पुल शॉट' },
  SWEEP_SHOT: { id: 'sweep', shotKey: 'sweep_shot', anim: 'sweep', nameEn: 'SWEEP SHOT', nameHi: 'स्वीप शॉट' },
  LATE_CUT: { id: 'latecut', shotKey: 'late_cut', anim: 'cut', nameEn: 'LATE CUT', nameHi: 'लेट कट' },
  REVERSE_SWEEP: { id: 'reversesweep', shotKey: 'reverse_sweep', anim: 'sweep', nameEn: 'REVERSE SWEEP', nameHi: 'रिवर्स स्वीप' },
  FINE_GLANCE: { id: 'fineglance', shotKey: 'fine_glance', anim: 'pull', nameEn: 'FINE LEG GLANCE', nameHi: 'फाइन लेग ग्लांस' },
  SCOOP_SHOT: { id: 'scoop', shotKey: 'scoop_shot', anim: 'scoop', nameEn: 'SCOOP SHOT', nameHi: 'स्कूप शॉट' },
  RAMP_SHOT: { id: 'ramp', shotKey: 'ramp_shot', anim: 'ramp', nameEn: 'RAMP SHOT', nameHi: 'रैम्प शॉट' },
  LOFTED_DRIVE: { id: 'loft', shotKey: 'lofted_six', anim: 'loft', nameEn: 'LOFTED DRIVE', nameHi: 'लॉफ्टेड शॉट' },
  DEFENCE: { id: 'defence', shotKey: 'defence', anim: 'defence', nameEn: 'SOLID DEFENCE', nameHi: 'डिफेंस' }
};

export const TIMING_WINDOWS_MS = {
  easy: { perfect: 120, good: 210, mistime: 310 },
  pro: { perfect: 80, good: 165, mistime: 260 },
  legend: { perfect: 55, good: 125, mistime: 215 }
};

export const STEPS_PER_RUN = 20;

export class BattingSystem {
  constructor() {
    // Pre-selected Shot Mode ('ground' | 'fly')
    this.shotMode = 'ground'; // Default GROUND
    this.modeLocked = false;  // Locks at bowler's release moment
    this.handedness = 'right'; // 'right' | 'left' (mirrors off/leg shot classification)

    // Stance & Crease position
    this.screenRightSign = -1; // -1 in Broadcast camera (looking +Z, so Screen-Right is -X); +1 in Pro/Overhead camera
    this.creaseX = 0.0;       // Lateral guard (-0.52m to +0.52m)
    this.creaseZOffset = 0.0; // Forward (+0.55m) or Back (-0.45m)
    this.footwork = 'neutral';
    this.bodyPivotYaw = 0.0;  // Visual pivot of batsman feet & shoulders toward 360° shot direction

    // Calibration State
    this.isCalibrating = false;
    this.calibProgress = 0;
    this.isCalibrated = false;
    this.hasAutoStance = false;
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
    this.lastFlickTime = 0;
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

    // Keyboard & Touch 360° Direction State
    this.keys = {
      left: false,
      right: false,
      up: false,
      down: false
    };
    this.aimDirectionX = 0;
    this.aimDirectionZ = 1; // +1 = forward (0°), -1 = behind wicket (180°)

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

  setHandedness(hand = 'right') {
    this.handedness = hand === 'left' ? 'left' : 'right';
  }

  setShotMode(mode, force = false) {
    if (this.modeLocked && !force) return false;
    if (mode === 'ground' || mode === 'fly') {
      this.shotMode = mode;
      return true;
    }
    return false;
  }

  lockShotMode() {
    this.modeLocked = true;
  }

  unlockShotMode() {
    this.modeLocked = false;
  }

  resetForNextBall() {
    this.isSwinging = false;
    this.peakSwingSpeedDeg = 0;
    this.shotExecutedThisBall = false;
    this.modeLocked = false;
    this.backliftAngle = 0.25;
    this.bodyPivotYaw = 0;
    this.creaseZOffset = 0;
    this.footwork = 'neutral';
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

  buildDeviceQuaternion(alphaDeg, betaDeg, gammaDeg) {
    const a = THREE.MathUtils.degToRad(alphaDeg || 0);
    const b = THREE.MathUtils.degToRad(betaDeg || 0);
    const g = THREE.MathUtils.degToRad(gammaDeg || 0);
    _deviceEuler.set(b, a, -g, 'YXZ');
    _qCurrent.setFromEuler(_deviceEuler);
    return _qCurrent;
  }

  /**
   * Computes full 360° horizontal swing direction in [-PI, +PI] (0 = straight down ground over bowler)
   * from the swing velocity vector projected on the ground plane in calibrated stance space
   * (independent of raw compass yaw so compass drift never skews shots), plus a small bat-face correction.
   */
  compute360SwingDirection() {
    const dirSign = this.screenRightSign || -1;
    // Project angular & linear swing velocity into calibrated stance horizontal plane:
    // Forward component (+vz_fwd => 0° straight, -vz_fwd => 180° behind wicket)
    // Lateral component mapped by dirSign so swinging Right always goes Right on screen
    _localVelVec.set(
      (-this.filteredOmega.z * 0.65 - this.filteredOmega.y * 0.55 + this.filteredAccel.x * 18.0) * dirSign,
      0,
      this.filteredOmega.x * 0.72 - this.filteredAccel.z * 16.0
    );

    let angleRad = 0;
    if (Math.hypot(_localVelVec.x, _localVelVec.z) > 12.0) {
      angleRad = Math.atan2(_localVelVec.x, _localVelVec.z);
    }

    // Small bat-face angle correction (capped at +/-10° so compass drift cannot hijack direction)
    const faceCorrectionRad = THREE.MathUtils.degToRad(
      THREE.MathUtils.clamp((-this.calRollDeg * 0.22 - this.calYawDeg * 0.15) * dirSign, -10, 10)
    );
    angleRad = Math.atan2(
      Math.sin(angleRad + faceCorrectionRad),
      Math.cos(angleRad + faceCorrectionRad)
    );

    return angleRad;
  }

  /**
   * Maps any 360-degree angle (-PI to +PI) to authentic cricket shots & fielding zones,
   * automatically mirroring Off-Side and Leg-Side for Left-Handed batsmen.
   */
  classifyShot(yawRad, isLofted, speedDeg, isShortBall = false, isFullBall = false) {
    if (speedDeg < 165) return SHOT_TYPES.DEFENCE;

    // For a Right-Handed batter, +yawRad (right) is Off-Side, -yawRad (left) is Leg-Side.
    // For a Left-Handed batter, mirror the sign so +yawRad (right) is Leg-Side and -yawRad (left) is Off-Side!
    const handSign = this.handedness === 'left' ? -1 : 1;
    const tacticalDeg = THREE.MathUtils.radToDeg(yawRad) * handSign; // + = Off Side, - = Leg Side
    const absDeg = Math.abs(tacticalDeg);

    // 1. Straight Zone (~0° to 26°)
    if (absDeg <= 26) {
      return isLofted ? SHOT_TYPES.LOFTED_DRIVE : SHOT_TYPES.STRAIGHT_DRIVE;
    }

    // 2. Forward Off / Leg Drives & Flicks (~26° to 62°)
    if (absDeg <= 62) {
      if (tacticalDeg > 0) {
        return SHOT_TYPES.COVER_DRIVE;
      }
      return absDeg <= 44 ? SHOT_TYPES.ON_DRIVE : SHOT_TYPES.LEG_FLICK;
    }

    // 3. Square Off / Leg Cuts, Pulls & Sweeps (~62° to 120°)
    if (absDeg <= 120) {
      if (tacticalDeg > 0) {
        return SHOT_TYPES.SQUARE_CUT;
      }
      // Leg side 62°..120°: Sweep on fuller balls in ground mode, Pull on short/good or lofted
      if (isFullBall && !isLofted && absDeg >= 75) {
        return SHOT_TYPES.SWEEP_SHOT;
      }
      return isShortBall || isLofted ? SHOT_TYPES.PULL_SHOT : SHOT_TYPES.SWEEP_SHOT;
    }

    // 4. Behind the Wicket (~120° to 180°): Late Cut, Reverse Sweep, Fine Glance, Scoop, Ramp
    if (absDeg <= 154) {
      if (tacticalDeg > 0) {
        return isLofted ? SHOT_TYPES.REVERSE_SWEEP : SHOT_TYPES.LATE_CUT;
      }
      return SHOT_TYPES.FINE_GLANCE;
    }

    // 154° to 180° directly behind the keeper/slips
    return tacticalDeg >= 0 ? SHOT_TYPES.RAMP_SHOT : SHOT_TYPES.SCOOP_SHOT;
  }

  /**
   * Processes 60-100Hz phone sensor packets with:
   * - Proper q_current * inverse(q_stance) calibration
   * - 360° swing velocity projection
   * - High-pass accelerometer step detection during the Run Window (Requirement C.1 & C.6)
   */
  ingestSensorPacket(data, dt = 0.014, hooks = {}) {
    this.rawAlpha = Number(data.alpha) || 0;
    this.rawBeta = Number(data.beta) || 0;
    this.rawGamma = Number(data.gamma) || 0;

    this.buildDeviceQuaternion(this.rawAlpha, this.rawBeta, this.rawGamma);

    if (!this.hasAutoStance && !this.isCalibrating) {
      this.qStance.copy(_qCurrent);
      this.hasAutoStance = true;
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
          this.hasAutoStance = true;
          this.isCalibrating = false;
          this.isCalibrated = true;
          if (hooks.onCalibrationComplete) hooks.onCalibrationComplete();
        }
      } else {
        this.calibProgress = Math.max(0, this.calibProgress - dt * 0.35);
      }
      return;
    }

    // Apply calibration properly: q_rel = q_current * inverse(q_stance)
    _qStanceInv.copy(this.qStance).invert();
    _qRel.copy(_qCurrent).multiply(_qStanceInv).normalize();

    const predictionSec = 0.022;
    const omegaRadMag = THREE.MathUtils.degToRad(omegaMag);
    if (omegaRadMag > 0.05) {
      _omegaAxis
        .set(
          THREE.MathUtils.degToRad(this.filteredOmega.x),
          THREE.MathUtils.degToRad(this.filteredOmega.y),
          THREE.MathUtils.degToRad(-this.filteredOmega.z)
        )
        .normalize();
      _qPredDelta.setFromAxisAngle(_omegaAxis, omegaRadMag * predictionSec);
      _qPredicted.copy(_qPredDelta).multiply(_qRel).normalize();
    } else {
      _qPredicted.copy(_qRel);
    }

    this.currentQuat.slerp(_qPredicted, 0.85);
    _relEuler.setFromQuaternion(this.currentQuat, 'YXZ');

    this.calPitchDeg = THREE.MathUtils.radToDeg(_relEuler.x);
    this.calYawDeg = THREE.MathUtils.radToDeg(_relEuler.y);
    this.calRollDeg = THREE.MathUtils.radToDeg(_relEuler.z);

    const nowSec = performance.now() * 0.001;

    // ==================== PART C: REAL RUNNING STEP DETECTION ====================
    // Requirement C.6: Ignore batting swing motion while runWindowActive is true,
    // and ignore step detection while a bat swing or bowling swing is in progress.
    if (this.runWindowActive) {
      const accelMag = Math.hypot(ax, ay, az);
      this.gravityEst = THREE.MathUtils.lerp(this.gravityEst, accelMag, 0.14);
      this.highPassAccel = accelMag - this.gravityEst;

      // Also support explicit step packet or accelerometer peak > 1.55 m/s^2
      if (data.stepPeak || (this.highPassAccel > 1.55 && !this.stepAboveThreshold)) {
        this.stepAboveThreshold = true;
        if (this.registerStep(nowSec)) {
          if (hooks.onRunStep) hooks.onRunStep(this.cadenceSps, this.accumulatedStepsThisRun);
          if (hooks.onStepDetected) hooks.onStepDetected(0.16, this.cadenceSps);
        }
      } else if (this.highPassAccel < 0.65) {
        this.stepAboveThreshold = false;
      }
      return;
    }

    // Map calibrated orientation to 3D bat visual pose & crease footwork
    const dirSign = this.screenRightSign || -1;
    this.backliftAngle = THREE.MathUtils.clamp(_relEuler.x + 0.22, -0.95, 1.45);
    this.creaseZOffset = THREE.MathUtils.clamp(-_relEuler.x * 0.36, -0.42, 0.52);
    this.footwork = this.creaseZOffset > 0.16 ? 'front' : this.creaseZOffset < -0.14 ? 'back' : 'neutral';
    this.creaseX = THREE.MathUtils.clamp((-_relEuler.y * 0.38 - _relEuler.z * 0.28) * dirSign, -0.45, 0.45);

    // ==================== PART B: INSTANT 360-DEGREE SWING DETECTION ====================
    if (omegaMag > 105 && !this.isSwinging && nowSec - this.lastSwingTime > 0.16) {
      this.isSwinging = true;
      this.swingDispatched = false;
      this.swingStartTime = nowSec;
      this.swingStartPitchDeg = this.calPitchDeg;
      this.peakSwingSpeedDeg = Math.max(omegaMag, 340);
      this.swingPeakTime = nowSec;
    }

    if (this.isSwinging) {
      if (omegaMag >= this.peakSwingSpeedDeg * 0.85) {
        this.peakSwingSpeedDeg = Math.max(this.peakSwingSpeedDeg, omegaMag);
        this.swingPeakTime = nowSec;

        // Compute full 360-degree horizontal swing travel angle (-PI to +PI)
        this.swingPlaneYaw = this.compute360SwingDirection();
        this.swingDirectionDeg = Math.round(THREE.MathUtils.radToDeg(this.swingPlaneYaw));

        // Vertical swing plane: flat vs rising (low-to-high)
        const pitchRiseDeg = (this.calPitchDeg - this.swingStartPitchDeg) + Math.abs(this.filteredOmega.x) * 0.08;
        this.swingPlanePitchDeg = THREE.MathUtils.clamp(
          this.shotMode === 'fly' ? Math.max(24, pitchRiseDeg) : pitchRiseDeg,
          -20,
          55
        );
        this.isRisingSwing = this.shotMode === 'fly' || this.swingPlanePitchDeg > 10 || Math.abs(this.filteredOmega.x) > 120;

        this.activeShotType = this.classifyShot(
          this.swingPlaneYaw,
          this.shotMode === 'fly' && this.isRisingSwing,
          this.peakSwingSpeedDeg
        );

        // Fire instant swing callback as soon as swing reaches active threshold (zero arm-stop lag on TV/Phone!)
        if (!this.swingDispatched && omegaMag > 135 && hooks.onSwingPeak) {
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

      if (omegaMag < this.peakSwingSpeedDeg * 0.55 || nowSec - this.swingStartTime > 0.24) {
        this.isSwinging = false;
        this.lastSwingTime = nowSec;
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
    this.lastSwingTime = nowSec;
    this.swingPeakTime = nowSec;
    this.peakSwingSpeedDeg = isDefensive ? 150 : speedDeg;

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

    if (planePitchDeg !== null) {
      this.swingPlanePitchDeg = planePitchDeg;
    } else {
      this.swingPlanePitchDeg = this.shotMode === 'fly' ? 28 : 4;
    }
    this.isRisingSwing = this.swingPlanePitchDeg > 11;
    this.activeShotType = isDefensive
      ? SHOT_TYPES.DEFENCE
      : this.classifyShot(
          this.swingPlaneYaw,
          this.shotMode === 'fly' && this.isRisingSwing,
          this.peakSwingSpeedDeg
        );
    this.backliftAngle = -0.68;
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
    const swungWithinWindow = Math.abs(timeSinceSwing) < 0.56 || this.isSwinging;

    if (!swungWithinWindow) return null;
    // Wait until the ball enters the realistic 3D hitting zone in front of the bat before evaluating contact
    if (ball.pos.z < batZ - 1.35) return null;

    this.shotExecutedThisBall = true;

    // 1. Classify Ball Length
    const isFullToss = !ball.bouncedOnPitch;
    const bounceZ = ball.pitchBouncePos.z;
    const isYorker = ball.bouncedOnPitch && bounceZ >= 7.5;
    const isFullBall = isFullToss || (ball.bouncedOnPitch && bounceZ >= 5.2);
    const isShortBall = ball.bouncedOnPitch && bounceZ < 3.2;
    const isGoodLength = ball.bouncedOnPitch && bounceZ >= 3.2 && bounceZ < 7.5;

    const diffProfile = getDifficultyProfile(difficulty);
    const assist = diffProfile ? diffProfile.battingAssist : 'light';

    // Difficulty-Scaled Footwork Reach Assist:
    // Easy ('full'): 68% auto-reach, Medium ('light'): 38% auto-reach, Hard ('off'): 14% micro-step
    const reachMaxBallX = assist === 'full' ? 0.68 : assist === 'light' ? 0.48 : 0.28;
    const reachLerp = assist === 'full' ? 0.68 : assist === 'light' ? 0.38 : 0.14;
    if (Math.abs(ball.pos.x) <= reachMaxBallX && !this.keys.left && !this.keys.right) {
      this.creaseX = THREE.MathUtils.lerp(
        this.creaseX,
        THREE.MathUtils.clamp(ball.pos.x, -0.44, 0.44),
        reachLerp
      );
    }

    // Re-classify 360° shot with ball length context
    if (this.activeShotType.id !== 'defence') {
      this.activeShotType = this.classifyShot(
        this.swingPlaneYaw,
        this.shotMode === 'fly' && this.isRisingSwing,
        this.peakSwingSpeedDeg,
        isShortBall,
        isFullBall
      );
    }

    const absAngleDeg = Math.abs(THREE.MathUtils.radToDeg(this.swingPlaneYaw));
    const isBehindWicketShot = absAngleDeg > 118;
    const isWideSquareShot = absAngleDeg > 82 && absAngleDeg <= 118;

    // 2. Skill-Based Temporal + 3D Spatial Timing Window Calculation
    const baseWin = (diffProfile && diffProfile.timingWindowMs) || TIMING_WINDOWS_MS[difficulty] || TIMING_WINDOWS_MS.pro;
    const angleDifficultyScale = isBehindWicketShot ? 0.84 : isWideSquareShot ? 0.93 : 1.0;
    const win = {
      perfect: baseWin.perfect * angleDifficultyScale,
      good: baseWin.good * angleDifficultyScale,
      mistime: baseWin.mistime
    };

    const timingGapSec = this.swingPeakTime - (ball.idealContactTime || nowSec);
    const clockGapMs = Math.abs(Math.round(timingGapSec * 1000));
    const ballSpeedZ = Math.max(15, ball.vel.z);
    const spatialGapMs = Math.round((distZ / ballSpeedZ) * 1000);
    // Blend clock timing (75%) and 3D spatial distance (25%) — no automatic free-pass for early swings!
    const absGapMs = Math.round(clockGapMs * 0.75 + spatialGapMs * 0.25);
    const timingGapMs = timingGapSec < 0 ? -absGapMs : absGapMs;

    const isPerfectTiming = absGapMs <= win.perfect && distZ <= 0.85;
    const isGoodTiming = !isPerfectTiming && absGapMs <= win.good && distZ <= 1.25;
    const isCompleteMiss = !isPerfectTiming && !isGoodTiming && (absGapMs > win.mistime || distZ > 1.55);

    // 3. Contact Point & Sweet Spot vs Bat Edge (scaled by difficulty battingAssist)
    const assistTolerance = assist === 'full' ? 0.86 : assist === 'light' ? 0.62 : 0.46;
    const batSweetSpotX = this.creaseX + Math.sin(this.swingPlaneYaw) * 0.20;
    const lateralError = Math.abs(ball.pos.x - batSweetSpotX);

    const unorthodoxLengthPenalty =
      isBehindWicketShot && !isFullBall && !isShortBall && !isPerfectTiming && assist !== 'full';

    if (isCompleteMiss || lateralError > assistTolerance) {
      this.lastLaunchAngleDeg = 0;
      this.lastContact = {
        timingLabelEn: 'PLAY & MISS',
        timingLabelHi: 'बल्ला चूका!',
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
        contactType: 'Missed',
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
      timingQuality = lateralError > 0.34 ? 0.90 : 1.0;
      timingLabelEn = 'PERFECT TIMING';
      timingLabelHi = 'सटीक टाइमिंग!';
      contactType = lateralError > 0.34 ? 'Outer Sweet Spot' : 'Sweet Spot';
    } else if (isGoodTiming) {
      timingQuality = lateralError > 0.32 ? 0.72 : 0.82;
      timingLabelEn = timingGapMs < 0 ? 'GOOD (EARLY)' : 'GOOD (LATE)';
      timingLabelHi = timingGapMs < 0 ? 'अच्छा (थोड़ा जल्दी)' : 'अच्छा (थोड़ा देर)';
      contactType = lateralError > 0.30 ? 'Outer Sweet Spot' : 'Sweet Spot';
    } else {
      timingQuality = 0.50;
      timingLabelEn = timingGapMs < 0 ? 'MISTIMED (EARLY)' : 'MISTIMED (LATE)';
      timingLabelHi = timingGapMs < 0 ? 'मिसटाइम (जल्दी)' : 'मिसटाइम (देर)';
    }

    // 4. Compute 360° Direction & Launch Angle
    const normBatSpeed = THREE.MathUtils.clamp(this.peakSwingSpeedDeg / 465, 0.28, 1.24);
    const timingYawBias = isPerfectTiming ? 0 : THREE.MathUtils.clamp(timingGapSec * 0.55, -0.24, 0.24);
    let finalYaw = Math.atan2(
      Math.sin(this.swingPlaneYaw + timingYawBias),
      Math.cos(this.swingPlaneYaw + timingYawBias)
    );

    // Pivot batsman body toward the 360° shot direction
    this.bodyPivotYaw = THREE.MathUtils.clamp(finalYaw * 0.45, -1.05, 1.05);

    let launchAngleDeg = 0;
    let launchSpeedMs = 11.5 + normBatSpeed * 24.5;

    ball.state = 'hit';
    ball.bouncedAfterHit = false;
    ball.edged = false;

    if (this.shotMode === 'ground') {
      // ==================== GROUND MODE (0° - 8° Safe Carpet Shots) ====================
      const flatFactor = THREE.MathUtils.clamp(this.swingPlanePitchDeg / 20, 0, 1);
      launchAngleDeg = THREE.MathUtils.lerp(1.5, 7.2, flatFactor);
      launchSpeedMs *= timingQuality;

      if (isGoodLength && !isBehindWicketShot && isPerfectTiming) {
        launchSpeedMs *= 1.08;
      }

      const edgeThreshold = assist === 'full' ? 0.48 : assist === 'light' ? 0.36 : 0.28;
      const isGroundEdge =
        (!isPerfectTiming && !isGoodTiming) ||
        (!isPerfectTiming && lateralError > edgeThreshold) ||
        unorthodoxLengthPenalty;

      if (isGroundEdge) {
        ball.edged = true;
        const roll = Math.random();
        if (roll < 0.24 && Math.abs(ball.pos.x) < 0.28) {
          contactType = 'Played-On (Inside Edge)';
          timingLabelEn = 'INSIDE EDGE · PLAYED ON!';
          launchAngleDeg = 2.0;
          launchSpeedMs = 9.5;
          finalYaw = Math.PI;
          ball.isPlayedOn = true;
          ball.pos.set(0, 0.36, CREASE_Z + 0.35);
          ball.vel.set(0, 0.22, 13.5);
        } else if (roll < 0.62) {
          contactType = 'Inside Edge (Ground)';
          timingLabelEn = 'INSIDE EDGE (SAFE ON GROUND)';
          launchAngleDeg = 2.5;
          launchSpeedMs *= 0.56;
        } else {
          contactType = 'Outside Edge (Low)';
          timingLabelEn = 'OUTSIDE EDGE!';
          launchAngleDeg = THREE.MathUtils.randFloat(6.5, 14.5);
          launchSpeedMs *= 0.62;
          finalYaw = (this.handedness === 'left' ? -1 : 1) * THREE.MathUtils.randFloat(2.35, 2.75);
        }
      }
    } else {
      // ==================== FLY MODE (High Risk / High Reward Lofted Shots) ====================
      let lengthPowerMod = 1.0;
      let lengthAngleBias = 0;
      if (isFullBall || isShortBall) {
        lengthPowerMod = isBehindWicketShot ? 1.14 : 1.10;
        lengthAngleBias = 2.0;
      } else if (isYorker) {
        lengthPowerMod = isBehindWicketShot ? 1.02 : 0.72;
        lengthAngleBias = isBehindWicketShot ? 4.0 : -9.0;
      } else if (isGoodLength) {
        lengthPowerMod = isBehindWicketShot ? 0.80 : 0.92;
      }

      const flyOuterEdgeRisk = lateralError > (assist === 'full' ? 0.46 : 0.34);

      if (isPerfectTiming && !flyOuterEdgeRisk && !unorthodoxLengthPenalty) {
        // PERFECT TIMING IN FLY MODE => Clean Booming SIX / Boundary!
        const riseNorm = THREE.MathUtils.clamp((this.swingPlanePitchDeg - 10) / 35, 0, 1);
        launchAngleDeg = THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(27, 38, riseNorm) + lengthAngleBias,
          24,
          44
        );
        launchSpeedMs = (15.0 + normBatSpeed * 25.0) * timingQuality * lengthPowerMod;
        if (normBatSpeed >= 0.80 && !isYorker) {
          launchSpeedMs = Math.max(launchSpeedMs, 28.2);
          launchAngleDeg = THREE.MathUtils.clamp(launchAngleDeg, 28, 38);
        }
      } else if (isGoodTiming && !flyOuterEdgeRisk && !isYorker && !unorthodoxLengthPenalty) {
        // GOOD TIMING IN FLY MODE => Lofted chip over infield (2s / 4s, or deep catch if hit straight to boundary rider)
        launchAngleDeg = THREE.MathUtils.randFloat(23, 34);
        launchSpeedMs = (13.2 + normBatSpeed * 20.5) * timingQuality * lengthPowerMod;
      } else {
        // MISTIMED / OUTER EDGE / YORKER SPLICED IN FLY MODE => High Skyer / Top-Edge Catch Chance!
        ball.edged = true;
        contactType = flyOuterEdgeRisk ? 'Outside Edge (Skyer)' : 'Top Edge (Mistimed FLY)';
        timingLabelEn = 'MISTIMED LOFT · IN THE AIR!';
        timingLabelHi = 'हवा में गेंद · कैच का खतरा!';
        launchAngleDeg = THREE.MathUtils.randFloat(42, 56);
        launchSpeedMs = THREE.MathUtils.randFloat(14.5, 20.5);
        finalYaw += (Math.random() - 0.5) * 0.42;
      }
    }

    if (this.activeShotType.id === 'defence') {
      launchAngleDeg = 2.0;
      launchSpeedMs = 5.5 + normBatSpeed * 3.5;
      contactType = 'Defensive Block';
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
      easy: { trackSpeed: 0.05, timingJitterMs: 75, powerMin: 320, powerMax: 450, flyChance: 0.25 },
      pro: { trackSpeed: 0.10, timingJitterMs: 42, powerMin: 380, powerMax: 510, flyChance: 0.35 },
      legend: { trackSpeed: 0.16, timingJitterMs: 22, powerMin: 430, powerMax: 560, flyChance: 0.45 }
    };
    const skill = skillMap[difficulty] || skillMap.pro;

    this.creaseX = THREE.MathUtils.lerp(this.creaseX, THREE.MathUtils.clamp(ball.pos.x, -0.42, 0.42), skill.trackSpeed);

    if (ball.pos.z >= CREASE_Z - 1.55) {
      const jitterSec = ((Math.random() - 0.5) * 2 * skill.timingJitterMs) / 1000;
      const nowSec = performance.now() * 0.001;
      this.swingPeakTime = (ball.idealContactTime || nowSec) + jitterSec;
      this.peakSwingSpeedDeg = THREE.MathUtils.randFloat(skill.powerMin, skill.powerMax);

      const isGoodForFly = !ball.bouncedOnPitch || ball.pitchBouncePos.z < 3.5;
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
    const moveSpeed = 1.6 * dt;
    const dirSign = this.screenRightSign || -1;
    if (this.keys.left) {
      this.aimDirectionX = Math.max(-1, this.aimDirectionX - moveSpeed * 1.8);
      this.creaseX = THREE.MathUtils.clamp(this.creaseX - moveSpeed * 0.45 * dirSign, -0.48, 0.48);
    } else if (this.keys.right) {
      this.aimDirectionX = Math.min(1, this.aimDirectionX + moveSpeed * 1.8);
      this.creaseX = THREE.MathUtils.clamp(this.creaseX + moveSpeed * 0.45 * dirSign, -0.48, 0.48);
    } else {
      this.aimDirectionX = THREE.MathUtils.damp(this.aimDirectionX, 0, 4, dt);
    }

    if (this.keys.up) {
      this.aimDirectionZ = Math.min(1, this.aimDirectionZ + moveSpeed * 2.2);
      this.creaseZOffset = Math.min(0.52, this.creaseZOffset + moveSpeed);
      this.footwork = 'front';
    } else if (this.keys.down) {
      this.aimDirectionZ = Math.max(-1, this.aimDirectionZ - moveSpeed * 2.2);
      this.creaseZOffset = Math.max(-0.42, this.creaseZOffset - moveSpeed);
      this.footwork = 'back';
    } else {
      this.aimDirectionZ = THREE.MathUtils.damp(this.aimDirectionZ, 1.0, 3.5, dt);
    }

    const nowSec = performance.now() * 0.001;

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

    if (!this.isSwinging && nowSec - this.lastSwingTime > 0.42) {
      this.backliftAngle = THREE.MathUtils.damp(this.backliftAngle, 0.25, 8, dt);
      this.bodyPivotYaw = THREE.MathUtils.damp(this.bodyPivotYaw, 0, 5, dt);
    }
  }
}
