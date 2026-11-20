import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildIKBattingClips } from './shot_animations.js';

/**
 * Character Style Flag:
 * 'lowpoly' (default) -> Stylised expressive low-poly 3D cricket characters with jersey colour & number,
 *                        helmet, pads, gloves, and full Mixamo-compatible joint hierarchy.
 * 'soldier'           -> External glTF Soldier.glb character mesh.
 */
export const CHARACTER_STYLE = 'lowpoly'; // 'lowpoly' | 'soldier'

/**
 * Player look in HD mode:
 *  'pro'     -> athletic, realistic proportions (normal-size head, slim limbs, detailed face) like modern broadcast cricket games
 *  'cartoon' -> big-head, chunky cartoon look
 */
export const PLAYER_STYLE = 'pro'; // 'pro' | 'cartoon'
const PRO = PLAYER_STYLE === 'pro';

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
  const isSmartTV =
    /SmartTV|Smart-TV|Tizen|Web0S|WebOS|NetCast|BRAVIA|AFT|FireTV|CrKey|Viera|HbbTV|VIDAA|Hisense|MiBOX|Android\s*TV|GoogleTV|\bTV\b|PhilipsTV|Opera TV|WhaleTV/i.test(
      ua
    ) ||
    ((isAndroid || /Linux arm|Linux aarch64/i.test(ua)) && (navigator.maxTouchPoints || 0) === 0);
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

  const isWeakOrTvGpu =
    /Mali|Adreno|PowerVR|Vivante|VideoCore|Broadcom|SwiftShader|llvmpipe|Direct3D9|Microsoft Basic Render|Intel.*HD Graphics/i.test(
      gpuRenderer
    );

  if (isSmartTV || isWeakOrTvGpu) {
    return 'low';
  }
  if (isAndroid && (cores <= 6 || memGb <= 4)) {
    return 'low';
  }
  if (isAndroid || isIOS || memGb <= 4 || cores <= 4) {
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
    makeBoneQuatTrack('mixamorigSpine1', [0, 0.28, 0.56], [
      [4, -4, 0],
      [4, 4, 0],
      [4, -4, 0]
    ]),
    makeBoneQuatTrack('mixamorigHead', [0, 0.28, 0.56], [
      [-12, 0, 0],
      [-10, 0, 0],
      [-12, 0, 0]
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
      [38, 18, 28],
      [28, 16, 26],
      [38, 18, 28]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.8, 1.6], [
      [58, 14, 18],
      [48, 12, 16],
      [58, 14, 18]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.8, 1.6], [
      [40, -22, -44],
      [30, -20, -40],
      [40, -22, -44]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.8, 1.6], [
      [58, -16, -24],
      [48, -14, -20],
      [58, -16, -24]
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

  // 2. DEFENCE (Forward stride & dead-bat vertical two-handed block)
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
      [38, 18, 28],
      [58, 20, 26],
      [18, 14, 24],
      [36, 18, 28]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.28, 0.65], [
      [58, 14, 18],
      [68, 16, 16],
      [54, 14, 18]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.12, 0.28, 0.65], [
      [40, -22, -44],
      [58, -24, -40],
      [20, -18, -36],
      [38, -22, -42]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.28, 0.65], [
      [58, -16, -24],
      [68, -18, -20],
      [54, -14, -22]
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

  // 3. DRIVE (High-elbow straight / cover drive with synchronized two-hand grip & full follow-through)
  clips.drive = new THREE.AnimationClip('drive', 0.78, [
    makeBoneQuatTrack('mixamorigHips', [0, 0.16, 0.38, 0.78], [
      [8, -58, 0],
      [6, -65, -4],
      [14, -18, 6],
      [10, -24, 3]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.16, 0.38, 0.78], [
      [14, 12, 0],
      [8, -14, -5],
      [18, 28, 8],
      [14, 22, 4]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.15, 0.36, 0.78], [
      [38, 18, 28],
      [74, 24, 24],
      [-52, -10, 22],
      [-42, -8, 24]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.15, 0.36, 0.78], [
      [58, 14, 18],
      [72, 16, 18],
      [62, 10, 14],
      [56, 12, 16]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.15, 0.36, 0.78], [
      [40, -22, -44],
      [72, -20, -38],
      [-50, -16, -34],
      [-40, -14, -36]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.15, 0.36, 0.78], [
      [58, -16, -24],
      [68, -18, -22],
      [60, -12, -18],
      [56, -14, -20]
    ]),
    makeBoneQuatTrack('mixamorigLeftUpLeg', [0, 0.32, 0.78], [
      [-22, 0, 6],
      [-52, 16, 12],
      [-36, 10, 8]
    ])
  ]);

  // 4. CUT (Back-foot square cut slash with both hands locked on handle)
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
      [38, 18, 28],
      [76, 26, 24],
      [16, -42, 20],
      [28, -22, 24]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.15, 0.34, 0.72], [
      [58, 14, 18],
      [68, 16, 18],
      [54, 12, 16],
      [56, 14, 18]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.15, 0.34, 0.72], [
      [40, -22, -44],
      [74, 12, -38],
      [18, -38, -32],
      [30, -20, -36]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.15, 0.34, 0.72], [
      [58, -16, -24],
      [66, -16, -20],
      [54, -12, -18],
      [56, -14, -20]
    ])
  ]);

  // 5. PULL (Chest-on swivel pull shot to leg side with two-handed roll)
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
      [38, 18, 28],
      [66, 22, 24],
      [-22, 52, 22],
      [-14, 34, 24]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.15, 0.36, 0.78], [
      [58, 14, 18],
      [66, 16, 18],
      [58, 14, 16],
      [56, 14, 18]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.15, 0.36, 0.78], [
      [40, -22, -44],
      [62, -16, -38],
      [-24, 48, -34],
      [-16, 32, -38]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.15, 0.36, 0.78], [
      [58, -16, -24],
      [64, -16, -20],
      [56, -14, -18],
      [56, -14, -20]
    ])
  ]);

  // 6. LOFT (Full low-to-high six swing follow-through over shoulder with two-handed grip)
  clips.loft = new THREE.AnimationClip('loft', 0.88, [
    makeBoneQuatTrack('mixamorigHips', [0, 0.16, 0.42, 0.88], [
      [8, -58, 0],
      [14, -68, -6],
      [-12, 16, 10],
      [-6, 10, 4]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.16, 0.42, 0.88], [
      [14, 12, 0],
      [20, -18, -8],
      [-22, 42, 14],
      [-14, 30, 8]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.16, 0.40, 0.88], [
      [38, 18, 28],
      [82, 26, 24],
      [-88, 20, 20],
      [-70, 16, 22]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.16, 0.40, 0.88], [
      [58, 14, 18],
      [74, 16, 18],
      [78, 12, 16],
      [66, 14, 18]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.16, 0.40, 0.88], [
      [40, -22, -44],
      [78, -18, -38],
      [-86, 16, -32],
      [-68, 14, -34]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.16, 0.40, 0.88], [
      [58, -16, -24],
      [70, -18, -20],
      [74, -12, -18],
      [64, -14, -20]
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

  // 8. CATCH (Athletic two-handed reach, soft-hands chest gather, knee cushion & celebration recoil)
  clips.catch = new THREE.AnimationClip('catch', 0.78, [
    makeBonePosTrack('mixamorigHips', [0, 0.18, 0.38, 0.58, 0.78], [
      [0, 0.92, 0],
      [0, 1.06, 0.06],
      [0, 0.78, -0.05],
      [0, 0.84, -0.02],
      [0, 0.92, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.18, 0.38, 0.58, 0.78], [
      [10, 0, 0],
      [-22, 0, 0],
      [24, 0, 0],
      [14, 0, 0],
      [8, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.18, 0.38, 0.58, 0.78], [
      [20, 0, -25],
      [-105, -24, -8],
      [-48, -32, -12],
      [-65, -18, -16],
      [-25, -20, -15]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.18, 0.38, 0.78], [
      [30, 0, 0],
      [38, 12, 15],
      [88, 24, 28],
      [75, 20, 25]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.18, 0.38, 0.58, 0.78], [
      [20, 0, 25],
      [-105, 24, 8],
      [-48, 32, 12],
      [-65, 18, 16],
      [-25, 20, 15]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.18, 0.38, 0.78], [
      [30, 0, 0],
      [38, -12, -15],
      [88, -24, -28],
      [75, -20, -25]
    ]),
    makeBoneQuatTrack('mixamorigRightUpLeg', [0, 0.18, 0.38, 0.78], [
      [-10, 0, 0],
      [8, 0, -6],
      [-38, 0, -8],
      [-10, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigLeftUpLeg', [0, 0.18, 0.38, 0.78], [
      [-10, 0, 0],
      [8, 0, 6],
      [-38, 0, 8],
      [-10, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightLeg', [0, 0.18, 0.38, 0.78], [
      [18, 0, 0],
      [10, 0, 0],
      [54, 0, 0],
      [18, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigLeftLeg', [0, 0.18, 0.38, 0.78], [
      [18, 0, 0],
      [10, 0, 0],
      [54, 0, 0],
      [18, 0, 0]
    ])
  ]);

  // 9. DIVE (Full-stretch airborne horizontal layout dive, two-hand reach, knee tuck & turf slide recovery)
  clips.dive = new THREE.AnimationClip('dive', 0.96, [
    makeBonePosTrack('mixamorigHips', [0, 0.16, 0.38, 0.68, 0.96], [
      [0, 0.88, 0],
      [0.32, 0.64, 0.08],
      [0.68, 0.34, 0.14],
      [0.78, 0.24, 0.10],
      [0, 0.90, 0]
    ]),
    makeBoneQuatTrack('mixamorigHips', [0, 0.16, 0.38, 0.68, 0.96], [
      [12, 0, 0],
      [18, 16, -54],
      [22, 18, -82],
      [16, 10, -76],
      [10, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigSpine', [0, 0.16, 0.38, 0.68, 0.96], [
      [10, 0, 0],
      [-14, 8, -12],
      [-22, 12, -18],
      [12, 4, -8],
      [8, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightArm', [0, 0.16, 0.38, 0.68, 0.96], [
      [20, 0, -25],
      [-148, -12, -18],
      [-162, -8, -10],
      [-115, -18, -22],
      [20, 0, -25]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.16, 0.38, 0.68, 0.96], [
      [20, 0, 25],
      [-138, 12, 18],
      [-154, 8, 12],
      [-110, 18, 22],
      [20, 0, 25]
    ]),
    makeBoneQuatTrack('mixamorigRightUpLeg', [0, 0.16, 0.38, 0.68, 0.96], [
      [-12, 0, 0],
      [26, 0, -14],
      [34, 0, -18],
      [-18, 0, -8],
      [-10, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigLeftUpLeg', [0, 0.16, 0.38, 0.68, 0.96], [
      [-12, 0, 0],
      [18, 0, 14],
      [28, 0, 18],
      [-22, 0, 8],
      [-10, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigRightLeg', [0, 0.16, 0.38, 0.68, 0.96], [
      [20, 0, 0],
      [12, 0, 0],
      [48, 0, 0],
      [62, 0, 0],
      [18, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigLeftLeg', [0, 0.16, 0.38, 0.68, 0.96], [
      [20, 0, 0],
      [16, 0, 0],
      [54, 0, 0],
      [66, 0, 0],
      [18, 0, 0]
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
    makeBoneQuatTrack('mixamorigSpine1', [0, 0.28, 0.55, 0.82, 1.1], [
      [0, 0, 0],
      [-6, 6, 0],
      [-4, -6, 0],
      [-6, 4, 0],
      [0, 0, 0]
    ]),
    makeBoneQuatTrack('mixamorigHead', [0, 0.28, 0.55, 0.82, 1.1], [
      [-4, 0, 0],
      [-16, 6, 0],
      [-10, -6, 0],
      [-14, 4, 0],
      [-4, 0, 0]
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
      [38, 18, 28],
      [64, -18, 24],
      [14, 58, 22],
      [38, 18, 28]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.22, 0.48, 0.82], [
      [58, 14, 18],
      [64, 14, 18],
      [58, 12, 16],
      [58, 14, 18]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.22, 0.48, 0.82], [
      [40, -22, -44],
      [60, -24, -38],
      [12, 54, -34],
      [40, -22, -44]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.22, 0.48, 0.82], [
      [58, -16, -24],
      [64, -16, -22],
      [56, -14, -20],
      [58, -16, -24]
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
      [38, 18, 28],
      [70, 14, 24],
      [-98, 24, 20],
      [38, 18, 28]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.20, 0.46, 0.84], [
      [58, 14, 18],
      [64, 16, 18],
      [68, 14, 16],
      [58, 14, 18]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.20, 0.46, 0.84], [
      [40, -22, -44],
      [68, -16, -36],
      [-96, 20, -32],
      [40, -22, -44]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.20, 0.46, 0.84], [
      [58, -16, -24],
      [62, -16, -22],
      [66, -14, -20],
      [58, -16, -24]
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
      [38, 18, 28],
      [-38, -22, 26],
      [-102, -38, 22],
      [38, 18, 28]
    ]),
    makeBoneQuatTrack('mixamorigRightForeArm', [0, 0.20, 0.45, 0.78], [
      [58, 14, 18],
      [62, 14, 18],
      [66, 12, 16],
      [58, 14, 18]
    ]),
    makeBoneQuatTrack('mixamorigLeftArm', [0, 0.20, 0.45, 0.78], [
      [40, -22, -44],
      [-36, -20, -36],
      [-98, -34, -32],
      [40, -22, -44]
    ]),
    makeBoneQuatTrack('mixamorigLeftForeArm', [0, 0.20, 0.45, 0.78], [
      [58, -16, -24],
      [60, -16, -22],
      [64, -12, -18],
      [58, -16, -24]
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

  // Realistic IK-authored batting clips (stance, defence, drives, cut, pull, flick, loft, sweep, scoop, ramp ...)
  Object.assign(clips, buildIKBattingClips());

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

  const bladeGeo = new THREE.BoxGeometry(0.108, 0.55, 0.025);
  const bladeMesh = new THREE.Mesh(bladeGeo, willowMat);
  bladeMesh.position.set(0, -0.335, 0.004);
  bladeMesh.castShadow = true;
  bladeMesh.receiveShadow = true;
  batGroup.add(bladeMesh);

  // Sculpted thick sweet-spot spine ridge + team/pro sticker accent on back
  const spineGeo = new THREE.ConeGeometry(0.052, 0.52, 3);
  spineGeo.scale(1.02, 1.0, 0.62);
  const spineMesh = new THREE.Mesh(spineGeo, willowMat);
  spineMesh.rotation.y = Math.PI;
  spineMesh.position.set(0, -0.335, -0.015);
  spineMesh.castShadow = true;
  batGroup.add(spineMesh);

  const stickerMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.35, metalness: 0.12 });
  const stickerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.18, 0.006), stickerMat);
  stickerMesh.position.set(0, -0.32, -0.026);
  batGroup.add(stickerMesh);

  // Curved rubberized toe guard
  const toeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.72 });
  const toeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.03, 12, 1, false, 0, Math.PI), toeMat);
  toeMesh.rotation.x = Math.PI * 0.5;
  toeMesh.rotation.z = Math.PI;
  toeMesh.scale.set(1.0, 0.36, 0.62);
  toeMesh.position.set(0, -0.608, 0.002);
  batGroup.add(toeMesh);

  const gripCanvas = document.createElement('canvas');
  gripCanvas.width = 128;
  gripCanvas.height = 256;
  const gCtx = gripCanvas.getContext('2d');
  gCtx.fillStyle = '#f8fafc';
  gCtx.fillRect(0, 0, 128, 256);
  gCtx.fillStyle = '#0f172a';
  gCtx.fillRect(0, 0, 128, 44);
  gCtx.fillStyle = '#f59e0b';
  gCtx.fillRect(0, 44, 128, 18);
  for (let y = 0; y < 256; y += 8) {
    gCtx.fillStyle = 'rgba(15, 23, 42, 0.22)';
    gCtx.fillRect(0, y, 128, 3);
  }
  const gripTex = new THREE.CanvasTexture(gripCanvas);
  gripTex.colorSpace = THREE.SRGBColorSpace;

  const handleMat = new THREE.MeshStandardMaterial({
    map: gripTex,
    roughness: 0.68
  });
  const handleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.28, 14), handleMat);
  handleMesh.position.set(0, 0.06, 0);
  handleMesh.castShadow = true;
  batGroup.add(handleMesh);

  return batGroup;
}

/**
 * Builds a Broadcast Lacquered Leather Cricket Ball with raised stitched seam
 */
export function createDetailedCricketBallMesh() {
  const ballGroup = new THREE.Group();

  const leatherCanvas = document.createElement('canvas');
  leatherCanvas.width = 512;
  leatherCanvas.height = 256;
  const ctx = leatherCanvas.getContext('2d');

  // Rich broadcast cherry-crimson leather lacquer (natural shine + crisp visibility under floodlights)
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#9f1239');
  grad.addColorStop(0.45, '#be123c');
  grad.addColorStop(0.55, '#e11d48');
  grad.addColorStop(1, '#881337');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Fine natural leather pores & lacquer highlights
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255,220,225,0.06)' : 'rgba(20,0,8,0.12)';
    ctx.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
  }

  // Authentic stitched primary seam band + center dark valley
  ctx.fillStyle = '#fffbeb';
  ctx.fillRect(0, 118, 512, 20);
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(0, 124, 512, 8);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.2;
  for (let x = 0; x < 512; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, 115);
    ctx.lineTo(x + 4, 123);
    ctx.moveTo(x, 141);
    ctx.lineTo(x + 4, 133);
    ctx.stroke();
  }

  const leatherMap = new THREE.CanvasTexture(leatherCanvas);
  leatherMap.colorSpace = THREE.SRGBColorSpace;

  const leatherMat = new THREE.MeshPhysicalMaterial({
    map: leatherMap,
    roughness: 0.22,
    metalness: 0.04,
    clearcoat: 0.92,
    clearcoatRoughness: 0.14,
    emissive: 0x9f1239,
    emissiveMap: leatherMap,
    emissiveIntensity: 0.28
  });

  const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(0.052, 24, 18), leatherMat);
  sphereMesh.castShadow = true;
  ballGroup.add(sphereMesh);

  const seamMat = new THREE.MeshStandardMaterial({
    color: 0xfefce8,
    roughness: 0.42,
    emissive: 0xfefce8,
    emissiveIntensity: 0.16
  });

  const seamRingLeft = new THREE.Mesh(new THREE.TorusGeometry(0.0524, 0.003, 8, 36), seamMat);
  seamRingLeft.position.z = -0.0034;
  ballGroup.add(seamRingLeft);

  const seamRingRight = new THREE.Mesh(new THREE.TorusGeometry(0.0524, 0.003, 8, 36), seamMat);
  seamRingRight.position.z = 0.0034;
  ballGroup.add(seamRingRight);

  // Subtle compact visibility glint for 150 km/h tracking without arcade neon orb look
  const gc = document.createElement('canvas');
  gc.width = gc.height = 64;
  const gx = gc.getContext('2d');
  const gg = gx.createRadialGradient(32, 32, 3, 32, 32, 30);
  gg.addColorStop(0, 'rgba(255,230,235,0.55)');
  gg.addColorStop(0.45, 'rgba(244,63,94,0.20)');
  gg.addColorStop(1, 'rgba(225,29,72,0)');
  gx.fillStyle = gg;
  gx.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.42
  }));
  glow.scale.setScalar(0.18);
  glow.renderOrder = 5;
  ballGroup.add(glow);

  return { ballGroup, leatherMat };
}

export const WAVEDASH_GRAPHICS_STATE = {
  enabled: true
};

/**
 * Generates Pro Broadcast Outfield Grass Texture (1:1 radial stadium mowing rings + subtle fairway strips,
 * NO heavy checkerboard squares, 0ms runtime GPU overhead for Smart TV smoothness)
 */
export function createOutfieldGrassTextures(renderer) {
  const isProHD = WAVEDASH_GRAPHICS_STATE.enabled;
  const size = 1024;
  const half = size * 0.5;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const ctx = albedoCanvas.getContext('2d');

  // Rich broadcast stadium turf base gradient (brighter curated infield, deep lush outer boundary)
  const baseGrad = ctx.createRadialGradient(half, half, 40, half, half, half);
  baseGrad.addColorStop(0.0, isProHD ? '#1e8c45' : '#186a37');
  baseGrad.addColorStop(0.45, isProHD ? '#197b3d' : '#155c30');
  baseGrad.addColorStop(0.86, isProHD ? '#156a34' : '#114d28');
  baseGrad.addColorStop(1.0, '#124626');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, size, size);

  // Subtle concentric circular stadium mowing rings (like Lord's / MCG / IPL grounds)
  const ringCount = 14;
  const maxR = half * 0.94;
  for (let rIdx = ringCount; rIdx >= 1; rIdx--) {
    const rOuter = (rIdx / ringCount) * maxR;
    const rInner = ((rIdx - 1) / ringCount) * maxR;
    ctx.beginPath();
    ctx.arc(half, half, rOuter, 0, Math.PI * 2);
    ctx.arc(half, half, rInner, 0, Math.PI * 2, true);
    ctx.fillStyle = rIdx % 2 === 0 ? 'rgba(110, 231, 128, 0.065)' : 'rgba(4, 38, 18, 0.085)';
    ctx.fill();
  }

  // Subtle vertical straight pitch-cut mowing bands (adds crisp broadcast mowing shimmer without square blocks)
  const bandCount = 22;
  const bandW = size / bandCount;
  for (let i = 0; i < bandCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(74, 222, 128, 0.048)' : 'rgba(2, 32, 16, 0.052)';
    ctx.fillRect(i * bandW, 0, bandW, size);
  }

  // 30-yard fielding circle manicured cut edge (world r = 25m on 60m circle -> 213px radius)
  const ring30Px = (25 / 60) * half;
  ctx.strokeStyle = 'rgba(134, 239, 172, 0.14)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(half, half, ring30Px, 0, Math.PI * 2);
  ctx.stroke();

  // Outer boundary apron / trimmed darker turf outside the 52m rope (443px..512px)
  const boundaryPx = (52 / 60) * half;
  ctx.beginPath();
  ctx.arc(half, half, half, 0, Math.PI * 2);
  ctx.arc(half, half, boundaryPx + 4, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(6, 36, 20, 0.34)';
  ctx.fill();

  // Fine organic grass-blade tonal texture (baked once into canvas)
  ctx.fillStyle = 'rgba(134, 239, 172, 0.08)';
  ctx.beginPath();
  for (let i = 0; i < 3200; i++) {
    ctx.rect(Math.random() * size, Math.random() * size, 2, 3);
  }
  ctx.fill();

  ctx.fillStyle = 'rgba(4, 47, 25, 0.11)';
  ctx.beginPath();
  for (let i = 0; i < 3200; i++) {
    ctx.rect(Math.random() * size, Math.random() * size, 2, 3);
  }
  ctx.fill();

  const albedoMap = new THREE.CanvasTexture(albedoCanvas);
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.wrapS = THREE.ClampToEdgeWrapping;
  albedoMap.wrapT = THREE.ClampToEdgeWrapping;
  albedoMap.repeat.set(1, 1);

  if (renderer) {
    albedoMap.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  }

  return { albedoMap, normalMap: null };
}

/**
 * Dynamic 22-Yard Pitch Surface & Progressive Pitch Wear Texture Manager
 */
export class ProgressivePitchSurface {
  constructor(renderer) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d');

    this.map = new THREE.CanvasTexture(this.canvas);
    this.map.colorSpace = THREE.SRGBColorSpace;
    this.roughnessMap = null;

    if (renderer) {
      this.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    }

    this.pitchType = 'normal';
    this.resetPitchTexture('normal');
  }

  resetPitchTexture(pitchType = 'normal') {
    this.pitchType = pitchType;
    const { ctx } = this;
    const W = 256;
    const H = 512;

    const palettes = {
      normal: { base: '#d2b486', mid: '#c3a270', edge: '#b59462', grass: 0.18 },
      green: { base: '#93af70', mid: '#809b5d', edge: '#6d8a4b', grass: 0.65 },
      dusty: { base: '#c2a274', mid: '#ab8859', edge: '#9a7749', grass: 0.06 },
      hard: { base: '#ddd0b4', mid: '#ccb996', edge: '#bda884', grass: 0.1 }
    };
    const pal = palettes[pitchType] || palettes.normal;

    // Longitudinal roller tracks + slightly drier middle strip
    const sideGrad = ctx.createLinearGradient(0, 0, W, 0);
    sideGrad.addColorStop(0, pal.edge);
    sideGrad.addColorStop(0.18, pal.mid);
    sideGrad.addColorStop(0.5, pal.base);
    sideGrad.addColorStop(0.82, pal.mid);
    sideGrad.addColorStop(1, pal.edge);
    ctx.fillStyle = sideGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle heavy-roller longitudinal sheen bands
    ctx.fillStyle = 'rgba(255, 250, 235, 0.07)';
    ctx.fillRect(42, 0, 52, H);
    ctx.fillRect(162, 0, 52, H);

    // Natural soil pores & dry turf texture
    ctx.fillStyle = 'rgba(88, 64, 38, 0.13)';
    ctx.beginPath();
    for (let i = 0; i < 550; i++) {
      ctx.rect(Math.random() * W, Math.random() * H, 1.5, 3);
    }
    ctx.fill();

    // Subtle hairline dry pitch cracks around good-length zones
    ctx.strokeStyle = 'rgba(82, 56, 32, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const cx = 44 + Math.random() * (W - 88);
      const cy = 90 + Math.random() * (H - 180);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (Math.random() - 0.5) * 16, cy + 6 + Math.random() * 14);
      ctx.stroke();
    }

    if (pal.grass > 0.1) {
      ctx.fillStyle = 'rgba(45, 138, 52, 0.25)';
      ctx.beginPath();
      const gCount = Math.floor(380 * pal.grass);
      for (let i = 0; i < gCount; i++) {
        ctx.rect(Math.random() * W, Math.random() * H, 1.5, 4);
      }
      ctx.fill();
    }

    this.stampFootmarkCluster(86, 112, 0.28);
    this.stampFootmarkCluster(170, 392, 0.28);
    this.stampFootmarkCluster(128, 156, 0.16);
    this.stampFootmarkCluster(128, 356, 0.16);
    this.drawCreaseMarkings();

    this.map.needsUpdate = true;
  }

  /**
   * Draws crisp MCC Law 7 white chalk crease markings directly onto the pitch surface texture
   */
  drawCreaseMarkings() {
    const { ctx } = this;
    const wx = (worldX) => ((worldX + 1.6) / 3.2) * 256;
    const wz = (worldZ) => ((worldZ + 11.6) / 23.2) * 512;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.lineCap = 'square';

    [-1, 1].forEach((dir) => {
      const zPopping = dir * 8.84;
      const zBowling = dir * 10.06;
      const zBack = dir * 11.20;

      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(wx(-1.52), wz(zPopping));
      ctx.lineTo(wx(1.52), wz(zPopping));
      ctx.moveTo(wx(-1.22), wz(zBowling));
      ctx.lineTo(wx(1.22), wz(zBowling));
      [-1.22, 1.22].forEach((rx) => {
        ctx.moveTo(wx(rx), wz(zPopping));
        ctx.lineTo(wx(rx), wz(zBack));
      });
      [-0.56, 0.56].forEach((wgx) => {
        ctx.moveTo(wx(wgx), wz(zPopping));
        ctx.lineTo(wx(wgx), wz(zBowling));
      });
      ctx.stroke();
    });

    ctx.restore();
  }

  stampFootmarkCluster(px, py, alpha = 0.25) {
    const { ctx } = this;
    const rad = 18;
    const g = ctx.createRadialGradient(px, py, 2, px, py, rad);
    g.addColorStop(0, `rgba(76, 54, 34, ${alpha})`);
    g.addColorStop(0.6, `rgba(98, 72, 46, ${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(98, 72, 46, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  stampBallBounceWear(worldX, worldZ) {
    const u = THREE.MathUtils.clamp((worldX + 1.6) / 3.2, 0.05, 0.95);
    const v = THREE.MathUtils.clamp((worldZ + 11.6) / 23.2, 0.05, 0.95);
    const px = u * 256;
    const py = v * 512;

    const { ctx } = this;
    ctx.fillStyle = 'rgba(58, 39, 22, 0.35)';
    ctx.beginPath();
    ctx.ellipse(px, py, 4.5, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();

    this.map.needsUpdate = true;
  }
}

// Cache for jersey number textures so identical jersey color + number pairs share GPU textures
const _jerseyTexCache = new Map();

function createJerseyNumberTexture(primaryHex, secondaryHex, jerseyNumber = 18, flipX = false) {
  const isProHD = WAVEDASH_GRAPHICS_STATE.enabled;
  const key = `${primaryHex}_${secondaryHex}_${jerseyNumber}_${isProHD ? 'hd' : 'classic'}_${flipX ? 'L' : 'R'}`;
  if (_jerseyTexCache.has(key)) return _jerseyTexCache.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = isProHD ? 512 : 256;
  canvas.height = isProHD ? 512 : 256;
  const ctx = canvas.getContext('2d');

  const baseColor = new THREE.Color(primaryHex);
  const darkBase = baseColor.clone().multiplyScalar(0.68);
  const accentColor = new THREE.Color(secondaryHex || 0xf59e0b);

  if (!isProHD) {
    ctx.fillStyle = `#${baseColor.getHexString()}`;
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = `#${accentColor.getHexString()}`;
    ctx.fillRect(0, 0, 256, 22);
    ctx.fillRect(0, 218, 256, 16);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 78px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [64, 192].forEach((cx) => {
      ctx.save();
      ctx.translate(cx, 122);
      if (flipX) ctx.scale(-1, 1);
      ctx.fillText(String(jerseyNumber), 0, 0);
      ctx.restore();
    });
  } else {
    // Pro HD Wavedash T20 Broadcast Kit Texture (512x512)
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, `#${baseColor.getHexString()}`);
    g.addColorStop(0.55, `#${baseColor.getHexString()}`);
    g.addColorStop(1, `#${darkBase.getHexString()}`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle tonal athletic mesh pinstripes
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    for (let x = 0; x < 512; x += 16) {
      ctx.fillRect(x, 0, 4, 512);
    }

    // Accent shoulder yoke & waist trim
    ctx.fillStyle = `#${accentColor.getHexString()}`;
    ctx.fillRect(0, 0, 512, 38);
    ctx.fillRect(0, 444, 512, 26);

    // Dynamic diagonal chest chevron band
    ctx.save();
    ctx.strokeStyle = `#${accentColor.getHexString()}`;
    ctx.lineWidth = 18;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(0, 140);
    ctx.lineTo(128, 190);
    ctx.lineTo(256, 140);
    ctx.lineTo(384, 190);
    ctx.lineTo(512, 140);
    ctx.stroke();
    ctx.restore();

    // Crisp shadowed broadcast jersey number on front & back
    ctx.font = '900 148px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.78)';
    ctx.fillStyle = '#ffffff';
    [128, 384].forEach((cx) => {
      ctx.save();
      ctx.translate(cx, 252);
      if (flipX) ctx.scale(-1, 1);
      ctx.strokeText(String(jerseyNumber), 0, 0);
      ctx.fillText(String(jerseyNumber), 0, 0);
      ctx.restore();
    });
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _jerseyTexCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------------------------
// CARTOON BROADCAST CRICKETER (big-head, chunky-limb 3D style like modern mobile cricket games)
// Uses the exact same 17-bone mixamorig hierarchy / bone offsets as the other modes, so every
// AnimationClip, bat-grip, catch, dive & throw system keeps working unchanged.
// ---------------------------------------------------------------------------------------------
const _cartoonJerseyCache = new Map();

function createCartoonJerseyTexture(primaryHex, secondaryHex, jerseyNumber = 18, flipX = false) {
  const key = `${primaryHex}_${secondaryHex}_${jerseyNumber}_${flipX ? 'L' : 'R'}`;
  if (_cartoonJerseyCache.has(key)) return _cartoonJerseyCache.get(key);

  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  const base = new THREE.Color(primaryHex);
  const light = base.clone().lerp(new THREE.Color(0xffffff), 0.14);
  const dark = base.clone().multiplyScalar(0.78);
  const accent = new THREE.Color(secondaryHex || 0xf59e0b);
  const hex = (c) => `#${c.getHexString()}`;

  // Body colour with soft vertical shading (u = 0 is the FRONT of the shirt, u = 0.5 the BACK)
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, hex(light));
  g.addColorStop(0.5, hex(base));
  g.addColorStop(1, hex(dark));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Contrast side panels (under the arms) - u = 0.25 and 0.75
  ctx.fillStyle = hex(accent);
  [S * 0.25, S * 0.75].forEach((cx) => {
    ctx.fillRect(cx - 34, 70, 68, S - 70);
  });
  // thin white piping along the panels
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  [S * 0.25, S * 0.75].forEach((cx) => {
    ctx.fillRect(cx - 40, 70, 6, S - 70);
    ctx.fillRect(cx + 34, 70, 6, S - 70);
  });

  // Shoulder yoke
  ctx.fillStyle = hex(accent);
  ctx.fillRect(0, 0, S, 46);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, 46, S, 5);

  // Hem band
  ctx.fillStyle = hex(accent);
  ctx.fillRect(0, S - 30, S, 30);

  // Subtle chest chevron (front only: centred on u = 0 and wrapped at u = 1)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 12;
  [0, S].forEach((cx) => {
    ctx.beginPath();
    ctx.moveTo(cx - 70, 110);
    ctx.lineTo(cx, 150);
    ctx.lineTo(cx + 70, 110);
    ctx.stroke();
  });
  ctx.restore();

  // Sponsor band + club badge on the chest, small sponsor above the back number
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = "900 26px system-ui, 'Arial Black', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [0, S].forEach((cx) => ctx.fillText('BOX CRICKET', cx, 292));
  ctx.fillText('BOX CRICKET', S * 0.5, 92);
  ctx.fillStyle = hex(accent);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  [-62, 62].forEach((dx) => {
    [0, S].forEach((cx) => {
      if (dx > 0) return; // badge on the wearer's left chest only
      ctx.beginPath();
      ctx.arc(cx + dx, 150, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  });
  ctx.restore();

  const drawNumber = (cx, cy, size, outline) => {
    ctx.save();
    ctx.translate(cx, cy);
    if (flipX) ctx.scale(-1, 1);
    ctx.font = `900 ${size}px system-ui, -apple-system, 'Arial Black', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = outline;
    ctx.strokeStyle = 'rgba(8, 12, 28, 0.85)';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText(String(jerseyNumber), 0, 0);
    ctx.fillText(String(jerseyNumber), 0, 0);
    ctx.restore();
  };
  // Front chest number (small) - drawn at both seam edges so it wraps cleanly
  drawNumber(0, 205, 84, 7);
  drawNumber(S, 205, 84, 7);
  // Back number (big, like a broadcast kit)
  drawNumber(S * 0.5, 250, 170, 11);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.RepeatWrapping;
  _cartoonJerseyCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------------------------
// PROCEDURAL PBR NORMAL MAPS, TROUSER STRIPE & REALISTIC FACE TEXTURE (100% CODE-GENERATED)
// ---------------------------------------------------------------------------------------------
let _clothNormalTex = null;
export function getClothNormalMap() {
  if (_clothNormalTex) return _clothNormalTex;
  const S = 256;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Fine athletic jersey twill weave + subtle horizontal/diagonal tension creases
      const weave = Math.sin((x + y) * 0.78) * 0.16 + Math.sin((x - y) * 0.78) * 0.12;
      const fold1 = Math.sin(y * 0.14 + Math.sin(x * 0.05) * 1.4) * 0.42;
      const fold2 = Math.sin(y * 0.27 - Math.cos(x * 0.07) * 0.9) * 0.24;
      const seam = (x < 3 || x > S - 4 || Math.abs(x - S * 0.25) < 2 || Math.abs(x - S * 0.75) < 2) ? -0.45 : 0;
      h[y * S + x] = weave + fold1 + fold2 + seam;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const strength = 2.4;
  for (let y = 0; y < S; y++) {
    const ym = (y - 1 + S) % S;
    const yp = (y + 1) % S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S;
      const xp = (x + 1) % S;
      const dx = (h[y * S + xp] - h[y * S + xm]) * strength;
      const dy = (h[yp * S + x] - h[ym * S + x]) * strength;
      const invLen = 1 / Math.hypot(dx, dy, 1);
      const idx = (y * S + x) * 4;
      img.data[idx + 0] = Math.round(((-dx * invLen) * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.round(((-dy * invLen) * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.round(((invLen) * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 1.5);
  _clothNormalTex = tex;
  return tex;
}

let _padLeatherNormalTex = null;
function getPadLeatherNormalMap() {
  if (_padLeatherNormalTex) return _padLeatherNormalTex;
  const S = 128;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const grain = Math.sin(x * 1.3) * Math.cos(y * 1.3) * 0.14;
      const stitch = ((x % 32 < 2) && (y % 6 < 3)) ? -0.5 : 0;
      const cushion = Math.sin((y / S) * Math.PI * 5) * 0.18;
      h[y * S + x] = grain + stitch + cushion;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const strength = 2.0;
  for (let y = 0; y < S; y++) {
    const ym = (y - 1 + S) % S;
    const yp = (y + 1) % S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S;
      const xp = (x + 1) % S;
      const dx = (h[y * S + xp] - h[y * S + xm]) * strength;
      const dy = (h[yp * S + x] - h[ym * S + x]) * strength;
      const invLen = 1 / Math.hypot(dx, dy, 1);
      const idx = (y * S + x) * 4;
      img.data[idx + 0] = Math.round(((-dx * invLen) * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.round(((-dy * invLen) * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.round(((invLen) * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  _padLeatherNormalTex = tex;
  return tex;
}

const _trouserTexCache = new Map();
function createTrouserStripeTexture(trouserColorHex, accentHex) {
  const key = `${trouserColorHex}_${accentHex}`;
  if (_trouserTexCache.has(key)) return _trouserTexCache.get(key);
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(trouserColorHex);
  const darker = base.clone().multiplyScalar(0.82);
  const acc = new THREE.Color(accentHex || 0xf59e0b);

  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, `#${base.getHexString()}`);
  g.addColorStop(0.55, `#${base.getHexString()}`);
  g.addColorStop(1, `#${darker.getHexString()}`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Subtle front crease line (u = 0 / 1) and outer athletic side piping (u = 0.25 & u = 0.75)
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, 20, 4, S - 30);
  ctx.fillRect(S - 4, 20, 4, S - 30);
  ctx.fillStyle = `#${acc.getHexString()}`;
  [S * 0.25, S * 0.75].forEach((cx) => {
    ctx.fillRect(cx - 8, 8, 16, S - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillRect(cx - 10, 8, 2, S - 16);
    ctx.fillRect(cx + 8, 8, 2, S - 16);
    ctx.fillStyle = `#${acc.getHexString()}`;
  });
  // Subtle knee shadow shading band
  const kg = ctx.createLinearGradient(0, S * 0.42, 0, S * 0.6);
  kg.addColorStop(0, 'rgba(0,0,0,0)');
  kg.addColorStop(0.5, 'rgba(0,0,0,0.14)');
  kg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = kg;
  ctx.fillRect(0, S * 0.42, S, S * 0.18);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  _trouserTexCache.set(key, tex);
  return tex;
}

const _faceTexCache = new Map();
export function createProFaceTexture(skinHex, hairHex, hasBeard) {
  const key = `${skinHex}_${hairHex}_${hasBeard ? 1 : 0}`;
  if (_faceTexCache.has(key)) return _faceTexCache.get(key);
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  const skin = new THREE.Color(skinHex);
  const warm = skin.clone().lerp(new THREE.Color(0xc26d53), 0.16);
  const shadow = skin.clone().multiplyScalar(0.76);
  const hair = new THREE.Color(hairHex);
  const hex = (c) => `#${c.getHexString()}`;

  ctx.fillStyle = hex(skin);
  ctx.fillRect(0, 0, S, S);

  // Subtle facial warmth on cheeks & forehead-chin gradient (front face is centered at u = 0.75 in SphereGeometry if rotated +PI/2? Wait: SphereGeometry theta=0 is +X, +Z is u=0.75 or rotated. We'll orient headSphere rotation.y = -Math.PI/2 so +Z faces u=0.5!)
  const cx = S * 0.5;
  const shadeGrad = ctx.createRadialGradient(cx, S * 0.48, 12, cx, S * 0.5, 92);
  shadeGrad.addColorStop(0, hex(skin.clone().lerp(new THREE.Color(0xffffff), 0.08)));
  shadeGrad.addColorStop(0.6, hex(skin));
  shadeGrad.addColorStop(1, hex(shadow));
  ctx.fillStyle = shadeGrad;
  ctx.fillRect(0, 0, S, S);

  // Cheek warmth
  [-26, 26].forEach((dx) => {
    const cg = ctx.createRadialGradient(cx + dx, S * 0.54, 2, cx + dx, S * 0.54, 18);
    cg.addColorStop(0, `rgba(${Math.round(warm.r * 255)}, ${Math.round(warm.g * 255)}, ${Math.round(warm.b * 255)}, 0.45)`);
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.fillRect(cx + dx - 20, S * 0.44, 40, 40);
  });

  // Eye socket soft shadows
  [-17, 17].forEach((dx) => {
    const eg = ctx.createRadialGradient(cx + dx, S * 0.45, 2, cx + dx, S * 0.45, 13);
    eg.addColorStop(0, 'rgba(30, 16, 10, 0.28)');
    eg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = eg;
    ctx.fillRect(cx + dx - 14, S * 0.38, 28, 28);
  });

  // Natural eyes (almond sclera + dark iris + catchlight + upper lash crease)
  [-17, 17].forEach((dx) => {
    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.ellipse(cx + dx, S * 0.455, 7.5, 3.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#181311';
    ctx.beginPath();
    ctx.arc(cx + dx, S * 0.455, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + dx - 1.1, S * 0.447, 1.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(22, 14, 10, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx + dx, S * 0.453, 8.2, 4.0, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  // Expressive sculpted eyebrows
  ctx.strokeStyle = hex(hair);
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  [-1, 1].forEach((s) => {
    ctx.beginPath();
    ctx.moveTo(cx + s * 8, S * 0.415);
    ctx.quadraticCurveTo(cx + s * 17, S * 0.402, cx + s * 27, S * 0.417);
    ctx.stroke();
  });

  // Nose bridge highlight & subtle shadow
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(cx - 2, S * 0.44, 4, 24);
  ctx.fillStyle = 'rgba(30, 16, 10, 0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, S * 0.555, 6.5, 3.0, 0, 0, Math.PI * 2);
  ctx.fill();

  // Natural athletic mouth / lip line
  ctx.strokeStyle = 'rgba(115, 55, 45, 0.72)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - 10, S * 0.625);
  ctx.quadraticCurveTo(cx, S * 0.634, cx + 10, S * 0.625);
  ctx.stroke();

  // Athletic trimmed beard / stubble along jawline & sideburns
  if (hasBeard) {
    ctx.save();
    ctx.fillStyle = `rgba(${Math.round(hair.r * 255)}, ${Math.round(hair.g * 255)}, ${Math.round(hair.b * 255)}, 0.58)`;
    ctx.beginPath();
    ctx.moveTo(cx - 42, S * 0.48);
    ctx.quadraticCurveTo(cx - 34, S * 0.74, cx, S * 0.77);
    ctx.quadraticCurveTo(cx + 34, S * 0.74, cx + 42, S * 0.48);
    ctx.lineTo(cx + 34, S * 0.55);
    ctx.quadraticCurveTo(cx + 22, S * 0.66, cx + 12, S * 0.65);
    ctx.lineTo(cx - 12, S * 0.65);
    ctx.quadraticCurveTo(cx - 22, S * 0.66, cx - 34, S * 0.55);
    ctx.closePath();
    ctx.fill();
    // Moustache & soul patch
    ctx.fillRect(cx - 13, S * 0.595, 26, 4.5);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _faceTexCache.set(key, tex);
  return tex;
}

/**
 * Builds a continuous procedural THREE.SkinnedMesh tube from elliptical cross-section rings
 * defined in unscaled `root` rest space.
 * UV convention: u = 0 at FRONT (+Z), 0.25 left (+X), 0.5 BACK (-Z), 0.75 right (-X); v = 1 top -> 0 bottom.
 */
function buildSkinnedTubeMesh(rings, radialSegs, skeleton, material, opts = {}) {
  const numRings = rings.length;
  const cols = radialSegs + 1;
  const vertCount = numRings * cols;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const skinIndices = new Uint16Array(vertCount * 4);
  const skinWeights = new Float32Array(vertCount * 4);
  const indices = [];

  for (let r = 0; r < numRings; r++) {
    const ring = rings[r];
    const [cx, cy, cz] = ring.c;
    const rx = ring.rx;
    const rz = ring.rz ?? ring.rx;
    const v = 1 - r / Math.max(1, numRings - 1);
    const bA = ring.bA ?? 0;
    const wA = ring.wA ?? 1;
    const bB = ring.bB ?? bA;
    const wB = ring.wB ?? 0;
    const bC = ring.bC ?? bA;
    const wC = ring.wC ?? 0;
    const twist = ring.twist || 0;

    for (let s = 0; s <= radialSegs; s++) {
      const u = s / radialSegs;
      const theta = u * Math.PI * 2 + twist;
      const px = cx + Math.sin(theta) * rx;
      const pz = cz + Math.cos(theta) * rz;
      const idx = r * cols + s;
      positions[idx * 3 + 0] = px;
      positions[idx * 3 + 1] = cy;
      positions[idx * 3 + 2] = pz;
      uvs[idx * 2 + 0] = u;
      uvs[idx * 2 + 1] = v;
      skinIndices[idx * 4 + 0] = bA;
      skinIndices[idx * 4 + 1] = bB;
      skinIndices[idx * 4 + 2] = bC;
      skinIndices[idx * 4 + 3] = 0;
      skinWeights[idx * 4 + 0] = wA;
      skinWeights[idx * 4 + 1] = wB;
      skinWeights[idx * 4 + 2] = wC;
      skinWeights[idx * 4 + 3] = 0;
    }
  }

  for (let r = 0; r < numRings - 1; r++) {
    for (let s = 0; s < radialSegs; s++) {
      const a = r * cols + s;
      const b = a + cols;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = Boolean(opts.castShadow);
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // prevents disappearing during fast diving/lofted motion
  mesh.bind(skeleton, new THREE.Matrix4());
  return mesh;
}

function createCartoonRiggedCharacter({
  colorHex = 0x0284c7,
  secondaryColorHex = 0xf59e0b,
  jerseyNumber = 18,
  skinHex = 0xd69e72,
  role = 'fielder',
  flipJerseyText = false
}) {
  const root = new THREE.Group();
  const isBat = role === 'batsman' || role === 'keeper';

  // Deterministic per-player athletic physique & facial variety
  let _seed = ((Number(jerseyNumber) || 1) * 2654435761 + ((Number(skinHex) || 0) & 0xffff) * 40503) >>> 0;
  const rnd = () => {
    _seed = (Math.imul(_seed ^ (_seed >>> 15), 2246822519) + 3266489917) >>> 0;
    return ((_seed ^ (_seed >>> 13)) >>> 0) / 4294967295;
  };
  const buildX = PRO ? 0.94 + rnd() * 0.11 : 0.96 + rnd() * 0.14;
  const heightY = PRO ? 0.97 + rnd() * 0.08 : 0.95 + rnd() * 0.10;
  const hairStyle = Math.floor(rnd() * 4);
  const hasBeard = rnd() < 0.46;
  const hairShade = [0x14100d, 0x1e150e, 0x2a1c12, 0x353230][Math.floor(rnd() * 4)];

  const teamColor = new THREE.Color(colorHex);
  const accentColor = new THREE.Color(secondaryColorHex || 0xf59e0b);
  const darkTeam = teamColor.clone().multiplyScalar(0.62);
  const trouserTint = teamColor.clone().multiplyScalar(0.72);
  const jerseyTex = createCartoonJerseyTexture(colorHex, secondaryColorHex, jerseyNumber, flipJerseyText);
  const trouserTex = createTrouserStripeTexture(trouserTint.getHex(), accentColor.getHex());
  const clothNormal = getClothNormalMap();
  const padNormal = getPadLeatherNormalMap();

  const mat = (color, rough = 0.56, metal = 0.02) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const jerseyMat = new THREE.MeshStandardMaterial({
    map: jerseyTex,
    normalMap: clothNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.62,
    metalness: 0.02
  });
  const sleeveMat = new THREE.MeshStandardMaterial({
    color: teamColor,
    normalMap: clothNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.6,
    metalness: 0.02
  });
  const trouserMat = new THREE.MeshStandardMaterial({
    map: trouserTex,
    normalMap: clothNormal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughness: 0.66,
    metalness: 0.02
  });
  const stripeMat = mat(accentColor, 0.45);
  const skinMat = mat(skinHex, 0.52);
  skinMat.emissive = new THREE.Color(skinHex).multiplyScalar(0.14);
  const whiteMat = mat(0xf8fafc, 0.38, 0.04);
  const padMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    normalMap: padNormal,
    normalScale: new THREE.Vector2(0.38, 0.38),
    roughness: 0.34,
    metalness: 0.04
  });
  const padWingMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    normalMap: padNormal,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 0.38,
    metalness: 0.04
  });
  const gloveLeatherMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    normalMap: padNormal,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.32,
    metalness: 0.05
  });
  const shoeMat = mat(0xf8fafc, 0.42, 0.05);
  const soleMat = mat(accentColor, 0.48);
  const darkSoleMat = mat(0x1e293b, 0.65, 0.1);
  const hairMat = mat(hairShade, 0.82);
  const steelMat = mat(0xdde3ec, 0.24, 0.88);
  const darkStrapMat = mat(0x1e293b, 0.65);

  const isCloseActor = role === 'batsman' || role === 'bowler' || role === 'keeper';
  const add = (parent, geo, material, x = 0, y = 0, z = 0, opts = {}) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    if (opts.scale) m.scale.set(...opts.scale);
    if (opts.rot) m.rotation.set(...opts.rot);
    m.castShadow = isCloseActor && !opts.noShadow;
    m.receiveShadow = false;
    parent.add(m);
    return m;
  };

  // ===================== EXACT 17-BONE HIERARCHY (compatible with all IK & mocap clips) =====================
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  hips.position.set(0, 0.92, 0);
  root.add(hips);

  const spine = new THREE.Bone();
  spine.name = 'mixamorigSpine';
  spine.position.set(0, 0.10, 0);
  hips.add(spine);

  const spine1 = new THREE.Bone();
  spine1.name = 'mixamorigSpine1';
  spine1.position.set(0, 0.24, 0);
  spine.add(spine1);

  const head = new THREE.Bone();
  head.name = 'mixamorigHead';
  head.position.set(0, 0.28, 0);
  spine1.add(head);

  const rArm = new THREE.Bone();
  rArm.name = 'mixamorigRightArm';
  rArm.position.set(-0.24, 0.14, 0);
  spine1.add(rArm);
  const rFore = new THREE.Bone();
  rFore.name = 'mixamorigRightForeArm';
  rFore.position.set(0, -0.26, 0);
  rArm.add(rFore);
  const rHand = new THREE.Bone();
  rHand.name = 'mixamorigRightHand';
  rHand.position.set(0, -0.23, 0);
  rFore.add(rHand);

  const lArm = new THREE.Bone();
  lArm.name = 'mixamorigLeftArm';
  lArm.position.set(0.24, 0.14, 0);
  spine1.add(lArm);
  const lFore = new THREE.Bone();
  lFore.name = 'mixamorigLeftForeArm';
  lFore.position.set(0, -0.26, 0);
  lArm.add(lFore);
  const lHand = new THREE.Bone();
  lHand.name = 'mixamorigLeftHand';
  lHand.position.set(0, -0.23, 0);
  lFore.add(lHand);

  const rUpLeg = new THREE.Bone();
  rUpLeg.name = 'mixamorigRightUpLeg';
  rUpLeg.position.set(-0.105, -0.05, 0);
  hips.add(rUpLeg);
  const rLeg = new THREE.Bone();
  rLeg.name = 'mixamorigRightLeg';
  rLeg.position.set(0, -0.40, 0);
  rUpLeg.add(rLeg);
  const rFoot = new THREE.Bone();
  rFoot.name = 'mixamorigRightFoot';
  rFoot.position.set(0, -0.405, 0);
  rLeg.add(rFoot);

  const lUpLeg = new THREE.Bone();
  lUpLeg.name = 'mixamorigLeftUpLeg';
  lUpLeg.position.set(0.105, -0.05, 0);
  hips.add(lUpLeg);
  const lLeg = new THREE.Bone();
  lLeg.name = 'mixamorigLeftLeg';
  lLeg.position.set(0, -0.40, 0);
  lUpLeg.add(lLeg);
  const lFoot = new THREE.Bone();
  lFoot.name = 'mixamorigLeftFoot';
  lFoot.position.set(0, -0.405, 0);
  lLeg.add(lFoot);

  // Skeleton array indices:
  // 0:hips, 1:spine, 2:spine1, 3:head, 4:rArm, 5:rFore, 6:rHand, 7:lArm, 8:lFore, 9:lHand,
  // 10:rUpLeg, 11:rLeg, 12:rFoot, 13:lUpLeg, 14:lLeg, 15:lFoot
  const bones = [
    hips, spine, spine1, head,
    rArm, rFore, rHand,
    lArm, lFore, lHand,
    rUpLeg, rLeg, rFoot,
    lUpLeg, lLeg, lFoot
  ];
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.calculateInverses();

  // ===================== 1. CONTINUOUS SKINNED TORSO (Athletic V-Taper + Jersey Texture) =====================
  const torsoWidth = PRO ? 1.0 : 1.1;
  const torsoRings = [
    { c: [0, 1.445, 0.0], rx: 0.088 * torsoWidth, rz: 0.082, bA: 2, wA: 1.0 }, // collar base
    { c: [0, 1.40, 0.0], rx: 0.165 * torsoWidth, rz: 0.118, bA: 2, wA: 1.0 },  // trapezius / upper chest
    { c: [0, 1.33, 0.006], rx: 0.218 * torsoWidth, rz: 0.136, bA: 2, wA: 0.92, bB: 1, wB: 0.08 }, // pectoral breadth
    { c: [0, 1.24, 0.008], rx: 0.204 * torsoWidth, rz: 0.132, bA: 2, wA: 0.7, bB: 1, wB: 0.3 },   // chest / ribcage
    { c: [0, 1.13, 0.006], rx: 0.178 * torsoWidth, rz: 0.122, bA: 1, wA: 0.85, bB: 2, wB: 0.15 }, // mid abdomen
    { c: [0, 1.02, 0.002], rx: 0.168 * torsoWidth, rz: 0.118, bA: 1, wA: 0.6, bB: 0, wB: 0.4 },   // athletic waist
    { c: [0, 0.93, 0.0], rx: 0.178 * torsoWidth, rz: 0.126, bA: 0, wA: 0.85, bB: 1, wB: 0.15 },   // jersey hem over hips
    { c: [0, 0.885, 0.0], rx: 0.172 * torsoWidth, rz: 0.122, bA: 0, wA: 1.0 }                    // tucked bottom taper
  ];
  const torsoSkinned = buildSkinnedTubeMesh(torsoRings, isCloseActor ? 20 : 14, skeleton, jerseyMat, { castShadow: isCloseActor });
  root.add(torsoSkinned);

  // Athletic V-neck polo collar & placket on chest
  add(spine1, new THREE.TorusGeometry(0.088, 0.018, 6, 16).rotateX(Math.PI * 0.5), stripeMat, 0, 0.175, 0.004, { scale: [1.06, 1.0, 0.96], noShadow: true });
  add(spine1, new THREE.BoxGeometry(0.036, 0.075, 0.016), stripeMat, 0, 0.135, 0.118, { rot: [-0.22, 0, 0], noShadow: true });

  // Sculpted pelvis / seat bridging hips into upper thighs cleanly
  const pelvisRings = [
    { c: [0, 0.955, 0.0], rx: 0.176 * torsoWidth, rz: 0.125, bA: 0, wA: 1.0 },
    { c: [0, 0.90, -0.004], rx: 0.184 * torsoWidth, rz: 0.134, bA: 0, wA: 1.0 },
    { c: [0, 0.84, -0.004], rx: 0.174 * torsoWidth, rz: 0.124, bA: 0, wA: 0.8, bB: 10, wB: 0.1, bC: 13, wC: 0.1 },
    { c: [0, 0.79, 0.0], rx: 0.125 * torsoWidth, rz: 0.105, bA: 0, wA: 0.65, bB: 10, wB: 0.175, bC: 13, wC: 0.175 }
  ];
  const pelvisSkinned = buildSkinnedTubeMesh(pelvisRings, 14, skeleton, trouserMat, { castShadow: false });
  root.add(pelvisSkinned);

  // ===================== 2. CONTINUOUS SKINNED ARMS (SLEEVES + SEAMLESS BICEP/ELBOW/FOREARM) =====================
  const armScale = PRO ? 0.86 : 1.0;
  const makeArm = (side, dir, armIdx, foreIdx, handIdx, armBone, foreBone, handBone) => {
    const sx = dir * 0.24;
    // Short athletic sleeve (continuous deltoid -> mid-bicep cuff, smoothly blended spine1 -> arm)
    const sleeveRings = [
      { c: [dir * 0.19, 1.41, 0.0], rx: 0.068 * armScale, rz: 0.068 * armScale, bA: 2, wA: 0.55, bB: armIdx, wB: 0.45 },
      { c: [sx, 1.385, 0.0], rx: 0.074 * armScale, rz: 0.072 * armScale, bA: armIdx, wA: 0.78, bB: 2, wB: 0.22 },
      { c: [sx, 1.32, 0.0], rx: 0.069 * armScale, rz: 0.067 * armScale, bA: armIdx, wA: 1.0 },
      { c: [sx, 1.245, 0.0], rx: 0.066 * armScale, rz: 0.065 * armScale, bA: armIdx, wA: 1.0 }
    ];
    root.add(buildSkinnedTubeMesh(sleeveRings, 12, skeleton, sleeveMat, { castShadow: isCloseActor }));
    add(armBone, new THREE.TorusGeometry(0.065 * armScale, 0.009, 6, 14).rotateX(Math.PI * 0.5), stripeMat, 0, -0.155, 0, { noShadow: true });

    // Continuous skin limb (lower bicep -> smooth bending elbow -> athletic forearm -> wrist)
    const skinArmRings = [
      { c: [sx, 1.25, 0.0], rx: 0.056 * armScale, rz: 0.055 * armScale, bA: armIdx, wA: 1.0 },
      { c: [sx, 1.19, 0.0], rx: 0.053 * armScale, rz: 0.052 * armScale, bA: armIdx, wA: 0.9, bB: foreIdx, wB: 0.1 },
      { c: [sx, 1.14, 0.0], rx: 0.050 * armScale, rz: 0.049 * armScale, bA: armIdx, wA: 0.5, bB: foreIdx, wB: 0.5 }, // elbow crease
      { c: [sx, 1.08, 0.004], rx: 0.052 * armScale, rz: 0.050 * armScale, bA: foreIdx, wA: 0.9, bB: armIdx, wB: 0.1 }, // forearm muscle
      { c: [sx, 0.99, 0.0], rx: 0.044 * armScale, rz: 0.042 * armScale, bA: foreIdx, wA: 1.0 },
      { c: [sx, 0.915, 0.0], rx: 0.036 * armScale, rz: 0.034 * armScale, bA: foreIdx, wA: 0.75, bB: handIdx, wB: 0.25 } // wrist
    ];
    root.add(buildSkinnedTubeMesh(skinArmRings, 12, skeleton, skinMat, { castShadow: isCloseActor }));

    if (isBat) {
      // Articulated Pro Batting Gloves (ribbed sweatband cuff + sculpted palm + 4 finger-pad rolls + thumb guard)
      const k = role === 'keeper' ? 1.16 : 1.0;
      add(foreBone, new THREE.CylinderGeometry(0.048 * k, 0.046 * k, 0.052, 12), stripeMat, 0, -0.20, 0, { noShadow: true });
      add(handBone, new THREE.CapsuleGeometry(0.042 * k, 0.044 * k, 4, 10), gloveLeatherMat, 0, -0.028, 0.0, { scale: [1.02, 1.0, 0.78], noShadow: true });
      // 4 segmented finger rolls + knuckle split
      for (let f = 0; f < 4; f++) {
        const fy = -0.005 - f * 0.020 * k;
        add(handBone, new THREE.CapsuleGeometry(0.011 * k, 0.056 * k, 4, 8), gloveLeatherMat, 0, fy, 0.036 * k, { rot: [0, 0, Math.PI * 0.5], noShadow: true });
        add(handBone, new THREE.BoxGeometry(0.005, 0.014 * k, 0.024 * k), stripeMat, 0, fy, 0.041 * k, { noShadow: true });
      }
      // Padded thumb roll
      add(handBone, new THREE.CapsuleGeometry(0.013 * k, 0.036 * k, 4, 8), gloveLeatherMat, -dir * 0.042 * k, -0.014, 0.02 * k, { rot: [0.3, 0, dir * 0.35], noShadow: true });
    } else {
      add(handBone, new THREE.CapsuleGeometry(0.034, 0.044, 4, 8), skinMat, 0, -0.03, 0, { scale: [0.95, 1.0, 0.68], noShadow: true });
    }
  };
  makeArm('Right', -1, 4, 5, 6, rArm, rFore, rHand);
  makeArm('Left', 1, 7, 8, 9, lArm, lFore, lHand);

  // ===================== 3. CONTINUOUS SKINNED TROUSER LEGS + PRO 3-RIB PADS + SPIKED SHOES =====================
  const legScale = PRO ? 0.88 : 1.0;
  const makeLeg = (side, dir, upIdx, legIdx, footIdx, legBone, footBone) => {
    const lx = dir * 0.105;
    // Continuous athletic cricket trouser from hip joint down through contoured thigh, knee & calf to ankle
    const legRings = [
      { c: [lx, 0.89, 0.0], rx: 0.095 * legScale, rz: 0.098 * legScale, bA: upIdx, wA: 0.72, bB: 0, wB: 0.28 },
      { c: [lx, 0.77, 0.006], rx: 0.092 * legScale, rz: 0.095 * legScale, bA: upIdx, wA: 1.0 }, // quad fullness
      { c: [lx, 0.62, 0.004], rx: 0.078 * legScale, rz: 0.082 * legScale, bA: upIdx, wA: 0.94, bB: legIdx, wB: 0.06 },
      { c: [lx, 0.47, 0.008], rx: 0.069 * legScale, rz: 0.074 * legScale, bA: upIdx, wA: 0.5, bB: legIdx, wB: 0.5 }, // smooth bending knee
      { c: [lx, 0.34, -0.005], rx: 0.068 * legScale, rz: 0.073 * legScale, bA: legIdx, wA: 0.92, bB: upIdx, wB: 0.08 }, // calf contour
      { c: [lx, 0.19, -0.002], rx: 0.056 * legScale, rz: 0.060 * legScale, bA: legIdx, wA: 1.0 },
      { c: [lx, 0.09, 0.0], rx: 0.052 * legScale, rz: 0.055 * legScale, bA: legIdx, wA: 0.82, bB: footIdx, wB: 0.18 } // hem over shoe
    ];
    root.add(buildSkinnedTubeMesh(legRings, isCloseActor ? 14 : 10, skeleton, trouserMat, { castShadow: isCloseActor }));

    if (isBat) {
      // Pro 3-Rib Contoured Batting Pad (3 vertical cane bolsters + outer side-wing + sculpted 2-roll knee cap + rear straps)
      const padGroup = new THREE.Group();
      padGroup.position.set(0, -0.19, 0.058);
      legBone.add(padGroup);

      // 3 angled vertical front cane ribs wrapping around the shin
      [
        { x: -0.036, z: -0.010, ry: -0.28, w: 0.038, h: 0.37 },
        { x: 0.0, z: 0.005, ry: 0.0, w: 0.044, h: 0.38 },
        { x: 0.036, z: -0.010, ry: 0.28, w: 0.038, h: 0.37 }
      ].forEach((rib) => {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(rib.w * 0.48, rib.h * 0.78, 4, 8), padMat);
        m.position.set(rib.x, 0.0, rib.z);
        m.rotation.y = rib.ry;
        m.scale.set(1.0, 1.0, 0.56);
        m.castShadow = isCloseActor;
        padGroup.add(m);
      });

      // Outer protective side wing + team accent edge trim
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.34, 0.068), padWingMat);
      wing.position.set(dir * 0.062, 0.02, -0.024);
      wing.rotation.y = dir * 0.35;
      padGroup.add(wing);

      // Top hat & 2-piece horizontal sculpted knee roll (signature cricket pad silhouette)
      add(padGroup, new THREE.SphereGeometry(0.068, 12, 8), padMat, 0, 0.245, -0.004, { scale: [1.08, 0.65, 0.52], noShadow: true });
      [0.19, 0.225].forEach((ky) => {
        add(padGroup, new THREE.CapsuleGeometry(0.019, 0.095, 4, 8), padMat, 0, ky, 0.012, { rot: [0, 0, Math.PI * 0.5], scale: [1, 1, 0.8], noShadow: true });
      });

      // Lower ankle instep pad arch
      add(padGroup, new THREE.BoxGeometry(0.088, 0.042, 0.034), stripeMat, 0, -0.195, 0.012, { noShadow: true });

      // Two rear Velcro wrap straps with metallic/accent buckle loop
      [0.06, -0.09].forEach((sy) => {
        add(legBone, new THREE.TorusGeometry(0.066 * legScale, 0.011, 5, 14), stripeMat, 0, -0.18 + sy, 0.0, { rot: [Math.PI * 0.5, 0, 0], scale: [1.05, 1.12, 1.0], noShadow: true });
      });
    }

    // Contoured Athletic Spiked Cricket Shoe
    add(footBone, new THREE.CapsuleGeometry(0.052, 0.115, 5, 10), shoeMat, 0, 0.008, 0.052, { rot: [Math.PI * 0.5, 0, 0], scale: [1.02, 1.0, 0.72], noShadow: true });
    // Heel counter accent & side swoosh panel
    add(footBone, new THREE.CylinderGeometry(0.048, 0.054, 0.055, 10), darkStrapMat, 0, 0.015, -0.015, { scale: [1.0, 1.0, 1.1], noShadow: true });
    add(footBone, new THREE.BoxGeometry(0.106, 0.018, 0.05), stripeMat, 0, 0.002, 0.042, { noShadow: true });
    // Two-tone athletic sole + outsole cleats
    add(footBone, new THREE.BoxGeometry(0.104, 0.016, 0.232), soleMat, 0, -0.026, 0.054, { noShadow: true });
    add(footBone, new THREE.BoxGeometry(0.106, 0.01, 0.235), darkSoleMat, 0, -0.038, 0.054, { noShadow: true });
  };
  makeLeg('Right', -1, 10, 11, 12, rLeg, rFoot);
  makeLeg('Left', 1, 13, 14, 15, lLeg, lFoot);

  // ===================== 4. ATHLETIC NECK, SCULPTED PRO HEAD (PAINTED FACE TEXTURE) & VENTED HELMET =====================
  add(head, new THREE.CylinderGeometry(0.062, 0.076, 0.125, 12), skinMat, 0, -0.06, 0, { noShadow: true });

  const headG = new THREE.Group();
  headG.scale.setScalar(PRO ? 0.94 : 1.28);
  headG.position.set(0, PRO ? -0.01 : 0.025, 0.0);
  head.add(headG);

  const faceTex = createProFaceTexture(skinHex, hairShade, hasBeard);
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    roughness: 0.5,
    metalness: 0.02,
    emissive: new THREE.Color(skinHex).multiplyScalar(0.12)
  });

  // Main head skull rotated -PI/2 around Y so sphere u = 0.5 faces +Z (camera/bowler)
  add(headG, new THREE.SphereGeometry(0.124, 18, 14), faceMat, 0, 0.048, 0.0, {
    scale: [0.92, 1.06, 1.02],
    rot: [0, -Math.PI * 0.5, 0]
  });
  if (isCloseActor) {
    // Athletic jawline / chin taper + ears + sculpted nose
    add(headG, new THREE.SphereGeometry(0.088, 10, 8), skinMat, 0, -0.008, 0.022, { scale: [0.92, 0.85, 0.98], noShadow: true });
    [-1, 1].forEach((s) =>
      add(headG, new THREE.SphereGeometry(0.024, 8, 6), skinMat, s * 0.114, 0.042, -0.005, { scale: [0.48, 1.08, 0.78], noShadow: true })
    );
    add(headG, new THREE.ConeGeometry(0.018, 0.044, 7), skinMat, 0, 0.036, 0.125, { rot: [Math.PI * 0.42, 0, 0], scale: [0.85, 1.0, 0.75], noShadow: true });
  }

  // Hair around temples/back
  const hairDome = add(headG, new THREE.SphereGeometry(0.129, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.46), hairMat, 0, 0.056, -0.012, {
    scale: [0.95, 1.05, 1.02],
    noShadow: true
  });
  hairDome.rotation.x = -0.22;
  if (hairStyle === 3) hairDome.visible = false;

  if (isBat) {
    // Authentic ICC/IPL Pro Cricket Helmet (Masuri/Shrey silhouette: snug dome, tapered curved peak,
    // sphere-hugging crown ridge, flush cheek/ear guards, dual StemGuard nape pods, titanium grille & under-chin strap)
    const helmetCol = teamColor.clone().multiplyScalar(0.68);
    const helmetMat = new THREE.MeshStandardMaterial({ color: helmetCol, roughness: 0.30, metalness: 0.24 });
    const stemGuardMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.62, metalness: 0.12 });

    // 1. Snug anatomical helmet dome tilted slightly back so brow sits cleanly above the eyes & rear wraps low
    add(headG, new THREE.SphereGeometry(0.138, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), helmetMat, 0, 0.064, -0.006, {
      scale: [0.97, 0.99, 1.06],
      rot: [-0.14, 0, 0]
    });

    // 2. Curved sphere-hugging center crest ridge & subtle twin air-vent ribs (follows dome curvature — zero flat boxes!)
    const crestArc = add(
      headG,
      new THREE.TorusGeometry(0.136, 0.0065, 6, 16, Math.PI * 0.62),
      stripeMat,
      0,
      0.066,
      -0.006,
      { rot: [0, Math.PI * 0.5, Math.PI * 0.19], scale: [1.05, 0.99, 1.0], noShadow: true }
    );
    crestArc.rotation.order = 'YXZ';
    [-0.036, 0.036].forEach((vx) => {
      add(
        headG,
        new THREE.TorusGeometry(0.132, 0.0042, 5, 12, Math.PI * 0.42),
        darkStrapMat,
        vx,
        0.064,
        -0.004,
        { rot: [0, Math.PI * 0.5, Math.PI * 0.29], scale: [1.04, 0.98, 1.0], noShadow: true }
      );
    });

    // 3. Smoothly tapered curved cricket peak / visor (centered at phi=PI/2 => +Z front brow, clear eye window above grille)
    add(
      headG,
      new THREE.SphereGeometry(0.130, 16, 8, Math.PI * 0.14, Math.PI * 0.72, Math.PI * 0.32, Math.PI * 0.22),
      helmetMat,
      0,
      0.112,
      0.026,
      { scale: [0.98, 0.34, 1.36], rot: [0.16, 0, 0], noShadow: true }
    );

    // 4. Flush contoured side ear/temple shells angling smoothly into jawline
    [-1, 1].forEach((s) =>
      add(headG, new THREE.SphereGeometry(0.056, 10, 8), helmetMat, s * 0.118, 0.024, -0.008, {
        scale: [0.46, 1.08, 1.12],
        rot: [0.08, 0, s * 0.14],
        noShadow: true
      })
    );

    // 5. Curved rear occipital wrap (centered at phi=1.5*PI => -Z back of skull) + dual ICC StemGuard nape pods
    add(
      headG,
      new THREE.SphereGeometry(0.134, 14, 8, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.44, Math.PI * 0.28),
      helmetMat,
      0,
      0.056,
      -0.008,
      { scale: [0.96, 1.02, 1.04], noShadow: true }
    );
    [-0.048, 0.048].forEach((sx) =>
      add(headG, new THREE.SphereGeometry(0.042, 8, 7), stemGuardMat, sx, -0.012, -0.118, {
        scale: [1.05, 0.76, 0.52],
        rot: [0.18, sx > 0 ? 0.26 : -0.26, 0],
        noShadow: true
      })
    );

    // 6. Authentic 3-bar titanium face grille curving cleanly from ear-flap to ear-flap + 2 flush vertical support wires
    [
      { y: 0.044, r: 0.133 },
      { y: 0.014, r: 0.130 },
      { y: -0.016, r: 0.124 }
    ].forEach(({ y, r }) => {
      const bar = add(
        headG,
        new THREE.TorusGeometry(r, 0.0042, 6, 16, Math.PI * 0.88),
        steelMat,
        0,
        y,
        0.016,
        { noShadow: true }
      );
      bar.rotation.set(Math.PI * 0.5, 0, Math.PI * 0.06);
    });
    [-0.056, 0.056].forEach((vx) => {
      add(headG, new THREE.CylinderGeometry(0.0036, 0.0036, 0.064, 6), steelMat, vx, 0.014, 0.131, {
        rot: [0.11, 0, 0],
        noShadow: true
      });
    });

    // 7. Under-chin safety strap & padded chin cup (properly angled DOWN under the jaw, never over the nose!)
    add(headG, new THREE.TorusGeometry(0.106, 0.0058, 6, 14, Math.PI), darkStrapMat, 0, 0.006, -0.008, {
      rot: [Math.PI * 0.72, 0, 0],
      noShadow: true
    });
    add(headG, new THREE.SphereGeometry(0.022, 8, 6), darkStrapMat, 0, -0.062, 0.072, {
      scale: [1.15, 0.55, 0.78],
      noShadow: true
    });
  } else {
    // Athletic Pro Cricket Cap
    if (jerseyNumber % 4 !== 0) {
      add(headG, new THREE.SphereGeometry(0.136, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), sleeveMat, 0, 0.088, -0.008, {
        scale: [0.97, 1.04, 1.05],
        noShadow: true
      });
      add(headG, new THREE.CylinderGeometry(0.126, 0.138, 0.014, 14, 1, false, -Math.PI * 0.36, Math.PI * 0.72), stripeMat, 0, 0.11, 0.042, {
        rot: [0.12, 0, 0],
        noShadow: true
      });
      add(headG, new THREE.SphereGeometry(0.018, 8, 6), stripeMat, 0, 0.156, 0.114, { scale: [1, 1, 0.35], rot: [-0.55, 0, 0], noShadow: true });
    }
  }

  // Apply per-player athletic physique scale AFTER skeleton.bind() so boneInverses stay clean!
  root.scale.set(buildX, heightY, buildX);
  return root;
}

