import * as THREE from 'three';
import { CREASE_Z } from './physics.js';

/**
 * Bowling Mechanics & Phone Overarm Release Detector (bowling.js)
 * Implements hold-for-runup, peak angular speed release detection,
 * speed/line/length/wrist-roll mapping, Assist (Off/Light/Full),
 * plus Keyboard/Touch marker bowling and AI Bowler.
 */

export const BOWLER_TYPES = {
  fast: { id: 'fast', nameEn: 'Fast Pace (130-150 km/h)', nameHi: 'तेज़ गेंदबाज़ (130-150)', minKmh: 130, maxKmh: 150 },
  medium: { id: 'medium', nameEn: 'Medium Swing (100-125 km/h)', nameHi: 'मीडियम स्विंग (100-125)', minKmh: 100, maxKmh: 125 },
  spin: { id: 'spin', nameEn: 'Wrist Spin (60-90 km/h)', nameHi: 'स्पिनर (60-90)', minKmh: 60, maxKmh: 90 }
};

export class BowlingSystem {
  constructor() {
    this.bowlerType = 'fast';     // 'fast' | 'medium' | 'spin'
    this.assistMode = 'off';      // 'off' | 'light' | 'full' (Default 'off' per spec)
    this.bowlerSide = 'over';     // 'over' (right of stumps) | 'around' (left of stumps)

    // Run-up & delivery state
    this.state = 'ready';         // 'ready' | 'runup' | 'arm_swing' | 'released'
    this.runupProgress = 0;       // 0.0 to 1.0
    this.runupZ = -CREASE_Z - 6.5;
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

    // Last delivery stats for HUD
    this.lastDelivery = {
      speedKmh: 134,
      lengthLabelEn: 'GOOD LENGTH',
      lengthLabelHi: 'गुड लेंथ',
      swingLabelEn: 'OUTSWING',
      type: 'fast'
    };
  }

