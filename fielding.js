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
      { role: 'Third Man', x: 25.0, z: 35.5 },
      { role: 'Point', x: 17.5, z: 7.5 },
      { role: 'Extra Cover', x: 19.0, z: -6.5 },
      { role: 'Long-Off', x: 16.5, z: -43.0 },
      { role: 'Mid-On', x: -11.5, z: -19.0 },
      { role: 'Deep Mid-Wicket', x: -42.5, z: -14.5 },
      { role: 'Square Leg', x: -17.0, z: 7.5 },
      { role: 'Short Fine Leg', x: -10.5, z: 16.0 }
    ]
  },
  defensive: {
    id: 'defensive',
    nameEn: 'Defensive (Boundary Riders)',
    nameHi: 'रक्षात्मक फील्डिंग',
    positions: [
      { role: 'Third Man', x: 26.5, z: 36.5 },
      { role: 'Deep Point', x: 44.5, z: 8.5 },
      { role: 'Extra Cover', x: 18.5, z: -5.5 },
      { role: 'Long-Off', x: 17.5, z: -43.5 },
      { role: 'Long-On', x: -17.5, z: -43.5 },
      { role: 'Mid-Wicket', x: -16.5, z: -3.5 },
      { role: 'Deep Mid-Wicket', x: -43.5, z: -13.0 },
      { role: 'Deep Square Leg', x: -43.0, z: 13.5 },
      { role: 'Short Fine Leg', x: -13.5, z: 18.5 }
    ]
  },
  death_overs: {
    id: 'death_overs',
    nameEn: 'Death Overs (5 Rope Riders)',
    nameHi: 'डेथ ओवर्स फील्डिंग',
    positions: [
      { role: 'Short Third Man', x: 13.5, z: 16.5 },
      { role: 'Deep Cover Point', x: 44.0, z: -10.5 },
      { role: 'Extra Cover', x: 16.5, z: -5.5 },
      { role: 'Long-Off', x: 18.0, z: -43.5 },
      { role: 'Long-On', x: -18.0, z: -43.5 },
      { role: 'Mid-Wicket', x: -15.5, z: -3.5 },
      { role: 'Deep Mid-Wicket', x: -43.5, z: -13.5 },
      { role: 'Deep Square Leg', x: -43.0, z: 14.0 },
      { role: 'Short Fine Leg', x: -12.0, z: 16.0 }
    ]
  },
  spin_trap: {
    id: 'spin_trap',
    nameEn: 'Spin Trap (Catching & Sweepers)',
    nameHi: 'स्पिन ट्रैप फील्डिंग',
    positions: [
      { role: 'First Slip', x: 1.55, z: 12.4 },
      { role: 'Short Third Man', x: 13.0, z: 15.5 },
      { role: 'Point', x: 16.5, z: 6.5 },
      { role: 'Cover', x: 16.0, z: -4.5 },
      { role: 'Long-Off', x: 17.0, z: -43.0 },
      { role: 'Long-On', x: -17.0, z: -43.0 },
      { role: 'Deep Mid-Wicket', x: -43.0, z: -12.5 },
      { role: 'Square Leg', x: -15.5, z: 7.0 },
      { role: 'Deep Square Leg', x: -42.5, z: 13.5 }
    ]
  }
};