/**
 * Builds the Cricket Character:
 * - When WAVEDASH_GRAPHICS_STATE.enabled === true: Builds Sculpted Smooth Anatomical Pro Cricketer
 *   (like Wavedash "Last Over" — smooth oval head, contoured 3-roll batting pads with straps,
 *   matte-metallic helmet with multi-bar steel grille, rounded deltoid shoulders, smooth capsule limbs,
 *   multi-roll padded batting gloves, and spiked cricket shoes).
 * - When WAVEDASH_GRAPHICS_STATE.enabled === false: Builds the exact original Classic Box Low-Poly Character.
 * - Full 17-bone `mixamorig` joint hierarchy in both modes so all 14 skeletal AnimationClips work identically!
 */
function createLowPolyRiggedCharacter({
  colorHex = 0x0284c7,
  secondaryColorHex = 0xf59e0b,
  jerseyNumber = 18,
  skinHex = 0xd69e72,
  role = 'fielder',
  flipJerseyText = false
}) {
  const isProHD = WAVEDASH_GRAPHICS_STATE.enabled;
  if (isProHD) {
    // HD mode -> cartoon broadcast cricketer (same skeleton as classic, so every animation still works)
    return createCartoonRiggedCharacter({ colorHex, secondaryColorHex, jerseyNumber, skinHex, role, flipJerseyText });
  }
  const root = new THREE.Group();

  const teamColor = new THREE.Color(colorHex);
  const accentColor = new THREE.Color(secondaryColorHex || 0xf59e0b);
  const darkTeamColor = teamColor.clone().multiplyScalar(0.42);
  const jerseyTex = createJerseyNumberTexture(colorHex, secondaryColorHex, jerseyNumber, flipJerseyText);

  const jerseyMat = new THREE.MeshStandardMaterial({
    map: jerseyTex,
    roughness: isProHD ? 0.44 : 0.52,
    metalness: isProHD ? 0.08 : 0.05
  });
  const sleeveMat = new THREE.MeshStandardMaterial({
    color: teamColor,
    roughness: isProHD ? 0.46 : 0.55,
    metalness: 0.06
  });
  const trouserMat = new THREE.MeshStandardMaterial({
    color: darkTeamColor,
    roughness: isProHD ? 0.54 : 0.65
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: skinHex,
    roughness: isProHD ? 0.42 : 0.48
  });
  const padMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: isProHD ? 0.28 : 0.36,
    metalness: isProHD ? 0.1 : 0.06
  });
  const padAccentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.35,
    metalness: 0.1
  });
  const gloveMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: isProHD ? 0.32 : 0.4,
    metalness: 0.06
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.42
  });

  // 1. HIPS BONE (Root Pelvis at y = 0.92m)
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  hips.position.set(0, 0.92, 0);
  root.add(hips);

  if (!isProHD) {
    // ===================== CLASSIC MODE (Exact Original Low-Poly Box Character) =====================
    const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.21), trouserMat);
    pelvisMesh.castShadow = true;
    pelvisMesh.receiveShadow = true;
    hips.add(pelvisMesh);

    const spine = new THREE.Bone();
    spine.name = 'mixamorigSpine';
    spine.position.set(0, 0.10, 0);
    hips.add(spine);

    const spine1 = new THREE.Bone();
    spine1.name = 'mixamorigSpine1';
    spine1.position.set(0, 0.24, 0);
    spine.add(spine1);

    const torsoGeo = new THREE.CylinderGeometry(0.21, 0.16, 0.48, 8);
    torsoGeo.scale(1.12, 1.0, 0.72);
    const torsoMesh = new THREE.Mesh(torsoGeo, jerseyMat);
    torsoMesh.position.set(0, 0.16, 0);
    torsoMesh.castShadow = true;
    torsoMesh.receiveShadow = true;
    spine.add(torsoMesh);

    const collarMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.022, 6, 12).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: secondaryColorHex || 0xf59e0b, roughness: 0.5 })
    );
    collarMesh.position.set(0, 0.16, 0);
    spine1.add(collarMesh);

    const head = new THREE.Bone();
    head.name = 'mixamorigHead';
    head.position.set(0, 0.28, 0);
    spine1.add(head);

    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.22), skinMat);
    headMesh.position.set(0, 0.04, 0);
    headMesh.castShadow = true;
    head.add(headMesh);

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
        new THREE.SphereGeometry(0.152, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
        helmetMat
      );
      helmetShell.position.set(0, 0.066, -0.006);
      helmetShell.rotation.x = -0.12;
      helmetShell.scale.set(0.98, 1.0, 1.06);
      helmetShell.castShadow = true;
      head.add(helmetShell);

      const visorPeak = new THREE.Mesh(
        new THREE.SphereGeometry(0.138, 12, 6, Math.PI * 0.14, Math.PI * 0.72, Math.PI * 0.34, Math.PI * 0.22),
        helmetMat
      );
      visorPeak.position.set(0, 0.114, 0.030);
      visorPeak.scale.set(0.98, 0.34, 1.30);
      visorPeak.rotation.x = 0.16;
      head.add(visorPeak);

      [0.034, -0.004].forEach((gy, idx) => {
        const grille = new THREE.Mesh(
          new THREE.TorusGeometry(0.132 - idx * 0.006, 0.007, 6, 14, Math.PI * 0.88),
          grilleMat
        );
        grille.rotation.set(Math.PI * 0.5, 0, Math.PI * 0.06);
        grille.position.set(0, gy, 0.024);
        head.add(grille);
      });
    } else {
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
        const padFront = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.42, 0.075), padMat);
        padFront.position.set(0, -0.17, 0.055);
        padFront.castShadow = true;
        leg.add(padFront);

        const kneeRoll = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.065, 0.085), padMat);
        kneeRoll.position.set(0, 0.01, 0.062);
        leg.add(kneeRoll);
      }

      const footNode = new THREE.Group();
      footNode.name = `mixamorig${side}Foot`;
      footNode.position.set(0, -0.41, 0);
      leg.add(footNode);
      const shoeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.08, 0.22), shoeMat);
      shoeMesh.position.set(0, 0, 0.035);
      shoeMesh.castShadow = true;
      footNode.add(shoeMesh);
    };
    makeLeg('Right', -1);
    makeLeg('Left', 1);

    return root;
  }

  return root;
}

