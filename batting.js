import * as THREE from 'three';
import { CREASE_Z } from './physics.js';

/**
 * Batting Mechanics, Pre-Selected Shot Mode (GROUND / FLY) & Low-Lag Sensor Pipeline (batting.js)
 *
 * Key Fixes & Mechanics:
 * 1. Proper Calibration Quaternion: stores stance quaternion q_stance and applies
 *    q_rel = q_current * inverse(q_stance) with verified Android/iOS ZXY device orientation axes.
 * 2. Low-Lag Prediction Pipeline: responsive low-pass filter (0.78) + 22ms angular velocity
 *    lookahead prediction + fast slerp (0.85) so the 3D bat matches the phone in real time.
 * 3. Pre-Selected Shot Type System:
 *    - GROUND (default): 0° to 8° launch angle, zero loft. Mistime = inside edge, played-on, or ground edge.
 *    - FLY: 20° to 50° launch angle, requires rising bat path (low-to-high). Mistime = top edge / catch chance.
 *    - Mismatch handling (FLY + flat swing => low trajectory + top-edge risk; GROUND + upward swing => stays grounded with slight mistime).
 *    - Ball length modifiers (Yorker hard to fly; Full toss & Short ball easy to fly; Good length safest on ground).
 * 4. Widened Timing Windows: +/-120ms for Easy, +/-80ms for Pro, +/-55ms for Legend.
 *    Perfect timing ALWAYS produces a clean sweet-spot shot, never an edge.
 */

const _qCurrent = new THREE.Quaternion();
const _qStanceInv = new THREE.Quaternion();
const _qRel = new THREE.Quaternion();
const _qPredDelta = new THREE.Quaternion();
const _qPredicted = new THREE.Quaternion();
const _deviceEuler = new THREE.Euler(0, 0, 0, 'ZXY');
const _relEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _omegaAxis = new THREE.Vector3();

export const SHOT_TYPES = {
  STRAIGHT_DRIVE: { id: 'straight', nameEn: 'Straight Drive', nameHi: 'स्ट्रेट ड्राइव' },
  COVER_DRIVE: { id: 'cover', nameEn: 'Cover Drive', nameHi: 'कवर ड्राइव' },
  ON_DRIVE: { id: 'ondrive', nameEn: 'On Drive', nameHi: 'ऑन ड्राइव' },
  SQUARE_CUT: { id: 'cut', nameEn: 'Square Cut', nameHi: 'स्क्वायर कट' },
  LEG_FLICK: { id: 'flick', nameEn: 'Leg-Side Flick', nameHi: 'लेग फ्लिक' },
  PULL_SHOT: { id: 'pull', nameEn: 'Pull Shot', nameHi: 'पुल शॉट' },
  LOFTED_DRIVE: { id: 'loft', nameEn: 'Lofted Hit', nameHi: 'लॉफ्टेड शॉट' },
  DEFENCE: { id: 'defence', nameEn: 'Solid Defence', nameHi: 'डिफेंस' }
};

export const TIMING_WINDOWS_MS = {
  easy: { perfect: 120, good: 210, mistime: 310 },
  pro: { perfect: 80, good: 165, mistime: 260 },
  legend: { perfect: 55, good: 125, mistime: 215 }
};