export class FieldingSystem {
  constructor() {
    this.setting = 'normal';
    this.manualOverride = false;
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
    this.pickupDelayTimer = 0;
    this.activeThrower = null;
    this.relayFielder = null;
    this.isRelayLeg = false;
    this.throwTargetEnd = 'striker';
    this.throwSpeed = 29.5;
    this.catchAttemptedThisBall = false;
    this.diveAttemptedThisBall = false;

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
      sprintSpeed: 6.5
    }));
    this.applyFieldSetting(this.setting, this.isPowerplay);
  }

  applyFieldSetting(setting = 'normal', isPowerplay = false, isManual = false) {
    if (isManual) this.manualOverride = true;
    this.setting = FIELD_PRESETS[setting] ? setting : 'normal';
    this.isPowerplay = isPowerplay;
    const preset = FIELD_PRESETS[this.setting];

    const circleRadius = 25.0;
    const maxOutsideCircle = isPowerplay ? 2 : 5;
    const maxAllowedRadius = 48.0; // Strictly inside the 52m boundary rope

    // When Powerplay is active (max 2 outside circle), prioritize keeping 1 off-side and 1 leg-side boundary sweeper
    // so both sides of the ground remain balanced
    const deepIndices = [];
    preset.positions.forEach((p, idx) => {
      if (Math.hypot(p.x, p.z) > circleRadius) {
        deepIndices.push(idx);
      }
    });

    const allowedDeepSet = new Set();
    if (deepIndices.length <= maxOutsideCircle) {
      deepIndices.forEach((idx) => allowedDeepSet.add(idx));
    } else if (isPowerplay) {
      const offDeep = deepIndices.find((idx) => preset.positions[idx].x >= 0 && preset.positions[idx].z < 0) ?? deepIndices[0];
      const legDeep = deepIndices.find((idx) => preset.positions[idx].x < 0) ?? deepIndices[deepIndices.length - 1];
      allowedDeepSet.add(offDeep);
      allowedDeepSet.add(legDeep);
      for (const idx of deepIndices) {
        if (allowedDeepSet.size >= maxOutsideCircle) break;
        allowedDeepSet.add(idx);
      }
    } else {
      deepIndices.slice(0, maxOutsideCircle).forEach((idx) => allowedDeepSet.add(idx));
    }

    preset.positions.forEach((p, idx) => {
      let fx = p.x;
      let fz = p.z;
      const dist = Math.hypot(fx, fz);

      if (dist > circleRadius && !allowedDeepSet.has(idx)) {
        const scale = (circleRadius - 2.2) / dist;
        fx *= scale;
        fz *= scale;
      } else if (dist > maxAllowedRadius) {
        const scale = maxAllowedRadius / dist;
        fx *= scale;
        fz *= scale;
      }

      if (this.fielders[idx]) {
        this.fielders[idx].role = p.role;
        this.fielders[idx].homePos.set(fx, 0, fz);
      }
    });
  }

  /**
   * Automatic Phase-Aware & Hot-Zone Adaptive Field Placement (inspired by Last Over & The Final Overs)
   */
  applyAdaptiveField(matchContext = {}) {
    const isPowerplay = Boolean(matchContext.isPowerplay);
    const modeId = matchContext.modeId || 'run_chase';
    const ballsRem = typeof matchContext.ballsRemaining === 'number' ? matchContext.ballsRemaining : 30;
    const bowlerType = matchContext.bowlerType || 'fast';
    const isOneOver = modeId === 'last_over' || modeId === 'super_over' || (matchContext.totalOvers || 5) <= 1;
    const isDeathPhase = isOneOver || ballsRem <= 12;

    const recentShots = Array.isArray(matchContext.recentShots) ? matchContext.recentShots : [];
    const lastThree = recentShots.slice(-3);
    const recentBoundaries = lastThree.filter((s) => (s?.runs || 0) >= 4).length;

    if (!this.manualOverride) {
      let autoPreset = 'normal';
      if (isDeathPhase && !isPowerplay) {
        autoPreset = 'death_overs';
      } else if (!isPowerplay && recentBoundaries >= 2) {
        autoPreset = 'defensive';
      } else if (isPowerplay) {
        autoPreset = recentBoundaries >= 2 ? 'normal' : 'attacking';
      } else if (bowlerType === 'spin') {
        autoPreset = 'spin_trap';
      }
      this.applyFieldSetting(autoPreset, isPowerplay, false);
    } else {
      this.applyFieldSetting(this.setting, isPowerplay, false);
    }

    // Subtle Hot-Zone Plugging: if batter hit 2 consecutive boundaries in a sector, shift the closest fielder slightly (max 9°)
    // while keeping them strictly inside their region and inside the 47m boundary ring!
    if (recentShots.length >= 2) {
      const s1 = recentShots[recentShots.length - 1];
      const s2 = recentShots[recentShots.length - 2];
      if ((s1?.runs || 0) >= 4 && (s2?.runs || 0) >= 4 && typeof s1.angleRad === 'number') {
        const targetAngle = s1.angleRad;
        let closestIdx = -1;
        let bestDiff = Infinity;
        for (let i = 0; i < this.fielders.length; i++) {
          const hp = this.fielders[i].homePos;
          const r = Math.hypot(hp.x, hp.z);
          if (r < 15) continue;
          const fAng = Math.atan2(hp.x, -hp.z);
          const diff = Math.abs(Math.atan2(Math.sin(targetAngle - fAng), Math.cos(targetAngle - fAng)));
          if (diff < bestDiff) {
            bestDiff = diff;
            closestIdx = i;
          }
        }
        if (closestIdx >= 0 && bestDiff > 0.08 && bestDiff < 0.50) {
          const hp = this.fielders[closestIdx].homePos;
          const r = Math.min(46.8, Math.hypot(hp.x, hp.z));
          const curAng = Math.atan2(hp.x, -hp.z);
          const deltaAng = Math.atan2(Math.sin(targetAngle - curAng), Math.cos(targetAngle - curAng));
          const shiftedAng = curAng + THREE.MathUtils.clamp(deltaAng * 0.40, -0.16, 0.16);
          hp.set(Math.sin(shiftedAng) * r, 0, -Math.cos(shiftedAng) * r);
        }
      }
    }
  }

  resetToHomePositions(bowlerType = 'fast') {
    this.activeChaserIndex = -1;
    this.throwInFlight = false;
    this.pickupDelayTimer = 0;
    this.activeThrower = null;
    this.relayFielder = null;
    this.isRelayLeg = false;
    this.catchAttemptedThisBall = false;
    this.diveAttemptedThisBall = false;
    // Con #3 Fix: Wicketkeeper stands right up to the stumps (0.55m behind wickets) on Spin for authentic Stumping,
    // and stands back (2.85m behind wickets) for Fast / Medium pace bowlers.
    const keeperZ = bowlerType === 'spin' ? PITCH_HALF_LENGTH + 0.55 : PITCH_HALF_LENGTH + 2.85;
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
   * Finds the best inner-ring relay fielder when a boundary fielder picks up the ball far from the stumps (> 36m)
   */
  findRelayFielder(thrower, targetZ) {
    if (!thrower || thrower.id === 'keeper') return null;
    const totalDist = Math.hypot(thrower.pos.x, targetZ - thrower.pos.z);
    if (totalDist < 36.0) return null;

    const midX = thrower.pos.x * 0.45;
    const midZ = THREE.MathUtils.lerp(targetZ, thrower.pos.z, 0.45);
    let bestRelay = null;
    let bestScore = Infinity;

    for (let i = 0; i < this.fielders.length; i++) {
      const f = this.fielders[i];
      if (f === thrower) continue;
      const distToStumps = Math.hypot(f.pos.x, targetZ - f.pos.z);
      const distToThrower = Math.hypot(f.pos.x - thrower.pos.x, f.pos.z - thrower.pos.z);
      if (distToStumps < 12.0 || distToStumps > totalDist - 10.0 || distToThrower < 10.0) continue;
      const distToMid = Math.hypot(f.pos.x - midX, f.pos.z - midZ);
      if (distToMid < bestScore && distToMid < 18.5) {
        bestScore = distToMid;
        bestRelay = f;
      }
    }
    return bestRelay;
  }

  setupFielderThrow(fielder, ball, pickupDelay = 0.26) {
    this.activeThrower = fielder;
    this.throwTargetEnd =
      Math.abs(fielder.pos.z - PITCH_HALF_LENGTH) < Math.abs(fielder.pos.z + PITCH_HALF_LENGTH)
        ? 'striker'
        : 'nonStriker';
    const targetZ = this.throwTargetEnd === 'striker' ? PITCH_HALF_LENGTH : -PITCH_HALF_LENGTH;
    const relay = this.findRelayFielder(fielder, targetZ);
    if (relay) {
      this.relayFielder = relay;
      this.isRelayLeg = true;
      const destX = relay.pos.x;
      const destZ = relay.pos.z;
      fielder.rotY = Math.atan2(destX - fielder.pos.x, destZ - fielder.pos.z);
      relay.rotY = Math.atan2(fielder.pos.x - destX, fielder.pos.z - destZ);
      this.throwStartDist = Math.max(3.5, Math.hypot(destX - fielder.pos.x, destZ - fielder.pos.z));
    } else {
      this.relayFielder = null;
      this.isRelayLeg = false;
      fielder.rotY = Math.atan2(-fielder.pos.x, targetZ - fielder.pos.z);
      this.throwStartDist = Math.max(3.5, Math.hypot(fielder.pos.x, targetZ - fielder.pos.z));
    }
    this.pickupDelayTimer = pickupDelay;
    this.pickupInitialDelay = pickupDelay;
    this.throwInFlight = false;
  }

  /**
   * Computes realistic catch probability (0.10 to 0.84, NEVER 100%)
   * Depends on ball height, ball speed, and fielder sprint distance from home position.
   */
  computeCatchProbability(ball, fielder, difficulty = 'pro') {
    const ballSpeedMs = ball.vel.length();
    const heightY = ball.pos.y;
    const distFromHome = Math.hypot(fielder.pos.x - fielder.homePos.x, fielder.pos.z - fielder.homePos.z);

    // 1. Height factor: chest-to-head height (0.70m - 1.75m) is ideal; ankle-low or jumping overhead (>1.80m) is harder
    let heightFactor = 0.86;
    if (heightY < 0.45) {
      heightFactor = THREE.MathUtils.mapLinear(heightY, 0.18, 0.45, 0.28, 0.68);
    } else if (heightY > 1.75) {
      heightFactor = THREE.MathUtils.mapLinear(heightY, 1.75, 2.28, 0.70, 0.24);
    }

    // 2. Speed factor: high hang-time skyers (<18 m/s) are easier; fierce flat hits (>26 m/s) are harder to hold
    const speedFactor = THREE.MathUtils.clamp(
      THREE.MathUtils.mapLinear(ballSpeedMs, 11, 32, 0.92, 0.28),
      0.22,
      0.92
    );

    // 3. Distance factor: sprinting a long way lowers balance and catch completion chance
    const distFactor = THREE.MathUtils.clamp(1.0 - (distFromHome / 20.0) * 0.50, 0.38, 1.0);

    // Difficulty scalar from Easy (0.56) -> Medium (0.72) -> Hard (0.84)
    const diffProfile = getDifficultyProfile(difficulty);
    const diffScalar = diffProfile ? diffProfile.fielderCatchSkill : 0.76;

    return THREE.MathUtils.clamp(heightFactor * speedFactor * distFactor * diffScalar, 0.10, 0.84);
  }

  /**
   * Predicts where a ball in play is heading, clamped strictly inside the 52m boundary rope
   * so fielders stay inside the playing ground and cannot intercept sixes that sail over their heads!
   */
  predictAerialLandingSpot(ball) {
    if (!ball.aerialAfterHit || ball.bouncedAfterHit) {
      const lead = ball.vel.length() > 5.0 ? 0.34 : 0.0;
      return {
        x: ball.pos.x + ball.vel.x * lead,
        z: ball.pos.z + ball.vel.z * lead
      };
    }
    const g = 9.81;
    const y0 = Math.max(0.2, ball.pos.y);
    const vy = ball.vel.y;
    const targetCatchY = 1.05;
    const c = y0 - targetCatchY;
    const disc = vy * vy + 2 * g * Math.max(0, c);
    const tFlight = THREE.MathUtils.clamp((vy + Math.sqrt(Math.max(0, disc))) / g, 0.15, 3.6);
    const dragScale = 0.82;
    const landX = ball.pos.x + ball.vel.x * tFlight * dragScale;
    const landZ = ball.pos.z + ball.vel.z * tFlight * dragScale;
    // Keep fielder target strictly inside the 52m boundary rope (max 49.0m radius)
    const r = Math.hypot(landX, landZ);
    if (r > 49.0) {
      const clampScale = 49.0 / r;
      return { x: landX * clampScale, z: landZ * clampScale };
    }
    return { x: landX, z: landZ };
  }

  update(dt, ball, difficulty = 'pro', callbacks = {}) {
    if (ball.state === 'idle' || ball.state === 'runup' || ball.state === 'bowled') {
      this.fielders.forEach((f) => {
        f.pos.lerp(f.homePos, Math.min(1, dt * 4));
      });
      this.keeper.pos.lerp(this.keeper.homePos, Math.min(1, dt * 6));
      return;
    }

    if (ball.state === 'fielded') {
      const targetZ = this.throwTargetEnd === 'striker' ? PITCH_HALF_LENGTH : -PITCH_HALF_LENGTH;
      if (this.throwTargetEnd === 'striker') {
        // Wicketkeeper moves right up to the stumps to collect the incoming throw and whip the bails
        this.keeper.pos.x = THREE.MathUtils.lerp(this.keeper.pos.x, 0.12, Math.min(1, dt * 9));
        this.keeper.pos.z = THREE.MathUtils.lerp(this.keeper.pos.z, PITCH_HALF_LENGTH + 0.28, Math.min(1, dt * 9));
      }

      const destX = this.isRelayLeg && this.relayFielder ? this.relayFielder.pos.x : 0;
      const destZ = this.isRelayLeg && this.relayFielder ? this.relayFielder.pos.z : targetZ;

      // Realistic pickup, balance & arm-cocking phase before ball leaves fielder's hand
      if (this.pickupDelayTimer > 0) {
        const prevTimer = this.pickupDelayTimer;
        this.pickupDelayTimer = Math.max(0, this.pickupDelayTimer - dt);
        if (this.activeThrower) {
          this.activeThrower.rotY = Math.atan2(destX - this.activeThrower.pos.x, destZ - this.activeThrower.pos.z);
          const totalDelay = Math.max(0.16, this.pickupInitialDelay || 0.32);
          const gatherProg = THREE.MathUtils.clamp(1.0 - this.pickupDelayTimer / totalDelay, 0, 1);
          const handY = THREE.MathUtils.lerp(0.42, 1.36, gatherProg);
          const forwardOffset = Math.sin(gatherProg * Math.PI) * 0.22;
          const sinY = Math.sin(this.activeThrower.rotY);
          const cosY = Math.cos(this.activeThrower.rotY);
          ball.pos.set(
            this.activeThrower.pos.x + sinY * forwardOffset,
            handY,
            this.activeThrower.pos.z + cosY * forwardOffset
          );
          ball.trailCount = 0;
        }
        // Trigger throw windup animation 0.22s before ball release (essential after a dive stop or relay catch!)
        if (prevTimer > 0.22 && this.pickupDelayTimer <= 0.22 && callbacks.onThrowWindup && this.activeThrower) {
          callbacks.onThrowWindup(this.activeThrower, this.throwTargetEnd);
        }
        if (this.pickupDelayTimer <= 0) {
          this.throwInFlight = true;
          this.throwStartDist = Math.max(3.5, Math.hypot(destX - ball.pos.x, destZ - ball.pos.z));
          ball.trailCount = 0;
          if (typeof ball.pushTrailPoint === 'function') {
            ball.pushTrailPoint();
          }
          if (callbacks.onThrowRelease && this.activeThrower) {
            callbacks.onThrowRelease(this.activeThrower, this.throwTargetEnd);
          }
        }
        return;
      }

      if (this.throwInFlight) {
        const dx = destX - ball.pos.x;
        const dz = destZ - ball.pos.z;
        const dist = Math.hypot(dx, dz);
        const activeThrowSpeed = Math.max(20.5, this.throwSpeed || 24.0);
        const step = activeThrowSpeed * dt;
        if (dist <= step + 0.38) {
          if (this.isRelayLeg && this.relayFielder) {
            // Relay fielder catches the boundary throw and immediately turns to fire at the stumps!
            const relay = this.relayFielder;
            this.isRelayLeg = false;
            this.relayFielder = null;
            this.activeThrower = relay;
            relay.state = 'throwing';
            relay.rotY = Math.atan2(-relay.pos.x, targetZ - relay.pos.z);
            ball.pos.set(relay.pos.x, 1.15, relay.pos.z);
            ball.trailCount = 0;
            this.throwInFlight = false;
            this.pickupDelayTimer = 0.12;
            this.pickupInitialDelay = 0.12;
            this.throwSpeed = 31.0;
            this.throwStartDist = Math.max(3.5, Math.hypot(relay.pos.x, targetZ - relay.pos.z));
            if (callbacks.onRelayCatch) {
              callbacks.onRelayCatch(relay, this.throwTargetEnd);
            }
          } else {
            ball.pos.set(0, 0.52, targetZ);
            ball.vel.set(0, 0, 0);
            ball.trailCount = 0;
            this.throwInFlight = false;
            ball.state = 'dead';
            if (callbacks.onThrowReachedStumps) callbacks.onThrowReachedStumps(this.throwTargetEnd);
          }
        } else {
          ball.pos.x += (dx / dist) * step;
          ball.pos.z += (dz / dist) * step;
          const startDist = Math.max(3.5, this.throwStartDist || 18.0);
          const flightProg = THREE.MathUtils.clamp(1.0 - dist / startDist, 0, 1);
          const maxArc = THREE.MathUtils.clamp(startDist * 0.046, 0.26, 1.28);
          const endHeight = this.isRelayLeg ? 1.15 : 0.54;
          ball.pos.y = THREE.MathUtils.lerp(1.36, endHeight, flightProg) + Math.sin(flightProg * Math.PI) * maxArc;
          if (typeof ball.pushTrailPoint === 'function') {
            ball.pushTrailPoint();
          }
        }
      }
      return;
    }

    if (ball.state !== 'hit' || ball.isPlayedOn) return;

    // 1. Wicketkeeper Reactive Edge Tracking & Diving Catch Check (supports 1-handed lateral dives on thin/thick edges)
    if (ball.edged && !ball.bouncedAfterHit && ball.pos.z >= CREASE_Z - 0.5 && ball.pos.z <= this.keeper.pos.z + 1.2) {
      this.keeper.pos.x = THREE.MathUtils.lerp(
        this.keeper.pos.x,
        THREE.MathUtils.clamp(ball.pos.x, -1.65, 1.65),
        Math.min(1, dt * 11.5)
      );
    }
    const keeperDist = Math.hypot(ball.pos.x - this.keeper.pos.x, ball.pos.z - this.keeper.pos.z);
    const keeperReachRadius = ball.edgeType === 'thin_edge' || ball.edgeType === 'thick_edge' ? 1.55 : 1.18;
    if (
      ball.edged &&
      !ball.bouncedAfterHit &&
      !this.catchAttemptedThisBall &&
      keeperDist < keeperReachRadius &&
      ball.pos.y >= 0.14 &&
      ball.pos.y <= 2.05
    ) {
      this.catchAttemptedThisBall = true;
      const isDivingCatch = Math.abs(ball.pos.x - this.keeper.homePos.x) > 0.42 || keeperDist > 0.72;
      const baseProb = this.computeCatchProbability(ball, this.keeper, difficulty);
      const prob = ball.edgeType === 'thin_edge' ? Math.min(0.86, baseProb * 1.15) : baseProb;
      if (Math.random() < prob) {
        this.keeper.pos.x = ball.pos.x;
        ball.state = 'dead';
        ball.vel.set(0, 0, 0);
        if (callbacks.onCaught) callbacks.onCaught(this.keeper, true, Math.round(prob * 100), isDivingCatch);
        return;
      } else {
        // Keeper parried/dropped the edge -> ball drops to ground
        ball.bouncedAfterHit = true;
        ball.vel.multiplyScalar(0.35);
        ball.pos.y = 0.1;
        if (callbacks.onCatchDropped) callbacks.onCatchDropped(this.keeper, Math.round(prob * 100));
      }
    }

    // 1b. Wicketkeeper Ground Ball / Dropped-Edge Pickup near the crease so short blocks/edges never sit unfielded
    if (
      ball.state === 'hit' &&
      (ball.bouncedAfterHit || !ball.aerialAfterHit) &&
      ball.pos.z >= CREASE_Z - 2.4 &&
      keeperDist <= 7.5 &&
      ball.vel.length() < 9.5
    ) {
      if (keeperDist > 0.15) {
        const kStep = Math.min(keeperDist, 6.4 * dt);
        this.keeper.pos.x += ((ball.pos.x - this.keeper.pos.x) / keeperDist) * kStep;
        this.keeper.pos.z += ((ball.pos.z - this.keeper.pos.z) / keeperDist) * kStep;
      }
      const updatedKeeperDist = Math.hypot(ball.pos.x - this.keeper.pos.x, ball.pos.z - this.keeper.pos.z);
      if (updatedKeeperDist <= 1.25 && ball.pos.y <= 1.05) {
        this.keeper.state = 'throwing';
        ball.state = 'fielded';
        ball.pos.set(this.keeper.pos.x, 0.85, this.keeper.pos.z);
        ball.vel.set(0, 0, 0);
        ball.trailCount = 0;
        this.activeThrower = this.keeper;
        this.relayFielder = null;
        this.isRelayLeg = false;
        this.pickupDelayTimer = 0.12;
        this.pickupInitialDelay = 0.12;
        this.throwInFlight = false;
        this.throwTargetEnd = 'striker';
        this.throwStartDist = Math.max(3.5, Math.hypot(this.keeper.pos.x, PITCH_HALF_LENGTH - this.keeper.pos.z));
        if (callbacks.onFielded) callbacks.onFielded(this.keeper, this.throwTargetEnd);
        return;
      }
    }

    // 2. Find nearest fielder in the ball's region (prevents cross-region interception!)
    const diffProfile = getDifficultyProfile(difficulty);
    const speedMultiplier = diffProfile ? diffProfile.fielderSpeedMultiplier : 0.92;
    const predictedSpot = this.predictAerialLandingSpot(ball);
    const predictPosX = predictedSpot.x;
    const predictPosZ = predictedSpot.z;

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

    // Realistic catching & ground fielding radii (no superhuman jump or cross-field teleportation)
    const CATCH_RADIUS = 0.96;
    const BOUNDARY_ROPE_CATCH_RADIUS = 1.12;
    const SLIP_EDGE_CATCH_RADIUS = 1.38;
    const GROUND_PICKUP_RADIUS = 1.15;
    const DIVE_STOP_RADIUS = 2.25;

    for (let idx = 0; idx < this.fielders.length; idx++) {
      if (ball.state !== 'hit') return;
      const f = this.fielders[idx];
      // Only chase if this is the nearest fielder in the region (or ball has already bounced and is rolling in outfield)
      const isRegionalChaser = idx === bestIdx && (bestDist <= 22.5 || ball.bouncedAfterHit || !ball.aerialAfterHit);
      const targetX = isRegionalChaser ? predictPosX : ball.pos.x * 0.10 + f.homePos.x * 0.90;
      const targetZ = isRegionalChaser ? predictPosZ : ball.pos.z * 0.10 + f.homePos.z * 0.90;
      const dx = targetX - f.pos.x;
      const dz = targetZ - f.pos.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.12) {
        const moveRate = (isRegionalChaser ? f.sprintSpeed * speedMultiplier * 1.14 : 3.2) * dt;
        f.pos.x += (dx / dist) * Math.min(dist, moveRate);
        f.pos.z += (dz / dist) * Math.min(dist, moveRate);
        // Keep every fielder strictly inside the 52m playable boundary!
        const fRad = Math.hypot(f.pos.x, f.pos.z);
        if (fRad > 50.5) {
          const clampRatio = 50.5 / fRad;
          f.pos.x *= clampRatio;
          f.pos.z *= clampRatio;
        }
        f.rotY = Math.atan2(dx, dz);
        f.state = isRegionalChaser ? 'chasing' : 'idle';
      }

      const ballDist = Math.hypot(ball.pos.x - f.pos.x, ball.pos.z - f.pos.z);
      const fielderRadiusFromCenter = Math.hypot(f.pos.x, f.pos.z);
      const isBoundaryOutfielder = fielderRadiusFromCenter >= 32.0;
      const isSlipOrGully = f.role.includes('Slip') || f.role.includes('Gully') || f.role.includes('Point');
      const effectiveCatchRadius =
        ball.edged && isSlipOrGully
          ? SLIP_EDGE_CATCH_RADIUS
          : isBoundaryOutfielder
            ? BOUNDARY_ROPE_CATCH_RADIUS
            : CATCH_RADIUS;
      const maxCatchHeightY = isBoundaryOutfielder ? 2.28 : 2.15;

      // Wait for steeply descending high balls to drop into natural chest/head catching height (<=1.68m)
      // while still allowing leaping catches (up to 2.28m) on flat/passing trajectories
      const nextBallDist = Math.hypot(
        ball.pos.x + ball.vel.x * dt - f.pos.x,
        ball.pos.z + ball.vel.z * dt - f.pos.z
      );
      const waitToDropIntoHands =
        ball.vel.y < -2.5 &&
        ball.pos.y > 1.68 &&
        nextBallDist <= effectiveCatchRadius * 0.95;

      const canAttemptCatch =
        !ball.bouncedAfterHit &&
        !this.catchAttemptedThisBall &&
        !waitToDropIntoHands &&
        ballDist <= effectiveCatchRadius &&
        ball.pos.y >= 0.16 &&
        ball.pos.y <= maxCatchHeightY &&
        (ball.aerialAfterHit || (ball.edged && isSlipOrGully));

      if (canAttemptCatch) {
        this.catchAttemptedThisBall = true;
        const isDivingCatch =
          ballDist > 0.72 ||
          ball.pos.y > 2.10 ||
          (ball.edged && isSlipOrGully && ballDist > 0.45);
        const catchProb = this.computeCatchProbability(ball, f, difficulty);
        if (Math.random() < catchProb) {
          if (isDivingCatch) {
            f.pos.x = THREE.MathUtils.lerp(f.pos.x, ball.pos.x, 0.85);
            f.pos.z = THREE.MathUtils.lerp(f.pos.z, ball.pos.z, 0.85);
          }
          f.state = 'fielded';
          ball.state = 'dead';
          ball.vel.set(0, 0, 0);
          if (callbacks.onCaught) callbacks.onCaught(f, ball.edged && f.role.includes('Slip'), Math.round(catchProb * 100), isDivingCatch);
          return;
        } else {
          // Catch spilled! Ball deflects to turf
          ball.bouncedAfterHit = true;
          ball.aerialAfterHit = false;
          ball.vel.multiplyScalar(0.32);
          ball.pos.y = 0.08;
          if (callbacks.onCatchDropped) callbacks.onCatchDropped(f, Math.round(catchProb * 100));
          return;
        }
      }

      // Acrobatic Infield Dive Stop (Improvement 4):
      // When a fast ground drive (14..28 m/s) races past an infielder between 1.15m and 2.35m,
      // the fielder can launch a full-stretch lateral dive to stop a probable boundary!
      const ballSpeed = ball.vel.length();
      const fielderRadiusFromPitch = Math.hypot(f.homePos.x, f.homePos.z);
      if (
        !this.diveAttemptedThisBall &&
        ballDist > GROUND_PICKUP_RADIUS &&
        ballDist <= DIVE_STOP_RADIUS &&
        ball.pos.y <= 0.90 &&
        (ball.bouncedAfterHit || !ball.aerialAfterHit) &&
        ballSpeed >= 13.5 &&
        fielderRadiusFromPitch <= 30.0
      ) {
        this.diveAttemptedThisBall = true;
        const diveSkill = diffProfile ? diffProfile.fielderCatchSkill * 0.68 : 0.52;
        if (Math.random() < diveSkill) {
          // Fielder lunges to the ball position and stops it dead!
          f.pos.x = THREE.MathUtils.lerp(f.pos.x, ball.pos.x, 0.78);
          f.pos.z = THREE.MathUtils.lerp(f.pos.z, ball.pos.z, 0.78);
          f.state = 'throwing';
          ball.state = 'fielded';
          ball.pos.set(f.pos.x, 0.45, f.pos.z);
          ball.vel.set(0, 0, 0);
          ball.trailCount = 0;
          // Recovery after a full-stretch dive (0.48s) followed by overarm throw (or relay throw)
          this.setupFielderThrow(f, ball, 0.48);
          if (callbacks.onDiveStop) {
            callbacks.onDiveStop(f, this.throwTargetEnd);
          } else if (callbacks.onFielded) {
            callbacks.onFielded(f, this.throwTargetEnd);
          }
          return;
        }
      }

      // Ground ball stop & throw (only when ball is low <= 1.05m and within GROUND_PICKUP_RADIUS)
      if (ballDist <= GROUND_PICKUP_RADIUS && ball.pos.y <= 1.05 && (ball.bouncedAfterHit || !ball.aerialAfterHit)) {
        // Very fast ground drives (> 29 m/s) have a chance to pierce past a diving infielder for FOUR!
        if (ballSpeed > 28 && !ball.bouncedAfterHit && Math.random() < 0.55) {
          continue;
        }
        f.state = 'throwing';
        ball.state = 'fielded';
        ball.pos.set(f.pos.x, 0.55, f.pos.z);
        ball.vel.set(0, 0, 0);
        ball.trailCount = 0;
        // Snappy pickup + balance + bullet release delay (0.14s)
        this.setupFielderThrow(f, ball, 0.14);
        if (callbacks.onFielded) callbacks.onFielded(f, this.throwTargetEnd);
        return;
      }
    }
  }
}
