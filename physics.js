import * as THREE from 'three';

/**
 * Custom 3D Cricket Ball Physics Engine (physics.js)
 * Implements gravity, aerodynamic drag, Magnus swing/spin curve,
 * pitch-type & progressive pitch-wear dependent bounce, visible 3D seam spin quaternion,
 * stump/bail collision, LBW, Wide & No-Ball detection.
 */

export const PITCH_HALF_LENGTH = 10.06; // 20.12m total between stumps
export const CREASE_Z = 8.84;           // Popping crease 1.22m in front of stumps
export const STUMP_HEIGHT = 0.71;
export const STUMP_WIDTH = 0.2286;      // 9 inches across 3 stumps
export const BALL_RADIUS = 0.036;       // 3.6cm radius (scaled slightly visually in 3D)
export const BOUNDARY_RADIUS = 52.0;    // Fast-paced arcade stadium boundary

export const SURFACE_PROFILES = {
  normal: {
    id: 'normal',
    nameEn: 'Balanced Turf Pitch',
    nameHi: 'संतुलित टर्फ पिच',
    restitution: 0.66,
    paceRetention: 0.84,
    spinGrip: 1.15,
    swingFactor: 1.15,
    seamJitter: 0.022
  },
  green: {
    id: 'green',
    nameEn: 'Green Top Seamer',
    nameHi: 'हरी सीम पिच',
    restitution: 0.71,
    paceRetention: 0.88,
    spinGrip: 0.88,
    swingFactor: 1.48,
    seamJitter: 0.038
  },
  dusty: {
    id: 'dusty',
    nameEn: 'Dusty Rank Turner',
    nameHi: 'धूल भरी स्पिन पिच',
    restitution: 0.56,
    paceRetention: 0.76,
    spinGrip: 1.72,
    swingFactor: 0.92,
    seamJitter: 0.031
  },
  hard: {
    id: 'hard',
    nameEn: 'Hard Bouncy Track',
    nameHi: 'हार्ड बाउंसी पिच',
    restitution: 0.76,
    paceRetention: 0.91,
    spinGrip: 0.82,
    swingFactor: 1.05,
    seamJitter: 0.018
  },
  street: {
    id: 'street',
    nameEn: 'Street Concrete',
    nameHi: 'गली कंक्रीट',
    restitution: 0.74,
    paceRetention: 0.88,
    spinGrip: 0.75,
    swingFactor: 0.85,
    seamJitter: 0.015
  },
  club: {
    id: 'club',
    nameEn: 'Club Turf Ground',
    nameHi: 'क्लब टर्फ ग्राउंड',
    restitution: 0.63,
    paceRetention: 0.81,
    spinGrip: 1.38,
    swingFactor: 1.18,
    seamJitter: 0.028
  },
  night: {
    id: 'night',
    nameEn: 'Night Floodlit Pitch',
    nameHi: 'नाइट स्टेडियम पिच',
    restitution: 0.69,
    paceRetention: 0.85,
    spinGrip: 1.14,
    swingFactor: 1.34,
    seamJitter: 0.022
  }
};

// Pre-allocated vectors for zero-GC physics step
const _vDrag = new THREE.Vector3();
const _vMagnus = new THREE.Vector3();
const _vAccel = new THREE.Vector3();
const _vStep = new THREE.Vector3();
const _spinAxis = new THREE.Vector3();
const _spinDeltaQuat = new THREE.Quaternion();

