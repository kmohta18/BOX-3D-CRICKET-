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
  CREASE_Z,
  STUMP_HEIGHT,
  STUMP_WIDTH,
  BOUNDARY_RADIUS
} from '../physics.js';
import { BattingSystem } from '../batting.js';
import { BowlingSystem } from '../bowling.js';
import { FieldingSystem } from '../fielding.js';
import { MatchEngine, FICTIONAL_TEAMS, INDIAN_STADIUMS } from '../modes.js';
import { NetworkManager } from '../net.js';
import { UIManager } from '../ui.js';
import { sound } from '../assets/audio.js';
import { commentary } from '../commentary.js';
import { gameConfig, getDifficultyProfile, rollRunChaseTarget } from '../config.js';
import {
  CHARACTER_STYLE,
  detectHardwareQualityPreset,
  loadRealisticAssets,
  buildCricketMocapClips,
  RiggedCricketPlayer,
  createDetailedCricketBatMesh,
  createDetailedCricketBallMesh,
  createOutfieldGrassTextures,
  ProgressivePitchSurface
} from '../assets/models_and_anims.js';

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
    this.cameraMode = 'broadcast'; // 'broadcast' | 'pro' | 'follow' | 'overhead' | 'replay'
    this.savedCameraMode = 'broadcast';
    this.targetFps = 60;
    this.lastFrameTime = 0;
    this.graphicsQuality = 'high'; // 'low' | 'medium' | 'high'
    this.qualityPreset = 'high';
    this.dofEnabled = true;
    this.handedness = 'right'; // 'right' (default) | 'left'

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
    this.replaySpeed = 0.28; // 0.28x Slow-Motion
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

    // Automatic Bowler Run-Up & Pre-Delivery Countdown (like Cricket 24 / Real Cricket / WCC3)
    this.autoBowlCountdown = 2.0;
    this.autoBowlScheduled = true;
    this.lastCountdownWholeSec = -1;
    // One-time Play Gate so the bowler waits until the player connects their phone controller or clicks PLAY
    this.matchPlayConfirmed = false;

    // 3D Umpire signal animation state ('idle' | 'four' | 'six' | 'out' | 'wide' | 'noball')
    this.umpireSignal = 'idle';
    this.umpireSignalTimer = 0;

    // Interactive Catch / Direct-Hit Reflex QTE state
    this.qteActive = false;
    this.qteProgress = 0.1;
    this.qteDir = 1;
    this.qteResolved = false;

    // Touch swipe tracking on main canvas
    this.pointerDownPos = null;
    this.pointerDownTime = 0;

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

    // Open Pre-Match Setup modal before the game starts so user selects Mode, Difficulty, Teams, Stadium & Day/Night
    this.ui.openModal('modal-setup');

    // Schedule opening delivery automatically (waits while Pre-Match Setup modal is open)
    this.scheduleAutoBowl(2.2);

    // Trigger opening match commentary caption
    commentary.trigger('match_start', this.getCommentaryContext(), true);

    // Auto-detect device hardware & apply Low/Medium/High graphics preset
    const detectedPreset = detectHardwareQualityPreset(this.renderer);
    this.applyGraphicsQualityPreset(detectedPreset);
    const qualSelect = document.getElementById('setting-quality');
    if (qualSelect) qualSelect.value = detectedPreset;

    // Lazy-load Draco/KTX2/HDRI sky with loading bar
    this.startAssetLoadingPipeline();

    // Start WebSocket connection & fetch LAN IP for QR code
    this.net.connect();
    this.net.fetchServerInfo().then(() => {
      this.ui.renderQRModalContent();
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
    this.renderer.shadowMap.enabled = !isHeadless;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.canvasContainer.appendChild(this.renderer.domElement);

    // WebGL context loss safety
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());

    // Studio Environment Map fallback before HDRI finishes loading
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.studioEnvMap = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.studioEnvMap;
    pmremGenerator.dispose();

    // Balanced 3-Point Stadium & Sun Lighting Rig with Soft Shadows
    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x14532d, 0.72);
    this.hemiLight.position.set(0, 60, 0);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfffbeb, 2.1);
    this.keyLight.position.set(24, 46, -20);
    this.keyLight.castShadow = !isHeadless;
    const d = 26;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.camera.near = 5;
    this.keyLight.shadow.camera.far = 130;
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
    this.rimLight.position.set(-30, 32, 35);
    this.scene.add(this.rimLight);

    // Post-Processing Composer: RenderPass + Broadcast Bokeh DOF + Subtle UnrealBloom + OutputPass
    this.initPostProcessing();

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      if (this.composer) {
        this.composer.setSize(w, h);
      }
      if (this.bloomPass) {
        this.bloomPass.resolution.set(Math.floor(w * 0.5), Math.floor(h * 0.5));
      }
    });
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
          hdriTexture.dispose();
          pmrem.dispose();
          this.setStadium(this.match.stadium || 'eden_gardens', this.match.timeOfDay || 'night');
        }

        this.rebuildTeamCharacters();

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

  createCreaseOverlayTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 1024);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 6;
    [95, 148, 876, 929].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(236, y);
      ctx.stroke();
    });
    [95, 876].forEach((y) => {
      const dir = y < 500 ? 1 : -1;
      [24, 58, 198, 232].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, y - dir * 55);
        ctx.lineTo(x, y + dir * 55);
        ctx.stroke();
      });
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
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
    horizonMesh.receiveShadow = true;
    this.scene.add(horizonMesh);

    const grassMaps = createOutfieldGrassTextures(this.renderer);
    const outfieldGeo = new THREE.CircleGeometry(BOUNDARY_RADIUS + 8, 64);
    outfieldGeo.rotateX(-Math.PI / 2);
    this.outfieldMat = new THREE.MeshStandardMaterial({
      map: grassMaps.albedoMap,
      normalMap: grassMaps.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.82,
      metalness: 0.02
    });
    this.outfieldMesh = new THREE.Mesh(outfieldGeo, this.outfieldMat);
    this.outfieldMesh.receiveShadow = true;
    this.scene.add(this.outfieldMesh);

    const ropeGeo = new THREE.TorusGeometry(BOUNDARY_RADIUS, 0.18, 12, 96);
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
      roughnessMap: this.pitchSurface.roughnessMap,
      roughness: 0.88,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    this.pitchMesh = new THREE.Mesh(pitchGeo, this.pitchMat);
    this.pitchMesh.position.y = 0.02;
    this.pitchMesh.receiveShadow = true;
    this.scene.add(this.pitchMesh);

    const creaseMesh = new THREE.Mesh(
      pitchGeo,
      new THREE.MeshBasicMaterial({
        map: this.createCreaseOverlayTexture(),
        transparent: true,
        depthWrite: false
      })
    );
    creaseMesh.position.y = 0.024;
    this.scene.add(creaseMesh);

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
      new THREE.RingGeometry(0.19, 0.29, 32).rotateX(-Math.PI / 2),
      this.aimOuterMat
    );
    const innerDiscMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.11, 24).rotateX(-Math.PI / 2),
      this.aimInnerMat
    );
    this.aimRing.add(outerRingMesh, innerDiscMesh);
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
    const trailMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.8 });
    this.trailLine = new THREE.Line(this.trailGeo, trailMat);
    this.trailLine.frustumCulled = false;
    this.scene.add(this.trailLine);

    this.stadiumGroups = {
      eden_gardens: this.buildEdenGardensStadium(),
      wankhede: this.buildWankhedeStadium(),
      narendra_modi: this.buildNarendraModiStadium()
    };
    Object.values(this.stadiumGroups).forEach((g) => this.scene.add(g));
    this.setStadium(this.match.stadium || 'eden_gardens', this.match.timeOfDay || 'night');

    this.rebuildTeamCharacters();

    this.renderer.compile(this.scene, this.camera);
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
      roughness: 0.36,
      metalness: 0.08,
      emissive: 0x000000
    });

    const stumps = [];
    const stumpGeo = new THREE.CylinderGeometry(0.019, 0.019, STUMP_HEIGHT, 14);
    stumpGeo.translate(0, STUMP_HEIGHT / 2, 0);

    [-STUMP_WIDTH / 2, 0, STUMP_WIDTH / 2].forEach((xOffset) => {
      const s = new THREE.Mesh(stumpGeo, woodMat.clone());
      s.position.set(xOffset, 0, 0);
      s.castShadow = true;
      group.add(s);
      stumps.push(s);
    });

    const bails = [];
    const bailGeo = new THREE.CylinderGeometry(0.009, 0.009, STUMP_WIDTH * 0.48, 10);
    bailGeo.rotateZ(Math.PI / 2);
    [-STUMP_WIDTH * 0.25, STUMP_WIDTH * 0.25].forEach((xOffset) => {
      const b = new THREE.Mesh(bailGeo, woodMat.clone());
      b.position.set(xOffset, STUMP_HEIGHT + 0.012, 0);
      group.add(b);
      bails.push(b);
    });

    return { group, stumps, bails };
  }

  resetWickets() {
    this.bailsDislodged = false;
    [this.strikerStumps, this.nonStrikerStumps].forEach((set) => {
      [-STUMP_WIDTH / 2, 0, STUMP_WIDTH / 2].forEach((xOffset, idx) => {
        const s = set.stumps[idx];
        s.position.set(xOffset, 0, 0);
        s.rotation.set(0, 0, 0);
        s.material.emissive.setHex(0x000000);
      });
      [-STUMP_WIDTH * 0.25, STUMP_WIDTH * 0.25].forEach((xOffset, idx) => {
        const b = set.bails[idx];
        b.position.set(xOffset, STUMP_HEIGHT + 0.012, 0);
        b.rotation.set(0, 0, 0);
        b.material.emissive.setHex(0x000000);
      });
    });
  }

  dislodgeWickets(end = 'striker') {
    this.bailsDislodged = true;
    this.dislodgedEnd = end;
    this.bailTimer = 0;
    const set = end === 'striker' ? this.strikerStumps : this.nonStrikerStumps;
    set.stumps.forEach((s) => s.material.emissive.setHex(0xef4444));
    set.bails.forEach((b) => b.material.emissive.setHex(0xef4444));
    sound.playStumpsHit();
  }

  /**
   * Builds Expressive Low-Poly Rigged Characters (or Soldier glTF if CHARACTER_STYLE === 'soldier')
   * for Striker, Non-Striker, Bowler, Wicketkeeper, and 9 LOD Fielders with team jersey colours & numbers
   */
  rebuildTeamCharacters() {
    if (this.actorsGroup) {
      this.scene.remove(this.actorsGroup);
    }
    this.actorsGroup = new THREE.Group();
    this.scene.add(this.actorsGroup);

    const batTeam = this.match.battingTeam;
    const bowlTeam = this.match.bowlingTeam;
    const skinTones = [0xd69e72, 0xc68642, 0xe0ac69, 0x8d5524, 0xf1c27d];

    // 1. Striker (Low-Poly Rigged Character + Detailed English Willow Bat on Bat Pivot)
    this.strikerPlayer = new RiggedCricketPlayer({
      baseGltf: this.baseGltf,
      mocapClips: this.mocapClips,
      role: 'batsman',
      colorHex: batTeam.primaryColor,
      secondaryColorHex: batTeam.secondaryColor,
      jerseyNumber: batTeam.defaultNumber || 18,
      skinHex: skinTones[this.match.strikerIndex % skinTones.length],
      useLOD: false
    });
    this.strikerMesh = this.strikerPlayer.group;
    this.strikerMesh.position.set(0, 0, CREASE_Z);
    this.strikerMesh.rotation.y = Math.PI; // Faces bowler (-Z)
    this.strikerMesh.scale.x = this.handedness === 'left' ? -1 : 1;

    const strikerBatPivot = new THREE.Group();
    strikerBatPivot.position.set(0.0, 1.08, 0.24);
    const detailedBat = createDetailedCricketBatMesh();
    strikerBatPivot.add(detailedBat);
    this.strikerMesh.add(strikerBatPivot);
    this.strikerMesh.userData.batPivot = strikerBatPivot;
    this.actorsGroup.add(this.strikerMesh);

    // 2. Non-Striker (Low-Poly Rigged Character + Detailed Willow Bat)
    this.nonStrikerPlayer = new RiggedCricketPlayer({
      baseGltf: this.baseGltf,
      mocapClips: this.mocapClips,
      role: 'batsman',
      colorHex: batTeam.primaryColor,
      secondaryColorHex: batTeam.secondaryColor,
      jerseyNumber: ((batTeam.defaultNumber || 18) + 7) % 99 || 7,
      skinHex: skinTones[this.match.nonStrikerIndex % skinTones.length],
      useLOD: true
    });
    this.nonStrikerMesh = this.nonStrikerPlayer.group;
    this.nonStrikerMesh.position.set(-0.95, 0, -CREASE_Z + 0.3);
    this.nonStrikerMesh.rotation.y = 0;
    const nonStrikerBat = createDetailedCricketBatMesh();
    nonStrikerBat.position.set(0.24, 0.95, 0.18);
    this.nonStrikerMesh.add(nonStrikerBat);
    this.actorsGroup.add(this.nonStrikerMesh);

    // 3. Bowler (Low-Poly Rigged Character)
    this.bowlerPlayer = new RiggedCricketPlayer({
      baseGltf: this.baseGltf,
      mocapClips: this.mocapClips,
      role: 'bowler',
      colorHex: bowlTeam.primaryColor,
      secondaryColorHex: bowlTeam.secondaryColor,
      jerseyNumber: bowlTeam.defaultNumber || 99,
      skinHex: skinTones[this.match.currentBowlerIndex % skinTones.length],
      useLOD: false
    });
    this.bowlerMesh = this.bowlerPlayer.group;
    this.bowlerMesh.position.set(0.35, 0, -CREASE_Z - 6.5);
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

    // 6. 3D Match Umpire standing behind non-striker stumps with articulated signal arms
    this.umpireMesh = this.build3DUmpireMesh();
    this.umpireMesh.position.set(0, 0, -CREASE_Z - 1.65);
    this.umpireMesh.rotation.y = 0;
    this.actorsGroup.add(this.umpireMesh);
  }

  build3DUmpireMesh() {
    const g = new THREE.Group();
    const trousersMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.55 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd69e72, roughness: 0.6 });
    const hatMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });

    const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.82, 10), trousersMat);
    leftLeg.position.set(-0.11, 0.41, 0);
    const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.82, 10), trousersMat);
    rightLeg.position.set(0.11, 0.41, 0);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.24), shirtMat);
    torso.position.set(0, 1.12, 0);
    torso.castShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 14), skinMat);
    head.position.set(0, 1.58, 0);

    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 16), hatMat);
    hatBrim.position.set(0, 1.68, 0);
    const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.11, 14), hatMat);
    hatCrown.position.set(0, 1.74, 0);

    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.26, 1.36, 0);
    const leftArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.048, 0.56, 10), shirtMat);
    leftArmMesh.position.set(0, -0.26, 0);
    leftArmPivot.add(leftArmMesh);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.26, 1.36, 0);
    const rightArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.048, 0.56, 10), shirtMat);
    rightArmMesh.position.set(0, -0.26, 0);
    rightArmPivot.add(rightArmMesh);

    g.add(leftLeg, rightLeg, torso, head, hatBrim, hatCrown, leftArmPivot, rightArmPivot);
    g.userData.leftArm = leftArmPivot;
    g.userData.rightArm = rightArmPivot;
    return g;
  }

  triggerUmpireSignal(signal = 'idle') {
    this.umpireSignal = signal;
    this.umpireSignalTimer = signal === 'idle' ? 0 : 2.8;
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

  addStadiumCrowdBowl(group, crowdCount, palette) {
    const crowdGeo = new THREE.BoxGeometry(0.65, 0.95, 0.65);
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    const crowdInst = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);

    for (let i = 0; i < crowdCount; i++) {
      const angle = (i / crowdCount) * Math.PI * 2 + (i % 5) * 0.03;
      const tier = i % 5;
      const r = BOUNDARY_RADIUS + 8.5 + tier * 2.8;
      const y = 2.4 + tier * 2.2;
      _dummyObj.position.set(Math.sin(angle) * r, y, Math.cos(angle) * r);
      _dummyObj.rotation.y = angle + Math.PI;
      _dummyObj.scale.setScalar(1);
      _dummyObj.updateMatrix();
      crowdInst.setMatrixAt(i, _dummyObj.matrix);
      crowdInst.setColorAt(i, _tmpColor.setHex(palette[i % palette.length]));
    }
    crowdInst.instanceMatrix.needsUpdate = true;
    crowdInst.instanceColor.needsUpdate = true;
    crowdInst.computeBoundingSphere();
    group.add(crowdInst);
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

    // Main double-tier seating bowl
    const standGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 24, BOUNDARY_RADIUS + 6, 13.5, 48, 1, true);
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f,
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

    // Historic BC Roy Clubhouse Pavilion + Sightscreens
    const ssMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
    [-BOUNDARY_RADIUS - 4, BOUNDARY_RADIUS + 4].forEach((z) => {
      const ss = new THREE.Mesh(new THREE.BoxGeometry(12, 6.5, 0.8), ssMat);
      ss.position.set(0, 3.25, z);
      group.add(ss);
    });

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
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.65,
      side: THREE.DoubleSide
    });
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
      color: 0x7c2d12,
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
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0284c7,
      emissiveIntensity: 0.75,
      side: THREE.DoubleSide
    });
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

    // Lower & Upper Colossal Seating Bowl
    const lowerGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 18, BOUNDARY_RADIUS + 6, 10, 64, 1, true);
    const lowerMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      roughness: 0.68,
      side: THREE.DoubleSide
    });
    const lowerStand = new THREE.Mesh(lowerGeo, lowerMat);
    lowerStand.position.y = 5.0;
    group.add(lowerStand);

    const upperGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 30, BOUNDARY_RADIUS + 17, 11, 64, 1, true);
    const upperMat = new THREE.MeshStandardMaterial({
      color: 0xc2410c,
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
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 0.8,
      side: THREE.DoubleSide
    });
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
      if (this.bloomPass) this.bloomPass.strength = 0.20;
    } else {
      this.scene.background = new THREE.Color(0x060b16);
      this.scene.fog.color.setHex(0x060b16);
      this.keyLight.color.setHex(0xfffbeb);
      this.keyLight.intensity = 2.1;
      this.hemiLight.intensity = 0.72;
      this.outfieldMat.color.setHex(0xffffff);
      if (this.bloomPass) this.bloomPass.strength = 0.46;
    }
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
    if (this.batting) {
      this.batting.screenRightSign = mode === 'broadcast' ? -1 : 1;
    }
  }

  setFieldPreset(presetId) {
    this.fielding.applyFieldSetting(presetId, this.match.isPowerplayActive());
    this.fielding.resetToHomePositions(this.bowling.bowlerType);
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

  setAimRingColor(hexColor = 0xf59e0b) {
    if (this.aimOuterMat) this.aimOuterMat.color.setHex(hexColor);
    if (this.aimInnerMat) this.aimInnerMat.color.setHex(hexColor);
  }

  scheduleAutoBowl(customDelaySec = null) {
    const mode = gameConfig.autoBowl || 'normal';
    if (mode === 'manual') {
      this.autoBowlScheduled = false;
      this.autoBowlCountdown = 0;
      return;
    }
    const defaultDelay = mode === 'fast' ? 1.25 : 2.05;
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
    this.handedness = hand === 'left' ? 'left' : 'right';
    this.batting.setHandedness(this.handedness);
    if (this.strikerMesh) {
      this.strikerMesh.scale.x = this.handedness === 'left' ? -1 : 1;
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

    if (preset === 'low') {
      this.renderer.setPixelRatio(1.0);
      this.renderer.shadowMap.enabled = false;
      this.keyLight.castShadow = false;
      if (this.bokehPass) this.bokehPass.enabled = false;
      if (this.bloomPass) this.bloomPass.enabled = false;
    } else if (preset === 'medium') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.4));
      this.renderer.shadowMap.enabled = true;
      this.keyLight.castShadow = true;
      if (this.bokehPass) this.bokehPass.enabled = false;
      if (this.bloomPass) this.bloomPass.enabled = true;
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
      this.renderer.shadowMap.enabled = true;
      this.keyLight.castShadow = true;
      if (this.bokehPass) this.bokehPass.enabled = this.dofEnabled;
      if (this.bloomPass) this.bloomPass.enabled = true;
    }
  }

  applyGraphicsSettings(res = '1080p', fps = '60') {
    this.targetFps = Number(fps) || 60;
    if (this.isHeadless) return;
    const ratio = res === '720p' ? 1.0 : Math.min(window.devicePixelRatio, 2.0);
    this.renderer.setPixelRatio(ratio);
  }

  selectShotMode(mode) {
    if (this.batting.setShotMode(mode)) {
      this.net.vibratePhone('p1', [35]);
      this.net.syncShotModeLock(this.batting.shotMode, this.batting.modeLocked);
      this.ui.updateShotModeHUD();
    } else {
      this.ui.setCommentary(
        `Shot mode is locked (${this.batting.shotMode.toUpperCase()}) after bowler release!`,
        `गेंद छूटने के बाद शॉट मोड लॉक हो चुका है!`
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
      return (
        candidate.category === 'wicket' ||
        candidate.category === 'boundary' ||
        candidate.category === 'drop' ||
        candidate.category === 'close_decision'
      );
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
    };

    this.net.callbacks.onSensorData = (packet, slot) => {
      if (this.match.userRole === 'bat' || slot === 'p1') {
        this.batting.ingestSensorPacket(packet, 0.014, {
          onCalibrationComplete: () => {
            this.net.vibratePhone(slot, [80, 50, 120]);
            this.ui.closeModal('modal-calibrate');
            this.ui.showToast('Phone calibrated · 0° forward set straight down the ground', 'success');
            this.ui.showEventBanner('PHONE CALIBRATED!', '0° Forward set straight over bowler. Full 360° shots ready!', 'text-emerald-400');
          },
          onSwingPeak: () => {
            if (this.isReplaying || this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;
            if (this.physics.state === 'bowled') {
              this.checkAndExecuteBattingContact();
            } else if (this.physics.state === 'idle' && this.match.userRole === 'bat') {
              this.startNextDelivery();
            }
          },
          onStepDetected: (stepIncrement, cadenceHz) => {
            if (this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;
            if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
              this.advanceStepRun(stepIncrement, cadenceHz);
            }
          },
          onQuickFlick: () => {
            if (this.isReplaying || this.pendingReplayStartTimer) {
              this.skipReplay();
              return;
            }
            if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
              this.triggerExtraRun();
            }
          }
        });
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
          'Bowler charging in from phone run-up... Swing overarm to release!',
          'गेंदबाज रन-अप पर... गेंद छोड़ने के लिए फ़ोन को ऊपर से घुमाएं!'
        );
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
      if (msg.isTap) {
        if (this.physics.state === 'idle') {
          this.startNextDelivery();
        }
        return;
      }
      if (this.physics.state === 'idle') {
        this.startNextDelivery();
      }
      const dirSign = this.batting.screenRightSign || -1;
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
      if (dir < 0) {
        this.batting.keys.left = held;
      } else {
        this.batting.keys.right = held;
      }
      if (held) {
        this.stepBatsmanCrease(dir);
      }
    };

    this.net.callbacks.onPauseChange = (paused, remainingSec) => {
      const overlay = document.getElementById('pause-reconnect-banner');
      const secEl = document.getElementById('pause-reconnect-sec');
      if (overlay) overlay.classList.toggle('hidden', !paused);
      if (secEl) secEl.textContent = `${remainingSec}s`;
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
      if (code === 'ArrowLeft' || code === 'KeyA') {
        this.batting.keys.left = true;
        this.bowling.aimTargetX = THREE.MathUtils.clamp(
          this.bowling.aimTargetX - 0.08 * dirSign,
          -0.85,
          0.85
        );
      } else if (code === 'ArrowRight' || code === 'KeyD') {
        this.batting.keys.right = true;
        this.bowling.aimTargetX = THREE.MathUtils.clamp(
          this.bowling.aimTargetX + 0.08 * dirSign,
          -0.85,
          0.85
        );
      } else if (code === 'ArrowUp' || code === 'KeyW') {
        this.batting.keys.up = true;
        this.bowling.aimBounceZ = Math.min(8.6, this.bowling.aimBounceZ + 0.45);
        if (this.match.userRole === 'bat' && !this.batting.modeLocked && this.batting.shotMode !== 'fly') {
          this.selectShotMode('fly');
        }
      } else if (code === 'ArrowDown' || code === 'KeyS') {
        this.batting.keys.down = true;
        this.bowling.aimBounceZ = Math.max(0.5, this.bowling.aimBounceZ - 0.45);
        if (this.match.userRole === 'bat' && !this.batting.modeLocked && this.batting.shotMode !== 'ground') {
          this.selectShotMode('ground');
        }
      } else if (code === 'KeyG') {
        this.selectShotMode('ground');
      } else if (code === 'KeyF') {
        this.selectShotMode('fly');
      } else if (code === 'KeyH') {
        this.ui.toggleDock();
      } else if (code === 'KeyC') {
        const modes = ['broadcast', 'pro', 'overhead'];
        const next = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length];
        this.setCameraMode(next);
      } else if (code === 'KeyR') {
        this.setRunButtonHeld(true);
        this.triggerExtraRun();
      } else if (code === 'KeyT') {
        this.turnBackRunner();
      } else if (code === 'KeyV') {
        this.toggleBowlerSide();
      } else if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter' || e.key === 'Enter') {
        e.preventDefault();
        sound.init();
        if (this.isReplaying || this.pendingReplayStartTimer) {
          this.skipReplay();
          return;
        }
        if (this.physics.state === 'idle') {
          if (e.shiftKey) this.selectShotMode('fly');
          this.startNextDelivery();
        } else if (this.physics.state === 'runup') {
          if (this.match.userRole === 'bowl') {
            // Timed manual release during bowling run-up: closer to crease = faster pace!
            const timingQuality = 1 - Math.min(1, Math.abs(0.92 - this.bowling.runupProgress) * 2.2);
            const paceFactor = 0.78 + timingQuality * 0.22;
            const manualDelivery = this.bowling.triggerManualDelivery(paceFactor);
            this.releaseBowledBall(manualDelivery);
          } else if (this.bowling.runupProgress < 0.72) {
            // Fast-forward AI bowler run-up to delivery gather stride if batter presses Space/OK early
            this.bowling.runupProgress = 0.74;
          }
        } else if (this.physics.state === 'bowled') {
          const worldAimX = this.batting.aimDirectionX * dirSign;
          const planePitchDeg = this.batting.shotMode === 'fly' ? 30 : 4;
          const shotAngleDeg = this.batting.keys.down
            ? (worldAimX < -0.15 ? -145 : worldAimX > 0.15 ? 145 : -168)
            : worldAimX * 95;
          this.batting.triggerManualSwing({
            speedDeg: 475,
            dirX: worldAimX,
            shotAngleDeg,
            planePitchDeg
          });
          this.checkAndExecuteBattingContact();
        } else if (this.qteActive) {
          this.triggerFieldingReflexQTE();
        } else if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
          this.triggerExtraRun();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      if (code === 'ArrowLeft' || code === 'KeyA') this.batting.keys.left = false;
      if (code === 'ArrowRight' || code === 'KeyD') this.batting.keys.right = false;
      if (code === 'ArrowUp' || code === 'KeyW') this.batting.keys.up = false;
      if (code === 'ArrowDown' || code === 'KeyS') this.batting.keys.down = false;
      if (code === 'KeyR') this.setRunButtonHeld(false);
    });

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      sound.init();
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.pointerDownTime = performance.now();
    });

    dom.addEventListener('pointerup', (e) => {
      if (!this.pointerDownPos) return;
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      const dtMs = Math.max(16, performance.now() - this.pointerDownTime);
      const distPx = Math.hypot(dx, dy);
      this.pointerDownPos = null;

      if (this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) return;
      if (this.isReplaying || this.pendingReplayStartTimer) {
        this.skipReplay();
        return;
      }

      if (distPx < 18) {
        if (this.physics.state === 'idle') this.startNextDelivery();
        return;
      }

      const dirSign = this.batting.screenRightSign || -1;
      const swipeSpeedDeg = THREE.MathUtils.clamp((distPx / dtMs) * 265, 190, 560);
      const dirX = THREE.MathUtils.clamp((dx / 140) * dirSign, -1, 1);
      // Full 360-degree swipe angle mapped to camera view so swiping Right hits Right on screen
      const shotAngleDeg = Math.atan2(dx * dirSign, -dy) * (180 / Math.PI);
      const planePitchDeg = this.batting.shotMode === 'fly'
        ? THREE.MathUtils.clamp((distPx / 140) * 34, 20, 45)
        : 4;

      if (this.physics.state === 'idle') {
        this.startNextDelivery();
      } else if (this.physics.state === 'bowled') {
        this.batting.triggerManualSwing({
          speedDeg: swipeSpeedDeg,
          dirX,
          shotAngleDeg,
          planePitchDeg
        });
        this.checkAndExecuteBattingContact();
      }
    });
  }

  triggerActionFromUI(action) {
    sound.init();
    if (action === 'skip_replay') {
      this.skipReplay();
      return;
    }
    if (this.isReplaying || this.pendingReplayStartTimer) {
      this.skipReplay();
      return;
    }
    if (action === 'bowl_or_swing') {
      if (this.physics.state === 'idle') {
        this.startNextDelivery();
      } else if (this.physics.state === 'bowled') {
        const dirSign = this.batting.screenRightSign || -1;
        const worldAimX = this.batting.aimDirectionX * dirSign;
        const planePitchDeg = this.batting.shotMode === 'fly' ? 30 : 4;
        this.batting.triggerManualSwing({
          speedDeg: 465,
          dirX: worldAimX,
          shotAngleDeg: worldAimX * 95,
          planePitchDeg
        });
        this.checkAndExecuteBattingContact();
      }
    } else if (action === 'defend_shot') {
      if (this.physics.state === 'bowled') {
        this.batting.triggerManualSwing({
          speedDeg: 150,
          dirX: 0,
          shotAngleDeg: 0,
          planePitchDeg: 2,
          isDefensive: true
        });
        this.checkAndExecuteBattingContact();
      }
    } else if (action === 'take_extra_run') {
      this.triggerExtraRun();
    } else if (action === 'turn_back') {
      this.turnBackRunner();
    }
  }

  startCalibrationFlow() {
    this.batting.startCalibration();
    const bar = document.getElementById('calib-progress-bar');
    if (bar) bar.style.width = '0%';
    this.ui.openModal('modal-calibrate');
  }

  performCoinToss(userCall = 'HEADS') {
    sound.playCoinFlip();
    const coinSide = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
    const cleanCall = String(userCall || 'HEADS').toUpperCase() === 'TAILS' ? 'TAILS' : 'HEADS';
    const userWon = cleanCall === coinSide;

    this.ui.t20TossDone = true;
    this.ui.t20UserWonToss = userWon;

    const teamAIdx = Number(document.getElementById('setup-team-a')?.value) || 0;
    const teamBIdx = Number(document.getElementById('setup-team-b')?.value) || 1;
    const teamAName = FICTIONAL_TEAMS[teamAIdx]?.nameEn || 'Your Team';
    const teamBName = FICTIONAL_TEAMS[teamBIdx]?.nameEn || 'Opponent';

    const resEl = document.getElementById('toss-result-text');
    const choiceRow = document.getElementById('toss-user-choice-row');
    const roleSel = document.getElementById('setup-role');

    if (userWon) {
      if (roleSel) roleSel.value = 'bat';
      if (choiceRow) choiceRow.classList.remove('hidden');
      if (resEl) {
        resEl.textContent = `Coin landed ${coinSide} (You called ${cleanCall})! ${teamAName} won the toss — choose Bat or Bowl below!`;
        resEl.className = 'text-xs font-bold text-emerald-400 mt-0.5';
      }
    } else {
      if (choiceRow) choiceRow.classList.add('hidden');
      const aiChoseBat = Math.random() < 0.5;
      const userRole = aiChoseBat ? 'bowl' : 'bat';
      if (roleSel) roleSel.value = userRole;
      if (resEl) {
        resEl.textContent = `Coin landed ${coinSide} (You called ${cleanCall})! ${teamBName} won the toss and elected to ${
          aiChoseBat ? 'BAT' : 'BOWL'
        } first! (You ${userRole.toUpperCase()} first)`;
        resEl.className = 'text-xs font-bold text-amber-400 mt-0.5';
      }
    }
  }

  startConfiguredMatchFromUI() {
    sound.init();
    const modeId = document.getElementById('setup-mode')?.value || this.ui.setupMode || 'run_chase';
    const customT20Overs = Number(document.getElementById('setup-t20-overs')?.value) || 20;
    const overs = modeId === 't20' ? customT20Overs : 5;
    const matchType = document.getElementById('setup-match-type')?.value || 'ai';
    const difficulty = document.getElementById('setup-difficulty')?.value || 'medium';
    const stadium = document.getElementById('setup-stadium')?.value || 'eden_gardens';
    const timeOfDay = document.getElementById('setup-day-night')?.value || 'night';
    const teamAIndex = Number(document.getElementById('setup-team-a')?.value) || 0;
    const teamBIndex = Number(document.getElementById('setup-team-b')?.value) || 1;
    const teamAData = FICTIONAL_TEAMS[teamAIndex % FICTIONAL_TEAMS.length];
    const jerseyColorA = teamAData?.primaryColor || '#0284c7';
    const jerseyNumberA = teamAData?.defaultNumber || 18;
    const roleChoice = modeId === 'run_chase' ? 'bat' : (document.getElementById('setup-role')?.value || 'bat');
    const pitchType = document.getElementById('setup-pitch-type')?.value || 'normal';
    const handedness = document.getElementById('setup-handedness')?.value || this.handedness;

    // Pick a fresh random target within the selected difficulty range every time Run Chase starts!
    const freshChaseTarget = modeId === 'run_chase' ? rollRunChaseTarget(difficulty) : null;
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

    this.ui.t20TossDone = false;
    // Require one-time Play confirmation on the Ready-to-Play + QR Gate popup before the first ball is bowled!
    this.matchPlayConfirmed = false;
    this.setStadium(this.match.stadium, this.match.timeOfDay);
    this.ui.syncStadiumAndDayNightUI(this.match.stadium, this.match.timeOfDay);
    this.setHandedness(handedness);
    this.setPitchType(pitchType);
    this.rebuildTeamCharacters();
    this.resetBallAndFielders();
    this.updateMatchTension();
    this.ui.updateHUD();
  }

  confirmPlayAndStartMatch() {
    sound.init();
    this.matchPlayConfirmed = true;
    this.ui.closeModal('modal-qr');
    this.scheduleAutoBowl(1.6);

    const groundObj = INDIAN_STADIUMS.find((s) => s.id === this.match.stadium);
    const groundName = groundObj ? groundObj.shortEn : 'Eden Gardens';
    const timeLabel = this.match.timeOfDay === 'day' ? 'Day' : 'Night';

    if (this.match.modeId === 'run_chase') {
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
    commentary.trigger('match_start', this.getCommentaryContext(), true);
  }

  joinCustomRoom(code) {
    this.net.connect(code, 'p1');
    this.ui.showEventBanner(`ROOM ${code}`, 'Connected to room relay', 'text-sky-400');
  }

  startNextDelivery() {
    if (this.isReplaying || this.pendingReplayStartTimer) {
      this.skipReplay();
    }
    if (this.postDeliveryResetTimer) {
      clearTimeout(this.postDeliveryResetTimer);
      this.postDeliveryResetTimer = null;
    }

    if (this.match.isMatchOver) {
      // Do NOT silently zero out the match score when the match is already over — show Scorecard instead!
      this.autoBowlScheduled = false;
      this.ui.renderScorecardAndWagonWheel();
      this.ui.openModal('modal-scorecard');
      return;
    }

    this.resetWickets();
    this.batting.resetForNextBall();
    this.bowling.resetForNextBall();
    this.net.syncShotModeLock(this.batting.shotMode, false);
    this.ui.updateShotModeHUD();

    this.fielding.applyFieldSetting(this.fielding.setting, this.match.isPowerplayActive());
    this.fielding.resetToHomePositions(this.bowling.bowlerType);
    this.updateMatchTension();

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
    this.strikerMeshZ = CREASE_Z;
    this.nonStrikerMeshZ = -CREASE_Z;
    this.bounceMarker.visible = false;
    this.replayFrames = [];
    this.currentBallHighlight = null;
    this.activeReplayHighlight = null;
    this.ui.updateRunningBar({ active: false });

    // Pre-compute AI delivery at start of run-up so Rookie/Club Delivery Preview & 3D Length Bullseye work
    const diffProfile = getDifficultyProfile(this.match.difficulty);
    if (this.match.userRole === 'bat') {
      this.pendingAIDelivery = this.bowling.generateAIDelivery(
        this.match.difficulty,
        this.match.legalBalls,
        this.handedness
      );
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

    if (this.strikerPlayer) this.strikerPlayer.playClip('stance', 0.2);
    if (this.bowlerPlayer) this.bowlerPlayer.playClip('bowling_runup', 0.15, 1.3);

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

  releaseBowledBall(delivery) {
    this.batting.lockShotMode();
    this.net.syncShotModeLock(this.batting.shotMode, true);
    this.ui.updateShotModeHUD();

    if (this.bowlerPlayer) {
      this.bowlerPlayer.playClip('bowling_release', 0.12, 1.15);
    }

    // Subtle crease landing chalk/dust puff at bowler's front foot
    this.spawnDustPuff(new THREE.Vector3(this.bowlerMesh.position.x, 0.04, -CREASE_Z), 0.32);

    const diffProfile = getDifficultyProfile(this.match.difficulty);
    const previewMode = delivery.deliveryPreview || diffProfile.deliveryPreview || 'hidden';
    this.aimRing.position.set(delivery.targetX, 0.035, delivery.bounceZ);
    this.setAimRingColor(delivery.lengthColorHex || 0xf59e0b);
    // Keep pitching spot bullseye visible during ball flight so batter can read the length & play front/back foot!
    this.aimRing.visible = true;
    if (previewMode === 'hidden') {
      this.ui.showDeliveryPreview(
        {
          customStatusText: `${delivery.lengthLabelEn} · ${Math.round(delivery.speedKmh)} km/h`,
          lengthCategory: delivery.lengthCategory
        },
        'briefly'
      );
    }

    this.physics.launchDelivery(delivery);
    sound.playUmpireSignal('whistle');
    this.ui.updateHUD();
    commentary.trigger('delivery_release', this.getCommentaryContext());
  }

  /**
   * Plays matching animation clip for all 360-degree shots including Sweep, Scoop, and Ramp
   */
  triggerStrikerMocapShot(shotKey) {
    if (!this.strikerPlayer) return;
    const map = {
      defence: 'defence',
      straight_drive: 'drive',
      cover_drive: 'drive',
      square_cut: 'cut',
      late_cut: 'cut',
      upper_cut: 'ramp',
      leg_flick: 'pull',
      pull_shot: 'pull',
      sweep: 'sweep',
      scoop: 'scoop',
      ramp: 'ramp',
      lofted_six: 'loft'
    };
    const clipName = map[shotKey] || 'drive';
    this.strikerPlayer.playClip(clipName, 0.08, 1.15);
  }

  checkAndExecuteBattingContact() {
    // Hit-wicket check if batter retreats deep onto the stumps and swings wildly
    if (
      !this.batting.shotExecutedThisBall &&
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
      onBallHit: (info, isEdge) => {
        this.triggerStrikerMocapShot(info.shotKey);
        const pan = this.getBallPan();
        const batPower = THREE.MathUtils.clamp(
          (info.batSpeedDeg / 480) * (0.55 + info.timingQuality * 0.55),
          0.22,
          1.15
        );

        if (isEdge) {
          const isThick = info.contactType.toLowerCase().includes('thick') || info.timingQuality > 0.55;
          sound.playBatHit(batPower, false, isThick ? 'thick_edge' : 'thin_edge', pan);
          this.net.vibratePhone('p1', [35]);
          this.registerReplayHighlight({
            category: 'edge_nearmiss',
            priority: 50,
            label: info.contactType.toUpperCase().includes('INSIDE') ? 'INSIDE EDGE' : 'OUTSIDE EDGE',
            cameraStyle: 'stumps',
            focusPos: new THREE.Vector3(0, 0.65, PITCH_HALF_LENGTH - 0.5)
          });
          this.ui.setCommentary(
            `${info.contactType}! Launch ${info.launchAngleDeg}° (${info.shotMode.toUpperCase()} mode).`,
            `${info.contactType}! लॉन्च कोण ${info.launchAngleDeg}°`
          );
        } else {
          sound.playBatHit(batPower, info.timingQuality >= 0.72, info.timingQuality >= 0.72 ? 'sweet' : 'thick_edge', pan);
          this.net.vibratePhone('p1', [75]);
          this.savedCameraMode = this.cameraMode;
          this.cameraMode = 'follow';

          // Do NOT auto-run on shot contact! Keep batter safe in the crease (runnerProgress = 0)
          // and open the Run Window so the player only runs when pressing Run/+1/R or stepping with the phone.
          this.batting.startRunWindow();

          this.ui.setCommentary(
            `${info.shotNameEn} [${info.shotDirectionDeg ?? 0}° · ${info.shotMode.toUpperCase()} · ${info.launchAngleDeg}°]! ${info.timingLabelEn} (${info.exitSpeedKmh} km/h). Press Run (R) to take a single!`,
            `${info.shotNameHi} [${info.shotDirectionDeg ?? 0}° · ${info.shotMode.toUpperCase()}]! रन लेने के लिए Run (R) दबाएं!`
          );
        }
        this.ui.updateHUD();
      },
      onSwingMiss: (info) => {
        this.triggerStrikerMocapShot(this.batting.shotMode === 'fly' ? 'loft' : 'drive');
        sound.playCrowdReaction('near_miss', this.getBallPan());
        commentary.trigger('near_miss', this.getCommentaryContext());
        this.ui.updateHUD();
      }
    });
    return contact;
  }

  startSingleRunSprint() {
    this.batting.startRunWindow();
    if (!this.runnersInMotion && this.runsCompletedThisBall < 4) {
      this.runnersInMotion = true;
      this.runnerReturning = false;
      this.runnerStoppedMidPitch = false;
      // Give an initial push off the crease; phone steps or holding R drives full cadence
      if (this.runnerProgress <= 0.01) {
        this.runnerProgress = 0.08;
      }
      if (this.strikerPlayer) this.strikerPlayer.playClip('bowling_runup', 0.15, 1.25);
      if (this.nonStrikerPlayer) this.nonStrikerPlayer.playClip('bowling_runup', 0.15, 1.25);
    }
  }

  /**
   * Triggered by each real physical walking/jogging step detected on the phone
   */
  advanceStepRun(stepIncrement = 0.16, cadenceHz = 2.4) {
    if (this.physics.state !== 'hit' && this.physics.state !== 'fielded') return;
    if (!this.runnersInMotion) {
      this.runnersInMotion = true;
    }
    this.runnerStoppedMidPitch = false;

    const dir = this.runnerReturning ? -1 : 1;
    this.runnerProgress = THREE.MathUtils.clamp(
      this.runnerProgress + dir * stepIncrement * 0.55,
      0,
      1.05
    );

    const animSpeed = THREE.MathUtils.clamp(0.85 + cadenceHz * 0.25, 0.9, 1.75);
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
      this.runnerStoppedMidPitch = false;
      if (!this.runnersInMotion) {
        this.startSingleRunSprint();
      }
    }
  }

  setHoldRun(isHeld) {
    this.setRunButtonHeld(isHeld);
  }

  turnBackRunner() {
    if (this.physics.state !== 'hit' && this.physics.state !== 'fielded') return;
    if (this.runnerProgress > 0.02 && this.runnerProgress < 0.95) {
      this.runnerReturning = !this.runnerReturning;
      this.runnerStoppedMidPitch = false;
      this.runnersInMotion = true;
      if (this.strikerPlayer) this.strikerPlayer.playClip('bowling_runup', 0.12, 1.35);
      if (this.nonStrikerPlayer) this.nonStrikerPlayer.playClip('bowling_runup', 0.12, 1.35);
      this.ui.setCommentary(
        this.runnerReturning ? 'NO! Turning back to the crease!' : 'YES! Pushing forward for the run!',
        this.runnerReturning ? 'वापस! क्रीज की ओर लौटते हुए!' : 'रन के लिए आगे बढ़ते हुए!'
      );
    }
  }

  triggerExtraRun() {
    if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
      this.runnerReturning = false;
      this.runnerStoppedMidPitch = false;
      if (this.runnersInMotion) {
        this.pendingExtraRun = true;
        this.advanceStepRun(0.16, 2.6);
      } else {
        this.startSingleRunSprint();
      }
      this.ui.setCommentary(
        'Calling for a run! Jog with phone or hold R to sprint between the wickets!',
        'रन की कॉल! विकेटों के बीच दौड़ने के लिए फ़ोन के साथ जॉग करें या R दबाएं!'
      );
    }
  }

  triggerTeamCelebration() {
    if (this.bowlerPlayer) this.bowlerPlayer.playClip('celebration', 0.15);
    if (this.keeperPlayer) this.keeperPlayer.playClip('celebration', 0.15);
    this.fielderPlayers.forEach((fp, i) => {
      if (i % 2 === 0) fp.playClip('celebration', 0.2);
    });
  }

  completeDelivery(outcome) {
    if (this.match.isMatchOver) return;
    this.physics.state = 'dead';
    this.batting.stopRunWindow();
    this.runnersInMotion = false;
    this.runnerReturning = false;
    this.runnerStoppedMidPitch = false;
    this.runButtonHeld = false;
    this.ballHeldAtStumps = false;
    this.pendingExtraRun = false;
    this.ui.updateRunningBar({ active: false });

    const status = this.match.recordDeliveryOutcome(outcome);
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
      if (this.strikerPlayer) this.strikerPlayer.playClip('celebration', 0.15);
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
    if (outcome.isWicket && !status.freeHitDismissalPrevented) {
      this.triggerUmpireSignal('out');
    } else if (outcome.isBoundary && outcome.runsScored === 6) {
      this.triggerUmpireSignal('six');
    } else if (outcome.isBoundary && outcome.runsScored === 4) {
      this.triggerUmpireSignal('four');
    } else if (outcome.isWide) {
      this.triggerUmpireSignal('wide');
    } else if (outcome.isNoBall) {
      this.triggerUmpireSignal('noball');
    }

    // Rebuild jersey numbers if a new batter walked in serially, bowler rotated, or innings changed
    if (outcome.isWicket || status.overCompleted || status.inningsEndState === 'innings_break') {
      this.rebuildTeamCharacters();
      if (!this.match.isMatchOver && !status.inningsEndState) {
        if (outcome.isWicket && !status.freeHitDismissalPrevented) {
          const nextBatter = this.match.getActiveStriker();
          if (nextBatter) {
            this.ui.showStatusToast(`Next Batsman In: #${nextBatter.index + 1} ${nextBatter.name}`, true);
          }
        }
      }
    }

    // Decide whether to trigger the 0.28x Slow-Motion Highlight Replay
    // Normal deliveries (dot, single, two, defence, leave, ordinary wide) have currentBallHighlight === null -> NO replay!
    const highlight = this.currentBallHighlight;
    const shouldReplay = this.shouldPlayReplayForHighlight(highlight);
    const replayBadge = document.getElementById('hud-replay-badge');
    const replayReasonEl = document.getElementById('hud-replay-reason');

    if (shouldReplay && highlight) {
      this.activeReplayHighlight = highlight;
      if (replayReasonEl) {
        replayReasonEl.textContent = highlight.label;
      }
      if (replayBadge) {
        replayBadge.classList.remove('hidden');
      }

      this.pendingReplayStartTimer = setTimeout(() => {
        this.pendingReplayStartTimer = null;
        this.isReplaying = true;
        this.replayIndex = Math.max(0, this.replayFrames.length - 68);
        this.cameraMode = 'replay';
      }, 750);

      this.pendingReplayEndTimer = setTimeout(() => {
        this.pendingReplayEndTimer = null;
        this.isReplaying = false;
        this.activeReplayHighlight = null;
        if (replayBadge) replayBadge.classList.add('hidden');
        this.cameraMode = this.savedCameraMode;
        this.resetBallAndFielders();
      }, 3850);
    } else {
      if (replayBadge) replayBadge.classList.add('hidden');
      this.postDeliveryResetTimer = setTimeout(() => {
        this.postDeliveryResetTimer = null;
        this.cameraMode = this.savedCameraMode;
        this.resetBallAndFielders();
      }, 1500);
    }

    if (this.match.isMatchOver) {
      this.autoBowlScheduled = false;
      const msg = this.ui.lang === 'hi' ? this.match.winnerTextHi : this.match.winnerTextEn;
      this.ui.showEventBanner('MATCH OVER', msg, 'text-emerald-400');
      sound.playCrowdReaction('six', 0);
      commentary.trigger('match_end', this.getCommentaryContext(), true);
      setTimeout(() => {
        this.ui.renderScorecardAndWagonWheel();
        this.ui.openModal('modal-scorecard');
      }, 1900);
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
    this.physics.reset();
    this.bowling.resetForNextBall();
    this.batting.resetForNextBall();
    this.net.syncShotModeLock(this.batting.shotMode, false);
    this.ui.updateShotModeHUD();
    this.ui.showDeliveryPreview(null, 'hidden');

    this.fielding.applyFieldSetting(this.fielding.setting, this.match.isPowerplayActive());
    this.fielding.resetToHomePositions(this.bowling.bowlerType);
    this.strikerMeshZ = CREASE_Z;
    this.nonStrikerMeshZ = -CREASE_Z;

    if (this.strikerPlayer) this.strikerPlayer.playClip('stance', 0.2);
    if (this.nonStrikerPlayer) this.nonStrikerPlayer.playClip('stance', 0.2);
    if (this.bowlerPlayer) this.bowlerPlayer.playClip('idle', 0.2);
    if (this.keeperPlayer) this.keeperPlayer.playClip('idle', 0.2);
    this.fielderPlayers.forEach((fp) => fp.playClip('idle', 0.2));

    // Automatically schedule the bowler's next run-up so the player never has to press a button just to make the bowler bowl!
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
    this.batting.creaseX = THREE.MathUtils.clamp(this.batting.creaseX + stepWorldX, -0.48, 0.48);
    this.batting.aimDirectionX = THREE.MathUtils.clamp(this.batting.aimDirectionX + screenDir * 0.35, -1, 1);
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
    if (this.composer && this.graphicsQuality !== 'low') {
      try {
        this.composer.render();
        return;
      } catch {
        this.composer = null;
      }
    }
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

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.net.updateHeartbeat();
    this.updateDustPuffs(dt);

    // Pause entire gameplay loop (bowler run-up, ball flight, fielding, running, replays & auto-bowl countdown)
    // whenever the user opens the Corner Menu or any Modal!
    if (this.net.disconnectPaused || this.ui.cornerMenuOpen || this.ui.isAnyModalOpen()) {
      this.renderScene();
      return;
    }

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

    // 1.5 Automatic Pre-Delivery Bowler Countdown (Waits until one-time Play Gate is confirmed!)
    if (
      this.matchPlayConfirmed &&
      this.physics.state === 'idle' &&
      this.autoBowlScheduled &&
      gameConfig.autoBowl !== 'manual' &&
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
      this.bowling.updateRunup(
        dt,
        () => {
          if (this.bowling.state !== 'released') {
            if (this.match.userRole === 'bat') {
              const aiDelivery =
                this.pendingAIDelivery ||
                this.bowling.generateAIDelivery(this.match.difficulty, this.match.legalBalls, this.handedness);
              this.pendingAIDelivery = null;
              this.releaseBowledBall(aiDelivery);
            } else {
              const manualDelivery = this.bowling.triggerManualDelivery(0.86);
              this.releaseBowledBall(manualDelivery);
            }
          }
        },
        (stepIdx, progress) => {
          // Play rhythmic run-up footsteps as bowler charges in
          sound.playFootstepAndBreath(2.2 + progress * 0.8);
          // Reveal color-coded 3D pitching bullseye ring during delivery gather stride on Pro & Legend (like Real Cricket / WCC3)
          if (this.match.userRole === 'bat' && this.pendingAIDelivery) {
            const diffId = this.match.difficulty;
            if ((diffId === 'pro' && progress >= 0.52) || (diffId === 'legend' && progress >= 0.82)) {
              this.aimRing.visible = true;
            }
          }
        }
      );
    } else if (this.physics.state === 'bowled') {
      // Continue bowler's natural post-release follow-through stride down the pitch
      this.bowling.updateRunup(dt);

      // Difficulty-Scaled Auto-Guard Footwork Assist:
      // Easy ('full'): smooth auto-tracking; Medium ('light'): gentle partial assist; Hard ('off'): manual footwork
      const diffProfile = getDifficultyProfile(this.match.difficulty);
      const assist = diffProfile ? diffProfile.battingAssist : 'light';
      const maxTrackX = assist === 'full' ? 0.56 : assist === 'light' ? 0.34 : 0.14;
      const dampRate = assist === 'full' ? 5.5 : assist === 'light' ? 2.6 : 0.6;
      if (
        this.match.userRole === 'bat' &&
        !this.batting.keys.left &&
        !this.batting.keys.right &&
        Math.abs(this.physics.pos.x) <= maxTrackX
      ) {
        this.batting.creaseX = THREE.MathUtils.damp(
          this.batting.creaseX,
          THREE.MathUtils.clamp(this.physics.pos.x, -0.38, 0.38),
          dampRate,
          dt
        );
      }

      // Live Visual "SWING NOW!" Green Pitch Ring Flash right when the ball reaches the true hitting zone
      if (
        this.match.userRole === 'bat' &&
        this.physics.pos.z >= CREASE_Z - 2.45 &&
        this.physics.pos.z <= CREASE_Z + 0.35
      ) {
        this.setAimRingColor(0x10b981);
        this.aimRing.scale.setScalar(assist === 'off' ? 1.08 : 1.18);
      }
    }

    // 3. AI Batsman when Human is Bowling
    if (this.physics.state === 'bowled' && this.match.userRole === 'bowl') {
      this.batting.updateAIBatsman(this.physics, this.match.difficulty, {
        onBallHit: (info, isEdge) => {
          this.triggerStrikerMocapShot(info.shotKey);
          sound.playBatHit(info.timingQuality, !isEdge, isEdge ? 'thin_edge' : 'sweet', this.getBallPan());
          if (info.contactType !== 'Played-On (Inside Edge)') {
            this.savedCameraMode = this.cameraMode;
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

    // 5. Step Ball Physics
    this.physics.update(dt, {
      onPitchBounce: (bouncePos, surface, localWear) => {
        const pan = THREE.MathUtils.clamp(bouncePos.x / 20.0, -0.9, 0.9);
        sound.playPitchBounce(surface, this.physics.speedKmh, pan);
        this.bounceMarker.position.set(bouncePos.x, 0.04, bouncePos.z);
        this.bounceMarker.visible = true;
        this.pitchSurface.stampBallBounceWear(bouncePos.x, bouncePos.z);
        this.spawnDustPuff(bouncePos, localWear);
        this.ui.updateHUD();
      },
      onOutfieldBounce: (pos) => {
        const pan = THREE.MathUtils.clamp(pos.x / 28.0, -0.92, 0.92);
        sound.playPitchBounce('club', this.physics.vel.length() * 3.6, pan);
        this.spawnDustPuff(pos, 0.25);
      },
      onStumpsHit: (end) => {
        this.dislodgeWickets(end);
        this.triggerTeamCelebration();
        this.net.vibratePhone('p1', [150, 60, 200]);
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
          wicketTypeEn: 'Bowled',
          wicketTypeHi: 'बोल्ड'
        });
      },
      onBallThroughToKeeper: (ball) => {
        const pan = this.getBallPan();
        if (this.keeperPlayer) this.keeperPlayer.playClip('catch', 0.1);
        sound.playKeeperGloves(ball.speedKmh, pan);

        if (ball.isWide) {
          sound.playUmpireSignal('whistle');
          this.ui.showEventBanner('WIDE BALL', '+1 Extra Run & Re-Bowl', 'text-sky-400');
          commentary.trigger('wide_ball', this.getCommentaryContext());
          this.completeDelivery({ runsScored: 0, isWide: true });
          return;
        }
        if (ball.isNoBall) {
          sound.playUmpireSignal('no_ball');
          this.ui.showEventBanner('NO BALL · FREE HIT!', '+1 Extra Run', 'text-amber-400');
          commentary.trigger('no_ball', this.getCommentaryContext(), true);
          this.completeDelivery({ runsScored: 0, isNoBall: true });
          return;
        }

        // 1. LBW check when batter missed the ball in front of the stumps
        if (!this.batting.shotExecutedThisBall && ball.checkLBW(this.batting.creaseX)) {
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

        // 2. Stumping if batter stepped down the pitch out of the crease and missed
        if (
          (!this.batting.shotExecutedThisBall || !this.batting.lastContact.didHit) &&
          this.batting.creaseZOffset > 0.34
        ) {
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
          this.ui.showEventBanner('OUT · STUMPED!', 'Keeper whips the bails off in a flash!', 'text-red-500');
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
          this.ui.showEventBanner('FOUR RUNS!', `Cracking ${this.batting.shotMode.toUpperCase()} shot (${this.batting.lastLaunchAngleDeg}°)!`, 'text-sky-400');
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

    // Record frames during delivery & hit for Slow-Motion Highlight Replays
    if (this.physics.state === 'bowled' || this.physics.state === 'hit' || this.physics.state === 'fielded') {
      const batPivot = this.strikerMesh?.userData?.batPivot;
      this.replayFrames.push({
        ballPos: this.physics.pos.clone(),
        ballQuat: this.physics.ballQuat.clone(),
        batQuat: batPivot ? batPivot.quaternion.clone() : null
      });
      if (this.replayFrames.length > 140) {
        this.replayFrames.shift();
      }
    }

    // 6. Step 9 AI Fielders + Wicketkeeper with Catch, Dive & Celebration Animations
    this.fielding.update(dt, this.physics, this.match.difficulty, {
      onCaught: (fielder, isCaughtBehind, catchPct) => {
        const pan = THREE.MathUtils.clamp(fielder.pos.x / 28.0, -0.92, 0.92);
        if (isCaughtBehind) {
          sound.playKeeperGloves(130, pan);
        } else {
          sound.playCatchThud(pan);
        }
        sound.playCrowdReaction('wicket', pan);
        this.net.vibratePhone('p1', [140, 60, 140]);
        if (isCaughtBehind && this.keeperPlayer) {
          this.keeperPlayer.playClip('catch', 0.08);
        } else {
          const fIdx = this.fielding.fielders.indexOf(fielder);
          if (fIdx >= 0 && this.fielderPlayers[fIdx]) {
            this.fielderPlayers[fIdx].playClip('catch', 0.08);
          }
        }
        this.triggerTeamCelebration();

        this.registerReplayHighlight({
          category: 'wicket',
          priority: 100,
          label: isCaughtBehind ? 'WICKET: CAUGHT BEHIND' : 'WICKET: CAUGHT',
          cameraStyle: 'fielder',
          focusPos: fielder.pos.clone()
        });

        const title = isCaughtBehind ? 'CAUGHT BEHIND!' : 'OUT · CAUGHT!';
        const sub = `Taken by ${fielder.role} (Catch Prob: ${catchPct}%)`;
        this.ui.showEventBanner(title, sub, 'text-red-500');
        commentary.trigger('wicket_caught', this.getCommentaryContext({ fielder: fielder.role }), true);
        this.completeDelivery({
          runsScored: 0,
          isWicket: true,
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
      onFielded: (fielder) => {
        const pan = THREE.MathUtils.clamp(fielder.pos.x / 28.0, -0.92, 0.92);
        sound.playCatchThud(pan);
        const fIdx = this.fielding.fielders.indexOf(fielder);
        if (fIdx >= 0 && this.fielderPlayers[fIdx]) {
          this.fielderPlayers[fIdx].playClip('throw', 0.08, 1.15);
          this.spawnDustPuff(fielder.pos, 0.45);
        }
      },
      onThrowReachedStumps: (targetEnd) => {
        const targetZ = targetEnd === 'striker' ? PITCH_HALF_LENGTH : -PITCH_HALF_LENGTH;
        sound.playKeeperGloves(120, 0);
        if (targetEnd === 'striker' && this.keeperPlayer) {
          this.keeperPlayer.playClip('catch', 0.08);
        } else if (targetEnd === 'nonStriker' && this.bowlerPlayer) {
          this.bowlerPlayer.playClip('catch', 0.08);
        }

        // Check if runner is out of the crease when keeper/bowler collects the throw
        const isOutOfCrease =
          (this.runnersInMotion || this.runnerStoppedMidPitch) &&
          this.runnerProgress > 0.06 &&
          this.runnerProgress < 0.94;

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
          const reason = this.runnerStoppedMidPitch
            ? 'Caught stranded mid-pitch as the throw hits the stumps!'
            : 'Direct hit catches the batter short of the crease!';
          this.ui.showEventBanner('OUT · RUN OUT!', reason, 'text-red-500');
          commentary.trigger('wicket_runout', this.getCommentaryContext(), true);
          this.completeDelivery({
            runsScored: this.runsCompletedThisBall,
            isWicket: true,
            wicketTypeEn: 'Run Out',
            wicketTypeHi: 'रन आउट'
          });
        } else {
          // Runner safely inside the crease (>= 0.92 or <= 0.08)
          if (this.runnersInMotion && this.runnerProgress >= 0.92 && !this.runnerReturning) {
            this.runsCompletedThisBall++;
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

    // 7. Update Real Step-Driven Running Between Wickets
    const isBallInPlayForRun = this.physics.state === 'hit' || this.physics.state === 'fielded';
    if (isBallInPlayForRun && (this.runnersInMotion || this.runnerStoppedMidPitch || this.runsCompletedThisBall > 0)) {
      const phoneConnected = this.net.controllers.p1.connected;
      let activeSpeed = 0;
      let displayCadence = this.batting.cadenceSps || 0;

      if (this.runButtonHeld) {
        // Holding R or Hold-to-Run button simulates a 2.8 Hz sprint cadence
        activeSpeed = 0.72;
        displayCadence = Math.max(displayCadence, 2.8);
        this.runnerStoppedMidPitch = false;
        this.runnersInMotion = true;
      } else if (phoneConnected && this.batting.isCalibrated) {
        // Phone connected: runner speed is driven by physical walking/jogging step cadence
        if (displayCadence > 0.4) {
          activeSpeed = THREE.MathUtils.clamp(displayCadence * 0.26, 0.25, 0.92);
          this.runnerStoppedMidPitch = false;
          this.runnersInMotion = true;
        } else if (this.runnerProgress > 0.06 && this.runnerProgress < 0.94) {
          // Player stopped stepping mid-pitch!
          activeSpeed = 0;
          this.runnerStoppedMidPitch = true;
          if (this.strikerPlayer && this.strikerPlayer.currentClipName !== 'stance') {
            this.strikerPlayer.playClip('stance', 0.15);
          }
          if (this.nonStrikerPlayer && this.nonStrikerPlayer.currentClipName !== 'stance') {
            this.nonStrikerPlayer.playClip('stance', 0.15);
          }
        }
      } else if (this.runnersInMotion) {
        // Keyboard/mouse fallback when no phone is connected
        activeSpeed = 0.65;
        displayCadence = 2.5;
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
        } else if (!this.runButtonHeld && displayCadence < 0.8) {
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

      this.ui.updateRunningBar({
        active: true,
        runsCompleted: this.runsCompletedThisBall,
        progress: clampedProg,
        cadenceHz: displayCadence,
        returning: this.runnerReturning,
        stoppedMidPitch: this.runnerStoppedMidPitch
      });
    } else {
      this.ui.updateRunningBar({ active: false });
    }

    // 8. Sync 3D Meshes & Skeletal AnimationMixers with Simulation State
    this.syncMeshesWithState(dt);

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

  syncMeshesWithState(dt) {
    // 1. Ball position & visible 3D seam quaternion spin
    this.ballGroup.position.copy(this.physics.pos);
    this.ballGroup.quaternion.copy(this.physics.ballQuat);
    this.ballShadow.position.set(this.physics.pos.x, 0.03, this.physics.pos.z);

    const posAttr = this.trailGeo.attributes.position;
    for (let i = 0; i < this.physics.maxTrail; i++) {
      const pt = i < this.physics.trailCount ? this.physics.trail[i] : this.physics.pos;
      posAttr.setXYZ(i, pt.x, pt.y, pt.z);
    }
    posAttr.needsUpdate = true;

    this.aimRing.position.x = THREE.MathUtils.damp(this.aimRing.position.x, this.bowling.aimTargetX, 12, dt);
    this.aimRing.position.z = THREE.MathUtils.damp(this.aimRing.position.z, this.bowling.aimBounceZ, 12, dt);
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

      // Show Interactive Reflex Meter if ball is catchable in the outfield (< 53m)
      if (!isSixProj && tFlight > 0.35 && !this.qteResolved) {
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

    // 1.8 Animate 3D Match Umpire Signals (FOUR, SIX, OUT, WIDE, NO-BALL)
    if (this.umpireMesh && this.umpireMesh.userData.leftArm && this.umpireMesh.userData.rightArm) {
      const lArm = this.umpireMesh.userData.leftArm;
      const rArm = this.umpireMesh.userData.rightArm;
      if (this.umpireSignalTimer > 0) {
        this.umpireSignalTimer = Math.max(0, this.umpireSignalTimer - dt);
        if (this.umpireSignalTimer === 0) this.umpireSignal = 'idle';
      }
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
      lArm.rotation.z = THREE.MathUtils.damp(lArm.rotation.z, targetLZ, 10, dt);
      rArm.rotation.z = THREE.MathUtils.damp(rArm.rotation.z, targetRZ, 10, dt);
      rArm.rotation.x = THREE.MathUtils.damp(rArm.rotation.x, targetRX, 10, dt);
    }

    // 2. Striker Position & Real-Time Low-Lag 3D Willow Bat Reproduction
    const targetStrikerZ = this.runnersInMotion ? this.strikerMeshZ : CREASE_Z - this.batting.creaseZOffset;
    this.strikerMesh.position.x = THREE.MathUtils.damp(this.strikerMesh.position.x, this.batting.creaseX, 24, dt);
    this.strikerMesh.position.z = THREE.MathUtils.damp(this.strikerMesh.position.z, targetStrikerZ, 24, dt);

    const batPivot = this.strikerMesh.userData.batPivot;
    if (batPivot) {
      if (this.batting.isCalibrated && this.net.controllers.p1.connected) {
        batPivot.quaternion.slerp(this.batting.currentQuat, 0.88);
      } else {
        batPivot.rotation.x = THREE.MathUtils.damp(batPivot.rotation.x, this.batting.backliftAngle, 24, dt);
        batPivot.rotation.y = THREE.MathUtils.damp(batPivot.rotation.y, -this.batting.swingPlaneYaw * 0.75, 24, dt);
        batPivot.rotation.z = THREE.MathUtils.damp(batPivot.rotation.z, this.batting.swingPlaneYaw * 0.45, 24, dt);
      }
    }

    this.nonStrikerMesh.position.z = THREE.MathUtils.damp(this.nonStrikerMesh.position.z, this.nonStrikerMeshZ, 12, dt);

    this.bowlerMesh.position.z = this.bowling.runupZ;
    this.bowlerMesh.position.y = this.bowling.jumpY || 0;
    const targetBowlerX = this.bowling.bowlerSide === 'over' ? 0.36 : -0.36;
    this.bowlerMesh.position.x = THREE.MathUtils.damp(this.bowlerMesh.position.x, targetBowlerX, 12, dt);

    this.keeperMesh.position.copy(this.fielding.keeper.pos);

    // Update 9 Fielders & blend between Idle / Run / Dive clips
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

    // Step primary character AnimationMixers
    if (this.strikerPlayer) this.strikerPlayer.update(dt);
    if (this.nonStrikerPlayer) this.nonStrikerPlayer.update(dt, this.camera.position);
    if (this.bowlerPlayer) this.bowlerPlayer.update(dt);
    if (this.keeperPlayer) this.keeperPlayer.update(dt);

    // Coupling phone wrist / swing rotation onto striker's right arm/hand after mixer update
    if (
      this.strikerPlayer &&
      this.strikerPlayer.bones.rightHandBone &&
      this.batting.isCalibrated &&
      this.net.controllers.p1.connected
    ) {
      this.strikerPlayer.bones.rightHandBone.quaternion.slerp(this.batting.currentQuat, 0.65);
    }

    // Dislodged LED Zing Bail Physics
    if (this.bailsDislodged) {
      this.bailTimer += dt;
      const set = this.dislodgedEnd === 'striker' ? this.strikerStumps : this.nonStrikerStumps;
      set.stumps[1].rotation.x = Math.min(0.65, this.bailTimer * 3.5);
      set.bails.forEach((b, idx) => {
        const dir = idx === 0 ? -1 : 1;
        b.position.x += dir * dt * 1.4;
        b.position.y = STUMP_HEIGHT + this.bailTimer * 2.4 - 4.9 * this.bailTimer * this.bailTimer;
        b.position.y = Math.max(0.03, b.position.y);
        b.position.z += dt * 2.2;
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
    if (this.cameraMode === 'broadcast') {
      _camTargetPos.set(0, 4.3, -18.5);
      _camLookAt.set(0, 1.0, 6.0);
    } else if (this.cameraMode === 'pro') {
      _camTargetPos.set(this.strikerMesh.position.x * 0.4, 2.35, CREASE_Z + 4.4);
      _camLookAt.set(0, 1.1, -CREASE_Z);
    } else if (this.cameraMode === 'overhead') {
      _camTargetPos.set(0, 46.0, 0.1);
      _camLookAt.set(0, 0, 0);
    } else if (this.cameraMode === 'follow') {
      _camTargetPos.set(
        this.ballGroup.position.x * 0.55,
        Math.max(4.5, this.ballGroup.position.y + 4.2),
        this.ballGroup.position.z + 14.0
      );
      _camLookAt.copy(this.ballGroup.position);
    } else if (this.cameraMode === 'replay') {
      const t = performance.now() * 0.0012;
      const style = this.activeReplayHighlight?.cameraStyle || 'follow_ball';
      const focus = this.activeReplayHighlight?.focusPos || this.ballGroup.position;

      if (style === 'stumps') {
        // Stumps close-up for Bowled, LBW, Stumping, Hit Wicket, Edge & Near Miss
        _camTargetPos.set(
          Math.sin(t) * 2.3,
          1.15,
          PITCH_HALF_LENGTH - 3.1 + Math.cos(t) * 0.85
        );
        _camLookAt.set(0, 0.58, PITCH_HALF_LENGTH - 0.15);
      } else if (style === 'fielder') {
        // Fielder close-up for Catches and Dropped Catches
        _camTargetPos.set(
          focus.x + Math.cos(t) * 4.2,
          1.75,
          focus.z + Math.sin(t) * 4.2
        );
        _camLookAt.set(
          THREE.MathUtils.lerp(focus.x, this.ballGroup.position.x, 0.45),
          Math.max(0.8, this.ballGroup.position.y),
          THREE.MathUtils.lerp(focus.z, this.ballGroup.position.z, 0.45)
        );
      } else if (style === 'side_on') {
        // Broadcast side-on crease view for Run-Outs and Close Run-Out decisions
        const endZ = this.activeReplayHighlight?.targetEnd === 'nonStriker' ? -PITCH_HALF_LENGTH : PITCH_HALF_LENGTH;
        _camTargetPos.set(
          6.4 + Math.sin(t * 0.5) * 0.6,
          1.45,
          endZ + Math.cos(t * 0.5) * 0.8
        );
        _camLookAt.set(0, 0.62, endZ);
      } else {
        // Follow-the-ball orbiting replay camera for Fours, Sixes, and Milestones
        _camTargetPos.set(
          this.ballGroup.position.x + Math.cos(t) * 6.8,
          Math.max(2.4, this.ballGroup.position.y + 1.8),
          this.ballGroup.position.z + Math.sin(t) * 6.8
        );
        _camLookAt.copy(this.ballGroup.position);
      }
    }

    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camTargetPos.x, 5.5, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camTargetPos.y, 5.5, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camTargetPos.z, 5.5, dt);

    _currentLookAt.x = THREE.MathUtils.damp(_currentLookAt.x, _camLookAt.x, 7.5, dt);
    _currentLookAt.y = THREE.MathUtils.damp(_currentLookAt.y, _camLookAt.y, 7.5, dt);
    _currentLookAt.z = THREE.MathUtils.damp(_currentLookAt.z, _camLookAt.z, 7.5, dt);
    this.camera.lookAt(_currentLookAt);

    // Update Broadcast Bokeh Depth-of-Field focus distance dynamically
    if (this.bokehPass && this.bokehPass.enabled && this.bokehPass.uniforms) {
      const focusDist = this.camera.position.distanceTo(_currentLookAt);
      this.bokehPass.uniforms['focus'].value = focusDist;
      this.bokehPass.uniforms['aperture'].value =
        this.cameraMode === 'replay' ? 0.0022 : 0.0008;
    }
  }
}

function bootBoxCricketApp() {
  if (!window.boxCricketApp) {
    window.boxCricketApp = new BoxCricketApp();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootBoxCricketApp);
} else {
  bootBoxCricketApp();
}