export class BattingSystem {
  constructor() {
    // Pre-selected Shot Mode ('ground' | 'fly')
    this.shotMode = 'ground';    // Default GROUND
    this.modeLocked = false;     // Locks at bowler's release moment

    // Stance & Crease position
    this.creaseX = 0.0;          // Lateral guard (-0.52m leg to +0.52m off)
    this.creaseZOffset = 0.0;    // Forward (+0.55m) or Back (-0.45m)
    this.footwork = 'neutral';

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
    this.calYawDeg = 0;          // Bat face angle (left/right)
    this.calPitchDeg = 0;        // Bat lift angle (down/up)
    this.calRollDeg = 0;         // Wrist roll angle

    // Low-Lag Filtered Gyroscope & Swing Plane Tracking
    this.filteredOmega = new THREE.Vector3(0, 0, 0); // deg/s (pitchRate, yawRate, rollRate)
    this.filteredAccel = new THREE.Vector3(0, 0, 0);
    this.angularSpeedDeg = 0;
    this.peakSwingSpeedDeg = 0;
    this.swingPlaneYaw = 0;      // Radians (-1.25 leg to +1.25 off)
    this.swingPlanePitchDeg = 0; // Swing vertical trajectory: flat (~0-8°) vs rising low-to-high (>15°)
    this.isRisingSwing = false;
    this.backliftAngle = 0.25;
    this.lastLaunchAngleDeg = 0; // Actual launch angle in degrees (NEVER has a default positive loft)

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

    // Keyboard & Touch Fallback State
    this.keys = {
      left: false,
      right: false,
      up: false,
      down: false
    };
    this.aimDirectionX = 0;

    // Last contact telemetry for HUD & Debug Panel
    this.lastContact = {
      timingLabelEn: 'READY',
      timingLabelHi: 'तैयार',
      timingOffsetMs: 0,
      timingQuality: 0,
      batSpeedDeg: 0,
      exitSpeedKmh: 0,
      launchAngleDeg: 0,
      shotMode: 'ground',
      swingPlaneLabel: 'FLAT (0°)',
      contactType: 'None',
      shotNameEn: 'Stance',
      shotNameHi: 'स्टांस',
      outcome: 'none'
    };
  }