export class BallPhysics {
  constructor() {
    this.pos = new THREE.Vector3(0, 1.9, -CREASE_Z);
    this.prevPos = new THREE.Vector3(0, 1.9, -CREASE_Z);
    this.vel = new THREE.Vector3(0, 0, 0);
    // Spin vector (rad/s): x = topspin/backspin, y = sidespin, z = seam/gyroscope roll
    this.omega = new THREE.Vector3(0, 0, 0);
    this.ballQuat = new THREE.Quaternion();
    this.seamCantRad = 0.22; // Visible seam inclination toward slip/fine-leg
    this.swingAccelX = 0; // Conventional/reverse swing lateral acceleration

    this.state = 'idle'; // 'idle' | 'runup' | 'bowled' | 'hit' | 'fielded' | 'dead'
    this.surface = 'night';
    this.pitchType = 'normal'; // 'normal' | 'green' | 'dusty' | 'hard'
    this.pitchWear = 0.05;     // 0.0 (fresh rolled pitch) -> 1.0 (heavily worn match pitch)
    this.wearSpots = [];       // [{ x, z, intensity }] accumulated ball impacts & footmarks
    this.lastBounceWearHit = 0;

    this.bouncedOnPitch = false;
    this.bounceCount = 0;
    this.pitchBouncePos = new THREE.Vector3();
    this.crossedCrease = false;
    this.creaseCrossPos = new THREE.Vector3();
    this.creaseCrossVel = new THREE.Vector3();
    this.hasCrossedBatZone = false;
    this.enteredBatZoneTime = 0;
    this.idealContactTime = 0;

    // Delivery metadata
    this.speedKmh = 0;
    this.bowlerType = 'fast'; // 'fast' | 'medium' | 'spin'
    this.variationId = 'outswinger';
    this.variationNameEn = 'Outswinger';
    this.lateSwing = false;
    this.seamCut = 0;
    this.spinTurn = 0;
    this.topSpin = 0;
    this.bounceMod = 1.0;
    this.dipFactor = 0;
    this.spinRpm = 0;
    this.isOverstepNoBall = false;
    this.isWide = false;
    this.isNoBall = false;
    this.hitPad = false;
    this.edged = false;
    this.isPlayedOn = false;
    this.aerialAfterHit = false;
    this.bouncedAfterHit = false;

    // Shot wagon wheel metadata
    this.shotLandingPos = new THREE.Vector3();
    this.shotAngleRad = 0;
    this.shotDistance = 0;
    this.shotPower = 0;

    // Trail history (pre-allocated ring)
    this.maxTrail = 45;
    this.trail = Array.from({ length: this.maxTrail }, () => new THREE.Vector3());
    this.trailCount = 0;
  }

  getActiveProfile() {
    const p =
      (this.pitchType && SURFACE_PROFILES[this.pitchType]) ||
      SURFACE_PROFILES[this.surface] ||
      SURFACE_PROFILES.normal;
    return {
      ...p,
      labelEn: p.labelEn || p.nameEn || 'Balanced',
      labelHi: p.labelHi || p.nameHi || 'संतुलित'
    };
  }

  getPitchProfile() {
    return this.getActiveProfile();
  }

  /**
   * Records a ball impact crater & bowler footmark wear spot on the pitch
   */
  recordPitchWearSpot(x, z, amount = 0.035) {
    this.pitchWear = Math.min(1.0, this.pitchWear + amount * 0.45);
    // Merge with nearby wear spot if within 0.35m
    for (let i = 0; i < this.wearSpots.length; i++) {
      const s = this.wearSpots[i];
      if (Math.hypot(s.x - x, s.z - z) < 0.38) {
        s.intensity = Math.min(1.0, s.intensity + amount * 1.6);
        return s.intensity;
      }
    }
    const intensity = Math.min(1.0, 0.18 + amount * 2.0);
    if (this.wearSpots.length < 120) {
      this.wearSpots.push({ x, z, intensity });
    }
    return intensity;
  }