/**
 * Attaches cricket gear if CHARACTER_STYLE === 'soldier'
 */
function attachEquipmentToRig(root, { role, colorHex }) {
  const hipsBone = root.getObjectByName('mixamorigHips') || root.getObjectByName('Hips');
  const headBone = root.getObjectByName('mixamorigHead') || root.getObjectByName('Head');
  const rightHandBone = root.getObjectByName('mixamorigRightHand') || root.getObjectByName('RightHand');
  const leftHandBone = root.getObjectByName('mixamorigLeftHand') || root.getObjectByName('LeftHand');
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
    hipsBone,
    headBone,
    rightHandBone,
    leftHandBone,
    spineBone: root.getObjectByName('mixamorigSpine1') || root.getObjectByName('mixamorigSpine'),
    rightArmBone: root.getObjectByName('mixamorigRightArm'),
    leftArmBone: root.getObjectByName('mixamorigLeftArm'),
    rightForeArmBone: root.getObjectByName('mixamorigRightForeArm'),
    leftForeArmBone: root.getObjectByName('mixamorigLeftForeArm'),
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
    useLOD = false,
    flipJerseyText = false
  }) {
    this.role = role;
    this.lod = Boolean(useLOD);
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
        role,
        flipJerseyText
      });
    }

    this.bones = attachEquipmentToRig(this.modelRoot, { role, colorHex, skinHex });
    this.group.add(this.modelRoot);

    // Setup AnimationMixer & register all 10+ cricket clips
    this.mixer = new THREE.AnimationMixer(this.modelRoot);
    Object.keys(mocapClips).forEach((name) => {
      const clip = mocapClips[name];
      if (!clip) return;
      const action = this.mixer.clipAction(clip);
      if (
        name === 'drive' ||
        name === 'drive_cover' ||
        name === 'drive_cover_loft' ||
        name === 'drive_on' ||
        name === 'drive_on_whip' ||
        name === 'cut' ||
        name === 'cut_late' ||
        name === 'cut_loft' ||
        name === 'upper_cut' ||
        name === 'pull' ||
        name === 'hook_loft' ||
        name === 'sweep' ||
        name === 'slog_sweep' ||
        name === 'scoop' ||
        name === 'ramp' ||
        name === 'loft' ||
        name === 'helicopter' ||
        name === 'defence' ||
        name === 'bowling_release' ||
        name === 'release' ||
        name === 'catch' ||
        name === 'collect' ||
        name === 'throw' ||
        name === 'dive' ||
        name === 'celebration' ||
        name === 'celebrate' ||
        name === 'bowl_pace' ||
        name === 'bowl_spin' ||
        name === 'appeal' ||
        name === 'react_miss' ||
        name === 'react_out' ||
        name === 'celebrate_bat' ||
        name === 'punch' ||
        name === 'dig' ||
        name === 'glance' ||
        name === 'flick' ||
        name === 'paddle_flick' ||
        name === 'reverse_sweep'
      ) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    });

    this.mixer.addEventListener('finished', (e) => {
      // Ignore actions that were already replaced (they may still be fading out)
      if (e.action !== this.actions[this.currentClipName]) return;
      const finishedName = e.action.getClip().name;
      if (finishedName !== 'stance' && finishedName !== 'idle' && finishedName !== 'field_ready' && finishedName !== 'keep_ready') {
        this.playClip(this.role === 'batsman' ? 'stance' : 'idle', 0.2);
      }
    });

    const initialClip = role === 'batsman' ? 'stance' : role === 'keeper' ? 'keep_ready' : role === 'fielder' ? 'field_ready' : 'idle';
    this.playClip(initialClip, 0.01);
    // Evaluate mixer immediately at t=0 so the character starts in its exact cricket pose (never T-pose)
    this.mixer.update(0.016);
  }

  /**
   * Cleanly switches to the target animation clip without leaving paused LoopOnce actions stuck blending
   */
  /**
   * Plays a clip after `delaySec` (e.g. wait for the ball), optionally starting `startTime` seconds into the clip.
   * Any ordinary playClip() call cancels a pending delayed clip.
   */
  playClipTimed(name, fadeDuration, timeScale, delaySec = 0, startTime = 0) {
    this._pendingClip = null;
    if (delaySec <= 0.001) {
      this.playClip(name, fadeDuration, timeScale, startTime);
      return;
    }
    this._pendingClip = { name, fadeDuration, timeScale, startTime, wait: delaySec };
  }

  playClip(name, fadeDuration = 0.16, timeScale = 1.0, startTime = 0) {
    // Fielders / keeper use their athletic ready-stance as the "idle" pose
    if (name === 'idle') {
      if (this.role === 'keeper' && this.actions.keep_ready) name = 'keep_ready';
      else if (this.role === 'fielder' && this.actions.field_ready) name = 'field_ready';
    }
    if (this._pendingClip && !this._startingPending) this._pendingClip = null;
    const nextAction = this.actions[name] || this.actions.idle || this.actions.stance;
    if (!nextAction) return;

    if (this.currentClipName === name && nextAction.isRunning() && !nextAction.paused) {
      nextAction.timeScale = timeScale;
      nextAction.setEffectiveTimeScale(timeScale);
      return;
    }

    const prevAction = this.currentClipName ? this.actions[this.currentClipName] : null;

    // Stop everything except the clip we are blending away from (it fades out smoothly instead of popping)
    Object.values(this.actions).forEach((act) => {
      if (act && act !== nextAction && act !== prevAction) {
        act.stop();
      }
    });
    if (this._fadeOutAction && this._fadeOutAction !== prevAction && this._fadeOutAction !== nextAction) {
      this._fadeOutAction.stop();
    }
    this._fadeOutAction = null;

    this.currentClipName = name;
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.paused = false;
    nextAction.timeScale = timeScale;
    nextAction.setEffectiveTimeScale(timeScale);
    nextAction.setEffectiveWeight(1);
    if (startTime > 0) nextAction.time = Math.min(startTime, nextAction.getClip().duration * 0.98);
    nextAction.play();

    const fade = Math.min(0.3, Math.max(0, Number(fadeDuration) || 0));
    if (prevAction && prevAction !== nextAction) {
      if (fade > 0.02 && prevAction.enabled) {
        // Real cross-fade: the new pose grows in while the old pose (even a clamped end-of-shot pose) fades away
        nextAction.crossFadeFrom(prevAction, fade, false);
        this._fadeOutAction = prevAction;
        this._fadeOutLeft = fade + 0.02;
      } else {
        prevAction.stop();
      }
    }
  }

  update(dt, cameraPos = null) {
    if (this._pendingClip) {
      this._pendingClip.wait -= dt;
      if (this._pendingClip.wait <= 0) {
        const c = this._pendingClip;
        this._pendingClip = null;
        this._startingPending = true;
        this.playClip(c.name, c.fadeDuration, c.timeScale, c.startTime);
        this._startingPending = false;
      }
    }
    if (this._fadeOutAction) {
      this._fadeOutLeft -= dt;
      if (this._fadeOutLeft <= 0) {
        this._fadeOutAction.stop();
        this._fadeOutAction = null;
      }
    }
    this.frameCounter++;
    const isOneShot =
      this.currentClipName === 'throw' ||
      this.currentClipName === 'dive' ||
      this.currentClipName === 'catch' ||
      this.currentClipName === 'bowl_pace' ||
      this.currentClipName === 'bowl_spin' ||
      this.currentClipName === 'appeal' ||
      this.currentClipName === 'celebration';
    if (this.lod && cameraPos && !isOneShot) {
      const distSq = this.group.position.distanceToSquared(cameraPos);
      if (distSq > 784) {
        if (this.frameCounter % 2 !== 0) {
          return;
        }
        this.mixer.update(dt * 2);
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
  if (CHARACTER_STYLE !== 'soldier') {
    if (onProgress) onProgress(100);
    if (onComplete) {
      onComplete({
        baseGltf: null,
        hdriTexture: createProceduralStadiumHDRI(),
        mocapClips: null
      });
    }
    return;
  }

  THREE.Cache.enabled = true;
  const manager = new THREE.LoadingManager();

  const dracoLoader = new DRACOLoader(manager);
  dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');

  const ktx2Loader = new KTX2Loader(manager);
  ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/');
  try {
    ktx2Loader.detectSupport(renderer);
  } catch {}

  let loadedGltf = null;
  let completed = false;

  const finalize = () => {
    if (completed) return;
    completed = true;
    const mocapClips = buildCricketMocapClips(loadedGltf ? loadedGltf.animations : []);
    if (onProgress) onProgress(100);
    if (onComplete) {
      onComplete({
        baseGltf: loadedGltf,
        hdriTexture: null,
        mocapClips
      });
    }
  };

  if (onProgress) onProgress(65);
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
}
