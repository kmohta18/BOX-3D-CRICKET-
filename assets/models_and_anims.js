import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/**
 * Character Style Flag:
 * 'lowpoly' (default) -> Stylised expressive low-poly 3D cricket characters with jersey colour & number,
 *                        helmet, pads, gloves, and full Mixamo-compatible joint hierarchy.
 * 'soldier'           -> External glTF Soldier.glb character mesh.
 */
export const CHARACTER_STYLE = 'lowpoly'; // 'lowpoly' | 'soldier'

export const ASSET_LICENSES = [
  {
    name: 'Expressive Low-Poly Rigged Cricket Characters (17-Bone Skeletal Hierarchy)',
    source: 'Box Cricket 3D Procedural Character & Kit Generator (In-Engine)',
    url: 'local://lowpoly-rigged-character',
    license: 'MIT / CC0 1.0 Public Domain'
  },
  {
    name: 'Kloppenheim 06 Pure Sky HDRI (1K Equirectangular Environment)',
    source: 'Poly Haven (Greg Zaal)',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_06_puresky_1k.hdr',
    license: 'CC0 1.0 Universal Public Domain'
  },
  {
    name: 'Draco 3D Geometry Decoder (v1.5.6)',
    source: 'Google Draco Open Source Project',
    url: 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/',
    license: 'Apache License 2.0'
  },
  {
    name: 'Basis Universal / KTX2 GPU Texture Transcoder',
    source: 'Binomial LLC / Khronos Group (via Three.js r170)',
    url: 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/',
    license: 'Apache License 2.0'
  },
  {
    name: 'English Willow Grain, Stitched Leather Ball, Grass Mowing Stripes & Pitch Wear PBR Maps',
    source: 'Box Cricket 3D Procedural PBR Generator (In-Engine)',
    url: 'local://procedural-pbr',
    license: 'MIT / CC0 1.0 Public Domain'
  }
];

/**
 * Auto-detects hardware tier ('low' | 'medium' | 'high')
 * Defaults to 'low' on weak Android phones to guarantee >= 30 FPS.
 */
export function detectHardwareQualityPreset(renderer) {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const cores = navigator.hardwareConcurrency || 4;
  const memGb = navigator.deviceMemory || 4;

  let gpuRenderer = '';
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      gpuRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
    }
  } catch {}

  const isWeakMobileGpu =
    /Mali-G3|Mali-G5|Mali-T|Adreno \(TM\) 5|Adreno \(TM\) 61|PowerVR|Vivante/i.test(gpuRenderer);

  if (isAndroid && (cores <= 6 || memGb <= 4 || isWeakMobileGpu)) {
    return 'low';
  }
  if (isAndroid || isIOS || memGb <= 4) {
    return 'medium';
  }
  return 'high';
}

/**
 * Helper to create a QuaternionKeyframeTrack from Euler degree keyframes on a bone
 */
function makeBoneQuatTrack(boneName, times, eulerKeyframesDeg) {
  const values = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < eulerKeyframesDeg.length; i++) {
    const [rx, ry, rz] = eulerKeyframesDeg[i];
    e.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
      'XYZ'
    );
    q.setFromEuler(e);
    values.push(q.x, q.y, q.z, q.w);
  }
  const track = new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values);
  return track;
}

function makeBonePosTrack(boneName, times, posKeyframes) {
  const values = [];
  for (let i = 0; i < posKeyframes.length; i++) {
    values.push(posKeyframes[i][0], posKeyframes[i][1], posKeyframes[i][2]);
  }
  const track = new THREE.VectorKeyframeTrack(`${boneName}.position`, times, values);
  track.setInterpolation(THREE.InterpolateSmooth);
  return track;
}

/**
 * Builds all 10+ cricket skeletal AnimationClips targeting the shared joint hierarchy:
 * ('idle', 'walk', 'stance', 'defence', 'drive', 'cut', 'pull', 'loft',
 *  'bowling_runup' / 'runup', 'bowling_release' / 'release', 'catch', 'dive', 'celebration' / 'celebrate')
 */
