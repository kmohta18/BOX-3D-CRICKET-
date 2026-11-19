import * as THREE from 'three';

/**
 * REALISTIC BATTING SHOT ANIMATIONS (IK-authored)
 * ------------------------------------------------
 * Every shot is described with a handful of key poses (hips, spine, head gaze, feet, bat grip + bat direction).
 * At load time each key pose is converted to bone rotations with:
 *   - two-bone IK for BOTH arms (both gloves stay on the bat handle for the whole shot)
 *   - two-bone IK for BOTH legs (feet stay planted where the batter put them, knees bend naturally)
 *   - head gaze that keeps the eyes on the ball while the body rotates
 * The result is baked into normal THREE.AnimationClips on the same 17-bone mixamorig skeleton the game already uses,
 * so nothing else in the game needs to know about it.
 *
 * Authoring space (right-handed batter, character root space):
 *   off = towards off side, up = height in metres, fwd = towards the bowler.
 *   Left-handed batters are handled by the game mirroring the whole character (scale.x = -1).
 */

const D2R = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const FRAME_DT = 1 / 30;

// ---------- skeleton constants (must match createLowPolyRiggedCharacter / createCartoonRiggedCharacter) ----------
const ARM_OFFSET = { x: 0.24, y: 0.14 }; // arm bone position inside spine1 (x = +/-)
const UPPER_ARM = 0.26; // arm -> forearm bone
const FORE_ARM = 0.23; // forearm -> hand bone
const HIP_JOINT = { x: 0.105, y: -0.05 }; // upLeg bone inside hips
const THIGH = 0.4;
const SHIN = 0.405; // leg bone -> foot (shoe centre)
const HAND_HALF_SPAN = 0.055; // distance between hands on the handle / 2

// ---------- tiny helpers ----------
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const toRoot = (a) => v3(-a[0], a[1], a[2]); // authoring [off, up, fwd] -> root space (x is mirrored: off side = -x)
const eulerYXZ = (yawDeg, pitchDeg, rollDeg) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchDeg * D2R, yawDeg * D2R, rollDeg * D2R, 'YXZ'));

/** Blade direction when the bat swings in a vertical plane. phi: 0 = blade straight down, + = toe goes behind/up, - = toe forward/up. psi: plane direction (0 straight, + off side). */
export function vplane(phiDeg, psiDeg = 0) {
  const p = phiDeg * D2R;
  const s = psiDeg * D2R;
  return [-Math.sin(p) * Math.sin(s), -Math.cos(p), -Math.sin(p) * Math.cos(s)];
}
/** Blade direction by azimuth (0 = towards bowler, + = towards off side, 180 = behind) and tilt below horizontal (90 = straight down, negative = toe up). */
export function hdir(azDeg, tiltDeg) {
  const a = azDeg * D2R;
  const t = tiltDeg * D2R;
  return [Math.sin(a) * Math.cos(t), -Math.sin(t), Math.cos(a) * Math.cos(t)];
}

// ---------- baseline stance pose, every key starts from this and overrides what it needs ----------
const STANCE = {
  hip: [0.0, 0.83, 0.0],
  hy: -55, hp: 12, hr: 0, // hips yaw (negative = chest turned to off side), pitch (lean forward), roll
  ay: 10, ap: 8, ar: 0, // abdomen (spine)
  cy: 10, cp: 4, cr: 0, // chest (spine1)
  gy: 0, gp: 8, // gaze: yaw (0 = bowler), pitch (down)
  g: [0.06, 0.78, 0.2], // bat grip centre
  b: vplane(-12, 10), // bat blade direction
  el: 0.25, // elbow lift 0..1
  hm: 0, // hand mode: 0 = both hands on the bat grip, 1 = hands follow rh / lh targets (bowling, throwing, appeals ...)
  rh: [0.25, 0.9, 0.0], // right-hand target [off, up, fwd] (hand mode)
  lh: [-0.25, 0.9, 0.0], // left-hand target (hand mode)
  ff: [-0.22, 0.062, 0.02, -25, 0], // front (left) foot: off, up, fwd, yaw, toe-down pitch
  bf: [0.22, 0.062, -0.04, -35, 0] // back (right) foot
};

function K(t, o = {}) {
  const k = { t };
  for (const key of Object.keys(STANCE)) {
    const v = o[key] !== undefined ? o[key] : STANCE[key];
    k[key] = Array.isArray(v) ? v.slice() : v;
  }
  return k;
}

// ---------- spline over key poses (non-uniform Catmull-Rom => continuous bat speed through the contact) ----------
function sampleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const h = k2.t - k1.t;
  const u = (t - k1.t) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const out = { t };
  const tang = (a, b, c, d, ta, tb) => {
    // tangent at k1 and k2 (finite differences, zero at the ends)
    return [(b - a) / (tb - ta)];
  };
  const hermite = (p0, p1, p2, p3) => {
    const m1 = k1 === k0 ? 0 : (p2 - p0) / (k2.t - k0.t);
    const m2 = k3 === k2 ? 0 : (p3 - p1) / (k3.t - k1.t);
    return h00 * p1 + h10 * h * m1 + h01 * p2 + h11 * h * m2;
  };
  for (const key of Object.keys(STANCE)) {
    const a0 = k0[key];
    const a1 = k1[key];
    const a2 = k2[key];
    const a3 = k3[key];
    if (Array.isArray(a1)) out[key] = a1.map((_, j) => hermite(a0[j], a1[j], a2[j], a3[j]));
    else out[key] = hermite(a0, a1, a2, a3);
  }
  void tang;
  return out;
}

// ---------- dummy skeleton used only to solve poses ----------
function makeRig() {
  const o = (n) => {
    const g = new THREE.Object3D();
    g.name = n;
    return g;
  };
  const rig = {
    hips: o('hips'), spine: o('spine'), spine1: o('spine1'), head: o('head'),
    rArm: o('rArm'), rFore: o('rFore'), rHand: o('rHand'), lArm: o('lArm'), lFore: o('lFore'), lHand: o('lHand'),
    rUp: o('rUp'), rLeg: o('rLeg'), rFoot: o('rFoot'), lUp: o('lUp'), lLeg: o('lLeg'), lFoot: o('lFoot')
  };
  const { hips, spine, spine1, head } = rig;
  hips.add(spine);
  spine.position.set(0, 0.1, 0);
  spine.add(spine1);
  spine1.position.set(0, 0.24, 0);
  spine1.add(head);
  head.position.set(0, 0.28, 0);
  spine1.add(rig.rArm);
  rig.rArm.position.set(-ARM_OFFSET.x, ARM_OFFSET.y, 0);
  spine1.add(rig.lArm);
  rig.lArm.position.set(ARM_OFFSET.x, ARM_OFFSET.y, 0);
  [['rArm', 'rFore', 'rHand'], ['lArm', 'lFore', 'lHand']].forEach(([a, f, h]) => {
    rig[a].add(rig[f]);
    rig[f].position.set(0, -UPPER_ARM, 0);
    rig[f].add(rig[h]);
    rig[h].position.set(0, -FORE_ARM, 0);
  });
  hips.add(rig.rUp);
  rig.rUp.position.set(-HIP_JOINT.x, HIP_JOINT.y, 0);
  hips.add(rig.lUp);
  rig.lUp.position.set(HIP_JOINT.x, HIP_JOINT.y, 0);
  [['rUp', 'rLeg', 'rFoot'], ['lUp', 'lLeg', 'lFoot']].forEach(([u, l, f]) => {
    rig[u].add(rig[l]);
    rig[l].position.set(0, -THIGH, 0);
    rig[l].add(rig[f]);
    rig[f].position.set(0, -SHIN, 0);
  });
  return rig;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

/** Two-bone IK. Rotates `upper` (child `lower` at lowerPos) so the end effector reaches target. All positions world/root space. */
function solveTwoBone(upper, lower, end, targetW, poleW, len1, len2) {
  upper.updateWorldMatrix(true, false);
  const root = v3();
  upper.getWorldPosition(root);
  const toT = targetW.clone().sub(root);
  let d = toT.length();
  const maxReach = len1 + len2 - 1e-4;
  const minReach = Math.abs(len1 - len2) + 1e-3;
  d = THREE.MathUtils.clamp(d, minReach, maxReach);
  const axis = toT.normalize();
  const x = (len1 * len1 - len2 * len2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, len1 * len1 - x * x));
  const pole = poleW.clone().sub(axis.clone().multiplyScalar(poleW.dot(axis)));
  if (pole.lengthSq() < 1e-6) pole.set(0, 0, 1);
  pole.normalize();
  const elbow = root.clone().add(axis.clone().multiplyScalar(x)).add(pole.multiplyScalar(h));
  const targetClamped = root.clone().add(axis.clone().multiplyScalar(d));

  // upper bone: rotate (0,-1,0) to the direction root->elbow, expressed in the parent frame
  const parentQ = new THREE.Quaternion();
  upper.parent.getWorldQuaternion(parentQ);
  const dir1 = elbow.clone().sub(root).normalize().applyQuaternion(_qi.copy(parentQ).invert());
  upper.quaternion.setFromUnitVectors(DOWN, dir1);
  upper.updateWorldMatrix(true, true);

  // lower bone
  const upperQ = new THREE.Quaternion();
  upper.getWorldQuaternion(upperQ);
  const dir2 = targetClamped.clone().sub(elbow).normalize().applyQuaternion(_qi.copy(upperQ).invert());
  lower.quaternion.setFromUnitVectors(DOWN, dir2);
  lower.updateWorldMatrix(true, true);
  void end;
}

