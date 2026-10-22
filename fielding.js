import * as THREE from 'three';
import { PITCH_HALF_LENGTH, CREASE_Z } from './physics.js';
import { getDifficultyProfile } from './config.js';

/**
 * 9 AI Fielders + Wicketkeeper Auto-Positioning & Probabilistic Catching System (fielding.js)
 *
 * Key Fixes:
 * - Reduced fielder catch radius (0.95m instead of 1.55m).
 * - Catch probability is NEVER 100%: dynamically computed from ball height, ball speed,
 *   and fielder distance travelled.
 * - GROUND mode shots (0-8°) cannot be caught except on a low edge to keeper/slip before bouncing.
 */

export const FIELD_PRESETS = {
  attacking: {
    id: 'attacking',
    nameEn: 'Attacking (Slips & Catching)',
    nameHi: 'आक्रामक फील्डिंग',
    positions: [
      { role: 'First Slip', x: 1.45, z: 12.8 },
      { role: 'Second Slip', x: 2.35, z: 12.4 },
      { role: 'Gully', x: 5.8, z: 9.8 },
      { role: 'Point', x: 15.0, z: 7.2 },
      { role: 'Cover', x: 15.5, z: -2.5 },
      { role: 'Mid-Off', x: 9.5, z: -17.5 },
      { role: 'Mid-On', x: -9.5, z: -17.5 },
      { role: 'Mid-Wicket', x: -15.0, z: -2.0 },
      { role: 'Fine Leg', x: -11.5, z: 18.5 }
    ]
  },
  normal: {
    id: 'normal',
    nameEn: 'Balanced (Ring & Sweepers)',
    nameHi: 'संतुलित फील्डिंग',
    positions: [
      { role: 'First Slip', x: 1.65, z: 12.6 },
      { role: 'Third Man', x: 23.0, z: 28.0 },
      { role: 'Point', x: 17.5, z: 7.5 },
      { role: 'Extra Cover', x: 19.0, z: -6.0 },
      { role: 'Long-Off', x: 15.0, z: -39.0 },
      { role: 'Mid-On', x: -11.5, z: -19.0 },
      { role: 'Deep Mid-Wicket', x: -37.0, z: -8.0 },
      { role: 'Square Leg', x: -17.0, z: 7.5 },
      { role: 'Short Fine Leg', x: -10.5, z: 16.0 }
    ]
  },
  defensive: {
    id: 'defensive',
    nameEn: 'Defensive (Boundary Riders)',
    nameHi: 'रक्षात्मक फील्डिंग',
    positions: [
      { role: 'Third Man', x: 25.0, z: 32.0 },
      { role: 'Deep Point', x: 42.0, z: 8.0 },
      { role: 'Cover', x: 17.5, z: -4.5 },
      { role: 'Long-Off', x: 16.5, z: -42.5 },
      { role: 'Long-On', x: -16.5, z: -42.5 },
      { role: 'Mid-Wicket', x: -16.5, z: -3.5 },
      { role: 'Deep Mid-Wicket', x: -41.5, z: -10.0 },
      { role: 'Deep Square Leg', x: -40.5, z: 11.0 },
      { role: 'Fine Leg', x: -15.0, z: 22.0 }
    ]
  }
};

export class FieldingSystem {
  constructor() {
    this.setting = 'normal';
    this.isPowerplay = true;
    this.fielders = [];
    this.keeper = {
      id: 'keeper',
      role: 'Wicketkeeper',
      pos: new THREE.Vector3(0.18, 0, PITCH_HALF_LENGTH + 2.6),
      homePos: new THREE.Vector3(0.18, 0, PITCH_HALF_LENGTH + 2.6),
      rotY: Math.PI,
      state: 'idle'
    };

    this.activeChaserIndex = -1;
    this.throwInFlight = false;
    this.throwTargetEnd = 'striker';
    this.throwSpeed = 26.0;
    this.catchAttemptedThisBall = false;

    this.initFielders();
  }

  initFielders() {
    const preset = FIELD_PRESETS[this.setting] || FIELD_PRESETS.normal;
    this.fielders = preset.positions.map((p, idx) => ({
      id: `fielder_${idx + 1}`,
      index: idx,
      role: p.role,
      number: idx + 2,
      pos: new THREE.Vector3(p.x, 0, p.z),
      homePos: new THREE.Vector3(p.x, 0, p.z),
      rotY: Math.atan2(-p.x, -p.z),
      state: 'idle',
      sprintSpeed: 6.9
    }));
    this.applyFieldSetting(this.setting, this.isPowerplay);
  }

  applyFieldSetting(setting = 'normal', isPowerplay = false) {
    this.setting = FIELD_PRESETS[setting] ? setting : 'normal';
    this.isPowerplay = isPowerplay;
    const preset = FIELD_PRESETS[this.setting];

    let outsideCircleCount = 0;
    const circleRadius = 25.0;

    preset.positions.forEach((p, idx) => {
      let fx = p.x;
      let fz = p.z;
      const dist = Math.hypot(fx, fz);

      if (isPowerplay && dist > circleRadius) {
        outsideCircleCount++;
        if (outsideCircleCount > 2) {
          const scale = (circleRadius - 2.2) / dist;
          fx *= scale;
          fz *= scale;
        }
      }

      if (this.fielders[idx]) {
        this.fielders[idx].role = p.role;
        this.fielders[idx].homePos.set(fx, 0, fz);
      }
    });
  }