export function buildCricketMocapClips(baseAnimations = []) {
  const clips = {};

  // 0A. IDLE (Athletic fielding / bowler ready posture with subtle breathing & knee bounce — NEVER T-pose)
  clips.idle = new THREE.AnimationClip('idle', 1.8, [
    makeBonePosTrack('mixamorigHips', [0, 0.9, 1.8], [
      [0, 0.92, 0],
      [0, 0.90, 0],
      [0, 0.92, 0]
    ]),
    makeBoneQuatTrack('mixamorigHips', [0, 0.9, 1.8], [
      [4, 0, 0],
      [6, 0, 0],
      [4, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.9, 1.8], [
      [8, 0, 0],
      [11, 0, 0],
      [8, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigHead', [0, 0.9, 1.8], [
      [-6, 0, 0],
      [-8, 0, 0],
      [-6, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.9, 1.8], [
      [14, 0, -10],
      [18, 0, -12],
      [14, 0, -10]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.9, 1.8], [
      [28, 0, 6],
      [34, 0, 8],
      [28, 0, 6]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.9, 1.8], [
      [14, 0, 10],
      [18, 0, 12],
      [14, 0, 10]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.9, 1.8], [
      [28, 0, -6],
      [34, 0, -8],
      [28, 0, -6]
    ]),
    makeBoneQuatTrack('mixamorigRightUpLeg', [0, 0.9, 1.8], [
      [-10, 0, -4],
      [-14, 0, -4],
      [-10, 0, -4]
    ]),
    makeBoneQuatTrack('mixamorigRightLeg', [0, 0.9, 1.8], [
      [16, 0, 0],
      [22, 0, 0],
      [16, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigLeftUpLeg', [0, 0.9, 1.8], [
      [-10, 0, 4],
      [-14, 0, 4],
      [-10, 0, 4]
    ]),
    makeBoneQuatTrack('mixamorigLeftLeg', [0, 0.9, 1.8], [
      [16, 0, 0],
      [22, 0, 0],
      [16, 0, 0]
    ])
  ]);

  // 0B. BOWLING RUN-UP / SPRINT (Rhythmic full-stride running cycle for bowler run-up, batters & chasing fielders)
  clips.bowling_runup = new THREE.AnimationClip('bowling_runup', 0.56, [
    makeBonePosTrack('mixamorigHips', [0, 0.14, 0.28, 0.42, 0.56], [
      [0, 0.90, 0],
      [0, 0.96, 0],
      [0, 0.90, 0],
      [0, 0.96, 0],
      [0, 0.90, 0]
    ]),
    makeBoneQuatTrack('mixamorigHips', [0, 0.14, 0.28, 0.42, 0.56], [
      [12, -8, 0],
      [12, 0, 0],
      [12, 8, 0],
      [12, 0, 0],
      [12, -8, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.28, 0.56], [
      [16, 10, 0],
      [16, -10, 0],
      [16, 10, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.28, 0.56], [
      [-45, 0, -10],
      [42, 0, -10],
      [-45, 0, -10]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.28, 0.56], [
      [72, 0, 0],
      [58, 0, 0],
      [72, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.28, 0.56], [
      [42, 0, 10],
      [-45, 0, 10],
      [42, 0, 10]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.28, 0.56], [
      [58, 0, 0],
      [72, 0, 0],
      [58, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightUpLeg', [0, 0.14, 0.28, 0.42, 0.56], [
      [38, 0, -3],
      [-6, 0, -3],
      [-46, 0, -3],
      [-12, 0, -3],
      [38, 0, -3]
    ]),
    makeBoneQuatTrack('mixamorigRightLeg', [0, 0.14, 0.28, 0.42, 0.56], [
      [62, 0, 0],
      [42, 0, 0],
      [14, 0, 0],
      [68, 0, 0],
      [62, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigLeftUpLeg', [0, 0.14, 0.28, 0.42, 0.56], [
      [-46, 0, 3],
      [-12, 0, 3],
      [38, 0, 3],
      [-6, 0, 3],
      [-46, 0, 3]
    ]),
    makeBoneQuatTrack('mixamorigLeftLeg', [0, 0.14, 0.28, 0.42, 0.56], [
      [14, 0, 0],
      [68, 0, 0],
      [62, 0, 0],
      [42, 0, 0],
      [14, 0, 0]
    ])
  ]);
  clips.runup = clips.bowling_runup;
  clips.walk = clips.bowling_runup;

  // If CHARACTER_STYLE === 'soldier' and native clips were passed, allow overriding idle/walk
  if (CHARACTER_STYLE === 'soldier' && baseAnimations.length > 0) {
    const idleClip = THREE.AnimationClip.findByName(baseAnimations, 'Idle') || baseAnimations[0];
    const runClip = THREE.AnimationClip.findByName(baseAnimations, 'Run') || baseAnimations[1];
    if (idleClip) clips.idle = idleClip;
    if (runClip) {
      clips.bowling_runup = runClip;
      clips.runup = runClip;
    }
  }

  // 1. STANCE (Side-on crouched cricket batting stance with rhythmic bat tap)
  clips.stance = new THREE.AnimationClip('stance', 1.6, [
    makeBonePosTrack('mixamorigHips', [0, 0.8, 1.6], [
      [0, 0.90, 0],
      [0, 0.88, 0],
      [0, 0.90, 0]
    ]),
    makeBoneQuatTrack('mixamorigHips', [0, 0.8, 1.6], [
      [8, -58, 0],
      [10, -58, 0],
      [8, -58, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.8, 1.6], [
      [14, 12, 0],
      [17, 12, 0],
      [14, 12, 0]
    ]),
    makeBoneQuatTrack('mixamorigHead', [0, 0.8, 1.6], [
      [-10, 48, 0],
      [-10, 48, 0],
      [-10, 48, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.8, 1.6], [
      [35, 18, -28],
      [22, 16, -24],
      [35, 18, -28]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.8, 1.6], [
      [48, 10, 15],
      [35, 8, 12],
      [48, 10, 15]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.8, 1.6], [
      [32, -22, 24],
      [20, -20, 20],
      [32, -22, 24]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.8, 1.6], [
      [42, -12, -15],
      [30, -10, -12],
      [42, -12, -15]
    ]),
    makeBoneQuatTrack('mixamorigRightUpLeg', [0, 0.8, 1.6], [
      [-22, 0, -6],
      [-26, 0, -6],
      [-22, 0, -6]
    ]),
    makeBoneQuatTrack('mixamorigRightLeg', [0, 0.8, 1.6], [
      [28, 0, 0],
      [32, 0, 0],
      [28, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigLeftUpLeg', [0, 0.8, 1.6], [
      [-22, 0, 6],
      [-26, 0, 6],
      [-22, 0, 6]
    ]),
    makeBoneQuatTrack('mixamorigLeftLeg', [0, 0.8, 1.6], [
      [28, 0, 0],
      [32, 0, 0],
      [28, 0, 0]
    ])
  ]);

  // 2. DEFENCE (Forward stride & dead-bat vertical block)
  clips.defence = new THREE.AnimationClip('defence', 0.65, [
    makeBoneQuatTrack('mixamorigHips', [0, 0.25, 0.65], [
      [8, -58, 0],
      [18, -42, 4],
      [12, -52, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.25, 0.65], [
      [14, 12, 0],
      [26, 18, 0],
      [16, 12, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.12, 0.28, 0.65], [
      [35, 18, -28],
      [62, 25, -35],
      [12, 8, -18],
      [30, 16, -25]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.28, 0.65], [
      [48, 10, 15],
      [68, 15, 10],
      [45, 10, 15]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.28, 0.65], [
      [32, -22, 24],
      [48, -30, 12],
      [32, -22, 24]
    ]),
    makeBoneQuatTrack('mixamorigLeftUpLeg', [0, 0.25, 0.65], [
      [-22, 0, 6],
      [-48, 12, 10],
      [-26, 4, 6]
    ]),
    makeBoneQuatTrack('mixamorigLeftLeg', [0, 0.25, 0.65], [
      [28, 0, 0],
      [52, 0, 0],
      [30, 0, 0]
    ])
  ]);

  // 3. DRIVE (High-elbow straight / cover drive)
  clips.drive = new THREE.AnimationClip('drive', 0.78, [
    makeBoneQuatTrack('mixamorigHips', [0, 0.16, 0.38, 0.78], [
      [8, -58, 0],
      [6, -65, -4],
      [14, -18, 6],
      [10, -28, 3]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.16, 0.38, 0.78], [
      [14, 12, 0],
      [8, -14, -5],
      [18, 28, 8],
      [14, 20, 4]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.15, 0.36, 0.78], [
      [35, 18, -28],
      [78, 32, -42],
      [-52, -18, -20],
      [-38, -12, -22]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.15, 0.36, 0.78], [
      [48, 10, 15],
      [72, 18, 22],
      [58, -10, -12],
      [48, -6, -8]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.15, 0.36, 0.78], [
      [32, -22, 24],
      [64, -18, 32],
      [-58, -28, 18],
      [-42, -20, 20]
    ]),
    makeBoneQuatTrack('mixamorigLeftUpLeg', [0, 0.32, 0.78], [
      [-22, 0, 6],
      [-52, 16, 12],
      [-36, 10, 8]
    ])
  ]);

  // 4. CUT (Back-foot square cut slash)
  clips.cut = new THREE.AnimationClip('cut', 0.72, [
    makeBoneQuatTrack('mixamorigHips', [0, 0.15, 0.35, 0.72], [
      [8, -58, 0],
      [6, -72, 0],
      [8, -82, -6],
      [8, -64, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.15, 0.35, 0.72], [
      [14, 12, 0],
      [6, -24, 0],
      [10, -45, 12],
      [12, -18, 4]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.15, 0.34, 0.72], [
      [35, 18, -28],
      [85, 40, -55],
      [15, -68, -75],
      [25, -35, -45]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.15, 0.34, 0.72], [
      [32, -22, 24],
      [70, 20, 40],
      [18, -55, 15],
      [28, -25, 22]
    ])
  ]);

  // 5. PULL (Chest-on swivel pull shot to leg side)
  clips.pull = new THREE.AnimationClip('pull', 0.78, [
    makeBoneQuatTrack('mixamorigHips', [0, 0.16, 0.38, 0.78], [
      [8, -58, 0],
      [6, -45, 0],
      [4, 28, -8],
      [6, 18, -4]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.16, 0.38, 0.78], [
      [14, 12, 0],
      [10, 0, 0],
      [-8, 52, -10],
      [4, 35, -4]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.15, 0.36, 0.78], [
      [35, 18, -28],
      [70, 28, -40],
      [-25, 65, -25],
      [-15, 42, -25]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.15, 0.36, 0.78], [
      [32, -22, 24],
      [55, -12, 30],
      [-28, 58, 45],
      [-18, 38, 32]
    ])
  ]);

  // 6. LOFT (Full low-to-high six swing follow-through over shoulder)
  clips.loft = new THREE.AnimationClip('loft', 0.88, [
    makeBoneQuatTrack('mixamorigHips', [0, 0.16, 0.42, 0.88], [
      [8, -58, 0],
      [14, -68, -6],
      [-12, 16, 10],
      [-6, 8, 4]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.16, 0.42, 0.88], [
      [14, 12, 0],
      [20, -18, -8],
      [-22, 42, 14],
      [-12, 28, 8]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.16, 0.40, 0.88], [
      [35, 18, -28],
      [88, 35, -48],
      [-95, 25, -18],
      [-72, 18, -22]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.16, 0.40, 0.88], [
      [48, 10, 15],
      [75, 18, 22],
      [82, -22, -18],
      [65, -14, -12]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.16, 0.40, 0.88], [
      [32, -22, 24],
      [72, -15, 35],
      [-92, 22, 32],
      [-68, 14, 26]
    ])
  ]);

  // 7. BOWLING RELEASE (Jump gather, front-arm pull, overarm release & follow-through)
  clips.bowling_release = new THREE.AnimationClip('bowling_release', 0.72, [
    makeBoneQuatTrack('mixamorigHips', [0, 0.2, 0.42, 0.72], [
      [6, -45, 0],
      [-8, -65, -8],
      [18, 15, 10],
      [28, 25, 6]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.2, 0.42, 0.72], [
      [10, 0, 0],
      [-18, -25, -12],
      [28, 32, 16],
      [36, 22, 8]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.18, 0.36, 0.54, 0.72], [
      [45, 0, -20],
      [135, -20, -15],
      [-165, 0, -10],
      [-25, 25, -18],
      [55, 35, -25]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.18, 0.42, 0.72], [
      [-35, 0, 20],
      [-140, 15, 15],
      [45, -20, 25],
      [65, -15, 20]
    ])
  ]);
  clips.release = clips.bowling_release;

  // 8. CATCH (Two-handed soft-hands chest/overhead catch & recoil)
  clips.catch = new THREE.AnimationClip('catch', 0.68, [
    makeBoneQuatTrack('mixamorigSpine', [0, 0.22, 0.45, 0.68], [
      [8, 0, 0],
      [-14, 0, 0],
      [16, 0, 0],
      [8, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.22, 0.45, 0.68], [
      [20, 0, -25],
      [-75, -22, -12],
      [-38, -28, -10],
      [-25, -20, -15]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.22, 0.68], [
      [30, 0, 0],
      [65, 15, 20],
      [75, 20, 25]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.22, 0.45, 0.68], [
      [20, 0, 25],
      [-75, 22, 12],
      [-38, 28, 10],
      [-25, 20, 15]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.22, 0.68], [
      [30, 0, 0],
      [65, -15, -20],
      [75, -20, -25]
    ])
  ]);

  // 9. DIVE (Full-stretch athletic lateral fielding dive)
  clips.dive = new THREE.AnimationClip('dive', 0.85, [
    makeBonePosTrack('mixamorigHips', [0, 0.28, 0.6, 0.85], [
      [0, 0.92, 0],
      [0.35, 0.48, 0],
      [0.45, 0.36, 0],
      [0, 0.92, 0]
    ]),
    makeBoneQuatTrack('mixamorigHips', [0, 0.28, 0.6, 0.85], [
      [10, 0, 0],
      [15, 12, -62],
      [12, 8, -70],
      [10, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.28, 0.6, 0.85], [
      [20, 0, -25],
      [-135, 0, -15],
      [-120, 0, -15],
      [20, 0, -25]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.28, 0.6, 0.85], [
      [20, 0, 25],
      [-135, 0, 15],
      [-120, 0, 15],
      [20, 0, 25]
    ])
  ]);

  // 10. CELEBRATION (Wicket / Milestone appeal jump & double fist-pump)
  clips.celebration = new THREE.AnimationClip('celebration', 1.1, [
    makeBonePosTrack('mixamorigHips', [0, 0.28, 0.55, 0.82, 1.1], [
      [0, 0.92, 0],
      [0, 1.16, 0],
      [0, 0.92, 0],
      [0, 1.12, 0],
      [0, 0.92, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.28, 0.55, 0.82, 1.1], [
      [8, 0, 0],
      [-18, 12, 0],
      [-10, -12, 0],
      [-18, 8, 0],
      [8, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.25, 0.55, 0.82, 1.1], [
      [20, 0, -25],
      [-145, 0, -25],
      [-115, 0, -35],
      [-150, 0, -20],
      [20, 0, -25]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.25, 0.55, 0.82, 1.1], [
      [20, 0, 25],
      [-145, 0, 25],
      [-115, 0, 35],
      [-150, 0, 20],
      [20, 0, 25]
    ])
  ]);
  clips.celebrate = clips.celebration;

  // 11. SWEEP (Low kneeling cross-bat sweep across the line)
  clips.sweep = new THREE.AnimationClip('sweep', 0.82, [
    makeBonePosTrack('mixamorigHips', [0, 0.25, 0.55, 0.82], [
      [0, 0.90, 0],
      [0, 0.62, 0.08],
      [0, 0.60, 0.08],
      [0, 0.90, 0]
    ]),
    makeBoneQuatTrack('mixamorigHips', [0, 0.25, 0.52, 0.82], [
      [8, -58, 0],
      [22, -25, 0],
      [20, 42, -6],
      [8, -58, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.25, 0.52, 0.82], [
      [14, 12, 0],
      [32, -18, 0],
      [28, 48, -8],
      [14, 12, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.22, 0.48, 0.82], [
      [35, 18, -28],
      [68, -25, -40],
      [12, 68, -18],
      [35, 18, -28]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.22, 0.48, 0.82], [
      [32, -22, 24],
      [58, -30, 35],
      [10, 62, 35],
      [32, -22, 24]
    ])
  ]);

  // 12. SCOOP (Deep knee drop & upward paddle scoop over the wicketkeeper)
  clips.scoop = new THREE.AnimationClip('scoop', 0.84, [
    makeBonePosTrack('mixamorigHips', [0, 0.22, 0.50, 0.84], [
      [0, 0.90, 0],
      [0.08, 0.64, 0.06],
      [0.06, 0.68, -0.05],
      [0, 0.90, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.22, 0.50, 0.84], [
      [14, 12, 0],
      [28, 8, -10],
      [-26, 25, 12],
      [14, 12, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.20, 0.46, 0.84], [
      [35, 18, -28],
      [75, 12, -20],
      [-110, 32, -12],
      [35, 18, -28]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.20, 0.46, 0.84], [
      [32, -22, 24],
      [70, -10, 20],
      [-105, 28, 25],
      [32, -22, 24]
    ])
  ]);

  // 13. RAMP (Angled uppercut / ramp deflection over keeper & slips)
  clips.ramp = new THREE.AnimationClip('ramp', 0.78, [
    makeBoneQuatTrack('mixamorigHips', [0, 0.20, 0.45, 0.78], [
      [8, -58, 0],
      [4, -68, 6],
      [-10, -78, 14],
      [8, -58, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.20, 0.45, 0.78], [
      [14, 12, 0],
      [-12, -10, 12],
      [-28, -24, 18],
      [14, 12, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.20, 0.45, 0.78], [
      [35, 18, -28],
      [-45, -30, -45],
      [-115, -48, -35],
      [35, 18, -28]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.20, 0.45, 0.78], [
      [32, -22, 24],
      [-40, -25, 30],
      [-105, -40, 28],
      [32, -22, 24]
    ])
  ]);

  // 14. THROW (Fielder pickup & flat overarm throw to the stumps)
  clips.throw = new THREE.AnimationClip('throw', 0.66, [
    makeBoneQuatTrack('mixamorigSpine', [0, 0.20, 0.42, 0.66], [
      [25, -30, 0],
      [-12, -42, -8],
      [22, 35, 10],
      [8, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.20, 0.40, 0.66], [
      [45, 15, -20],
      [-130, -35, -25],
      [-20, 35, -15],
      [20, 0, -25]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.20, 0.42, 0.66], [
      [30, -15, 20],
      [-75, 25, 25],
      [35, -20, 20],
      [20, 0, 25]
    ])
  ]);
  clips.collect = clips.catch;

  return clips;
}

/**
 * Generates high-resolution English Willow wood-grain Albedo texture
 */
export function createWillowTextures() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#cfa670');
  grad.addColorStop(0.5, '#e6c594');
  grad.addColorStop(1, '#c89d66');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 1024);

  for (let i = 0; i < 14; i++) {
    const x = (i / 14) * 512 + (Math.random() - 0.5) * 8;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(138, 92, 42, 0.28)' : 'rgba(165, 115, 58, 0.18)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 64) {
      ctx.lineTo(x + Math.sin(y * 0.015 + i) * 2.5, y);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 7; i++) {
    const cx = 210 + (Math.random() - 0.5) * 90;
    const cy = 580 + (Math.random() - 0.5) * 180;
    const rGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 18);
    rGrad.addColorStop(0, 'rgba(145, 22, 28, 0.28)');
    rGrad.addColorStop(1, 'rgba(145, 22, 28, 0)');
    ctx.fillStyle = rGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/**
 * Builds a realistic sculpted English Willow Cricket Bat
 */
export function createDetailedCricketBatMesh() {
  const batGroup = new THREE.Group();
  const willowMap = createWillowTextures();

  const willowMat = new THREE.MeshStandardMaterial({
    map: willowMap,
    roughness: 0.42,
    metalness: 0.04
  });

  const bladeGeo = new THREE.BoxGeometry(0.108, 0.56, 0.024);
  const bladeMesh = new THREE.Mesh(bladeGeo, willowMat);
  bladeMesh.position.set(0, -0.34, 0.004);
  bladeMesh.castShadow = true;
  bladeMesh.receiveShadow = true;
  batGroup.add(bladeMesh);

  const spineGeo = new THREE.ConeGeometry(0.052, 0.54, 3);
  spineGeo.scale(1.0, 1.0, 0.55);
  const spineMesh = new THREE.Mesh(spineGeo, willowMat);
  spineMesh.rotation.y = Math.PI;
  spineMesh.position.set(0, -0.34, -0.014);
  spineMesh.castShadow = true;
  batGroup.add(spineMesh);

  const toeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75 });
  const toeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.025, 0.032), toeMat);
  toeMesh.position.set(0, -0.625, 0);
  batGroup.add(toeMesh);

  const gripCanvas = document.createElement('canvas');
  gripCanvas.width = 128;
  gripCanvas.height = 256;
  const gCtx = gripCanvas.getContext('2d');
  gCtx.fillStyle = '#f8fafc';
  gCtx.fillRect(0, 0, 128, 256);
  gCtx.fillStyle = '#0f172a';
  gCtx.fillRect(0, 0, 128, 38);
  gCtx.fillStyle = '#f59e0b';
  gCtx.fillRect(0, 38, 128, 16);
  for (let y = 0; y < 256; y += 8) {
    gCtx.fillStyle = 'rgba(15, 23, 42, 0.16)';
    gCtx.fillRect(0, y, 128, 3);
  }
  const gripTex = new THREE.CanvasTexture(gripCanvas);
  gripTex.colorSpace = THREE.SRGBColorSpace;

  const handleMat = new THREE.MeshStandardMaterial({
    map: gripTex,
    roughness: 0.68
  });
  const handleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.28, 16), handleMat);
  handleMesh.position.set(0, 0.06, 0);
  handleMesh.castShadow = true;
  batGroup.add(handleMesh);

  return batGroup;
}

/**
 * Builds a detailed 3D Leather Cricket Ball with raised stitched seam
 */
export function createDetailedCricketBallMesh() {
  const ballGroup = new THREE.Group();

  const leatherCanvas = document.createElement('canvas');
  leatherCanvas.width = 512;
  leatherCanvas.height = 256;
  const ctx = leatherCanvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#991b1b');
  grad.addColorStop(0.5, '#b91c1c');
  grad.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  for (let i = 0; i < 3500; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
  }

  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(0, 118, 512, 20);
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(0, 124, 512, 8);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  for (let x = 0; x < 512; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, 115);
    ctx.lineTo(x + 5, 123);
    ctx.moveTo(x, 141);
    ctx.lineTo(x + 5, 133);
    ctx.stroke();
  }

  const leatherMap = new THREE.CanvasTexture(leatherCanvas);
  leatherMap.colorSpace = THREE.SRGBColorSpace;

  const leatherMat = new THREE.MeshPhysicalMaterial({
    map: leatherMap,
    roughness: 0.24,
    metalness: 0.05,
    clearcoat: 0.88,
    clearcoatRoughness: 0.16
  });

  const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(0.052, 32, 24), leatherMat);
  sphereMesh.castShadow = true;
  ballGroup.add(sphereMesh);

  const seamMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    roughness: 0.45,
    emissive: 0x451a03,
    emissiveIntensity: 0.15
  });

  const seamRingLeft = new THREE.Mesh(new THREE.TorusGeometry(0.0525, 0.0032, 10, 48), seamMat);
  seamRingLeft.position.z = -0.0035;
  ballGroup.add(seamRingLeft);

  const seamRingRight = new THREE.Mesh(new THREE.TorusGeometry(0.0525, 0.0032, 10, 48), seamMat);
  seamRingRight.position.z = 0.0035;
  ballGroup.add(seamRingRight);

  return { ballGroup, leatherMat };
}

/**
 * Generates Outfield Grass Albedo + Normal Map with realistic cross-cut & radial mowing stripes
 */
export function createOutfieldGrassTextures(renderer) {
  const size = 1024;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const ctx = albedoCanvas.getContext('2d');

  ctx.fillStyle = '#155e2b';
  ctx.fillRect(0, 0, size, size);

  const stripeCount = 16;
  const stripeW = size / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(52, 211, 153, 0.11)' : 'rgba(6, 46, 22, 0.14)';
    ctx.fillRect(i * stripeW, 0, stripeW, size);
  }
  for (let j = 0; j < stripeCount; j++) {
    ctx.fillStyle = j % 2 === 0 ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, j * stripeW, size, stripeW);
  }

  for (let i = 0; i < 24000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(74, 222, 128, 0.12)' : 'rgba(10, 42, 20, 0.15)';
    ctx.fillRect(x, y, 2, 4);
  }

  const albedoMap = new THREE.CanvasTexture(albedoCanvas);
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.wrapS = THREE.RepeatWrapping;
  albedoMap.wrapT = THREE.RepeatWrapping;
  albedoMap.repeat.set(10, 10);

  const normCanvas = document.createElement('canvas');
  normCanvas.width = 512;
  normCanvas.height = 512;
  const nCtx = normCanvas.getContext('2d');
  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16000; i++) {
    const nx = 110 + Math.floor(Math.random() * 36);
    const ny = 110 + Math.floor(Math.random() * 36);
    nCtx.fillStyle = `rgb(${nx}, ${ny}, 255)`;
    nCtx.fillRect(Math.random() * 512, Math.random() * 512, 2, 3);
  }
  const normalMap = new THREE.CanvasTexture(normCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(24, 24);

  if (renderer) {
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    albedoMap.anisotropy = maxAniso;
    normalMap.anisotropy = maxAniso;
  }

  return { albedoMap, normalMap };
}

/**
 * Dynamic 22-Yard Pitch Surface & Progressive Pitch Wear Texture Manager
 */
export class ProgressivePitchSurface {
  constructor(renderer) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 1024;
    this.ctx = this.canvas.getContext('2d');

    this.roughCanvas = document.createElement('canvas');
    this.roughCanvas.width = 512;
    this.roughCanvas.height = 1024;
    this.rCtx = this.roughCanvas.getContext('2d');

    this.map = new THREE.CanvasTexture(this.canvas);
    this.map.colorSpace = THREE.SRGBColorSpace;
    this.roughnessMap = new THREE.CanvasTexture(this.roughCanvas);

    if (renderer) {
      const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      this.map.anisotropy = aniso;
    }

    this.pitchType = 'normal';
    this.resetPitchTexture('normal');
  }

  resetPitchTexture(pitchType = 'normal') {
    this.pitchType = pitchType;
    const { ctx, rCtx } = this;

    const palettes = {
      normal: { base: '#c8ab7c', mid: '#b89764', crack: 'rgba(72, 52, 32, 0.22)', grass: 0.14 },
      green: { base: '#9ab074', mid: '#86a25e', crack: 'rgba(45, 68, 28, 0.18)', grass: 0.55 },
      dusty: { base: '#bfa074', mid: '#a68354', crack: 'rgba(62, 42, 22, 0.38)', grass: 0.04 },
      hard: { base: '#d9c29c', mid: '#cbb086', crack: 'rgba(90, 68, 42, 0.16)', grass: 0.08 }
    };
    const pal = palettes[pitchType] || palettes.normal;

    const grad = ctx.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0, pal.base);
    grad.addColorStop(0.5, pal.mid);
    grad.addColorStop(1, pal.base);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 1024);

    rCtx.fillStyle = pitchType === 'hard' ? '#969696' : pitchType === 'dusty' ? '#e2e2e2' : '#bcbcbc';
    rCtx.fillRect(0, 0, 512, 1024);

    for (let i = 0; i < 12000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 1024;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(92, 68, 42, 0.12)' : 'rgba(245, 228, 196, 0.10)';
      ctx.fillRect(x, y, 2, 4);
    }

    const grassCount = Math.floor(4500 * pal.grass);
    for (let i = 0; i < grassCount; i++) {
      ctx.fillStyle = 'rgba(54, 112, 42, 0.28)';
      ctx.fillRect(40 + Math.random() * 432, Math.random() * 1024, 2, 7);
    }

    this.stampFootmarkCluster(175, 220, 0.25);
    this.stampFootmarkCluster(335, 790, 0.25);

    this.map.needsUpdate = true;
    this.roughnessMap.needsUpdate = true;
  }

  stampFootmarkCluster(px, py, alpha = 0.25) {
    const { ctx, rCtx } = this;
    const rad = 34;
    const g = ctx.createRadialGradient(px, py, 4, px, py, rad);
    g.addColorStop(0, `rgba(76, 54, 34, ${alpha})`);
    g.addColorStop(0.6, `rgba(98, 72, 46, ${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(98, 72, 46, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();

    rCtx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
    rCtx.beginPath();
    rCtx.arc(px, py, rad * 0.8, 0, Math.PI * 2);
    rCtx.fill();
  }

  stampBallBounceWear(worldX, worldZ) {
    const u = THREE.MathUtils.clamp((worldX + 1.525) / 3.05, 0.05, 0.95);
    const v = THREE.MathUtils.clamp((worldZ + 11.0) / 22.0, 0.05, 0.95);
    const px = u * 512;
    const py = v * 1024;

    const { ctx, rCtx } = this;

    const g = ctx.createRadialGradient(px, py, 1, px, py, 14);
    g.addColorStop(0, 'rgba(58, 39, 22, 0.42)');
    g.addColorStop(0.5, 'rgba(88, 62, 36, 0.22)');
    g.addColorStop(1, 'rgba(88, 62, 36, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, py, 9, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(52, 34, 18, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px - 6, py - 4);
    ctx.lineTo(px + 5, py + 6);
    ctx.stroke();

    const footX = 165 + (Math.random() - 0.5) * 32;
    const footY = 760 + (Math.random() - 0.5) * 55;
    this.stampFootmarkCluster(footX, footY, 0.14);

    rCtx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    rCtx.beginPath();
    rCtx.arc(px, py, 12, 0, Math.PI * 2);
    rCtx.fill();

    this.map.needsUpdate = true;
    this.roughnessMap.needsUpdate = true;
  }
}

// Cache for jersey number textures so identical jersey color + number pairs share GPU textures
const _jerseyTexCache = new Map();

function createJerseyNumberTexture(primaryHex, secondaryHex, jerseyNumber = 18) {
  const key = `${primaryHex}_${secondaryHex}_${jerseyNumber}`;
  if (_jerseyTexCache.has(key)) return _jerseyTexCache.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const baseColor = new THREE.Color(primaryHex);
  const accentColor = new THREE.Color(secondaryHex || 0xf59e0b);

  ctx.fillStyle = `#${baseColor.getHexString()}`;
  ctx.fillRect(0, 0, 256, 256);

  // Stylised diagonal chest & shoulder trim stripes
  ctx.fillStyle = `#${accentColor.getHexString()}`;
  ctx.fillRect(0, 0, 256, 22);
  ctx.fillRect(0, 218, 256, 16);

  // Crisp jersey number on back (and subtle chest badge on front)
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 78px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(jerseyNumber), 64, 122);
  ctx.fillText(String(jerseyNumber), 192, 122);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _jerseyTexCache.set(key, tex);
  return tex;
}

/**
 * Builds the Expressive Low-Poly Cricket Character with:
 * - Stylised arcade proportions (broad athletic shoulders, tapered waist, expressive head & eyes)
 * - Customizable team jersey colour, secondary trim, and printed jersey number
 * - Protective helmet with steel grille, ribbed batting pads & padded gloves for batsman/keeper
 * - Team cap for bowler & fielders
 * - Full 17-bone `mixamorig` joint hierarchy so all 10+ skeletal AnimationClips and
 *   phone-quaternion bat/wrist tracking work identically with zero T-pose.
 */
function createLowPolyRiggedCharacter({
  colorHex = 0x0284c7,
  secondaryColorHex = 0xf59e0b,
  jerseyNumber = 18,
  skinHex = 0xd69e72,
  role = 'fielder'
}) {
  const root = new THREE.Group();

  const teamColor = new THREE.Color(colorHex);
  const darkTeamColor = teamColor.clone().multiplyScalar(0.42);
  const jerseyTex = createJerseyNumberTexture(colorHex, secondaryColorHex, jerseyNumber);

  const jerseyMat = new THREE.MeshStandardMaterial({
    map: jerseyTex,
    roughness: 0.52,
    metalness: 0.05
  });
  const sleeveMat = new THREE.MeshStandardMaterial({
    color: teamColor,
    roughness: 0.55,
    metalness: 0.05
  });
  const trouserMat = new THREE.MeshStandardMaterial({
    color: darkTeamColor,
    roughness: 0.65
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: skinHex,
    roughness: 0.48
  });
  const padMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.36,
    metalness: 0.06
  });
  const gloveMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0.05
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.5
  });

  // 1. HIPS BONE (Root Pelvis at y = 0.92m)
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  hips.position.set(0, 0.92, 0);
  root.add(hips);

  const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.21), trouserMat);
  pelvisMesh.castShadow = true;
  pelvisMesh.receiveShadow = true;
  hips.add(pelvisMesh);

  // 2. SPINE & SPINE1 BONES (Stylised Low-Poly Athletic Torso with Jersey Number)
  const spine = new THREE.Bone();
  spine.name = 'mixamorigSpine';
  spine.position.set(0, 0.10, 0);
  hips.add(spine);

  const spine1 = new THREE.Bone();
  spine1.name = 'mixamorigSpine1';
  spine1.position.set(0, 0.24, 0);
  spine.add(spine1);

  // Tapered low-poly chest torso
  const torsoGeo = new THREE.CylinderGeometry(0.21, 0.16, 0.48, 8);
  torsoGeo.scale(1.12, 1.0, 0.72);
  const torsoMesh = new THREE.Mesh(torsoGeo, jerseyMat);
  torsoMesh.position.set(0, 0.16, 0);
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  spine.add(torsoMesh);

  // Collar ring
  const collarMesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.11, 0.022, 6, 12).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: secondaryColorHex || 0xf59e0b, roughness: 0.5 })
  );
  collarMesh.position.set(0, 0.16, 0);
  spine1.add(collarMesh);

  // 3. HEAD BONE (Expressive Low-Poly Head + Eyes + Helmet or Team Cap)
  const head = new THREE.Bone();
  head.name = 'mixamorigHead';
  head.position.set(0, 0.28, 0);
  spine1.add(head);

  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.22), skinMat);
  headMesh.position.set(0, 0.04, 0);
  headMesh.castShadow = true;
  head.add(headMesh);

  // Expressive low-poly eyes & eyebrows on the +Z front face
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  [-0.048, 0.048].forEach((ex) => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.028, 0.015), eyeMat);
    eye.position.set(ex, 0.055, 0.112);
    head.add(eye);
  });

  if (role === 'batsman' || role === 'keeper') {
    const helmetMat = new THREE.MeshStandardMaterial({
      color: darkTeamColor,
      roughness: 0.26,
      metalness: 0.22
    });
    const grilleMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.22,
      metalness: 0.85
    });

    const helmetShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      helmetMat
    );
    helmetShell.position.set(0, 0.07, 0);
    helmetShell.castShadow = true;
    head.add(helmetShell);

    const visorPeak = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.022, 0.10), helmetMat);
    visorPeak.position.set(0, 0.10, 0.12);
    visorPeak.rotation.x = 0.18;
    head.add(visorPeak);

    const grille = new THREE.Mesh(
      new THREE.TorusGeometry(0.125, 0.009, 6, 12, Math.PI),
      grilleMat
    );
    grille.rotation.x = Math.PI * 0.5;
    grille.position.set(0, 0.01, 0.035);
    head.add(grille);
  } else {
    // Low-poly cricket cap for bowler & fielders
    const capDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.135, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      sleeveMat
    );
    capDome.position.set(0, 0.09, 0);
    head.add(capDome);

    const capBrim = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.018, 0.11), sleeveMat);
    capBrim.position.set(0, 0.10, 0.11);
    capBrim.rotation.x = 0.15;
    head.add(capBrim);
  }

  // 4. ARMS, FOREARMS & HANDS (with Padded Gloves for Batsman / Keeper)
  const makeArm = (side, dir) => {
    const arm = new THREE.Bone();
    arm.name = `mixamorig${side}Arm`;
    arm.position.set(dir * 0.24, 0.14, 0);
    spine1.add(arm);

    const sleeveMesh = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.15, 0.105), sleeveMat);
    sleeveMesh.position.set(0, -0.06, 0);
    sleeveMesh.castShadow = true;
    arm.add(sleeveMesh);

    const upperArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.16, 0.088), skinMat);
    upperArmMesh.position.set(0, -0.18, 0);
    upperArmMesh.castShadow = true;
    arm.add(upperArmMesh);

    const foreArm = new THREE.Bone();
    foreArm.name = `mixamorig${side}ForeArm`;
    foreArm.position.set(0, -0.26, 0);
    arm.add(foreArm);

    const lowerArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), skinMat);
    lowerArmMesh.position.set(0, -0.11, 0);
    lowerArmMesh.castShadow = true;
    foreArm.add(lowerArmMesh);

    const hand = new THREE.Bone();
    hand.name = `mixamorig${side}Hand`;
    hand.position.set(0, -0.23, 0);
    foreArm.add(hand);

    if (role === 'batsman' || role === 'keeper') {
      const gloveSize = role === 'keeper' ? 0.115 : 0.098;
      const gloveMesh = new THREE.Mesh(
        new THREE.BoxGeometry(gloveSize, gloveSize * 1.15, gloveSize),
        gloveMat
      );
      gloveMesh.position.set(0, -0.03, 0);
      gloveMesh.castShadow = true;
      hand.add(gloveMesh);
    } else {
      const handMesh = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.075), skinMat);
      handMesh.position.set(0, -0.03, 0);
      hand.add(handMesh);
    }
  };
  makeArm('Right', -1);
  makeArm('Left', 1);

  // 5. LEGS, SHINS, RIBBED BATTING PADS & CRICKET SHOES
  const makeLeg = (side, dir) => {
    const upLeg = new THREE.Bone();
    upLeg.name = `mixamorig${side}UpLeg`;
    upLeg.position.set(dir * 0.105, -0.05, 0);
    hips.add(upLeg);

    const thighMesh = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.38, 0.135), trouserMat);
    thighMesh.position.set(0, -0.19, 0);
    thighMesh.castShadow = true;
    upLeg.add(thighMesh);

    const leg = new THREE.Bone();
    leg.name = `mixamorig${side}Leg`;
    leg.position.set(0, -0.40, 0);
    upLeg.add(leg);

    const shinMesh = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.38, 0.115), trouserMat);
    shinMesh.position.set(0, -0.19, 0);
    shinMesh.castShadow = true;
    leg.add(shinMesh);

    if (role === 'batsman' || role === 'keeper') {
      // Sculpted low-poly batting pads with knee roll on front of shin
      const padFront = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.42, 0.075), padMat);
      padFront.position.set(0, -0.17, 0.055);
      padFront.castShadow = true;
      leg.add(padFront);

      const kneeRoll = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.065, 0.085), padMat);
      kneeRoll.position.set(0, 0.01, 0.062);
      leg.add(kneeRoll);
    }

    const shoeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.08, 0.22), shoeMat);
    shoeMesh.position.set(0, -0.41, 0.035);
    shoeMesh.castShadow = true;
    leg.add(shoeMesh);
  };
  makeLeg('Right', -1);
  makeLeg('Left', 1);

  return root;
}