function applyPose(rig, p) {
  const { hips, spine, spine1, head } = rig;

  hips.position.set(-p.hip[0], p.hip[1], p.hip[2]);
  hips.quaternion.copy(eulerYXZ(p.hy, p.hp, p.hr));
  spine.quaternion.copy(eulerYXZ(p.ay, p.ap, p.ar));
  spine1.quaternion.copy(eulerYXZ(p.cy, p.cp, p.cr));
  hips.updateMatrixWorld(true);

  // ---- head: look at the ball regardless of how far the shoulders turned ----
  const desired = eulerYXZ(-p.gy, p.gp, 0); // gaze yaw is authored off-side-positive
  const s1q = new THREE.Quaternion();
  spine1.getWorldQuaternion(s1q);
  head.quaternion.copy(s1q.invert().multiply(desired));

  // ---- arms: both gloves on the handle ----
  const blade = toRoot(p.b).normalize();
  const gripC = toRoot(p.g);
  const topHand = gripC.clone().addScaledVector(blade, -HAND_HALF_SPAN); // left hand (top of handle)
  const botHand = gripC.clone().addScaledVector(blade, HAND_HALF_SPAN); // right hand (bottom)
  spine1.getWorldQuaternion(s1q);
  const elbowPole = (side) => {
    const e = THREE.MathUtils.clamp(p.el, 0, 1);
    return v3(side * (0.45 + 0.9 * e), -0.85 + 1.5 * e, -0.15).applyQuaternion(s1q);
  };
  const free = p.hm > 0.5;
  solveTwoBone(rig.lArm, rig.lFore, rig.lHand, free ? toRoot(p.lh) : topHand, elbowPole(1), UPPER_ARM, FORE_ARM);
  solveTwoBone(rig.rArm, rig.rFore, rig.rHand, free ? toRoot(p.rh) : botHand, elbowPole(-1), UPPER_ARM, FORE_ARM);

  // ---- legs: feet planted on the ground wherever the footwork says ----
  const hq = new THREE.Quaternion();
  hips.getWorldQuaternion(hq);
  const kneePole = (side) => v3(side * 0.25, -0.1, 1).applyQuaternion(hq);
  const footTarget = (f) => toRoot([f[0], f[1], f[2]]);
  solveTwoBone(rig.lUp, rig.lLeg, rig.lFoot, footTarget(p.ff), kneePole(1), THIGH, SHIN);
  solveTwoBone(rig.rUp, rig.rLeg, rig.rFoot, footTarget(p.bf), kneePole(-1), THIGH, SHIN);

  // foot orientation: flat on the ground, pointing along its yaw (toes can lift/drop via pitch)
  [['lLeg', 'lFoot', p.ff], ['rLeg', 'rFoot', p.bf]].forEach(([leg, foot, f]) => {
    const lq = new THREE.Quaternion();
    rig[leg].getWorldQuaternion(lq);
    const want = _q.copy(eulerYXZ(f[3], f[4], 0));
    rig[foot].quaternion.copy(lq.invert().multiply(want));
  });
  hips.updateMatrixWorld(true);
}

const BONES = [
  ['mixamorigSpine', 'spine'], ['mixamorigSpine1', 'spine1'], ['mixamorigHead', 'head'],
  ['mixamorigRightArm', 'rArm'], ['mixamorigRightForeArm', 'rFore'],
  ['mixamorigLeftArm', 'lArm'], ['mixamorigLeftForeArm', 'lFore'],
  ['mixamorigRightUpLeg', 'rUp'], ['mixamorigRightLeg', 'rLeg'],
  ['mixamorigLeftUpLeg', 'lUp'], ['mixamorigLeftLeg', 'lLeg'],
  ['mixamorigRightFoot', 'rFoot'], ['mixamorigLeftFoot', 'lFoot'],
  ['mixamorigHips', 'hips']
];

/** Bakes a list of key poses into an AnimationClip. */
export function bakeShotClip(name, duration, keys) {
  const rig = makeRig();
  const n = Math.max(2, Math.round(duration / FRAME_DT) + 1);
  const times = [];
  const quat = {};
  BONES.forEach(([bn]) => (quat[bn] = []));
  const hipPos = [];
  let prev = {};
  for (let i = 0; i < n; i++) {
    const t = Math.min(duration, i * FRAME_DT);
    times.push(t);
    applyPose(rig, sampleKeys(keys, t));
    BONES.forEach(([bn, rn]) => {
      const q = rig[rn].quaternion.clone();
      const pq = prev[bn];
      if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); // keep the shortest path
      prev[bn] = q;
      quat[bn].push(q.x, q.y, q.z, q.w);
    });
    hipPos.push(rig.hips.position.x, rig.hips.position.y, rig.hips.position.z);
  }
  const tracks = [new THREE.VectorKeyframeTrack('mixamorigHips.position', times, hipPos)];
  BONES.forEach(([bn]) => tracks.push(new THREE.QuaternionKeyframeTrack(`${bn}.quaternion`, times, quat[bn])));
  return new THREE.AnimationClip(name, duration, tracks);
}

// =====================================================================================================
//  SHOT DEFINITIONS  (times are clip seconds; the bat meets the ball at ~0.30s)
// =====================================================================================================

/** Stance: calm side-on set-up with a small rhythmic bat tap & knee flex (loops). */
function stanceKeys() {
  const tap = (t, dy, dz, dh) =>
    K(t, { hip: [0, 0.83 + dh, 0], g: [0.06, 0.78 + dy, 0.2 + dz], b: vplane(-12 - dz * 40, 10) });
  return [tap(0, 0, 0, 0), tap(0.4, 0.07, -0.02, -0.006), tap(0.8, 0.0, 0, 0), tap(1.2, 0.05, -0.015, -0.004), tap(1.6, 0, 0, 0)];
}

/** Forward drive. psi: shot direction (0 straight, + cover/off side, - on side). */
function driveKeys(psi = 8, aggression = 1) {
  const off = Math.sin(psi * D2R);
  return [
    K(0),
    // trigger: weight rocks back, bat goes up & back, front foot starts to lift
    K(0.13, {
      hip: [0, 0.82, -0.04], hy: -60, hp: 9, ay: 8, cy: 6, gp: 6,
      g: [0.1, 1.06, 0.0], b: vplane(120, psi), el: 0.6,
      ff: [-0.22, 0.1, 0.1, -25, 0], bf: [0.22, 0.062, -0.06, -35, 0]
    }),
    // big stride, head leads, bat loops down
    K(0.23, {
      hip: [0.02 + off * 0.05, 0.78, 0.2], hy: -48, hp: 16, ay: 12, cy: 14, gp: 20,
      g: [0.14 + off * 0.1, 1.08, 0.12], b: vplane(70, psi), el: 0.85,
      ff: [-0.16 + off * 0.1, 0.075, 0.45, -18 + psi * 0.2, 0], bf: [0.22, 0.062, -0.08, -40, 0]
    }),
    // contact: front foot planted, head over the ball, bat in front of the pad, high elbow
    K(0.3, {
      hip: [0.04 + off * 0.08, 0.72, 0.34], hy: -36, hp: 22, ay: 16, cy: 22, gy: off * 20, gp: 34,
      g: [0.16 + off * 0.22, 0.84, 0.56 + 0.06 * aggression], b: vplane(-6, psi), el: 0.9,
      ff: [-0.12 + off * 0.12, 0.062, 0.62, -12 + psi * 0.3, 0], bf: [0.24, 0.1, -0.1, -45, 40]
    }),
    // extension & follow-through: arms extend through the line then fold over the front shoulder
    K(0.44, {
      hip: [0.04 + off * 0.08, 0.76, 0.34], hy: -24, hp: 16, ay: 22, cy: 32, gy: off * 30, gp: 22,
      g: [0.2 + off * 0.3, 1.12, 0.58], b: vplane(-70, psi + 10), el: 0.8,
      ff: [-0.12 + off * 0.12, 0.062, 0.62, -12, 0], bf: [0.24, 0.1, -0.1, -45, 40]
    }),
    K(0.62, {
      hip: [0.04, 0.78, 0.32], hy: -16, hp: 12, ay: 26, cy: 38, gy: off * 20, gp: 12,
      g: [0.2 + off * 0.2, 1.34, 0.36], b: vplane(-130, psi + 18), el: 0.6,
      ff: [-0.12 + off * 0.12, 0.062, 0.6, -10, 0], bf: [0.24, 0.1, -0.1, -45, 38]
    }),
    K(0.9, {
      hip: [0.03, 0.8, 0.3], hy: -14, hp: 10, ay: 24, cy: 34, gy: 0, gp: 4,
      g: [0.2 + off * 0.2, 1.38, 0.3], b: vplane(-150, psi + 22), el: 0.5,
      ff: [-0.12 + off * 0.12, 0.062, 0.6, -10, 0], bf: [0.24, 0.1, -0.1, -45, 36]
    })
  ];
}

/** Soft-handed forward defence: bat stays vertical, head over the ball, no follow-through. */
function defenceKeys() {
  return [
    K(0),
    K(0.12, { hip: [0, 0.82, -0.02], hy: -58, g: [0.07, 0.98, 0.06], b: vplane(55, 0), el: 0.55, ff: [-0.22, 0.08, 0.08, -25, 0] }),
    K(0.22, {
      hip: [0.0, 0.77, 0.16], hy: -52, hp: 18, cy: 12, gp: 28, g: [0.06, 0.9, 0.26], b: vplane(20, 0), el: 0.8,
      ff: [-0.2, 0.07, 0.32, -22, 0]
    }),
    K(0.3, {
      hip: [0.0, 0.74, 0.24], hy: -48, hp: 22, cy: 14, gp: 40, g: [0.05, 0.78, 0.42], b: vplane(-4, 0), el: 0.9,
      ff: [-0.2, 0.062, 0.46, -20, 0], bf: [0.22, 0.062, -0.06, -38, 20]
    }),
    K(0.44, {
      hip: [0.0, 0.75, 0.24], hy: -48, hp: 20, cy: 14, gp: 34, g: [0.05, 0.8, 0.4], b: vplane(0, 0), el: 0.8,
      ff: [-0.2, 0.062, 0.46, -20, 0], bf: [0.22, 0.062, -0.06, -38, 20]
    }),
    K(0.75, {
      hip: [0.0, 0.78, 0.18], hy: -52, hp: 16, cy: 10, gp: 22, g: [0.06, 0.86, 0.32], b: vplane(8, 0), el: 0.5,
      ff: [-0.2, 0.062, 0.4, -22, 0], bf: [0.22, 0.062, -0.05, -36, 8]
    })
  ];
}