  resetToHomePositions(bowlerType = 'fast') {
    this.activeChaserIndex = -1;
    this.throwInFlight = false;
    this.catchAttemptedThisBall = false;
    const keeperZ = bowlerType === 'spin' ? PITCH_HALF_LENGTH + 1.35 : PITCH_HALF_LENGTH + 3.2;
    this.keeper.homePos.set(0.15, 0, keeperZ);
    this.keeper.pos.copy(this.keeper.homePos);
    this.keeper.state = 'idle';

    this.fielders.forEach((f) => {
      f.pos.copy(f.homePos);
      f.rotY = Math.atan2(-f.pos.x, CREASE_Z - f.pos.z);
      f.state = 'idle';
    });
  }

  /**
   * Computes realistic catch probability (0.0 to 0.78, NEVER 100%)
   * Depends on ball height, ball speed, and fielder sprint distance from home position.
   */
  computeCatchProbability(ball, fielder, difficulty = 'pro') {
    const ballSpeedMs = ball.vel.length();
    const heightY = ball.pos.y;
    const distFromHome = Math.hypot(fielder.pos.x - fielder.homePos.x, fielder.pos.z - fielder.homePos.z);

    // 1. Height factor: chest-to-head height (0.75m - 1.65m) is ideal; ankle-low or high-leaping is much harder
    let heightFactor = 0.85;
    if (heightY < 0.45) {
      heightFactor = THREE.MathUtils.mapLinear(heightY, 0.18, 0.45, 0.25, 0.65);
    } else if (heightY > 1.70) {
      heightFactor = THREE.MathUtils.mapLinear(heightY, 1.70, 2.25, 0.65, 0.22);
    }

    // 2. Speed factor: slow skyers (<14 m/s) are easier; fierce drives (>25 m/s) burst through hands
    const speedFactor = THREE.MathUtils.clamp(
      THREE.MathUtils.mapLinear(ballSpeedMs, 10, 32, 0.92, 0.22),
      0.18,
      0.92
    );

    // 3. Distance factor: sprinting >8m lowers balance and catch completion chance
    const distFactor = THREE.MathUtils.clamp(1.0 - (distFromHome / 18.0) * 0.55, 0.35, 1.0);

    // Difficulty scalar from Rookie (0.56) -> Club (0.72) -> Pro (0.85) -> Legend (0.95)
    const diffProfile = getDifficultyProfile(difficulty);
    const diffScalar = diffProfile ? diffProfile.fielderCatchSkill : 0.82;

    // Combine and cap strictly below 1.0 (max 0.84)
    return THREE.MathUtils.clamp(heightFactor * speedFactor * distFactor * diffScalar, 0.08, 0.84);
  }

