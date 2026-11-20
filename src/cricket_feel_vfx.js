import * as THREE from 'three';
import { BOUNDARY_RADIUS } from '../physics.js';

/**
 * Modular Feature Switches for the 7 Cricket Visual & Feel Upgrades.
 * Any single feature can be toggled off (false) or on (true) independently!
 */
export const CRICKET_FEEL_FLAGS = {
  batSwingRibbon: true,        // #1: 3D Willow Bat Swing Arc Ribbon
  volumetricBallRibbon: true,  // #2: Volumetric 3D Hawk-Eye Ball Ribbon Trail
  rimShaderAndShadows: true,   // #3: Stadium Floodlight Fresnel Rim-Shader + Ground Contact Shadows
  aliveBatsmanFeel: true,      // #4: Real-Time Head Ball Tracking + Pre-Release Trigger Step + 45Hz Bat Recoil
  cricketImpactVFX: true,      // #5: Bat-Ball Seam Sparks + Expanding Shockwave + Pitch Bounce Ripple Ring
  floatingShotTelemetry: true, // #6: 3D-to-2D Floating Shot Telemetry Pill above Striker's Helmet
  aliveStadiumCrowd: true      // #7: Tennis-Style Head+Torso 3D Spectators with Cheer Bounce on 4s/6s/Wickets
};

const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _tmpVecC = new THREE.Vector3();
const _tmpColor = new THREE.Color();
const _dummy = new THREE.Object3D();

// ============================================================================
// #1. 3D WILLOW BAT SWING ARC RIBBON (Catmull-Rom 4x Sub-Stepped Shader Ribbon)
// ============================================================================
const BAT_RIBBON_VERT = /* glsl */ `
  attribute float aAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BAT_RIBBON_FRAG = /* glsl */ `
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float edgeDist = abs(vUv.y - 0.5) * 2.0;
    float edgeFade = smoothstep(1.0, 0.12, edgeDist);
    float tipHighlight = smoothstep(0.55, 0.96, vUv.y) * 0.42;
    float lengthwiseFade = smoothstep(0.0, 0.12, vAlpha) * pow(clamp(vAlpha, 0.0, 1.0), 1.25);
    vec3 col = mix(uColorEdge, uColorCore, edgeFade + tipHighlight);
    float finalAlpha = clamp(edgeFade * lengthwiseFade * uOpacity, 0.0, 0.92);
    if (finalAlpha < 0.01) discard;
    gl_FragColor = vec4(col, finalAlpha);
  }