/** Lofted drive / big hit: long stride, hips open, arms fully extended, high finish. */
function loftKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0, 0.8, -0.08], hy: -62, hp: 8, ay: 6, cy: 4, gp: 4, g: [0.1, 1.14, -0.04], b: vplane(135, 4), el: 0.7,
      ff: [-0.22, 0.12, 0.08, -25, 0], bf: [0.24, 0.062, -0.08, -35, 0]
    }),
    K(0.24, {
      hip: [0.0, 0.76, 0.2], hy: -44, hp: 14, ay: 10, cy: 14, gp: 18, g: [0.1, 1.2, 0.1], b: vplane(80, 4), el: 0.9,
      ff: [-0.16, 0.08, 0.5, -15, 0], bf: [0.26, 0.062, -0.12, -42, 0]
    }),
    K(0.31, {
      hip: [0.02, 0.7, 0.36], hy: -30, hp: 20, ay: 18, cy: 24, gp: 30, g: [0.12, 0.92, 0.7], b: vplane(-22, 4), el: 0.95,
      ff: [-0.14, 0.062, 0.68, -10, 0], bf: [0.26, 0.11, -0.14, -48, 46]
    }),
    K(0.44, {
      hip: [0.02, 0.76, 0.34], hy: -16, hp: 6, ay: 28, cy: 36, gp: 6, g: [0.12, 1.3, 0.52], b: vplane(-100, 6), el: 0.8,
      ff: [-0.14, 0.062, 0.68, -8, 0], bf: [0.26, 0.11, -0.14, -48, 46]
    }),
    K(0.62, {
      hip: [0.02, 0.82, 0.3], hy: -6, hp: -4, ay: 30, cy: 40, gp: -4, g: [0.16, 1.5, 0.3], b: vplane(-160, 12), el: 0.7,
      ff: [-0.14, 0.062, 0.66, -8, 0], bf: [0.26, 0.12, -0.14, -48, 50]
    }),
    K(0.92, {
      hip: [0.02, 0.84, 0.26], hy: -4, hp: -4, ay: 30, cy: 40, gp: -2, g: [0.16, 1.52, 0.24], b: vplane(-165, 14), el: 0.6,
      ff: [-0.14, 0.062, 0.64, -8, 0], bf: [0.26, 0.12, -0.14, -48, 50]
    })
  ];
}

/** Square / late cut: step back & across, bat comes down from high and slices out to the off side. */
function cutKeys() {
  return [
    K(0),
    K(0.14, {
      hip: [0.04, 0.8, -0.14], hy: -70, hp: 10, ay: 8, cy: 4, gy: 8, gp: 12, g: [0.14, 1.12, -0.06], b: vplane(125, 25), el: 0.7,
      ff: [-0.2, 0.062, 0.02, -25, 0], bf: [0.2, 0.09, -0.2, -50, 0]
    }),
    K(0.24, {
      hip: [0.1, 0.76, -0.14], hy: -82, hp: 14, ay: 6, cy: 4, gy: 18, gp: 26, g: [0.34, 1.12, 0.0], b: hdir(150, -20), el: 0.9,
      ff: [-0.2, 0.062, 0.04, -28, 0], bf: [0.34, 0.062, -0.28, -75, 0]
    }),
    K(0.31, {
      hip: [0.14, 0.74, -0.12], hy: -88, hp: 14, ay: 4, cy: 8, gy: 26, gp: 34, g: [0.58, 0.96, 0.1], b: hdir(72, 38), el: 0.95,
      ff: [-0.2, 0.062, 0.04, -28, 0], bf: [0.36, 0.062, -0.28, -80, 0]
    }),
    K(0.44, {
      hip: [0.14, 0.76, -0.1], hy: -80, hp: 10, ay: 14, cy: 20, gy: 36, gp: 22, g: [0.56, 1.14, 0.16], b: hdir(100, -25), el: 0.8,
      ff: [-0.2, 0.062, 0.04, -28, 0], bf: [0.36, 0.062, -0.28, -80, 0]
    }),
    K(0.62, {
      hip: [0.12, 0.78, -0.1], hy: -72, hp: 8, ay: 16, cy: 24, gy: 40, gp: 12, g: [0.46, 1.34, 0.12], b: hdir(130, -50), el: 0.7,
      ff: [-0.2, 0.062, 0.04, -28, 0], bf: [0.36, 0.062, -0.28, -80, 0]
    }),
    K(0.9, {
      hip: [0.1, 0.8, -0.08], hy: -68, hp: 8, ay: 14, cy: 20, gy: 30, gp: 8, g: [0.4, 1.36, 0.1], b: hdir(140, -55), el: 0.6,
      ff: [-0.2, 0.062, 0.04, -28, 0], bf: [0.34, 0.062, -0.26, -76, 0]
    })
  ];
}

/** Pull shot: rocks back and across, whole body rotates through square leg, cross-bat sweeps horizontally. */
function pullKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0.0, 0.82, -0.12], hy: -64, hp: 8, ay: 8, cy: 6, gy: -4, gp: 6, g: [0.14, 1.12, -0.08], b: vplane(118, 20), el: 0.75,
      ff: [-0.2, 0.062, 0.02, -25, 0], bf: [0.2, 0.08, -0.16, -40, 0]
    }),
    K(0.23, {
      hip: [0.0, 0.8, -0.16], hy: -70, hp: 8, ay: 14, cy: 14, gy: -6, gp: 12, g: [0.34, 1.22, -0.02], b: hdir(150, -8), el: 1.0,
      ff: [-0.18, 0.07, 0.08, -10, 0], bf: [0.3, 0.062, -0.24, -60, 0]
    }),
    K(0.31, {
      hip: [-0.04, 0.78, -0.12], hy: -4, hp: 10, ay: 28, cy: 34, gy: -24, gp: 18, g: [-0.14, 1.14, 0.44], b: hdir(-2, 18), el: 0.95,
      ff: [-0.2, 0.07, 0.08, 20, 0], bf: [0.3, 0.062, -0.24, 10, 14]
    }),
    K(0.44, {
      hip: [-0.06, 0.8, -0.1], hy: 40, hp: 6, ay: 32, cy: 40, gy: -50, gp: 8, g: [-0.34, 1.28, 0.34], b: hdir(-70, 8), el: 0.8,
      ff: [-0.2, 0.07, 0.08, 40, 0], bf: [0.3, 0.07, -0.24, 30, 20]
    }),
    K(0.62, {
      hip: [-0.06, 0.82, -0.08], hy: 52, hp: 4, ay: 30, cy: 40, gy: -60, gp: 4, g: [-0.3, 1.46, 0.1], b: hdir(-110, -30), el: 0.7,
      ff: [-0.2, 0.062, 0.08, 45, 0], bf: [0.3, 0.07, -0.24, 40, 22]
    }),
    K(0.9, {
      hip: [-0.05, 0.84, -0.08], hy: 50, hp: 4, ay: 28, cy: 36, gy: -50, gp: 2, g: [-0.26, 1.48, 0.08], b: hdir(-120, -40), el: 0.6,
      ff: [-0.2, 0.062, 0.08, 45, 0], bf: [0.3, 0.07, -0.24, 40, 22]
    })
  ];
}

/** Leg flick / glance: wristy, across the front pad, bat finishes near the hip. */
function flickKeys(behind = 0) {
  return [
    K(0),
    K(0.13, {
      hip: [0, 0.82, -0.04], hy: -58, g: [0.1, 1.0, 0.02], b: vplane(100, 5), el: 0.6,
      ff: [-0.22, 0.1, 0.1, -25, 0], bf: [0.22, 0.062, -0.06, -35, 0]
    }),
    K(0.24, {
      hip: [-0.04, 0.78, 0.16], hy: -44, hp: 16, ay: 14, cy: 18, gy: -6, gp: 22, g: [0.0, 1.02, 0.28], b: hdir(160, 30), el: 0.8,
      ff: [-0.3, 0.07, 0.42, -2, 0], bf: [0.24, 0.062, -0.1, -36, 0]
    }),
    K(0.31, {
      hip: [-0.1, 0.74, 0.28], hy: -22 + behind * 8, hp: 20, ay: 24, cy: 30, gy: -14, gp: 30, g: [-0.22, 0.88, 0.52 - behind * 0.2], b: hdir(-30 - behind * 40, 50), el: 0.9,
      ff: [-0.36, 0.062, 0.54, 5, 0], bf: [0.24, 0.1, -0.12, -40, 34]
    }),
    K(0.44, {
      hip: [-0.1, 0.76, 0.28], hy: 0 + behind * 8, hp: 14, ay: 30, cy: 38, gy: -36, gp: 18, g: [-0.38, 1.0, 0.4 - behind * 0.2], b: hdir(-80 - behind * 30, 30), el: 0.8,
      ff: [-0.36, 0.062, 0.54, 10, 0], bf: [0.24, 0.1, -0.12, -40, 34]
    }),
    K(0.64, {
      hip: [-0.08, 0.8, 0.24], hy: 10, hp: 10, ay: 30, cy: 40, gy: -30, gp: 8, g: [-0.36, 1.18, 0.3], b: hdir(-100, 0), el: 0.6,
      ff: [-0.36, 0.062, 0.54, 10, 0], bf: [0.24, 0.1, -0.12, -40, 30]
    }),
    K(0.9, {
      hip: [-0.06, 0.82, 0.2], hy: 8, hp: 8, ay: 28, cy: 36, gy: -20, gp: 4, g: [-0.32, 1.2, 0.26], b: hdir(-105, 0), el: 0.5,
      ff: [-0.34, 0.062, 0.5, 8, 0], bf: [0.24, 0.1, -0.12, -40, 28]
    })
  ];
}

