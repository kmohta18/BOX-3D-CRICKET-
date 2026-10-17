import * as THREE from 'three';

/**
 * Custom 3D Cricket Ball Physics Engine (physics.js)
 * Implements gravity, aerodynamic drag, Magnus swing/spin curve,
 * surface-dependent pitch bounce, stump/bail collision, LBW, Wide & No-Ball detection.
 */

export const PITCH_HALF_LENGTH = 10.06; // 20.12m total between stumps
export const CREASE_Z = 8.84;           // Popping crease 1.22m in front of stumps
export const STUMP_HEIGHT = 0.71;
export const STUMP_WIDTH = 0.2286;      // 9 inches across 3 stumps
export const BALL_RADIUS = 0.036;       // 3.6cm radius (scaled slightly visually in 3D)
export const BOUNDARY_RADIUS = 52.0;    // Fast-paced arcade stadium boundary

export const SURFACE_PROFILES = {
  street: {
    id: 'street',
    nameEn: 'Street Concrete',
    nameHi: 'गली कंक्रीट',
    restitution: 0.73,
    paceRetention: 0.87,
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
    swingFactor: 1.15,
    seamJitter: 0.028
  },
  night: {
    id: 'night',
    nameEn: 'Night Floodlit Pitch',
    nameHi: 'नाइट स्टेडियम पिच',
    restitution: 0.69,
    paceRetention: 0.85,
    spinGrip: 1.12,
    swingFactor: 1.32,
    seamJitter: 0.02
  }
};

// Pre-allocated vectors for zero-GC physics step
const _vDrag = new THREE.Vector3();
const _vMagnus = new THREE.Vector3();
const _vAccel = new THREE.Vector3();
const _vStep = new THREE.Vector3();