  update(dt, ball, difficulty = 'pro', callbacks = {}) {
    if (ball.state === 'idle' || ball.state === 'runup' || ball.state === 'bowled') {
      this.fielders.forEach((f) => {
        f.pos.lerp(f.homePos, Math.min(1, dt * 4));
      });
      this.keeper.pos.lerp(this.keeper.homePos, Math.min(1, dt * 6));
      return;
    }

    if (ball.state === 'fielded' && this.throwInFlight) {
      const targetZ = this.throwTargetEnd === 'striker' ? PITCH_HALF_LENGTH : -PITCH_HALF_LENGTH;
      if (this.throwTargetEnd === 'striker') {
        this.keeper.pos.x = THREE.MathUtils.lerp(this.keeper.pos.x, 0.14, Math.min(1, dt * 8));
        this.keeper.pos.z = THREE.MathUtils.lerp(this.keeper.pos.z, PITCH_HALF_LENGTH + 0.32, Math.min(1, dt * 8));
      }
      const dx = 0 - ball.pos.x;
      const dz = targetZ - ball.pos.z;
      const dist = Math.hypot(dx, dz);
      const step = this.throwSpeed * dt;
      if (dist <= step + 0.35) {
        ball.pos.set(0, 0.52, targetZ);
        ball.vel.set(0, 0, 0);
        this.throwInFlight = false;
        ball.state = 'dead';
        if (callbacks.onThrowReachedStumps) callbacks.onThrowReachedStumps(this.throwTargetEnd);
      } else {
        ball.pos.x += (dx / dist) * step;
        ball.pos.z += (dz / dist) * step;
        ball.pos.y = 0.55 + Math.sin((dist / 30) * Math.PI) * 1.4;
      }
      return;
    }

    if (ball.state !== 'hit' || ball.isPlayedOn) return;

    // 1. Wicketkeeper Low-Edge / Caught-Behind check (reduced radius 1.15m, probabilistic)
    const keeperDist = Math.hypot(ball.pos.x - this.keeper.pos.x, ball.pos.z - this.keeper.pos.z);
    if (
      ball.edged &&
      !ball.bouncedAfterHit &&
      !this.catchAttemptedThisBall &&
      keeperDist < 1.15 &&
      ball.pos.y >= 0.16 &&
      ball.pos.y <= 1.95
    ) {
      this.catchAttemptedThisBall = true;
      const prob = this.computeCatchProbability(ball, this.keeper, difficulty);
      if (Math.random() < prob) {
        this.keeper.pos.x = ball.pos.x;
        ball.state = 'dead';
        ball.vel.set(0, 0, 0);
        if (callbacks.onCaught) callbacks.onCaught(this.keeper, true, Math.round(prob * 100));
        return;
      } else {
        // Keeper parried/dropped the edge -> ball drops to ground
        ball.bouncedAfterHit = true;
        ball.vel.multiplyScalar(0.35);
        ball.pos.y = 0.1;
        if (callbacks.onCatchDropped) callbacks.onCatchDropped(this.keeper, Math.round(prob * 100));
      }
    }

    // 2. Find nearest fielder to ball
    const diffProfile = getDifficultyProfile(difficulty);
    const speedMultiplier = diffProfile ? diffProfile.fielderSpeedMultiplier : 0.96;
    const predictPosX = ball.pos.x + ball.vel.x * 0.35;
    const predictPosZ = ball.pos.z + ball.vel.z * 0.35;

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.fielders.length; i++) {
      const f = this.fielders[i];
      const d = Math.hypot(predictPosX - f.pos.x, predictPosZ - f.pos.z);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    this.activeChaserIndex = bestIdx;

    // Tighter catch & ground fielding radii (0.95m catch radius, 1.15m ground pickup)
    const CATCH_RADIUS = 0.95;
    const GROUND_PICKUP_RADIUS = 1.15;

    this.fielders.forEach((f, idx) => {
      const targetX = idx === bestIdx ? predictPosX : ball.pos.x * 0.15 + f.homePos.x * 0.85;
      const targetZ = idx === bestIdx ? predictPosZ : ball.pos.z * 0.15 + f.homePos.z * 0.85;
      const dx = targetX - f.pos.x;
      const dz = targetZ - f.pos.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.15) {
        const moveRate = (idx === bestIdx ? f.sprintSpeed * speedMultiplier : 2.8) * dt;
        f.pos.x += (dx / dist) * Math.min(dist, moveRate);
        f.pos.z += (dz / dist) * Math.min(dist, moveRate);
        f.rotY = Math.atan2(dx, dz);
        f.state = idx === bestIdx ? 'chasing' : 'idle';
      }

      const ballDist = Math.hypot(ball.pos.x - f.pos.x, ball.pos.z - f.pos.z);

      // Aerial Catch check:
      // Must be within tight CATCH_RADIUS (0.95m), unbounced, within catchable height (0.20m..2.15m),
      // and either an aerial FLY shot (ball.aerialAfterHit) or a low edge to slip!
      const canAttemptCatch =
        !ball.bouncedAfterHit &&
        !this.catchAttemptedThisBall &&
        ballDist <= CATCH_RADIUS &&
        ball.pos.y >= 0.20 &&
        ball.pos.y <= 2.15 &&
        (ball.aerialAfterHit || (ball.edged && f.role.includes('Slip')));

      if (canAttemptCatch) {
        this.catchAttemptedThisBall = true;
        const catchProb = this.computeCatchProbability(ball, f, difficulty);
        if (Math.random() < catchProb) {
          f.state = 'fielded';
          ball.state = 'dead';
          ball.vel.set(0, 0, 0);
          if (callbacks.onCaught) callbacks.onCaught(f, ball.edged, Math.round(catchProb * 100));
          return;
        } else {
          // Catch spilled! Ball deflects to turf
          ball.bouncedAfterHit = true;
          ball.vel.multiplyScalar(0.32);
          ball.pos.y = 0.08;
          if (callbacks.onCatchDropped) callbacks.onCatchDropped(f, Math.round(catchProb * 100));
          return;
        }
      }

      // Ground ball stop & throw (only when ball is low <= 1.05m and within GROUND_PICKUP_RADIUS)
      if (ballDist <= GROUND_PICKUP_RADIUS && ball.pos.y <= 1.05 && (ball.bouncedAfterHit || !ball.aerialAfterHit)) {
        // Very fast ground drives (> 29 m/s) have a chance to pierce past a diving infielder for FOUR!
        const ballSpeed = ball.vel.length();
        if (ballSpeed > 28 && !ball.bouncedAfterHit && Math.random() < 0.55) {
          return;
        }
        f.state = 'throwing';
        ball.state = 'fielded';
        ball.pos.set(f.pos.x, 1.2, f.pos.z);
        ball.vel.set(0, 0, 0);
        this.throwInFlight = true;
        this.throwTargetEnd = Math.abs(f.pos.z - PITCH_HALF_LENGTH) < Math.abs(f.pos.z + PITCH_HALF_LENGTH)
          ? 'striker'
          : 'nonStriker';
        if (callbacks.onFielded) callbacks.onFielded(f, this.throwTargetEnd);
      }
    });
  }
}