/** Sweep / reverse sweep: front leg out, back knee almost on the ground, bat sweeps low. side: +1 reverse (off side), -1 conventional (leg side). */
function sweepKeys(side = -1) {
  const s = side;
  return [
    K(0),
    K(0.14, {
      hip: [0, 0.76, 0.06], hy: -58, hp: 20, ay: 8, cy: 8, gp: 18, g: [0.1, 0.98, 0.1], b: vplane(80, 5), el: 0.6,
      ff: [-0.22, 0.062, 0.16, -25, 0], bf: [0.22, 0.062, -0.1, -40, 0]
    }),
    K(0.24, {
      hip: [0.0, 0.58, 0.22], hy: -50, hp: 30, ay: 10, cy: 14, gy: s * 6, gp: 34, g: [0.04 + s * -0.08, 0.7, 0.3], b: hdir(s < 0 ? 170 : 170, 10), el: 0.85,
      ff: [-0.24 + (s > 0 ? 0.2 : 0), 0.062, 0.62, -12, 0], bf: [0.22, 0.09, -0.2, -42, 62]
    }),
    K(0.31, {
      hip: [0.0, 0.5, 0.3], hy: s < 0 ? -34 : -62, hp: 36, ay: s < 0 ? 22 : -14, cy: s < 0 ? 28 : -18, gy: s * 12, gp: 42,
      g: [s < 0 ? -0.2 : 0.3, 0.5, 0.58], b: hdir(s < 0 ? -22 : 24, 28), el: 0.9,
      ff: [-0.26 + (s > 0 ? 0.2 : 0), 0.062, 0.7, -10, 0], bf: [0.2, 0.09, -0.2, -42, 66]
    }),
    K(0.46, {
      hip: [0.0, 0.52, 0.3], hy: s < 0 ? -18 : -76, hp: 32, ay: s < 0 ? 28 : -22, cy: s < 0 ? 36 : -28, gy: s * 22, gp: 34,
      g: [s < 0 ? -0.36 : 0.42, 0.62, 0.44], b: hdir(s < 0 ? -80 : 80, 22), el: 0.8,
      ff: [-0.26 + (s > 0 ? 0.2 : 0), 0.062, 0.7, -10, 0], bf: [0.2, 0.09, -0.2, -42, 66]
    }),
    K(0.7, {
      hip: [0.0, 0.62, 0.28], hy: s < 0 ? -10 : -80, hp: 22, ay: s < 0 ? 26 : -22, cy: s < 0 ? 34 : -26, gy: s * 20, gp: 22,
      g: [s < 0 ? -0.34 : 0.4, 0.84, 0.34], b: hdir(s < 0 ? -105 : 105, 0), el: 0.6,
      ff: [-0.26 + (s > 0 ? 0.2 : 0), 0.062, 0.66, -10, 0], bf: [0.2, 0.09, -0.2, -42, 60]
    }),
    K(0.95, {
      hip: [0.0, 0.68, 0.26], hy: s < 0 ? -10 : -80, hp: 18, ay: s < 0 ? 24 : -20, cy: s < 0 ? 30 : -24, gy: s * 16, gp: 12,
      g: [s < 0 ? -0.3 : 0.36, 0.9, 0.3], b: hdir(s < 0 ? -105 : 105, 0), el: 0.5,
      ff: [-0.26 + (s > 0 ? 0.2 : 0), 0.062, 0.62, -10, 0], bf: [0.2, 0.09, -0.2, -42, 56]
    })
  ];
}

/** Scoop (dilscoop): drops low, bat scoops under a full ball and flicks it over the shoulder. */
function scoopKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0, 0.8, -0.02], hy: -60, hp: 10, gp: 12, g: [0.08, 0.92, 0.1], b: vplane(70, -5), el: 0.6,
      ff: [-0.22, 0.062, 0.1, -25, 0], bf: [0.22, 0.062, -0.06, -35, 0]
    }),
    K(0.24, {
      hip: [0.06, 0.62, 0.12], hy: -64, hp: 22, ay: 6, cy: 6, gy: 6, gp: 32, g: [0.04, 0.62, 0.32], b: vplane(25, -10), el: 0.7,
      ff: [-0.26, 0.062, 0.4, -10, 0], bf: [0.34, 0.062, -0.24, -60, 20]
    }),
    K(0.31, {
      hip: [0.1, 0.56, 0.16], hy: -64, hp: 18, ay: 8, cy: 10, gy: 8, gp: 40, g: [0.0, 0.5, 0.42], b: vplane(-4, -8), el: 0.85,
      ff: [-0.28, 0.062, 0.46, -10, 0], bf: [0.36, 0.062, -0.24, -64, 24]
    }),
    K(0.44, {
      hip: [0.1, 0.62, 0.06], hy: -66, hp: 8, ay: 10, cy: 14, gy: 14, gp: 22, g: [-0.05, 0.96, 0.26], b: vplane(-85, -10), el: 0.8,
      ff: [-0.28, 0.062, 0.44, -10, 0], bf: [0.36, 0.062, -0.24, -64, 24]
    }),
    K(0.66, {
      hip: [0.08, 0.7, 0.0], hy: -62, hp: 0, ay: 10, cy: 16, gy: 20, gp: 6, g: [-0.1, 1.3, 0.1], b: vplane(-140, -10), el: 0.7,
      ff: [-0.26, 0.062, 0.42, -10, 0], bf: [0.34, 0.062, -0.22, -62, 20]
    }),
    K(0.95, {
      hip: [0.06, 0.74, 0.0], hy: -60, hp: 0, ay: 10, cy: 16, gy: 18, gp: 0, g: [-0.1, 1.36, 0.06], b: vplane(-150, -10), el: 0.6,
      ff: [-0.26, 0.062, 0.4, -10, 0], bf: [0.32, 0.062, -0.2, -60, 16]
    })
  ];
}

/** Ramp / upper cut: crouches under the bouncer and guides it over the keeper with a short, punchy upward arc. */
function rampKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0, 0.8, -0.1], hy: -64, hp: 8, gp: 4, g: [0.12, 1.08, -0.04], b: vplane(125, 10), el: 0.7,
      ff: [-0.2, 0.062, 0.0, -25, 0], bf: [0.22, 0.08, -0.14, -40, 0]
    }),
    K(0.24, {
      hip: [0.06, 0.72, -0.16], hy: -72, hp: 4, ay: 4, cy: -2, gy: 4, gp: -6, g: [0.26, 1.18, 0.02], b: vplane(120, 18), el: 1.0,
      ff: [-0.2, 0.062, 0.02, -28, 0], bf: [0.3, 0.062, -0.22, -65, 0]
    }),
    K(0.3, {
      hip: [0.08, 0.7, -0.14], hy: -72, hp: -2, ay: 2, cy: -6, gy: 6, gp: -10, g: [0.34, 1.34, 0.08], b: vplane(98, 28), el: 1.0,
      ff: [-0.2, 0.062, 0.02, -28, 0], bf: [0.32, 0.062, -0.22, -68, 0]
    }),
    K(0.44, {
      hip: [0.08, 0.74, -0.12], hy: -68, hp: 4, ay: 10, cy: 14, gy: 14, gp: -4, g: [0.4, 1.42, 0.16], b: vplane(70, 35), el: 0.9,
      ff: [-0.2, 0.062, 0.02, -28, 0], bf: [0.32, 0.062, -0.22, -68, 0]
    }),
    K(0.66, {
      hip: [0.08, 0.78, -0.1], hy: -66, hp: 8, ay: 12, cy: 18, gy: 10, gp: 0, g: [0.36, 1.3, 0.14], b: vplane(60, 35), el: 0.7,
      ff: [-0.2, 0.062, 0.02, -28, 0], bf: [0.32, 0.062, -0.22, -66, 0]
    }),
    K(0.9, {
      hip: [0.06, 0.8, -0.08], hy: -62, hp: 8, ay: 12, cy: 16, gy: 6, gp: 4, g: [0.3, 1.2, 0.12], b: vplane(50, 30), el: 0.6,
      ff: [-0.2, 0.062, 0.02, -26, 0], bf: [0.3, 0.062, -0.2, -62, 0]
    })
  ];
}

/** Back-foot punch: for short-of-a-length balls. Weight goes back, tall and compact, bat meets the ball beside the body. */
function punchKeys() {
  return [
    K(0),
    K(0.13, { hip: [0, 0.82, -0.08], hy: -62, hp: 8, gp: 8, g: [0.1, 1.04, -0.02], b: vplane(110, 6), el: 0.7,
      ff: [-0.22, 0.062, 0.0, -25, 0], bf: [0.22, 0.062, -0.1, -35, 0] }),
    K(0.24, { hip: [0.02, 0.8, -0.14], hy: -66, hp: 10, ay: 8, cy: 8, gp: 16, g: [0.18, 1.06, 0.06], b: vplane(60, 10), el: 0.9,
      ff: [-0.2, 0.062, 0.04, -25, 0], bf: [0.26, 0.062, -0.24, -50, 0] }),
    K(0.31, { hip: [0.04, 0.78, -0.12], hy: -56, hp: 12, ay: 12, cy: 16, gp: 24, g: [0.22, 0.98, 0.32], b: vplane(0, 10), el: 0.95,
      ff: [-0.2, 0.062, 0.06, -22, 0], bf: [0.26, 0.062, -0.24, -52, 0] }),
    K(0.46, { hip: [0.04, 0.8, -0.1], hy: -46, hp: 8, ay: 20, cy: 26, gp: 14, g: [0.26, 1.2, 0.34], b: vplane(-60, 14), el: 0.8,
      ff: [-0.2, 0.062, 0.06, -22, 0], bf: [0.26, 0.062, -0.24, -52, 0] }),
    K(0.9, { hip: [0.03, 0.82, -0.08], hy: -44, hp: 6, ay: 20, cy: 26, gp: 6, g: [0.26, 1.3, 0.28], b: vplane(-100, 14), el: 0.6,
      ff: [-0.2, 0.062, 0.06, -22, 0], bf: [0.26, 0.062, -0.24, -52, 0] })
  ];
}