  /**
   * Evaluates localized rough / footmark wear at pitch coordinates (x, z)
   */
  getSpotWearAt(x, z) {
    let localWear = this.pitchWear * 0.45;
    for (let i = 0; i < this.wearSpots.length; i++) {
      const s = this.wearSpots[i];
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < 0.55) {
        localWear = Math.max(localWear, s.intensity * (1 - d / 0.55));
      }
    }
    return THREE.MathUtils.clamp(localWear, 0, 1);
  }

  resetMatchWear() {
    this.pitchWear = 0.05;
    this.wearSpots.length = 0;
  }

  reset(x = 0.25, y = 2.05, z = -CREASE_Z) {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.ballQuat.identity();
    this.swingAccelX = 0;
    this.state = 'idle';
    this.bouncedOnPitch = false;
    this.bounceCount = 0;
    this.crossedCrease = false;
    this.hasCrossedBatZone = false;
    this.enteredBatZoneTime = 0;
    this.idealContactTime = 0;
    this.isOverstepNoBall = false;
    this.isWide = false;
    this.isNoBall = false;
    this.hitPad = false;
    this.edged = false;
    this.isPlayedOn = false;
    this.aerialAfterHit = false;
    this.bouncedAfterHit = false;
    this.shotDistance = 0;
    this.trailCount = 0;
  }

  /**
   * Launches a bowled ball from bowler's hand at release point
   */
  launchDelivery({
    speedKmh = 132,
    targetX = 0.0,
    bounceZ = 4.2,
    wristRoll = 0.2,
    bowlerType = 'fast',
    overstepped = false,
    releaseX = 0.32,
    variationId = 'outswinger',
    variationNameEn = 'Outswinger',
    swingCurl = null,
    lateSwing = false,
    seamCut = 0,
    spinTurn = 0,
    topSpin = 0,
    bounceMod = 1.0,
    dipFactor = 0
  }) {
    const releaseY = variationId === 'undercutter' ? 1.88 : 2.08;
    this.reset(releaseX, releaseY, -CREASE_Z + (overstepped ? 0.35 : -0.05));
    this.state = 'bowled';
    this.speedKmh = THREE.MathUtils.clamp(speedKmh, 58, 158);
    this.bowlerType = bowlerType;
    this.variationId = variationId || 'outswinger';
    this.variationNameEn = variationNameEn || 'Outswinger';
    this.lateSwing = Boolean(lateSwing);
    this.seamCut = Number(seamCut) || 0;
    this.spinTurn = Number(spinTurn) || 0;
    this.topSpin = Number(topSpin) || 0;
    this.bounceMod = Number(bounceMod) || 1.0;
    this.dipFactor = Number(dipFactor) || 0;
    this.targetX = Number(targetX) || 0;
    this.isOverstepNoBall = overstepped;
    this.isNoBall = overstepped;

    const speedMs = this.speedKmh / 3.6;
    const dzToBounce = Math.max(4.0, bounceZ - this.pos.z);
    const flightTimeToBounce = dzToBounce / (speedMs * 0.96);

    const gravity = 9.81 + Math.max(0, this.dipFactor) * 1.35;
    const vy = (0.04 - this.pos.y + 0.5 * gravity * flightTimeToBounce * flightTimeToBounce) / flightTimeToBounce;

    const totalDz = CREASE_Z - this.pos.z;
    const totalTime = totalDz / (speedMs * 0.92);

    const profile = this.getActiveProfile();
    const effectiveCurl = typeof swingCurl === 'number' ? swingCurl : wristRoll;
    this.seamCantRad = THREE.MathUtils.clamp(effectiveCurl * 0.55, -0.55, 0.55);

    if (bowlerType === 'spin') {
      this.swingAccelX = effectiveCurl * 0.42 * profile.swingFactor;
      const sideSpin = (this.spinTurn || wristRoll) * 115;
      const overSpin = 44 + this.topSpin * 55;
      this.omega.set(overSpin, sideSpin, wristRoll * 75);
      this.spinRpm = Math.round(1680 + Math.abs(this.spinTurn || wristRoll) * 980);
    } else if (bowlerType === 'medium') {
      this.swingAccelX = effectiveCurl * 1.15 * profile.swingFactor;
      this.omega.set(28 + this.topSpin * 30, (this.seamCut || wristRoll) * 32, wristRoll * 38);
      this.spinRpm = Math.round(1150 + Math.abs(wristRoll) * 450);
    } else {
      this.swingAccelX = effectiveCurl * 1.05 * profile.swingFactor;
      this.omega.set(34 + this.topSpin * 35, (this.seamCut || wristRoll) * 22, wristRoll * 30);
      this.spinRpm =
        variationId === 'knuckleball'
          ? 180
          : Math.round(1350 + Math.abs(wristRoll) * 420);
    }

    // Orient initial seam angle toward swing/spin direction
    this.ballQuat.setFromEuler(new THREE.Euler(0, this.seamCantRad, 0));

    // Aim horizontal velocity so the ball pitches at targetX at bounceZ, compensating for air swing
    const airSwingToBounce = 0.5 * this.swingAccelX * flightTimeToBounce * flightTimeToBounce;
    const vx = (this.targetX - this.pos.x - airSwingToBounce) / flightTimeToBounce;
    const vz = Math.sqrt(Math.max(10, speedMs * speedMs - vx * vx - vy * vy));

    this.vel.set(vx, vy, vz);

    const nowSec = performance.now() * 0.001;
    this.idealContactTime = nowSec + totalTime;
    this.pushTrailPoint();
  }

  pushTrailPoint() {
    if (this.trailCount < this.maxTrail) {
      this.trail[this.trailCount].copy(this.pos);
      this.trailCount++;
    } else {
      for (let i = 0; i < this.maxTrail - 1; i++) {
        this.trail[i].copy(this.trail[i + 1]);
      }
      this.trail[this.maxTrail - 1].copy(this.pos);
    }
  }

  /**
   * Step ball physics with sub-stepping and 3D seam quaternion integration
   */
  update(dt, callbacks = {}) {
    if (this.state === 'idle' || this.state === 'runup' || this.state === 'dead') return;

    const clampedDt = Math.min(dt, 0.05);
    const subSteps = 4;
    const subDt = clampedDt / subSteps;
    const profile = this.getActiveProfile();

    // Update visible 3D ball seam spin quaternion
    const omegaLen = this.omega.length();
    if (omegaLen > 0.1) {
      _spinAxis.copy(this.omega).divideScalar(omegaLen);
      // Visual spin rate scaled so seam stitch revolution is clearly visible at 60fps
      const visualAngle = Math.min(omegaLen * clampedDt * 0.55, 1.8);
      _spinDeltaQuat.setFromAxisAngle(_spinAxis, visualAngle);
      this.ballQuat.premultiply(_spinDeltaQuat).normalize();
    }

    for (let s = 0; s < subSteps; s++) {
      this.prevPos.copy(this.pos);

      // 1. Gravity (+ aerodynamic late dip on topspinners/slower balls/knuckleballs)
      const dipGravity =
        this.state === 'bowled' && !this.bouncedOnPitch && this.dipFactor > 0
          ? this.dipFactor * 1.35
          : 0;
      _vAccel.set(0, -(9.81 + dipGravity), 0);

      // 2. Aerodynamic drag
      const speed = this.vel.length();
      if (speed > 0.01) {
        const dragCoeff = this.state === 'hit' ? 0.0095 : 0.0065;
        _vDrag.copy(this.vel).multiplyScalar(-dragCoeff * speed);
        _vAccel.add(_vDrag);
      }

      // 3. Controlled Swing in air before bounce (supports late reverse/tailing swing without wild Magnus drift)
      if (this.state === 'bowled' && !this.bouncedOnPitch) {
        let swingMult = 1.0;
        if (this.lateSwing) {
          swingMult = this.pos.z > -1.5 ? 1.45 : 0.35;
        }
        _vAccel.x += this.swingAccelX * swingMult;
      } else if (this.state === 'hit' && !this.bouncedAfterHit) {
        _vMagnus.crossVectors(this.omega, this.vel).multiplyScalar(0.00025);
        _vAccel.add(_vMagnus);
      }

      // Integrate velocity & position
      this.vel.addScaledVector(_vAccel, subDt);
      _vStep.copy(this.vel).multiplyScalar(subDt);
      this.pos.add(_vStep);

      // Ground / Pitch bounce check
      if (this.pos.y <= BALL_RADIUS) {
        this.pos.y = BALL_RADIUS;
        this.bounceCount++;

        if (this.state === 'bowled') {
          const firstBounce = !this.bouncedOnPitch;
          this.bouncedOnPitch = true;
          if (firstBounce) {
            this.pitchBouncePos.copy(this.pos);

            // Evaluate progressive pitch wear & rough footmarks at impact coordinate
            const localWear = this.getSpotWearAt(this.pos.x, this.pos.z);
            this.lastBounceWearHit = localWear;
            this.recordPitchWearSpot(this.pos.x, this.pos.z, 0.04);

            // Variable restitution from pitch type + delivery bounceMod + rough wear cracks
            const wearBounceVar = (Math.random() - 0.42) * localWear * 0.11;
            const effectiveRestitution = THREE.MathUtils.clamp(
              profile.restitution * this.bounceMod + this.topSpin * 0.06 + wearBounceVar,
              0.40,
              0.88
            );

            this.vel.y = Math.abs(this.vel.y) * effectiveRestitution;
            const skidBoost = this.topSpin < -0.3 ? 1.05 : 1.0; // Flipper/slider/undercutter skids on faster
            this.vel.z *= profile.paceRetention * skidBoost * (1 - localWear * 0.05);

            // Realistic spin grip & seam cut after pitching (10cm-28cm sharp turn/cut)
            const wearSpinMultiplier = 1.0 + localWear * 0.45;
            const spinDeviation = this.omega.y * 0.0068 * profile.spinGrip * wearSpinMultiplier;
            const cutterDeviation = this.seamCut * 0.52 * profile.spinGrip * (1 + localWear * 0.3);
            const seamVariation =
              (Math.random() - 0.5) * profile.seamJitter * 0.45 * (1 + localWear * 0.35) * this.vel.z;
            this.vel.x += spinDeviation + cutterDeviation + seamVariation;

            // Keep normal deliveries inside the playable batting corridor at the stumps so they don't drift wide!
            if (Math.abs(this.targetX) <= 0.68 && this.vel.z > 5.0) {
              const dtToStumps = Math.max(0.04, (PITCH_HALF_LENGTH - this.pos.z) / this.vel.z);
              const projXAtStumps = this.pos.x + this.vel.x * dtToStumps;
              const maxAllowedStumpX = 0.56;
              if (Math.abs(projXAtStumps) > maxAllowedStumpX) {
                const clampedStumpX = THREE.MathUtils.clamp(projXAtStumps, -maxAllowedStumpX, maxAllowedStumpX);
                this.vel.x = (clampedStumpX - this.pos.x) / dtToStumps;
              }
            }

            // Tilt seam axis after gripping pitch
            this.omega.multiplyScalar(0.55);
            if (callbacks.onPitchBounce) {
              callbacks.onPitchBounce(this.pitchBouncePos, profile.id, localWear);
            }
          } else {
            this.vel.y = Math.abs(this.vel.y) * 0.52;
            this.vel.x *= 0.88;
            this.vel.z *= 0.88;
          }
        } else if (this.state === 'hit') {
          this.bouncedAfterHit = true;
          this.aerialAfterHit = false;
          if (Math.abs(this.vel.y) > 1.2) {
            this.vel.y = Math.abs(this.vel.y) * 0.52;
            this.vel.x *= 0.84;
            this.vel.z *= 0.84;
            if (callbacks.onOutfieldBounce) callbacks.onOutfieldBounce(this.pos);
          } else {
            // Rolling on turf: spin ball forward along velocity vector
            this.vel.y = 0;
            const rollFriction = Math.pow(0.52, subDt);
            this.vel.x *= rollFriction;
            this.vel.z *= rollFriction;
            this.omega.set(this.vel.z * 14, 0, -this.vel.x * 14);
          }
        }
      }

      // Dynamically keep idealContactTime synced with the ball's real post-bounce velocity!
      if (this.state === 'bowled' && this.vel.z > 2.0) {
        const nowSec = performance.now() * 0.001;
        this.idealContactTime = nowSec + (CREASE_Z - this.pos.z) / this.vel.z;
      }

      // Check bat zone entry (striker stands around z = CREASE_Z = 8.84)
      if (this.state === 'bowled' && !this.hasCrossedBatZone && this.pos.z >= CREASE_Z - 1.85) {
        this.hasCrossedBatZone = true;
        this.enteredBatZoneTime = performance.now() * 0.001;
        if (callbacks.onBatZoneEnter) callbacks.onBatZoneEnter(this);
      }

      // Record exact ball coordinates & velocity as it crosses the popping crease (z = CREASE_Z = 8.84)
      if (this.state === 'bowled' && !this.crossedCrease && this.prevPos.z < CREASE_Z && this.pos.z >= CREASE_Z) {
        this.crossedCrease = true;
        const tCrease = (CREASE_Z - this.prevPos.z) / Math.max(0.0001, this.pos.z - this.prevPos.z);
        this.creaseCrossPos.set(
          THREE.MathUtils.lerp(this.prevPos.x, this.pos.x, tCrease),
          THREE.MathUtils.lerp(this.prevPos.y, this.pos.y, tCrease),
          CREASE_Z
        );
        this.creaseCrossVel.copy(this.vel);
        // Waist-high full toss No-Ball check strictly at the popping crease (so Yorkers never falsely trigger No-Ball!)
        if (!this.bouncedOnPitch && this.creaseCrossPos.y > 1.32) {
          this.isNoBall = true;
        }
      }

      // Check Striker Stumps collision (z = +PITCH_HALF_LENGTH = 10.06) for both Bowled and Played-On Inside Edge!
      if (
        (this.state === 'bowled' || (this.state === 'hit' && this.isPlayedOn)) &&
        this.prevPos.z < PITCH_HALF_LENGTH &&
        this.pos.z >= PITCH_HALF_LENGTH
      ) {
        const tStumps = (PITCH_HALF_LENGTH - this.prevPos.z) / Math.max(0.0001, this.pos.z - this.prevPos.z);
        const xAtStumps = THREE.MathUtils.lerp(this.prevPos.x, this.pos.x, tStumps);
        const yAtStumps = THREE.MathUtils.lerp(this.prevPos.y, this.pos.y, tStumps);

        if (
          Math.abs(xAtStumps) <= STUMP_WIDTH * 0.58 + BALL_RADIUS &&
          yAtStumps >= 0 &&
          yAtStumps <= STUMP_HEIGHT + BALL_RADIUS * 1.25
        ) {
          this.pos.set(xAtStumps, Math.min(STUMP_HEIGHT, yAtStumps), PITCH_HALF_LENGTH);
          this.state = 'dead';
          if (callbacks.onStumpsHit) callbacks.onStumpsHit('striker', this.pos);
          return;
        }

        // Only call Wide if the unhit ball passes well outside the wide tramline at both the crease and the stumps
        const creaseXAbs = this.crossedCrease ? Math.abs(this.creaseCrossPos.x) : Math.abs(xAtStumps);
        if (this.state === 'bowled' && Math.abs(xAtStumps) > 0.85 && creaseXAbs > 0.80 && !this.hitPad) {
          this.isWide = true;
        }
      }

      // Check if bowled ball went past keeper without being hit
      if (this.state === 'bowled' && this.pos.z > PITCH_HALF_LENGTH + 5.2) {
        this.state = 'dead';
        if (callbacks.onBallThroughToKeeper) callbacks.onBallThroughToKeeper(this);
        return;
      }

      // Check Boundary Rope (radius = BOUNDARY_RADIUS) when hit
      if (this.state === 'hit') {
        const horizDist = Math.hypot(this.pos.x, this.pos.z);
        this.shotDistance = horizDist;
        if (horizDist >= BOUNDARY_RADIUS) {
          const isSix = !this.bouncedAfterHit && this.pos.y > 0.15;
          this.shotLandingPos.copy(this.pos);
          this.state = 'dead';
          if (callbacks.onBoundary) callbacks.onBoundary(isSix ? 6 : 4, this);
          return;
        }

        if (this.bouncedAfterHit && this.vel.lengthSq() < 0.25) {
          this.vel.set(0, 0, 0);
          this.omega.set(0, 0, 0);
        }
      }
    }

    this.pushTrailPoint();
  }

  /**
   * Evaluates LBW rule at the batter's popping crease (z = CREASE_Z)
   * Returns true if the ball struck the batter's pads in front of the stumps and was projected to hit the wickets.
   */
  checkLBW(batsmanX = 0) {
    if (this.isNoBall || this.isWide) return false;
    const impactPos = this.crossedCrease ? this.creaseCrossPos : this.pos;
    const impactVel = this.crossedCrease ? this.creaseCrossVel : this.vel;

    // Must not pitch outside leg stump
    if (this.bouncedOnPitch && this.pitchBouncePos.x < -0.20) return false;

    // Must impact pad near batter's legs and in line with or just outside off stump
    const distFromLegs = Math.abs(impactPos.x - batsmanX);
    if (distFromLegs > 0.24 || Math.abs(impactPos.x) > 0.22) return false;
    if (impactPos.y > STUMP_HEIGHT + 0.03) return false;

    // Project from crease (8.84m) to stumps (10.06m => dz = 1.22m)
    const remainingZ = Math.max(0.05, PITCH_HALF_LENGTH - impactPos.z);
    const dtToStumps = remainingZ / Math.max(6.0, impactVel.z);
    const projX = impactPos.x + impactVel.x * dtToStumps;
    const projY = impactPos.y + impactVel.y * dtToStumps - 0.5 * 9.81 * dtToStumps * dtToStumps;
    return Math.abs(projX) <= STUMP_WIDTH * 0.58 + BALL_RADIUS && projY >= 0.0 && projY <= STUMP_HEIGHT + 0.03;
  }
}
