import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BroadcastDOFShader = {
  name: 'BroadcastDOFShader',
  uniforms: {
    tDiffuse: { value: null },
    focus: { value: 24.0 },
    aperture: { value: 0.0012 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float focus;
    uniform float aperture;
    varying vec2 vUv;
    void main() {
      vec2 distFromCenter = vUv - vec2(0.5, 0.48);
      float lensRadius = smoothstep(0.28, 0.72, length(distFromCenter));
      float r = clamp(lensRadius * aperture * 6.0, 0.0, 0.0045);
      vec4 c = texture2D(tDiffuse, vUv) * 0.44;
      c += texture2D(tDiffuse, vUv + vec2(r, 0.0)) * 0.14;
      c += texture2D(tDiffuse, vUv - vec2(r, 0.0)) * 0.14;
      c += texture2D(tDiffuse, vUv + vec2(0.0, r)) * 0.14;
      c += texture2D(tDiffuse, vUv - vec2(0.0, r)) * 0.14;
      gl_FragColor = c;
    }
  `
};

import {
  BallPhysics,
  PITCH_HALF_LENGTH,
  BOWLING_CREASE_Z,
  CREASE_Z,
  RETURN_CREASE_X,
  WIDE_GUIDELINE_X,
  PROTECTED_AREA_Z,
  STUMP_HEIGHT,
  STUMP_WIDTH,
  BOUNDARY_RADIUS
} from '../physics.js';
import { BattingSystem } from '../batting.js';
import { BowlingSystem } from '../bowling.js';
import { applyMiddledLook } from './middled_look.js';
import { initMiddledMenu } from './middled_menu.js';
import { FieldingSystem } from '../fielding.js';
import { MatchEngine, FICTIONAL_TEAMS, INDIAN_STADIUMS } from '../modes.js';
import { NetworkManager } from '../net.js';
import { UIManager } from '../ui.js';
import { sound } from '../assets/audio.js';
import { commentary } from '../commentary.js';
import {
  gameConfig,
  getDifficultyProfile,
  rollRunChaseTarget
} from '../config.js';
import {
  CHARACTER_STYLE,
  detectHardwareQualityPreset,
  loadRealisticAssets,
  buildCricketMocapClips,
  RiggedCricketPlayer,
  createDetailedCricketBatMesh,
  createDetailedCricketBallMesh,
  createOutfieldGrassTextures,
  ProgressivePitchSurface,
  WAVEDASH_GRAPHICS_STATE,
  createProFaceTexture,
  getClothNormalMap
} from '../assets/models_and_anims.js';
import { BATTING_SHOT_CLIPS } from '../assets/shot_animations.js';
import {
  CRICKET_FEEL_FLAGS,
  CricketBatRibbonTrail,
  CricketBallRibbonTrail,
  upgradeCricketerMaterials,
  PlayerContactShadowManager,
  AliveBatsmanEnhancer,
  CricketImpactVFXManager,
  FloatingShotTelemetryHUD,
  StadiumCrowdAnimator
} from './cricket_feel_vfx.js';

/**
 * Box Cricket 3D - Expressive Low-Poly Rigged Characters (CHARACTER_STYLE = 'lowpoly'),
 * HDRI + PBR + Bloom + Bokeh DOF, Progressive Pitch Wear, Visible Seam Spin,
 * and Smart Highlight-Only Slow-Motion Replay System (/src/main.js)
 */

// Pre-allocated math helpers for zero-GC render loop
const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3(0, 1.0, 4.0);
const _dummyObj = new THREE.Object3D();
const _tmpColor = new THREE.Color();

const STUMP_GLOW = 0xd97706;
const STUMP_ZING_FLASH = 0xff1e42;

export class BoxCricketApp {
  constructor() {
    this.canvasContainer = document.getElementById('canvas-mount');
    this.physics = new BallPhysics();
    this.batting = new BattingSystem();
    this.bowling = new BowlingSystem();
    this.fielding = new FieldingSystem();
    this.match = new MatchEngine();
    this.net = new NetworkManager('host');
    this.ui = new UIManager(this);

    this.characterStyle = CHARACTER_STYLE; // 'lowpoly' (default) | 'soldier'
    this.cameraMode = 'pro'; // Default: Low & Close Broadcast Batting Camera behind batsman ('pro' | 'broadcast' | 'follow' | 'overhead' | 'replay')
    this.savedCameraMode = 'pro';
    this.batting.screenRightSign = 1;
    this.bowling.screenRightSign = 1;
    this.targetFps = 60;
    this.lastFrameTime = 0;
    this.graphicsQuality = 'high'; // 'low' | 'medium' | 'high'
    this.qualityPreset = 'high';
    this.dofEnabled = true;
    this.handedness = 'right'; // 'right' (default) | 'left'
    this.wavedashGraphicsMode = WAVEDASH_GRAPHICS_STATE.enabled;
    this.ledRibbonMats = [];

    // HDRI & Animation state
    this.baseGltf = null;
    this.hdriEnvMap = null;
    this.studioEnvMap = null;
    this.mocapClips = buildCricketMocapClips([]);

    // Rigged character controllers
    this.strikerPlayer = null;
    this.nonStrikerPlayer = null;
    this.bowlerPlayer = null;
    this.keeperPlayer = null;
    this.fielderPlayers = [];

    // Real Step-Driven Running between wickets state
    this.runnersInMotion = false;
    this.runnerReturning = false;
    this.runnerStoppedMidPitch = false;
    this.runButtonHeld = false;
    this.ballHeldAtStumps = false;
    this.ballHeldTimer = 0;
    this.runsCompletedThisBall = 0;
    this.pendingExtraRun = false;
    this.runnerProgress = 0;
    this.strikerMeshZ = CREASE_Z;
    this.nonStrikerMeshZ = -CREASE_Z;

    // Smart Highlight-Only Slow-Motion Action Replay System (0.28x)
    // Replays setting: 'off' | 'wickets' | 'default' (Wickets + boundaries + drops) | 'all' (All highlights)
    this.replaySetting = 'default';
    this.isReplaying = false;
    this.replayFrames = [];
    this.replayIndex = 0;
    this.replaySpeed = 0.44; // Dynamic 0.44x Action Replay
    this.currentBallHighlight = null; // Highest-priority highlight on the current ball
    this.activeReplayHighlight = null;
    this.pendingReplayStartTimer = null;
    this.pendingReplayEndTimer = null;
    this.postDeliveryResetTimer = null;

    // Stump bail explosion animation
    this.bailsDislodged = false;
    this.dislodgedEnd = 'striker';
    this.bailTimer = 0;

    // 3D Dust & Chalk Particle Pool for pitch bounce & dives
    this.dustPuffs = [];

    // Balanced Automatic Bowler Run-Up & Pre-Delivery Countdown
    this.autoBowlCountdown = 1.8;
    this.autoBowlScheduled = true;
    this.lastCountdownWholeSec = -1;
    // One-time Play Gate so the bowler waits until the player connects their phone controller or clicks PLAY
    this.matchPlayConfirmed = false;
    this.runRiskLevel = 'safe';
    this.lastMatchRpGain = 0;
    this.lastLiveSixMeterShown = 0;

    // 3D Umpire signal animation state ('idle' | 'four' | 'six' | 'out' | 'wide' | 'noball')
    this.umpireSignal = 'idle';
    this.umpireSignalTimer = 0;

    // Real Batting Impact Feel: Hit-Stop Freeze (56ms), Camera Follow-Through Linger & Directional Punch
    this.hitStopTimer = 0;
    this.cameraShakeIntensity = 0;
    this.impactFollowThroughUntil = 0;
    this.impactPunchFov = 0;
    this.impactKickVec = new THREE.Vector3();
    this._pendingFollowCam = false;
    this._zonePulseSentThisBall = false;
    this.boundaryCelebrationUntil = 0;
    this.boundaryCameraHoldUntil = 0;
    this.wasTrackingOutfieldBall = false;
    this.lastDRSCandidate = null;
    this.drsActive = false;

    // Interactive Catch / Direct-Hit Reflex QTE state
    this.qteActive = false;
    this.qteProgress = 0.1;
    this.qteDir = 1;
    this.qteResolved = false;

    // Touch swipe tracking on main canvas
    this.pointerDownPos = null;
    this.pointerDownTime = 0;
    this.creaseDragPointerId = null;
    this.creaseDragStartX = 0;
    this.creaseDragStartY = 0;
    this.creaseDragInitialX = 0;

    // Modular Cricket Visual & Feel Enhancers (All 7 Upgrades)
    this.feelFlags = CRICKET_FEEL_FLAGS;
    this.crowdAnimator = new StadiumCrowdAnimator();
    this.aliveBatsman = new AliveBatsmanEnhancer();
    this.floatingTelemetry = new FloatingShotTelemetryHUD();

    this.initThree();
    this.buildSceneContents();
    this.setupNetworkCallbacks();
    this.setupInputListeners();

    // Sync initial state from persisted localStorage gameConfig
    this.match.difficulty = gameConfig.difficulty || 'medium';
    this.bowling.assistMode = gameConfig.bowlingAssist || 'off';
    this.batting.sensitivity = gameConfig.sensitivity || 1.0;
    this.replaySetting = gameConfig.replays || 'default';
    this.dofEnabled = gameConfig.dofEnabled !== false;
    this.setHandedness(gameConfig.handedness || 'right');

    this.ui.init();
    this.ui.updateBowlerSideButton();
    this.ui.syncStadiumAndDayNightUI(this.match.stadium, this.match.timeOfDay);

    // Check if opened via an Online 1v1 Room Invite Link (?room=XXXX&online=1)
    const urlParams = new URLSearchParams(window.location.search);
    const inviteRoom = urlParams.get('room');
    const isOnlineInvite = urlParams.get('online') === '1';

    if (inviteRoom && isOnlineInvite) {
      this.startOnline1v1Match(inviteRoom.toUpperCase().slice(0, 4), false);
    } else {
      // Open Pre-Match Setup modal before the game starts so user selects Mode, Difficulty, Teams, Stadium & Day/Night
      initMiddledMenu(this);
      // Schedule opening delivery automatically (waits while Pre-Match Setup modal is open)
      this.scheduleAutoBowl(0.9);
      this.net.connect();
    }

    // Auto-detect device hardware & apply Low/Medium/High graphics preset
    const detectedPreset = detectHardwareQualityPreset(this.renderer);
    this.applyGraphicsQualityPreset(detectedPreset);
    const qualSelect = document.getElementById('setting-quality');
    if (qualSelect) qualSelect.value = detectedPreset;

    // Lazy-load Draco/KTX2/HDRI sky with loading bar
    this.startAssetLoadingPipeline();

    // Fetch LAN IP for QR code & Online Invite URL
    this.net.fetchServerInfo().then(() => {
      this.ui.renderQRModalContent();
      if (typeof this.ui.syncOnline1v1ModalUI === 'function') {
        this.ui.syncOnline1v1ModalUI();
      }
    });

    this.clock = new THREE.Clock();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initThree() {
    const isHeadless = navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent);
    this.isHeadless = isHeadless;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090f1d);
    this.scene.fog = new THREE.FogExp2(0x090f1d, 0.0045);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      420
    );
    this.camera.position.set(0, 4.2, -18.5);
    this.camera.lookAt(0, 1.0, 5.0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isHeadless,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setPixelRatio(isHeadless ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;

    this.canvasContainer.appendChild(this.renderer.domElement);

    // WebGL context loss safety
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());

    // Balanced 3-Point Stadium & Sun Lighting Rig
    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x14532d, 0.78);
    this.hemiLight.position.set(0, 60, 0);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfffbeb, 2.1);
    this.keyLight.position.set(24, 46, -20);
    this.keyLight.castShadow = false;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
    this.rimLight.position.set(-30, 32, 35);
    this.scene.add(this.rimLight);

    this.composer = null;

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.updateRendererResolution();
    });
  }

  updateRendererResolution() {
    if (!this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const preset = this.graphicsQuality || 'high';
    const dpr = window.devicePixelRatio || 1;
    // Cap maximum internal framebuffer pixels so 1080p/4K Smart TVs never choke on 4K fill-rate
    const maxLongEdge = preset === 'low' ? 1366 : preset === 'medium' ? 1600 : 1920;
    const scaleCap = Math.min(1.0, maxLongEdge / Math.max(w, h, 1));
    const targetRatio =
      this.isHeadless || preset === 'low'
        ? Math.min(1.0, scaleCap)
        : preset === 'medium'
          ? Math.min(dpr, 1.25) * scaleCap
          : Math.min(dpr, 1.65) * scaleCap;
    this.renderer.setPixelRatio(Math.max(0.65, targetRatio));
    this.renderer.setSize(w, h);
    if (this.composer && preset !== 'low') {
      this.composer.setPixelRatio(Math.max(0.65, targetRatio));
      this.composer.setSize(w, h);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(Math.floor(w * 0.4), Math.floor(h * 0.4));
    }
  }

  initPostProcessing() {
    if (this.isHeadless) return;
    try {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.composer = new EffectComposer(this.renderer);

      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);

      this.bokehPass = new ShaderPass(BroadcastDOFShader);
      this.composer.addPass(this.bokehPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(Math.floor(w * 0.5), Math.floor(h * 0.5)),
        0.38,
        0.45,
        0.82
      );
      this.composer.addPass(this.bloomPass);

      this.outputPass = new OutputPass();
      this.composer.addPass(this.outputPass);
    } catch {
      this.composer = null;
    }
  }

  startAssetLoadingPipeline() {
    const overlay = document.getElementById('asset-loading-overlay');
    const bar = document.getElementById('asset-loading-bar');
    const pctEl = document.getElementById('asset-loading-pct');

    loadRealisticAssets(
      this.renderer,
      (pct) => {
        if (bar) bar.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
      },
      ({ baseGltf, hdriTexture, mocapClips }) => {
        if (baseGltf) this.baseGltf = baseGltf;
        if (mocapClips) this.mocapClips = mocapClips;

        if (hdriTexture) {
          const pmrem = new THREE.PMREMGenerator(this.renderer);
          pmrem.compileEquirectangularShader();
          this.hdriEnvMap = pmrem.fromEquirectangular(hdriTexture).texture;
          this.scene.environment = this.hdriEnvMap;
          this.scene.environmentIntensity = this.match.timeOfDay === 'day' ? 0.55 : 0.36;
          hdriTexture.dispose();
          pmrem.dispose();
          this.setStadium(this.match.stadium || 'eden_gardens', this.match.timeOfDay || 'night');
        }

        if (baseGltf || mocapClips) {
          this.rebuildTeamCharacters();
        }

        if (overlay) {
          overlay.classList.add('opacity-0', 'pointer-events-none');
          setTimeout(() => overlay.classList.add('hidden'), 450);
        }
      }
    );
  }

  createFloodlightGlareTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 124);
    g.addColorStop(0, 'rgba(255, 253, 240, 1.0)');
    g.addColorStop(0.22, 'rgba(254, 243, 199, 0.65)');
    g.addColorStop(0.55, 'rgba(56, 189, 248, 0.18)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);

    const hGrad = ctx.createLinearGradient(0, 128, 256, 128);
    hGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    hGrad.addColorStop(0.5, 'rgba(254, 240, 138, 0.65)');
    hGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = hGrad;
    ctx.fillRect(8, 122, 240, 12);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  createLedSponsorRibbonTexture(accentHex = 0x10b981) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const baseCol = new THREE.Color(accentHex);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, 1024, 128);

    // Top & bottom glowing LED trim bars
    ctx.fillStyle = `#${baseCol.getHexString()}`;
    ctx.fillRect(0, 0, 1024, 14);
    ctx.fillRect(0, 114, 1024, 14);

    const sponsors = ['LAST OVER HD', 'BOX CRICKET 3D', 'SUPER SIXES', 'POWERPLAY T20'];
    const segW = 1024 / sponsors.length;
    sponsors.forEach((label, idx) => {
      const x0 = idx * segW;
      ctx.fillStyle = idx % 2 === 0 ? `#${baseCol.getHexString()}` : '#f59e0b';
      ctx.fillRect(x0 + 8, 22, 10, 84);

      ctx.font = '900 34px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x0 + segW * 0.52, 66);
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(12, 1);
    return tex;
  }

  setWavedashGraphicsMode(enabled = true) {
    this.wavedashGraphicsMode = Boolean(enabled);
    WAVEDASH_GRAPHICS_STATE.enabled = this.wavedashGraphicsMode;

    // 1. Update Outfield Grass Texture
    if (this.outfieldMat) {
      const grassMaps = createOutfieldGrassTextures(this.renderer);
      this.outfieldMat.map = grassMaps.albedoMap;
      this.outfieldMat.normalMap = grassMaps.normalMap;
      this.outfieldMat.roughness = this.wavedashGraphicsMode ? 0.76 : 0.82;
      this.outfieldMat.needsUpdate = true;
    }

    // 2. Update Perimeter LED Sponsor Ribbons
    if (this.ledRibbonMats && this.ledRibbonMats.length > 0) {
      this.ledRibbonMats.forEach(({ mat, baseHex, emissiveHex, sponsorTex }) => {
        if (this.wavedashGraphicsMode) {
          mat.map = sponsorTex;
          mat.emissiveMap = sponsorTex;
          mat.color.setHex(0xffffff);
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = 0.95;
        } else {
          mat.map = null;
          mat.emissiveMap = null;
          mat.color.setHex(baseHex);
          mat.emissive.setHex(emissiveHex);
          mat.emissiveIntensity = 0.72;
        }
        mat.needsUpdate = true;
      });
    }

    // 3. Update Exposure (FOV is managed dynamically per camera mode in updateCameras)
    if (this.camera) {
      this.camera.updateProjectionMatrix();
    }
    if (this.renderer) {
      this.renderer.toneMappingExposure = this.wavedashGraphicsMode ? 1.22 : 1.15;
    }

    // 4. Rebuild all 3D players (Sculpted Smooth Pro HD vs Classic Low-Poly)
    this.rebuildTeamCharacters();

    // 5. Update UI Toggle Button Label
    const btn = document.getElementById('btn-toggle-hd-graphics');
    if (btn) {
      btn.innerHTML = this.wavedashGraphicsMode
        ? '<span>✨ HD: LAST OVER</span>'
        : '<span>🎮 GFX: CLASSIC</span>';
      btn.classList.toggle('border-amber-400', this.wavedashGraphicsMode);
      btn.classList.toggle('text-amber-300', this.wavedashGraphicsMode);
    }

    if (this.ui && typeof this.ui.showStatusToast === 'function') {
      this.ui.showStatusToast(
        this.wavedashGraphicsMode
          ? '✨ Wavedash "Last Over" Pro HD Graphics Applied!'
          : '🎮 Reverted to Classic Graphics!',
        true
      );
    }
  }

  /**
   * Generates MCC Law 7 Standard Cricket Crease Markings at exact 3D world coordinates on the 3.2m × 23.2m pitch plane:
   * - Bowling Creases: z = ±10.06m (PITCH_HALF_LENGTH), width = 2.64m (x ∈ [-1.32m, +1.32m]) right through the 3 stumps
   * - Popping Creases (Batting/Front-Foot Crease): z = ±8.84m (CREASE_Z, 1.22m / 4ft in front of stumps), width = 3.05m
   * - Return Creases: x = ±1.32m (RETURN_CREASE_X), perpendicular from Popping Crease (z = ±8.84m) through Bowling Crease to z = ±11.28m
   * - Limited-Overs Wide Guidelines: x = ±0.89m (WIDE_GUIDELINE_X, 17 in inside return creases), between Popping & Bowling Creases
   * - Bowler Protected Area Markers: z = ±7.32m (PROTECTED_AREA_Z, 1.52m / 5ft in front of each Popping Crease)
   */
  createCreaseOverlayTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Exact world-to-canvas coordinate mappers for PlaneGeometry(3.2, 23.2) rotated -90° around X
    const wx = (worldX) => ((worldX + 1.6) / 3.2) * canvas.width;
    const wz = (worldZ) => ((worldZ + 11.6) / 23.2) * canvas.height;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.lineCap = 'square';

    // Draw both ends of the 22-yard pitch: dir = -1 (Bowler's End), dir = +1 (Striker's End)
    [-1, 1].forEach((dir) => {
      const zPopping = dir * CREASE_Z;           // ±8.84m (Popping Crease)
      const zBowling = dir * BOWLING_CREASE_Z;   // ±10.06m (Bowling Crease / Stump Line)
      const zBack = dir * (BOWLING_CREASE_Z + 1.22); // ±11.28m (Back of Return Crease, 4ft behind stumps)
      const zProtected = dir * PROTECTED_AREA_Z; // ±7.32m (5ft Protected Area marker)

      // 1. Popping Crease (1.22m / 4ft in front of stumps, spanning across the 3.05m pitch width)
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(wx(-1.525), wz(zPopping));
      ctx.lineTo(wx(1.525), wz(zPopping));
      ctx.stroke();

      // 2. Bowling Crease (Directly through the 3 stumps at ±10.06m, 2.64m / 8ft 8in wide between Return Creases)
      ctx.lineWidth = 7.0;
      ctx.beginPath();
      ctx.moveTo(wx(-RETURN_CREASE_X), wz(zBowling));
      ctx.lineTo(wx(RETURN_CREASE_X), wz(zBowling));
      ctx.stroke();

      // 3. Return Creases (At x = ±1.32m, perpendicular from Popping Crease ±8.84m through Bowling Crease to ±11.28m)
      ctx.lineWidth = 7.0;
      [-RETURN_CREASE_X, RETURN_CREASE_X].forEach((rx) => {
        ctx.beginPath();
        ctx.moveTo(wx(rx), wz(zPopping));
        ctx.lineTo(wx(rx), wz(zBack));
        ctx.stroke();
      });

      // 4. Limited-Overs / T20 Wide Guidelines (At x = ±0.89m, perpendicular between Popping Crease & Bowling Crease)
      ctx.lineWidth = 5.5;
      [-WIDE_GUIDELINE_X, WIDE_GUIDELINE_X].forEach((wgx) => {
        ctx.beginPath();
        ctx.moveTo(wx(wgx), wz(zPopping));
        ctx.lineTo(wx(wgx), wz(zBowling));
        ctx.stroke();
      });

      // 5. MCC Law 41.13 Protected Area Markers (1.52m / 5ft in front of Popping Crease on pitch edges & danger-area corners)
      ctx.lineWidth = 5.0;
      [-1.525, 1.525].forEach((edgeX) => {
        const inward = edgeX < 0 ? 0.16 : -0.16;
        ctx.beginPath();
        ctx.moveTo(wx(edgeX), wz(zProtected));
        ctx.lineTo(wx(edgeX + inward), wz(zProtected));
        ctx.stroke();
      });
      // Danger area 1ft (0.305m) lateral ticks on the Popping Crease
      [-0.305, 0.305].forEach((dangerX) => {
        ctx.beginPath();
        ctx.moveTo(wx(dangerX), wz(zPopping));
        ctx.lineTo(wx(dangerX), wz(zPopping - dir * 0.14));
        ctx.stroke();
      });

      // 6. Subtle Leg / Middle / Off Stump Batting Guard Chalk Ticks just inside the Popping Crease
      ctx.lineWidth = 3.5;
      [-0.114, 0, 0.114].forEach((guardX) => {
        ctx.beginPath();
        ctx.moveTo(wx(guardX), wz(zPopping + dir * 0.08));
        ctx.lineTo(wx(guardX), wz(zPopping + dir * 0.24));
        ctx.stroke();
      });
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this.renderer) {
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    }
    return tex;
  }

  /**
   * Builds crisp 3D Chalk Strip Meshes on the pitch surface (y = 0.027, renderOrder = 2, polygonOffset = -4)
   * so all MCC Law 7 creases (Popping Crease, Bowling Crease, Return Creases, Wide Guidelines & Guard Marks)
   * remain 100% sharp and unclipped from every camera angle!
   */
  build3DPitchCreaseMeshes() {
    if (this.pitchCrease3DGroup) {
      this.scene.remove(this.pitchCrease3DGroup);
    }
    const group = new THREE.Group();
    const chalkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
    const wideGuideMat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });

    const addStrip = (centerX, centerZ, widthX, lengthZ, mat = chalkMat) => {
      const geo = new THREE.PlaneGeometry(widthX, lengthZ);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(centerX, 0.027, centerZ);
      m.renderOrder = 2;
      group.add(m);
    };

    [-1, 1].forEach((dir) => {
      const zPopping = dir * CREASE_Z;           // ±8.84m (Popping Crease)
      const zBowling = dir * BOWLING_CREASE_Z;   // ±10.06m (Bowling Crease through stumps)
      const zBack = dir * (BOWLING_CREASE_Z + 1.14); // ±11.20m (Back of Return Crease)
      const zProtected = dir * PROTECTED_AREA_Z; // ±7.32m (Protected Area marker)

      // 1. Popping Crease (Batting / Front-Foot Crease at z = ±8.84m, full 3.05m pitch width)
      addStrip(0, zPopping, 3.05, 0.058, chalkMat);

      // 2. Bowling Crease (Stump Line at z = ±10.06m, between Return Creases ±1.22m => 2.44m width)
      addStrip(0, zBowling, RETURN_CREASE_X * 2 + 0.055, 0.055, chalkMat);

      // 3. Return Creases (Perpendicular lines at x = ±1.22m from Popping Crease ±8.84m to ±11.20m)
      const returnLen = Math.abs(zBack - zPopping);
      const returnMidZ = (zPopping + zBack) * 0.5;
      [-RETURN_CREASE_X, RETURN_CREASE_X].forEach((rx) => {
        addStrip(rx, returnMidZ, 0.055, returnLen, chalkMat);
      });

      // 4. Limited-Overs Wide Guidelines (Perpendicular lines at x = ±0.56m between Popping & Bowling Creases)
      const wideLen = Math.abs(zBowling - zPopping);
      const wideMidZ = (zPopping + zBowling) * 0.5;
      [-WIDE_GUIDELINE_X, WIDE_GUIDELINE_X].forEach((wgx) => {
        addStrip(wgx, wideMidZ, 0.048, wideLen, wideGuideMat);
      });

      // 5. Protected Area Ticks (at z = ±7.32m on pitch edges & danger zone ticks on Popping Crease)
      [-1.44, 1.44].forEach((edgeX) => {
        addStrip(edgeX, zProtected, 0.18, 0.045, wideGuideMat);
      });
      [-0.305, 0.305].forEach((dangerX) => {
        addStrip(dangerX, zPopping - dir * 0.08, 0.04, 0.16, wideGuideMat);
      });

      // 6. Middle, Off & Leg Stump Batting Guard Marks inside the Popping Crease
      [-0.114, 0, 0.114].forEach((guardX) => {
        addStrip(guardX, zPopping + dir * 0.15, 0.032, 0.16, wideGuideMat);
      });
    });

    this.pitchCrease3DGroup = group;
    this.scene.add(group);
  }

  buildSceneContents() {
    const horizonGeo = new THREE.CircleGeometry(240, 64);
    horizonGeo.rotateX(-Math.PI / 2);
    this.horizonMat = new THREE.MeshStandardMaterial({
      color: 0x0b2418,
      roughness: 0.95,
      metalness: 0.0
    });
    const horizonMesh = new THREE.Mesh(horizonGeo, this.horizonMat);
    horizonMesh.position.y = -0.04;
    horizonMesh.receiveShadow = false;
    this.scene.add(horizonMesh);

    const grassMaps = createOutfieldGrassTextures(this.renderer);
    const outfieldGeo = new THREE.CircleGeometry(BOUNDARY_RADIUS + 8, 48);
    outfieldGeo.rotateX(-Math.PI / 2);
    this.outfieldMat = new THREE.MeshStandardMaterial({
      map: grassMaps.albedoMap,
      roughness: 0.85,
      metalness: 0.0
    });
    this.outfieldMesh = new THREE.Mesh(outfieldGeo, this.outfieldMat);
    this.outfieldMesh.receiveShadow = false;
    this.scene.add(this.outfieldMesh);

    const ropeGeo = new THREE.TorusGeometry(BOUNDARY_RADIUS, 0.18, 10, 72);
    ropeGeo.rotateX(Math.PI / 2);
    const ropeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.35,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.22
    });
    const ropeMesh = new THREE.Mesh(ropeGeo, ropeMat);
    ropeMesh.position.y = 0.18;
    this.scene.add(ropeMesh);

    // Pro Slatted Sightscreens + Giant Digital Jumbotron Scoreboard (shared once across all stadiums)
    this.buildSightscreensAndJumbotron();

    const innerRingGeo = new THREE.RingGeometry(24.85, 25.05, 64);
    innerRingGeo.rotateX(-Math.PI / 2);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.position.y = 0.02;
    this.scene.add(innerRing);

    this.pitchSurface = new ProgressivePitchSurface(this.renderer);
    const pitchGeo = new THREE.PlaneGeometry(3.2, 23.2);
    pitchGeo.rotateX(-Math.PI / 2);
    this.pitchMat = new THREE.MeshStandardMaterial({
      map: this.pitchSurface.map,
      roughness: 0.88,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    this.pitchMesh = new THREE.Mesh(pitchGeo, this.pitchMat);
    this.pitchMesh.position.y = 0.02;
    this.pitchMesh.receiveShadow = false;
    this.scene.add(this.pitchMesh);

    const creaseMesh = new THREE.Mesh(
      pitchGeo,
      new THREE.MeshBasicMaterial({
        map: this.createCreaseOverlayTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3
      })
    );
    creaseMesh.position.y = 0.025;
    creaseMesh.renderOrder = 2;
    this.scene.add(creaseMesh);

    // Build actual 3D Chalk Line Strip Meshes so Popping Crease, Bowling Crease, Return Creases & Wide Guidelines
    // never blur out from texture mipmapping at shallow camera angles!
    this.build3DPitchCreaseMeshes();

    this.strikerStumps = this.buildWicketSet(PITCH_HALF_LENGTH);
    this.nonStrikerStumps = this.buildWicketSet(-PITCH_HALF_LENGTH);
    this.scene.add(this.strikerStumps.group);
    this.scene.add(this.nonStrikerStumps.group);

    // 3D Color-Coded Pitching Spot Bullseye (Green = Full Slot, Amber = Good Length, Red = Short/Bouncer, Cyan = Yorker)
    this.aimRing = new THREE.Group();
    this.aimOuterMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92
    });
    this.aimInnerMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.38
    });
    const outerRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.42, 32).rotateX(-Math.PI / 2),
      this.aimOuterMat
    );
    const innerDiscMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.18, 24).rotateX(-Math.PI / 2),
      this.aimInnerMat
    );
    this.timingRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.timingOuterRing = new THREE.Mesh(
      new THREE.RingGeometry(0.41, 0.48, 32).rotateX(-Math.PI / 2),
      this.timingRingMat
    );
    this.timingOuterRing.visible = false;
    this.aimRing.add(outerRingMesh, innerDiscMesh, this.timingOuterRing);
    this.aimRing.position.set(0.05, 0.035, 4.6);
    this.scene.add(this.aimRing);

    this.bounceMarker = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    this.bounceMarker.position.set(0, 0.04, 4.6);
    this.bounceMarker.visible = false;
    this.scene.add(this.bounceMarker);

    // 3D Aerial Ball Landing Target Ring (Marks predicted landing spot on outfield for high catches & sixes)
    this.landingRing = new THREE.Group();
    this.landingRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const landOuter = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.88, 32).rotateX(-Math.PI / 2),
      this.landingRingMat
    );
    const landInner = new THREE.Mesh(
      new THREE.CircleGeometry(0.24, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
    );
    this.landingRing.add(landOuter, landInner);
    this.landingRing.position.set(0, 0.04, 0);
    this.landingRing.visible = false;
    this.scene.add(this.landingRing);

    const { ballGroup } = createDetailedCricketBallMesh();
    this.ballGroup = ballGroup;
    this.ballGroup.scale.setScalar(1.35);
    this.scene.add(this.ballGroup);
    // Alias this.ball to this.physics for UI HUD spinRpm & pitchWear queries
    this.ball = this.physics;

    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.48, depthWrite: false })
    );
    this.ballShadow.position.y = 0.03;
    this.scene.add(this.ballShadow);

    const trailPositions = new Float32Array(this.physics.maxTrail * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.85 });
    this.trailLine = new THREE.Line(this.trailGeo, trailMat);
    this.trailLine.frustumCulled = false;
    this.scene.add(this.trailLine);

    // Initialize 3D Bat Swing Arc Ribbon, Volumetric Ball Ribbon, Ground Contact Shadows & Impact VFX
    this.batRibbonTrail = new CricketBatRibbonTrail(this.scene, 36);
    this.ballRibbonTrail = new CricketBallRibbonTrail(this.scene, 44);
    this.contactShadows = new PlayerContactShadowManager(this.scene);
    this.impactVFX = new CricketImpactVFXManager(this.scene);

    this.contactShadows.attachToActor('ball', 0.24, 0.78);
    this.contactShadows.attachToActor('striker', 0.62, 0.78);
    this.contactShadows.attachToActor('nonStriker', 0.58, 0.72);
    this.contactShadows.attachToActor('bowler', 0.60, 0.76);
    this.contactShadows.attachToActor('keeper', 0.58, 0.74);
    this.contactShadows.attachToActor('umpire', 0.56, 0.70);
    for (let i = 0; i < 9; i++) {
      this.contactShadows.attachToActor(`fielder_${i}`, 0.56, 0.70);
    }

    if (!this.crowdAnimator) {
      this.crowdAnimator = new StadiumCrowdAnimator();
    }

    this.stadiumGroups = {
      eden_gardens: this.buildEdenGardensStadium(),
      wankhede: this.buildWankhedeStadium(),
      narendra_modi: this.buildNarendraModiStadium()
    };
    Object.values(this.stadiumGroups).forEach((g) => this.scene.add(g));
    this.setStadium(this.match.stadium || 'eden_gardens', this.match.timeOfDay || 'night');

    this.rebuildTeamCharacters();

    // Lightweight stadium & classic ground pass
    applyMiddledLook(this);
  }

  spawnDustPuff(pos, intensity = 0.5) {
    if (this.graphicsQuality === 'low') return;
    const count = 8;
    const group = new THREE.Group();
    group.position.set(pos.x, 0.06, pos.z);

    const mat = new THREE.MeshBasicMaterial({
      color: this.physics.pitchType === 'green' ? 0xa3b18a : 0xd6b88a,
      transparent: true,
      opacity: Math.min(0.75, 0.35 + intensity * 0.45),
      depthWrite: false
    });

    const particles = [];
    const geo = new THREE.SphereGeometry(0.045, 6, 6);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 0.6 + Math.random() * 1.1;
      particles.push({
        mesh: m,
        vx: Math.cos(ang) * spd,
        vy: 0.7 + Math.random() * 0.9,
        vz: Math.sin(ang) * spd
      });
      group.add(m);
    }

    this.scene.add(group);
    this.dustPuffs.push({ group, mat, particles, age: 0 });
  }

  updateDustPuffs(dt) {
    for (let i = this.dustPuffs.length - 1; i >= 0; i--) {
      const puff = this.dustPuffs[i];
      puff.age += dt;
      if (puff.age > 0.65) {
        this.scene.remove(puff.group);
        puff.mat.dispose();
        this.dustPuffs.splice(i, 1);
        continue;
      }
      puff.mat.opacity = Math.max(0, (1 - puff.age / 0.65) * 0.55);
      puff.particles.forEach((p) => {
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy -= 2.4 * dt;
        p.mesh.scale.setScalar(1 + puff.age * 2.2);
      });
    }
  }

  buildWicketSet(zPos) {
    const group = new THREE.Group();
    group.position.set(0, 0, zPos);

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0xfde68a,
      roughness: 0.32,
      metalness: 0.08,
      emissive: STUMP_GLOW,
      emissiveIntensity: 0.18
    });

    const stumps = [];
    const stumpGeo = new THREE.CylinderGeometry(0.019, 0.019, STUMP_HEIGHT, 12);
    stumpGeo.translate(0, STUMP_HEIGHT / 2, 0);
    const camCapMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.7 });

    [-STUMP_WIDTH / 2, 0, STUMP_WIDTH / 2].forEach((xOffset, idx) => {
      const s = new THREE.Mesh(stumpGeo, woodMat.clone());
      s.position.set(xOffset, 0, 0);
      s.castShadow = true;
      // Middle stump camera lens collar & LED top band
      if (idx === 1) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.036, 10), camCapMat);
        cap.position.y = STUMP_HEIGHT - 0.04;
        s.add(cap);
      }
      group.add(s);
      stumps.push(s);
    });

    const bails = [];
    const bailGeo = new THREE.CylinderGeometry(0.0095, 0.0095, STUMP_WIDTH * 0.48, 8);
    bailGeo.rotateZ(Math.PI / 2);
    const zingRingGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.028, 8);
    zingRingGeo.rotateZ(Math.PI / 2);
    [-STUMP_WIDTH * 0.25, STUMP_WIDTH * 0.25].forEach((xOffset) => {
      const bm = woodMat.clone();
      bm.color.setHex(0xfef3c7);
      const b = new THREE.Mesh(bailGeo, bm);
      b.position.set(xOffset, STUMP_HEIGHT + 0.012, 0);
      // Glowing LED Zing Bail core collar
      const zingRing = new THREE.Mesh(zingRingGeo, bm);
      b.add(zingRing);
      group.add(b);
      bails.push(b);
    });

    const fc = document.createElement('canvas');
    fc.width = fc.height = 128;
    const fx = fc.getContext('2d');
    const fg = fx.createRadialGradient(64, 64, 2, 64, 64, 62);
    fg.addColorStop(0, 'rgba(255,245,235,1)');
    fg.addColorStop(0.3, 'rgba(255,30,66,0.75)');
    fg.addColorStop(1, 'rgba(255,20,50,0)');
    fx.fillStyle = fg;
    fx.fillRect(0, 0, 128, 128);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(fc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0
    }));
    flash.position.set(0, STUMP_HEIGHT * 0.6, 0);
    flash.scale.setScalar(1.4);
    flash.visible = false;
    flash.renderOrder = 6;
    group.add(flash);

    return { group, stumps, bails, flash };
  }

  resetWickets() {
    this.bailsDislodged = false;
    [this.strikerStumps, this.nonStrikerStumps].forEach((set) => {
      [-STUMP_WIDTH / 2, 0, STUMP_WIDTH / 2].forEach((xOffset, idx) => {
        const s = set.stumps[idx];
        s.position.set(xOffset, 0, 0);
        s.rotation.set(0, 0, 0);
        s.material.color.setHex(0xfde68a);
        s.material.emissive.setHex(STUMP_GLOW);
        s.material.emissiveIntensity = 0.18;
        s.userData.fly = null;
      });
      [-STUMP_WIDTH * 0.25, STUMP_WIDTH * 0.25].forEach((xOffset, idx) => {
        const b = set.bails[idx];
        b.position.set(xOffset, STUMP_HEIGHT + 0.012, 0);
        b.rotation.set(0, 0, 0);
        b.material.color.setHex(0xfef3c7);
        b.material.emissive.setHex(STUMP_GLOW);
        b.material.emissiveIntensity = 0.18;
        b.userData.fly = null;
      });
      if (set.flash) set.flash.visible = false;
    });
  }

  dislodgeWickets(end = 'striker') {
    this.bailsDislodged = true;
    this.dislodgedEnd = end;
    this.bailTimer = 0;
    const set = end === 'striker' ? this.strikerStumps : this.nonStrikerStumps;
    const dirZ = end === 'striker' ? 1 : -1; // away from the bowler
    set.stumps.forEach((s, i) => {
      s.material.emissive.setHex(STUMP_ZING_FLASH);
      s.material.emissiveIntensity = 1.45;
      s.userData.fly = {
        vx: (i - 1) * 0.9 + (Math.random() - 0.5) * 0.7,
        vy: 2.4 + Math.random() * 1.4,
        vz: dirZ * (1.6 + Math.random() * 1.6),
        wx: dirZ * (6 + Math.random() * 6),
        wz: (Math.random() - 0.5) * 10,
        rest: false
      };
    });
    set.bails.forEach((b) => {
      b.material.emissive.setHex(STUMP_ZING_FLASH);
      b.material.emissiveIntensity = 1.45;
    });
    if (set.flash) {
      set.flash.visible = true;
      set.flash.material.opacity = 1;
      set.flash.scale.setScalar(0.8);
    }
    this.spawnDustPuff(new THREE.Vector3(set.group.position.x, 0.04, set.group.position.z), 0.5);
    sound.playStumpsHit();
    // Slow-motion as the stumps go flying
    this.slowMoScale = 0.38;
    this.slowMoUntil = performance.now() + 850;
  }

  /**
   * Builds Expressive Low-Poly Rigged Characters (or Soldier glTF if CHARACTER_STYLE === 'soldier')
   * for Striker, Non-Striker, Bowler, Wicketkeeper, and 9 LOD Fielders with team jersey colours & numbers
   */
  disposeActorHierarchy(root) {
    if (!root) return;
    root.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          if (!mat) return;
          if (mat.dispose) mat.dispose();
        });
      }
    });
  }

  /**
   * Builds Expressive Low-Poly Rigged Characters (or Soldier glTF if CHARACTER_STYLE === 'soldier')
   * for Striker, Non-Striker, Bowler, Wicketkeeper, and 9 LOD Fielders with team jersey colours & numbers
   */
  rebuildTeamCharacters() {
    if (this.actorsGroup) {
      this.disposeActorHierarchy(this.actorsGroup);
      this.scene.remove(this.actorsGroup);
    }
    this.actorsGroup = new THREE.Group();
    this.scene.add(this.actorsGroup);

    const batTeam = this.match.battingTeam;
    const bowlTeam = this.match.bowlingTeam;
    const skinTones = [0xd69e72, 0xc68642, 0xe0ac69, 0x8d5524, 0xf1c27d];
    const squadJerseyNumbers = [45, 77, 18, 63, 17, 33, 8, 20, 23, 93, 15];
    const strikerNum =
      this.match.strikerIndex === 0
        ? batTeam.defaultNumber || 45
        : squadJerseyNumbers[this.match.strikerIndex % squadJerseyNumbers.length];
    const nonStrikerNum =
      this.match.nonStrikerIndex === 0
        ? batTeam.defaultNumber || 45
        : squadJerseyNumbers[this.match.nonStrikerIndex % squadJerseyNumbers.length];
    const bowlerNum = squadJerseyNumbers[this.match.currentBowlerIndex % squadJerseyNumbers.length] || bowlTeam.defaultNumber || 93;

    // 1. Striker (Low-Poly Rigged Character + Detailed English Willow Bat on Bat Pivot)
    this.strikerPlayer = new RiggedCricketPlayer({
      baseGltf: this.baseGltf,
      mocapClips: this.mocapClips,
      role: 'batsman',
      colorHex: batTeam.primaryColor,
      secondaryColorHex: batTeam.secondaryColor,
      jerseyNumber: strikerNum,
      skinHex: skinTones[this.match.strikerIndex % skinTones.length],
      useLOD: false,
      flipJerseyText: this.handedness === 'left'
    });
    this.strikerMesh = this.strikerPlayer.group;
    this.strikerMesh.position.set(this.batting?.creaseX || 0, 0, CREASE_Z + 0.14);
    this.strikerMesh.rotation.y = Math.PI; // Faces bowler (-Z)
    this.strikerMesh.scale.x = this.handedness === 'left' ? -1 : 1;

    const strikerBatPivot = new THREE.Group();
    strikerBatPivot.position.set(0.0, 0.92, 0.24);
    const detailedBat = createDetailedCricketBatMesh();
    strikerBatPivot.add(detailedBat);
    this.strikerMesh.add(strikerBatPivot);
    this.strikerMesh.userData.batPivot = strikerBatPivot;
    this.strikerMesh.userData.batMesh = detailedBat;
    this.actorsGroup.add(this.strikerMesh);
    this.updateEquippedBatVisuals();

    // 2. Non-Striker (Low-Poly Rigged Character + Detailed Willow Bat grounded safely behind Bowler's End Popping Crease)
    this.nonStrikerPlayer = new RiggedCricketPlayer({
      baseGltf: this.baseGltf,
      mocapClips: this.mocapClips,
      role: 'batsman',
      colorHex: batTeam.primaryColor,
      secondaryColorHex: batTeam.secondaryColor,
      jerseyNumber: nonStrikerNum === strikerNum ? ((nonStrikerNum + 7) % 99) || 7 : nonStrikerNum,
      skinHex: skinTones[this.match.nonStrikerIndex % skinTones.length],
      useLOD: true
    });
    this.nonStrikerMesh = this.nonStrikerPlayer.group;
    this.nonStrikerMesh.position.set(-0.95, 0, -CREASE_Z - 0.18);
    this.nonStrikerMesh.rotation.y = 0;
    const nonStrikerBat = createDetailedCricketBatMesh();
    nonStrikerBat.position.set(0.24, 0.90, 0.18);
    this.nonStrikerMesh.add(nonStrikerBat);
    this.nonStrikerMesh.userData.batMesh = nonStrikerBat;
    this.actorsGroup.add(this.nonStrikerMesh);

    // 3. Bowler (Low-Poly Rigged Character)
    this.bowlerPlayer = new RiggedCricketPlayer({
      baseGltf: this.baseGltf,
      mocapClips: this.mocapClips,
      role: 'bowler',
      colorHex: bowlTeam.primaryColor,
      secondaryColorHex: bowlTeam.secondaryColor,
      jerseyNumber: bowlerNum,
      skinHex: skinTones[this.match.currentBowlerIndex % skinTones.length],
      useLOD: false
    });
    this.bowlerMesh = this.bowlerPlayer.group;
    this.bowlerMesh.position.set(0.54, 0, -CREASE_Z - 6.5);
    this.bowlerMesh.rotation.y = 0;
    this.actorsGroup.add(this.bowlerMesh);

    // 4. Wicketkeeper (Low-Poly Rigged Character with Helmet, Pads & Keeping Gloves)
    this.keeperPlayer = new RiggedCricketPlayer({
      baseGltf: this.baseGltf,
      mocapClips: this.mocapClips,
      role: 'keeper',
      colorHex: bowlTeam.primaryColor,
      secondaryColorHex: bowlTeam.secondaryColor,
      jerseyNumber: 1,
      skinHex: skinTones[2],
      useLOD: false
    });
    this.keeperMesh = this.keeperPlayer.group;
    this.keeperMesh.position.copy(this.fielding.keeper.pos);
    this.keeperMesh.rotation.y = Math.PI;
    this.actorsGroup.add(this.keeperMesh);

    // 5. 9 Fielders with THREE.LOD (Full Low-Poly Character near, Lighter Proxy far)
    this.fielderPlayers = [];
    this.fielderMeshes = this.fielding.fielders.map((f, idx) => {
      const fp = new RiggedCricketPlayer({
        baseGltf: this.baseGltf,
        mocapClips: this.mocapClips,
        role: 'fielder',
        colorHex: bowlTeam.primaryColor,
        secondaryColorHex: bowlTeam.secondaryColor,
        jerseyNumber: f.number || idx + 2,
        skinHex: skinTones[idx % skinTones.length],
        useLOD: true
      });
      fp.group.position.copy(f.pos);
      fp.group.rotation.y = f.rotY;
      this.actorsGroup.add(fp.group);
      this.fielderPlayers.push(fp);
      return fp.group;
    });

    // 6. 3D Match Umpire positioned authentically at center behind the non-striker stumps (x = 0)
    this.umpireMesh = this.build3DUmpireMesh();
    this.umpireMesh.position.set(0, 0, -BOWLING_CREASE_Z - 1.35);
    this.umpireMesh.rotation.y = 0;
    this.actorsGroup.add(this.umpireMesh);

    // Upgrade all cricketer helmets, jerseys, pads, gloves & umpire with Stadium Floodlight Fresnel Rim-Shader
    upgradeCricketerMaterials(this.actorsGroup, 0xe0f2fe);
  }

  build3DUmpireMesh() {
    // Pro Broadcast Match Umpire (tailored dark blazer, collared shirt & tie, wide-brim Panama hat, painted pro face)
    const g = new THREE.Group();
    const clothNorm = getClothNormalMap();
    const std = (color, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02 });
    const trouserMat = new THREE.MeshStandardMaterial({ color: 0x111827, normalMap: clothNorm, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.68 });
    const blazerMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, normalMap: clothNorm, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.58 });
    const shirtMat = std(0xf8fafc, 0.55);
    const tieMat = std(0x991b1b, 0.45);
    const skinMat = std(0xd69e72, 0.52);
    skinMat.emissive = new THREE.Color(0xd69e72).multiplyScalar(0.14);
    const hatMat = std(0xe7e5e4, 0.58);
    const hatBandMat = std(0x0f172a, 0.55);
    const shoeMat = std(0xf1f5f9, 0.42, 0.05);
    const faceTex = createProFaceTexture(0xd69e72, 0x262626, false);
    const faceMat = new THREE.MeshStandardMaterial({
      map: faceTex,
      roughness: 0.5,
      emissive: new THREE.Color(0xd69e72).multiplyScalar(0.12)
    });

    const addPart = (parent, geo, mat, x, y, z, opts = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (opts.scale) m.scale.set(...opts.scale);
      if (opts.rot) m.rotation.set(...opts.rot);
      parent.add(m);
      return m;
    };

    // Tailored trousers + athletic umpire shoes
    [-1, 1].forEach((s) => {
      addPart(g, new THREE.CylinderGeometry(0.088, 0.068, 0.82, 12), trouserMat, s * 0.105, 0.45, 0);
      addPart(g, new THREE.CapsuleGeometry(0.048, 0.11, 4, 8), shoeMat, s * 0.105, 0.04, 0.04, {
        rot: [Math.PI * 0.5, 0, 0],
        scale: [1, 1, 0.72]
      });
    });

    // Tailored pelvis & V-taper blazer torso + crisp white shirt + crimson tie
    addPart(g, new THREE.CylinderGeometry(0.168, 0.164, 0.18, 14), trouserMat, 0, 0.87, 0, { scale: [1.12, 1, 0.76] });
    addPart(g, new THREE.CylinderGeometry(0.205, 0.168, 0.52, 16), blazerMat, 0, 1.18, 0, { scale: [1.12, 1, 0.72] });
    addPart(g, new THREE.BoxGeometry(0.095, 0.22, 0.02), shirtMat, 0, 1.32, 0.125, { rot: [-0.08, 0, 0] });
    addPart(g, new THREE.BoxGeometry(0.026, 0.2, 0.018), tieMat, 0, 1.29, 0.136, { rot: [-0.08, 0, 0] });

    // Sculpted neck + pro painted head + wide-brim Panama sun hat
    addPart(g, new THREE.CylinderGeometry(0.058, 0.07, 0.11, 10), skinMat, 0, 1.48, 0);
    const head = new THREE.Group();
    head.position.set(0, 1.59, 0);
    g.add(head);
    addPart(head, new THREE.SphereGeometry(0.116, 16, 12), faceMat, 0, 0.01, 0, {
      scale: [0.92, 1.06, 1.0],
      rot: [0, -Math.PI * 0.5, 0]
    });
    addPart(head, new THREE.ConeGeometry(0.016, 0.04, 6), skinMat, 0, 0.0, 0.116, { rot: [Math.PI * 0.42, 0, 0] });
    // Panama sun hat with dark ribbon band
    addPart(head, new THREE.CylinderGeometry(0.22, 0.23, 0.014, 24), hatMat, 0, 0.092, 0.005, { rot: [0.04, 0, 0] });
    addPart(head, new THREE.CylinderGeometry(0.11, 0.124, 0.085, 18), hatMat, 0, 0.138, 0.0);
    addPart(head, new THREE.CylinderGeometry(0.125, 0.126, 0.022, 18), hatBandMat, 0, 0.106, 0.0);

    // Articulated signal arms (kept as pivots: triggerUmpireSignal animates userData.leftArm / rightArm)
    const makeArm = (s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.245, 1.39, 0);
      addPart(pivot, new THREE.SphereGeometry(0.068, 10, 8), blazerMat, 0, 0, 0);
      addPart(pivot, new THREE.CylinderGeometry(0.062, 0.054, 0.28, 10), blazerMat, 0, -0.14, 0);
      addPart(pivot, new THREE.CylinderGeometry(0.048, 0.038, 0.26, 10), blazerMat, 0, -0.38, 0);
      addPart(pivot, new THREE.CapsuleGeometry(0.032, 0.042, 4, 8), skinMat, 0, -0.54, 0, { scale: [0.95, 1, 0.7] });
      g.add(pivot);
      return pivot;
    };
    g.userData.leftArm = makeArm(-1);
    g.userData.rightArm = makeArm(1);
    return g;
  }

  triggerUmpireSignal(signal = 'idle') {
    this.umpireSignal = signal;
    this.umpireSignalTimer = signal === 'idle' ? 0 : 2.8;
  }

  updateEquippedBatVisuals() {
    const batMesh = this.strikerMesh?.userData?.batMesh;
    if (!batMesh) return;
    const onFire = typeof this.batting?.isOnFire === 'function' && this.batting.isOnFire();
    const bladeHex = onFire ? 0xf97316 : 0xe2c799;
    const emissiveHex = onFire ? 0xff4500 : 0x000000;
    const emissiveInt = onFire ? 0.85 : 0.0;

    batMesh.traverse((child) => {
      if (child.isMesh && child.material) {
        if (child.position.y < 0) {
          child.material.color?.setHex(bladeHex);
          if (child.material.emissive) {
            child.material.emissive.setHex(emissiveHex);
            child.material.emissiveIntensity = emissiveInt;
          }
        }
      }
    });
  }

  addStadiumFloodlightPylons(group, nightSprites, nightPanelMats, pylonAngles, height = 42) {
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.22 });
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfffbeb,
      emissiveIntensity: 3.2
    });
    nightPanelMats.push(panelMat);

    const glareTex = this.createFloodlightGlareTexture();
    const glareMat = new THREE.SpriteMaterial({
      map: glareTex,
      color: 0xfffbeb,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    pylonAngles.forEach((ang) => {
      const pylon = new THREE.Group();
      const dist = BOUNDARY_RADIUS + 26;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.3, height, 10), towerMat);
      mast.position.y = height / 2;
      pylon.add(mast);

      const head = new THREE.Mesh(new THREE.BoxGeometry(9.5, 5.2, 1.2), panelMat);
      head.position.set(0, height, 0.8);
      head.rotation.x = 0.35;
      pylon.add(head);

      const glareSprite = new THREE.Sprite(glareMat);
      glareSprite.position.set(0, height, 2.2);
      glareSprite.scale.set(28, 18, 1);
      pylon.add(glareSprite);
      nightSprites.push(glareSprite);

      pylon.position.set(Math.sin(ang) * dist, 0, Math.cos(ang) * dist);
      pylon.lookAt(0, 0, 0);
      group.add(pylon);
    });
  }

  createStadiumTierTexture(baseHex = 0x1e3a5f, accentHex = 0x38bdf8) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const base = new THREE.Color(baseHex);
    const dark = base.clone().multiplyScalar(0.45);
    const acc = new THREE.Color(accentHex);

    const bg = ctx.createLinearGradient(0, 0, 0, 256);
    bg.addColorStop(0, `#${dark.getHexString()}`);
    bg.addColorStop(0.5, `#${base.getHexString()}`);
    bg.addColorStop(1, `#${dark.getHexString()}`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);

    // Stepped concrete seating rows & subtle seat dots (0 runtime cost!)
    for (let y = 14; y < 248; y += 20) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
      ctx.fillRect(0, y, 512, 4);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(0, y + 4, 512, 2);
      for (let x = 6; x < 512; x += 14) {
        if ((x % 128) < 16) continue;
        ctx.fillStyle = (x + y) % 28 === 0 ? `#${acc.getHexString()}` : 'rgba(226, 232, 240, 0.22)';
        ctx.fillRect(x, y + 7, 8, 9);
      }
    }
    // Concrete vertical stair aisles + yellow step trim
    for (let ax = 0; ax < 512; ax += 128) {
      ctx.fillStyle = '#334155';
      ctx.fillRect(ax, 0, 14, 256);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.5)';
      ctx.fillRect(ax + 1, 0, 2, 256);
      ctx.fillRect(ax + 11, 0, 2, 256);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(12, 1);
    return tex;
  }

  buildSightscreensAndJumbotron() {
    // 1. Slatted Pro Sightscreens behind both ends
    const ssCanvas = document.createElement('canvas');
    ssCanvas.width = 256;
    ssCanvas.height = 128;
    const sCtx = ssCanvas.getContext('2d');
    sCtx.fillStyle = '#e2e8f0';
    sCtx.fillRect(0, 0, 256, 128);
    for (let x = 0; x < 256; x += 16) {
      sCtx.fillStyle = 'rgba(15, 23, 42, 0.14)';
      sCtx.fillRect(x, 0, 3, 128);
    }
    sCtx.strokeStyle = '#1e293b';
    sCtx.lineWidth = 8;
    sCtx.strokeRect(4, 4, 248, 120);
    const ssTex = new THREE.CanvasTexture(ssCanvas);
    ssTex.colorSpace = THREE.SRGBColorSpace;
    const ssMat = new THREE.MeshStandardMaterial({ map: ssTex, roughness: 0.45 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.4 });
    [-BOUNDARY_RADIUS - 4.2, BOUNDARY_RADIUS + 4.2].forEach((z) => {
      const ss = new THREE.Mesh(new THREE.BoxGeometry(13, 6.8, 0.7), ssMat);
      ss.position.set(0, 3.4, z);
      this.scene.add(ss);
      const base = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.5, 1.1), frameMat);
      base.position.set(0, 0.25, z);
      this.scene.add(base);
    });

    // 2. Giant Stadium Digital Jumbotron Scoreboard (only updates canvas on ball completion -> 0 FPS impact!)
    const jc = document.createElement('canvas');
    jc.width = 512;
    jc.height = 256;
    this._jumbotronCanvas = jc;
    this._jumbotronCtx = jc.getContext('2d');
    this._jumbotronTex = new THREE.CanvasTexture(jc);
    this._jumbotronTex.colorSpace = THREE.SRGBColorSpace;

    const jGroup = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(22, 11, 1.2), frameMat);
    jGroup.add(housing);
    const screenMat = new THREE.MeshBasicMaterial({ map: this._jumbotronTex });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(20.6, 9.6), screenMat);
    screen.position.z = 0.64;
    jGroup.add(screen);
    // Support pillars
    [-8, 8].forEach((px) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 13, 8), frameMat);
      leg.position.set(px, -8.5, 0);
      jGroup.add(leg);
    });
    jGroup.position.set(-16, 15.5, -BOUNDARY_RADIUS - 16);
    jGroup.rotation.y = 0.26;
    this.scene.add(jGroup);
    this.updateJumbotronScoreboard();
  }

  updateJumbotronScoreboard(flashText = '') {
    const ctx = this._jumbotronCtx;
    if (!ctx || !this._jumbotronTex) return;
    const W = 512;
    const H = 256;
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    const batTeam = this.match?.battingTeam?.shortCode || 'IND';
    const runs = this.match?.runs ?? 0;
    const wkts = this.match?.wickets ?? 0;
    const overs = this.match?.getOversDisplay ? this.match.getOversDisplay() : '0.0';
    const maxOvers = this.match?.totalOvers ?? 5;

    ctx.fillStyle = '#38bdf8';
    ctx.font = '900 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${batTeam}  INNINGS · ${overs}/${maxOvers} OV`, W * 0.5, 52);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 96px system-ui, sans-serif';
    ctx.fillText(`${runs}/${wkts}`, W * 0.5, 152);

    ctx.fillStyle = flashText ? '#facc15' : '#94a3b8';
    ctx.font = '800 28px system-ui, sans-serif';
    const sub = flashText || (this.match?.firstInningsScore !== null
      ? `TARGET ${this.match.firstInningsScore + 1}`
      : 'LIVE BROADCAST');
    ctx.fillText(sub, W * 0.5, 214);
    this._jumbotronTex.needsUpdate = true;
  }

  addStadiumCrowdBowl(group, crowdCount, palette) {
    if (!this.crowdAnimator) {
      this.crowdAnimator = new StadiumCrowdAnimator();
    }
    this.crowdAnimator.buildCrowdBowl(group, crowdCount, palette);
  }

  /**
   * 1. EDEN GARDENS, KOLKATA
   * Iconic double-tier bowl, undulating white arched canopy roof segments,
   * historic BC Roy Clubhouse pavilion & 4 towering floodlight pylons.
   */
  buildEdenGardensStadium() {
    const group = new THREE.Group();
    const nightSprites = [];
    const nightPanelMats = [];

    // Main double-tier seating bowl with procedural stepped rows & aisles texture
    const standGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 24, BOUNDARY_RADIUS + 6, 13.5, 48, 1, true);
    const standMat = new THREE.MeshStandardMaterial({
      map: this.createStadiumTierTexture(0x1e3a5f, 0x38bdf8),
      roughness: 0.72,
      side: THREE.DoubleSide
    });
    const standMesh = new THREE.Mesh(standGeo, standMat);
    standMesh.position.y = 6.75;
    group.add(standMesh);

    // Signature Eden Gardens arched white fabric canopy sections around the upper tier
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.45,
      side: THREE.DoubleSide
    });
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      if (Math.abs(Math.cos(ang)) > 0.92) continue; // Leave sightscreen gaps
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(9.5, 4.2, 5), canopyMat);
      const r = BOUNDARY_RADIUS + 20;
      canopy.position.set(Math.sin(ang) * r, 15.2, Math.cos(ang) * r);
      canopy.rotation.y = ang;
      group.add(canopy);
    }

    // Historic BC Roy Clubhouse Pavilion
    const pavGroup = new THREE.Group();
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(24, 8, 12),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.7 })
    );
    walls.position.y = 4.0;
    pavGroup.add(walls);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(16, 4.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x065f46, roughness: 0.6 })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 10.2;
    pavGroup.add(roof);
    pavGroup.position.set(-BOUNDARY_RADIUS - 15, 0, 0);
    group.add(pavGroup);

    // Perimeter LED ribbon
    const ledGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 3.2, BOUNDARY_RADIUS + 3.2, 1.1, 64, 1, true);
    const sponsorTex = this.createLedSponsorRibbonTexture(0x10b981);
    const ledMat = new THREE.MeshStandardMaterial({
      map: this.wavedashGraphicsMode ? sponsorTex : null,
      emissiveMap: this.wavedashGraphicsMode ? sponsorTex : null,
      color: this.wavedashGraphicsMode ? 0xffffff : 0x10b981,
      emissive: this.wavedashGraphicsMode ? 0xffffff : 0x059669,
      emissiveIntensity: this.wavedashGraphicsMode ? 0.95 : 0.65,
      side: THREE.DoubleSide
    });
    this.ledRibbonMats.push({ mat: ledMat, baseHex: 0x10b981, emissiveHex: 0x059669, sponsorTex });
    const ledRibbon = new THREE.Mesh(ledGeo, ledMat);
    ledRibbon.position.y = 0.55;
    group.add(ledRibbon);

    this.addStadiumCrowdBowl(group, 420, [0x0284c7, 0xf59e0b, 0x10b981, 0xf8fafc, 0x38bdf8]);
    this.addStadiumFloodlightPylons(
      group,
      nightSprites,
      nightPanelMats,
      [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75],
      42
    );

    group.userData = { nightSprites, nightPanelMats };
    return group;
  }

  /**
   * 2. WANKHEDE STADIUM, MUMBAI
   * Iconic cantilevered suspended white roof ring, Sachin/Garware pavilion,
   * red-orange & blue seating tiers, and 4 coastal floodlight towers.
   */
  buildWankhedeStadium() {
    const group = new THREE.Group();
    const nightSprites = [];
    const nightPanelMats = [];

    const standGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 23, BOUNDARY_RADIUS + 6, 14, 48, 1, true);
    const standMat = new THREE.MeshStandardMaterial({
      map: this.createStadiumTierTexture(0x7c2d12, 0xf97316),
      roughness: 0.68,
      side: THREE.DoubleSide
    });
    const standMesh = new THREE.Mesh(standGeo, standMat);
    standMesh.position.y = 7.0;
    group.add(standMesh);

    // Wankhede's iconic continuous cantilevered white roof ring
    const roofRingGeo = new THREE.RingGeometry(BOUNDARY_RADIUS + 11, BOUNDARY_RADIUS + 25.5, 48);
    roofRingGeo.rotateX(-Math.PI / 2);
    const roofRingMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.42,
      side: THREE.DoubleSide
    });
    const roofRing = new THREE.Mesh(roofRingGeo, roofRingMat);
    roofRing.position.y = 14.4;
    group.add(roofRing);

    const ledGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 3.2, BOUNDARY_RADIUS + 3.2, 1.1, 64, 1, true);
    const sponsorTex = this.createLedSponsorRibbonTexture(0x0284c7);
    const ledMat = new THREE.MeshStandardMaterial({
      map: this.wavedashGraphicsMode ? sponsorTex : null,
      emissiveMap: this.wavedashGraphicsMode ? sponsorTex : null,
      color: this.wavedashGraphicsMode ? 0xffffff : 0x0284c7,
      emissive: this.wavedashGraphicsMode ? 0xffffff : 0x0284c7,
      emissiveIntensity: this.wavedashGraphicsMode ? 0.95 : 0.75,
      side: THREE.DoubleSide
    });
    this.ledRibbonMats.push({ mat: ledMat, baseHex: 0x0284c7, emissiveHex: 0x0284c7, sponsorTex });
    const ledRibbon = new THREE.Mesh(ledGeo, ledMat);
    ledRibbon.position.y = 0.55;
    group.add(ledRibbon);

    this.addStadiumCrowdBowl(group, 420, [0x0284c7, 0xf97316, 0xfacc15, 0xf8fafc, 0xef4444]);
    this.addStadiumFloodlightPylons(
      group,
      nightSprites,
      nightPanelMats,
      [Math.PI * 0.22, Math.PI * 0.78, Math.PI * 1.22, Math.PI * 1.78],
      44
    );

    group.userData = { nightSprites, nightPanelMats };
    return group;
  }

  /**
   * 3. NARENDRA MODI STADIUM, AHMEDABAD
   * World's largest cricket stadium (132,000 capacity) with a colossal 360° dual-tier
   * saffron & royal-blue colosseum bowl and signature circular roof-mounted LED ring of fire!
   */
  buildNarendraModiStadium() {
    const group = new THREE.Group();
    const nightSprites = [];
    const nightPanelMats = [];

    // Lower & Upper Colossal Seating Bowl with stepped tier texture
    const lowerGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 18, BOUNDARY_RADIUS + 6, 10, 48, 1, true);
    const lowerMat = new THREE.MeshStandardMaterial({
      map: this.createStadiumTierTexture(0x1e3a8a, 0x38bdf8),
      roughness: 0.68,
      side: THREE.DoubleSide
    });
    const lowerStand = new THREE.Mesh(lowerGeo, lowerMat);
    lowerStand.position.y = 5.0;
    group.add(lowerStand);

    const upperGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 30, BOUNDARY_RADIUS + 17, 11, 48, 1, true);
    const upperMat = new THREE.MeshStandardMaterial({
      map: this.createStadiumTierTexture(0xc2410c, 0xfacc15),
      roughness: 0.65,
      side: THREE.DoubleSide
    });
    const upperStand = new THREE.Mesh(upperGeo, upperMat);
    upperStand.position.y = 14.5;
    group.add(upperStand);

    // Iconic Circular Roof Canopy + Ring of Fire LED Floodlights (No traditional pylons!)
    const canopyGeo = new THREE.RingGeometry(BOUNDARY_RADIUS + 16, BOUNDARY_RADIUS + 31, 64);
    canopyGeo.rotateX(-Math.PI / 2);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.4,
      side: THREE.DoubleSide
    });
    const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
    canopyMesh.position.y = 20.2;
    group.add(canopyMesh);

    const ringLightMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfffbeb,
      emissiveIntensity: 3.4
    });
    nightPanelMats.push(ringLightMat);
    const ringLightGeo = new THREE.TorusGeometry(BOUNDARY_RADIUS + 16.2, 0.45, 12, 64);
    ringLightGeo.rotateX(Math.PI / 2);
    const ringLightMesh = new THREE.Mesh(ringLightGeo, ringLightMat);
    ringLightMesh.position.y = 19.9;
    group.add(ringLightMesh);

    const glareTex = this.createFloodlightGlareTexture();
    const glareMat = new THREE.SpriteMaterial({
      map: glareTex,
      color: 0xfffbeb,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const r = BOUNDARY_RADIUS + 16.5;
      const sp = new THREE.Sprite(glareMat);
      sp.position.set(Math.sin(ang) * r, 20.0, Math.cos(ang) * r);
      sp.scale.set(22, 14, 1);
      group.add(sp);
      nightSprites.push(sp);
    }

    const ledGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 3.2, BOUNDARY_RADIUS + 3.2, 1.1, 64, 1, true);
    const sponsorTex = this.createLedSponsorRibbonTexture(0xf97316);
    const ledMat = new THREE.MeshStandardMaterial({
      map: this.wavedashGraphicsMode ? sponsorTex : null,
      emissiveMap: this.wavedashGraphicsMode ? sponsorTex : null,
      color: this.wavedashGraphicsMode ? 0xffffff : 0xf97316,
      emissive: this.wavedashGraphicsMode ? 0xffffff : 0xea580c,
      emissiveIntensity: this.wavedashGraphicsMode ? 0.95 : 0.8,
      side: THREE.DoubleSide
    });
    this.ledRibbonMats.push({ mat: ledMat, baseHex: 0xf97316, emissiveHex: 0xea580c, sponsorTex });
    const ledRibbon = new THREE.Mesh(ledGeo, ledMat);
    ledRibbon.position.y = 0.55;
    group.add(ledRibbon);

    this.addStadiumCrowdBowl(group, 460, [0xf97316, 0x0284c7, 0xfacc15, 0xf8fafc, 0x38bdf8]);

    group.userData = { nightSprites, nightPanelMats };
    return group;
  }

  toggleNightMode() {
    const nextTime = this.match.timeOfDay === 'day' ? 'night' : 'day';
    this.setStadium(this.match.stadium, nextTime);
    if (this.ui && typeof this.ui.syncStadiumAndDayNightUI === 'function') {
      this.ui.syncStadiumAndDayNightUI(this.match.stadium, nextTime);
    }
  }

  setStadium(stadiumId = 'eden_gardens', timeOfDay = null) {
    // Map legacy stadium names seamlessly
    const mappedId =
      stadiumId === 'wankhede' || stadiumId === 'street'
        ? 'wankhede'
        : stadiumId === 'narendra_modi' || stadiumId === 'night'
          ? 'narendra_modi'
          : 'eden_gardens';

    const resolvedTime =
      timeOfDay === 'day' || timeOfDay === 'night'
        ? timeOfDay
        : this.match.timeOfDay || 'night';

    this.match.stadium = mappedId;
    this.match.timeOfDay = resolvedTime;
    this.physics.surface = mappedId;

    Object.entries(this.stadiumGroups).forEach(([id, grp]) => {
      grp.visible = id === mappedId;
      const isNight = resolvedTime === 'night';
      if (grp.userData?.nightSprites) {
        grp.userData.nightSprites.forEach((sp) => {
          sp.visible = isNight;
        });
      }
      if (grp.userData?.nightPanelMats) {
        grp.userData.nightPanelMats.forEach((m) => {
          m.emissiveIntensity = isNight ? 3.2 : 0.15;
        });
      }
    });

    if (resolvedTime === 'day') {
      if (this.hdriEnvMap) {
        this.scene.background = this.hdriEnvMap;
        this.scene.backgroundBlurriness = 0.08;
      } else {
        this.scene.background = new THREE.Color(0x38bdf8);
      }
      this.scene.fog.color.setHex(0xbae6fd);
      this.keyLight.color.setHex(0xffffff);
      this.keyLight.intensity = 2.35;
      this.hemiLight.intensity = 0.88;
      this.outfieldMat.color.setHex(0xffffff);
      this.scene.environmentIntensity = 0.55;
      if (this.bloomPass) this.bloomPass.strength = 0.20;
    } else {
      this.scene.background = new THREE.Color(0x060b16);
      this.scene.fog.color.setHex(0x060b16);
      this.keyLight.color.setHex(0xfffbeb);
      this.keyLight.intensity = 2.1;
      this.hemiLight.intensity = 0.72;
      this.outfieldMat.color.setHex(0xffffff);
      this.scene.environmentIntensity = 0.36;
      if (this.bloomPass) this.bloomPass.strength = 0.46;
    }
    this.updateJumbotronScoreboard();
  }

  setPitchType(pitchType = 'normal') {
    this.physics.pitchType = pitchType;
    this.pitchSurface.resetPitchTexture(pitchType);
    this.physics.resetMatchWear();
    this.ui.updateHUD();
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this.savedCameraMode = mode;
    this._snapCameraNextFrame = true;
    const rightSign = mode === 'broadcast' ? -1 : 1;
    if (this.batting) {
      this.batting.screenRightSign = rightSign;
      if (typeof this.batting.setWheelAimDeg === 'function') {
        this.batting.setWheelAimDeg(this.batting.custom360AimDeg || 0, false);
      }
    }
    if (this.bowling) {
      this.bowling.screenRightSign = rightSign;
    }
    document.querySelectorAll('[data-cam]').forEach((b) => {
      const isAct = b.getAttribute('data-cam') === mode;
      b.classList.toggle('bg-amber-500', isAct);
      b.classList.toggle('text-slate-950', isAct);
      b.classList.toggle('bg-slate-800', !isAct);
      b.classList.toggle('text-slate-200', !isAct);
    });
    if (this.ui && typeof this.ui.syncAngleWheelUI === 'function') {
      this.ui.syncAngleWheelUI();
    }
    if (this.ui && typeof this.ui.syncPhoneMatchHUD === 'function') {
      this.ui.syncPhoneMatchHUD();
    }
  }

  setFieldPreset(presetId) {
    this.fielding.applyFieldSetting(presetId, this.match.isPowerplayActive(), true);
    this.fielding.resetToHomePositions(this.bowling.bowlerType);
    if (this.ui && typeof this.ui.syncAngleWheelUI === 'function') {
      this.ui.syncAngleWheelUI();
    }
  }

  setBowlerType(typeId) {
    this.bowling.bowlerType = typeId;
    const validVars = this.bowling.getVariationsForBowler(typeId);
    if (validVars.length > 0 && !validVars.some((v) => v.id === this.bowling.selectedVariationId)) {
      this.bowling.setVariation(validVars[0].id);
    }
    this.fielding.resetToHomePositions(typeId);
    if (this.ui && typeof this.ui.populateBowlingVariationSelect === 'function') {
      this.ui.populateBowlingVariationSelect();
    }
  }

  toggleBowlerSide(forceSide = null) {
    this.bowling.toggleBowlerSide(forceSide);
    if (this.ui && typeof this.ui.updateBowlerSideButton === 'function') {
      this.ui.updateBowlerSideButton();
    }
    const sideLabel = this.bowling.bowlerSide === 'around' ? 'Around the Wicket' : 'Over the Wicket';
    this.ui.showStatusToast(`Bowler angle: ${sideLabel}`, true);
  }

  showLengthBanner(text) {
    if (!text) return;
    let el = document.getElementById('length-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'length-banner';
      document.body.appendChild(el);
    }
    el.textContent = String(text).replace(/\s*\/\s*/g, ' / ').toUpperCase();
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  setAimRingColor(hexColor = 0xf59e0b) {
    if (this.aimOuterMat) this.aimOuterMat.color.setHex(hexColor);
    if (this.aimInnerMat) this.aimInnerMat.color.setHex(hexColor);
    if (this.timingRingMat) this.timingRingMat.color.setHex(hexColor);
  }

  scheduleAutoBowl(customDelaySec = null) {
    const mode = gameConfig.autoBowl || 'normal';
    if (mode === 'manual' && this.match?.userRole === 'bowl') {
      this.autoBowlScheduled = false;
      this.autoBowlCountdown = 0;
      return;
    }
    const defaultDelay = mode === 'fast' ? 1.15 : 1.95;
    this.autoBowlCountdown = typeof customDelaySec === 'number' ? customDelaySec : defaultDelay;
    this.autoBowlScheduled = true;
    this.lastCountdownWholeSec = -1;
  }

  getBallPan() {
    const dirSign = this.batting?.screenRightSign || -1;
    return THREE.MathUtils.clamp(((this.physics?.pos?.x || 0) * dirSign) / 28.0, -0.92, 0.92);
  }

  getCommentaryContext(extra = {}) {
    const striker = this.match.getActiveStriker();
    const bowler = this.match.getActiveBowler();
    const del = this.bowling.lastDelivery || {};
    const target = this.match.firstInningsScore !== null ? this.match.firstInningsScore + 1 : 0;
    const needRuns = Math.max(0, target - this.match.runs);
    const needBalls = Math.max(0, this.match.totalOvers * 6 - this.match.legalBalls);
    return {
      batsman: striker?.name || 'Batter',
      bowler: bowler?.name || 'Bowler',
      teamA: this.match.battingTeam?.nameEn || 'Team A',
      teamB: this.match.bowlingTeam?.nameEn || 'Team B',
      winner: this.match.winnerTextEn || this.match.battingTeam?.nameEn || 'Winner',
      speed: Math.round(del.speedKmh || this.physics.speedKmh || 132),
      delivery:
        gameConfig.commentary.language === 'hi' && del.variationNameHi
          ? del.variationNameHi
          : del.variationNameEn || 'good length delivery',
      shot:
        gameConfig.commentary.language === 'hi' && this.batting.lastContact?.shotNameHi
          ? this.batting.lastContact.shotNameHi
          : (this.batting.lastContact?.shotNameEn || 'drive').toLowerCase(),
      runs: striker?.runs ?? 0,
      balls: striker?.balls ?? 0,
      needRuns,
      needBalls,
      ...extra
    };
  }

  updateMatchTension() {
    let tension = 0.22;
    const oversProg = this.match.legalBalls / Math.max(6, this.match.totalOvers * 6);
    tension += oversProg * 0.25;
    if (this.match.wickets >= 7) tension += 0.18;
    if (this.match.freeHit) tension += 0.22;
    const bowler = this.match.getActiveBowler();
    if (bowler && bowler.consecutiveWickets >= 2) tension += 0.28;

    if (this.match.innings === 2 && this.match.firstInningsScore !== null) {
      const needRuns = Math.max(0, this.match.firstInningsScore + 1 - this.match.runs);
      const remBalls = Math.max(1, this.match.totalOvers * 6 - this.match.legalBalls);
      if (remBalls <= 12 && needRuns > 0 && needRuns <= 24) {
        tension = Math.max(tension, 0.88);
      } else if (needRuns / remBalls > 1.8) {
        tension = Math.max(tension, 0.68);
      }
    }
    sound.setMatchTension(THREE.MathUtils.clamp(tension, 0.18, 1.0));
  }

  setHandedness(hand = 'right') {
    const nextHand = hand === 'left' ? 'left' : 'right';
    const changed = this.handedness !== nextHand;
    this.handedness = nextHand;
    this.batting.setHandedness(this.handedness);
    if (this.strikerMesh) {
      this.strikerMesh.scale.x = this.handedness === 'left' ? -1 : 1;
    }
    if (changed && this.actorsGroup) {
      this.rebuildTeamCharacters();
    }
    const s1 = document.getElementById('setting-handedness');
    if (s1) s1.value = this.handedness;
    const s2 = document.getElementById('setup-handedness');
    if (s2) s2.value = this.handedness;
    this.ui.updateHUD();
  }

  setSoundEnabled(enabled) {
    sound.enabled = enabled;
  }

  setReplaySetting(mode = 'default') {
    this.replaySetting = mode;
    if (mode === 'off' && (this.isReplaying || this.pendingReplayStartTimer)) {
      this.skipReplay();
    }
  }

  applyGraphicsQualityPreset(preset = 'high') {
    this.graphicsQuality = preset;
    this.qualityPreset = preset;
    if (this.isHeadless) return;

    this.renderer.shadowMap.enabled = false;
    this.keyLight.castShadow = false;
    if (this.bokehPass) this.bokehPass.enabled = false;
    if (this.bloomPass) this.bloomPass.enabled = false;
    this.updateRendererResolution();
  }

  applyGraphicsSettings(res = '1080p', fps = '60') {
    this.targetFps = Number(fps) || 60;
    if (this.isHeadless) return;
    if (res === '720p') {
      this.renderer.setPixelRatio(Math.min(1.0, 1280 / Math.max(window.innerWidth, 1)));
    } else {
      this.updateRendererResolution();
    }
  }

  selectShotMode(mode) {
    if (this.batting.setShotMode(mode)) {
      this.net.vibratePhone('p1', [35]);
      this.net.syncShotModeLock(this.batting.shotMode, this.batting.modeLocked);
      this.ui.updateShotModeHUD();
    } else {
      const modeLbl = this.batting.shotMode === 'fly' ? 'LOFT' : 'GROUND';
      this.ui.setCommentary(
        `Shot mode is locked (${modeLbl}) after bowler release!`,
        `गेंद छूटने के बाद शॉट मोड (${modeLbl}) लॉक हो चुका है!`
      );
    }
  }

  /**
   * Priority-Based Replay Highlight Registration
   */
  registerReplayHighlight(candidate) {
    if (!candidate) return;
    if (!this.currentBallHighlight || candidate.priority >= this.currentBallHighlight.priority) {
      this.currentBallHighlight = candidate;
    }
  }

  /**
   * Evaluates whether a registered highlight should trigger a slow-motion replay
   */
  shouldPlayReplayForHighlight(candidate) {
    if (!candidate || this.replaySetting === 'off') return false;
    if (this.replayFrames.length < 8) return false;

    if (this.replaySetting === 'wickets') {
      return candidate.category === 'wicket';
    }
    if (this.replaySetting === 'default') {
      const isAnySix =
        candidate.category === 'boundary' &&
        String(candidate.label || '').toUpperCase().includes('SIX');
      return candidate.category === 'wicket' || isAnySix;
    }
    return true;
  }

  /**
   * Immediately skips any pending or active slow-motion replay and prepares the next ball
   */
  skipReplay() {
    if (this.pendingReplayStartTimer) {
      clearTimeout(this.pendingReplayStartTimer);
      this.pendingReplayStartTimer = null;
    }
    if (this.pendingReplayEndTimer) {
      clearTimeout(this.pendingReplayEndTimer);
      this.pendingReplayEndTimer = null;
    }
    if (this.postDeliveryResetTimer) {
      clearTimeout(this.postDeliveryResetTimer);
      this.postDeliveryResetTimer = null;
    }

    const wasActive = this.isReplaying || Boolean(this.activeReplayHighlight);
    this.isReplaying = false;
    this.activeReplayHighlight = null;

    const replayBadge = document.getElementById('hud-replay-badge');
    if (replayBadge) replayBadge.classList.add('hidden');

    this.cameraMode = this.savedCameraMode;
    this._snapCameraNextFrame = true;
    this.resetBallAndFielders();

    if (wasActive) {
      this.ui.setCommentary(
        'Replay skipped — ready for the next delivery!',
        'रीप्ले स्किप किया गया — अगली गेंद के लिए तैयार!'
      );
    }
  }

  setupNetworkCallbacks() {
    // Pairing Screen Auto-Close & Connection Status Toast
    this.net.callbacks.onControllerStatus = (controllers) => {
      const p1 = controllers?.p1;
      if (p1) {
        this.ui.handleControllerConnectionChange(p1.connected, p1.latencyMs);
      }
      window.__middledMenu?.refreshVenue?.();
    };

    this.net.callbacks.onSensorData = (packet, slot) => {
      if (packet && typeof packet.rtt === 'number') {
        window.networkLatencyMs = Math.round(packet.rtt);
      }
      if (this.match.userRole === 'bat' || slot === 'p1') {
        // Bug #1 Fix: Allow phone swing detection during 'bowled' and 'runup' (NOT during 'idle' 3.2s countdown so tilting phone left/right never skips the breather!)
        const canSwingNow =
          this.physics.state === 'bowled' ||
          this.physics.state === 'runup';
        this.batting.ingestSensorPacket(packet, 0.014, {
          canSwing: canSwingNow,
          onCalibrationComplete: () => {
            this.net.vibratePhone(slot, [80, 50, 120]);
            this.ui.closeModal('modal-calibrate');
            this.ui.showToast('Phone calibrated · 0° forward set straight down the ground', 'success');
            this.ui.showEventBanner('PHONE CALIBRATED!', '0° Forward set straight over bowler. Full 360° shots ready!', 'text-emerald-400');
          },
          onSwingPeak: (swingInfo) => {
            if (this.isReplaying || this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;
            const previewShotKey =
              swingInfo?.shotType?.shotKey ||
              this.batting.activeShotType?.shotKey ||
              (this.batting.shotMode === 'fly' ? 'lofted_six' : 'straight_drive');

            if (this.physics.state === 'bowled') {
              this.triggerStrikerMocapShot(previewShotKey, {
                isSweet: true,
                isOnFire: typeof this.batting.isOnFire === 'function' && this.batting.isOnFire()
              });
              this.checkAndExecuteBattingContact();
            } else if (this.physics.state === 'runup' && this.match.userRole === 'bat') {
              // Smoothly accelerate bowler run-up without teleporting and arm swing for release contact
              this.bowling.runupFastForward = true;
              this.batting.manualSwingArmed = true;
              this.triggerStrikerMocapShot(previewShotKey, {
                isSweet: true,
                isOnFire: typeof this.batting.isOnFire === 'function' && this.batting.isOnFire()
              });
              this.batting.swingDispatched = false;
            }
          },
          onStepDetected: () => {
            // Running is strictly button/key-driven (RUN button on Phone/Screen or R/Space on Keyboard)
            // so post-swing hand movement NEVER accidentally triggers a run!
          },
          onQuickFlick: () => {
            if (this.isReplaying || this.pendingReplayStartTimer) {
              this.skipReplay();
              return;
            }
            if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
              this.triggerExtraRun();
            }
          },
          onCreaseTap: () => {
            if (this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;
            if (this.physics.state === 'idle' || this.physics.state === 'runup') {
              sound.playPitchBounce('normal', 68, 0);
              this.net.vibratePhone(slot, [18]);
              this.spawnDustPuff(new THREE.Vector3(this.batting.creaseX, 0.03, CREASE_Z + 0.18), 0.18);
            }
          }
        });
        const nowDomMs = performance.now();
        if (typeof this.ui?.updateCreaseIndicatorUI === 'function' && nowDomMs - (this._lastCreaseDomMs || 0) >= 50) {
          this._lastCreaseDomMs = nowDomMs;
          this.ui.updateCreaseIndicatorUI();
          if (this.batting.hasHardwareStance && !this.batting.wheelAimLockedThisBall) {
            this.ui.syncAngleWheelUI?.();
          }
        }
      }

      if (this.match.userRole === 'bowl' || (this.match.matchType === 'local1v1' && slot === 'p2')) {
        this.bowling.ingestBowlingSensor(packet, 0.014, (delivery) => {
          if (!this.isReplaying) {
            this.releaseBowledBall(delivery);
          }
        });
      }

      if (this.batting.isCalibrating) {
        const bar = document.getElementById('calib-progress-bar');
        if (bar) bar.style.width = `${Math.round(this.batting.calibProgress * 100)}%`;
      }
    };

    this.net.callbacks.onShotModeChange = (mode) => {
      this.selectShotMode(mode);
    };

    this.net.callbacks.onCalibrateStart = () => {
      this.startCalibrationFlow();
    };

    this.net.callbacks.onCalibrateZero = (slot) => {
      if (this.batting) {
        this.batting.instantZeroStance();
        this.ui.syncAngleWheelUI?.();
        this.ui.syncPhoneMatchHUD?.();
        this.net.vibratePhone(slot || 'p1', [35, 25, 55]);
        this.ui.showToast('🎯 Bat Grip Zeroed! Point/swing in any 360° direction!', 'success');
      }
    };

    this.net.callbacks.onRunupHold = (isHeld) => {
      if (this.isReplaying) {
        this.skipReplay();
        return;
      }
      this.bowling.setRunupButtonState(isHeld);
      if (isHeld && this.physics.state === 'idle') {
        this.physics.state = 'runup';
        if (this.bowlerPlayer) this.bowlerPlayer.playClip('bowling_runup', 0.15, 1.25);
        this.ui.setCommentary(
          'Bowler charging in from phone run-up... Swing overarm or release to bowl!',
          'गेंदबाज रन-अप पर... गेंद छोड़ने के लिए फ़ोन को ऊपर से घुमाएं!'
        );
      } else if (!isHeld && this.physics.state === 'runup' && this.match.userRole === 'bowl') {
        // Releasing the Hold Run-Up button during run-up also delivers the ball with timed pace!
        const timingQuality = 1 - Math.min(1, Math.abs(0.86 - this.bowling.runupProgress) * 2.1);
        const paceFactor = 0.80 + timingQuality * 0.24;
        const manualDelivery = this.bowling.triggerManualDelivery(paceFactor);
        this.releaseBowledBall(manualDelivery);
      }
    };

    this.net.callbacks.onRunHold = (isHeld) => {
      this.setRunButtonHeld(isHeld);
    };

    this.net.callbacks.onTurnBack = () => {
      this.turnBackRunner();
    };

    this.net.callbacks.onBowlerTypeChange = (bType) => {
      this.setBowlerType(bType);
      const sel = document.getElementById('select-bowler-type');
      if (sel) sel.value = bType;
    };

    this.net.callbacks.onQuickFlick = () => {
      if (this.isReplaying || this.pendingReplayStartTimer) {
        this.skipReplay();
        return;
      }
      this.triggerExtraRun();
    };

    this.net.callbacks.onTouchSwipe = (msg) => {
      if (this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;
      if (this.isReplaying || this.pendingReplayStartTimer) {
        this.skipReplay();
        return;
      }
      const dirSign = this.batting.screenRightSign || -1;
      if (this.match.userRole === 'bowl') {
        if (typeof msg.dirX === 'number' && !msg.isTap) {
          this.bowling.aimTargetX = THREE.MathUtils.clamp((msg.dirX || 0) * 0.42 * dirSign, -0.75, 0.75);
          this.aimRing.position.x = this.bowling.aimTargetX;
        }
        if (this.physics.state === 'idle') {
          this.startNextDelivery();
        } else if (this.physics.state === 'runup') {
          const normSpd = THREE.MathUtils.clamp(((msg.speedDeg || 420) - 240) / 340, 0.78, 1.04);
          const manualDelivery = this.bowling.triggerManualDelivery(normSpd);
          this.releaseBowledBall(manualDelivery);
        }
        return;
      }
      if (msg.isTap) {
        if (this.physics.state === 'idle') {
          this.startNextDelivery();
        }
        return;
      }
      if (this.physics.state === 'idle') {
        this.startNextDelivery();
      }
      this.batting.triggerManualSwing({
        speedDeg: msg.speedDeg || 450,
        dirX: (msg.dirX || 0) * dirSign,
        shotAngleDeg: typeof msg.shotAngleDeg === 'number' ? msg.shotAngleDeg * dirSign : undefined,
        planePitchDeg: typeof msg.planePitchDeg === 'number' ? msg.planePitchDeg : (this.batting.shotMode === 'fly' ? 28 : 4)
      });
      this.checkAndExecuteBattingContact();
    };

    this.net.callbacks.onCreaseStep = (msg) => {
      const dir = Number(msg.dir) < 0 ? -1 : 1;
      const held = Boolean(msg.held);
      if (this.match.userRole === 'bowl') {
        if (held) {
          const dirSign = this.batting.screenRightSign || -1;
          this.bowling.aimTargetX = THREE.MathUtils.clamp(
            (this.bowling.aimTargetX || 0) + dir * 0.11 * dirSign,
            -0.78,
            0.78
          );
          this.aimRing.position.x = this.bowling.aimTargetX;
          this.aimRing.visible = true;
        }
        return;
      }
      if (dir < 0) {
        this.batting.keys.left = held;
      } else {
        this.batting.keys.right = held;
      }
      if (held) {
        this.stepBatsmanCrease(dir);
      }
    };

    // Bug #6 Fix: Live 360° Angle Wheel sync from Phone Controller
    this.net.callbacks.onWheelAim = (msg) => {
      if (typeof msg.deg === 'number') {
        if (this.match.userRole === 'bowl') {
          const dirSign = this.batting.screenRightSign || -1;
          const rad = THREE.MathUtils.degToRad(msg.deg);
          this.bowling.aimTargetX = THREE.MathUtils.clamp(Math.sin(rad) * 0.45 * dirSign, -0.75, 0.75);
          this.aimRing.position.x = this.bowling.aimTargetX;
          this.aimRing.visible = true;
          return;
        }
        this.batting.setWheelAimDeg(msg.deg);
        if (typeof this.ui?.syncAngleWheelUI === 'function') {
          this.ui.syncAngleWheelUI();
        }
        if (typeof this.ui?.syncPhoneMatchHUD === 'function') {
          this.ui.syncPhoneMatchHUD();
        }
      }
    };

    // Bug #7 Fix: Handle DRS Review, Catch QTE, Modal Continue, Shot Buttons & Bowling Length Presets directly from Phone Controller
    this.net.callbacks.onPhoneAction = (msg) => {
      sound.init();
      const act = msg?.action;
      if (!act) return;

      if (act === 'drs_review') {
        this.triggerDRSReview();
        return;
      }
      if (act === 'catch_qte') {
        if (this.qteActive) {
          this.triggerFieldingReflexQTE();
        }
        return;
      }
      if (act === 'bowl_yorker' || act === 'bowl_good' || act === 'bowl_bouncer' || act === 'bowl_slower') {
        const isSpin = this.bowling.bowlerType === 'spin';
        if (act === 'bowl_yorker') {
          this.bowling.aimBounceZ = 8.2;
          this.bowling.setVariation(isSpin ? 'quicker_one' : 'yorker');
          this.setAimRingColor(0x38bdf8);
        } else if (act === 'bowl_good') {
          this.bowling.aimBounceZ = 4.6;
          this.bowling.setVariation(isSpin ? 'off_break' : 'outswinger');
          this.setAimRingColor(0xf59e0b);
        } else if (act === 'bowl_bouncer') {
          this.bowling.aimBounceZ = 1.45;
          this.bowling.setVariation(isSpin ? 'top_spinner' : 'bouncer');
          this.setAimRingColor(0xef4444);
        } else if (act === 'bowl_slower') {
          this.bowling.aimBounceZ = 5.3;
          this.bowling.setVariation(isSpin ? 'wrong_un' : 'slower_ball');
          this.setAimRingColor(0x10b981);
        }
        this.aimRing.position.set(this.bowling.aimTargetX, 0.035, this.bowling.aimBounceZ);
        this.aimRing.visible = true;
        return;
      }
      if (act === 'modal_continue') {
        // Dismiss or auto-confirm whichever modal/popup is currently blocking TV gameplay
        const wagonPopup = document.getElementById('hud-over-wagon-popup');
        if (wagonPopup && !wagonPopup.classList.contains('hidden')) {
          this.ui.hideOverWagonWheelPopup?.();
          return;
        }
        const squadModal = document.getElementById('modal-squad-select');
        if (squadModal && !squadModal.classList.contains('hidden')) {
          const autoBtn = document.getElementById('btn-squad-auto');
          if (autoBtn) {
            autoBtn.click();
          } else {
            this.ui.closeModal('modal-squad-select');
          }
          return;
        }
        const mdHome = document.getElementById('md-home');
        if (mdHome && !mdHome.classList.contains('md-hidden')) {
          window.__middledMenu?.hide?.();
          this.startConfiguredMatchFromUI(true);
          this.confirmPlayAndStartMatch();
          return;
        }
        const qrModal = document.getElementById('modal-qr');
        if (qrModal && !qrModal.classList.contains('hidden')) {
          this.confirmPlayAndStartMatch();
          return;
        }
        const scorecardModal = document.getElementById('modal-scorecard');
        if (scorecardModal && !scorecardModal.classList.contains('hidden')) {
          if (this.match.isMatchOver) {
            this.triggerInstantRematch();
          } else {
            this.ui.closeModal('modal-scorecard');
          }
          return;
        }
        if (this.isReplaying || this.pendingReplayStartTimer) {
          this.skipReplay();
          return;
        }
        return;
      }

      // Direct shot buttons from Phone Controller ('defend_shot', 'push_shot', 'stroke_shot', 'loft_shot', 'bowl_or_swing')
      if (
        typeof msg.aimDeg === 'number' &&
        this.match.userRole === 'bat' &&
        (msg.wheelExplicit || !this.batting.hasHardwareStance)
      ) {
        this.batting.setWheelAimDeg(msg.aimDeg, Boolean(msg.wheelExplicit));
        this.ui.syncAngleWheelUI?.();
      }
      this.triggerActionFromUI(act);
    };

    this.net.callbacks.onPauseChange = (paused, remainingSec) => {
      const overlay = document.getElementById('pause-reconnect-banner');
      const secEl = document.getElementById('pause-reconnect-sec');
      if (overlay) overlay.classList.toggle('hidden', !paused);
      if (secEl) secEl.textContent = `${remainingSec}s`;
    };

    this.net.callbacks.onStartOrRematch = () => {
      sound.init();
      if (!this.matchPlayConfirmed) {
        this.confirmPlayAndStartMatch();
      } else if (this.match.isMatchOver) {
        this.triggerInstantRematch();
      }
    };

    // Online 1v1 Multiplayer Synchronization Callbacks
    this.net.callbacks.onOnlinePeerJoin = () => {
      this.onlinePeerConnected = true;
      this.ui?.syncOnline1v1ModalUI?.();
      this.ui?.showStatusToast?.('🟢 Online 1v1 Opponent Connected!', true);
    };

    this.net.callbacks.onOnlinePeerDisconnect = () => {
      this.onlinePeerConnected = false;
      this.ui?.syncOnline1v1ModalUI?.();
      this.ui?.showStatusToast?.('⚠️ Online Opponent Disconnected', false);
    };

    this.net.callbacks.onOnlineBowlAim = (msg) => {
      if (this.match.userRole === 'bat') {
        if (typeof msg.targetX === 'number') this.bowling.aimTargetX = msg.targetX;
        if (typeof msg.bounceZ === 'number') this.bowling.aimBounceZ = msg.bounceZ;
        if (msg.bowlerType) this.setBowlerType(msg.bowlerType);
        if (msg.variationId) this.bowling.setVariation(msg.variationId);
        if (msg.bowlerSide) this.bowling.bowlerSide = msg.bowlerSide;
        this.aimRing.position.set(this.bowling.aimTargetX, 0.035, this.bowling.aimBounceZ);
      }
    };

    this.net.callbacks.onOnlineBowlRelease = (msg) => {
      if (this.match.userRole === 'bat' && msg.delivery) {
        this.pendingAIDelivery = msg.delivery;
        if (this.physics.state === 'idle') {
          this.startNextDelivery();
        } else if (this.physics.state === 'runup') {
          this.releaseBowledBall(msg.delivery);
        }
      }
    };

    this.net.callbacks.onOnlineBatShot = (msg) => {
      if (this.match.userRole === 'bowl' && this.physics.state === 'bowled') {
        this.batting.triggerManualSwing({
          speedDeg: msg.speedDeg || 480,
          dirX: msg.dirX || 0,
          shotAngleDeg: msg.shotAngleDeg,
          planePitchDeg: msg.planePitchDeg
        });
        this.checkAndExecuteBattingContact();
      }
    };

    this.net.callbacks.onOnlineRunAction = (msg) => {
      if (msg.action === 'run' || msg.action === 'extra_run') {
        this.triggerExtraRun(true);
      } else if (msg.action === 'turn_back') {
        this.turnBackRunner(true);
      }
    };
  }

  setupInputListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

      // Allow Smart TV Remote OK (Enter) or Space to confirm the Ready-to-Play QR Gate popup!
      const qrModal = document.getElementById('modal-qr');
      if (qrModal && !qrModal.classList.contains('hidden')) {
        if (
          (e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter' || e.code === 'Space') &&
          (!e.target || e.target.tagName !== 'BUTTON' || e.target.id === 'btn-qr-play-now')
        ) {
          e.preventDefault();
          this.confirmPlayAndStartMatch();
          return;
        }
      }

      // Allow Smart TV Remote OK (Enter) on the Match Over Scorecard screen to trigger Instant Rematch!
      const scModal = document.getElementById('modal-scorecard');
      if (scModal && !scModal.classList.contains('hidden') && this.match.isMatchOver) {
        if (
          (e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter') &&
          (!e.target || e.target.tagName !== 'BUTTON' || e.target.id === 'btn-scorecard-rematch')
        ) {
          e.preventDefault();
          this.triggerInstantRematch();
          return;
        }
      }

      // Pause gameplay keyboard controls while the user has the Corner Menu or any Modal open
      if (this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;

      const code = e.code;

      // Key 'S' skips replay when a replay is active or pending
      if (code === 'KeyS' && (this.isReplaying || this.pendingReplayStartTimer)) {
        e.preventDefault();
        this.skipReplay();
        return;
      }

      const dirSign = this.batting.screenRightSign || -1;
      if (!this._arrowAimState) {
        this._arrowAimState = { left: false, right: false, up: false, down: false };
      }

      const syncArrowAimToWheel = () => {
        const s = this._arrowAimState;
        const ax = (s.right ? 1 : 0) - (s.left ? 1 : 0); // +1 Off/Right, -1 Leg/Left
        const ay = (s.up ? 1 : 0) - (s.down ? 1 : 0);   // +1 Forward, -1 Behind
        if (ax === 0 && ay === 0) return;
        let worldYawDeg = Math.round(THREE.MathUtils.radToDeg(Math.atan2(ax, ay)));
        if (ax === 0 && ay < 0) worldYawDeg = 176; // Behind keeper scoop/ramp/glance
        const wheelDeg = Math.round(worldYawDeg * dirSign);
        this.batting.setWheelAimDeg(wheelDeg, true);
        if (typeof this.ui?.syncAngleWheelUI === 'function') {
          this.ui.syncAngleWheelUI();
        }
      };

      const executeKeyboardBatSwing = (resolvedMode) => {
        syncArrowAimToWheel();
        if (resolvedMode && !this.batting.modeLocked && this.batting.shotMode !== resolvedMode) {
          this.selectShotMode(resolvedMode);
        }
        const effectiveMode = resolvedMode || this.batting.shotMode;
        const isDefend = effectiveMode === 'defend';
        const wheelDeg = typeof this.batting.custom360AimDeg === 'number' ? this.batting.custom360AimDeg : 0;
        const shotAngleDeg = wheelDeg * dirSign;
        const worldAimX = Math.sin(THREE.MathUtils.degToRad(shotAngleDeg));
        const planePitchDeg = effectiveMode === 'fly' ? 30 : isDefend ? 2 : 4;
        const speedDeg = effectiveMode === 'fly' ? 515 : isDefend ? 150 : 465;

        if (this.physics.state === 'runup') {
          // Pressing swing during bowler run-up fast-forwards run-up ONLY — you must time your swing on the actual ball!
          this.bowling.runupFastForward = true;
          return;
        }

        if (this.physics.state === 'bowled') {
          this.batting.triggerManualSwing({
            speedDeg,
            dirX: worldAimX,
            shotAngleDeg,
            planePitchDeg,
            isDefensive: isDefend
          });
          const previewShotKey = isDefend
            ? 'defence'
            : this.batting.activeShotType?.shotKey || (effectiveMode === 'fly' ? 'lofted_six' : 'straight_drive');
          this.triggerStrikerMocapShot(previewShotKey, {
            isSweet: !isDefend,
            isOnFire: typeof this.batting.isOnFire === 'function' && this.batting.isOnFire()
          });
          this.checkAndExecuteBattingContact();
        }
      };

      if (code === 'ArrowLeft') {
        if (this.match.userRole === 'bowl') {
          this.bowling.aimTargetX = THREE.MathUtils.clamp(this.bowling.aimTargetX - 0.08 * dirSign, -0.85, 0.85);
        } else {
          this._arrowAimState.left = true;
          syncArrowAimToWheel();
        }
      } else if (code === 'ArrowRight') {
        if (this.match.userRole === 'bowl') {
          this.bowling.aimTargetX = THREE.MathUtils.clamp(this.bowling.aimTargetX + 0.08 * dirSign, -0.85, 0.85);
        } else {
          this._arrowAimState.right = true;
          syncArrowAimToWheel();
        }
      } else if (code === 'ArrowUp') {
        if (this.match.userRole === 'bowl') {
          this.bowling.aimBounceZ = Math.min(8.6, this.bowling.aimBounceZ + 0.45);
        } else {
          this._arrowAimState.up = true;
          syncArrowAimToWheel();
        }
      } else if (code === 'ArrowDown') {
        if (this.match.userRole === 'bowl') {
          this.bowling.aimBounceZ = Math.max(0.5, this.bowling.aimBounceZ - 0.45);
        } else if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
          e.preventDefault();
          this.turnBackRunner();
        } else {
          this._arrowAimState.down = true;
          syncArrowAimToWheel();
        }
      } else if (code === 'KeyA') {
        this.batting.keys.left = true;
        if (this.match.userRole === 'bowl') {
          this.bowling.aimTargetX = THREE.MathUtils.clamp(
            this.bowling.aimTargetX - 0.08 * dirSign,
            -0.85,
            0.85
          );
        }
      } else if (code === 'KeyD') {
        this.batting.keys.right = true;
        if (this.match.userRole === 'bowl') {
          this.bowling.aimTargetX = THREE.MathUtils.clamp(
            this.bowling.aimTargetX + 0.08 * dirSign,
            -0.85,
            0.85
          );
        }
      } else if (code === 'KeyW') {
        this.batting.keys.up = true;
        if (this.match.userRole === 'bowl') {
          this.bowling.aimBounceZ = Math.min(8.6, this.bowling.aimBounceZ + 0.45);
        } else if (!this.batting.modeLocked && this.batting.shotMode !== 'fly') {
          this.selectShotMode('fly');
        }
      } else if (code === 'KeyS') {
        if (this.match.userRole === 'bowl') {
          this.batting.keys.down = true;
          this.bowling.aimBounceZ = Math.max(0.5, this.bowling.aimBounceZ - 0.45);
        } else if (this.physics.state === 'bowled' || this.physics.state === 'runup') {
          // Video-style controls: S + Arrows = Ground shot, Shift + S + Arrows = Lofted/Attack shot
          e.preventDefault();
          sound.init();
          executeKeyboardBatSwing(e.shiftKey ? 'fly' : 'ground');
        } else if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
          this.triggerExtraRun();
        } else {
          this.batting.keys.down = true;
          if (!this.batting.modeLocked) {
            this.selectShotMode(e.shiftKey ? 'fly' : 'ground');
          }
        }
      } else if (code === 'KeyG') {
        this.selectShotMode('ground');
      } else if (code === 'KeyF' || code === 'KeyL') {
        this.selectShotMode('fly');
      } else if (code === 'KeyB') {
        this.selectShotMode('defend');
      } else if (
        code === 'KeyX' ||
        code === 'KeyM' ||
        code === 'PageUp' ||
        code === 'ChannelUp' ||
        e.key === 'ChannelUp' ||
        e.key === 'MediaPlayPause'
      ) {
        // 1-Button TV Remote / Keyboard Shot Mode Cycle: GROUND → LOFT → DEFEND
        const order = ['ground', 'fly', 'defend'];
        const curIdx = order.indexOf(this.batting.shotMode);
        const nextMode = order[(curIdx + 1) % order.length];
        this.selectShotMode(nextMode);
        const modeToast =
          nextMode === 'fly'
            ? '🔥 SHOT MODE: LOFT (HIGH RISK / SIXES)'
            : nextMode === 'defend'
              ? '🛡️ SHOT MODE: DEFEND (SAFE BLOCK)'
              : '🏏 SHOT MODE: GROUND (CRISP DRIVES)';
        this.ui.showStatusToast(modeToast, false);
      } else if (code === 'KeyH') {
        this.ui.toggleDock();
      } else if (code === 'KeyC') {
        const modes = ['broadcast', 'pro', 'overhead'];
        const next = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length];
        this.setCameraMode(next);
      } else if (code === 'KeyR') {
        this.triggerExtraRun();
      } else if (code === 'KeyN') {
        this.turnBackRunner();
      } else if (code === 'KeyT') {
        if (this.lastDRSCandidate && !this.drsActive) {
          this.triggerDRSReview();
        } else {
          this.turnBackRunner();
        }
      } else if (code === 'KeyV') {
        this.toggleBowlerSide();
      } else if (
        code === 'Space' ||
        code === 'Enter' ||
        code === 'NumpadEnter' ||
        e.key === 'Enter' ||
        e.key === 'Select' ||
        e.keyCode === 23
      ) {
        e.preventDefault();
        sound.init();
        if (this.isReplaying || this.pendingReplayStartTimer) {
          this.skipReplay();
          return;
        }
        if (this.physics.state === 'idle' || (this.physics.state === 'dead' && !this.drsActive)) {
          if (e.shiftKey) this.selectShotMode('fly');
          this.startNextDelivery();
        } else if (this.physics.state === 'runup') {
          if (this.match.userRole === 'bowl') {
            // Timed manual release during bowling run-up: closer to crease = faster pace!
            const timingQuality = 1 - Math.min(1, Math.abs(0.92 - this.bowling.runupProgress) * 2.2);
            const paceFactor = 0.78 + timingQuality * 0.22;
            const manualDelivery = this.bowling.triggerManualDelivery(paceFactor);
            this.releaseBowledBall(manualDelivery);
          } else {
            executeKeyboardBatSwing(e.shiftKey ? 'fly' : this.batting.shotMode);
          }
        } else if (this.physics.state === 'bowled') {
          executeKeyboardBatSwing(e.shiftKey ? 'fly' : this.batting.shotMode);
        } else if (this.qteActive) {
          this.triggerFieldingReflexQTE();
        } else if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
          this.triggerExtraRun();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      if (this._arrowAimState) {
        if (code === 'ArrowLeft') this._arrowAimState.left = false;
        if (code === 'ArrowRight') this._arrowAimState.right = false;
        if (code === 'ArrowUp') this._arrowAimState.up = false;
        if (code === 'ArrowDown') this._arrowAimState.down = false;
      }
      if (code === 'ArrowLeft' || code === 'KeyA') this.batting.keys.left = false;
      if (code === 'ArrowRight' || code === 'KeyD') this.batting.keys.right = false;
      if (code === 'ArrowUp' || code === 'KeyW') this.batting.keys.up = false;
      if (code === 'ArrowDown' || code === 'KeyS') this.batting.keys.down = false;
      if (code === 'KeyR') this.setRunButtonHeld(false);
    });

    const dom = this.renderer.domElement;
    dom.style.touchAction = 'none';

    const isInteractiveHUDTarget = (target) => {
      if (!target || typeof target.closest !== 'function') return false;
      return Boolean(
        target.closest(
          'button, a, input, select, textarea, label, #hud-angle-wheel, #btn-corner-menu, #hud-corner-drawer, .modal-backdrop, [data-action]'
        )
      );
    };

    const startCanvasCreaseDrag = (e) => {
      if (this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;
      if (isInteractiveHUDTarget(e.target)) return;
      sound.init();
      // Claim pointer for crease drag (if no active drag or if previous pointer is stale)
      if (this.creaseDragPointerId === null || this.creaseDragPointerId === undefined || e.pointerType === 'mouse') {
        this.creaseDragPointerId = e.pointerId;
        this.pointerDownPos = { x: e.clientX, y: e.clientY };
        this.pointerDownTime = performance.now();
        this.creaseDragStartX = e.clientX;
        this.creaseDragStartY = e.clientY;
        this.creaseDragInitialX = this.batting.manualCreaseOffsetX ?? this.batting.creaseX ?? 0;
        this.bowlDragInitialX = this.bowling.aimTargetX || 0;
        this.bowlDragInitialZ = this.bowling.aimBounceZ || 4.5;
        if (e.target === dom) {
          try {
            dom.setPointerCapture(e.pointerId);
          } catch {}
        }
      }
    };

    const moveCanvasCreaseDrag = (e) => {
      if (
        this.creaseDragPointerId === null ||
        this.creaseDragPointerId === undefined ||
        this.creaseDragPointerId !== e.pointerId ||
        !this.pointerDownPos
      ) {
        return;
      }
      if (this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;

      const dx = e.clientX - this.creaseDragStartX;
      const dy = e.clientY - (this.creaseDragStartY ?? this.pointerDownPos.y);
      const dirSign = this.batting.screenRightSign || 1;

      // Feature 2: Interactive Bowling Controls — Touch-Drag 3D Pitch Bullseye when User is Bowling!
      if (this.match.userRole === 'bowl' && (this.physics.state === 'idle' || this.physics.state === 'runup')) {
        if (Math.hypot(dx, dy) > 3) {
          const deltaX = (dx / Math.max(200, window.innerWidth * 0.28)) * 0.95 * dirSign;
          const deltaZ = (dy / Math.max(200, window.innerHeight * 0.28)) * 7.5 * -dirSign;
          this.bowling.aimTargetX = THREE.MathUtils.clamp(this.bowlDragInitialX + deltaX, -0.78, 0.78);
          this.bowling.aimBounceZ = THREE.MathUtils.clamp(this.bowlDragInitialZ + deltaZ, 0.8, 8.5);
          this.aimRing.position.set(this.bowling.aimTargetX, 0.035, this.bowling.aimBounceZ);
          this.aimRing.visible = true;
          const lenColor =
            this.bowling.aimBounceZ >= 7.6
              ? 0x38bdf8
              : this.bowling.aimBounceZ >= 5.5
                ? 0x10b981
                : this.bowling.aimBounceZ < 2.4
                  ? 0xef4444
                  : 0xf59e0b;
          this.setAimRingColor(lenColor);
          if (typeof this.ui?.syncAngleWheelUI === 'function') {
            this.ui.syncAngleWheelUI();
          }
          if (this.match.matchType === 'online1v1') {
            this.net.send({
              type: 'online_bowl_aim',
              targetX: this.bowling.aimTargetX,
              bounceZ: this.bowling.aimBounceZ,
              bowlerType: this.bowling.bowlerType,
              variationId: this.bowling.selectedVariationId,
              bowlerSide: this.bowling.bowlerSide
            });
          }
        }
        return;
      }

      if (this.match.userRole !== 'bat') return;

      if (Math.abs(dx) > 1.0) {
        // Smooth 1:1 touch-drag on 3D screen slides batsman Left/Right in the crease (-0.62m to +0.62m) with zero deadzone jump
        const effectiveDx = dx - Math.sign(dx) * 1.0;
        const dragSpanPx = Math.max(135, Math.min(250, window.innerWidth * 0.22));
        const worldDeltaX = (effectiveDx / dragSpanPx) * 1.15 * dirSign;
        const nextCreaseX = THREE.MathUtils.clamp(this.creaseDragInitialX + worldDeltaX, -0.62, 0.62);
        this.batting.manualCreaseOverrideThisBall = true;
        this.batting.manualCreaseOffsetX = THREE.MathUtils.clamp(
          nextCreaseX - (this.batting.sensorCreaseOffsetX || 0),
          -0.62,
          0.62
        );
        this.batting.creaseX = nextCreaseX;
        if (typeof this.ui?.updateCreaseIndicatorUI === 'function') {
          this.ui.updateCreaseIndicatorUI();
        }
      }
    };

    const endCanvasCreaseDrag = (e) => {
      if (
        this.creaseDragPointerId === null ||
        this.creaseDragPointerId === undefined ||
        (e && e.pointerId !== undefined && e.pointerId !== this.creaseDragPointerId)
      ) {
        return;
      }
      const downPos = this.pointerDownPos;
      this.pointerDownPos = null;
      this.creaseDragPointerId = null;
      try {
        if (e && e.pointerId !== undefined && dom.hasPointerCapture(e.pointerId)) {
          dom.releasePointerCapture(e.pointerId);
        }
      } catch {}
      if (!downPos || !e) return;

      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      const distPx = Math.hypot(dx, dy);

      if (this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;
      // Do not prematurely skip boundary celebration on accidental screen touch
      if (performance.now() < (this.boundaryCelebrationUntil || 0)) return;
      if (this.isReplaying || this.pendingReplayStartTimer) {
        this.skipReplay();
        return;
      }

      // Single quick tap inside the central pitch play zone (away from bottom control pads) starts next delivery when idle
      const tapInSafePlayArea =
        e.clientX > window.innerWidth * 0.22 &&
        e.clientX < window.innerWidth * 0.78 &&
        e.clientY > 56 &&
        e.clientY < window.innerHeight * 0.70;
      if (
        distPx < 10 &&
        tapInSafePlayArea &&
        (this.physics.state === 'idle' || (this.physics.state === 'dead' && !this.drsActive))
      ) {
        this.startNextDelivery();
      }
    };

    window.addEventListener('pointerdown', startCanvasCreaseDrag, { passive: true });
    window.addEventListener('pointermove', moveCanvasCreaseDrag, { passive: true });
    window.addEventListener('pointerup', endCanvasCreaseDrag, { passive: true });
    window.addEventListener('pointercancel', endCanvasCreaseDrag, { passive: true });
    window.addEventListener('blur', () => {
      this.pointerDownPos = null;
      this.creaseDragPointerId = null;
    });
  }

  triggerActionFromUI(action) {
    sound.init();
    if (action === 'skip_replay') {
      this.boundaryCelebrationUntil = 0;
      this.skipReplay();
      return;
    }
    if (action === 'drs_review') {
      this.triggerDRSReview();
      return;
    }
    // Protect SIX & FOUR boundary celebration from accidental button taps for 2.6s
    if (performance.now() < (this.boundaryCelebrationUntil || 0)) {
      return;
    }
    if (this.isReplaying || this.pendingReplayStartTimer) {
      this.skipReplay();
      return;
    }

    const executeAimedShot = (mode, speedDeg, planePitchDeg, isDefensive = false) => {
      if (mode) {
        this.batting.setShotMode(mode, true);
        this.net.syncShotModeLock(this.batting.shotMode, this.batting.modeLocked);
        this.ui.updateShotModeHUD();
      }
      if (this.physics.state === 'idle' || (this.physics.state === 'dead' && !this.drsActive)) {
        this.matchPlayConfirmed = true;
        this.startNextDelivery();
        return;
      }
      const dirSign = this.batting.screenRightSign || -1;
      const wheelDeg = typeof this.batting.custom360AimDeg === 'number' ? this.batting.custom360AimDeg : 0;
      const shotAngleDeg = wheelDeg * dirSign;
      const worldAimX = Math.sin(THREE.MathUtils.degToRad(shotAngleDeg));
      const previewShotKey = isDefensive
        ? 'defence'
        : this.batting.activeShotType?.shotKey || (mode === 'fly' ? 'lofted_six' : 'straight_drive');

      if (this.physics.state === 'runup') {
        this.bowling.runupFastForward = true;
        // Always arm the manual swing when pressed during runup so the shot never drops!
        this.batting.triggerManualSwing({
          speedDeg,
          dirX: worldAimX,
          shotAngleDeg: isDefensive ? 0 : shotAngleDeg,
          planePitchDeg,
          isDefensive
        });
        // Play visible 3D bat swing animation whenever the user presses a shot button
        this.triggerStrikerMocapShot(previewShotKey, {
          isSweet: true,
          isOnFire: typeof this.batting.isOnFire === 'function' && this.batting.isOnFire()
        });
        return;
      }
      if (this.physics.state === 'bowled') {
        this.batting.triggerManualSwing({
          speedDeg,
          dirX: worldAimX,
          shotAngleDeg: isDefensive ? 0 : shotAngleDeg,
          planePitchDeg,
          isDefensive
        });
        // Play visible 3D bat swing animation immediately so the batter responds to the tap
        this.triggerStrikerMocapShot(previewShotKey, {
          isSweet: true,
          isOnFire: typeof this.batting.isOnFire === 'function' && this.batting.isOnFire()
        });
        this.checkAndExecuteBattingContact();
      }
    };

    if (action === 'bowl_or_swing') {
      if (this.match.userRole === 'bowl') {
        if (this.physics.state === 'idle') {
          this.startNextDelivery();
        } else if (this.physics.state === 'runup') {
          const timingQuality = 1 - Math.min(1, Math.abs(0.86 - this.bowling.runupProgress) * 2.1);
          const paceFactor = 0.80 + timingQuality * 0.24;
          const manualDelivery = this.bowling.triggerManualDelivery(paceFactor);
          const timingGrade =
            timingQuality >= 0.82 ? '🔥 PERFECT RELEASE' : timingQuality >= 0.55 ? '⚡ GOOD RELEASE' : '⚠️ LATE RELEASE';
          this.ui.showStatusToast(`${timingGrade} · ${Math.round(manualDelivery.speedKmh)} km/h`, timingQuality >= 0.7);
          this.releaseBowledBall(manualDelivery);
        }
        return;
      }
      const isLoft = this.batting.shotMode === 'fly';
      executeAimedShot(null, isLoft ? 510 : 465, isLoft ? 30 : 4, false);
    } else if (action === 'stroke_shot') {
      executeAimedShot('ground', 465, 4, false);
    } else if (action === 'loft_shot') {
      executeAimedShot('fly', 520, 32, false);
    } else if (action === 'push_shot') {
      executeAimedShot('ground', 295, 3, false);
    } else if (action === 'defend_shot') {
      executeAimedShot('ground', 150, 2, true);
    } else if (action === 'take_extra_run') {
      this.triggerExtraRun();
    } else if (action === 'turn_back') {
      this.turnBackRunner();
    } else if (action === 'toggle_step_out') {
      this.toggleBatsmanStepOut();
    }
  }

  toggleBatsmanStepOut(forceState = null) {
    if (this.match.userRole === 'bowl') return false;
    const isSteppingOut = this.batting.toggleStepOutCharge(forceState);
    if (typeof this.ui?.updateCreaseIndicatorUI === 'function') {
      this.ui.updateCreaseIndicatorUI();
    }
    if (typeof this.ui?.syncPhoneMatchHUD === 'function') {
      this.ui.syncPhoneMatchHUD();
    }
    this.ui?.showStatusToast?.(
      isSteppingOut
        ? '⚡ STEP OUT (CHARGE): Out of Crease (+6% Power · Stumping Risk!)'
        : '🛡️ IN CREASE: Back Foot Grounded Safely Inside Popping Crease',
      isSteppingOut
    );
    return isSteppingOut;
  }

  startCalibrationFlow() {
    this.batting.startCalibration();
    const bar = document.getElementById('calib-progress-bar');
    if (bar) bar.style.width = '0%';
    this.ui.openModal('modal-calibrate');
  }

  ensure3DTossCoinMesh() {
    if (this.tossCoinMesh) return this.tossCoinMesh;
    const makeCoinFaceTex = (label, bgHex, borderHex) => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = bgHex;
      ctx.beginPath();
      ctx.arc(64, 64, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = borderHex;
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 64, 68);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const headsMat = new THREE.MeshStandardMaterial({
      map: makeCoinFaceTex('HEADS', '#f59e0b', '#fef08a'),
      metalness: 0.85,
      roughness: 0.22
    });
    const tailsMat = new THREE.MeshStandardMaterial({
      map: makeCoinFaceTex('TAILS', '#38bdf8', '#e0f2fe'),
      metalness: 0.85,
      roughness: 0.22
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.92,
      roughness: 0.18
    });

    const geo = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 32);
    this.tossCoinMesh = new THREE.Mesh(geo, [rimMat, headsMat, tailsMat]);
    this.tossCoinMesh.castShadow = true;
    this.tossCoinMesh.visible = false;
    this.scene.add(this.tossCoinMesh);
    return this.tossCoinMesh;
  }

  updateCoinToss3D(dt) {
    if (!this.tossAnimState || !this.tossAnimState.active) return;
    const st = this.tossAnimState;
    st.elapsed += dt;
    const progress = Math.min(1, st.elapsed / st.duration);
    const coin = this.ensure3DTossCoinMesh();
    coin.visible = true;

    // Parabolic arc above the pitch in front of the camera
    const arcY = Math.sin(progress * Math.PI) * 2.85;
    coin.position.set(0, 1.15 + arcY, 2.2);
    const targetRotX = st.targetRotX;
    const easeOut = 1 - Math.pow(1 - progress, 3);
    coin.rotation.x = easeOut * targetRotX;
    coin.rotation.z = Math.sin(progress * Math.PI * 2) * 0.25;

    if (progress >= 1) {
      st.active = false;
      setTimeout(() => {
        if (this.tossCoinMesh && (!this.tossAnimState || !this.tossAnimState.active)) {
          this.tossCoinMesh.visible = false;
        }
      }, 1800);
    }
  }

  performCoinToss(userCall = 'HEADS') {
    if (this.isCoinFlipping) return;
    this.isCoinFlipping = true;
    sound.playCoinFlip();

    const coinSide = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
    const cleanCall = String(userCall || 'HEADS').toUpperCase() === 'TAILS' ? 'TAILS' : 'HEADS';
    const userWon = cleanCall === coinSide;

    const teamAIdx = Number(document.getElementById('setup-team-a')?.value) || 0;
    const teamBIdx = Number(document.getElementById('setup-team-b')?.value) || 1;
    const teamAName = FICTIONAL_TEAMS[teamAIdx]?.nameEn || 'Your Team';
    const teamBName = FICTIONAL_TEAMS[teamBIdx]?.nameEn || 'Opponent';

    const resEl = document.getElementById('toss-result-text');
    const choiceRow = document.getElementById('toss-user-choice-row');
    const roleSel = document.getElementById('setup-role');
    const coinEl = document.getElementById('toss-coin-3d');

    if (choiceRow) choiceRow.classList.add('hidden');
    if (resEl) {
      resEl.textContent = `🪙 Flipping coin in the air... You called ${cleanCall}!`;
      resEl.className = 'text-xs sm:text-sm font-bold text-amber-300 mt-1 animate-pulse';
    }

    // 1. Trigger 3D CSS Coin Flip inside the Toss Card
    this.coinSpinCount = (this.coinSpinCount || 0) + 5;
    const degX = this.coinSpinCount * 360 + (coinSide === 'TAILS' ? 180 : 0);
    if (coinEl) {
      coinEl.style.transform = `translateY(-22px) rotateX(${degX}deg) scale(1.14)`;
      setTimeout(() => {
        coinEl.style.transform = `translateY(0px) rotateX(${degX}deg) scale(1)`;
      }, 650);
    }

    // 2. Trigger 3D Gold Coin Mesh Flip on the Stadium Pitch
    this.tossAnimState = {
      active: true,
      elapsed: 0,
      duration: 1.15,
      targetRotX: Math.PI * 10 + (coinSide === 'TAILS' ? Math.PI : 0)
    };
    this.ensure3DTossCoinMesh();

    setTimeout(() => {
      this.isCoinFlipping = false;
      this.ui.t20TossDone = true;
      this.ui.t20UserWonToss = userWon;
      sound.playUIClick(userWon ? 1420 : 880);

      if (userWon) {
        if (roleSel) roleSel.value = 'bat';
        if (choiceRow) choiceRow.classList.remove('hidden');
        if (resEl) {
          resEl.textContent = `🪙 Coin landed ${coinSide} (You called ${cleanCall})! ${teamAName} won the toss — choose Bat or Bowl below!`;
          resEl.className = 'text-xs sm:text-sm font-bold text-emerald-400 mt-1';
        }
      } else {
        if (choiceRow) choiceRow.classList.add('hidden');
        const aiChoseBat = Math.random() < 0.5;
        const userRole = aiChoseBat ? 'bowl' : 'bat';
        if (roleSel) roleSel.value = userRole;
        if (resEl) {
          resEl.textContent = `🪙 Coin landed ${coinSide} (You called ${cleanCall})! ${teamBName} won the toss and elected to ${
            aiChoseBat ? 'BAT' : 'BOWL'
          } first! (You ${userRole.toUpperCase()} first)`;
          resEl.className = 'text-xs sm:text-sm font-bold text-amber-400 mt-1';
        }
      }
    }, 1180);
  }

  startConfiguredMatchFromUI(skipPlayGate = false) {
    sound.init();
    const modeId = document.getElementById('setup-mode')?.value || this.ui.setupMode || 'run_chase';
    const customT20Overs = Number(document.getElementById('setup-t20-overs')?.value) || 20;
    const overs = modeId === 't20' ? customT20Overs : modeId === 'last_over' || modeId === 'super_over' ? 1 : 5;
    const matchType = document.getElementById('setup-match-type')?.value || 'ai';
    const difficulty = document.getElementById('setup-difficulty')?.value || 'medium';
    const stadium = document.getElementById('setup-stadium')?.value || 'eden_gardens';
    const timeOfDay = document.getElementById('setup-day-night')?.value || 'night';
    const teamAIndex = Number(document.getElementById('setup-team-a')?.value) || 0;
    const teamBIndex = Number(document.getElementById('setup-team-b')?.value) || 1;
    const teamAData = FICTIONAL_TEAMS[teamAIndex % FICTIONAL_TEAMS.length];
    const jerseyColorA = teamAData?.primaryColor || '#0284c7';
    const jerseyNumberA = teamAData?.defaultNumber || 18;
    const isChaseFormat = modeId === 'run_chase' || modeId === 'last_over';
    const roleChoice = isChaseFormat ? 'bat' : (document.getElementById('setup-role')?.value || 'bat');
    const pitchType = document.getElementById('setup-pitch-type')?.value || 'normal';
    const handedness = document.getElementById('setup-handedness')?.value || this.handedness;

    // Keep explicit user-rerolled target from Match Setup, otherwise roll a fresh target
    const freshChaseTarget = isChaseFormat
      ? (this.ui._userRerolledTarget && this.ui.rolledChaseTarget
          ? this.ui.rolledChaseTarget
          : rollRunChaseTarget(difficulty, modeId))
      : null;
    this.ui._userRerolledTarget = false;
    if (freshChaseTarget) {
      this.ui.rolledChaseTarget = freshChaseTarget;
      this.ui.refreshRunChaseTargetPreview(false);
    }

    this.match.configureMatch({
      modeId,
      overs,
      matchType,
      difficulty,
      stadium,
      timeOfDay,
      teamAIndex,
      teamBIndex,
      jerseyColorA,
      jerseyNumberA,
      userBattedFirst: roleChoice === 'bat',
      customTargetRuns: freshChaseTarget
    });

    this.batting.resetStreak();
    this.batting.resetForNextBall({ preserveWheelAim: false, resetCreaseX: true });
    this.fielding.manualOverride = false;
    this.lastMatchRpGain = 0;
    this.ui.t20TossDone = false;
    this.matchPlayConfirmed = Boolean(skipPlayGate);
    this.setStadium(this.match.stadium, this.match.timeOfDay);
    this.ui.syncStadiumAndDayNightUI(this.match.stadium, this.match.timeOfDay);
    this.setHandedness(handedness);
    this.setPitchType(pitchType);
    this.rebuildTeamCharacters();
    this.resetBallAndFielders();
    this.updateMatchTension();
    this.ui.updateHUD();
  }

  triggerInstantRematch() {
    sound.init();
    if (this.isReplaying || this.pendingReplayStartTimer) {
      this.skipReplay();
    }
    this.ui.closeAllModals();
    this.startConfiguredMatchFromUI(true);
    this.confirmPlayAndStartMatch();
    this.ui.showStatusToast('🔥 Instant Rematch Started! New Target Rolled!', true);
  }

  confirmPlayAndStartMatch() {
    sound.init();
    this.matchPlayConfirmed = true;
    this.ui._inMenuFlow = false;
    this._snapCameraNextFrame = true;
    this.ui.closeModal('modal-qr', true);
    this.scheduleAutoBowl(1.8);

    const groundObj = INDIAN_STADIUMS.find((s) => s.id === this.match.stadium);
    const groundName = groundObj ? groundObj.shortEn : 'Eden Gardens';
    const timeLabel = this.match.timeOfDay === 'day' ? 'Day' : 'Night';

    if (this.match.modeId === 'last_over') {
      this.ui.showEventBanner(
        `⚡ NEED ${this.match.targetRuns} IN 6 BALLS!`,
        `${this.match.battingTeam.short} v ${this.match.bowlingTeam.short} · 1-Over Finisher Thriller (2 Wickets in Hand) · ${groundName}`,
        'text-rose-400'
      );
    } else if (this.match.modeId === 'super_over') {
      this.ui.showEventBanner(
        `⚡ SUPER OVER SHOOTOUT!`,
        `${this.match.battingTeam.short} v ${this.match.bowlingTeam.short} · 6 Balls · 2 Wickets Max · ${groundName} (${timeLabel})`,
        'text-emerald-400'
      );
    } else if (this.match.modeId === 'run_chase') {
      this.ui.showEventBanner(
        `TARGET: ${this.match.targetRuns} RUNS`,
        `${this.match.battingTeam.short} v ${this.match.bowlingTeam.short} · Chase in 5 Overs (30 Balls) · ${groundName} (${timeLabel})`,
        'text-amber-400'
      );
    } else {
      this.ui.showEventBanner(
        `${this.match.battingTeam.short} vs ${this.match.bowlingTeam.short} · T20`,
        `${this.match.totalOvers} Overs · ${this.match.userRole === 'bat' ? 'You Bat First' : 'You Bowl First'} · ${groundName} (${timeLabel})`,
        'text-emerald-400'
      );
    }
    this.ui.syncPhoneMatchHUD();
    commentary.trigger('match_start', this.getCommentaryContext(), true);
  }

  joinCustomRoom(code) {
    this.net.connect(code, 'p1');
    this.ui.showEventBanner(`ROOM ${code}`, 'Connected to room relay', 'text-sky-400');
  }

  /**
   * Starts a Real-Time Online 1v1 PvP Match (Host Bats First vs Peer Live Bowler, swapping at Innings Break)
   */
  startOnline1v1Match(roomCode = null, isHost = true, preferredRole = null) {
    sound.init();
    const isRoleArg = roomCode === 'bat' || roomCode === 'bowl';
    const roleToUse = preferredRole || (isRoleArg ? roomCode : isHost ? 'bat' : 'bowl');
    const rawCode = isRoleArg ? this.net.roomCode : roomCode || this.net.roomCode || this.net.generateRoomCode();
    const cleanCode = String(rawCode).trim().toUpperCase().slice(0, 4);

    this.online1v1Active = true;
    this.net.role = isHost ? 'host' : 'online_peer';
    this.net.connect(cleanCode, isHost ? 'p1' : 'p2');

    this.match.configureMatch({
      modeId: 't20',
      overs: 2,
      matchType: 'online1v1',
      difficulty: 'medium',
      stadium: this.match.stadium || 'eden_gardens',
      timeOfDay: this.match.timeOfDay || 'night',
      teamAIndex: 0,
      teamBIndex: 1,
      userBattedFirst: roleToUse !== 'bowl'
    });

    this.matchPlayConfirmed = true;
    this.ui._inMenuFlow = false;
    this.ui.closeAllModals(true);
    this.rebuildTeamCharacters();
    this.resetBallAndFielders();
    this.updateMatchTension();
    this.ui.updateHUD();
    if (typeof this.ui.syncOnline1v1ModalUI === 'function') {
      this.ui.syncOnline1v1ModalUI();
    }
    const roleBanner = roleToUse !== 'bowl' ? 'YOU BAT FIRST · OPPONENT BOWLS' : 'YOU BOWL FIRST · OPPONENT BATS';
    this.ui.showEventBanner(
      `🌐 ONLINE 1v1 · ROOM ${cleanCode}`,
      `${roleBanner} · 2-Over Live PvP Clash`,
      'text-emerald-400'
    );
  }

  /**
   * Triggers Third Umpire DRS Hawk-Eye Ball-Tracking & UltraEdge Review on the last dismissal
   */
  triggerDRSReview() {
    if (this.drsActive || !this.lastDRSCandidate || (this.match.drsReviewsRemaining ?? 0) <= 0) return;
    const cand = this.lastDRSCandidate;
    this.drsActive = true;
    this.boundaryCelebrationUntil = performance.now() + 4400;
    if (this.pendingReplayStartTimer) {
      clearTimeout(this.pendingReplayStartTimer);
      this.pendingReplayStartTimer = null;
    }
    if (this.pendingReplayEndTimer) {
      clearTimeout(this.pendingReplayEndTimer);
      this.pendingReplayEndTimer = null;
    }
    if (this.postDeliveryResetTimer) {
      clearTimeout(this.postDeliveryResetTimer);
      this.postDeliveryResetTimer = null;
    }
    this.isReplaying = false;

    if (typeof this.ui.hideDRSReviewPrompt === 'function') {
      this.ui.hideDRSReviewPrompt();
    }
    sound.playUmpireSignal('whistle');

    // Run 3-Step Animated Hawk-Eye Overlay in UI and resolve verdict after 3.8s
    if (typeof this.ui.playDRSHawkEyeSequence === 'function') {
      this.ui.playDRSHawkEyeSequence(cand, (verdict) => {
        this.drsActive = false;
        this.lastDRSCandidate = null;
        if (verdict.isOverturned) {
          this.match.overturnLastWicketViaDRS();
          this.resetWickets();
          this.rebuildTeamCharacters();
          sound.playCrowdReaction('six', 0);
          this.ui.showEventBanner(
            '🟢 DRS OVERTURNED · NOT OUT!',
            `${verdict.reasonText} · Batter stays at the crease!`,
            'text-emerald-400'
          );
          this.ui.updateHUD();
        } else {
          if (!verdict.umpireCall) {
            this.match.drsReviewsRemaining = Math.max(0, (this.match.drsReviewsRemaining ?? 2) - 1);
          }
          this.triggerUmpireSignal('out');
          sound.playCrowdReaction('wicket', 0);
          this.ui.showEventBanner(
            '🔴 DRS DECISION · OUT!',
            `${verdict.reasonText} · Reviews Left: ${this.match.drsReviewsRemaining}`,
            'text-rose-400'
          );
          this.ui.updateHUD();
        }
        this.postDeliveryResetTimer = setTimeout(() => {
          this.postDeliveryResetTimer = null;
          this.cameraMode = this.savedCameraMode;
          this.resetBallAndFielders();
        }, 1900);
      });
    }
  }

  startNextDelivery() {
    if (this.drsActive) return;
    if (this.isReplaying || this.pendingReplayStartTimer || this.pendingReplayEndTimer) {
      this.skipReplay();
    }
    if (this.pendingReplayStartTimer) {
      clearTimeout(this.pendingReplayStartTimer);
      this.pendingReplayStartTimer = null;
    }
    if (this.pendingReplayEndTimer) {
      clearTimeout(this.pendingReplayEndTimer);
      this.pendingReplayEndTimer = null;
    }
    if (this.postDeliveryResetTimer) {
      clearTimeout(this.postDeliveryResetTimer);
      this.postDeliveryResetTimer = null;
    }
    if (typeof this.ui.hideDRSReviewPrompt === 'function') {
      this.ui.hideDRSReviewPrompt();
    }
    if (typeof this.ui.hideOverWagonWheelPopup === 'function') {
      this.ui.hideOverWagonWheelPopup();
    }

    if (this.match.isMatchOver) {
      // Do NOT silently zero out the match score when the match is already over — show Scorecard instead!
      this.autoBowlScheduled = false;
      this.ui.renderScorecardAndWagonWheel();
      this.ui.openModal('modal-scorecard');
      return;
    }

    if (this.cameraMode === 'follow' || this.cameraMode === 'replay') {
      this.cameraMode =
        this.savedCameraMode === 'broadcast' || this.savedCameraMode === 'pro' || this.savedCameraMode === 'overhead'
          ? this.savedCameraMode
          : 'pro';
    }

    this.matchPlayConfirmed = true;
    this.resetWickets();
    // Preserve both Angle Wheel aim AND batsman's manual left/right creaseX position when the bowler runs in!
    this.batting.resetForNextBall({ preserveWheelAim: true, resetCreaseX: false });
    this.bowling.resetForNextBall();
    this.net.syncShotModeLock(this.batting.shotMode, false);
    this.ui.updateShotModeHUD();

    const matchContext = {
      modeId: this.match.modeId,
      userRole: this.match.userRole,
      isPowerplay: this.match.isPowerplayActive(),
      ballsRemaining: Math.max(0, this.match.totalOvers * 6 - this.match.legalBalls),
      runsNeeded:
        this.match.innings === 2 && this.match.firstInningsScore !== null
          ? Math.max(0, this.match.firstInningsScore + 1 - this.match.runs)
          : null,
      totalOvers: this.match.totalOvers,
      batterCreaseX: this.batting.creaseX || 0,
      recentShots: this.match.wagonWheel || []
    };

    this.deliveryCompletedThisBall = false;
    this._ballWasHit = false;
    this.ballStateStuckTimer = 0;
    this.ballInPlayTimer = 0;
    this.physics.state = 'runup';
    this.bowling.state = 'runup';
    this.autoBowlScheduled = false;
    this.runsCompletedThisBall = 0;
    this.runnersInMotion = false;
    this.runnerReturning = false;
    this.runnerStoppedMidPitch = false;
    this.ballHeldAtStumps = false;
    this.ballHeldTimer = 0;
    this.runnerProgress = 0;
    this.strikerMeshZ = CREASE_Z + 0.14;
    this.nonStrikerMeshZ = -CREASE_Z - 0.18;
    this.bounceMarker.visible = false;
    this.replayFrames = [];
    this.currentBallHighlight = null;
    this.activeReplayHighlight = null;
    this.ui.updateRunningBar({ active: false });

    // Pre-compute AI delivery at start of run-up so Rookie/Club Delivery Preview & 3D Length Bullseye work
    const diffProfile = getDifficultyProfile(this.match.difficulty);
    if (this.match.userRole === 'bat') {
      if (this.match.matchType === 'online1v1' && this.net.onlinePeerConnected) {
        // In Online 1v1 when batting against a connected human bowler, wait for their live release if not yet received
        if (!this.pendingAIDelivery) {
          this.pendingAIDelivery = this.bowling.generateAIDelivery(
            this.match.difficulty,
            this.match.legalBalls,
            this.handedness,
            matchContext
          );
        }
      } else {
        this.pendingAIDelivery = this.bowling.generateAIDelivery(
          this.match.difficulty,
          this.match.legalBalls,
          this.handedness,
          matchContext
        );
      }
      this.ui.updateBowlerSideButton();
      this.aimRing.position.set(this.pendingAIDelivery.targetX, 0.035, this.pendingAIDelivery.bounceZ);
      this.setAimRingColor(this.pendingAIDelivery.lengthColorHex || 0xf59e0b);
      const previewMode = diffProfile.deliveryPreview || 'hidden';
      // On Rookie & Club, pitching ring is visible from start of run-up; on Pro & Legend, it reveals during gather stride!
      this.aimRing.visible = previewMode !== 'hidden';
      if (previewMode !== 'hidden') {
        this.ui.showDeliveryPreview(this.pendingAIDelivery, previewMode);
      } else {
        const activeBowler = this.match.getActiveBowler();
        const sideLbl = this.bowling.bowlerSide === 'around' ? 'Around Wicket' : 'Over Wicket';
        this.ui.showDeliveryPreview(
          {
            customStatusText: `${activeBowler.name} (${sideLbl}) · Steaming in...`,
            lengthCategory: 'good'
          },
          'briefly'
        );
      }
    } else {
      this.pendingAIDelivery = null;
      this.aimRing.visible = true;
      const v = this.bowling.getVariationsForBowler(this.bowling.bowlerType).find(
        (x) => x.id === this.bowling.selectedVariationId
      );
      if (v) {
        const lenColor =
          this.bowling.aimBounceZ >= 7.6
            ? 0x38bdf8
            : this.bowling.aimBounceZ >= 5.5
              ? 0x10b981
              : this.bowling.aimBounceZ < 2.4
                ? 0xef4444
                : 0xf59e0b;
        this.setAimRingColor(lenColor);
        this.ui.showDeliveryPreview(
          {
            variationNameEn: v.nameEn,
            variationNameHi: v.nameHi,
            bowlerSide: this.bowling.bowlerSide,
            speedKmh: 135
          },
          'briefly'
        );
      }
    }

    // Apply phase-aware & hot-zone adaptive field placement (Powerplay, Spin Trap, Death Overs) now that bowlerType is set
    this.fielding.applyAdaptiveField({
      ...matchContext,
      bowlerType: this.bowling.bowlerType
    });
    this.fielding.resetToHomePositions(this.bowling.bowlerType);
    const presetSel = document.getElementById('select-field-preset');
    if (presetSel && presetSel.value !== this.fielding.setting) {
      presetSel.value = this.fielding.setting;
    }
    if (typeof this.ui.syncAngleWheelUI === 'function') {
      this.ui.syncAngleWheelUI();
    }
    this.updateMatchTension();

    if (this.strikerPlayer) this.strikerPlayer.playClip('stance', 0.2);
    if (this.bowlerPlayer) this.bowlerPlayer.playClip('bowling_runup', 0.15, this.bowling.bowlerType === 'spin' ? 0.86 : this.bowling.bowlerType === 'medium' ? 0.98 : 1.10);

    const activeBowler = this.match.getActiveBowler();
    const isHatTrickDelivery = (activeBowler.consecutiveWickets || 0) === 2;
    if (isHatTrickDelivery) {
      this.registerReplayHighlight({
        category: 'hattrick_ball',
        priority: 52,
        label: 'HAT-TRICK BALL',
        cameraStyle: 'stumps',
        focusPos: new THREE.Vector3(0, 0.55, PITCH_HALF_LENGTH)
      });
    }

    const sideText = this.bowling.bowlerSide === 'around' ? 'around the wicket' : 'over the wicket';
    this.ui.setCommentary(
      `${activeBowler.name} steaming in ${sideText}${isHatTrickDelivery ? ' ON A HAT-TRICK' : ''}... Time your swing!`,
      `${activeBowler.name} दौड़ते हुए... सही समय पर शॉट खेलें!`
    );
  }

  releaseBowledBall(delivery, fromRemotePeer = false) {
    // Bug #4 Fix: Keep GROUND / LOFT unlocked after bowler release so player can switch right up until bat-ball contact!
    this.batting.unlockShotMode();
    this.net.syncShotModeLock(this.batting.shotMode, false);
    this.ui.updateShotModeHUD();

    if (this.match.matchType === 'online1v1' && this.match.userRole === 'bowl' && !fromRemotePeer) {
      this.net.send({
        type: 'online_bowl_release',
        delivery
      });
    }

    if (this.bowlerPlayer) {
      this.bowlerPlayer.playClip(this.bowling.bowlerType === 'spin' ? 'bowl_spin' : 'bowl_pace', 0.12, 1.1);
    }

    // Subtle crease landing chalk/dust puff at bowler's front foot
    this.spawnDustPuff(new THREE.Vector3(this.bowlerMesh.position.x, 0.04, -CREASE_Z), 0.32);

    const diffProfile = getDifficultyProfile(this.match.difficulty);
    const previewMode = delivery.deliveryPreview || diffProfile.deliveryPreview || 'hidden';
    const bz = Number(delivery.bounceZ ?? 4.6);
    const lengthColorHex =
      bz < 3.2
        ? 0xef4444 // Red = Short / Bouncer
        : bz >= 7.5
          ? 0x38bdf8 // Blue = Yorker
          : bz >= 5.0
            ? 0x22c55e // Green = Full / Overpitched
            : 0xeab308; // Yellow = Good Length
    this._currentLengthColorHex = lengthColorHex;
    this.aimRing.position.set(delivery.targetX, 0.035, delivery.bounceZ);
    this.setAimRingColor(lengthColorHex);
    // Keep color-coded pitching spot & shrinking timing ring visible during ball flight so batter can read length!
    this.aimRing.visible = true;
    this.aimRing.scale.setScalar(1.0);
    if (this.timingOuterRing) {
      this.timingOuterRing.visible = this.match.userRole === 'bat';
      this.timingOuterRing.scale.setScalar(2.15);
      if (this.timingRingMat) this.timingRingMat.opacity = 0.85;
    }
    this.showLengthBanner(delivery.lengthLabelEn);
    if (previewMode === 'hidden') {
      this.ui.showDeliveryPreview(
        {
          customStatusText: `${delivery.lengthLabelEn} · ${Math.round(delivery.speedKmh)} km/h`,
          lengthCategory: delivery.lengthCategory
        },
        'briefly'
      );
    }

    // Apply bowler confidence & spell stamina to delivery pace (+3 km/h when pumped up, -3 km/h when tired)
    const activeBowler = this.match.getActiveBowler();
    if (activeBowler) {
      const confDelta = ((activeBowler.confidence ?? 70) - 70) * 0.08;
      const fatiguePenalty = Math.max(0, (80 - (activeBowler.stamina ?? 100)) * 0.05);
      delivery.speedKmh = THREE.MathUtils.clamp((delivery.speedKmh || 132) + confDelta - fatiguePenalty, 58, 158);
    }

    // Clear any stale pre-release swing so timing is evaluated genuinely against the delivered ball
    this.batting.manualSwingArmed = false;
    this.physics.launchDelivery(delivery);
    this._ballReleaseTimeSec = performance.now() * 0.001;
    if (this.physics.isNoBall) {
      sound.playUmpireSignal('no_ball');
      this.triggerUmpireSignal('noball');
      this.ui.showStatusToast(
        `🚨 NO BALL (${this.physics.noBallReason || 'Overstep'})! Free Hit on this & next ball!`,
        true
      );
    } else {
      sound.playUmpireSignal('whistle');
    }
    this.ui.updateHUD();
    commentary.trigger('delivery_release', this.getCommentaryContext());
  }

  /**
   * Plays matching animation clip for all 360-degree shots including Sweep, Scoop, and Ramp
   */
  triggerStrikerMocapShot(shotKey, style = {}) {
    if (!this.strikerPlayer) return;
    // Every shot type the batting engine can classify maps to its own realistic clip
    // (previously sweep / scoop / ramp / on-drive / reverse-sweep / glance silently fell back to the drive clip).
    const map = {
      defence: 'defence',
      straight_drive: 'drive',
      drive: 'drive',
      cover_drive: 'drive_cover',
      inside_out_loft: 'drive_cover_loft',
      on_drive: 'drive_on_whip',
      drive_on: 'drive_on',
      square_cut: 'cut',
      lofted_cut: 'cut_loft',
      late_cut: 'cut_late',
      upper_cut: 'upper_cut',
      leg_flick: 'flick',
      fine_glance: 'glance',
      paddle_sweep: 'paddle_flick',
      pull_shot: 'pull',
      hook_shot: 'hook_loft',
      sweep: 'sweep',
      sweep_shot: 'sweep',
      slog_sweep: 'slog_sweep',
      reverse_sweep: 'reverse_sweep',
      scoop: 'scoop',
      scoop_shot: 'scoop',
      ramp: 'ramp',
      ramp_shot: 'ramp',
      helicopter_loft: 'helicopter',
      lofted_six: 'loft',
      loft: 'loft'
    };
    let clipName = map[shotKey] || 'drive';

    // Pick the stroke that suits the ball's length: back-foot punch to short ground balls, dig-out to yorkers,
    // preserve explosive lofted clips & signature late-cut/slog-sweep/helicopter strokes!
    if (this.physics.state === 'bowled' || this.physics.state === 'runup') {
      const bz = this.physics.bouncedOnPitch ? this.physics.pitchBouncePos?.z : this.physics.deliveryBounceZ;
      if (typeof bz === 'number') {
        const isShort = bz < 3.2;
        const isFull = bz >= 5.0 && bz < 7.5;
        const isYorker = bz >= 7.5;
        const isDrive = clipName === 'drive' || clipName === 'drive_cover' || clipName === 'drive_on' || clipName === 'drive_on_whip';
        if (isDrive && isShort && this.batting.shotMode !== 'fly') clipName = 'punch';
        else if ((isDrive || clipName === 'defence') && isYorker) clipName = 'dig';
        else if (clipName === 'pull' && (isFull || isYorker)) clipName = 'flick';
        else if (clipName === 'cut' && (isFull || isYorker)) clipName = 'drive_cover';
      }
    }
    // --- Sync the stroke with the ball: the bat should meet the ball at the clip's contact pose (~0.31s in) ---
    const nowMs = performance.now();
    const lockWindowMs = style.fromContactCallback ? 900 : 140;
    if (
      this._lastShotClipName === clipName &&
      nowMs - (this._lastShotClipAt || 0) < lockWindowMs &&
      this.strikerPlayer.currentClipName === clipName
    ) {
      return; // the stroke is already playing (e.g. contact callback after the swing started) - never restart it mid-swing
    }
    const CONTACT_AT = clipName === 'defence' ? 0.3 : 0.31;
    let timeScale = 1.05;
    let delay = 0;
    let startAt = 0;
    if (style.fromContactCallback) {
      // Ball already struck on a reactive late swing: smooth follow-through without abrupt fast-forward
      startAt = Math.max(0, CONTACT_AT - 0.08);
      timeScale = 1.24;
    } else if (this.physics.state === 'bowled' && this.physics.idealContactTime > 0) {
      const toContact = this.physics.idealContactTime - nowMs * 0.001; // seconds until the ball reaches the bat
      const T = Math.max(0.03, toContact);
      timeScale = THREE.MathUtils.clamp(CONTACT_AT / T, 0.85, 1.58);
      startAt = Math.max(0, CONTACT_AT - T * timeScale); // ball almost here: join the stroke already in its downswing
      if (T > CONTACT_AT / 0.85) delay = Math.min(0.45, T - CONTACT_AT / 0.85); // ball still far: hold set-up, then whip
    } else if (this.physics.state === 'runup') {
      timeScale = 0.85;
    }
    this._lastShotClipName = clipName;
    this._lastShotClipAt = nowMs + delay * 1000;
    this.strikerPlayer.playClipTimed(clipName, startAt > 0 ? 0.05 : 0.09, timeScale, delay, startAt);

    if (this.batRibbonTrail && this.strikerMesh) {
      const isLofted =
        clipName === 'loft' ||
        clipName === 'drive_cover_loft' ||
        clipName === 'cut_loft' ||
        clipName === 'upper_cut' ||
        clipName === 'hook_loft' ||
        clipName === 'slog_sweep' ||
        clipName === 'helicopter' ||
        clipName === 'scoop' ||
        clipName === 'ramp' ||
        this.batting.shotMode === 'fly';
      const isOnFire = typeof this.batting?.isOnFire === 'function' && this.batting.isOnFire();
      this.batRibbonTrail.triggerShotSwingArc(this.strikerMesh, shotKey, {
        isLofted,
        isSweet: Boolean(style.isSweet),
        isOnFire
      });
    }
  }

  checkAndExecuteBattingContact() {
    // Hit-wicket check if batter retreats deep onto the stumps and swings wildly (not out on Free Hit or No-Ball!)
    if (
      !this.batting.shotExecutedThisBall &&
      !this.match.freeHit &&
      !this.physics.isNoBall &&
      this.batting.creaseZOffset < -0.44 &&
      Math.abs(this.batting.creaseX) < 0.16 &&
      this.batting.angularSpeedDeg > 410
    ) {
      this.batting.shotExecutedThisBall = true;
      this.dislodgeWickets('striker');
      sound.playCrowdReaction('wicket', 0);
      this.triggerTeamCelebration();
      this.registerReplayHighlight({
        category: 'wicket',
        priority: 100,
        label: 'WICKET: HIT WICKET',
        cameraStyle: 'stumps',
        focusPos: new THREE.Vector3(0, 0.55, PITCH_HALF_LENGTH)
      });
      this.ui.showEventBanner('HIT WICKET!', 'Batter stepped back onto the stumps!', 'text-red-500');
      commentary.trigger('wicket_bowled', this.getCommentaryContext(), true);
      this.completeDelivery({
        runsScored: 0,
        isWicket: true,
        wicketTypeEn: 'Hit Wicket',
        wicketTypeHi: 'हिट विकेट'
      });
      return null;
    }

    const contact = this.batting.evaluateContact(this.physics, this.match.difficulty, {
      fielders: this.fielding?.fielders || null,
      onBallHit: (info, isEdge) => {
        const isSweet = !isEdge && info.timingQuality >= 0.72;
        const isOnFire = typeof this.batting?.isOnFire === 'function' && this.batting.isOnFire();
        this._ballWasHit = true;
        this.triggerStrikerMocapShot(info.shotKey, { isSweet, isOnFire, fromContactCallback: true });
        const pan = this.getBallPan();
        const batPower = THREE.MathUtils.clamp(
          (info.batSpeedDeg / 480) * (0.55 + info.timingQuality * 0.55),
          0.22,
          1.15
        );

        // Trigger 45Hz Bat Impact Recoil + Seam Spark Burst + Floating 3D Shot Telemetry Pill
        if (this.aliveBatsman) {
          this.aliveBatsman.triggerBatImpactRecoil(isSweet, info.exitSpeedKmh);
        }
        if (this.impactVFX) {
          this.impactVFX.spawnBatHitBurst(this.physics.pos, this.physics.vel, isSweet, isOnFire);
        }
        if (this.floatingTelemetry && this.strikerMesh) {
          const gradeLabel = isEdge
            ? `⚠️ ${info.contactType.toUpperCase()}`
            : isOnFire
              ? `🔥 ON FIRE • ${info.timingLabelEn.split(' ')[0].toUpperCase()}`
              : isSweet
                ? `⚡ PERFECT • SWEET SPOT`
                : `🏏 ${info.timingLabelEn.split(' ')[0].toUpperCase()} TIMING`;
          this.floatingTelemetry.triggerPopup({
            strikerPos: this.strikerMesh.position,
            gradeText: gradeLabel,
            detailText: `${info.shotNameEn.toUpperCase()} • ${info.exitSpeedKmh} KM/H`,
            isSweet,
            isOnFire
          });
        }

        if (!info.contactType?.includes('Played-On')) {
          if (this.cameraMode === 'broadcast' || this.cameraMode === 'pro' || this.cameraMode === 'overhead') {
            this.savedCameraMode = this.cameraMode;
          }
          // Brief clean follow-through hold + subtle outward FOV breathe (never zooms into batter's back)
          this.impactFollowThroughUntil = performance.now() + (isSweet ? 130 : 95);
          this._pendingFollowCam = true;
          this.impactPunchFov = isSweet ? (info.exitSpeedKmh >= 95 ? 1.5 : 0.9) : 0.4;
          const shotYaw = this.physics.shotAngleRad || 0;
          const kickMag = isSweet ? (info.exitSpeedKmh >= 95 ? 0.14 : 0.09) : 0.05;
          this.impactKickVec.set(Math.sin(shotYaw) * kickMag, 0.03, -Math.cos(shotYaw) * kickMag);
        }

        if (isEdge) {
          const isThick = info.contactType.toLowerCase().includes('thick') || info.timingQuality > 0.55;
          sound.playBatHit(batPower, false, isThick ? 'thick_edge' : 'thin_edge', pan);
          // 3-stage wooden handle rattle vibration on edge!
          this.net.vibratePhone('p1', [16, 22, 32], '⚠️ EDGE CONTACT!');
          this.cameraShakeIntensity = 0.04;
          this.batting.startRunWindow();
          this.registerReplayHighlight({
            category: 'edge_nearmiss',
            priority: 50,
            label: info.contactType.toUpperCase().includes('INSIDE') ? 'INSIDE EDGE' : 'OUTSIDE EDGE',
            cameraStyle: 'stumps',
            focusPos: new THREE.Vector3(0, 0.65, PITCH_HALF_LENGTH - 0.5)
          });
          const modeLbl = info.shotMode === 'fly' ? 'LOFT' : 'GROUND';
          this.ui.setCommentary(
            `${info.contactType}! Launch ${info.launchAngleDeg}° (${modeLbl} mode).`,
            `${info.contactType}! लॉन्च कोण ${info.launchAngleDeg}°`
          );
        } else {
          sound.playBatHit(batPower, isSweet, isSweet ? 'sweet' : 'thick_edge', pan);
          // Crisp willow feedback with subtle 24ms micro-hit-stop & clean camera shake
          if (isSweet) {
            this.net.vibratePhone('p1', [65, 22, 95], `💥 ${info.shotNameEn} · ${info.exitSpeedKmh} KM/H!`);
            this.hitStopTimer = 0.024;
            this.cameraShakeIntensity = info.exitSpeedKmh >= 95 ? 0.09 : 0.05;
            if (info.exitSpeedKmh >= 105 && this.crowdAnimator) {
              this.crowdAnimator.triggerCheerSurge(0.75);
            }
          } else {
            this.net.vibratePhone('p1', [40, 28, 45], `🏏 ${info.shotNameEn} · ${info.exitSpeedKmh} KM/H`);
            this.hitStopTimer = 0;
            this.cameraShakeIntensity = 0.03;
          }

          // Smart Auto-Run on Safe Gap Shots + Open Run Window:
          // Only auto-sprint on genuine safe gap placements so fast drives/shots don't feel frantic
          this.batting.startRunWindow();
          this.lastLiveSixMeterShown = 0;
          const predX = this.physics.pos.x + this.physics.vel.x * 0.95;
          const predZ = this.physics.pos.z + this.physics.vel.z * 0.95;
          const minFielderDist = this.fielding?.fielders?.length
            ? this.fielding.fielders.reduce(
                (minD, f) => Math.min(minD, Math.hypot(predX - f.pos.x, predZ - f.pos.z)),
                99
              )
            : 25;
          const isLikelyAerialSix = info.shotMode === 'fly' && info.exitSpeedKmh >= 96 && info.launchAngleDeg >= 20;
          if (info.exitSpeedKmh >= 42 && info.exitSpeedKmh < 96 && minFielderDist > 9.6 && !isLikelyAerialSix) {
            this.startSingleRunSprint();
          }

          if (info.exitSpeedKmh >= 76) {
            const onFireTag = this.batting.isOnFire() ? '🔥 ON FIRE · ' : '';
            this.ui.showStatusToast(
              `${onFireTag}⚡ ${info.shotNameEn} · ${info.exitSpeedKmh} km/h (${info.timingLabelEn.split(' ')[0]})`,
              true
            );
          }

          const modeLbl = info.shotMode === 'fly' ? 'LOFT' : 'GROUND';
          this.ui.setCommentary(
            `${info.shotNameEn} [${info.shotDirectionDeg ?? 0}° · ${modeLbl} · ${info.launchAngleDeg}°]! ${info.timingLabelEn} (${info.exitSpeedKmh} km/h).`,
            `${info.shotNameHi} [${info.shotDirectionDeg ?? 0}° · ${modeLbl}] (${info.exitSpeedKmh} km/h)!`
          );
        }

        if (this.match.matchType === 'online1v1' && this.match.userRole === 'bat') {
          this.net.send({
            type: 'online_bat_shot',
            creaseX: this.batting.creaseX,
            pos: { x: this.physics.pos.x, y: this.physics.pos.y, z: this.physics.pos.z },
            vel: { x: this.physics.vel.x, y: this.physics.vel.y, z: this.physics.vel.z },
            bouncedAfterHit: this.physics.bouncedAfterHit,
            aerialAfterHit: this.physics.aerialAfterHit,
            edged: Boolean(isEdge),
            shotAngleRad: this.physics.shotAngleRad || 0,
            shotKey: info.shotKey
          });
        }
        this.ui.updateHUD();
      },
      onSwingMiss: (info) => {
        this.triggerStrikerMocapShot(this.batting.shotMode === 'fly' ? 'loft' : 'drive', {
          fromContactCallback: true
        });
        sound.playCrowdReaction('near_miss', this.getBallPan());
        commentary.trigger('near_miss', this.getCommentaryContext());
        this.ui.updateHUD();
      }
    });
    return contact;
  }

  startSingleRunSprint() {
    this.batting.startRunWindow();
    // Bug #2 Fix: Enable steady sprint cadence automatically on single RUN tap so phone users don't stall mid-pitch!
    this.batting.holdRunActive = true;
    if (this.runsCompletedThisBall < 4) {
      this.runnersInMotion = true;
      this.runnerReturning = false;
      this.runnerStoppedMidPitch = false;
      this.batting.accumulatedStepsThisRun = 20;
      this.batting.cadenceSps = 4.6;
      if (this.runnerProgress <= 0.01) {
        this.runnerProgress = 0.08;
      }
      if (this.strikerPlayer) this.strikerPlayer.playClip('bowling_runup', 0.15, 1.3);
      if (this.nonStrikerPlayer) this.nonStrikerPlayer.playClip('bowling_runup', 0.15, 1.3);
    }
  }

  /**
   * Legacy step callback kept for compatibility; running is now button-driven ("RUN" / "NO RUN")
   */
  advanceStepRun(stepIncrement = 0.16, cadenceHz = 3.0) {
    if (this.physics.state !== 'hit' && this.physics.state !== 'fielded') return;
    if (!this.runnersInMotion) {
      this.runnersInMotion = true;
    }
    this.runnerStoppedMidPitch = false;
    const animSpeed = THREE.MathUtils.clamp(0.95 + cadenceHz * 0.2, 1.0, 1.75);
    if (this.strikerPlayer && this.strikerPlayer.currentClipName !== 'bowling_runup') {
      this.strikerPlayer.playClip('bowling_runup', 0.12, animSpeed);
    }
    if (this.nonStrikerPlayer && this.nonStrikerPlayer.currentClipName !== 'bowling_runup') {
      this.nonStrikerPlayer.playClip('bowling_runup', 0.12, animSpeed);
    }
  }

  setRunButtonHeld(isHeld) {
    this.runButtonHeld = Boolean(isHeld);
    this.batting.holdRunActive = Boolean(isHeld);
    if (this.runButtonHeld && (this.physics.state === 'hit' || this.physics.state === 'fielded')) {
      this.triggerExtraRun();
    }
  }

  setHoldRun(isHeld) {
    this.setRunButtonHeld(isHeld);
  }

  /**
   * "NO RUN" Action: Immediately cancels any active or queued run and returns batsmen safely to their crease
   */
  turnBackRunner(fromRemotePeer = false) {
    if (this.physics.state !== 'hit' && this.physics.state !== 'fielded') return;
    if (this.match.matchType === 'online1v1' && !fromRemotePeer) {
      this.net.send({ type: 'online_run_action', action: 'turn_back' });
    }
    this.pendingExtraRun = false;
    this.runButtonHeld = false;
    this.batting.holdRunActive = false;
    this.runnerStoppedMidPitch = false;

    if (this.runnerProgress > 0.01) {
      this.runnerReturning = true;
      this.runnersInMotion = true;
      if (this.strikerPlayer) this.strikerPlayer.playClip('bowling_runup', 0.1, 1.45);
      if (this.nonStrikerPlayer) this.nonStrikerPlayer.playClip('bowling_runup', 0.1, 1.45);
      this.ui.setCommentary(
        'NO RUN! Calling NO and diving back safely to the crease!',
        'नो रन! रन कैंसिल — बल्लेबाज तेजी से वापस क्रीज में लौटते हुए!'
      );
    } else {
      this.runnerProgress = 0;
      this.runnerReturning = false;
      this.runnersInMotion = false;
      if (this.strikerPlayer) this.strikerPlayer.playClip('stance', 0.15);
      if (this.nonStrikerPlayer) this.nonStrikerPlayer.playClip('stance', 0.15);
      this.ui.setCommentary(
        'NO RUN! Batsmen stay safely inside their creases.',
        'नो रन! बल्लेबाज सुरक्षित क्रीज के अंदर।'
      );
    }
    this.ui.updateRunningHUD();
  }

  /**
   * "RUN" Action: Single press commits to a full run between the wickets (or queues the next run)
   */
  triggerExtraRun(fromRemotePeer = false) {
    if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
      if (this.match.matchType === 'online1v1' && !fromRemotePeer) {
        this.net.send({ type: 'online_run_action', action: 'run' });
      }
      const wasReturning = this.runnerReturning;
      this.runnerReturning = false;
      this.runnerStoppedMidPitch = false;
      if (this.runnersInMotion && !wasReturning && this.runnerProgress > 0.18) {
        this.pendingExtraRun = true;
      } else {
        this.startSingleRunSprint();
      }
      this.ui.setCommentary(
        'RUN! Sprinting between the wickets! Press NO RUN (N) anytime to cancel and return!',
        'रन! विकेटों के बीच दौड़ शुरू! कैंसिल करने के लिए NO RUN (N) दबाएं!'
      );
      this.ui.updateRunningHUD();
    }
  }

  triggerTeamCelebration() {
    if (this.bowlerPlayer) this.bowlerPlayer.playClip('appeal', 0.12);
    if (this.keeperPlayer) this.keeperPlayer.playClip('appeal', 0.15);
    this.fielderPlayers.forEach((fp, i) => {
      if (i % 2 === 0) fp.playClip('celebration', 0.2);
    });
  }

  completeDelivery(outcome) {
    if (this.match.isMatchOver || this.deliveryCompletedThisBall) return;
    this.deliveryCompletedThisBall = true;
    this.ballStateStuckTimer = 0;
    this.ballInPlayTimer = 0;

    if (this.pendingReplayStartTimer) {
      clearTimeout(this.pendingReplayStartTimer);
      this.pendingReplayStartTimer = null;
    }
    if (this.pendingReplayEndTimer) {
      clearTimeout(this.pendingReplayEndTimer);
      this.pendingReplayEndTimer = null;
    }
    if (this.postDeliveryResetTimer) {
      clearTimeout(this.postDeliveryResetTimer);
      this.postDeliveryResetTimer = null;
    }

    // Allow boundary SIX & FOUR balls to keep flying into the stands / rolling into the LED boards!
    if (!(outcome.isBoundary && this.physics.state === 'boundary_flight')) {
      this.physics.state = 'dead';
    }
    if (outcome.isBoundary) {
      this.boundaryCelebrationUntil = performance.now() + 2600;
      // Crisp broadcast camera shake punch on FOUR / SIX boundary impact
      this.cameraShakeIntensity = Math.max(this.cameraShakeIntensity || 0, outcome.runsScored === 6 ? 0.14 : 0.09);
      // Keep camera smoothly watching the ball land in the stands / hit the sponsor boards for 1.45s
      // before cutting back to the batsman bat-raise & umpire signal (eliminates fast-forward camera whip!)
      this.boundaryCameraHoldUntil = performance.now() + (outcome.runsScored === 6 ? 1550 : 1150);
      if (this.strikerPlayer) {
        this.strikerPlayer.playClip(outcome.runsScored === 6 ? 'celebrate_bat' : 'celebration', 0.15);
      }
    }
    this.batting.stopRunWindow();
    this.runnersInMotion = false;
    this.runnerReturning = false;
    this.runnerStoppedMidPitch = false;
    this.runButtonHeld = false;
    this.ballHeldAtStumps = false;
    this.pendingExtraRun = false;
    this.ui.updateRunningBar({ active: false });
    if (this.timingOuterRing) this.timingOuterRing.visible = false;

    const status = this.match.recordDeliveryOutcome(outcome);

    // Dynamic AI Captain Field Adjustment: if batter hammers 2 consecutive boundaries in a similar zone on Medium/Hard, plug that gap!
    if (
      this.match.userRole === 'bat' &&
      outcome.isBoundary &&
      !this.match.isMatchOver &&
      this.match.difficulty !== 'easy' &&
      Array.isArray(this.match.wagonWheel) &&
      this.match.wagonWheel.length >= 2 &&
      typeof this.fielding?.adaptFieldToHotZone === 'function'
    ) {
      const recent = this.match.wagonWheel.slice(-2);
      if (recent.every((s) => (s.runs || 0) >= 4)) {
        const a0 = recent[0].angleRad || 0;
        const a1 = recent[1].angleRad || 0;
        const angleDiff = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
        if (angleDiff < 1.05) {
          const avgAngle = Math.atan2(Math.sin(a0) + Math.sin(a1), Math.cos(a0) + Math.cos(a1));
          const moved = this.fielding.adaptFieldToHotZone(avgAngle, this.match.isPowerplay);
          if (moved) {
            this.ui.showStatusToast(`🛡️ FIELD CHANGE · Captain plugs ${moved.zoneLabel}!`, false);
          }
        }
      }
    }

    // Batter body language: slumps when out, shakes his head when beaten (the next ball resets him to his stance)
    if (this.strikerPlayer && !this.runnersInMotion) {
      if (outcome.isWicket) {
        this.strikerPlayer.playClip('react_out', 0.25);
      } else if (!outcome.isWide && !outcome.isBoundary && (outcome.runsScored || 0) === 0 && !this._ballWasHit) {
        const cur = this.strikerPlayer.currentClipName;
        if (cur !== 'stance' && cur !== 'celebrate_bat') {
          this.strikerPlayer.playClip('react_miss', 0.2);
          sound.playCrowdReaction('near_miss', 0); // the crowd's "ooh" when the batter is beaten
        }
      }
    }

    // Update ON FIRE / Power Surge Streak & Career Ball Progression when User is Batting or Bowling
    if (!outcome.isWide) {
      const streakRes = this.batting.registerDeliveryStreakOutcome({
        runsScored: outcome.runsScored || 0,
        isBoundary: Boolean(outcome.isBoundary),
        isWicket: Boolean(outcome.isWicket && !status.freeHitDismissalPrevented),
        timingQuality: this.batting.lastContact?.timingQuality || 0
      });
      this.updateEquippedBatVisuals();
      if (streakRes.triggeredOnFire) {
        this.net.vibratePhone('p1', [90, 40, 110, 40, 160]);
        this.ui.showStatusToast('🔥 ON FIRE ACTIVATED! +22% Sweet Spot & +12% Power for 2 Balls!', true);
      }
    }

    this.ui.updateHUD();

    if (this.match.matchType === 'online1v1') {
      this.net.send({
        type: 'online_state',
        state: {
          runs: this.match.runs,
          wickets: this.match.wickets,
          legalBalls: this.match.legalBalls
        }
      });
    }

    // Check special match-state highlights: Free Hit Wicket Chance, Hat-Trick Wicket, or Fifty/Hundred Milestone
    if (status.freeHitDismissalPrevented) {
      this.ui.showEventBanner('FREE HIT · NOT OUT!', 'Batter survives on a Free Hit!', 'text-emerald-400');
      this.registerReplayHighlight({
        category: 'freehit_hattrick',
        priority: 82,
        label: 'FREE HIT WICKET CHANCE',
        cameraStyle: 'stumps',
        focusPos: new THREE.Vector3(0, 0.55, PITCH_HALF_LENGTH)
      });
    }

    if (status.hatTrickWicket) {
      this.ui.showEventBanner('HAT-TRICK!', 'Three wickets in three consecutive balls!', 'text-red-500');
      this.registerReplayHighlight({
        category: 'wicket',
        priority: 105,
        label: 'HAT-TRICK WICKET!',
        cameraStyle: 'stumps',
        focusPos: new THREE.Vector3(0, 0.55, PITCH_HALF_LENGTH)
      });
    }

    if (status.milestoneReached) {
      if (this.strikerPlayer) this.strikerPlayer.playClip('celebrate_bat', 0.15);
      const is100 = status.milestoneReached === 100;
      const mLabel = is100 ? 'CENTURY · 100 UP!' : 'FIFTY COMPLETED!';
      this.ui.showEventBanner(mLabel, `${this.match.getActiveStriker().name} raises the bat!`, 'text-amber-400');
      commentary.trigger(is100 ? 'milestone_100' : 'milestone_50', this.getCommentaryContext(), true);
      this.registerReplayHighlight({
        category: 'milestone',
        priority: 75,
        label: mLabel,
        cameraStyle: 'follow_ball',
        focusPos: this.ballGroup.position.clone()
      });
    }

    // Update stadium crowd tension & trigger close-chase commentary when appropriate
    this.updateMatchTension();
    if (
      !outcome.isWicket &&
      !outcome.isBoundary &&
      this.match.innings === 2 &&
      this.match.firstInningsScore !== null
    ) {
      const needRuns = Math.max(0, this.match.firstInningsScore + 1 - this.match.runs);
      const remBalls = Math.max(0, this.match.totalOvers * 6 - this.match.legalBalls);
      if (remBalls > 0 && remBalls <= 12 && needRuns > 0 && needRuns <= 20 && remBalls % 3 === 0) {
        sound.playCrowdReaction('chase_tension', 0);
        commentary.trigger('chase_tension', this.getCommentaryContext());
      }
    }

    // Trigger 3D Match Umpire Signal for Wickets, Boundaries, Wides, and No-Balls
    // Give the Umpire a proper broadcast spotlight phase before replay or next-ball reset!
    let hasUmpireDecisionSignal = true;
    if (outcome.isWicket && !status.freeHitDismissalPrevented) {
      this.triggerUmpireSignal('out');
      if (this.crowdAnimator) this.crowdAnimator.triggerCheerSurge(1.25);
    } else if (outcome.isBoundary && outcome.runsScored === 6) {
      this.triggerUmpireSignal('six');
      if (this.crowdAnimator) this.crowdAnimator.triggerCheerSurge(1.35);
    } else if (outcome.isBoundary && outcome.runsScored === 4) {
      this.triggerUmpireSignal('four');
      if (this.crowdAnimator) this.crowdAnimator.triggerCheerSurge(1.10);
    } else if (outcome.isWide) {
      this.triggerUmpireSignal('wide');
    } else if (outcome.isNoBall) {
      this.triggerUmpireSignal('noball');
    } else {
      hasUmpireDecisionSignal = false;
    }

    // Feature 4: Offer Third Umpire DRS Review on LBW, Stumped, Run Out, or Caught Behind (100% Deterministic Physics / Crease Check!)
    const wType = String(outcome.wicketTypeEn || '');
    const isReviewableWicket =
      outcome.isWicket &&
      !status.freeHitDismissalPrevented &&
      (wType === 'LBW' || wType === 'Stumped' || wType === 'Run Out' || wType === 'Caught Behind');
    if (isReviewableWicket && (this.match.drsReviewsRemaining ?? 2) > 0) {
      const pitchX = this.physics.pitchBouncePos?.x ?? 0;
      const bounceZ = this.physics.pitchBouncePos?.z ?? 4.8;
      const impactX = this.physics.creaseCrossPos?.x ?? this.physics.pos.x ?? 0;
      const impactY = this.physics.creaseCrossPos?.y ?? this.physics.pos.y ?? 0.42;

      let deterministicOverturn = false;
      let isUmpireCall = false;
      if (wType === 'Run Out') {
        // Genuine Run Out only triggers when runner is short of the crease (isOutOfCrease === true)
        deterministicOverturn = Boolean(outcome.isDiveSafe);
        isUmpireCall = false;
      } else if (wType === 'Stumped') {
        deterministicOverturn = (this.batting.creaseZOffset || 0) <= 0.34;
        isUmpireCall = false;
      } else if (wType === 'Caught Behind') {
        deterministicOverturn = !(this.physics.edged || this.batting.lastContact?.didHit);
        isUmpireCall = false;
      } else {
        // LBW Hawk-Eye Ball Tracking: overturn only if ball pitched outside leg/off (> 0.185m), impacted outside (> 0.148m), or bounced over stumps (> 0.72m)
        deterministicOverturn = Math.abs(impactX) > 0.148 || Math.abs(pitchX) > 0.185 || impactY > 0.72;
        isUmpireCall = !deterministicOverturn && Math.abs(impactX) > 0.105;
      }

      this.lastDRSCandidate = {
        wicketTypeEn: wType,
        pitchX,
        bounceZ,
        impactX,
        impactY,
        runnerProgress: outcome.runnerProgressAtDismissal ?? this.runnerProgress ?? 0.55,
        isOverturned: deterministicOverturn,
        umpireCall: isUmpireCall,
        reviewsLeft: this.match.drsReviewsRemaining ?? 2
      };
      if (typeof this.ui.showDRSReviewPrompt === 'function') {
        this.ui.showDRSReviewPrompt(this.lastDRSCandidate);
      }
    } else {
      this.lastDRSCandidate = null;
    }

    // Rebuild jersey numbers if a new batter walked in serially, bowler rotated, or innings changed
    if (
      outcome.isWicket ||
      status.overCompleted ||
      status.inningsEndState === 'innings_break' ||
      status.inningsEndState === 'super_over'
    ) {
      this.rebuildTeamCharacters();
      // Preserve active umpire signal on the freshly rebuilt umpire mesh!
      if (hasUmpireDecisionSignal && this.umpireSignal !== 'idle') {
        this.umpireSignalTimer = 3.2;
      }
      if (!this.match.isMatchOver && !status.inningsEndState) {
        if (outcome.isWicket && !status.freeHitDismissalPrevented) {
          const nextBatter = this.match.getActiveStriker();
          if (nextBatter) {
            this.ui.showStatusToast(`Next Batsman In: #${nextBatter.index + 1} ${nextBatter.name}`, true);
          }
        }
      }
    }
    this.updateJumbotronScoreboard(
      outcome.isWicket ? 'OUT!' : outcome.runsScored === 6 ? 'MAXIMUM SIX!' : outcome.runsScored === 4 ? 'FOUR!' : ''
    );

    // Feature 3: Show brief non-blocking toast on Over completion + Powerplay End notification
    if (status.overCompleted && this.match.lastCompletedOverSummary && !this.match.isMatchOver) {
      const ovSum = this.match.lastCompletedOverSummary;
      const ppJustEnded =
        (this.match.totalOvers >= 10 && ovSum.overNumber === 6) ||
        (this.match.totalOvers >= 3 && this.match.totalOvers < 10 && ovSum.overNumber === 2);
      if (ppJustEnded) {
        this.ui.showStatusToast(
          `🛡️ POWERPLAY ENDED (Over ${ovSum.overNumber}.0)! Up to 5 fielders now guarding the boundary rope!`,
          true
        );
      } else {
        this.ui.showStatusToast(
          `End of Over ${ovSum.overNumber}: ${ovSum.runsInOver} Runs, ${ovSum.wicketsInOver} Wkt · Next Bowler: ${this.match.getActiveBowler()?.name || 'Bowler'}`,
          true
        );
      }
    }

    // Decide whether to trigger the 0.28x Slow-Motion Highlight Replay
    const highlight = this.currentBallHighlight;
    const shouldReplay = this.shouldPlayReplayForHighlight(highlight);
    const replayBadge = document.getElementById('hud-replay-badge');
    const replayReasonEl = document.getElementById('hud-replay-reason');

    // Balanced Broadcast Timing Sequence:
    // Comfortable turnaround on normal balls (1200ms) and crisp celebrations on boundaries/wickets
    const isBoundaryHit = Boolean(outcome.isBoundary);
    const preReplayHoldMs = isBoundaryHit
      ? 1500
      : isReviewableWicket
        ? 2200
        : hasUmpireDecisionSignal
          ? 1200
          : 950;
    const noReplayResetMs = isBoundaryHit
      ? 2200
      : isReviewableWicket
        ? 2800
        : hasUmpireDecisionSignal
          ? 1500
          : 1200;

    if (shouldReplay && highlight) {
      this.activeReplayHighlight = highlight;
      if (replayReasonEl) {
        replayReasonEl.textContent = highlight.label;
      }

      this.pendingReplayStartTimer = setTimeout(() => {
        this.pendingReplayStartTimer = null;
        if (this.drsActive) return;
        if (replayBadge) {
          replayBadge.classList.remove('hidden');
        }
        this.isReplaying = true;
        this.replayIndex = Math.max(0, this.replayFrames.length - 54);
        this.cameraMode = 'replay';
      }, preReplayHoldMs);

      this.pendingReplayEndTimer = setTimeout(() => {
        this.pendingReplayEndTimer = null;
        if (this.drsActive) return;
        this.isReplaying = false;
        this.activeReplayHighlight = null;
        if (replayBadge) replayBadge.classList.add('hidden');
        this.cameraMode = this.savedCameraMode;
        this.resetBallAndFielders();
      }, preReplayHoldMs + 1850);
    } else {
      if (replayBadge) replayBadge.classList.add('hidden');
      this.postDeliveryResetTimer = setTimeout(() => {
        this.postDeliveryResetTimer = null;
        if (this.drsActive) return;
        this.cameraMode = this.savedCameraMode;
        this.resetBallAndFielders();
      }, noReplayResetMs);
    }

    if (this.match.isMatchOver) {
      this.autoBowlScheduled = false;
      const msg = this.ui.lang === 'hi' ? this.match.winnerTextHi : this.match.winnerTextEn;
      this.ui.showEventBanner('MATCH OVER', msg, 'text-emerald-400');
      sound.playCrowdReaction('six', 0);
      commentary.trigger('match_end', this.getCommentaryContext(), true);
      setTimeout(() => {
        if (!this.drsActive) {
          this.ui.renderScorecardAndWagonWheel();
          this.ui.openModal('modal-scorecard');
        }
      }, 2200);
    } else if (status.inningsEndState === 'super_over') {
      sound.playCrowdReaction('six', 0);
      this.ui.showEventBanner(
        '⚡ MATCH TIED · SUPER OVER!',
        '1-Over Sudden-Death Shootout Begins (2 Wickets Max)!',
        'text-amber-400'
      );
    } else if (status.inningsEndState === 'innings_break') {
      this.net.syncRoleToControllers(
        this.match.userRole,
        this.match.userRole === 'bat' ? 'bowl' : 'bat'
      );
      const firstTeam = this.match.firstInningsTeamNameEn || this.match.bowlingTeam.nameEn;
      const targetRuns = (this.match.firstInningsScore || 0) + 1;
      this.ui.showEventBanner(
        'INNINGS BREAK',
        `${firstTeam}: ${this.match.firstInningsScore}/${this.match.firstInningsWickets} · Target for ${this.match.battingTeam.nameEn}: ${targetRuns} Runs`,
        'text-amber-400'
      );
      setTimeout(() => {
        if (!this.match.isMatchOver) {
          this.ui.renderScorecardAndWagonWheel();
          this.ui.openModal('modal-scorecard');
        }
      }, 1800);
    } else if (status.freeHitNext) {
      this.ui.showEventBanner('FREE HIT NEXT BALL!', 'No-Ball Penalty (+1 Run)', 'text-amber-400');
    }
  }

  resetBallAndFielders() {
    if (this.pendingReplayStartTimer) {
      clearTimeout(this.pendingReplayStartTimer);
      this.pendingReplayStartTimer = null;
    }
    if (this.pendingReplayEndTimer) {
      clearTimeout(this.pendingReplayEndTimer);
      this.pendingReplayEndTimer = null;
    }
    if (this.postDeliveryResetTimer) {
      clearTimeout(this.postDeliveryResetTimer);
      this.postDeliveryResetTimer = null;
    }
    this.deliveryCompletedThisBall = false;
    this._ballWasHit = false;
    this.ballStateStuckTimer = 0;
    this.ballInPlayTimer = 0;
    this.impactFollowThroughUntil = 0;
    this.impactPunchFov = 0;
    this.impactKickVec.set(0, 0, 0);
    this._pendingFollowCam = false;
    this._zonePulseSentThisBall = false;
    if (this.cameraMode === 'follow' || this.cameraMode === 'replay') {
      this.cameraMode =
        this.savedCameraMode === 'broadcast' || this.savedCameraMode === 'pro' || this.savedCameraMode === 'overhead'
          ? this.savedCameraMode
          : 'pro';
      this._snapCameraNextFrame = true;
    }
    this.physics.reset();
    this.bowling.resetForNextBall();
    const isActivelyDraggingCrease = this.creaseDragPointerId !== null && this.creaseDragPointerId !== undefined;
    this.batting.resetForNextBall({ preserveWheelAim: false, resetCreaseX: !isActivelyDraggingCrease });
    if (typeof this.ui?.updateCreaseIndicatorUI === 'function') {
      this.ui.updateCreaseIndicatorUI();
    }
    if (this.batRibbonTrail) this.batRibbonTrail.clear();
    this.net.syncShotModeLock(this.batting.shotMode, false);
    this.ui.updateShotModeHUD();
    if (this.ui.cornerMenuOpen) {
      this.ui.showDeliveryPreview(
        {
          customStatusText: '⏸ GAME PAUSED · MENU OPEN',
          lengthCategory: 'good'
        },
        'always'
      );
    } else {
      this.ui.showDeliveryPreview(null, 'hidden');
    }

    // Bug 2 Fix + AI Captain Adaptive Field: Recalculate phase & hot-zone field immediately between deliveries
    this.fielding.applyAdaptiveField({
      modeId: this.match.modeId,
      userRole: this.match.userRole,
      isPowerplay: this.match.isPowerplayActive(),
      ballsRemaining: Math.max(0, this.match.totalOvers * 6 - this.match.legalBalls),
      totalOvers: this.match.totalOvers,
      bowlerType: this.bowling.bowlerType,
      recentShots: this.match.wagonWheel || []
    });
    this.fielding.resetToHomePositions(this.bowling.bowlerType);
    const presetSel = document.getElementById('select-field-preset');
    if (presetSel && presetSel.value !== this.fielding.setting) {
      presetSel.value = this.fielding.setting;
    }
    if (typeof this.ui.syncAngleWheelUI === 'function') {
      this.ui.syncAngleWheelUI();
    }
    this.strikerMeshZ = CREASE_Z + 0.14;
    this.nonStrikerMeshZ = -CREASE_Z - 0.18;

    if (this.strikerPlayer) this.strikerPlayer.playClip('stance', 0.2);
    if (this.nonStrikerPlayer) this.nonStrikerPlayer.playClip('stance', 0.2);
    if (this.bowlerPlayer) this.bowlerPlayer.playClip('idle', 0.2);
    if (this.keeperPlayer) this.keeperPlayer.playClip('idle', 0.2);
    this.fielderPlayers.forEach((fp) => fp.playClip('idle', 0.2));

    // Automatically schedule the bowler's next run-up with a comfortable 3.2s breather so the batter can get ready!
    if (!this.match.isMatchOver) {
      this.scheduleAutoBowl();
    }
  }

  /**
   * Moves batsman laterally in the crease by one discrete step in screen direction (-1 = Left, +1 = Right)
   */
  stepBatsmanCrease(screenDir = 1) {
    const dirSign = this.batting.screenRightSign || -1;
    const stepWorldX = screenDir * 0.11 * dirSign;
    this.batting.manualCreaseOverrideThisBall = true;
    this.batting.manualCreaseOffsetX = THREE.MathUtils.clamp(
      (this.batting.manualCreaseOffsetX || 0) + stepWorldX,
      -0.62,
      0.62
    );
    this.batting.creaseX = THREE.MathUtils.clamp(
      this.batting.manualCreaseOffsetX,
      -0.62,
      0.62
    );
    if (typeof this.ui?.updateCreaseIndicatorUI === 'function') {
      this.ui.updateCreaseIndicatorUI();
    }
  }

  /**
   * Simulates the remainder of the current over ball-by-ball and updates HUD & Scorecard
   */
  simulateCurrentOver() {
    if (this.match.isMatchOver) return;
    if (this.isReplaying || this.pendingReplayStartTimer) {
      this.skipReplay();
    }
    const simResult = this.match.simulateNextOver();
    this.rebuildTeamCharacters();
    this.resetBallAndFielders();
    this.updateMatchTension();
    this.ui.updateHUD();

    if (this.match.isMatchOver) {
      const msg = this.ui.lang === 'hi' ? this.match.winnerTextHi : this.match.winnerTextEn;
      this.ui.showEventBanner('MATCH OVER', msg, 'text-emerald-400');
      sound.playCrowdReaction('six', 0);
      commentary.trigger('match_end', this.getCommentaryContext(), true);
      setTimeout(() => {
        this.ui.renderScorecardAndWagonWheel();
        this.ui.openModal('modal-scorecard');
      }, 1200);
      return;
    }

    if (simResult.inningsChanged) {
      this.ui.showEventBanner(
        'INNINGS BREAK',
        `Target: ${(this.match.firstInningsScore || 0) + 1} Runs in ${this.match.totalOvers} Overs`,
        'text-amber-400'
      );
      return;
    }

    this.ui.showEventBanner(
      `OVER SIMULATED (+${simResult.runsInOver}R, ${simResult.wicketsInOver}W)`,
      `Score: ${this.match.runs}/${this.match.wickets} (${this.match.getOversFormatted()} Ov)`,
      'text-sky-400'
    );
  }

  /**
   * Resolves the Interactive Catch / Direct-Hit Reflex QTE when the player presses SPACE or taps CATCH!
   */
  triggerFieldingReflexQTE() {
    if (!this.qteActive || this.qteResolved) return;
    this.qteResolved = true;
    const isSweetSpot = this.qteProgress >= 0.34 && this.qteProgress <= 0.66;
    const qteBar = document.getElementById('hud-qte-bar');
    if (qteBar) qteBar.classList.add('hidden');
    this.qteActive = false;

    if (isSweetSpot) {
      sound.playUIClick(1680);
      // Boost fielder speed & catch reflexes on perfect QTE tap!
      this.fielding.fielders.forEach((f) => {
        f.pos.lerp(this.physics.pos, 0.26);
      });
      this.ui.showStatusToast('PERFECT REFLEX! Fielder diving in!', true);
    } else {
      sound.playUIClick(620);
      this.ui.showStatusToast('Early/Late Reflex Tap', false);
    }
  }

  renderScene() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Main 60 FPS Game Loop
   */
  animate(nowMs) {
    requestAnimationFrame(this.animate);

    const minInterval = 1000 / this.targetFps;
    if (this.targetFps === 30 && nowMs - this.lastFrameTime < minInterval - 2) {
      return;
    }
    this.lastFrameTime = nowMs;

    const rawDt = this.clock.getDelta();
    let dt = Math.min(rawDt, 0.05);

    // Pause entire gameplay loop (bowler run-up, ball flight, fielding, running, replays & auto-bowl countdown)
    // whenever the user opens the Corner Menu or any Modal!
    // Throttle background 3D rendering to ~15 FPS while in menus so TV remote navigation is instant.
    if (this.net.disconnectPaused || this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) {
      this.net.updateHeartbeat();
      this.updateCoinToss3D(dt);
      if (!this._lastMenuRenderMs || nowMs - this._lastMenuRenderMs >= 64) {
        this._lastMenuRenderMs = nowMs;
        this.updateCameras(dt);
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }

    // FPS Watchdog disabled: user wants full graphics; we trust TV browser performance tuning instead
    // (Previously auto-dropped preset on slow frames — removed per user request)

    // Cinematic slow motion (stumps flying etc.) - eases back to normal speed
    if (this.slowMoUntil && performance.now() < this.slowMoUntil) {
      dt *= this.slowMoScale || 0.4;
    } else if (this.slowMoUntil) {
      this.slowMoUntil = 0;
    }
    this.net.updateHeartbeat();
    this.updateDustPuffs(dt);
    this.updateCoinToss3D(dt);

    // Slow-Motion Highlight Replay Playback (0.28x speed)
    if (this.isReplaying && this.replayFrames.length > 0) {
      const idx = Math.min(this.replayFrames.length - 1, Math.floor(this.replayIndex));
      const frame = this.replayFrames[idx];
      this.ballGroup.position.copy(frame.ballPos);
      this.ballGroup.quaternion.copy(frame.ballQuat);
      this.ballShadow.position.set(frame.ballPos.x, 0.03, frame.ballPos.z);

      const batPivot = this.strikerMesh?.userData?.batPivot;
      if (batPivot && frame.batQuat) {
        batPivot.quaternion.copy(frame.batQuat);
      }

      this.replayIndex += this.replaySpeed;
      if (this.replayIndex >= this.replayFrames.length) {
        this.replayIndex = Math.max(0, this.replayFrames.length - 62);
      }

      if (this.strikerPlayer) this.strikerPlayer.update(dt * this.replaySpeed);
      if (this.bowlerPlayer) this.bowlerPlayer.update(dt * this.replaySpeed);
      if (this.keeperPlayer) this.keeperPlayer.update(dt * this.replaySpeed);
      this.fielderPlayers.forEach((fp) => fp.update(dt * this.replaySpeed, this.camera.position));

      this.updateCameras(dt);
      this.renderScene();
      return;
    }

    // 1. Update Batting Stance & Crease Movement
    this.batting.updateFrame(dt);

    // 1.5 Automatic Pre-Delivery Bowler Countdown & Stuck-Idle Watchdog
    // Ensures the bowler ALWAYS bowls automatically once Play Gate (modal-qr) is confirmed!
    if (
      this.matchPlayConfirmed &&
      !this.ui.isAnyModalOpen() &&
      !this.ui.cornerMenuOpen &&
      !this.match.isMatchOver
    ) {
      if (
        this.physics.state === 'dead' &&
        !this.drsActive &&
        !this.isReplaying &&
        !this.pendingReplayStartTimer &&
        !this.pendingReplayEndTimer &&
        !this.postDeliveryResetTimer
      ) {
        this.deadStateSafetyTimer = (this.deadStateSafetyTimer || 0) + dt;
        if (this.deadStateSafetyTimer >= 0.85) {
          this.deadStateSafetyTimer = 0;
          this.resetBallAndFielders();
        }
      } else {
        this.deadStateSafetyTimer = 0;
      }

      if (
        this.physics.state === 'idle' &&
        !this.autoBowlScheduled &&
        !this.isReplaying &&
        !this.pendingReplayStartTimer &&
        (this.match.userRole === 'bat' || gameConfig.autoBowl !== 'manual')
      ) {
        this.scheduleAutoBowl();
      }
    }

    if (
      this.matchPlayConfirmed &&
      this.physics.state === 'idle' &&
      this.autoBowlScheduled &&
      (this.match.userRole === 'bat' || gameConfig.autoBowl !== 'manual') &&
      !this.match.isMatchOver &&
      !this.isReplaying &&
      !this.pendingReplayStartTimer &&
      !this.ui.isAnyModalOpen() &&
      !this.ui.cornerMenuOpen
    ) {
      this.autoBowlCountdown -= dt;
      const secLeft = Math.max(0, Math.ceil(this.autoBowlCountdown));
      if (secLeft !== this.lastCountdownWholeSec && secLeft > 0) {
        this.lastCountdownWholeSec = secLeft;
        const activeBowler = this.match.getActiveBowler();
        const sideLbl = this.bowling.bowlerSide === 'around' ? 'Around' : 'Over';
        this.ui.showDeliveryPreview(
          {
            customStatusText: `${activeBowler.name} (${sideLbl} Wicket) · Bowling in ${this.autoBowlCountdown.toFixed(1)}s`,
            lengthCategory: 'good'
          },
          'always'
        );
      }
      if (this.autoBowlCountdown <= 0) {
        this.autoBowlScheduled = false;
        this.startNextDelivery();
      }
    }

    // 2. Update Bowler Run-up, Delivery Gather Jump, 3D Pitching Bullseye Reveal & Post-Release Follow-Through
    if (this.physics.state === 'runup') {
      if (this.match.userRole === 'bowl' && typeof this.ui.updateBowlingReleaseMeter === 'function') {
        this.ui.updateBowlingReleaseMeter(this.bowling.runupProgress, true);
      }
      this.bowling.updateRunup(
        dt,
        () => {
          if (typeof this.ui.updateBowlingReleaseMeter === 'function') {
            this.ui.updateBowlingReleaseMeter(1, false);
          }
          if (this.bowling.state !== 'released') {
            if (this.match.userRole === 'bat') {
              const aiDelivery =
                this.pendingAIDelivery ||
                this.bowling.generateAIDelivery(this.match.difficulty, this.match.legalBalls, this.handedness);
              this.pendingAIDelivery = null;
              this.releaseBowledBall(aiDelivery);
            } else {
              const manualDelivery = this.bowling.triggerManualDelivery(0.86);
              if (this.online1v1Active) {
                this.net.sendOnlineBowlRelease(manualDelivery);
              }
              this.releaseBowledBall(manualDelivery);
            }
          }
        },
        (stepIdx, progress) => {
          // Play rhythmic run-up footsteps as bowler charges in
          sound.playFootstepAndBreath(2.2 + progress * 0.8);
          // Pro Feature 1: Pre-Release Bowler Hand & Pitching Spot Cue during delivery gather stride
          if (this.match.userRole === 'bat' && this.pendingAIDelivery) {
            const diffId = this.match.difficulty;
            const revealThreshold =
              diffId === 'legend' || diffId === 'hard'
                ? 0.72
                : diffId === 'pro' || diffId === 'medium'
                  ? 0.44
                  : 0.32;
            if (progress >= revealThreshold) {
              this.aimRing.visible = true;
              const pulse = 1 + Math.sin(progress * Math.PI * 6) * 0.14;
              this.aimRing.scale.set(pulse, pulse, 1);
            }
          }
        }
      );
    } else if (this.physics.state === 'bowled') {
      if (typeof this.ui.updateBowlingReleaseMeter === 'function') {
        this.ui.updateBowlingReleaseMeter(0, false);
      }
      // Continue bowler's natural post-release follow-through stride down the pitch
      this.bowling.updateRunup(dt);

      // Auto-adjust human batsman's left/right crease position (difficulty-scaled so Medium/Hard preserve real swing/spin line!)
      if (this.match.userRole === 'bat') {
        this.batting.autoTrackBallPosition(this.physics, dt, this.match.difficulty);
      }

      // Live Color-Coded Pitch Marker + Shrinking Timing Ring (zero allocations, 60 FPS on Smart TV!)
      const diffProfile = getDifficultyProfile(this.match.difficulty);
      const assist = diffProfile ? diffProfile.battingAssist : 'light';
      if (this.match.userRole === 'bat' && this.timingOuterRing && !this.batting.shotExecutedThisBall) {
        const nowSec = performance.now() * 0.001;
        const totalFlight = Math.max(0.28, (this.physics.idealContactTime || nowSec + 0.5) - (this._ballReleaseTimeSec || nowSec - 0.1));
        const remSec = (this.physics.idealContactTime || nowSec) - nowSec;
        const flightProgress = THREE.MathUtils.clamp(1.0 - remSec / totalFlight, 0, 1.15);
        const ringScale = THREE.MathUtils.clamp(2.15 - flightProgress * 1.18, 0.85, 2.15);
        this.timingOuterRing.visible = true;
        this.timingOuterRing.scale.setScalar(ringScale);

        const perfectSec = ((diffProfile?.timingWindowMs?.perfect || 72) + 20) * 0.001;
        const inSweetZone = Math.abs(remSec - 0.08) <= perfectSec;
        if (inSweetZone) {
          if (!this._zonePulseSentThisBall) {
            this._zonePulseSentThisBall = true;
            this.net.vibratePhone('p1', [14], '⚡ SWEET ZONE · SWING NOW!');
          }
          if (this.timingRingMat) {
            this.timingRingMat.color.setHex(0xffffff);
            this.timingRingMat.opacity = 0.98;
          }
          this.aimRing.scale.setScalar(assist === 'off' ? 1.06 : 1.14);
        } else {
          if (this.timingRingMat) {
            this.timingRingMat.color.setHex(this._currentLengthColorHex || 0xeab308);
            this.timingRingMat.opacity = 0.82;
          }
          this.aimRing.scale.setScalar(1.0);
        }
      }
    }

    // Smoothly transition from brief impact follow-through linger into outfield follow camera
    if (
      this._pendingFollowCam &&
      performance.now() >= (this.impactFollowThroughUntil || 0)
    ) {
      this._pendingFollowCam = false;
      if (this.physics.state === 'hit' || this.physics.state === 'boundary_flight') {
        this.cameraMode = 'follow';
      }
    }

    // 3. AI Batsman when Human is Bowling
    if (this.physics.state === 'bowled' && this.match.userRole === 'bowl') {
      this.batting.updateAIBatsman(this.physics, this.match.difficulty, {
        onBallHit: (info, isEdge) => {
          this._ballWasHit = true;
          this.triggerStrikerMocapShot(info.shotKey, { isSweet: !isEdge });
          sound.playBatHit(info.timingQuality, !isEdge, isEdge ? 'thin_edge' : 'sweet', this.getBallPan());
          if (this.aliveBatsman) {
            this.aliveBatsman.triggerBatImpactRecoil(!isEdge, info.exitSpeedKmh);
          }
          if (this.impactVFX) {
            this.impactVFX.spawnBatHitBurst(this.physics.pos, this.physics.vel, !isEdge, false);
          }
          if (info.contactType !== 'Played-On (Inside Edge)') {
            if (this.cameraMode === 'broadcast' || this.cameraMode === 'pro' || this.cameraMode === 'overhead') {
              this.savedCameraMode = this.cameraMode;
            }
            this.cameraMode = 'follow';
            // Smart AI running: only sprint if the ball is hit with enough pace into a safe gap away from fielders
            const predX = this.physics.pos.x + this.physics.vel.x * 1.05;
            const predZ = this.physics.pos.z + this.physics.vel.z * 1.05;
            const minFielderDist = this.fielding.fielders.reduce(
              (minD, f) => Math.min(minD, Math.hypot(predX - f.pos.x, predZ - f.pos.z)),
              99
            );
            if (info.exitSpeedKmh > 38 && minFielderDist > 8.2) {
              this.startSingleRunSprint();
            }
          }
          this.ui.updateHUD();
        }
      });
    }

    // 4. Evaluate Bat Contact if player initiated swing as ball approaches/crosses crease
    if (this.physics.state === 'bowled' && this.physics.pos.z >= CREASE_Z - 1.85) {
      this.checkAndExecuteBattingContact();
    }

    // 4.5 Heavy Meat-on-Leather Hit-Stop Freeze (56ms on Sweet Spot) for both ball physics AND bat animation!
    let physicsDt = dt;
    let strikerImpactDt = dt;
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      physicsDt = dt * 0.06;
      strikerImpactDt = dt * 0.14;
    }

    // 5. Step Ball Physics (keep live batsman creaseX & handedness synced for Wide Guideline & LBW rules)
    this.physics.currentBatsmanX = this.batting.creaseX || 0;
    this.physics.currentHandedness = this.handedness || 'right';
    this.physics.update(physicsDt, {
      onPitchBounce: (bouncePos, surface, localWear) => {
        const pan = THREE.MathUtils.clamp(bouncePos.x / 20.0, -0.9, 0.9);
        sound.playPitchBounce(surface, this.physics.speedKmh, pan);
        this.bounceMarker.position.set(bouncePos.x, 0.04, bouncePos.z);
        this.bounceMarker.visible = true;
        this.pitchSurface.stampBallBounceWear(bouncePos.x, bouncePos.z);
        this.spawnDustPuff(bouncePos, localWear);
        if (this.impactVFX) {
          this.impactVFX.spawnPitchBounceRipple(bouncePos, this.physics.speedKmh);
        }
        if (this.match.userRole === 'bat') {
          const bz = bouncePos.z;
          const lengthTag =
            bz < 3.2
              ? { text: '🔴 SHORT BALL · PULL / HOOK / CUT', cat: 'short' }
              : bz >= 7.5
                ? { text: '🔵 YORKER · DIG / SCOOP', cat: 'yorker' }
                : bz >= 5.0
                  ? { text: '🟢 FULL · DRIVE / LOFT ZONE', cat: 'full' }
                  : { text: '🟡 GOOD LENGTH · TIME THE SWING', cat: 'good' };
          this.ui.showDeliveryPreview(
            { customStatusText: lengthTag.text, lengthCategory: lengthTag.cat },
            'briefly'
          );
        }
        this.ui.updateHUD();
      },
      onOutfieldBounce: (pos) => {
        const pan = THREE.MathUtils.clamp(pos.x / 28.0, -0.92, 0.92);
        sound.playPitchBounce('club', this.physics.vel.length() * 3.6, pan);
        this.spawnDustPuff(pos, 0.25);
      },
      onStumpsHit: (end) => {
        this.dislodgeWickets(end);
        this.net.vibratePhone('p1', [150, 60, 200]);
        if (this.physics.isNoBall || this.match.freeHit) {
          sound.playUmpireSignal('no_ball');
          this.ui.showEventBanner(
            this.physics.isNoBall ? 'NO BALL · NOT OUT!' : 'FREE HIT · NOT OUT!',
            'Stumps hit, but batter cannot be Bowled on a No-Ball / Free Hit!',
            'text-emerald-400'
          );
          this.completeDelivery({
            runsScored: 0,
            isWicket: false,
            isNoBall: this.physics.isNoBall
          });
          return;
        }
        this.triggerTeamCelebration();
        sound.playCrowdReaction('wicket', 0);
        const isPlayedOn = this.batting.lastContact.contactType === 'Played-On (Inside Edge)';
        this.registerReplayHighlight({
          category: 'wicket',
          priority: 100,
          label: 'WICKET: BOWLED',
          cameraStyle: 'stumps',
          focusPos: new THREE.Vector3(0, 0.55, PITCH_HALF_LENGTH)
        });
        this.ui.showEventBanner(isPlayedOn ? 'PLAYED ON · BOWLED!' : 'BOWLED HIM!', 'Timber! Stumps shattered!', 'text-red-500');
        commentary.trigger('wicket_bowled', this.getCommentaryContext(), true);
        this.completeDelivery({
          runsScored: 0,
          isWicket: true,
          isNoBall: this.physics.isNoBall,
          wicketTypeEn: 'Bowled',
          wicketTypeHi: 'बोल्ड'
        });
      },
      onBallThroughToKeeper: (ball) => {
        const pan = this.getBallPan();
        if (this.keeperPlayer) this.keeperPlayer.playClip('catch', 0.1);
        sound.playKeeperGloves(ball.speedKmh, pan);

        if (ball.isNoBall) {
          sound.playUmpireSignal('no_ball');
          const reasonSub = ball.noBallReason ? `${ball.noBallReason} · +1 Extra Run` : '+1 Extra Run & Free Hit Next Ball';
          this.ui.showEventBanner('NO BALL · FREE HIT!', reasonSub, 'text-amber-400');
          commentary.trigger('no_ball', this.getCommentaryContext(), true);
          this.completeDelivery({ runsScored: 0, isNoBall: true });
          return;
        }
        if (ball.isWide) {
          sound.playUmpireSignal('whistle');
          const wideSub = ball.wideReason ? `${ball.wideReason} · +1 Extra Run & Re-Bowl` : '+1 Extra Run & Re-Bowl';
          this.ui.showEventBanner('WIDE BALL', wideSub, 'text-sky-400');
          commentary.trigger('wide_ball', this.getCommentaryContext());
          this.completeDelivery({ runsScored: 0, isWide: true });
          return;
        }

        // 1. LBW check when batter missed the ball in front of the stumps (not out on Free Hit!)
        if (!this.batting.shotExecutedThisBall && !this.match.freeHit && ball.checkLBW(this.batting.creaseX, this.handedness)) {
          sound.playPadHit(pan);
          sound.playCrowdReaction('wicket', pan);
          this.triggerTeamCelebration();
          this.registerReplayHighlight({
            category: 'wicket',
            priority: 100,
            label: 'WICKET: LBW',
            cameraStyle: 'stumps',
            focusPos: new THREE.Vector3(0, 0.52, PITCH_HALF_LENGTH - 0.8)
          });
          this.ui.showEventBanner('OUT · LBW!', 'Plumb in front of middle stump!', 'text-red-500');
          commentary.trigger('wicket_lbw', this.getCommentaryContext(), true);
          this.completeDelivery({
            runsScored: 0,
            isWicket: true,
            wicketTypeEn: 'LBW',
            wicketTypeHi: 'एलबीडब्ल्यू (LBW)'
          });
          return;
        }

        // 2. MCC Law 39 Stumping: If batter stepped out of their ground in front of the Popping Crease (CREASE_Z = 8.84m)
        // and missed the ball (not out on Free Hit or No-Ball!), Wicketkeeper whips off the bails!
        if (
          !this.match.freeHit &&
          !ball.isNoBall &&
          (!this.batting.shotExecutedThisBall || !this.batting.lastContact.didHit) &&
          this.batting.creaseZOffset >= 0.30
        ) {
          if (this.fielding?.keeper) {
            this.fielding.keeper.pos.set(0.12, 0, PITCH_HALF_LENGTH + 0.28);
          }
          if (this.keeperPlayer) {
            this.keeperPlayer.playClip('throw', 0.06, 1.35);
          }
          this.dislodgeWickets('striker');
          this.triggerTeamCelebration();
          sound.playCrowdReaction('wicket', pan);
          this.registerReplayHighlight({
            category: 'wicket',
            priority: 100,
            label: 'WICKET: STUMPED',
            cameraStyle: 'stumps',
            focusPos: new THREE.Vector3(0, 0.55, PITCH_HALF_LENGTH)
          });
          this.ui.showEventBanner(
            'OUT · STUMPED!',
            'Batter out of the Popping Crease — Keeper whips the bails off in a flash!',
            'text-red-500'
          );
          commentary.trigger('wicket_stumped', this.getCommentaryContext(), true);
          this.completeDelivery({
            runsScored: 0,
            isWicket: true,
            wicketTypeEn: 'Stumped',
            wicketTypeHi: 'स्टम्प आउट'
          });
          return;
        }

        // 3. Near Miss on the Stumps (ball shaved past off/leg stump within 6.5 cm)
        if (
          Math.abs(ball.pos.x) <= STUMP_WIDTH * 0.5 + 0.065 &&
          ball.pos.y <= STUMP_HEIGHT + 0.08
        ) {
          sound.playCrowdReaction('near_miss', pan);
          this.registerReplayHighlight({
            category: 'edge_nearmiss',
            priority: 50,
            label: 'NEAR MISS ON STUMPS',
            cameraStyle: 'stumps',
            focusPos: new THREE.Vector3(0, 0.55, PITCH_HALF_LENGTH)
          });
          commentary.trigger('near_miss', this.getCommentaryContext());
          this.completeDelivery({ runsScored: 0 });
          return;
        }

        // Ordinary dot ball / leave -> NO replay!
        commentary.trigger('dot_ball', this.getCommentaryContext());
        this.completeDelivery({ runsScored: 0 });
      },
      onStandBounce: (pos) => {
        const pan = THREE.MathUtils.clamp(pos.x / 32.0, -0.92, 0.92);
        sound.playBoundaryRope(pan);
        this.spawnDustPuff(pos, 0.75);
        if (this.impactVFX) {
          this.impactVFX.spawnBatHitBurst(pos, new THREE.Vector3(0, 4, 0), true, true);
        }
      },
      onBoundary: (runs, ball) => {
        const pan = this.getBallPan();
        sound.playBoundaryRope(pan);
        sound.playCrowdReaction(runs === 6 ? 'six' : 'four', pan);
        this.net.vibratePhone('p1', runs === 6 ? [100, 50, 140, 50, 180] : [90, 50, 120]);
        this.registerReplayHighlight({
          category: 'boundary',
          priority: runs === 6 ? 84 : 80,
          label: runs === 6 ? 'SIX' : 'FOUR',
          cameraStyle: 'follow_ball',
          focusPos: ball.pos.clone()
        });
        if (runs === 6) {
          this.ui.showEventBanner('MAXIMUM SIX!', `${Math.round(ball.shotDistance)}m · Launch ${this.batting.lastLaunchAngleDeg}°`, 'text-amber-400');
          commentary.trigger('six', this.getCommentaryContext(), true);
        } else {
          const modeLbl = this.batting.shotMode === 'fly' ? 'LOFT' : 'GROUND';
          this.ui.showEventBanner('FOUR RUNS!', `Cracking ${modeLbl} shot (${this.batting.lastLaunchAngleDeg}°)!`, 'text-sky-400');
          commentary.trigger('four', this.getCommentaryContext(), true);
        }
        this.completeDelivery({
          runsScored: runs,
          isBoundary: true,
          isNoBall: ball.isNoBall,
          shotAngleRad: ball.shotAngleRad,
          shotDistance: ball.shotDistance
        });
      }
    });

    // Outfield rolling grass rustle sound while ball is rolling along the turf
    if (
      this.physics.state === 'hit' &&
      this.physics.bouncedAfterHit &&
      this.physics.pos.y <= 0.08 &&
      this.physics.vel.length() > 1.8
    ) {
      sound.playBallRolling(this.physics.vel.length(), this.getBallPan());
    }

    // Record frames during delivery, hit, and boundary_flight for Slow-Motion Highlight Replays
    if (
      this.physics.state === 'bowled' ||
      this.physics.state === 'hit' ||
      this.physics.state === 'fielded' ||
      this.physics.state === 'boundary_flight'
    ) {
      const batPivot = this.strikerMesh?.userData?.batPivot;
      this.replayFrames.push({
        ballPos: this.physics.pos.clone(),
        ballQuat: this.physics.ballQuat.clone(),
        batQuat: batPivot ? batPivot.quaternion.clone() : null
      });
      if (this.replayFrames.length > 195) {
        this.replayFrames.shift();
      }
    }

    // 6. Step 9 AI Fielders + Wicketkeeper with Catch, Dive, Relay Throw & Celebration Animations
    this.fielding.update(dt, this.physics, this.match.difficulty, {
      onCaught: (fielder, isCaughtBehind, catchPct, isDivingCatch = false) => {
        const pan = THREE.MathUtils.clamp(fielder.pos.x / 28.0, -0.92, 0.92);
        if (isCaughtBehind) {
          sound.playKeeperGloves(130, pan);
        } else {
          sound.playCatchThud(pan);
        }
        sound.playCrowdReaction('wicket', pan);
        this.net.vibratePhone('p1', [140, 60, 140]);
        const catchClip = isDivingCatch ? 'dive' : 'catch';
        if (fielder.id === 'keeper' && this.keeperPlayer) {
          this.keeperPlayer.playClip(catchClip, 0.06, isDivingCatch ? 1.25 : 1.0);
          if (isDivingCatch) this.spawnDustPuff(fielder.pos, 0.55);
        } else {
          const fIdx = this.fielding.fielders.indexOf(fielder);
          if (fIdx >= 0 && this.fielderPlayers[fIdx]) {
            this.fielderPlayers[fIdx].playClip(catchClip, 0.06, isDivingCatch ? 1.25 : 1.0);
            if (isDivingCatch) this.spawnDustPuff(fielder.pos, 0.55);
          }
        }
        this.triggerTeamCelebration();

        this.registerReplayHighlight({
          category: 'wicket',
          priority: 100,
          label: isCaughtBehind
            ? isDivingCatch
              ? 'WICKET: DIVING CAUGHT BEHIND'
              : 'WICKET: CAUGHT BEHIND'
            : isDivingCatch
              ? 'WICKET: DIVING CATCH'
              : 'WICKET: CAUGHT',
          cameraStyle: 'fielder',
          focusPos: fielder.pos.clone()
        });

        const title = isCaughtBehind
          ? isDivingCatch
            ? 'DIVING CAUGHT BEHIND!'
            : 'CAUGHT BEHIND!'
          : isDivingCatch
            ? 'ONE-HANDED DIVING CATCH!'
            : 'OUT · CAUGHT!';
        const sub = `Taken by ${fielder.role} (Catch Prob: ${catchPct}%)`;
        this.ui.showEventBanner(title, sub, 'text-red-500');
        commentary.trigger('wicket_caught', this.getCommentaryContext({ fielder: fielder.role }), true);
        this.completeDelivery({
          runsScored: 0,
          isWicket: true,
          isNoBall: this.physics.isNoBall,
          wicketTypeEn: isCaughtBehind ? 'Caught Behind' : `c ${fielder.role}`,
          wicketTypeHi: isCaughtBehind ? 'विकेटकीपर कैच' : 'कैच आउट'
        });
      },
      onCatchDropped: (fielder, catchPct) => {
        const pan = THREE.MathUtils.clamp(fielder.pos.x / 28.0, -0.92, 0.92);
        sound.playCatchThud(pan);
        sound.playCrowdReaction('dropped_catch', pan);
        const fIdx = this.fielding.fielders.indexOf(fielder);
        if (fIdx >= 0 && this.fielderPlayers[fIdx]) {
          this.fielderPlayers[fIdx].playClip('dive', 0.1);
          this.spawnDustPuff(fielder.pos, 0.5);
        }
        this.registerReplayHighlight({
          category: 'drop',
          priority: 70,
          label: 'CATCH DROPPED',
          cameraStyle: 'fielder',
          focusPos: fielder.pos.clone()
        });
        this.ui.showEventBanner('DROPPED CATCH!', `Spilled by ${fielder.role} (${catchPct}% chance)!`, 'text-amber-400');
        commentary.trigger('dropped_catch', this.getCommentaryContext({ fielder: fielder.role }), true);
      },
      onDiveStop: (fielder) => {
        const pan = THREE.MathUtils.clamp(fielder.pos.x / 28.0, -0.92, 0.92);
        sound.playCatchThud(pan);
        sound.playCrowdReaction('near_miss', pan);
        const fIdx = this.fielding.fielders.indexOf(fielder);
        if (fIdx >= 0 && this.fielderPlayers[fIdx]) {
          this.fielderPlayers[fIdx].playClip('dive', 0.08, 1.25);
          this.spawnDustPuff(fielder.pos, 0.65);
        }
        this.ui.showStatusToast(`🧤 GREAT DIVE STOP by ${fielder.role}! Saved a boundary!`, true);
        this.ui.setCommentary(
          `Acrobatic full-stretch dive by ${fielder.role} inside the ring stops a certain FOUR!`,
          `${fielder.role} की शानदार डाइव! निश्चित चौका रोका!`
        );
      },
      onFielded: (fielder) => {
        const pan = THREE.MathUtils.clamp(fielder.pos.x / 28.0, -0.92, 0.92);
        sound.playCatchThud(pan);
        if (fielder.id === 'keeper' && this.keeperPlayer) {
          this.keeperPlayer.playClip('throw', 0.05, 1.25);
          this.spawnDustPuff(fielder.pos, 0.35);
        } else {
          const fIdx = this.fielding.fielders.indexOf(fielder);
          if (fIdx >= 0 && this.fielderPlayers[fIdx]) {
            this.fielderPlayers[fIdx].playClip('throw', 0.05, 1.25);
            this.spawnDustPuff(fielder.pos, 0.45);
          }
        }
        // Bullet pickup & overarm throw back to the stumps synced with throw animation release!
        if (!this.runnersInMotion && !this.runnerStoppedMidPitch && this.runnerProgress <= 0.05) {
          this.fielding.pickupDelayTimer = 0.12;
          this.fielding.pickupInitialDelay = 0.12;
          this.fielding.throwSpeed = 31.5;
        } else {
          this.fielding.pickupDelayTimer = 0.16;
          this.fielding.pickupInitialDelay = 0.16;
          this.fielding.throwSpeed = 29.0;
        }
      },
      onRelayCatch: (relayFielder) => {
        const pan = THREE.MathUtils.clamp(relayFielder.pos.x / 28.0, -0.92, 0.92);
        sound.playCatchThud(pan);
        const fIdx = this.fielding.fielders.indexOf(relayFielder);
        if (fIdx >= 0 && this.fielderPlayers[fIdx]) {
          this.fielderPlayers[fIdx].playClip('throw', 0.05, 1.35);
        }
      },
      onThrowWindup: (fielder) => {
        if (fielder.id === 'keeper' && this.keeperPlayer) {
          this.keeperPlayer.playClip('throw', 0.05, 1.3);
        } else {
          const fIdx = this.fielding.fielders.indexOf(fielder);
          if (fIdx >= 0 && this.fielderPlayers[fIdx]) {
            this.fielderPlayers[fIdx].playClip('throw', 0.05, 1.3);
          }
        }
      },
      onThrowRelease: (fielder) => {
        if (fielder.id === 'keeper' && this.keeperPlayer) {
          if (this.keeperPlayer.currentClipName !== 'throw') {
            this.keeperPlayer.playClip('throw', 0.04, 1.35);
          }
        } else {
          const fIdx = this.fielding.fielders.indexOf(fielder);
          if (fIdx >= 0 && this.fielderPlayers[fIdx] && this.fielderPlayers[fIdx].currentClipName !== 'throw') {
            this.fielderPlayers[fIdx].playClip('throw', 0.04, 1.35);
          }
        }
      },
      onThrowReachedStumps: (targetEnd) => {
        const targetZ = targetEnd === 'striker' ? PITCH_HALF_LENGTH : -PITCH_HALF_LENGTH;
        this.throwCatchCameraHoldUntil = performance.now() + 420;
        sound.playKeeperGloves(120, 0);
        if (targetEnd === 'striker' && this.keeperPlayer) {
          this.keeperPlayer.playClip('catch', 0.08);
        } else if (targetEnd === 'nonStriker' && this.bowlerPlayer) {
          this.bowlerPlayer.playClip('catch', 0.08);
        }

        // Realistic Crease Dive & Safe Return Window:
        // - If batter is >= 80% of the way to the target crease, they slide/dive their bat safely in!
        // - If batter pressed NO RUN (runnerReturning) and is within 32% of their starting crease, they dive back safely!
        // - If batter never pressed RUN (progress <= 0.16), they are 100% safe in the crease!
        const safeProgressThreshold = 0.80;
        const safeReturnThreshold = this.runnerReturning ? 0.32 : 0.16;
        const isDivingSafe =
          this.runnersInMotion && !this.runnerReturning && this.runnerProgress >= safeProgressThreshold;
        const isReturningDiveSafe =
          this.runnersInMotion && this.runnerReturning && this.runnerProgress <= safeReturnThreshold;
        const isOutOfCrease =
          (this.runnersInMotion || this.runnerStoppedMidPitch) &&
          this.runnerProgress > safeReturnThreshold &&
          this.runnerProgress < safeProgressThreshold;

        if (isOutOfCrease) {
          this.dislodgeWickets(targetEnd);
          sound.playCrowdReaction('wicket', 0);
          this.triggerTeamCelebration();
          this.registerReplayHighlight({
            category: 'wicket',
            priority: 100,
            label: 'WICKET: RUN OUT',
            cameraStyle: 'side_on',
            focusPos: new THREE.Vector3(0, 0.55, targetZ),
            targetEnd
          });
          // Bug 1 Fix: Attribute Run Out to whichever batter (Striker or Non-Striker) was actually running to targetEnd!
          const distStrikerToTarget = Math.abs((this.strikerMeshZ ?? CREASE_Z) - targetZ);
          const distNonStrikerToTarget = Math.abs((this.nonStrikerMeshZ ?? -CREASE_Z) - targetZ);
          const runOutVictim = distNonStrikerToTarget < distStrikerToTarget ? 'nonStriker' : 'striker';
          const victimObj =
            runOutVictim === 'nonStriker' ? this.match.getActiveNonStriker() : this.match.getActiveStriker();
          const reason = `${victimObj?.name || 'Batter'} caught short of the crease by a direct hit!`;
          this.ui.showEventBanner('OUT · RUN OUT!', reason, 'text-red-500');
          commentary.trigger('wicket_runout', this.getCommentaryContext(), true);
          this.completeDelivery({
            runsScored: this.runsCompletedThisBall,
            isWicket: true,
            isNoBall: this.physics.isNoBall,
            wicketTypeEn: 'Run Out',
            wicketTypeHi: 'रन आउट',
            runOutVictim,
            runnerProgressAtDismissal: this.runnerProgress,
            isDiveSafe: false
          });
        } else {
          // Runner safely inside the crease or slid bat in on a tight dive!
          if (isDivingSafe) {
            if (this.runnerProgress < 0.96) {
              this.spawnDustPuff(new THREE.Vector3(0, 0.05, targetZ), 0.55);
              this.net.vibratePhone('p1', [50, 30, 60]);
              this.ui.showStatusToast('🏏 DIVE SAFE! Bat slid over the crease in time!', true);
            }
            this.runsCompletedThisBall++;
            this.runnerProgress = 0;
          } else if (isReturningDiveSafe) {
            this.spawnDustPuff(new THREE.Vector3(0, 0.05, targetZ), 0.45);
            this.ui.showStatusToast('🛑 SAFE IN CREASE! Returned in time!', true);
            this.runnerProgress = 0;
          }
          this.runnersInMotion = false;
          this.runnerReturning = false;
          this.runnerStoppedMidPitch = false;
          const totalRuns = this.runsCompletedThisBall;
          if (totalRuns > 0) {
            this.ui.showEventBanner(`${totalRuns} RUN${totalRuns > 1 ? 'S' : ''}`, 'Safe in the crease!', 'text-emerald-400');
          }
          commentary.trigger(
            totalRuns >= 3 ? 'three_runs' : totalRuns === 2 ? 'two_runs' : totalRuns === 1 ? 'single' : 'dot_ball',
            this.getCommentaryContext()
          );
          this.completeDelivery({
            runsScored: totalRuns,
            isNoBall: this.physics.isNoBall,
            shotAngleRad: this.physics.shotAngleRad,
            shotDistance: this.physics.shotDistance
          });
        }
      }
    });

    // 6.5 Dead-Ball / Stuck-State Watchdog: Guarantees the game can NEVER freeze if a ball stops moving
    // in 'bowled', 'hit', or 'fielded' state without triggering a normal completion callback.
    if (
      !this.deliveryCompletedThisBall &&
      (this.physics.state === 'bowled' || this.physics.state === 'hit' || this.physics.state === 'fielded')
    ) {
      this.ballInPlayTimer = (this.ballInPlayTimer || 0) + dt;
      const ballSpd = this.physics.vel.length();
      const isStationary =
        this.physics.state === 'fielded'
          ? !this.fielding.throwInFlight && this.fielding.pickupDelayTimer <= 0.02
          : ballSpd < 0.35;
      if (isStationary && !this.runnersInMotion) {
        this.ballStateStuckTimer = (this.ballStateStuckTimer || 0) + dt;
      } else {
        this.ballStateStuckTimer = 0;
      }
      if (this.ballStateStuckTimer > 1.15 || this.ballInPlayTimer > 9.5) {
        this.ballStateStuckTimer = 0;
        this.ballInPlayTimer = 0;
        this.completeDelivery({
          runsScored: this.runsCompletedThisBall || 0,
          isNoBall: this.physics.isNoBall,
          shotAngleRad: this.physics.shotAngleRad,
          shotDistance: this.physics.shotDistance
        });
      }
    }

    // 7. Update Running Between Wickets (1-Click RUN & NO RUN Buttons + Live 2D Field Radar Sync)
    const isBallInPlayForRun = this.physics.state === 'hit' || this.physics.state === 'fielded';
    if (
      isBallInPlayForRun &&
      (this.batting.runWindowActive || this.runnersInMotion || this.runnerStoppedMidPitch || this.runsCompletedThisBall > 0)
    ) {
      let activeSpeed = 0;
      let displayCadence = 0;

      if (this.runnersInMotion) {
        if (this.runnerReturning) {
          // Fast emergency return sprint/dive when user taps NO RUN!
          activeSpeed = 1.58;
          displayCadence = 4.2;
        } else {
          // Athletic full sprint between the wickets!
          activeSpeed = 1.24;
          displayCadence = 3.6;
        }
        this.runnerStoppedMidPitch = false;
      }

      if (activeSpeed > 0) {
        const dir = this.runnerReturning ? -1 : 1;
        this.runnerProgress += dir * dt * activeSpeed;
        sound.playFootstepAndBreath(displayCadence);
      }

      const clampedProg = THREE.MathUtils.clamp(this.runnerProgress, 0, 1);
      const zA = THREE.MathUtils.lerp(CREASE_Z, -CREASE_Z, clampedProg);
      const zB = THREE.MathUtils.lerp(-CREASE_Z, CREASE_Z, clampedProg);
      this.strikerMeshZ = this.runsCompletedThisBall % 2 === 0 ? zA : zB;
      this.nonStrikerMeshZ = this.runsCompletedThisBall % 2 === 0 ? zB : zA;

      if (!this.runnerReturning && this.runnerProgress >= 1.0) {
        this.runsCompletedThisBall++;
        this.runnerProgress = 0;
        this.batting.accumulatedStepsThisRun = 0;
        this.net.vibratePhone('p1', [45]);
        if (this.pendingExtraRun && this.runsCompletedThisBall < 4) {
          this.pendingExtraRun = false;
          this.runnerProgress = 0.06;
        } else {
          this.runnersInMotion = false;
          if (this.strikerPlayer) this.strikerPlayer.playClip('stance', 0.2);
          if (this.nonStrikerPlayer) this.nonStrikerPlayer.playClip('stance', 0.2);
        }
      } else if (this.runnerReturning && this.runnerProgress <= 0.0) {
        this.runnerProgress = 0;
        this.runnerReturning = false;
        this.runnersInMotion = false;
        this.runnerStoppedMidPitch = false;
        if (this.strikerPlayer) this.strikerPlayer.playClip('stance', 0.2);
        if (this.nonStrikerPlayer) this.nonStrikerPlayer.playClip('stance', 0.2);
      }

      // Compute real-time Safe / Tight / Danger Run Call indicator based on nearest fielder distance & throw state
      const minFDist = this.fielding.fielders.reduce(
        (m, f) => Math.min(m, Math.hypot(this.physics.pos.x - f.pos.x, this.physics.pos.z - f.pos.z)),
        99
      );
      if (this.physics.state === 'fielded' || minFDist < 4.5) {
        this.runRiskLevel = clampedProg > 0.16 && clampedProg < 0.80 ? 'danger' : 'tight';
      } else if (minFDist < 11.5) {
        this.runRiskLevel = 'tight';
      } else {
        this.runRiskLevel = 'safe';
      }

      this.ui.updateRunningBar({
        active: true,
        runsCompleted: this.runsCompletedThisBall,
        progress: clampedProg,
        cadenceHz: displayCadence,
        returning: this.runnerReturning,
        stoppedMidPitch: this.runnerStoppedMidPitch,
        riskLevel: this.runRiskLevel
      });
      this.ui.renderFieldRadar();
    } else {
      this.runRiskLevel = 'safe';
      this.ui.updateRunningBar({ active: false });
    }

    // 8. Sync 3D Meshes & Skeletal AnimationMixers with Simulation State
    this.syncMeshesWithState(dt, strikerImpactDt);

    // 9. Update Camera & Dynamic Broadcast Depth-of-Field Focus
    this.updateCameras(dt);

    // 10. Update Live Phone Telemetry & Debug Panel
    this.ui.updateLivePhoneTelemetry(
      this.batting.angularSpeedDeg,
      this.batting.footwork,
      this.net.controllers.p1.connected,
      this.net.controllers.p1.latencyMs
    );

    this.renderScene();
  }

  /**
   * Orients the striker's bat along the line between his two gloves (top hand -> bottom hand = blade direction) and
   * turns the bat face into the direction the hands are travelling. The bat therefore swings with the body instead of
   * pointing in a generic direction, so every shot looks like a real stroke.
   */
  updateBatFromGloves(batPivot, bones, dt) {
    if (!this._bgA) {
      this._bgA = new THREE.Vector3();
      this._bgB = new THREE.Vector3();
      this._bgMid = new THREE.Vector3();
      this._bgPrevMid = new THREE.Vector3();
      this._bgFace = new THREE.Vector3(0, 0, 1);
      this._bgDir = new THREE.Vector3();
      this._bgVel = new THREE.Vector3();
      this._bgZNow = new THREE.Vector3();
      this._bgWant = new THREE.Vector3();
      this._bgCross = new THREE.Vector3();
      this._bgQ = new THREE.Quaternion();
      this._bgQ2 = new THREE.Quaternion();
      this._bgDown = new THREE.Vector3(0, -1, 0);
      this._bgHasPrev = false;
    }
    this.strikerMesh.updateMatrixWorld(true);
    bones.rightHandBone.getWorldPosition(this._bgA); // bottom hand (nearest the blade)
    bones.leftHandBone.getWorldPosition(this._bgB); // top hand
    this.strikerMesh.worldToLocal(this._bgA);
    this.strikerMesh.worldToLocal(this._bgB);
    const dir = this._bgDir.copy(this._bgA).sub(this._bgB);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();

    this._bgMid.copy(this._bgA).add(this._bgB).multiplyScalar(0.5);
    if (this._bgHasPrev && dt > 1e-4) {
      this._bgVel.copy(this._bgMid).sub(this._bgPrevMid).divideScalar(dt);
      // component of hand velocity perpendicular to the blade = the way the bat face is travelling
      this._bgVel.addScaledVector(dir, -this._bgVel.dot(dir));
      const speed = this._bgVel.length();
      if (speed > 1.2) {
        this._bgVel.divideScalar(speed);
        this._bgFace.lerp(this._bgVel, 1 - Math.exp(-14 * dt)).normalize();
      }
    }
    this._bgPrevMid.copy(this._bgMid);
    this._bgHasPrev = true;

    // base rotation: blade axis (-Y of the bat mesh) along dir
    const q = this._bgQ.setFromUnitVectors(this._bgDown, dir);
    // twist about the blade axis so the flat face (+Z of the bat mesh) looks along the face direction
    const zNow = this._bgZNow.set(0, 0, 1).applyQuaternion(q);
    const want = this._bgWant.copy(this._bgFace).addScaledVector(dir, -this._bgFace.dot(dir));
    if (want.lengthSq() < 1e-4) want.set(0, 0, 1).addScaledVector(dir, -dir.z);
    if (want.lengthSq() < 1e-4) want.set(1, 0, 0);
    want.normalize();
    const cross = this._bgCross.crossVectors(zNow, want);
    const ang = Math.atan2(cross.dot(dir), zNow.dot(want));
    const twist = this._bgQ2.setFromAxisAngle(dir, ang);
    q.premultiply(twist);

    batPivot.quaternion.slerp(q, 1 - Math.exp(-38 * dt));
  }

  syncMeshesWithState(dt, strikerImpactDt = dt) {
    // 1. Ball position & visible 3D seam quaternion spin
    // Keep the red ball hidden during 'idle' so it never floats on the pitch,
    // show it in the bowler's hand during 'runup', and show it with full trail after release!
    const isRunup = !this.isReplaying && this.physics.state === 'runup';
    const showBall = Boolean(this.isReplaying) || this.physics.state !== 'idle';
    const showBallTrail = Boolean(this.isReplaying) || (this.physics.state !== 'idle' && this.physics.state !== 'runup');
    this.ballGroup.visible = showBall;
    if (!isRunup) {
      this.ballGroup.position.copy(this.physics.pos);
      this.ballGroup.quaternion.copy(this.physics.ballQuat);
    }

    const isOnFire = typeof this.batting?.isOnFire === 'function' && this.batting.isOnFire();
    const useRibbon =
      showBallTrail &&
      this.ballRibbonTrail &&
      this.ballRibbonTrail.updateGeometry(this.physics, this.camera, this.bowling.bowlerType, isOnFire);

    if (!showBallTrail || useRibbon) {
      this.trailLine.visible = false;
      if (!showBallTrail && this.ballRibbonTrail?.mesh) {
        this.ballRibbonTrail.mesh.visible = false;
      }
    } else {
      this.trailLine.visible = true;
      const posAttr = this.trailGeo.attributes.position;
      for (let i = 0; i < this.physics.maxTrail; i++) {
        const pt = i < this.physics.trailCount ? this.physics.trail[i] : this.physics.pos;
        posAttr.setXYZ(i, pt.x, pt.y, pt.z);
      }
      posAttr.needsUpdate = true;
    }

    if (this.contactShadows && CRICKET_FEEL_FLAGS.rimShaderAndShadows) {
      this.ballShadow.visible = false;
      this.contactShadows.updateActorShadow(
        'ball',
        showBallTrail ? this.physics.pos : null,
        Math.max(0, this.physics.pos.y)
      );
    } else {
      this.ballShadow.visible = showBallTrail;
      this.ballShadow.position.set(this.physics.pos.x, 0.03, this.physics.pos.z);
    }

    if (this.match.userRole === 'bowl') {
      this.aimRing.position.x = THREE.MathUtils.damp(this.aimRing.position.x, this.bowling.aimTargetX, 12, dt);
      this.aimRing.position.z = THREE.MathUtils.damp(this.aimRing.position.z, this.bowling.aimBounceZ, 12, dt);
    }
    if (this.aimRing.visible) {
      const pulse = 1.0 + Math.sin(performance.now() * 0.01) * 0.08;
      this.aimRing.scale.setScalar(pulse);
    }

    // 1.5 Aerial Ball Landing Target Ring & Interactive Fielding Reflex QTE
    if (
      this.physics.state === 'hit' &&
      !this.physics.bouncedAfterHit &&
      this.physics.pos.y > 0.28 &&
      this.physics.vel.y > -18
    ) {
      const g = 9.81;
      const vy = this.physics.vel.y;
      const y0 = Math.max(0.05, this.physics.pos.y);
      const tFlight = Math.max(0.05, (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * y0))) / g);
      const predX = this.physics.pos.x + this.physics.vel.x * tFlight * 0.92;
      const predZ = this.physics.pos.z + this.physics.vel.z * tFlight * 0.92;
      const predDist = Math.hypot(predX, predZ);

      this.landingRing.position.set(predX, 0.045, predZ);
      this.landingRing.visible = true;
      const isSixProj = predDist >= 54.0;
      this.landingRingMat.color.setHex(isSixProj ? 0xf59e0b : 0x38bdf8);
      const lPulse = 0.9 + Math.sin(performance.now() * 0.016) * 0.14;
      this.landingRing.scale.setScalar(lPulse);

      // Live Six Distance Counter in the top pill while a huge six is flying through the air!
      if (isSixProj) {
        const liveDistM = Math.min(118, Math.round(Math.hypot(this.physics.pos.x, this.physics.pos.z - CREASE_Z) * 1.48));
        if (liveDistM >= 25 && Math.abs(liveDistM - this.lastLiveSixMeterShown) >= 6) {
          this.lastLiveSixMeterShown = liveDistM;
          this.ui.showDeliveryPreview(
            {
              customStatusText: `🚀 SIX DISTANCE COUNTER: ${liveDistM}m ... (Projected ${Math.min(118, Math.round(predDist * 1.48))}m!)`,
              lengthCategory: 'full'
            },
            'always'
          );
        }
      }

      // Show Interactive Catch Reflex Meter ONLY when the human player is Bowling (`userRole === 'bowl'`)!
      if (this.match.userRole === 'bowl' && !isSixProj && tFlight > 0.35 && !this.qteResolved) {
        if (!this.qteActive) {
          this.qteActive = true;
          this.qteProgress = 0.15;
          this.qteDir = 1;
          const qteBar = document.getElementById('hud-qte-bar');
          if (qteBar) qteBar.classList.remove('hidden');
        }
        this.qteProgress += this.qteDir * dt * 1.65;
        if (this.qteProgress >= 0.95) {
          this.qteProgress = 0.95;
          this.qteDir = -1;
        } else if (this.qteProgress <= 0.05) {
          this.qteProgress = 0.05;
          this.qteDir = 1;
        }
        const cursor = document.getElementById('hud-qte-cursor');
        if (cursor) cursor.style.left = `${Math.round(this.qteProgress * 100)}%`;
      }
    } else {
      if (this.landingRing) this.landingRing.visible = false;
      if (this.qteActive) {
        this.qteActive = false;
        const qteBar = document.getElementById('hud-qte-bar');
        if (qteBar) qteBar.classList.add('hidden');
      }
      if (this.physics.state !== 'hit') {
        this.qteResolved = false;
      }
    }

    // 1.8 Animate 3D Match Umpire Signals (FOUR, SIX, OUT, WIDE, NO-BALL) while standing centered behind the non-striker stumps (x = 0)
    if (this.umpireMesh && this.umpireMesh.userData.leftArm && this.umpireMesh.userData.rightArm) {
      const lArm = this.umpireMesh.userData.leftArm;
      const rArm = this.umpireMesh.userData.rightArm;
      if (this.umpireSignalTimer > 0) {
        this.umpireSignalTimer = Math.max(0, this.umpireSignalTimer - dt);
        if (this.umpireSignalTimer === 0) this.umpireSignal = 'idle';
      }
      this.umpireMesh.position.x = THREE.MathUtils.damp(this.umpireMesh.position.x, 0, 8, dt);
      this.umpireMesh.position.z = THREE.MathUtils.damp(this.umpireMesh.position.z, -BOWLING_CREASE_Z - 1.35, 8, dt);
      this.umpireMesh.rotation.y = THREE.MathUtils.damp(this.umpireMesh.rotation.y, 0, 8, dt);
      let targetLZ = 0;
      let targetRZ = 0;
      let targetRX = 0;
      if (this.umpireSignal === 'six') {
        targetLZ = -2.85;
        targetRZ = 2.85;
      } else if (this.umpireSignal === 'out') {
        targetRZ = 2.95;
      } else if (this.umpireSignal === 'wide') {
        targetLZ = -1.55;
        targetRZ = 1.55;
      } else if (this.umpireSignal === 'noball') {
        targetRZ = 1.55;
      } else if (this.umpireSignal === 'four') {
        targetRZ = Math.sin(performance.now() * 0.012) * 1.15;
        targetRX = -0.85;
      }
      lArm.rotation.z = THREE.MathUtils.damp(lArm.rotation.z, targetLZ, 16, dt);
      rArm.rotation.z = THREE.MathUtils.damp(rArm.rotation.z, targetRZ, 16, dt);
      rArm.rotation.x = THREE.MathUtils.damp(rArm.rotation.x, targetRX, 16, dt);
    }

    // 2. Striker Position, Dynamic 360° Body Pivot & Real-Time Low-Lag 3D Willow Bat Reproduction
    // Striker stands with back foot grounded inside the Popping Crease (z = CREASE_Z + 0.14 = 8.98m)
    const isRunningOrCrossed = this.runnersInMotion || this.runsCompletedThisBall > 0 || this.runnerProgress > 0.01;
    const targetStrikerZ = isRunningOrCrossed ? this.strikerMeshZ : CREASE_Z + 0.14 - this.batting.creaseZOffset;
    this.strikerMesh.position.x = THREE.MathUtils.damp(this.strikerMesh.position.x, this.batting.creaseX, 32, dt);
    this.strikerMesh.position.z = THREE.MathUtils.damp(this.strikerMesh.position.z, targetStrikerZ, 24, dt);
    if (!isRunningOrCrossed && !this.runnersInMotion) {
      const targetStrikerYaw = Math.PI - (this.batting.bodyPivotYaw || 0);
      this.strikerMesh.rotation.y = THREE.MathUtils.damp(this.strikerMesh.rotation.y, targetStrikerYaw, 18, dt);
    }

    // 2b. 3D Field Aim Line at Batsman's Feet (Follows Angle Wheel & Fades Out After Ball Release)
    if (!this.pitchAimArrowGroup && this.scene) {
      const grp = new THREE.Group();
      const shaftGeo = new THREE.PlaneGeometry(0.11, 3.4);
      shaftGeo.translate(0, 1.75, 0);
      shaftGeo.rotateX(-Math.PI / 2);
      const shaftMat = new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);

      const headGeo = new THREE.BufferGeometry();
      const headVerts = new Float32Array([
        0, 0.02, -3.65,
        -0.24, 0.02, -3.15,
        0.24, 0.02, -3.15
      ]);
      headGeo.setAttribute('position', new THREE.BufferAttribute(headVerts, 3));
      const headMat = new THREE.MeshBasicMaterial({
        color: 0x6ee7b7,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const head = new THREE.Mesh(headGeo, headMat);

      grp.add(shaft);
      grp.add(head);
      grp.position.set(0, 0.028, CREASE_Z);
      grp.userData = { shaftMat, headMat, fadeAlpha: 0.85 };
      this.scene.add(grp);
      this.pitchAimArrowGroup = grp;
    }

    if (this.pitchAimArrowGroup) {
      const isBattingRole = this.match?.userRole !== 'bowl';
      const ballPastAimZone =
        (this.physics?.state === 'bowled' && this.physics.pos.z >= CREASE_Z - 2.2) ||
        this.physics?.state === 'hit' ||
        this.physics?.state === 'fielded' ||
        this.physics?.state === 'dead' ||
        isRunningOrCrossed;
      const targetAlpha = isBattingRole && !ballPastAimZone ? 0.88 : 0.0;
      const curAlpha = THREE.MathUtils.damp(
        this.pitchAimArrowGroup.userData.fadeAlpha ?? 0.88,
        targetAlpha,
        ballPastAimZone ? 12 : 18,
        dt
      );
      this.pitchAimArrowGroup.userData.fadeAlpha = curAlpha;
      this.pitchAimArrowGroup.visible = curAlpha > 0.02;
      if (this.pitchAimArrowGroup.visible) {
        this.pitchAimArrowGroup.position.set(this.strikerMesh.position.x, 0.028, this.strikerMesh.position.z);
        const targetYaw = this.batting.swingPlaneYaw || 0;
        this.pitchAimArrowGroup.rotation.y = THREE.MathUtils.damp(
          this.pitchAimArrowGroup.rotation.y,
          -targetYaw,
          24,
          dt
        );
        const isLoftMode = this.batting.shotMode === 'fly';
        const tintHex = isLoftMode ? 0xf59e0b : 0x34d399;
        this.pitchAimArrowGroup.userData.shaftMat.color.setHex(tintHex);
        this.pitchAimArrowGroup.userData.headMat.color.setHex(isLoftMode ? 0xfde68a : 0x6ee7b7);
        this.pitchAimArrowGroup.userData.shaftMat.opacity = curAlpha * 0.76;
        this.pitchAimArrowGroup.userData.headMat.opacity = curAlpha * 0.96;
      }
    }

    const targetNonStrikerX = this.bowling.bowlerSide === 'over' ? -0.95 : 0.95;
    const backupZ =
      !isRunningOrCrossed && (this.physics.state === 'runup' || this.physics.state === 'bowled')
        ? THREE.MathUtils.clamp((this.bowling.runupProgress || 0) * 0.72, 0, 0.72)
        : 0;
    this.nonStrikerMesh.position.x = THREE.MathUtils.damp(this.nonStrikerMesh.position.x, targetNonStrikerX, 10, dt);
    this.nonStrikerMesh.position.z = THREE.MathUtils.damp(this.nonStrikerMesh.position.z, this.nonStrikerMeshZ + backupZ, 12, dt);

    if (this.physics.state === 'fielded' && this.fielding.throwTargetEnd === 'nonStriker') {
      // Bowler moves right up behind the non-striker stumps to receive the incoming throw!
      this.bowlerMesh.position.x = THREE.MathUtils.damp(this.bowlerMesh.position.x, 0.14, 10, dt);
      this.bowlerMesh.position.z = THREE.MathUtils.damp(this.bowlerMesh.position.z, -PITCH_HALF_LENGTH - 0.26, 10, dt);
      this.bowlerMesh.position.y = 0;
      const throwerX = this.fielding.activeThrower?.pos?.x || this.physics.pos.x;
      const throwerZ = this.fielding.activeThrower?.pos?.z || this.physics.pos.z;
      this.bowlerMesh.rotation.y = Math.atan2(
        throwerX - this.bowlerMesh.position.x,
        throwerZ - this.bowlerMesh.position.z
      );
    } else {
      this.bowlerMesh.position.z = this.bowling.runupZ;
      this.bowlerMesh.position.y = this.bowling.jumpY || 0;
      this.bowlerMesh.rotation.y = 0;
      // Bowler runs in along authentic Over/Around-the-Wicket lane (±0.54m beside stumps/umpire) and veers off after release!
      const followSideOffset =
        this.bowling.state === 'released'
          ? (this.bowling.bowlerSide === 'over' ? 0.55 : -0.55) * (this.bowling.followThroughProgress || 0)
          : 0;
      const targetBowlerX = (this.bowling.bowlerSide === 'over' ? 0.54 : -0.54) + followSideOffset;
      this.bowlerMesh.position.x = THREE.MathUtils.damp(this.bowlerMesh.position.x, targetBowlerX, 12, dt);
    }

    this.keeperMesh.position.copy(this.fielding.keeper.pos);
    if (this.physics.state === 'fielded' && this.fielding.throwTargetEnd === 'striker') {
      const throwerX = this.fielding.activeThrower?.pos?.x || this.physics.pos.x;
      const throwerZ = this.fielding.activeThrower?.pos?.z || this.physics.pos.z;
      this.keeperMesh.rotation.y = Math.atan2(
        throwerX - this.keeperMesh.position.x,
        throwerZ - this.keeperMesh.position.z
      );
    } else {
      this.keeperMesh.rotation.y = Math.PI;
    }

    // Update 9 Fielders & blend between Idle / Run / Dive / Throw clips
    this.fielding.fielders.forEach((f, idx) => {
      const fp = this.fielderPlayers[idx];
      if (!fp) return;
      const prevX = fp.group.position.x;
      const prevZ = fp.group.position.z;
      fp.group.position.copy(f.pos);
      fp.group.rotation.y = f.rotY;

      const moveDist = Math.hypot(f.pos.x - prevX, f.pos.z - prevZ);
      const speedMs = moveDist / Math.max(0.008, dt);
      if (
        fp.currentClipName !== 'dive' &&
        fp.currentClipName !== 'catch' &&
        fp.currentClipName !== 'throw' &&
        fp.currentClipName !== 'celebration'
      ) {
        if (speedMs > 1.2) {
          fp.playClip('bowling_runup', 0.15, Math.min(1.6, 0.8 + speedMs * 0.1));
        } else {
          fp.playClip('idle', 0.2, 1.0);
        }
      }
      fp.update(dt, this.camera.position);
    });

    // Step primary character AnimationMixers BEFORE locking 3D bats to gloved hand bones
    if (this.strikerPlayer) this.strikerPlayer.update(strikerImpactDt);
    if (this.nonStrikerPlayer) this.nonStrikerPlayer.update(dt, this.camera.position);
    if (this.bowlerPlayer) this.bowlerPlayer.update(dt);
    if (this.keeperPlayer) this.keeperPlayer.update(dt);

    // Con #2 Fix: During bowler 'runup', lock the 3D red cricket ball directly to the bowler's bowling hand bone!
    if (isRunup && this.bowlerMesh) {
      this.bowlerMesh.updateMatrixWorld(true);
      const bHand = this.bowlerPlayer?.bones?.rightHandBone;
      if (bHand) {
        bHand.getWorldPosition(this.ballGroup.position);
        this.ballGroup.position.y += 0.02;
      } else {
        this.ballGroup.position.set(
          this.bowlerMesh.position.x + 0.22,
          this.bowlerMesh.position.y + 1.32,
          this.bowlerMesh.position.z + 0.18
        );
      }
    }

    // Lock Striker Bat Pivot to the Striker's two-handed gloved grip (follows stance crouch, sweep/scoop kneel & running!)
    const batPivot = this.strikerMesh.userData.batPivot;
    if (batPivot && this.strikerPlayer) {
      const bones = this.strikerPlayer.bones;
      // (Grip posture now comes from the IK stance / shot clips - both gloves stay on the handle.)
      this.strikerMesh.updateMatrixWorld(true);
      const rHand = bones?.rightHandBone;
      const lHand = bones?.leftHandBone;
      if (rHand) {
        if (!this._handWorldA) {
          this._handWorldA = new THREE.Vector3();
          this._handWorldB = new THREE.Vector3();
        }
        rHand.getWorldPosition(this._handWorldA);
        if (lHand) {
          lHand.getWorldPosition(this._handWorldB);
          // Midpoint between top hand (leftHandBone) and bottom hand (rightHandBone) right on the rubber bat handle
          this._handWorldA.lerp(this._handWorldB, 0.45);
        }
        this.strikerMesh.worldToLocal(this._handWorldA);
        batPivot.position.x = THREE.MathUtils.damp(batPivot.position.x, this._handWorldA.x, 42, dt);
        batPivot.position.y = THREE.MathUtils.damp(batPivot.position.y, this._handWorldA.y - 0.025, 42, dt);
        batPivot.position.z = THREE.MathUtils.damp(batPivot.position.z, this._handWorldA.z + 0.03, 42, dt);
      }

      const dampSpeed = this.batting.isCalibrated && this.net.controllers.p1.connected ? 32 : 24;
      const strikerClip = this.strikerPlayer.currentClipName;
      const isPlayingShotClip = BATTING_SHOT_CLIPS.has(strikerClip);
      // Always drive bat from 2-handed IK gloves during active shot clips (even when Phone Controller is connected!)
      // During 'stance', if Phone Controller is connected, allow live gyro bat tilt while keeping hands locked on the handle.
      this._clipDrivenBat =
        !this.runnersInMotion &&
        Boolean(bones?.rightHandBone && bones?.leftHandBone) &&
        (isPlayingShotClip || (strikerClip === 'stance' && !this.net.controllers.p1.connected));
      if (this._clipDrivenBat) {
        this.updateBatFromGloves(batPivot, bones, dt);
      } else if (this.runnersInMotion) {
        // Carry bat naturally while sprinting between wickets
        const sprintSwing = Math.sin(performance.now() * 0.014) * 0.25;
        batPivot.rotation.x = THREE.MathUtils.damp(batPivot.rotation.x, 0.55 + sprintSwing, 18, dt);
        batPivot.rotation.y = THREE.MathUtils.damp(batPivot.rotation.y, 0.2, 18, dt);
        batPivot.rotation.z = THREE.MathUtils.damp(batPivot.rotation.z, -0.35, 18, dt);
      } else {
        batPivot.rotation.x = THREE.MathUtils.damp(batPivot.rotation.x, this.batting.backliftAngle, dampSpeed, dt);
        batPivot.rotation.y = THREE.MathUtils.damp(batPivot.rotation.y, -this.batting.swingPlaneYaw * 0.75, dampSpeed, dt);
        batPivot.rotation.z = THREE.MathUtils.damp(batPivot.rotation.z, this.batting.swingPlaneYaw * 0.45, dampSpeed, dt);
      }
    }

    // Lock Non-Striker Bat to the Non-Striker's gloved right hand during stance & running between wickets
    const nonStrikerBat = this.nonStrikerMesh?.userData?.batMesh;
    if (nonStrikerBat && this.nonStrikerPlayer?.bones?.rightHandBone) {
      this.nonStrikerMesh.updateMatrixWorld(true);
      if (!this._nsHandWorld) this._nsHandWorld = new THREE.Vector3();
      this.nonStrikerPlayer.bones.rightHandBone.getWorldPosition(this._nsHandWorld);
      this.nonStrikerMesh.worldToLocal(this._nsHandWorld);
      nonStrikerBat.position.x = THREE.MathUtils.damp(nonStrikerBat.position.x, this._nsHandWorld.x, 28, dt);
      nonStrikerBat.position.y = THREE.MathUtils.damp(nonStrikerBat.position.y, this._nsHandWorld.y - 0.04, 28, dt);
      nonStrikerBat.position.z = THREE.MathUtils.damp(nonStrikerBat.position.z, this._nsHandWorld.z + 0.04, 28, dt);
      if (this.runnersInMotion) {
        const nsSprint = Math.sin(performance.now() * 0.014 + 1.2) * 0.22;
        nonStrikerBat.rotation.x = THREE.MathUtils.damp(nonStrikerBat.rotation.x, 0.5 + nsSprint, 16, dt);
      } else {
        nonStrikerBat.rotation.x = THREE.MathUtils.damp(nonStrikerBat.rotation.x, 0.15, 16, dt);
      }
    }

    // Keep both rightHandBone and leftHandBone aligned with camera-aware swing plane when batting
    if (this.strikerPlayer && this.strikerPlayer.bones.rightHandBone && !this.runnersInMotion && batPivot && !this._clipDrivenBat) {
      this.strikerPlayer.bones.rightHandBone.quaternion.slerp(batPivot.quaternion, 0.42);
      if (this.strikerPlayer.bones.leftHandBone) {
        this.strikerPlayer.bones.leftHandBone.quaternion.slerp(batPivot.quaternion, 0.42);
      }
    }

    // 8.5 Update All 7 Modular Cricket Feel & Visual Upgrades
    if (this.aliveBatsman) {
      this.aliveBatsman.update({
        dt: strikerImpactDt,
        strikerPlayer: this.strikerPlayer,
        strikerMesh: this.strikerMesh,
        batPivot,
        ballGroup: this.ballGroup,
        physics: this.physics,
        bowling: this.bowling,
        runnersInMotion: this.runnersInMotion
      });
    }

    if (this.batRibbonTrail) {
      this.batRibbonTrail.update(strikerImpactDt, batPivot, this.batting.angularSpeedDeg, isOnFire);
    }

    if (this.impactVFX) {
      this.impactVFX.update(dt);
    }

    if (this.crowdAnimator) {
      this._crowdTick = (this._crowdTick || 0) + 1;
      if (this._crowdTick % 2 === 0) {
        this.crowdAnimator.update(dt * 2);
      }
    }

    if (this.floatingTelemetry) {
      this.floatingTelemetry.update(dt, this.camera);
    }

    if (this.contactShadows) {
      this.contactShadows.updateActorShadow('striker', this.strikerMesh?.position, 0);
      this.contactShadows.updateActorShadow('nonStriker', this.nonStrikerMesh?.position, 0);
      this.contactShadows.updateActorShadow('bowler', this.bowlerMesh?.position, this.bowling.jumpY || 0);
      this.contactShadows.updateActorShadow('keeper', this.keeperMesh?.position, 0);
      this.contactShadows.updateActorShadow('umpire', this.umpireMesh?.position, 0);
      this.fielderPlayers.forEach((fp, idx) => {
        this.contactShadows.updateActorShadow(`fielder_${idx}`, fp?.group?.position, 0);
      });
    }

    // Dislodged LED Zing Bail Physics
    if (this.bailsDislodged) {
      this.bailTimer += dt;
      const set = this.dislodgedEnd === 'striker' ? this.strikerStumps : this.nonStrikerStumps;
      // Uprooted stumps cartwheel away; settle on the turf
      set.stumps.forEach((st) => {
        const f = st.userData.fly;
        if (!f || f.rest) return;
        f.vy -= 9.8 * dt;
        st.position.x += f.vx * dt;
        st.position.y += f.vy * dt;
        st.position.z += f.vz * dt;
        st.rotation.x += f.wx * dt;
        st.rotation.z += f.wz * dt;
        if (st.position.y < 0.02) {
          st.position.y = 0.02;
          if (Math.abs(f.vy) > 0.8) {
            f.vy = -f.vy * 0.38;
            f.vx *= 0.6; f.vz *= 0.6; f.wx *= 0.5; f.wz *= 0.5;
          } else {
            f.rest = true;
            st.rotation.x = Math.PI / 2 * Math.sign(f.wx || 1);
            st.rotation.z = 0;
          }
        }
      });
      if (set.flash && set.flash.visible) {
        set.flash.material.opacity = Math.max(0, 1 - this.bailTimer * 2.2);
        set.flash.scale.setScalar(0.8 + this.bailTimer * 2.6);
        if (set.flash.material.opacity <= 0) set.flash.visible = false;
      }
      set.stumps.forEach((st) => {
        st.material.emissiveIntensity = Math.max(0.55, 1.2 - this.bailTimer * 1.2);
      });
      set.bails.forEach((b, idx) => {
        const dir = idx === 0 ? -1 : 1;
        b.position.x += dir * dt * 1.4;
        b.position.y = STUMP_HEIGHT + this.bailTimer * 2.4 - 4.9 * this.bailTimer * this.bailTimer;
        b.position.y = Math.max(0.03, b.position.y);
        b.position.z += dt * 2.2 * (this.dislodgedEnd === 'striker' ? 1 : -1);
        b.rotation.z += dt * 12 * dir;
      });
    }
  }

  /**
   * Updates Broadcast, Pro, Overhead, Follow, and Event-Specific Slow-Motion Replay Cameras:
   * - 'stumps': Stumps close-up for Bowled, LBW, Stumped, Hit Wicket, Edge & Near Miss
   * - 'follow_ball': Follow-the-ball orbiting camera for Four, Six & Milestones
   * - 'fielder': Fielder close-up camera for Catches & Dropped Catches
   * - 'side_on': Side-on crease camera for Run-Outs & Close Run-Out Decisions
   */
  updateCameras(dt) {
    const setupModalEl = document.getElementById('modal-setup');
    const mdHomeEl = document.getElementById('md-home');
    const isSetupMenuOpen =
      (setupModalEl && !setupModalEl.classList.contains('hidden')) ||
      (mdHomeEl && !mdHomeEl.classList.contains('md-hidden'));

    if (isSetupMenuOpen) {
      // Wavedash "Last Over" Live 3D Stadium Pre-Match Menu Orbit Camera
      const orbitAngle = performance.now() * 0.00018;
      _camTargetPos.set(
        Math.sin(orbitAngle) * 18.5,
        6.2 + Math.sin(orbitAngle * 2.0) * 1.1,
        Math.cos(orbitAngle) * 18.5
      );
      _camLookAt.set(0, 1.2, 2.0);
    } else if (this.cameraMode === 'broadcast' || this.cameraMode === 'follow' || this.cameraMode === 'pro') {
      const isBoundaryHoldActive = performance.now() < (this.boundaryCameraHoldUntil || 0);
      const isThrowCatchHoldActive = performance.now() < (this.throwCatchCameraHoldUntil || 0);
      const isImpactFollowHold = performance.now() < (this.impactFollowThroughUntil || 0);
      const isBallInOutfield =
        !isImpactFollowHold &&
        (this.physics.state === 'hit' ||
          this.physics.state === 'fielded' ||
          this.physics.state === 'boundary_flight' ||
          isBoundaryHoldActive ||
          isThrowCatchHoldActive);
      const activeBaseCam = this.cameraMode === 'follow' ? (this.savedCameraMode || 'broadcast') : this.cameraMode;
      const bx = this.ballGroup.position.x;
      const by = Math.max(0, this.ballGroup.position.y);
      const bz = this.ballGroup.position.z;
      const ballDistFromCrease = Math.hypot(bx, bz - CREASE_Z);

      if (Math.abs(this.impactPunchFov || 0) > 0.04) {
        this.impactPunchFov = THREE.MathUtils.damp(this.impactPunchFov, 0, 10, dt);
      } else {
        this.impactPunchFov = 0;
      }

      let activeTargetFov = this.camera.fov;
      if (activeBaseCam === 'pro') {
        // CRICKET 26 / REAL CRICKET "BATTING PRO" CAMERA:
        // Telephoto lens behind keeper with gentle off-side shoulder peek — zero perspective warp, crystal-clear pitch & release!
        const isPortrait = window.innerHeight > window.innerWidth;
        const handSign = this.handedness === 'left' ? -1 : 1;
        const baseBatFov = isPortrait ? 41.0 : 34.0;
        const targetFov = (isBallInOutfield ? (isPortrait ? 44.5 : 37.5) : baseBatFov) + (this.impactPunchFov || 0);
        activeTargetFov = targetFov;
        if (Math.abs(this.camera.fov - targetFov) > 0.1) {
          this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 7.5, dt);
          this.camera.updateProjectionMatrix();
        }
        if (isBallInOutfield) {
          // Smooth elevated follow behind batter — camZ always stays > bz so camera NEVER flips 180°
          _camTargetPos.set(
            THREE.MathUtils.clamp(bx * 0.35, -14.0, 14.0),
            THREE.MathUtils.clamp(5.2 + by * 0.32 + ballDistFromCrease * 0.11, 5.0, 14.5),
            Math.max(CREASE_Z + 9.5, bz + 14.5)
          );
          _camLookAt.set(
            bx * 0.85,
            Math.max(0.55, by * 0.65),
            THREE.MathUtils.lerp(0.0, bz, 0.82)
          );
        } else {
          // Behind keeper at +17.44m (+18.24m portrait), peeking past off-side shoulder so middle/off stumps & pitch are 100% open
          _camTargetPos.set(
            this.strikerMesh.position.x * 0.25 + 0.34 * handSign,
            isPortrait ? 3.15 : 2.85,
            CREASE_Z + (isPortrait ? 9.4 : 8.6)
          );
          _camLookAt.set(
            0,
            isPortrait ? 0.72 : 0.78,
            -2.5
          );
        }
      } else {
        // CRICKET 26 / REAL CRICKET "TV BROADCAST" CAMERA (Telephoto sightscreen gantry looking straight at striker & wickets)
        const isPortrait = window.innerHeight > window.innerWidth;
        const baseDeliveryFov = isPortrait ? 33.0 : 27.5;
        const targetFov = isBallInOutfield ? (isPortrait ? 38.0 : 32.5) : baseDeliveryFov;
        activeTargetFov = targetFov;
        if (Math.abs(this.camera.fov - targetFov) > 0.1) {
          this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4.8, dt);
          this.camera.updateProjectionMatrix();
        }
        if (isBallInOutfield) {
          // Elevated Broadcast TV Crane Follow — tracks ball and fielder pickup/throw clearly
          _camTargetPos.set(
            THREE.MathUtils.clamp(bx * 0.38, -16.0, 16.0),
            THREE.MathUtils.clamp(7.4 + by * 0.34 + ballDistFromCrease * 0.14, 7.0, 16.5),
            Math.min(-21.5, bz - 16.5)
          );
          _camLookAt.set(
            bx * 0.85,
            Math.max(0.4, by * 0.65),
            THREE.MathUtils.lerp(1.5, bz, 0.84)
          );
        } else {
          _camTargetPos.set(0, isPortrait ? 5.0 : 4.55, isPortrait ? -29.0 : -27.5);
          _camLookAt.set(0, isPortrait ? 0.86 : 0.92, 6.8);
        }
      }

      // TV Broadcast Cut: Snap cleanly on menu close, mode switch, or returning from outfield
      if (this._snapCameraNextFrame || this._wasSetupMenuOpen || (this.wasTrackingOutfieldBall && !isBallInOutfield)) {
        if (this._snapCameraNextFrame || this._wasSetupMenuOpen || this.camera.position.distanceTo(_camTargetPos) > 10.0) {
          this.camera.position.copy(_camTargetPos);
          _currentLookAt.copy(_camLookAt);
          if (Math.abs(this.camera.fov - activeTargetFov) > 0.1) {
            this.camera.fov = activeTargetFov;
            this.camera.updateProjectionMatrix();
          }
        }
        this._snapCameraNextFrame = false;
      }
      this.wasTrackingOutfieldBall = isBallInOutfield;
    } else if (this.cameraMode === 'overhead') {
      _camTargetPos.set(0, 46.0, 0.1);
      _camLookAt.set(0, 0, 0);
      if (this._snapCameraNextFrame || this._wasSetupMenuOpen) {
        this.camera.position.copy(_camTargetPos);
        _currentLookAt.copy(_camLookAt);
        this.camera.fov = 45;
        this.camera.updateProjectionMatrix();
        this._snapCameraNextFrame = false;
      }
      this.wasTrackingOutfieldBall = false;
    } else if (this.cameraMode === 'replay') {
      this.wasTrackingOutfieldBall = true;
      const t = performance.now() * 0.0014;
      const style = this.activeReplayHighlight?.cameraStyle || 'follow_ball';
      const focus = this.activeReplayHighlight?.focusPos || this.ballGroup.position;
      const replayFov = style === 'stumps' ? 30.0 : style === 'fielder' ? 32.0 : 35.0;
      if (Math.abs(this.camera.fov - replayFov) > 0.1) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, replayFov, 6.0, dt);
        this.camera.updateProjectionMatrix();
      }

      if (style === 'stumps') {
        // Dramatic low-angle ultra-motion stumps close-up for Bowled, LBW, Stumping, Hit Wicket
        _camTargetPos.set(
          Math.sin(t) * 1.95,
          0.92 + Math.sin(t * 1.5) * 0.12,
          PITCH_HALF_LENGTH - 2.45 + Math.cos(t) * 0.65
        );
        _camLookAt.set(0, 0.52, PITCH_HALF_LENGTH - 0.1);
      } else if (style === 'fielder') {
        // Heroic low-angle fielder close-up for Diving Catches and Stops
        _camTargetPos.set(
          focus.x + Math.cos(t) * 3.4,
          1.25,
          focus.z + Math.sin(t) * 3.4
        );
        _camLookAt.set(
          THREE.MathUtils.lerp(focus.x, this.ballGroup.position.x, 0.4),
          Math.max(0.55, this.ballGroup.position.y * 0.85),
          THREE.MathUtils.lerp(focus.z, this.ballGroup.position.z, 0.4)
        );
      } else if (style === 'side_on') {
        // Broadcast side-on crease view for Run-Outs and Close Run-Out decisions
        const endZ = this.activeReplayHighlight?.targetEnd === 'nonStriker' ? -PITCH_HALF_LENGTH : PITCH_HALF_LENGTH;
        _camTargetPos.set(
          5.6 + Math.sin(t * 0.5) * 0.5,
          1.28,
          endZ + Math.cos(t * 0.5) * 0.6
        );
        _camLookAt.set(0, 0.58, endZ);
      } else {
        // Follow-the-ball orbiting replay camera for Fours, Sixes, and Milestones
        _camTargetPos.set(
          this.ballGroup.position.x + Math.cos(t) * 5.8,
          Math.max(2.1, this.ballGroup.position.y + 1.5),
          this.ballGroup.position.z + Math.sin(t) * 5.8
        );
        _camLookAt.copy(this.ballGroup.position);
      }
    }

    // Use smooth, unhurried camera tracking (2.6) while watching a shot fly into the stands so it never feels rushed
    const isOutfieldFollow =
      this.physics.state === 'hit' ||
      this.physics.state === 'boundary_flight' ||
      performance.now() < (this.boundaryCameraHoldUntil || 0);
    const posDampRate = isOutfieldFollow ? 2.6 : 5.0;
    const lookDampRate = isOutfieldFollow ? 3.8 : 6.8;

    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camTargetPos.x, posDampRate, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camTargetPos.y, posDampRate, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camTargetPos.z, posDampRate, dt);

    // Directional Impact Kick + Subtle Camera Impact Punch / Shake on Sweet-Spot Middled Shots
    if (this.impactKickVec && this.impactKickVec.lengthSq() > 0.0001) {
      this.camera.position.add(this.impactKickVec);
      this.impactKickVec.multiplyScalar(Math.exp(-12 * dt));
    }
    if (this.cameraShakeIntensity > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.cameraShakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.cameraShakeIntensity * 0.8;
      this.cameraShakeIntensity = THREE.MathUtils.damp(this.cameraShakeIntensity, 0, 14, dt);
    } else {
      this.cameraShakeIntensity = 0;
    }

    _currentLookAt.x = THREE.MathUtils.damp(_currentLookAt.x, _camLookAt.x, lookDampRate, dt);
    _currentLookAt.y = THREE.MathUtils.damp(_currentLookAt.y, _camLookAt.y, lookDampRate, dt);
    _currentLookAt.z = THREE.MathUtils.damp(_currentLookAt.z, _camLookAt.z, lookDampRate, dt);
    this.camera.lookAt(_currentLookAt);

    // Update Broadcast Bokeh Depth-of-Field focus distance dynamically
    if (this.bokehPass && this.bokehPass.enabled && this.bokehPass.uniforms) {
      const focusDist = this.camera.position.distanceTo(_currentLookAt);
      this.bokehPass.uniforms['focus'].value = focusDist;
      this.bokehPass.uniforms['aperture'].value =
        this.cameraMode === 'replay' ? 0.0022 : 0.0008;
    }
    this._wasSetupMenuOpen = isSetupMenuOpen;
  }
}