/** Dig-out: for yorkers. Drops low, bat jammed down on the toes, head right over it. */
function digKeys() {
  return [
    K(0),
    K(0.12, { hip: [0, 0.8, 0.0], hy: -58, hp: 12, gp: 12, g: [0.08, 0.9, 0.06], b: vplane(50, 0), el: 0.5, ff: [-0.22, 0.062, 0.04, -25, 0] }),
    K(0.22, { hip: [0, 0.68, 0.1], hy: -54, hp: 26, ay: 8, cy: 12, gp: 40, g: [0.1, 0.62, 0.22], b: vplane(14, 0), el: 0.6,
      ff: [-0.2, 0.062, 0.24, -22, 0], bf: [0.22, 0.062, -0.1, -38, 10] }),
    K(0.3, { hip: [0, 0.62, 0.12], hy: -52, hp: 32, ay: 10, cy: 14, gp: 50, g: [0.1, 0.46, 0.3], b: vplane(-2, 0), el: 0.7,
      ff: [-0.2, 0.062, 0.3, -22, 0], bf: [0.22, 0.062, -0.1, -38, 14] }),
    K(0.5, { hip: [0, 0.64, 0.12], hy: -52, hp: 30, ay: 10, cy: 14, gp: 44, g: [0.1, 0.5, 0.3], b: vplane(0, 0), el: 0.6,
      ff: [-0.2, 0.062, 0.3, -22, 0], bf: [0.22, 0.062, -0.1, -38, 14] }),
    K(0.8, { hip: [0, 0.78, 0.06], hy: -54, hp: 16, gp: 20, g: [0.08, 0.7, 0.2], b: vplane(10, 0), el: 0.4,
      ff: [-0.2, 0.062, 0.2, -24, 0], bf: [0.22, 0.062, -0.06, -36, 6] })
  ];
}

// ---------- helpers for non-batting (free hand) clips ----------
const FREE = { hm: 1, hip: [0, 0.9, 0], hy: 0, hp: 0, hr: 0, ay: 0, ap: 0, ar: 0, cy: 0, cp: 0, cr: 0, gy: 0, gp: 0,
  ff: [-0.13, 0.062, 0.05, 0, 0], bf: [0.13, 0.062, -0.05, 0, 0], el: 0.3 };
const F = (t, o = {}) => K(t, { ...FREE, ...o });

/** Fast / medium bowler: bound, front-foot plant, high arm over (ball leaves the hand ~0.16s in), strong follow-through. */
function bowlPaceKeys() {
  return [
    F(0.0, { hip: [0, 0.93, 0.0], hy: -38, hp: 6, ay: 8, cy: 12, gp: 2, rh: [0.28, 1.12, 0.12], lh: [-0.2, 1.72, 0.48], el: 0.4,
      ff: [-0.15, 0.4, 0.38, -10, 0], bf: [0.15, 0.062, -0.12, -40, 0] }),
    F(0.07, { hip: [0, 0.82, 0.14], hy: -30, hp: 12, ay: 6, cy: 12, rh: [0.3, 0.95, -0.12], lh: [-0.22, 1.7, 0.5], el: 0.5,
      ff: [-0.14, 0.12, 0.55, -8, 0], bf: [0.15, 0.062, -0.14, -40, 10] }),
    F(0.12, { hip: [0, 0.78, 0.22], hy: -20, hp: 16, ay: 10, cy: 16, cr: -10, rh: [0.34, 1.85, -0.06], lh: [-0.2, 1.5, 0.42], el: 0.9,
      ff: [-0.12, 0.062, 0.62, -6, 0], bf: [0.16, 0.08, -0.2, -40, 30] }),
    F(0.17, { hip: [0, 0.74, 0.34], hy: -6, hp: 30, ay: 14, cy: 20, cr: -22, gp: 6, rh: [0.2, 1.9, 0.3], lh: [-0.15, 1.05, 0.0], el: 0.9,
      ff: [-0.12, 0.062, 0.64, -4, 0], bf: [0.16, 0.1, -0.22, -40, 40] }),
    F(0.32, { hip: [0, 0.72, 0.46], hy: 12, hp: 46, ay: 16, cy: 24, cr: -8, gp: 24, rh: [0.55, 0.95, 0.5], lh: [-0.62, 1.0, 0.4], el: 0.25,
      ff: [-0.12, 0.062, 0.64, 0, 0], bf: [0.14, 0.2, 0.12, -20, 40] }),
    F(0.55, { hip: [0, 0.82, 0.44], hy: 6, hp: 26, ay: 8, cy: 10, gp: 10, rh: [0.5, 0.9, 0.38], lh: [-0.5, 0.92, 0.3], el: 0.25,
      ff: [-0.12, 0.062, 0.7, 0, 0], bf: [0.14, 0.062, 0.3, 0, 0] }),
    F(0.8, { hip: [0, 0.88, 0.42], hy: 0, hp: 10, rh: [0.25, 0.9, 0.15], lh: [-0.25, 0.9, 0.15],
      ff: [-0.12, 0.062, 0.7, 0, 0], bf: [0.14, 0.062, 0.45, 0, 0] })
  ];
}

/** Spinner: short skip, wrist-led release from a high arm, balanced and upright. */
function bowlSpinKeys() {
  return [
    F(0.0, { hip: [0, 0.9, 0.0], hy: -26, hp: 6, ay: 6, cy: 8, rh: [0.25, 1.15, 0.2], lh: [-0.3, 1.55, 0.42], el: 0.4,
      ff: [-0.14, 0.2, 0.3, -10, 0], bf: [0.14, 0.062, -0.08, -30, 0] }),
    F(0.08, { hip: [0, 0.84, 0.14], hy: -18, hp: 10, rh: [0.32, 1.6, -0.02], lh: [-0.3, 1.6, 0.4], el: 0.7,
      ff: [-0.12, 0.062, 0.5, -6, 0], bf: [0.15, 0.08, -0.12, -30, 20] }),
    F(0.17, { hip: [0, 0.82, 0.2], hy: -4, hp: 16, ay: 8, cy: 14, cr: -16, rh: [0.22, 1.88, 0.28], lh: [-0.26, 1.3, 0.2], el: 0.9,
      ff: [-0.12, 0.062, 0.56, -4, 0], bf: [0.15, 0.1, -0.16, -30, 30] }),
    F(0.34, { hip: [0, 0.8, 0.28], hy: 10, hp: 26, ay: 10, cy: 16, gp: 14, rh: [-0.18, 0.85, 0.5], lh: [0.12, 1.0, 0.0], el: 0.4,
      ff: [-0.12, 0.062, 0.58, 0, 0], bf: [0.14, 0.15, 0.1, -10, 30] }),
    F(0.75, { hip: [0, 0.88, 0.3], hy: 2, hp: 10, rh: [0.25, 0.9, 0.2], lh: [-0.25, 0.9, 0.2],
      ff: [-0.12, 0.062, 0.58, 0, 0], bf: [0.14, 0.062, 0.3, 0, 0] })
  ];
}

/** Fielder ready position: low athletic crouch, hands out in front, gentle sway (loops). */
function fieldReadyKeys() {
  const k = (t, sway, dip) => F(t, { hip: [sway * 0.02, 0.74 - dip, 0.02], hy: sway * 4, hp: 24, ay: 4, cy: 6, gp: 14,
    rh: [0.2, 0.66, 0.3], lh: [-0.2, 0.66, 0.3], el: 0.2,
    ff: [-0.27, 0.062, 0.04, 8, 0], bf: [0.27, 0.062, -0.02, -8, 0] });
  return [k(0, 0, 0), k(0.5, 1, 0.012), k(1.0, 0, 0), k(1.5, -1, 0.012), k(2.0, 0, 0)];
}

/** Wicket-keeper: deep crouch, soft open gloves ready low in front of the stumps. */
function keepReadyKeys() {
  const k = (t, dip) => F(t, { hip: [0, 0.58 - dip, 0.0], hp: 26, ay: 6, cy: 8, gp: 10,
    rh: [0.2, 0.52, 0.5], lh: [-0.2, 0.52, 0.5], el: 0.1,
    ff: [-0.28, 0.062, 0.0, 14, 0], bf: [0.28, 0.062, 0.0, -14, 0] });
  return [k(0, 0), k(0.9, 0.012), k(1.8, 0)];
}

/** Ground pick-up then overarm throw. The ball leaves the hand at ~0.26s (matches the game's pick-up timer). */
function throwKeys() {
  return [
    F(0.0, { hip: [0, 0.62, 0.12], hp: 36, ay: 6, cy: 8, gp: 42, rh: [0.15, 0.14, 0.38], lh: [-0.15, 0.22, 0.32], el: 0.2,
      ff: [-0.16, 0.062, 0.36, 0, 0], bf: [0.2, 0.062, -0.1, -20, 10] }),
    F(0.12, { hip: [0, 0.78, 0.06], hy: -58, hp: 12, ay: 8, cy: 14, gy: 0, gp: 4, rh: [0.4, 1.5, -0.35], lh: [-0.25, 1.4, 0.42], el: 0.8,
      ff: [-0.16, 0.062, 0.4, -20, 0], bf: [0.22, 0.062, -0.12, -50, 0] }),
    F(0.26, { hip: [0, 0.82, 0.14], hy: -14, hp: 10, ay: 14, cy: 26, cr: -12, gp: 2, rh: [0.2, 1.78, 0.46], lh: [-0.3, 1.0, 0.1], el: 0.9,
      ff: [-0.16, 0.062, 0.58, -4, 0], bf: [0.2, 0.12, -0.08, -40, 40] }),
    F(0.42, { hip: [0, 0.78, 0.22], hy: 14, hp: 30, ay: 12, cy: 20, gp: 14, rh: [-0.15, 0.8, 0.5], lh: [0.2, 1.0, 0.0], el: 0.4,
      ff: [-0.16, 0.062, 0.58, 0, 0], bf: [0.2, 0.16, 0.12, -10, 40] }),
    F(0.66, { hip: [0, 0.86, 0.2], hy: 0, hp: 12, rh: [0.25, 0.9, 0.2], lh: [-0.25, 0.9, 0.2],
      ff: [-0.16, 0.062, 0.5, 0, 0], bf: [0.18, 0.062, 0.2, 0, 0] })
  ];
}