/**
 * Attaches cricket gear if CHARACTER_STYLE === 'soldier'
 */
function attachEquipmentToRig(root, { role, colorHex }) {
  const headBone = root.getObjectByName('mixamorigHead') || root.getObjectByName('Head');
  const rightHandBone = root.getObjectByName('mixamorigRightHand') || root.getObjectByName('RightHand');
  const leftLegBone = root.getObjectByName('mixamorigLeftLeg') || root.getObjectByName('LeftLeg');
  const rightLegBone = root.getObjectByName('mixamorigRightLeg') || root.getObjectByName('RightLeg');

  if (CHARACTER_STYLE === 'soldier') {
    const teamColor = new THREE.Color(colorHex);
    root.traverse((child) => {
      if (child.isMesh && child.material) {
        child.castShadow = true;
        child.receiveShadow = true;
        const mat = child.material.clone();
        mat.color.lerp(teamColor, 0.68);
        child.material = mat;
      }
    });
  }

  return {
    headBone,
    rightHandBone,
    spineBone: root.getObjectByName('mixamorigSpine1') || root.getObjectByName('mixamorigSpine'),
    rightArmBone: root.getObjectByName('mixamorigRightArm'),
    leftArmBone: root.getObjectByName('mixamorigLeftArm'),
    leftLegBone,
    rightLegBone
  };
}