export class BallPhysics {
  constructor() {
    this.pos = new THREE.Vector3(0, 1.9, -CREASE_Z);
    this.prevPos = new THREE.Vector3(0, 1.9, -CREASE_Z);
    this.vel = new THREE.Vector3(0, 0, 0);
    // Spin vector (rad/s): x = topspin/backspin, y = sidespin, z = seam/gyroscope roll
    this.omega = new THREE.Vector3(0, 0, 0);
    this.swingAccelX = 0; // Conventional/reverse swing lateral acceleration

    this.state = 'idle'; // 'idle' | 'runup' | 'bowled' | 'hit' | 'fielded' | 'dead'
    this.surface = 'night';
    this.bouncedOnPitch = false;
    this.bounceCount = 0;
    this.pitchBouncePos = new THREE.Vector3();
    this.hasCrossedBatZone = false;
    this. enteredBatZoneTime = 0;
    this.idealContactTime = 0;

    // Delivery metadata
    this.speedKmh = 0;
    this.bowlerType = 'fast'; // 'fast' | 'medium' | 'spin'
    this.isOverstepNoBall = false;
    this.isWide = false;
    this.isNoBall = false;
    this.hitPad = false;
    this.edged = false;
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

  reset(x = 0.25, y = 2.05, z = -CREASE_Z) {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.swingAccelX = 0;
    this.state = 'idle';
    this.bouncedOnPitch = false;
    this.bounceCount = 0;
    this.hasCrossedBatZone = false;
    this.enteredBatZoneTime = 0;
    this.idealContactTime = 0;
    this.isOverstepNoBall = false;
    this.isWide = false;
    this.isNoBall = false;
    this.hitPad = false;
    this.edged = false;
    this.aerialAfterHit = false;
    this.bouncedAfterHit = false;
    this.shotDistance = 0;
    this.trailCount = 0;
  }

  /**
   * Launches a bowled ball from bowler's hand at release point
   * @param {Object} params
   * @param {number} params.speedKmh - Ball speed in km/h (60 - 155)
   * @param {number} params.targetX - Target line at striker crease (-1.0 to +1.0 m)
   * @param {number} params.bounceZ - Target pitch length Z (-2.0 short to +9.2 yorker)
   * @param {number} params.wristRoll - Roll angle (-1 to +1) for swing / spin
   * @param {string} params.bowlerType - 'fast' | 'medium' | 'spin'
   * @param {boolean} params.overstepped - Whether bowler overstepped popping crease
   */
  launchDelivery({
    speedKmh = 132,
    targetX = 0.0,
    bounceZ = 4.2,
    wristRoll = 0.2,
    bowlerType = 'fast',
    overstepped = false,
    releaseX = 0.32
  }) {
    this.reset(releaseX, 2.08, -CREASE_Z + (overstepped ? 0.35 : -0.05));
    this.state = 'bowled';
    this.speedKmh = THREE.MathUtils.clamp(speedKmh, 58, 158);
    this.bowlerType = bowlerType;
    this.isOverstepNoBall = overstepped;
    this.isNoBall = overstepped;

    const speedMs = (this.speedKmh / 3.6);
    const dzToBounce = Math.max(4.0, bounceZ - this.pos.z);
    const flightTimeToBounce = dzToBounce / (speedMs * 0.96);

    // Calculate vertical velocity so ball hits the pitch at bounceZ
    const gravity = 9.81;
    const vy = (0.04 - this.pos.y + 0.5 * gravity * flightTimeToBounce * flightTimeToBounce) / flightTimeToBounce;

    // Total flight time to crease (z = CREASE_Z)
    const totalDz = CREASE_Z - this.pos.z;
    const totalTime = totalDz / (speedMs * 0.92);

    // Configure swing & spin based on bowler type and wristRoll
    const profile = SURFACE_PROFILES[this.surface] || SURFACE_PROFILES.night;
    if (bowlerType === 'spin') {
      this.swingAccelX = wristRoll * 0.65 * profile.swingFactor; // Subtle drift in air
      // High sidespin (y) + topspin (x)
      this.omega.set(35, wristRoll * 110, wristRoll * 85);
    } else if (bowlerType === 'medium') {
      this.swingAccelX = wristRoll * 2.4 * profile.swingFactor; // Pronounced swing
      this.omega.set(18, wristRoll * 35, wristRoll * 45);
    } else {
      // Fast bowler
      this.swingAccelX = wristRoll * 1.9 * profile.swingFactor;
      this.omega.set(12, wristRoll * 20, wristRoll * 30);
    }

    // Compensate initial X velocity slightly so targetX is where ball aims before late swing/spin
    const vx = (targetX - this.pos.x - 0.25 * this.swingAccelX * flightTimeToBounce * flightTimeToBounce) / totalTime;
    const vz = Math.sqrt(Math.max(10, speedMs * speedMs - vx * vx - vy * vy));

    this.vel.set(vx, vy, vz);

    // Estimate ideal contact timestamp (performance.now() in seconds)
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
   * Step ball physics with sub-stepping for high-speed collision accuracy
   * @param {number} dt - frame delta in seconds
   * @param {Object} callbacks - hooks for onBounce, onStumpsHit, onBoundary, onBatZoneEnter
   */
  update(dt, callbacks = {}) {
    if (this.state === 'idle' || this.state === 'runup' || this.state === 'dead') return;

    const clampedDt = Math.min(dt, 0.05);
    const subSteps = 4;
    const subDt = clampedDt / subSteps;
    const profile = SURFACE_PROFILES[this.surface] || SURFACE_PROFILES.night;

    for (let s = 0; s < subSteps; s++) {
      this.prevPos.copy(this.pos);

      // 1. Gravity
      _vAccel.set(0, -9.81, 0);

      // 2. Aerodynamic drag
      const speed = this.vel.length();
      if (speed > 0.01) {
        const dragCoeff = this.state === 'hit' ? 0.0095 : 0.0065;
        _vDrag.copy(this.vel).multiplyScalar(-dragCoeff * speed);
        _vAccel.add(_vDrag);
      }

      // 3. Magnus & Swing in air before bounce
      if (this.state === 'bowled' && !this.bouncedOnPitch) {
        _vAccel.x += this.swingAccelX;
        // Topspin dip
        _vMagnus.crossVectors(this.omega, this.vel).multiplyScalar(0.00045);
        _vAccel.add(_vMagnus);
      } else if (this.state === 'hit' && !this.bouncedAfterHit) {
        // Subtle loft curve
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
            // Apply surface restitution and pace retention
            this.vel.y = Math.abs(this.vel.y) * profile.restitution;
            this.vel.z *= profile.paceRetention;

            // Apply sharp spin turn or seam movement off the pitch
            const spinDeviation = (this.omega.y * 0.026) * profile.spinGrip;
            const seamVariation = (Math.random() - 0.5) * profile.seamJitter * this.vel.z;
            this.vel.x += spinDeviation + seamVariation;

            // Reduce spin after gripping pitch
            this.omega.multiplyScalar(0.45);
            if (callbacks.onPitchBounce) callbacks.onPitchBounce(this.pitchBouncePos, this.surface);
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
            // Rolling on turf
            this.vel.y = 0;
            const rollFriction = Math.pow(0.52, subDt);
            this.vel.x *= rollFriction;
            this.vel.z *= rollFriction;
          }
        }
      }

      // Check bat zone entry (striker stands around z = CREASE_Z = 8.84)
      if (this.state === 'bowled' && !this.hasCrossedBatZone && this.pos.z >= CREASE_Z - 1.15) {
        this.hasCrossedBatZone = true;
        this.enteredBatZoneTime = performance.now() * 0.001;
        // Waist-high full toss No-Ball check (above 1.08m at crease without bouncing)
        if (!this.bouncedOnPitch && this.pos.y > 1.08) {
          this.isNoBall = true;
        }
        if (callbacks.onBatZoneEnter) callbacks.onBatZoneEnter(this);
      }

      // Check Striker Stumps collision (z = +PITCH_HALF_LENGTH = 10.06)
      if (
        this.state === 'bowled' &&
        this.prevPos.z < PITCH_HALF_LENGTH &&
        this.pos.z >= PITCH_HALF_LENGTH
      ) {
        // Check Wide if ball passes crease outside wide guideline (|x| > 0.78)
        if (Math.abs(this.pos.x) > 0.78 && !this.hitPad) {
          this.isWide = true;
        }
        // Check Stump Hit
        if (
          Math.abs(this.pos.x) <= STUMP_WIDTH * 0.55 + BALL_RADIUS &&
          this.pos.y <= STUMP_HEIGHT + BALL_RADIUS
        ) {
          this.state = 'dead';
          if (callbacks.onStumpsHit) callbacks.onStumpsHit('striker', this.pos);
          return;
        }
      }

      // Check if bowled ball went way past keeper without being hit
      if (this.state === 'bowled' && this.pos.z > PITCH_HALF_LENGTH + 5.5) {
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

        // Stop ball if it comes to rest in the outfield
        if (this.bouncedAfterHit && this.vel.lengthSq() < 0.25) {
          this.vel.set(0, 0, 0);
        }
      }
    }

    this.pushTrailPoint();
  }

  /**
   * Evaluates simple LBW rule if ball strikes batsman's pads
   */
  checkLBW(batsmanX = 0) {
    if (this.isNoBall) return false;
    // 1. Pitched outside leg stump? (For right-hander, leg is negative X < -0.18)
    if (this.bouncedOnPitch && this.pitchBouncePos.x < -0.18) return false;
    // 2. Impact in line with stumps?
    if (Math.abs(this.pos.x) > 0.20) return false;
    // 3. Height below top of stumps at impact?
    if (this.pos.y > STUMP_HEIGHT - 0.02) return false;
    // 4. Projected path hitting the stumps at z = PITCH_HALF_LENGTH
    const remainingZ = Math.max(0.1, PITCH_HALF_LENGTH - this.pos.z);
    const dtToStumps = remainingZ / Math.max(5, this.vel.z);
    const projX = this.pos.x + this.vel.x * dtToStumps;
    const projY = this.pos.y + this.vel.y * dtToStumps - 0.5 * 9.81 * dtToStumps * dtToStumps;
    return Math.abs(projX) <= STUMP_WIDTH * 0.55 && projY >= 0.02 && projY <= STUMP_HEIGHT;
  }
}