/** Bowler / fielder appeal: leaps with both arms thrown up. */
function appealKeys() {
  return [
    F(0.0, { hip: [0, 0.84, 0], hp: 10, rh: [0.25, 1.0, 0.3], lh: [-0.25, 1.0, 0.3], gp: 6 }),
    F(0.2, { hip: [0, 0.98, 0.04], hp: -6, gp: -14, cr: 0, rh: [0.45, 1.9, 0.15], lh: [-0.45, 1.9, 0.15], el: 0.9,
      ff: [-0.14, 0.18, 0.08, 0, 0], bf: [0.14, 0.14, -0.02, 0, 0] }),
    F(0.42, { hip: [0, 0.92, 0.02], hp: -4, gp: -10, rh: [0.5, 1.88, 0.1], lh: [-0.5, 1.88, 0.1], el: 0.9 }),
    F(0.8, { hip: [0, 0.9, 0.02], hp: -2, gp: -8, rh: [0.55, 1.85, 0.05], lh: [-0.55, 1.85, 0.05], el: 0.9 }),
    F(1.2, { hip: [0, 0.88, 0], hp: 4, gp: 0, rh: [0.3, 1.0, 0.2], lh: [-0.3, 1.0, 0.2], el: 0.4 })
  ];
}

/** Batter beaten: bat drops, looks back at the stumps, shakes his head. */
function reactMissKeys() {
  return [
    K(0),
    K(0.25, { hip: [0, 0.8, 0.0], hy: -40, hp: 14, gy: -30, gp: 12, g: [0.12, 0.7, 0.14], b: vplane(-6, 0), el: 0.4 }),
    K(0.55, { hip: [0, 0.8, 0.0], hy: -40, hp: 14, gy: 28, gp: 10, g: [0.1, 0.72, 0.14], b: vplane(-6, 0), el: 0.4 }),
    K(0.85, { hip: [0, 0.8, 0.0], hy: -46, hp: 12, gy: -16, gp: 8, g: [0.1, 0.74, 0.16], b: vplane(-8, 0), el: 0.3 }),
    K(1.3, { hip: [0, 0.82, 0.0], hy: -52, gy: 0, gp: 8, g: [0.06, 0.78, 0.2], b: vplane(-12, 10), el: 0.25 })
  ];
}

/** Batter dismissed: shoulders drop, bat hangs low, head down. */
function reactOutKeys() {
  return [
    K(0),
    K(0.35, { hip: [0, 0.82, 0.0], hy: -30, hp: 20, ap: 14, cp: 14, gy: -20, gp: 38, g: [0.16, 0.56, 0.1], b: vplane(-4, 5), el: 0.1 }),
    K(0.9, { hip: [0, 0.82, -0.04], hy: -10, hp: 22, ap: 16, cp: 16, gy: 0, gp: 44, g: [0.18, 0.54, 0.08], b: vplane(-4, 5), el: 0.1 }),
    K(2.0, { hip: [0, 0.82, -0.04], hy: -6, hp: 22, ap: 16, cp: 16, gy: 0, gp: 44, g: [0.18, 0.54, 0.08], b: vplane(-4, 5), el: 0.1 })
  ];
}

/** Milestone / win celebration: jumps with the bat raised high in both hands. */
function celebrateBatKeys() {
  return [
    K(0),
    K(0.2, { hip: [0, 0.74, 0.0], hy: -20, hp: 10, g: [0.1, 1.2, 0.2], b: vplane(160, 0), el: 0.8, gp: 0 }),
    K(0.45, { hip: [0, 1.0, 0.0], hy: -10, hp: -6, gp: -14, g: [0.08, 1.88, 0.1], b: vplane(180, 0), el: 1.0,
      ff: [-0.2, 0.2, 0.05, -10, 0], bf: [0.2, 0.18, 0.0, -10, 0] }),
    K(0.7, { hip: [0, 0.84, 0.0], hy: -10, hp: 0, gp: -10, g: [0.08, 1.86, 0.1], b: vplane(180, 0), el: 1.0,
      ff: [-0.2, 0.062, 0.05, -10, 0], bf: [0.2, 0.062, 0.0, -10, 0] }),
    K(0.95, { hip: [0, 1.0, 0.0], hy: -10, hp: -6, gp: -14, g: [0.08, 1.88, 0.1], b: vplane(180, 0), el: 1.0,
      ff: [-0.2, 0.2, 0.05, -10, 0], bf: [0.2, 0.18, 0.0, -10, 0] }),
    K(1.3, { hip: [0, 0.84, 0.0], hy: -10, hp: 0, gp: -6, g: [0.08, 1.8, 0.1], b: vplane(180, 0), el: 0.9,
      ff: [-0.2, 0.062, 0.05, -10, 0], bf: [0.2, 0.062, 0.0, -10, 0] })
  ];
}

/** Inside-out lofted extra-cover drive: upright open chest, deep front stride, soaring off-side lofted finish. */
function driveCoverLoftKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0.0, 0.8, -0.06], hy: -62, hp: 10, ay: 8, cy: 6, gp: 6,
      g: [0.12, 1.14, -0.04], b: vplane(132, 26), el: 0.72,
      ff: [-0.22, 0.12, 0.1, -24, 0], bf: [0.24, 0.062, -0.08, -36, 0]
    }),
    K(0.24, {
      hip: [0.06, 0.75, 0.2], hy: -42, hp: 14, ay: 12, cy: 16, gy: 12, gp: 18,
      g: [0.18, 1.16, 0.14], b: vplane(78, 32), el: 0.92,
      ff: [-0.1, 0.075, 0.5, -10, 0], bf: [0.24, 0.062, -0.1, -42, 0]
    }),
    K(0.31, {
      hip: [0.1, 0.7, 0.34], hy: -26, hp: 16, ay: 18, cy: 24, gy: 24, gp: 28,
      g: [0.28, 0.92, 0.62], b: vplane(-24, 34), el: 0.95,
      ff: [-0.04, 0.062, 0.66, -2, 0], bf: [0.24, 0.11, -0.12, -46, 42]
    }),
    K(0.45, {
      hip: [0.1, 0.76, 0.32], hy: -10, hp: 4, ay: 26, cy: 34, gy: 30, gp: 8,
      g: [0.34, 1.32, 0.48], b: vplane(-102, 34), el: 0.85,
      ff: [-0.04, 0.062, 0.66, 0, 0], bf: [0.24, 0.12, -0.12, -46, 44]
    }),
    K(0.66, {
      hip: [0.08, 0.82, 0.28], hy: 0, hp: -4, ay: 28, cy: 38, gy: 26, gp: -4,
      g: [0.3, 1.5, 0.28], b: vplane(-158, 28), el: 0.72,
      ff: [-0.04, 0.062, 0.64, 0, 0], bf: [0.24, 0.12, -0.12, -46, 44]
    }),
    K(1.05, {
      hip: [0.08, 0.83, 0.26], hy: 0, hp: -4, ay: 26, cy: 36, gy: 22, gp: -2,
      g: [0.28, 1.5, 0.24], b: vplane(-162, 26), el: 0.64,
      ff: [-0.04, 0.062, 0.62, 0, 0], bf: [0.24, 0.12, -0.12, -46, 42]
    })
  ];
}

/** Wristy low-knee on-drive / mid-on whip: deep front knee bend, wrist whip through mid-on with high finish. */
function driveOnWhipKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0.0, 0.8, -0.04], hy: -60, hp: 10, gp: 8,
      g: [0.08, 1.04, 0.02], b: vplane(112, -10), el: 0.65,
      ff: [-0.24, 0.1, 0.12, -22, 0], bf: [0.22, 0.062, -0.06, -35, 0]
    }),
    K(0.24, {
      hip: [-0.04, 0.7, 0.22], hy: -44, hp: 18, ay: 14, cy: 18, gy: -8, gp: 24,
      g: [0.04, 0.96, 0.2], b: vplane(64, -22), el: 0.85,
      ff: [-0.26, 0.065, 0.48, -10, 0], bf: [0.22, 0.08, -0.1, -40, 22]
    }),
    K(0.31, {
      hip: [-0.08, 0.64, 0.34], hy: -26, hp: 22, ay: 22, cy: 28, gy: -18, gp: 32,
      g: [-0.08, 0.78, 0.58], b: hdir(-32, 24), el: 0.92,
      ff: [-0.28, 0.062, 0.64, -4, 0], bf: [0.22, 0.11, -0.12, -44, 42]
    }),
    K(0.46, {
      hip: [-0.08, 0.7, 0.32], hy: -6, hp: 14, ay: 28, cy: 36, gy: -28, gp: 18,
      g: [-0.24, 1.08, 0.48], b: hdir(-74, -18), el: 0.82,
      ff: [-0.28, 0.062, 0.64, 0, 0], bf: [0.22, 0.11, -0.12, -44, 42]
    }),
    K(0.68, {
      hip: [-0.06, 0.76, 0.28], hy: 4, hp: 10, ay: 28, cy: 36, gy: -24, gp: 8,
      g: [-0.26, 1.3, 0.28], b: hdir(-112, -48), el: 0.66,
      ff: [-0.28, 0.062, 0.62, 0, 0], bf: [0.22, 0.11, -0.12, -44, 38]
    }),
    K(1.02, {
      hip: [-0.06, 0.78, 0.26], hy: 4, hp: 8, ay: 26, cy: 34, gy: -20, gp: 6,
      g: [-0.24, 1.32, 0.24], b: hdir(-118, -52), el: 0.58,
      ff: [-0.28, 0.062, 0.6, 0, 0], bf: [0.22, 0.11, -0.12, -44, 36]
    })
  ];
}