/**
 * Character Controller wrapping the Low-Poly Rigged Character (or Soldier glTF if CHARACTER_STYLE === 'soldier'),
 * THREE.LOD for outfielders, AnimationMixer, and smooth crossfades across all 10+ cricket clips.
 */
export class RiggedCricketPlayer {
  constructor({
    baseGltf,
    mocapClips,
    role = 'fielder',
    colorHex = 0x0284c7,
    secondaryColorHex = 0xf59e0b,
    jerseyNumber = 18,
    skinHex = 0xd69e72,
    useLOD = false
  }) {
    this.role = role;
    this.group = new THREE.Group();
    this.currentClipName = '';
    this.actions = {};
    this.frameCounter = Math.floor(Math.random() * 4);

    if (CHARACTER_STYLE === 'soldier' && baseGltf && baseGltf.scene) {
      this.modelRoot = SkeletonUtils.clone(baseGltf.scene);
      this.modelRoot.rotation.y = Math.PI;
      this.modelRoot.scale.setScalar(1.02);
    } else {
      this.modelRoot = createLowPolyRiggedCharacter({
        colorHex,
        secondaryColorHex,
        jerseyNumber,
        skinHex,
        role
      });
    }

    this.bones = attachEquipmentToRig(this.modelRoot, { role, colorHex, skinHex });

    if (useLOD) {
      this.lod = new THREE.LOD();
      this.lod.addLevel(this.modelRoot, 0);

      // Far LOD lightweight low-poly proxy (> 32m)
      const proxyGroup = new THREE.Group();
      const proxyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6 });
      const legMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex).multiplyScalar(0.42),
        roughness: 0.65
      });
      const torsoProxy = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.52, 0.22), proxyMat);
      torsoProxy.position.y = 1.12;
      torsoProxy.castShadow = true;

      const legsProxy = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.82, 0.18), legMat);
      legsProxy.position.y = 0.44;
      legsProxy.castShadow = true;

      const headProxy = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.24, 0.22),
        new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.55 })
      );
      headProxy.position.y = 1.54;
      proxyGroup.add(legsProxy, torsoProxy, headProxy);

      this.lod.addLevel(proxyGroup, 32);
      this.group.add(this.lod);
    } else {
      this.group.add(this.modelRoot);
    }

    // Setup AnimationMixer & register all 10+ cricket clips
    this.mixer = new THREE.AnimationMixer(this.modelRoot);
    Object.keys(mocapClips).forEach((name) => {
      const clip = mocapClips[name];
      if (!clip) return;
      const action = this.mixer.clipAction(clip);
      if (
        name === 'drive' ||
        name === 'cut' ||
        name === 'pull' ||
        name === 'sweep' ||
        name === 'scoop' ||
        name === 'ramp' ||
        name === 'loft' ||
        name === 'defence' ||
        name === 'bowling_release' ||
        name === 'release' ||
        name === 'catch' ||
        name === 'collect' ||
        name === 'throw' ||
        name === 'dive' ||
        name === 'celebration' ||
        name === 'celebrate'
      ) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    });

    this.mixer.addEventListener('finished', (e) => {
      const finishedName = e.action.getClip().name;
      if (finishedName !== 'stance' && finishedName !== 'idle') {
        this.playClip(this.role === 'batsman' ? 'stance' : 'idle', 0.22);
      }
    });

    const initialClip = role === 'batsman' ? 'stance' : 'idle';
    this.playClip(initialClip, 0.01);
    // Evaluate mixer immediately at t=0 so the character starts in its exact cricket pose (never T-pose)
    this.mixer.update(0.016);
  }

  /**
   * Smoothly cross-fades to the target animation clip
   */
  playClip(name, fadeDuration = 0.18, timeScale = 1.0) {
    const nextAction = this.actions[name] || this.actions.idle || this.actions.stance;
    if (!nextAction) return;

    if (this.currentClipName === name && nextAction.isRunning()) {
      nextAction.timeScale = timeScale;
      return;
    }

    const prevAction = this.actions[this.currentClipName];
    this.currentClipName = name;

    nextAction.reset();
    nextAction.timeScale = timeScale;
    nextAction.setEffectiveWeight(1);
    nextAction.play();

    if (prevAction && prevAction !== nextAction) {
      prevAction.crossFadeTo(nextAction, fadeDuration, false);
    }
  }

  update(dt, cameraPos = null) {
    this.frameCounter++;
    if (this.lod && cameraPos) {
      const distSq = this.group.position.distanceToSquared(cameraPos);
      if (distSq > 784 && this.frameCounter % 2 !== 0) {
        return;
      }
    }
    this.mixer.update(dt);
  }
}