`;

export class CricketBatRibbonTrail {
  constructor(scene, maxSamples = 36) {
    this.scene = scene;
    this.maxSamples = maxSamples;
    this.samples = [];
    this.prevRawSample = null;
    this.activeTimer = 0;

    // Local points on Detailed Cricket Bat (relative to strikerBatPivot)
    this.localToe = new THREE.Vector3(0, -0.625, 0.01);
    this.localSplice = new THREE.Vector3(0, -0.09, 0.01);

    const vertexCount = maxSamples * 2;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const alphas = new Float32Array(vertexCount);
    const indices = [];

    for (let i = 0; i < maxSamples; i++) {
      const u = i / (maxSamples - 1);
      uvs[i * 4 + 0] = u;
      uvs[i * 4 + 1] = 0.0; // Splice inner edge
      uvs[i * 4 + 2] = u;
      uvs[i * 4 + 3] = 1.0; // Bat Toe outer edge

      if (i < maxSamples - 1) {
        const b = i * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.geometry.setIndex(indices);

    this.material = new THREE.ShaderMaterial({
      vertexShader: BAT_RIBBON_VERT,
      fragmentShader: BAT_RIBBON_FRAG,
      uniforms: {
        uColorCore: { value: new THREE.Color(0xffffff) },
        uColorEdge: { value: new THREE.Color(0x38bdf8) },
        uOpacity: { value: 0.78 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  setBatRibbonStyle({ isLofted = false, isSweet = false, isOnFire = false } = {}) {
    if (isOnFire) {
      this.material.uniforms.uColorCore.value.setHex(0xfef08a);
      this.material.uniforms.uColorEdge.value.setHex(0xf97316);
      this.material.uniforms.uOpacity.value = 0.92;
    } else if (isSweet || isLofted) {
      this.material.uniforms.uColorCore.value.setHex(0xfffbeb);
      this.material.uniforms.uColorEdge.value.setHex(0xf59e0b);
      this.material.uniforms.uOpacity.value = 0.86;
    } else {
      this.material.uniforms.uColorCore.value.setHex(0xffffff);
      this.material.uniforms.uColorEdge.value.setHex(0x38bdf8);
      this.material.uniforms.uOpacity.value = 0.72;
    }
  }

  triggerSwingWindow(durationSec = 0.34, style = {}) {
    this.activeTimer = Math.max(this.activeTimer, durationSec);
    this.setBatRibbonStyle(style);
  }

  /**
   * Seeds a full 3D cricket bat swing arc around the striker for any shot (phone, keyboard, or touch)
   */
  triggerShotSwingArc(strikerMesh, shotKey = 'drive', style = {}) {
    if (!CRICKET_FEEL_FLAGS.batSwingRibbon || !strikerMesh) return;
    this.setBatRibbonStyle(style);
    this.activeTimer = 0.28;
    this.samples.length = 0;

    const pos = strikerMesh.position;
    const handSign = strikerMesh.scale.x < 0 ? -1 : 1;

    // Determine swing plane angles based on cricket shot type
    let startYaw = -0.85 * handSign;
    let endYaw = 1.05 * handSign;
    let pitchLift = style.isLofted ? 0.55 : 0.22;
    let sideTilt = 0.28 * handSign;

    if (shotKey === 'slog_sweep' || shotKey === 'sweep_shot' || shotKey === 'sweep' || shotKey === 'reverse_sweep') {
      startYaw = -1.2 * handSign;
      endYaw = 1.4 * handSign;
      pitchLift = shotKey === 'slog_sweep' ? 0.62 : 0.2;
      sideTilt = 0.72 * handSign;
    } else if (shotKey === 'helicopter_loft') {
      startYaw = -0.95 * handSign;
      endYaw = 1.65 * handSign;
      pitchLift = 0.78;
      sideTilt = 0.55 * handSign;
    } else if (shotKey === 'pull_shot' || shotKey === 'pull' || shotKey === 'hook_shot') {
      startYaw = -1.2 * handSign;
      endYaw = 1.4 * handSign;
      pitchLift = shotKey === 'hook_shot' ? 0.52 : 0.22;
      sideTilt = 0.68 * handSign;
    } else if (shotKey === 'square_cut' || shotKey === 'late_cut' || shotKey === 'lofted_cut' || shotKey === 'cut') {
      startYaw = 0.95 * handSign;
      endYaw = -1.25 * handSign;
      pitchLift = shotKey === 'lofted_cut' ? 0.54 : 0.14;
      sideTilt = -0.62 * handSign;
    } else if (shotKey === 'leg_flick' || shotKey === 'fine_glance' || shotKey === 'paddle_sweep' || shotKey === 'on_drive') {
      startYaw = -0.9 * handSign;
      endYaw = 1.15 * handSign;
      pitchLift = style.isLofted ? 0.52 : 0.2;
      sideTilt = 0.45 * handSign;
    } else if (shotKey === 'inside_out_loft' || shotKey === 'cover_drive') {
      startYaw = 0.85 * handSign;
      endYaw = -1.05 * handSign;
      pitchLift = shotKey === 'inside_out_loft' ? 0.62 : 0.22;
      sideTilt = -0.35 * handSign;
    } else if (shotKey === 'scoop' || shotKey === 'scoop_shot' || shotKey === 'ramp' || shotKey === 'ramp_shot' || shotKey === 'upper_cut') {
      startYaw = -0.45 * handSign;
      endYaw = 0.65 * handSign;
      pitchLift = 0.85;
      sideTilt = 0.15 * handSign;
    } else if (shotKey === 'defence') {
      startYaw = -0.45 * handSign;
      endYaw = 0.18 * handSign;
      pitchLift = 0.05;
    }

    const count = 24;
    for (let i = 0; i < count; i++) {
      // i = 0 is the newest point (follow-through), i = count-1 is the backlift start
      const u = 1 - i / (count - 1);
      const ang = THREE.MathUtils.lerp(startYaw, endYaw, u);
      const downswingDip = -Math.sin(u * Math.PI) * 0.42 + (u - 0.5) * pitchLift;

      const splicePos = new THREE.Vector3(
        pos.x + Math.sin(ang) * 0.26 + sideTilt * 0.15,
        pos.y + 0.98 + downswingDip * 0.35,
        pos.z - Math.cos(ang) * 0.28
      );
      const toePos = new THREE.Vector3(
        pos.x + Math.sin(ang) * 0.78 + sideTilt * Math.sin(u * Math.PI) * 0.45,
        Math.max(0.08, pos.y + 0.56 + downswingDip),
        pos.z - Math.cos(ang) * 0.78
      );

      this.samples.push({
        toe: toePos,
        splice: splicePos,
        age: (i / count) * 0.15
      });
    }
    this.mesh.visible = true;
  }

  clear() {
    this.samples.length = 0;
    this.prevRawSample = null;
    this.activeTimer = 0;
    this.mesh.visible = false;
  }

  update(dt, batPivot, angularSpeedDeg = 0, isOnFire = false) {
    if (!CRICKET_FEEL_FLAGS.batSwingRibbon || !batPivot) {
      this.mesh.visible = false;
      return;
    }

    if (this.activeTimer > 0) {
      this.activeTimer = Math.max(0, this.activeTimer - dt);
    }

    if (!this._scratchToe) {
      this._scratchToe = new THREE.Vector3();
      this._scratchSplice = new THREE.Vector3();
      this._prevToe = new THREE.Vector3();
      this._prevSplice = new THREE.Vector3();
      this._hasPrevSample = false;
    }

    batPivot.updateWorldMatrix(true, false);
    const toeWorld = this._scratchToe.copy(this.localToe).applyMatrix4(batPivot.matrixWorld);
    const spliceWorld = this._scratchSplice.copy(this.localSplice).applyMatrix4(batPivot.matrixWorld);

    let tipSpeed = 0;
    if (this._hasPrevSample) {
      tipSpeed = toeWorld.distanceTo(this._prevToe) / Math.max(0.004, dt);
    }

    const isFastSwing = tipSpeed > 2.2;
    if (isOnFire && this.activeTimer <= 0) {
      this.setBatRibbonStyle({ isOnFire: true });
    }

    const maxAge = 0.26;
    if (isFastSwing) {
      const subSteps = 3;
      if (this._hasPrevSample) {
        for (let s = 1; s <= subSteps; s++) {
          const t = s / subSteps;
          const interpToe = new THREE.Vector3().lerpVectors(this._prevToe, toeWorld, t);
          const interpSplice = new THREE.Vector3().lerpVectors(this._prevSplice, spliceWorld, t);
          const midArc = Math.sin(t * Math.PI) * 0.012 * Math.min(2.5, tipSpeed * 0.12);
          interpToe.y -= midArc;
          this.samples.unshift({
            toe: interpToe,
            splice: interpSplice,
            age: (1 - t) * dt
          });
        }
      } else {
        this.samples.unshift({ toe: toeWorld.clone(), splice: spliceWorld.clone(), age: 0 });
      }
    }
    this._prevToe.copy(toeWorld);
    this._prevSplice.copy(spliceWorld);
    this._hasPrevSample = true;

    for (let i = this.samples.length - 1; i >= 0; i--) {
      this.samples[i].age += dt;
      if (this.samples[i].age > maxAge || i >= this.maxSamples) {
        this.samples.splice(i, 1);
      }
    }

    if (this.samples.length < 2) {
      this.mesh.visible = false;
      return;
    }

    this.mesh.visible = true;
    const posAttr = this.geometry.attributes.position;
    const alphaAttr = this.geometry.attributes.aAlpha;
    const count = this.samples.length;

    for (let i = 0; i < this.maxSamples; i++) {
      const idx = Math.min(i, count - 1);
      const s = this.samples[idx];
      const life = Math.max(0, 1 - s.age / maxAge) * (1 - idx / this.maxSamples);

      const vBase = i * 2;
      posAttr.setXYZ(vBase, s.splice.x, s.splice.y, s.splice.z);
      posAttr.setXYZ(vBase + 1, s.toe.x, s.toe.y, s.toe.z);
      alphaAttr.setX(vBase, life);
      alphaAttr.setX(vBase + 1, life);
    }

    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  }
}

// ============================================================================
// #2. VOLUMETRIC 3D HAWK-EYE BALL RIBBON TRAIL (Camera-Billboarded Tapered Mesh)
// ============================================================================
export class CricketBallRibbonTrail {
  constructor(scene, maxPoints = 44) {
    this.scene = scene;
    this.maxPoints = maxPoints;
    this.coreColor = new THREE.Color(0xffffff);
    this.edgeColor = new THREE.Color(0xf59e0b);
    this.baseWidth = 0.16;

    const vertexCount = maxPoints * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 4);
    const indices = [];

    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    this.geometry.setIndex(indices);

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  updateStyleFromPhysics(physics, bowlerType = 'fast', isOnFire = false) {
    if (physics.state === 'hit' || physics.state === 'fielded' || physics.state === 'boundary_flight') {
      if (isOnFire) {
        this.coreColor.setHex(0xffffff);
        this.edgeColor.setHex(0xf97316);
        this.baseWidth = 0.25;
      } else if (physics.vel.length() > 21) {
        // Cracking boundary / lofted shot — bright golden-white broadcast trail
        this.coreColor.setHex(0xffffff);
        this.edgeColor.setHex(0xfbbf24);
        this.baseWidth = 0.23;
      } else {
        this.coreColor.setHex(0xffffff);
        this.edgeColor.setHex(0x38bdf8);
        this.baseWidth = 0.17;
      }
    } else {
      // Bowled delivery: Crimson-Red seam trail for Pace, Cyan-Amber for Spin
      if (bowlerType === 'spin' || physics.spinRpm > 1100) {
        this.coreColor.setHex(0xffffff);
        this.edgeColor.setHex(0x06b6d4);
        this.baseWidth = 0.15;
      } else {
        this.coreColor.setHex(0xffffff);
        this.edgeColor.setHex(0xef4444);
        this.baseWidth = 0.16;
      }
    }
  }

  updateGeometry(physics, camera, bowlerType = 'fast', isOnFire = false) {
    if (!CRICKET_FEEL_FLAGS.volumetricBallRibbon) {
      this.mesh.visible = false;
      return false;
    }

    const count = physics.trailCount || 0;
    if (count < 2 || physics.state === 'idle' || physics.state === 'runup' || physics.state === 'dead') {
      this.mesh.visible = false;
      return true;
    }

    this.updateStyleFromPhysics(physics, bowlerType, isOnFire);
    this.mesh.visible = true;

    const camPos = camera.position;
    // Note: physics.trail stores oldest at index 0 and newest at count - 1
    for (let i = 0; i < this.maxPoints; i++) {
      // Map i=0 to newest point (ball head), i=maxPoints-1 to oldest point (tail)
      const trailIdx = Math.max(0, count - 1 - Math.min(i, count - 1));
      const p = physics.trail[trailIdx] || physics.pos;
      const prevIdx = Math.min(count - 1, trailIdx + 1);
      const nextIdx = Math.max(0, trailIdx - 1);

      _tmpVecA.subVectors(physics.trail[prevIdx] || p, physics.trail[nextIdx] || p);
      if (_tmpVecA.lengthSq() < 1e-6) {
        _tmpVecA.set(0, 0, 1);
      } else {
        _tmpVecA.normalize();
      }

      _tmpVecB.subVectors(camPos, p).normalize();
      _tmpVecC.crossVectors(_tmpVecA, _tmpVecB).normalize();
      if (_tmpVecC.lengthSq() < 1e-4) _tmpVecC.set(1, 0, 0);

      const ageNorm = i / Math.max(1, Math.min(count - 1, this.maxPoints - 1));
      const life = Math.max(0, 1 - ageNorm);
      const halfWidth = this.baseWidth * (0.2 + 0.8 * Math.pow(life, 0.65)) * 0.5;
      const alpha = Math.pow(life, 1.1) * 0.88;

      _tmpColor.copy(this.coreColor).lerp(this.edgeColor, (1 - life) * 0.72);

      const v0 = i * 2;
      const v1 = v0 + 1;

      this.positions[v0 * 3 + 0] = p.x + _tmpVecC.x * halfWidth;
      this.positions[v0 * 3 + 1] = p.y + _tmpVecC.y * halfWidth;
      this.positions[v0 * 3 + 2] = p.z + _tmpVecC.z * halfWidth;

      this.positions[v1 * 3 + 0] = p.x - _tmpVecC.x * halfWidth;
      this.positions[v1 * 3 + 1] = p.y - _tmpVecC.y * halfWidth;
      this.positions[v1 * 3 + 2] = p.z - _tmpVecC.z * halfWidth;

      this.colors[v0 * 4 + 0] = _tmpColor.r;
      this.colors[v0 * 4 + 1] = _tmpColor.g;
      this.colors[v0 * 4 + 2] = _tmpColor.b;
      this.colors[v0 * 4 + 3] = alpha;

      this.colors[v1 * 4 + 0] = _tmpColor.r;
      this.colors[v1 * 4 + 1] = _tmpColor.g;
      this.colors[v1 * 4 + 2] = _tmpColor.b;
      this.colors[v1 * 4 + 3] = alpha;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    return true;
  }
}

// ============================================================================
// #3. STADIUM FLOODLIGHT FRESNEL RIM-SHADER & GROUND CONTACT SHADOWS
// ============================================================================
export function upgradeCricketerMaterials() {
  // Intentionally disabled: scene rimLight already provides natural rim lighting without custom onBeforeCompile shader overhead
}

function createSoftContactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Elongated directional stadium floodlight shadow (opposite keyLight at (+24, +46, -20))
  ctx.save();
  ctx.translate(58, 70);
  ctx.rotate(-0.62);
  ctx.scale(1.45, 0.78);
  const tailGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, 44);
  tailGrad.addColorStop(0.0, 'rgba(4, 14, 8, 0.56)');
  tailGrad.addColorStop(0.55, 'rgba(4, 14, 8, 0.28)');
  tailGrad.addColorStop(1.0, 'rgba(4, 14, 8, 0.0)');
  ctx.fillStyle = tailGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Grounding ambient-occlusion core directly beneath feet / stumps
  const coreGrad = ctx.createRadialGradient(64, 64, 4, 64, 64, 36);
  coreGrad.addColorStop(0.0, 'rgba(2, 8, 5, 0.84)');
  coreGrad.addColorStop(0.55, 'rgba(3, 10, 6, 0.42)');
  coreGrad.addColorStop(1.0, 'rgba(3, 10, 6, 0.0)');
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class PlayerContactShadowManager {
  constructor(scene) {
    this.scene = scene;
    this.shadowTex = createSoftContactShadowTexture();
    this.shadowGeo = new THREE.PlaneGeometry(1.08, 1.08).rotateX(-Math.PI / 2);
    this.actorShadows = new Map();
  }

  attachToActor(actorKey, baseRadius = 0.58, baseOpacity = 0.72) {
    let entry = this.actorShadows.get(actorKey);
    if (!entry) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        opacity: baseOpacity,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(this.shadowGeo, mat);
      mesh.position.y = 0.022;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      entry = { mesh, mat, baseRadius, baseOpacity };
      this.actorShadows.set(actorKey, entry);
    }
    return entry;
  }

  updateActorShadow(actorKey, worldPos, jumpHeight = 0) {
    const entry = this.actorShadows.get(actorKey);
    if (!entry) return;
    if (!CRICKET_FEEL_FLAGS.rimShaderAndShadows || !worldPos) {
      entry.mesh.visible = false;
      return;
    }
    entry.mesh.visible = true;
    entry.mesh.position.set(worldPos.x, 0.022, worldPos.z);
    if (actorKey === 'ball') {
      // Cricket ball shadow tightens & darkens right near the bounce, spreads softer when hit high in the sky
      const spreadScale = THREE.MathUtils.clamp(1.0 + jumpHeight * 0.14, 0.9, 2.35);
      entry.mesh.scale.setScalar(entry.baseRadius * 2.0 * spreadScale);
      entry.mat.opacity = entry.baseOpacity * THREE.MathUtils.clamp(1.0 - jumpHeight * 0.085, 0.22, 0.95);
      return;
    }
    const heightScale = THREE.MathUtils.clamp(1.0 - jumpHeight * 0.25, 0.48, 1.12);
    entry.mesh.scale.setScalar(entry.baseRadius * 2.0 * heightScale);
    entry.mat.opacity = entry.baseOpacity * THREE.MathUtils.clamp(1.0 - jumpHeight * 0.35, 0.28, 1.0);
  }
}

// ============================================================================
// #4. ALIVE BATSMAN ENHANCER (Head Ball Tracking + Pre-Release Trigger + 45Hz Bat Recoil)
// ============================================================================
export class AliveBatsmanEnhancer {
  constructor() {
    this.recoilTimer = 0;
    this.recoilIntensity = 0;
    this.ballCompressTimer = 0;
    this.headYawSmooth = 0;
    this.headPitchSmooth = 0;
    this.triggerStepOffsetZ = 0;
    this.triggerStepDipY = 0;
  }

  triggerBatImpactRecoil(isSweetSpot = true, exitSpeedKmh = 110) {
    if (!CRICKET_FEEL_FLAGS.aliveBatsmanFeel) return;
    this.recoilTimer = 0.26;
    this.recoilIntensity = isSweetSpot
      ? THREE.MathUtils.clamp(exitSpeedKmh / 120, 0.75, 1.35)
      : 0.55;
    this.ballCompressTimer = 0.055;
  }

  update({
    dt,
    strikerPlayer,
    strikerMesh,
    batPivot,
    ballGroup,
    physics,
    bowling,
    runnersInMotion
  }) {
    if (!CRICKET_FEEL_FLAGS.aliveBatsmanFeel) {
      if (strikerMesh) strikerMesh.position.y = 0;
      return;
    }

    // 1. Pre-Release Batsman Trigger Step & Backlift Gather (when bowler is at 70%–98% runup)
    let targetDipY = 0;
    if (
      physics.state === 'runup' &&
      !runnersInMotion &&
      bowling.runupProgress > 0.68 &&
      bowling.runupProgress < 0.99
    ) {
      const phase = (bowling.runupProgress - 0.68) / 0.31;
      targetDipY = -Math.sin(phase * Math.PI) * 0.045;
    }
    this.triggerStepDipY = THREE.MathUtils.damp(this.triggerStepDipY, targetDipY, 18, dt);
    if (strikerMesh && !runnersInMotion) {
      strikerMesh.position.y = this.triggerStepDipY;
    } else if (strikerMesh) {
      strikerMesh.position.y = 0;
    }

    // 2. Real-Time Batsman Head/Eye Tracking of the Approaching Cricket Ball
    const headBone = strikerPlayer?.bones?.headBone;
    if (headBone && strikerMesh && !runnersInMotion) {
      if (physics.state === 'bowled' || physics.state === 'runup') {
        const dx = physics.pos.x - strikerMesh.position.x;
        const dz = Math.max(0.8, strikerMesh.position.z - physics.pos.z);
        const dy = physics.pos.y - 1.52;

        const targetYaw = THREE.MathUtils.clamp(Math.atan2(dx, dz) * 0.65, -0.42, 0.42);
        const targetPitch = THREE.MathUtils.clamp(-Math.atan2(dy, dz) * 0.55, -0.22, 0.38);

        this.headYawSmooth = THREE.MathUtils.damp(this.headYawSmooth, targetYaw, 16, dt);
        this.headPitchSmooth = THREE.MathUtils.damp(this.headPitchSmooth, targetPitch, 16, dt);

        headBone.rotation.y += this.headYawSmooth;
        headBone.rotation.x += this.headPitchSmooth;
      } else {
        this.headYawSmooth = THREE.MathUtils.damp(this.headYawSmooth, 0, 10, dt);
        this.headPitchSmooth = THREE.MathUtils.damp(this.headPitchSmooth, 0, 10, dt);
      }
    }

    // 3. 45Hz Damped Willow Bat Vibration on Ball Contact
    if (this.recoilTimer > 0 && batPivot) {
      this.recoilTimer = Math.max(0, this.recoilTimer - dt);
      const elapsed = 0.26 - this.recoilTimer;
      const env = Math.exp(-18.0 * elapsed) * this.recoilIntensity;
      const vib = Math.sin(elapsed * 45.0 * Math.PI * 2.0) * env;
      batPivot.rotation.x += vib * 0.085;
      batPivot.rotation.z += vib * 0.045;
    }

    // 4. Hard Cork+Leather Micro-Compression (0.92x for 50ms on contact)
    if (ballGroup) {
      if (this.ballCompressTimer > 0) {
        this.ballCompressTimer = Math.max(0, this.ballCompressTimer - dt);
        const c = 0.92 + (1 - this.ballCompressTimer / 0.055) * 0.08;
        ballGroup.scale.set(1.35 / c, 1.35 * c, 1.35 / c);
      } else {
        ballGroup.scale.setScalar(1.35);
      }
    }
  }
}

// ============================================================================
// #5. CRICKET IMPACT VFX (Willow/Leather Seam Sparks + Pitch Bounce Ripple Ring)
// ============================================================================
export class CricketImpactVFXManager {
  constructor(scene) {
    this.scene = scene;
    this.sparks = [];
    this.rings = [];

    const sparkGeo = new THREE.BoxGeometry(0.022, 0.022, 0.16);
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xfef08a : 0xf97316,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 10;
      this.scene.add(mesh);
      this.sparks.push({
        mesh,
        mat,
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 0.28,
        active: false
      });
    }

    const ringGeo = new THREE.RingGeometry(0.14, 0.26, 28);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 8;
      this.scene.add(mesh);
      this.rings.push({
        mesh,
        mat,
        age: 0,
        maxAge: 0.36,
        maxScale: 2.6,
        active: false
      });
    }
  }

  spawnBatHitBurst(contactPos, ballVel, isSweet = true, isOnFire = false) {
    if (!CRICKET_FEEL_FLAGS.cricketImpactVFX || !contactPos) return;

    const sparkCount = isSweet ? 16 : 7;
    const primaryHex = isOnFire ? 0xf97316 : isSweet ? 0xfde047 : 0x38bdf8;
    const secondaryHex = isOnFire ? 0xfef08a : 0xffffff;

    const baseDir = ballVel && ballVel.lengthSq() > 0.1
      ? ballVel.clone().normalize()
      : new THREE.Vector3(0, 0.3, -1);

    let spawned = 0;
    for (let i = 0; i < this.sparks.length && spawned < sparkCount; i++) {
      const s = this.sparks[i];
      if (s.active) continue;
      s.active = true;
      s.age = 0;
      s.maxAge = 0.20 + Math.random() * 0.14;
      s.mesh.position.copy(contactPos);
      s.mat.color.setHex(spawned % 2 === 0 ? primaryHex : secondaryHex);
      s.mat.opacity = 1.0;

      const spread = isSweet ? 0.85 : 0.55;
      s.vel
        .copy(baseDir)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.2) * spread,
            (Math.random() - 0.5) * spread
          )
        )
        .normalize()
        .multiplyScalar(4.5 + Math.random() * 6.5);

      s.mesh.lookAt(_tmpVecA.copy(contactPos).add(s.vel));
      s.mesh.scale.set(1, 1, isSweet ? 1.35 : 0.85);
      s.mesh.visible = true;
      spawned++;
    }

    // Spawn 3D impact shockwave ring + bright contact flash disc oriented toward camera/shot direction
    const ring = this.rings.find((r) => !r.active) || this.rings[0];
    ring.active = true;
    ring.age = 0;
    ring.maxAge = isSweet ? 0.34 : 0.22;
    ring.maxScale = isSweet ? 3.8 : 2.1;
    ring.mesh.position.copy(contactPos);
    ring.mesh.rotation.set(0, 0, 0);
    ring.mesh.scale.setScalar(0.5);
    ring.mat.color.setHex(primaryHex);
    ring.mat.opacity = isSweet ? 0.95 : 0.68;
    ring.mesh.visible = true;

    // Second inner core flash burst for crisp bat-ball impact flash
    const flashRing = this.rings.find((r) => !r.active && r !== ring);
    if (flashRing) {
      flashRing.active = true;
      flashRing.age = 0;
      flashRing.maxAge = 0.14;
      flashRing.maxScale = isSweet ? 2.4 : 1.4;
      flashRing.mesh.position.copy(contactPos);
      flashRing.mesh.rotation.set(0, Math.PI * 0.25, 0);
      flashRing.mesh.scale.setScalar(0.25);
      flashRing.mat.color.setHex(0xffffff);
      flashRing.mat.opacity = 1.0;
      flashRing.mesh.visible = true;
    }
  }

  spawnPitchBounceRipple(bouncePos, speedKmh = 130) {
    if (!CRICKET_FEEL_FLAGS.cricketImpactVFX || !bouncePos) return;
    const ring = this.rings.find((r) => !r.active) || this.rings[0];
    ring.active = true;
    ring.age = 0;
    ring.maxAge = 0.42;
    ring.maxScale = THREE.MathUtils.clamp(speedKmh / 55, 1.8, 2.9);
    ring.mesh.position.set(bouncePos.x, 0.032, bouncePos.z);
    ring.mesh.rotation.set(-Math.PI / 2, 0, 0);
    ring.mesh.scale.setScalar(0.5);
    ring.mat.color.setHex(speedKmh >= 135 ? 0xfef08a : 0xe2e8f0);
    ring.mat.opacity = 0.78;
    ring.mesh.visible = true;
  }

  update(dt) {
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      if (!s.active) continue;
      s.age += dt;
      const t = s.age / s.maxAge;
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.y -= 9.8 * dt * 0.6;
      s.mesh.lookAt(_tmpVecA.copy(s.mesh.position).add(s.vel));
      s.mesh.scale.set(1 - t * 0.5, 1 - t * 0.5, 1 + (1 - t) * 0.8);
      s.mat.opacity = (1 - t) * 0.95;
    }

    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.maxAge;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const easeOut = 1 - Math.pow(1 - t, 2.2);
      r.mesh.scale.setScalar(0.45 + easeOut * r.maxScale);
      r.mat.opacity = (1 - t) * 0.82;
    }
  }
}

// ============================================================================
// #6. FLOATING 3D-TO-2D SHOT TELEMETRY ABOVE BATSMAN HELMET
// ============================================================================
export class FloatingShotTelemetryHUD {
  constructor() {
    this.el = null;
    this.activeTimer = 0;
    this.maxDuration = 1.25;
    this.anchorWorldPos = new THREE.Vector3();
    this._ensureDOMElement();
  }

  _ensureDOMElement() {
    if (typeof document === 'undefined') return;
    let existing = document.getElementById('floating-shot-telemetry');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'floating-shot-telemetry';
      existing.className =
        'pointer-events-none fixed z-30 hidden -translate-x-1/2 -translate-y-full transition-opacity duration-75';
      existing.innerHTML = `
        <div id="floating-shot-pill" class="px-3 py-1 rounded-md border border-amber-400/80 bg-slate-950/90 backdrop-blur-md shadow-lg text-center whitespace-nowrap">
          <div id="floating-shot-grade" class="text-[11px] font-black tracking-wider uppercase text-amber-300">PERFECT TIMING</div>
          <div id="floating-shot-detail" class="text-[10px] font-bold text-white/90">COVER DRIVE • 142 KM/H</div>
        </div>
      `;
      document.body.appendChild(existing);
    }
    this.el = existing;
    this.pillEl = document.getElementById('floating-shot-pill');
    this.gradeEl = document.getElementById('floating-shot-grade');
    this.detailEl = document.getElementById('floating-shot-detail');
  }

  triggerPopup({ strikerPos, gradeText, detailText, isSweet = true, isOnFire = false }) {
    if (!CRICKET_FEEL_FLAGS.floatingShotTelemetry) return;
    this._ensureDOMElement();
    if (!this.el) return;

    this.anchorWorldPos.copy(strikerPos).add(new THREE.Vector3(0.55, 2.45, 0));
    this.activeTimer = this.maxDuration;

    if (this.gradeEl) {
      this.gradeEl.textContent = gradeText;
      this.gradeEl.className = isOnFire
        ? 'text-[12px] font-black tracking-wider uppercase text-orange-400'
        : isSweet
          ? 'text-[11px] font-black tracking-wider uppercase text-emerald-300'
          : 'text-[11px] font-black tracking-wider uppercase text-sky-300';
    }
    if (this.detailEl) {
      this.detailEl.textContent = detailText;
    }
    if (this.pillEl) {
      this.pillEl.className = isOnFire
        ? 'px-3 py-1 rounded-md border border-orange-500/90 bg-slate-950/90 backdrop-blur-md shadow-lg text-center whitespace-nowrap'
        : isSweet
          ? 'px-3 py-1 rounded-md border border-emerald-400/80 bg-slate-950/90 backdrop-blur-md shadow-lg text-center whitespace-nowrap'
          : 'px-3 py-1 rounded-md border border-sky-400/70 bg-slate-950/90 backdrop-blur-md shadow-lg text-center whitespace-nowrap';
    }
    this.el.classList.remove('hidden');
  }

  update(dt, camera) {
    if (!this.el || this.activeTimer <= 0) return;
    if (!CRICKET_FEEL_FLAGS.floatingShotTelemetry) {
      this.el.classList.add('hidden');
      this.activeTimer = 0;
      return;
    }

    this.activeTimer = Math.max(0, this.activeTimer - dt);
    if (this.activeTimer <= 0) {
      this.el.classList.add('hidden');
      return;
    }

    const progress = 1 - this.activeTimer / this.maxDuration;
    const projected = this.anchorWorldPos.clone();
    projected.y += progress * 0.65; // Float gently upward in 3D space
    projected.project(camera);

    if (projected.z < -1 || projected.z > 1) {
      this.el.classList.add('hidden');
      return;
    }

    const screenX = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const screenY = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    const opacity = this.activeTimer < 0.28 ? this.activeTimer / 0.28 : 1.0;

    this.el.style.left = `${Math.round(screenX)}px`;
    this.el.style.top = `${Math.round(screenY)}px`;
    this.el.style.opacity = String(opacity.toFixed(2));
  }
}

// ============================================================================
// #7. ALIVE 3D STADIUM CROWD (Tennis-Style Head+Torso Spectators + Cheer Bounce)
// ============================================================================
export class StadiumCrowdAnimator {
  constructor() {
    this.crowdBowls = [];
    this.cheerEnergy = 0.22;
    this.elapsedTime = 0;
  }

  /**
   * Builds a composite Head + Torso + Fan Flag 3D Spectator Crowd Bowl for a stadium
   * (Replaces static BoxGeometry cubes with expressive Mii/Tennis-style silhouettes)
   */
  buildCrowdBowl(group, crowdCount, palette) {
    // Split crowd across two staggered wave groups so cheers ripple organically with ZERO per-frame CPU loops
    const denseCount = Math.min(760, Math.round(crowdCount * 1.55));
    const countA = Math.ceil(denseCount * 0.5);
    const countB = denseCount - countA;

    const torsoGeo = new THREE.CylinderGeometry(0.24, 0.30, 0.68, 7);
    torsoGeo.scale(1.24, 1.0, 0.76);
    const torsoMat = new THREE.MeshStandardMaterial({ roughness: 0.56, metalness: 0.04 });
    const torsoInstA = new THREE.InstancedMesh(torsoGeo, torsoMat, countA);
    const torsoInstB = new THREE.InstancedMesh(torsoGeo, torsoMat, countB);

    const headGeo = new THREE.SphereGeometry(0.185, 8, 6);
    const headMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.03 });
    const headInstA = new THREE.InstancedMesh(headGeo, headMat, countA);
    const headInstB = new THREE.InstancedMesh(headGeo, headMat, countB);

    const flagCount = Math.max(12, Math.floor(denseCount / 11));
    const flagGeo = new THREE.BoxGeometry(0.78, 0.44, 0.05);
    const flagMat = new THREE.MeshStandardMaterial({ roughness: 0.42, emissive: 0x111111 });
    const flagInst = new THREE.InstancedMesh(flagGeo, flagMat, flagCount);

    const skinPalette = [0xd69e72, 0xc68642, 0xe0ac69, 0x8d5524, 0xf1c27d];
    let idxA = 0;
    let idxB = 0;
    let flagIdx = 0;

    for (let i = 0; i < denseCount; i++) {
      const tier = i % 6;
      const angle = (i / denseCount) * Math.PI * 2 + tier * 0.045 + ((i % 7) - 3) * 0.008;
      // Leave clean sightline gap right behind both sightscreens (cos(ang) near ±1)
      const r = BOUNDARY_RADIUS + 7.6 + tier * 2.45;
      const baseY = 1.9 + tier * 1.95;
      const scaleVar = 0.88 + (i % 5) * 0.055;

      const isB = ((Math.floor(angle * 4) + tier) % 2) === 1 && idxB < countB;
      const tInst = isB || idxA >= countA ? torsoInstB : torsoInstA;
      const hInst = isB || idxA >= countA ? headInstB : headInstA;
      const slot = tInst === torsoInstB ? idxB++ : idxA++;

      _dummy.position.set(Math.sin(angle) * r, baseY, Math.cos(angle) * r);
      _dummy.rotation.set(0, angle + Math.PI, 0);
      _dummy.scale.setScalar(scaleVar);
      _dummy.updateMatrix();
      tInst.setMatrixAt(slot, _dummy.matrix);
      tInst.setColorAt(slot, _tmpColor.setHex(palette[i % palette.length]));

      _dummy.position.set(Math.sin(angle) * r, baseY + 0.52 * scaleVar, Math.cos(angle) * r);
      _dummy.scale.setScalar(scaleVar);
      _dummy.updateMatrix();
      hInst.setMatrixAt(slot, _dummy.matrix);
      const headHex = i % 3 === 0 ? palette[(i + 1) % palette.length] : skinPalette[i % skinPalette.length];
      hInst.setColorAt(slot, _tmpColor.setHex(headHex));

      if (i % 11 === 0 && flagIdx < flagCount) {
        _dummy.position.set(Math.sin(angle) * r, baseY + 0.94 * scaleVar, Math.cos(angle) * r);
        _dummy.rotation.set(0, angle + Math.PI, (flagIdx % 2 === 0 ? 1 : -1) * 0.16);
        _dummy.scale.setScalar(1.0);
        _dummy.updateMatrix();
        flagInst.setMatrixAt(flagIdx, _dummy.matrix);
        flagInst.setColorAt(flagIdx, _tmpColor.setHex(palette[(i + 2) % palette.length]));
        flagIdx++;
      }
    }

    [torsoInstA, torsoInstB, headInstA, headInstB, flagInst].forEach((inst) => {
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
    });

    const bowlGroup = new THREE.Group();
    bowlGroup.add(torsoInstA, torsoInstB, headInstA, headInstB, flagInst);
    group.add(bowlGroup);

    this.crowdBowls.push({
      bowlGroup,
      torsoInst: torsoInstA,
      torsoInstB,
      headInst: headInstA,
      headInstB,
      flagInst
    });
  }

  /**
   * Triggers a massive crowd cheer bounce when a 4, 6, Wicket, or Milestone occurs!
   */
  triggerCheerSurge(intensity = 1.0) {
    this.cheerEnergy = Math.max(this.cheerEnergy, THREE.MathUtils.clamp(intensity, 0.35, 1.35));
  }

  update(dt) {
    this.elapsedTime += dt;
    this.cheerEnergy = Math.max(0.22, this.cheerEnergy - dt * 0.24);

    if (!CRICKET_FEEL_FLAGS.aliveStadiumCrowd) {
      for (let i = 0; i < this.crowdBowls.length; i++) {
        this.crowdBowls[i].bowlGroup.position.y = 0;
        this.crowdBowls[i].bowlGroup.rotation.y = 0;
      }
      return;
    }

    const freq = 5.2 + this.cheerEnergy * 5.0;
    const bounceAmp = 0.03 + this.cheerEnergy * 0.17;
    const bounceYA = Math.abs(Math.sin(this.elapsedTime * freq)) * bounceAmp;
    const bounceYB = Math.abs(Math.sin(this.elapsedTime * freq + 1.45)) * bounceAmp;
    const flagWaveY = Math.abs(Math.cos(this.elapsedTime * (freq * 1.25))) * (bounceAmp * 1.45);

    for (let i = 0; i < this.crowdBowls.length; i++) {
      const b = this.crowdBowls[i];
      b.torsoInst.position.y = bounceYA;
      b.headInst.position.y = bounceYA * 1.12;
      if (b.torsoInstB) b.torsoInstB.position.y = bounceYB;
      if (b.headInstB) b.headInstB.position.y = bounceYB * 1.12;
      b.flagInst.position.y = flagWaveY;
    }
  }
}