/** Open-face Late Cut / Third-man dab: weights back, waits on the ball late and guides past keeper with high wrists. */
function cutLateKeys() {
  return [
    K(0),
    K(0.14, {
      hip: [0.02, 0.8, -0.1], hy: -66, hp: 10, gy: 10, gp: 12,
      g: [0.14, 1.06, -0.02], b: vplane(110, 22), el: 0.65,
      ff: [-0.2, 0.062, 0.02, -25, 0], bf: [0.22, 0.08, -0.16, -44, 0]
    }),
    K(0.24, {
      hip: [0.08, 0.74, -0.14], hy: -78, hp: 16, ay: 4, cy: 2, gy: 24, gp: 24,
      g: [0.3, 0.98, -0.02], b: hdir(148, 22), el: 0.78,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.32, 0.062, -0.24, -68, 0]
    }),
    K(0.31, {
      hip: [0.1, 0.72, -0.14], hy: -86, hp: 16, ay: -2, cy: -4, gy: 38, gp: 30,
      g: [0.44, 0.88, -0.06], b: hdir(126, 18), el: 0.8,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.34, 0.062, -0.26, -74, 0]
    }),
    K(0.46, {
      hip: [0.1, 0.76, -0.12], hy: -82, hp: 12, ay: 2, cy: 2, gy: 48, gp: 16,
      g: [0.46, 1.18, -0.08], b: hdir(152, -32), el: 0.82,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.34, 0.062, -0.26, -74, 0]
    }),
    K(0.68, {
      hip: [0.08, 0.78, -0.1], hy: -76, hp: 10, ay: 6, cy: 8, gy: 46, gp: 10,
      g: [0.42, 1.32, -0.04], b: hdir(162, -48), el: 0.7,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.32, 0.062, -0.24, -70, 0]
    }),
    K(1.02, {
      hip: [0.08, 0.8, -0.08], hy: -72, hp: 8, ay: 6, cy: 8, gy: 38, gp: 8,
      g: [0.36, 1.3, -0.02], b: hdir(165, -48), el: 0.6,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.32, 0.062, -0.24, -68, 0]
    })
  ];
}

/** Lofted square cut / slap over point: tall athletic stance, explosive upward-across blade arc & high shoulder follow-through. */
function cutLoftKeys() {
  return [
    K(0),
    K(0.14, {
      hip: [0.04, 0.8, -0.14], hy: -74, hp: 8, ay: 6, cy: 2, gy: 10, gp: 10,
      g: [0.16, 1.18, -0.08], b: vplane(136, 30), el: 0.78,
      ff: [-0.2, 0.062, 0.02, -25, 0], bf: [0.22, 0.09, -0.2, -52, 0]
    }),
    K(0.24, {
      hip: [0.1, 0.78, -0.12], hy: -86, hp: 10, ay: 8, cy: 6, gy: 20, gp: 18,
      g: [0.4, 1.18, 0.02], b: hdir(142, -16), el: 0.94,
      ff: [-0.18, 0.062, 0.06, -26, 0], bf: [0.34, 0.062, -0.26, -74, 0]
    }),
    K(0.31, {
      hip: [0.14, 0.76, -0.08], hy: -80, hp: 8, ay: 12, cy: 16, gy: 28, gp: 22,
      g: [0.58, 1.06, 0.16], b: hdir(76, 10), el: 0.96,
      ff: [-0.18, 0.062, 0.06, -26, 0], bf: [0.36, 0.062, -0.26, -78, 0]
    }),
    K(0.45, {
      hip: [0.14, 0.8, -0.06], hy: -64, hp: 2, ay: 20, cy: 28, gy: 38, gp: 4,
      g: [0.54, 1.38, 0.18], b: hdir(108, -42), el: 0.86,
      ff: [-0.18, 0.062, 0.06, -26, 0], bf: [0.36, 0.062, -0.26, -78, 0]
    }),
    K(0.68, {
      hip: [0.12, 0.82, -0.06], hy: -56, hp: -2, ay: 22, cy: 30, gy: 36, gp: -4,
      g: [0.42, 1.54, 0.1], b: hdir(138, -62), el: 0.72,
      ff: [-0.18, 0.062, 0.06, -26, 0], bf: [0.36, 0.062, -0.26, -76, 0]
    }),
    K(1.04, {
      hip: [0.1, 0.82, -0.06], hy: -54, hp: 0, ay: 20, cy: 28, gy: 30, gp: 0,
      g: [0.38, 1.52, 0.08], b: hdir(142, -62), el: 0.64,
      ff: [-0.18, 0.062, 0.06, -26, 0], bf: [0.34, 0.062, -0.24, -72, 0]
    })
  ];
}

/** Upper Cut over third-man / slips: bends knees low under bounce and ramps bat face upward diagonally behind point. */
function upperCutKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0.02, 0.78, -0.1], hy: -66, hp: 8, gp: 4,
      g: [0.14, 1.1, -0.04], b: vplane(128, 16), el: 0.75,
      ff: [-0.2, 0.062, 0.0, -25, 0], bf: [0.22, 0.08, -0.16, -44, 0]
    }),
    K(0.24, {
      hip: [0.08, 0.64, -0.16], hy: -78, hp: 4, ay: 2, cy: -4, gy: 12, gp: -10,
      g: [0.32, 1.14, -0.02], b: hdir(148, -12), el: 1.0,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.32, 0.062, -0.24, -68, 0]
    }),
    K(0.31, {
      hip: [0.1, 0.62, -0.14], hy: -82, hp: -4, ay: 0, cy: -8, gy: 18, gp: -16,
      g: [0.42, 1.32, 0.02], b: hdir(132, -26), el: 1.0,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.34, 0.062, -0.24, -72, 0]
    }),
    K(0.46, {
      hip: [0.1, 0.7, -0.12], hy: -74, hp: -4, ay: 8, cy: 10, gy: 24, gp: -12,
      g: [0.44, 1.48, 0.08], b: hdir(156, -68), el: 0.9,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.34, 0.062, -0.24, -72, 0]
    }),
    K(0.68, {
      hip: [0.08, 0.76, -0.1], hy: -68, hp: 2, ay: 12, cy: 16, gy: 20, gp: -4,
      g: [0.38, 1.44, 0.1], b: hdir(162, -60), el: 0.74,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.32, 0.062, -0.22, -66, 0]
    }),
    K(1.04, {
      hip: [0.06, 0.78, -0.08], hy: -64, hp: 4, ay: 12, cy: 16, gy: 16, gp: 0,
      g: [0.32, 1.38, 0.1], b: hdir(160, -54), el: 0.62,
      ff: [-0.2, 0.062, 0.04, -26, 0], bf: [0.3, 0.062, -0.2, -62, 0]
    })
  ];
}

/** Knee-drop Slog Sweep: front knee lunges low, back knee drops near pitch, heavy cow-corner swing & high neck wrap. */
function slogSweepKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0.0, 0.74, 0.08], hy: -58, hp: 20, ay: 8, cy: 10, gp: 18,
      g: [0.12, 1.0, 0.06], b: vplane(104, 10), el: 0.72,
      ff: [-0.22, 0.062, 0.2, -22, 0], bf: [0.22, 0.062, -0.1, -40, 12]
    }),
    K(0.24, {
      hip: [-0.02, 0.54, 0.24], hy: -44, hp: 30, ay: 14, cy: 20, gy: -8, gp: 30,
      g: [0.08, 0.78, 0.26], b: hdir(152, 8), el: 0.9,
      ff: [-0.26, 0.062, 0.62, -10, 0], bf: [0.2, 0.09, -0.22, -42, 66]
    }),
    K(0.31, {
      hip: [-0.04, 0.48, 0.3], hy: -10, hp: 32, ay: 28, cy: 36, gy: -20, gp: 34,
      g: [-0.24, 0.68, 0.54], b: hdir(-34, 14), el: 0.95,
      ff: [-0.28, 0.062, 0.68, 4, 0], bf: [0.2, 0.09, -0.22, -40, 68]
    }),
    K(0.46, {
      hip: [-0.06, 0.52, 0.28], hy: 22, hp: 20, ay: 34, cy: 42, gy: -36, gp: 14,
      g: [-0.4, 1.0, 0.36], b: hdir(-94, -28), el: 0.85,
      ff: [-0.28, 0.062, 0.68, 12, 0], bf: [0.2, 0.09, -0.22, -38, 66]
    }),
    K(0.7, {
      hip: [-0.04, 0.6, 0.24], hy: 30, hp: 10, ay: 32, cy: 40, gy: -38, gp: 4,
      g: [-0.36, 1.24, 0.16], b: hdir(-128, -48), el: 0.7,
      ff: [-0.28, 0.062, 0.66, 14, 0], bf: [0.2, 0.09, -0.22, -38, 60]
    }),
    K(1.06, {
      hip: [-0.04, 0.64, 0.22], hy: 28, hp: 8, ay: 30, cy: 36, gy: -32, gp: 2,
      g: [-0.32, 1.26, 0.14], b: hdir(-132, -48), el: 0.62,
      ff: [-0.28, 0.062, 0.64, 14, 0], bf: [0.2, 0.09, -0.22, -38, 56]
    })
  ];
}

/** Swivel Hook Loft: deep back-foot sink & explosive high shoulder rotation over deep square leg. */
function hookLoftKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0.02, 0.8, -0.14], hy: -68, hp: 6, ay: 8, cy: 6, gy: -6, gp: 4,
      g: [0.18, 1.16, -0.1], b: vplane(128, 22), el: 0.8,
      ff: [-0.2, 0.08, 0.0, -24, 0], bf: [0.22, 0.08, -0.18, -46, 0]
    }),
    K(0.24, {
      hip: [0.0, 0.72, -0.18], hy: -74, hp: 6, ay: 16, cy: 18, gy: -10, gp: 8,
      g: [0.36, 1.26, -0.02], b: hdir(148, -14), el: 1.0,
      ff: [-0.18, 0.09, 0.06, 0, 0], bf: [0.32, 0.062, -0.26, -64, 0]
    }),
    K(0.31, {
      hip: [-0.06, 0.72, -0.14], hy: 12, hp: 4, ay: 32, cy: 40, gy: -34, gp: 10,
      g: [-0.18, 1.24, 0.36], b: hdir(-36, -6), el: 0.96,
      ff: [-0.2, 0.08, 0.08, 32, 0], bf: [0.32, 0.062, -0.26, 22, 18]
    }),
    K(0.45, {
      hip: [-0.08, 0.78, -0.12], hy: 56, hp: -4, ay: 34, cy: 44, gy: -60, gp: -4,
      g: [-0.36, 1.42, 0.22], b: hdir(-108, -28), el: 0.85,
      ff: [-0.2, 0.062, 0.08, 52, 0], bf: [0.32, 0.08, -0.24, 48, 26]
    }),
    K(0.68, {
      hip: [-0.08, 0.82, -0.1], hy: 68, hp: -6, ay: 32, cy: 42, gy: -70, gp: -6,
      g: [-0.3, 1.54, 0.04], b: hdir(-142, -52), el: 0.72,
      ff: [-0.2, 0.062, 0.08, 56, 0], bf: [0.32, 0.08, -0.24, 52, 28]
    }),
    K(1.06, {
      hip: [-0.06, 0.83, -0.08], hy: 62, hp: -4, ay: 30, cy: 38, gy: -60, gp: -4,
      g: [-0.26, 1.52, 0.04], b: hdir(-148, -54), el: 0.64,
      ff: [-0.2, 0.062, 0.08, 54, 0], bf: [0.32, 0.08, -0.24, 50, 26]
    })
  ];
}