  resetForNextBall() {
    this.state = 'ready';
    this.runupProgress = 0;
    this.runupZ = -CREASE_Z - 6.5;
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
        // Record yaw (line), pitch (length), and wrist roll (spin/swing) at peak
        let deltaYaw = (data.alpha || 0) - (this.refYawDeg || 0);
        if (deltaYaw > 180) deltaYaw -= 360;
        if (deltaYaw < -180) deltaYaw += 360;
        this.releaseYawDeg = deltaYaw + (data.gamma || 0) * 0.35;
        this.releasePitchDeg = data.beta || 45;
        this.releaseRollRate = THREE.MathUtils.clamp(gz / 320, -1, 1);
      } else if (this.peakOmegaDeg > 190 && omegaMag < this.peakOmegaDeg * 0.68) {
        // Angular speed dropped after peak -> RELEASE BALL!
        this.state = 'released';
        const delivery = this.computeDeliveryFromPhone();
        if (onReleaseCallback) onReleaseCallback(delivery);
      }
    }
  }

  computeDeliveryFromPhone() {
    const profile = BOWLER_TYPES[this.bowlerType] || BOWLER_TYPES.fast;
    // Map phone swing speed (190..780 deg/s) to bowler type speed band
    const normSpeed = THREE.MathUtils.clamp((this.peakOmegaDeg - 180) / 560, 0.05, 1.0);
    const speedKmh = THREE.MathUtils.lerp(profile.minKmh, profile.maxKmh, normSpeed);

    // Raw Line from yaw angle at release (-30..+30 deg -> -0.95..+0.95 m)
    let rawTargetX = THREE.MathUtils.clamp((this.releaseYawDeg / 28) * 0.85, -1.05, 1.05);

    // Raw Length from pitch angle at release (beta 10..95 deg -> bounceZ 0.5..8.8 m)
    const normPitch = THREE.MathUtils.clamp((this.releasePitchDeg - 15) / 75, 0, 1);
    let rawBounceZ = THREE.MathUtils.lerp(8.6, 0.5, normPitch);

    // Apply Assist setting (Off / Light / Full)
    let assistBlend = 0.0;
    if (this.assistMode === 'light') assistBlend = 0.38;
    else if (this.assistMode === 'full') assistBlend = 0.78;

    const finalTargetX = THREE.MathUtils.lerp(rawTargetX, this.aimTargetX, assistBlend);
    const finalBounceZ = THREE.MathUtils.lerp(rawBounceZ, this.aimBounceZ, assistBlend);
    const wristRoll = this.releaseRollRate || this.wristSpinInput;

    // Overstep check if runupProgress exceeded 1.04 without assist
    const overstepped = this.assistMode === 'off' && this.runupProgress > 1.03;

    return this.buildDeliveryPayload(speedKmh, finalTargetX, finalBounceZ, wristRoll, overstepped);
  }

  /**
   * Keyboard / Touch manual release at current aim marker
   */
  triggerManualDelivery(paceFactor = 0.82) {
    this.state = 'released';
    const profile = BOWLER_TYPES[this.bowlerType] || BOWLER_TYPES.fast;
    const speedKmh = THREE.MathUtils.lerp(profile.minKmh, profile.maxKmh, paceFactor);
    const jitter = this.assistMode === 'full' ? 0.02 : this.assistMode === 'light' ? 0.07 : 0.12;
    const targetX = this.aimTargetX + (Math.random() - 0.5) * jitter;
    const bounceZ = this.aimBounceZ + (Math.random() - 0.5) * jitter * 4;
    return this.buildDeliveryPayload(speedKmh, targetX, bounceZ, this.wristSpinInput, false);
  }

  /**
   * AI Bowler generator scaled by difficulty ('easy' | 'pro' | 'legend')
   */
  generateAIDelivery(difficulty = 'pro', ballCount = 0) {
    // Rotate bowler style every over or based on difficulty
    const types = ['fast', 'medium', 'spin'];
    this.bowlerType = types[Math.floor(ballCount / 6) % types.length];
    const profile = BOWLER_TYPES[this.bowlerType];

    let speedKmh = THREE.MathUtils.randFloat(profile.minKmh, profile.maxKmh);
    let targetX = 0;
    let bounceZ = 4.5;
    let wristRoll = THREE.MathUtils.randFloat(-0.6, 0.6);

    if (difficulty === 'easy') {
      // Predictable slot balls, lower pace
      speedKmh = THREE.MathUtils.lerp(profile.minKmh, profile.maxKmh, 0.45);
      targetX = THREE.MathUtils.randFloat(-0.22, 0.22);
      bounceZ = THREE.MathUtils.randFloat(3.8, 6.2);
      wristRoll *= 0.4;
    } else if (difficulty === 'pro') {
      targetX = THREE.MathUtils.randFloat(-0.35, 0.38);
      bounceZ = THREE.MathUtils.randFloat(2.2, 7.8);
    } else {
      // Legend: sharp yorkers, nagging corridor of uncertainty, maximum swing/spin
      speedKmh = THREE.MathUtils.lerp(profile.minKmh, profile.maxKmh, THREE.MathUtils.randFloat(0.75, 1.0));
      const isYorker = Math.random() < 0.32;
      bounceZ = isYorker ? THREE.MathUtils.randFloat(7.8, 8.7) : THREE.MathUtils.randFloat(3.2, 6.4);
      targetX = THREE.MathUtils.randFloat(-0.28, 0.32);
      wristRoll = (Math.random() < 0.5 ? 1 : -1) * THREE.MathUtils.randFloat(0.65, 1.0);
    }

    this.aimTargetX = targetX;
    this.aimBounceZ = bounceZ;
    return this.buildDeliveryPayload(speedKmh, targetX, bounceZ, wristRoll, false);
  }

  buildDeliveryPayload(speedKmh, targetX, bounceZ, wristRoll, overstepped) {
    let lengthLabelEn = 'GOOD LENGTH';
    let lengthLabelHi = 'गुड लेंथ';
    if (bounceZ >= 7.6) {
      lengthLabelEn = 'YORKER';
      lengthLabelHi = 'यॉर्कर';
    } else if (bounceZ >= 5.6) {
      lengthLabelEn = 'FULL PITCHED';
      lengthLabelHi = 'फुल लेंथ';
    } else if (bounceZ < 2.2) {
      lengthLabelEn = 'BOUNCER / SHORT';
      lengthLabelHi = 'बाउंसर / शॉर्ट';
    }

    const releaseX = this.bowlerSide === 'over' ? 0.34 : -0.34;
    const delivery = {
      speedKmh: Math.round(speedKmh * 10) / 10,
      targetX,
      bounceZ,
      wristRoll,
      bowlerType: this.bowlerType,
      overstepped,
      releaseX,
      lengthLabelEn,
      lengthLabelHi
    };
    this.lastDelivery = delivery;
    return delivery;
  }

  updateRunup(dt, onReachCreaseCallback) {
    if (this.state === 'runup' || this.state === 'arm_swing') {
      this.runupProgress += dt * 0.92;
      this.runupZ = THREE.MathUtils.lerp(-CREASE_Z - 6.5, -CREASE_Z, Math.min(1.06, this.runupProgress));
      if (this.runupProgress > 0.65) {
        this.armAngle = (this.runupProgress - 0.65) * Math.PI * 6.0;
      }
      if (this.runupProgress >= 1.0 && onReachCreaseCallback) {
        onReachCreaseCallback();
      }
    }
  }
}