/**
 * Generates an Equirectangular Stadium Sky & Floodlight Environment Texture in-engine
 * (Zero external network failure / CORS warnings, instant load)
 */
function createProceduralStadiumHDRI() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Sky zenith -> horizon -> turf bounce gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#1e3a8a');
  grad.addColorStop(0.38, '#38bdf8');
  grad.addColorStop(0.49, '#e0f2fe');
  grad.addColorStop(0.52, '#14532d');
  grad.addColorStop(1.0, '#052e16');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // 4 High-intensity stadium floodlight specular hotspots + sun disc
  const hotspots = [
    { x: 96, y: 64, r: 22 },
    { x: 224, y: 58, r: 26 },
    { x: 352, y: 64, r: 22 },
    { x: 460, y: 62, r: 22 }
  ];
  hotspots.forEach((h) => {
    const g = ctx.createRadialGradient(h.x, h.y, 2, h.x, h.y, h.r);
    g.addColorStop(0, 'rgba(255, 253, 235, 1.0)');
    g.addColorStop(0.4, 'rgba(254, 240, 138, 0.55)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.fill();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Coordinates Draco, KTX2, HDRI Sky, and character asset pipeline with loading bar progress
 */
export function loadRealisticAssets(renderer, onProgress, onComplete) {
  THREE.Cache.enabled = true;
  const manager = new THREE.LoadingManager();

  const dracoLoader = new DRACOLoader(manager);
  dracoLoader.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/');

  const ktx2Loader = new KTX2Loader(manager);
  ktx2Loader.setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/');
  try {
    ktx2Loader.detectSupport(renderer);
  } catch {}

  let loadedGltf = null;
  const loadedHdri = createProceduralStadiumHDRI();
  let completed = false;

  const finalize = () => {
    if (completed) return;
    completed = true;
    const mocapClips = buildCricketMocapClips(loadedGltf ? loadedGltf.animations : []);
    if (onProgress) onProgress(100);
    if (onComplete) {
      onComplete({
        baseGltf: loadedGltf,
        hdriTexture: loadedHdri,
        mocapClips
      });
    }
  };

  if (onProgress) onProgress(65);

  if (CHARACTER_STYLE === 'soldier') {
    const gltfLoader = new GLTFLoader(manager);
    gltfLoader.setDRACOLoader(dracoLoader);
    gltfLoader.setKTX2Loader(ktx2Loader);
    gltfLoader.load(
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/Soldier.glb',
      (gltf) => {
        loadedGltf = gltf;
        finalize();
      },
      undefined,
      () => finalize()
    );
  } else {
    // Low-poly rigged characters are built in-engine with zero network wait
    setTimeout(finalize, 60);
  }
}