/** Helicopter whip loft: low bottom-hand dig & circular overhead bat spin follow-through. */
function helicopterKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0.0, 0.78, -0.02], hy: -60, hp: 14, gp: 12,
      g: [0.1, 1.02, 0.04], b: vplane(108, -4), el: 0.68,
      ff: [-0.22, 0.08, 0.14, -22, 0], bf: [0.24, 0.062, -0.08, -38, 0]
    }),
    K(0.24, {
      hip: [0.0, 0.68, 0.2], hy: -40, hp: 24, ay: 16, cy: 20, gy: -4, gp: 32,
      g: [0.08, 0.72, 0.34], b: vplane(48, -16), el: 0.85,
      ff: [-0.24, 0.062, 0.48, -10, 0], bf: [0.24, 0.08, -0.14, -44, 28]
    }),
    K(0.31, {
      hip: [-0.04, 0.64, 0.28], hy: -14, hp: 24, ay: 26, cy: 34, gy: -16, gp: 36,
      g: [-0.14, 0.68, 0.56], b: hdir(-28, 32), el: 0.94,
      ff: [-0.24, 0.062, 0.58, 4, 0], bf: [0.24, 0.11, -0.14, -44, 42]
    }),
    K(0.42, {
      hip: [-0.06, 0.74, 0.24], hy: 18, hp: 8, ay: 34, cy: 44, gy: -34, gp: 10,
      g: [-0.26, 1.22, 0.32], b: hdir(-95, -24), el: 0.9,
      ff: [-0.24, 0.062, 0.58, 16, 0], bf: [0.24, 0.11, -0.14, -40, 42]
    }),
    K(0.56, {
      hip: [-0.04, 0.82, 0.2], hy: 34, hp: -4, ay: 34, cy: 44, gy: -40, gp: -8,
      g: [-0.08, 1.54, 0.12], b: hdir(-175, -72), el: 0.85,
      ff: [-0.24, 0.062, 0.56, 22, 0], bf: [0.24, 0.11, -0.14, -36, 38]
    }),
    K(0.74, {
      hip: [-0.02, 0.84, 0.18], hy: 36, hp: -2, ay: 30, cy: 40, gy: -34, gp: -6,
      g: [0.16, 1.48, 0.1], b: hdir(120, -45), el: 0.72,
      ff: [-0.24, 0.062, 0.54, 22, 0], bf: [0.24, 0.1, -0.14, -36, 34]
    }),
    K(1.08, {
      hip: [-0.02, 0.84, 0.16], hy: 32, hp: 0, ay: 28, cy: 36, gy: -28, gp: -2,
      g: [0.18, 1.44, 0.1], b: hdir(124, -42), el: 0.64,
      ff: [-0.24, 0.062, 0.52, 20, 0], bf: [0.24, 0.1, -0.14, -36, 32]
    })
  ];
}

/** Behind-square paddle flick / fine-leg whip: drops knees & sweeps wrists smoothly behind square leg. */
function paddleFlickKeys() {
  return [
    K(0),
    K(0.13, {
      hip: [0.0, 0.78, 0.0], hy: -56, hp: 16, gp: 14,
      g: [0.08, 0.94, 0.08], b: vplane(82, -4), el: 0.58,
      ff: [-0.22, 0.062, 0.12, -22, 0], bf: [0.22, 0.062, -0.08, -36, 0]
    }),
    K(0.24, {
      hip: [-0.04, 0.64, 0.16], hy: -44, hp: 26, ay: 14, cy: 20, gy: -10, gp: 30,
      g: [-0.06, 0.74, 0.28], b: hdir(165, 24), el: 0.78,
      ff: [-0.28, 0.062, 0.44, -4, 0], bf: [0.22, 0.08, -0.16, -42, 34]
    }),
    K(0.31, {
      hip: [-0.08, 0.6, 0.2], hy: -18, hp: 28, ay: 24, cy: 34, gy: -24, gp: 34,
      g: [-0.26, 0.7, 0.24], b: hdir(-112, 26), el: 0.86,
      ff: [-0.32, 0.062, 0.5, 6, 0], bf: [0.22, 0.09, -0.18, -42, 42]
    }),
    K(0.46, {
      hip: [-0.08, 0.66, 0.18], hy: 6, hp: 18, ay: 30, cy: 40, gy: -44, gp: 18,
      g: [-0.38, 0.98, 0.02], b: hdir(-145, -16), el: 0.82,
      ff: [-0.32, 0.062, 0.5, 12, 0], bf: [0.22, 0.09, -0.18, -42, 42]
    }),
    K(0.7, {
      hip: [-0.06, 0.74, 0.16], hy: 14, hp: 12, ay: 28, cy: 38, gy: -42, gp: 8,
      g: [-0.34, 1.18, -0.02], b: hdir(-155, -36), el: 0.68,
      ff: [-0.32, 0.062, 0.48, 12, 0], bf: [0.22, 0.09, -0.18, -42, 38]
    }),
    K(1.04, {
      hip: [-0.06, 0.76, 0.14], hy: 12, hp: 10, ay: 26, cy: 36, gy: -36, gp: 6,
      g: [-0.32, 1.2, -0.02], b: hdir(-155, -36), el: 0.6,
      ff: [-0.3, 0.062, 0.46, 10, 0], bf: [0.22, 0.09, -0.18, -42, 34]
    })
  ];
}

/** Builds every IK-authored batting clip. */
export function buildIKBattingClips() {
  const clips = {};
  clips.stance = bakeShotClip('stance', 1.6, stanceKeys());
  clips.defence = bakeShotClip('defence', 0.82, defenceKeys());
  clips.drive = bakeShotClip('drive', 0.96, driveKeys(8));
  clips.drive_cover = bakeShotClip('drive_cover', 0.98, driveKeys(32, 0.85));
  clips.drive_cover_loft = bakeShotClip('drive_cover_loft', 1.05, driveCoverLoftKeys());
  clips.drive_on = bakeShotClip('drive_on', 0.96, driveKeys(-22, 0.9));
  clips.drive_on_whip = bakeShotClip('drive_on_whip', 1.02, driveOnWhipKeys());
  clips.loft = bakeShotClip('loft', 1.02, loftKeys());
  clips.cut = bakeShotClip('cut', 0.98, cutKeys());
  clips.cut_late = bakeShotClip('cut_late', 1.02, cutLateKeys());
  clips.cut_loft = bakeShotClip('cut_loft', 1.04, cutLoftKeys());
  clips.upper_cut = bakeShotClip('upper_cut', 1.04, upperCutKeys());
  clips.pull = bakeShotClip('pull', 0.98, pullKeys());
  clips.hook_loft = bakeShotClip('hook_loft', 1.06, hookLoftKeys());
  clips.flick = bakeShotClip('flick', 0.98, flickKeys(0));
  clips.glance = bakeShotClip('glance', 0.98, flickKeys(1));
  clips.paddle_flick = bakeShotClip('paddle_flick', 1.04, paddleFlickKeys());
  clips.sweep = bakeShotClip('sweep', 1.02, sweepKeys(-1));
  clips.slog_sweep = bakeShotClip('slog_sweep', 1.06, slogSweepKeys());
  clips.reverse_sweep = bakeShotClip('reverse_sweep', 1.02, sweepKeys(1));
  clips.helicopter = bakeShotClip('helicopter', 1.08, helicopterKeys());
  clips.scoop = bakeShotClip('scoop', 1.02, scoopKeys());
  clips.ramp = bakeShotClip('ramp', 1.0, rampKeys());
  clips.punch = bakeShotClip('punch', 0.95, punchKeys());
  clips.dig = bakeShotClip('dig', 0.85, digKeys());
  // free-hand clips: bowling, fielding, keeping, appeals and batter reactions
  clips.bowl_pace = bakeShotClip('bowl_pace', 0.8, bowlPaceKeys());
  clips.bowl_spin = bakeShotClip('bowl_spin', 0.75, bowlSpinKeys());
  clips.field_ready = bakeShotClip('field_ready', 2.0, fieldReadyKeys());
  clips.keep_ready = bakeShotClip('keep_ready', 1.8, keepReadyKeys());
  clips.throw = bakeShotClip('throw', 0.66, throwKeys());
  clips.appeal = bakeShotClip('appeal', 1.2, appealKeys());
  clips.react_miss = bakeShotClip('react_miss', 1.3, reactMissKeys());
  clips.react_out = bakeShotClip('react_out', 2.0, reactOutKeys());
  clips.celebrate_bat = bakeShotClip('celebrate_bat', 1.3, celebrateBatKeys());
  return clips;
}

/** Names of clips that are batting shots (the bat then follows the gloves instead of the generic bat-physics pose). */
export const BATTING_SHOT_CLIPS = new Set([
  'defence', 'punch', 'dig', 'drive', 'drive_cover', 'drive_cover_loft', 'drive_on', 'drive_on_whip',
  'loft', 'cut', 'cut_late', 'cut_loft', 'upper_cut', 'pull', 'hook_loft',
  'flick', 'glance', 'paddle_flick', 'sweep', 'slog_sweep', 'reverse_sweep', 'helicopter', 'scoop', 'ramp',
  'react_miss', 'react_out', 'celebrate_bat'
]);
export { UP as _UP };