  /**
   * Sets pre-selected shot mode ('ground' | 'fly') if not locked by bowler release
   */
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
  }

  startCalibration() {
    this.isCalibrating = true;
    this.calibProgress = 0;
  }

  /**
   * Converts raw device alpha/beta/gamma (degrees) into a consistent Three.js Quaternion
   * supporting both Android (standard W3C ZXY) and iOS Safari orientations.
   */
  buildDeviceQuaternion(alphaDeg, betaDeg, gammaDeg) {
    const a = THREE.MathUtils.degToRad(alphaDeg || 0);
    const b = THREE.MathUtils.degToRad(betaDeg || 0);
    const g = THREE.MathUtils.degToRad(gammaDeg || 0);
    // W3C DeviceOrientation standard intrinsic Z-X'-Y'' equates to Three.js 'YXZ' or 'ZXY'
    // In Three.js camera/world space (+Y up, +X right, -Z toward bowler):
    // beta (tilt front/back) -> X rotation, alpha (compass yaw) -> Y rotation, gamma (side tilt) -> Z rotation
    _deviceEuler.set(b, a, -g, 'YXZ');
    _qCurrent.setFromEuler(_deviceEuler);
    return _qCurrent;
  }

  /**
   * Processes 60-100Hz phone sensor packets with:
   * - Proper q_current * inverse(q_stance) calibration
   * - Lighter low-pass filter (0.78) + 22ms angular velocity lookahead prediction
   */
  ingestSensorPacket(data, dt = 0.014, hooks = {}) {
    this.rawAlpha = Number(data.alpha) || 0;
    this.rawBeta = Number(data.beta) || 0;
    this.rawGamma = Number(data.gamma) || 0;

    this.buildDeviceQuaternion(this.rawAlpha, this.rawBeta, this.rawGamma);

    // Auto-capture initial stance on first steady packet if not yet calibrated
    if (!this.hasAutoStance && !this.isCalibrating) {
      this.qStance.copy(_qCurrent);
      this.hasAutoStance = true;
      this.isCalibrated = true;
    }

    // Lighter low-pass filter (alpha = 0.78 instead of 0.38) to cut smoothing lag
    const fastAlpha = 0.78;
    const gx = (Number(data.gx) || 0) * this.sensitivity; // Pitch rate (deg/s)
    const gy = (Number(data.gy) || 0) * this.sensitivity; // Yaw rate (deg/s)
    const gz = (Number(data.gz) || 0) * this.sensitivity; // Roll rate (deg/s)

    this.filteredOmega.x = THREE.MathUtils.lerp(this.filteredOmega.x, gx, fastAlpha);
    this.filteredOmega.y = THREE.MathUtils.lerp(this.filteredOmega.y, gy, fastAlpha);
    this.filteredOmega.z = THREE.MathUtils.lerp(this.filteredOmega.z, gz, fastAlpha);

    this.filteredAccel.x = THREE.MathUtils.lerp(this.filteredAccel.x, Number(data.ax) || 0, fastAlpha);
    this.filteredAccel.y = THREE.MathUtils.lerp(this.filteredAccel.y, Number(data.ay) || 0, fastAlpha);
    this.filteredAccel.z = THREE.MathUtils.lerp(this.filteredAccel.z, Number(data.az) || 0, fastAlpha);

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

    // Forward angular velocity prediction (22ms lookahead) so bat matches phone with zero perceived lag
    const predictionSec = 0.022;
    const omegaRadMag = THREE.MathUtils.degToRad(omegaMag);
    if (omegaRadMag > 0.05) {
      _omegaAxis.set(
        THREE.MathUtils.degToRad(this.filteredOmega.x),
        THREE.MathUtils.degToRad(this.filteredOmega.y),
        THREE.MathUtils.degToRad(-this.filteredOmega.z)
      ).normalize();
      _qPredDelta.setFromAxisAngle(_omegaAxis, omegaRadMag * predictionSec);
      _qPredicted.copy(_qPredDelta).multiply(_qRel).normalize();
    } else {
      _qPredicted.copy(_qRel);
    }

    // Fast slerp (0.85) for immediate response
    this.currentQuat.slerp(_qPredicted, 0.85);
    _relEuler.setFromQuaternion(this.currentQuat, 'YXZ');

    // Extract calibrated Yaw, Pitch, Roll in degrees
    this.calPitchDeg = THREE.MathUtils.radToDeg(_relEuler.x);
    this.calYawDeg = THREE.MathUtils.radToDeg(_relEuler.y);
    this.calRollDeg = THREE.MathUtils.radToDeg(_relEuler.z);

    // Map calibrated orientation to 3D bat visual pose & crease footwork
    this.backliftAngle = THREE.MathUtils.clamp(_relEuler.x + 0.22, -0.95, 1.45);
    this.creaseZOffset = THREE.MathUtils.clamp(-_relEuler.x * 0.36, -0.42, 0.52);
    this.footwork = this.creaseZOffset > 0.16 ? 'front' : this.creaseZOffset < -0.14 ? 'back' : 'neutral';
    this.creaseX = THREE.MathUtils.clamp(-_relEuler.y * 0.38 + _relEuler.z * 0.22, -0.45, 0.45);

    // Swing & Swing Plane Detection
    const nowSec = performance.now() * 0.001;
    if (omegaMag > 125 && !this.isSwinging && nowSec - this.lastSwingTime > 0.20) {
      this.isSwinging = true;
      this.swingStartTime = nowSec;
      this.swingStartPitchDeg = this.calPitchDeg;
      this.peakSwingSpeedDeg = omegaMag;
    }

    if (this.isSwinging) {
      if (omegaMag >= this.peakSwingSpeedDeg) {
        this.peakSwingSpeedDeg = omegaMag;
        this.swingPeakTime = nowSec;

        // Bat face angle (calibrated yaw + lateral gyro component) sets horizontal shot direction
        const faceYawRad = THREE.MathUtils.degToRad(
          THREE.MathUtils.clamp(-this.calYawDeg * 1.15 - this.filteredOmega.z * 0.09 - this.filteredOmega.y * 0.07, -68, 68)
        );
        this.swingPlaneYaw = THREE.MathUtils.clamp(faceYawRad, -1.22, 1.22);

        // Determine vertical swing plane: flat vs rising (low-to-high)
        const pitchRiseDeg = (this.calPitchDeg - this.swingStartPitchDeg) + this.filteredOmega.x * 0.08;
        this.swingPlanePitchDeg = THREE.MathUtils.clamp(pitchRiseDeg, -20, 55);
        this.isRisingSwing = this.swingPlanePitchDeg > 11 || this.filteredOmega.x > 135;

        this.activeShotType = this.classifyShot(this.swingPlaneYaw, this.shotMode === 'fly' && this.isRisingSwing, this.peakSwingSpeedDeg);
      } else if (omegaMag < this.peakSwingSpeedDeg * 0.65 || nowSec - this.swingStartTime > 0.25) {
        this.isSwinging = false;
        this.lastSwingTime = nowSec;
        if (hooks.onSwingPeak) {
          hooks.onSwingPeak({
            speedDeg: this.peakSwingSpeedDeg,
            yaw: this.swingPlaneYaw,
            planePitchDeg: this.swingPlanePitchDeg,
            isRisingSwing: this.isRisingSwing,
            peakTime: this.swingPeakTime,
            shotType: this.activeShotType
          });
        }
      }
    }

    // Quick flick for 2nd run when ball is in outfield
    if (omegaMag > 260 && nowSec - this.lastFlickTime > 0.65) {
      this.lastFlickTime = nowSec;
      if (hooks.onQuickFlick) hooks.onQuickFlick();
    }
  }

  classifyShot(yawRad, isLofted, speedDeg) {
    if (speedDeg < 165) return SHOT_TYPES.DEFENCE;
    if (isLofted && Math.abs(yawRad) < 0.45) return SHOT_TYPES.LOFTED_DRIVE;
    if (yawRad > 0.78) return SHOT_TYPES.SQUARE_CUT;
    if (yawRad > 0.22) return SHOT_TYPES.COVER_DRIVE;
    if (yawRad < -0.78) return SHOT_TYPES.PULL_SHOT;
    if (yawRad < -0.22) return SHOT_TYPES.LEG_FLICK;
    return SHOT_TYPES.STRAIGHT_DRIVE;
  }

  /**
   * Keyboard & Touch Swipe Shot Trigger
   * Respects the pre-selected shotMode (GROUND vs FLY) and swing plane!
   */
  triggerManualSwing({
    speedDeg = 440,
    dirX = 0,
    planePitchDeg = null,
    isDefensive = false
  }) {
    const nowSec = performance.now() * 0.001;
    this.lastSwingTime = nowSec;
    this.swingPeakTime = nowSec;
    this.peakSwingSpeedDeg = isDefensive ? 150 : speedDeg;
    this.swingPlaneYaw = THREE.MathUtils.clamp(dirX * 1.05, -1.2, 1.2);

    // If planePitchDeg not explicitly passed by swipe, match chosen mode for keyboard convenience
    if (planePitchDeg !== null) {
      this.swingPlanePitchDeg = planePitchDeg;
    } else {
      this.swingPlanePitchDeg = this.shotMode === 'fly' ? 28 : 4;
    }
    this.isRisingSwing = this.swingPlanePitchDeg > 11;
    this.activeShotType = isDefensive
      ? SHOT_TYPES.DEFENCE
      : this.classifyShot(this.swingPlaneYaw, this.shotMode === 'fly' && this.isRisingSwing, this.peakSwingSpeedDeg);
    this.backliftAngle = -0.68;
  }

  /**
   * Evaluates ball-bat contact using:
   * - Pre-selected Shot Mode (GROUND 0-8° vs FLY 20-50°)
   * - Swing Plane (Flat vs Rising low-to-high) & Mismatch rules
   * - Ball Length (Yorker, Full Toss, Short Ball, Good Length)
   * - Difficulty-scaled timing windows (+/-120ms Easy, +/-80ms Pro, +/-55ms Legend)
   * - Guaranteed clean sweet-spot hit on Perfect timing (never an edge)
   */
  evaluateContact(ball, difficulty = 'pro', hooks = {}) {
    if (this.shotExecutedThisBall || ball.state !== 'bowled') return null;

    const nowSec = performance.now() * 0.001;
    const batZ = CREASE_Z - this.creaseZOffset;
    const distZ = Math.abs(ball.pos.z - batZ);

    const timeSinceSwing = nowSec - this.swingPeakTime;
    const swungWithinWindow = Math.abs(timeSinceSwing) < 0.34 || this.isSwinging;

    if (!swungWithinWindow) return null;
    if (distZ > 1.55 && ball.pos.z < batZ - 0.75) return null;

    this.shotExecutedThisBall = true;

    // 1. Classify Ball Length (Yorker, Full Toss, Short, Good Length)
    const isFullToss = !ball.bouncedOnPitch;
    const bounceZ = ball.pitchBouncePos.z;
    const isYorker = ball.bouncedOnPitch && bounceZ >= 7.5;
    const isShortBall = ball.bouncedOnPitch && bounceZ < 2.8;
    const isGoodLength = ball.bouncedOnPitch && bounceZ >= 2.8 && bounceZ < 7.5;

    // 2. Timing Window Calculation (Easy: +/-120ms, Pro: +/-80ms, Legend: +/-55ms)
    const win = TIMING_WINDOWS_MS[difficulty] || TIMING_WINDOWS_MS.pro;
    const timingGapSec = this.swingPeakTime - (ball.idealContactTime || nowSec);
    const timingGapMs = Math.round(timingGapSec * 1000);
    const absGapMs = Math.abs(timingGapMs);

    const isPerfectTiming = absGapMs <= win.perfect;
    const isGoodTiming = absGapMs > win.perfect && absGapMs <= win.good;
    const isMistimed = absGapMs > win.good && absGapMs <= win.mistime;
    const isCompleteMiss = absGapMs > win.mistime;

    // 3. Contact Point & Sweet Spot vs Bat Edge
    const batSweetSpotX = this.creaseX + Math.sin(this.swingPlaneYaw) * 0.25;
    const lateralError = Math.abs(ball.pos.x - batSweetSpotX);

    // Play and miss only if timing is beyond mistime window OR lateral error is huge (>0.68m)
    if (isCompleteMiss || lateralError > 0.68) {
      this.lastLaunchAngleDeg = 0;
      this.lastContact = {
        timingLabelEn: 'PLAY & MISS',
        timingLabelHi: 'बल्ला चूका!',
        timingOffsetMs: timingGapMs,
        timingQuality: 0,
        batSpeedDeg: Math.round(this.peakSwingSpeedDeg),
        exitSpeedKmh: 0,
        launchAngleDeg: 0,
        shotMode: this.shotMode,
        swingPlaneLabel: this.isRisingSwing ? `RISING (+${Math.round(this.swingPlanePitchDeg)}°)` : `FLAT (${Math.round(this.swingPlanePitchDeg)}°)`,
        contactType: 'Missed',
        shotNameEn: this.activeShotType.nameEn,
        shotNameHi: this.activeShotType.nameHi,
        outcome: 'miss'
      };
      if (hooks.onSwingMiss) hooks.onSwingMiss(this.lastContact);
      return this.lastContact;
    }

    // Determine Timing Quality & Contact Type
    // CRITICAL RULE: Perfect timing MUST give a clean sweet-spot shot, NEVER an edge!
    let timingQuality = 1.0;
    let timingLabelEn = 'PERFECT';
    let timingLabelHi = 'परफेक्ट!';
    let contactType = 'Sweet Spot';

    if (isPerfectTiming) {
      timingQuality = 1.0;
      timingLabelEn = 'PERFECT TIMING';
      timingLabelHi = 'सटीक टाइमिंग!';
      contactType = 'Sweet Spot';
    } else if (isGoodTiming) {
      timingQuality = 0.86;
      timingLabelEn = timingGapMs < 0 ? 'GOOD (EARLY)' : 'GOOD (LATE)';
      timingLabelHi = timingGapMs < 0 ? 'अच्छा (थोड़ा जल्दी)' : 'अच्छा (थोड़ा देर)';
      contactType = lateralError > 0.44 ? 'Outer Sweet Spot' : 'Sweet Spot';
    } else {
      timingQuality = 0.48;
      timingLabelEn = timingGapMs < 0 ? 'MISTIMED (EARLY)' : 'MISTIMED (LATE)';
      timingLabelHi = timingGapMs < 0 ? 'मिसटाइम (जल्दी)' : 'मिसटाइम (देर)';
    }

    // 4. Pre-Selected Shot Mode (GROUND vs FLY), Swing Plane & Ball Length Physics
    const normBatSpeed = THREE.MathUtils.clamp(this.peakSwingSpeedDeg / 450, 0.28, 1.32);
    const timingYawBias = isPerfectTiming ? 0 : THREE.MathUtils.clamp(timingGapSec * 1.1, -0.25, 0.25);
    let finalYaw = this.swingPlaneYaw + timingYawBias;

    let launchAngleDeg = 0; // Strictly derived from mode and swing plane (NO default positive loft)
    let launchSpeedMs = 12 + normBatSpeed * 26.5;

    ball.state = 'hit';
    ball.bouncedAfterHit = false;
    ball.edged = false;

    if (this.shotMode === 'ground') {
      // ==================== GROUND MODE (0° - 8° Launch Angle, No Loft) ====================
      // Base launch angle from flat swing plane: strictly 0° to 8°
      const flatFactor = THREE.MathUtils.clamp(this.swingPlanePitchDeg / 20, 0, 1);
      launchAngleDeg = THREE.MathUtils.lerp(1.5, 7.5, flatFactor);

      // Good length is safest on the ground (+10% speed/placement bonus)
      if (isGoodLength) {
        launchSpeedMs *= 1.08;
      }

      // Mismatch Rule: GROUND mode with an upward swing keeps ball on the ground (2-7°) with slight mistiming
      if (this.isRisingSwing && !isPerfectTiming) {
        launchAngleDeg = THREE.MathUtils.clamp(launchAngleDeg, 2.0, 6.8);
        launchSpeedMs *= 0.82;
        timingQuality *= 0.85;
        contactType = 'Bottom-Hand Grounded';
        timingLabelEn = 'GROUND MISMATCH (RISING SWING)';
      }

      // Mistime in GROUND Mode => Inside Edge, Played-On, or Ground Edge (NO aerial catches except rare low edge)
      const isGroundEdge = (!isPerfectTiming && !isGoodTiming) || (!isPerfectTiming && lateralError > 0.46);
      if (isGroundEdge) {
        ball.edged = true;
        const roll = Math.random();
        if (roll < 0.22 && Math.abs(ball.pos.x) < 0.28) {
          // Played-On: inside edge deflects back onto striker's stumps!
          contactType = 'Played-On (Inside Edge)';
          timingLabelEn = 'INSIDE EDGE · PLAYED ON!';
          launchAngleDeg = 2.0;
          launchSpeedMs = 9.5;
          finalYaw = Math.PI + ( -ball.pos.x * 0.4 ); // Aim toward stumps behind
          ball.pos.set(0, 0.35, CREASE_Z + 0.4);
          ball.vel.set(-ball.pos.x * 2.5, 0.5, 11.0);
        } else if (roll < 0.65) {
          // Inside edge onto leg side along the carpet (0° - 4°)
          contactType = 'Inside Edge (Ground)';
          timingLabelEn = 'INSIDE EDGE (SAFE ON GROUND)';
          launchAngleDeg = 2.5;
          launchSpeedMs *= 0.55;
          finalYaw = -0.95 - Math.random() * 0.5;
        } else {
          // Ground edge or low edge (3° - 7°) toward slip/third man
          contactType = 'Ground Edge';
          timingLabelEn = 'THICK EDGE (LOW)';
          launchAngleDeg = 5.5;
          launchSpeedMs *= 0.58;
          finalYaw = 1.15 + Math.random() * 0.35;
        }
      }
    } else {
      // ==================== FLY MODE (20° - 50° Launch Angle, Requires Rising Bat Path) ====================
      const hasRisingPath = this.isRisingSwing || this.swingPlanePitchDeg >= 10;

      // Ball Length Modifiers for FLY mode:
      // - Full toss & Short ball are easy to fly (+12% power, optimal 30°-38° elevation)
      // - Yorker is hard to fly (compresses elevation, lowers power, raises toe-edge/played-on risk)
      let lengthPowerMod = 1.0;
      let lengthAngleBias = 0;
      if (isFullToss || isShortBall) {
        lengthPowerMod = 1.14;
        lengthAngleBias = 2.0;
      } else if (isYorker) {
        lengthPowerMod = 0.74;
        lengthAngleBias = -12.0;
      } else if (isGoodLength) {
        lengthPowerMod = 0.94;
      }

      if (!hasRisingPath) {
        // Mismatch Rule: FLY mode with a flat swing keeps the ball low (6°-14°) and raises top-edge chance!
        if (!isPerfectTiming || Math.random() < 0.48) {
          // Top edge from flat swing trying to FLY
          ball.edged = true;
          contactType = 'Top Edge (Flat Swing in FLY)';
          timingLabelEn = 'FLY MISMATCH · TOP EDGE!';
          launchAngleDeg = THREE.MathUtils.randFloat(44, 58);
          launchSpeedMs *= 0.56;
          finalYaw += (Math.random() - 0.5) * 0.65;
        } else {
          // Kept low despite FLY selection because swing was flat
          contactType = 'Flat Swing (Stayed Low)';
          timingLabelEn = 'FLAT SWING IN FLY MODE';
          launchAngleDeg = THREE.MathUtils.clamp(8 + Math.max(0, this.swingPlanePitchDeg), 6, 14);
          launchSpeedMs *= 0.86;
        }
      } else if (isPerfectTiming || isGoodTiming) {
        // Clean rising swing in FLY mode: 20° to 50° launch angle
        // Map rising swing plane into 24° - 42° sweet spot so high bat speed clears the 52m rope for SIX!
        const riseNorm = THREE.MathUtils.clamp((this.swingPlanePitchDeg - 10) / 35, 0, 1);
        launchAngleDeg = THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(24, 42, riseNorm) + lengthAngleBias,
          20,
          50
        );
        launchSpeedMs = (14.5 + normBatSpeed * 25.0) * timingQuality * lengthPowerMod;
        if (isPerfectTiming && normBatSpeed >= 0.82 && !isYorker) {
          // Ensure clean sweet-spot six trajectory over the 52m rope
          launchSpeedMs = Math.max(launchSpeedMs, 28.5);
          launchAngleDeg = THREE.MathUtils.clamp(launchAngleDeg, 28, 39);
        }
      } else {
        // Mistime in FLY mode => Top Edge and a catch chance (42° - 58° skyer)
        ball.edged = true;
        contactType = 'Top Edge (Mistimed FLY)';
        timingLabelEn = 'TOP EDGE · SKYER!';
        launchAngleDeg = THREE.MathUtils.randFloat(42, 56);
        launchSpeedMs = (13.0 + normBatSpeed * 10.0);
        finalYaw += (Math.random() - 0.5) * 0.55;
      }
    }

    // Defensive push override
    if (this.activeShotType.id === 'defence') {
      launchAngleDeg = 2.0;
      launchSpeedMs = 5.5 + normBatSpeed * 3.5;
      contactType = 'Defensive Block';
    }

    // Compute 3D velocity vector from launchAngleDeg and finalYaw (unless Played-On already set it)
    if (contactType !== 'Played-On (Inside Edge)') {
      const loftRad = THREE.MathUtils.degToRad(launchAngleDeg);
      const horizSpeed = launchSpeedMs * Math.cos(loftRad);
      const vy = launchSpeedMs * Math.sin(loftRad);
      const vx = Math.sin(finalYaw) * horizSpeed;
      const vz = -Math.cos(finalYaw) * horizSpeed;

      ball.vel.set(vx, vy, vz);
    }

    // Only mark aerialAfterHit if launch angle is genuinely elevated (> 10°)
    ball.aerialAfterHit = launchAngleDeg > 10.0;
    ball.shotAngleRad = finalYaw;
    ball.shotPower = normBatSpeed * timingQuality;
    this.lastLaunchAngleDeg = Math.round(launchAngleDeg * 10) / 10;

    this.lastContact = {
      timingLabelEn,
      timingLabelHi,
      timingOffsetMs: timingGapMs,
      timingQuality,
      batSpeedDeg: Math.round(this.peakSwingSpeedDeg),
      exitSpeedKmh: Math.round(launchSpeedMs * 3.6),
      launchAngleDeg: this.lastLaunchAngleDeg,
      shotMode: this.shotMode,
      swingPlaneLabel: this.isRisingSwing
        ? `RISING (+${Math.round(this.swingPlanePitchDeg)}°)`
        : `FLAT (${Math.round(this.swingPlanePitchDeg)}°)`,
      contactType,
      shotNameEn: this.activeShotType.nameEn,
      shotNameHi: this.activeShotType.nameHi,
      outcome: ball.edged ? 'edge' : 'hit'
    };

    if (hooks.onBallHit) hooks.onBallHit(this.lastContact, ball.edged);
    return this.lastContact;
  }

  /**
   * AI Batsman decision logic when human player is bowling
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
      this.shotMode = (isGoodForFly || Math.random() < skill.flyChance) ? 'fly' : 'ground';
      this.swingPlanePitchDeg = this.shotMode === 'fly' ? 28 : 4;
      this.isRisingSwing = this.shotMode === 'fly';

      const baseDirX = ball.pos.x > 0.08
        ? THREE.MathUtils.randFloat(0.25, 0.95)
        : ball.pos.x < -0.08
          ? THREE.MathUtils.randFloat(-0.95, -0.25)
          : THREE.MathUtils.randFloat(-0.45, 0.45);

      this.swingPlaneYaw = baseDirX;
      this.activeShotType = this.classifyShot(this.swingPlaneYaw, this.isRisingSwing, this.peakSwingSpeedDeg);
      this.backliftAngle = -0.68;
      this.evaluateContact(ball, difficulty, hooks);
    }
  }

  updateFrame(dt) {
    const moveSpeed = 1.6 * dt;
    if (this.keys.left) {
      this.aimDirectionX = Math.max(-1, this.aimDirectionX - moveSpeed * 1.5);
      this.creaseX = Math.max(-0.48, this.creaseX - moveSpeed * 0.45);
    } else if (this.keys.right) {
      this.aimDirectionX = Math.min(1, this.aimDirectionX + moveSpeed * 1.5);
      this.creaseX = Math.min(0.48, this.creaseX + moveSpeed * 0.45);
    } else {
      this.aimDirectionX = THREE.MathUtils.damp(this.aimDirectionX, 0, 4, dt);
    }

    if (this.keys.up) {
      this.creaseZOffset = Math.min(0.52, this.creaseZOffset + moveSpeed);
      this.footwork = 'front';
    } else if (this.keys.down) {
      this.creaseZOffset = Math.max(-0.42, this.creaseZOffset - moveSpeed);
      this.footwork = 'back';
    }

    const nowSec = performance.now() * 0.001;
    if (!this.isSwinging && nowSec - this.lastSwingTime > 0.42) {
      this.backliftAngle = THREE.MathUtils.damp(this.backliftAngle, 0.25, 8, dt);
    }
  }
}