function updateWavedashLoadProgress(progress) {
  const sdk = window.Wavedash;
  if (sdk && typeof sdk.updateLoadProgressZeroToOne === 'function') {
    try {
      sdk.updateLoadProgressZeroToOne(Math.max(0, Math.min(1, progress)));
    } catch (error) {
      console.warn('[Wavedash] Could not update loading progress:', error);
    }
  }
}

function signalWavedashReady() {
  const sdk = window.Wavedash;
  if (!sdk || typeof sdk.init !== 'function' || window.__boxCricketWavedashInitialized) return;
  try {
    updateWavedashLoadProgress(1);
    sdk.init({ debug: false });
    window.__boxCricketWavedashInitialized = true;
  } catch (error) {
    console.error('[Wavedash] Initialization failed:', error);
  }
}

function showStartupError(error) {
  console.error('[Box Cricket 3D] Startup failed:', error);
  let panel = document.getElementById('box-cricket-startup-error');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'box-cricket-startup-error';
    panel.style.cssText = 'position:fixed;inset:12px;z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;background:#090f1d;color:#f8fafc;font:14px/1.5 system-ui,sans-serif;';
    panel.innerHTML = '<div style="max-width:680px;padding:24px;border:1px solid #475569;border-radius:12px;background:#0f172a"><h2 style="margin:0 0 12px;color:#fbbf24;font-size:20px">Box Cricket 3D could not start</h2><p style="margin:0 0 10px">The game hit a startup error. Reload the game once. If it happens again, share the browser Console error with the developer.</p><pre id="box-cricket-startup-error-detail" style="white-space:pre-wrap;overflow-wrap:anywhere;color:#fca5a5;font-size:12px"></pre></div>';
    document.body.appendChild(panel);
  }
  const detail = document.getElementById('box-cricket-startup-error-detail');
  if (detail) detail.textContent = String(error && (error.stack || error.message) || error || 'Unknown startup error');
}

function bootBoxCricketApp() {
  if (window.boxCricketApp || window.__boxCricketBootAttempted) return;
  window.__boxCricketBootAttempted = true;
  updateWavedashLoadProgress(0.1);
  try {
    window.boxCricketApp = new BoxCricketApp();
    signalWavedashReady();
  } catch (error) {
    showStartupError(error);
    // Reveal the diagnostic panel rather than leaving players behind the platform loader.
    signalWavedashReady();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootBoxCricketApp, { once: true });
} else {
  bootBoxCricketApp();
}

