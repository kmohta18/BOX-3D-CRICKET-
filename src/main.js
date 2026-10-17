import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
import { MatchEngine } from '../modes.js';
import { NetworkManager } from '../net.js';
import { UIManager } from '../ui.js';
import { sound } from '../assets/audio.js';

/**
 * Box Cricket 3D - Main Three.js Engine, Procedural Stadiums, Characters & Game Loop (src/main.js)
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

    this.cameraMode = 'broadcast'; // 'broadcast' | 'pro' | 'follow' | 'overhead' | 'replay'
    this.savedCameraMode = 'broadcast';
    this.targetFps = 60;
    this.lastFrameTime = 0;

    // Running between wickets animation state
    this.runnersInMotion = false;
    this.runsCompletedThisBall = 0;
    this.pendingExtraRun = false;
    this.runnerProgress = 0;
    this.strikerMeshZ = CREASE_Z;
    this.nonStrikerMeshZ = -CREASE_Z;

    // Action Replay buffer for boundaries (4s and 6s)
    this.isReplaying = false;
    this.replayFrames = [];
    this.replayIndex = 0;

    // Stump bail explosion animation
    this.bailsDislodged = false;
    this.dislodgedEnd = 'striker';
    this.bailTimer = 0;

    // Touch swipe tracking on main canvas
    this.pointerDownPos = null;
    this.pointerDownTime = 0;

    this.initThree();
    this.buildSceneContents();
    this.setupNetworkCallbacks();
    this.setupInputListeners();
    this.ui.init();

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
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090f1d);
    this.scene.fog = new THREE.FogExp2(0x090f1d, 0.0055);

    this.camera = new THREE.PerspectiveCamera(
      48,
      window.innerWidth / window.innerHeight,
      0.1,
      400
    );
    this.camera.position.set(0, 4.3, -18.5);
    this.camera.lookAt(0, 1.0, 5.0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isHeadless,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(isHeadless ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !isHeadless;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.canvasContainer.appendChild(this.renderer.domElement);

    // WebGL context loss safety
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());

    // Studio Environment Map (RoomEnvironment + PMREMGenerator)
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Balanced 3-Point Studio & Stadium Lighting Rig
    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x14532d, 0.65);
    this.hemiLight.position.set(0, 60, 0);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfffbeb, 1.85);
    this.keyLight.position.set(26, 48, -22);
    this.keyLight.castShadow = !isHeadless;
    const d = 28;
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

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
    this.rimLight.position.set(-30, 32, 35);
    this.scene.add(this.rimLight);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /**
   * Generates crisp procedural mowed grass turf and pitch textures
   */
  createTurfTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#15803d' : '#166534';
      ctx.fillRect(0, i * 32, 512, 32);
    }
    // Subtle organic grass speckle
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 2000; i++) {
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  createPitchTexture(surface = 'night') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    const baseColor = surface === 'street' ? '#64748b' : surface === 'club' ? '#c2a375' : '#d6b88a';
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 256, 1024);

    // Good-length wear patches
    ctx.fillStyle = 'rgba(60, 45, 30, 0.14)';
    for (let i = 0; i < 600; i++) {
      ctx.fillRect(Math.random() * 256, Math.random() * 1024, 3, 8);
    }

    // White crease markings at both ends
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    // Bowler end & Striker end popping/bowling creases
    [95, 148, 876, 929].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(236, y);
      ctx.stroke();
    });
    // Return creases & wide lines
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
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  createJerseyNumberTexture(primaryHex, secondaryHex, numberVal) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = primaryHex;
    ctx.fillRect(0, 0, 256, 256);

    // Athletic chest/back stripe
    ctx.fillStyle = secondaryHex;
    ctx.fillRect(0, 32, 256, 28);
    ctx.fillRect(0, 210, 256, 18);

    // Bold jersey number on back & chest
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 92px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(numberVal), 128, 134);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  buildSceneContents() {
    // 1. Outfield & Extended Horizon Terrain (never boxed in a floating void)
    const horizonGeo = new THREE.CircleGeometry(240, 64);
    horizonGeo.rotateX(-Math.PI / 2);
    this.horizonMat = new THREE.MeshStandardMaterial({
      color: 0x0f291e,
      roughness: 0.95,
      metalness: 0.0
    });
    const horizonMesh = new THREE.Mesh(horizonGeo, this.horizonMat);
    horizonMesh.position.y = -0.04;
    horizonMesh.receiveShadow = true;
    this.scene.add(horizonMesh);

    const outfieldGeo = new THREE.CircleGeometry(BOUNDARY_RADIUS + 8, 64);
    outfieldGeo.rotateX(-Math.PI / 2);
    this.outfieldMat = new THREE.MeshStandardMaterial({
      map: this.createTurfTexture(),
      roughness: 0.85,
      metalness: 0.02
    });
    this.outfieldMesh = new THREE.Mesh(outfieldGeo, this.outfieldMat);
    this.outfieldMesh.receiveShadow = true;
    this.scene.add(this.outfieldMesh);

    // Boundary rope (padded torus ring at BOUNDARY_RADIUS = 52m)
    const ropeGeo = new THREE.TorusGeometry(BOUNDARY_RADIUS, 0.18, 12, 96);
    ropeGeo.rotateX(Math.PI / 2);
    const ropeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.18
    });
    const ropeMesh = new THREE.Mesh(ropeGeo, ropeMat);
    ropeMesh.position.y = 0.18;
    this.scene.add(ropeMesh);

    // 30-yard (25m) Fielding Restriction Dashed Ring
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

    // 2. Central 22-Yard Pitch Strip (offset by +0.02m on Y to prevent coplanar Z-fighting)
    const pitchGeo = new THREE.PlaneGeometry(3.2, 23.2);
    pitchGeo.rotateX(-Math.PI / 2);
    this.pitchMat = new THREE.MeshStandardMaterial({
      map: this.createPitchTexture('night'),
      roughness: 0.78,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    this.pitchMesh = new THREE.Mesh(pitchGeo, this.pitchMat);
    this.pitchMesh.position.y = 0.02;
    this.pitchMesh.receiveShadow = true;
    this.scene.add(this.pitchMesh);

    // 3. Stumps & Bails at both ends (Striker +10.06m, Non-Striker -10.06m)
    this.strikerStumps = this.buildWicketSet(PITCH_HALF_LENGTH);
    this.nonStrikerStumps = this.buildWicketSet(-PITCH_HALF_LENGTH);
    this.scene.add(this.strikerStumps.group);
    this.scene.add(this.nonStrikerStumps.group);

    // 4. Pitch Target Aim Ring & Bounce Spot Marker
    this.aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.28, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide })
    );
    this.aimRing.position.set(0.05, 0.035, 4.6);
    this.scene.add(this.aimRing);

    this.bounceMarker = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    this.bounceMarker.position.set(0, 0.04, 4.6);
    this.bounceMarker.visible = false;
    this.scene.add(this.bounceMarker);

    // 5. Leather Cricket Ball + Seam + Dynamic Trail Ribbon
    this.ballGroup = new THREE.Group();
    const ballGeo = new THREE.SphereGeometry(0.075, 24, 24); // Visually crisp broadcast scale
    const ballMat = new THREE.MeshPhysicalMaterial({
      color: 0xdc2626,
      roughness: 0.22,
      metalness: 0.08,
      clearcoat: 0.9,
      clearcoatRoughness: 0.15
    });
    const ballSphere = new THREE.Mesh(ballGeo, ballMat);
    ballSphere.castShadow = true;
    this.ballGroup.add(ballSphere);

    const seamGeo = new THREE.TorusGeometry(0.076, 0.008, 8, 32);
    const seamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const seamMesh = new THREE.Mesh(seamGeo, seamMat);
    this.ballGroup.add(seamMesh);
    this.scene.add(this.ballGroup);

    // Ball shadow disc on ground so user can always judge ball height!
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })
    );
    this.ballShadow.position.y = 0.03;
    this.scene.add(this.ballShadow);

    // Ball trajectory trail line
    const trailPositions = new Float32Array(this.physics.maxTrail * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.8 });
    this.trailLine = new THREE.Line(this.trailGeo, trailMat);
    this.trailLine.frustumCulled = false;
    this.scene.add(this.trailLine);

    // 6. Build 3 Stadium Environments (Street, Club, Night)
    this.stadiumGroups = {
      street: this.buildStreetStadium(),
      club: this.buildClubStadium(),
      night: this.buildNightStadium()
    };
    Object.values(this.stadiumGroups).forEach((g) => this.scene.add(g));
    this.setStadium('night');

    // 7. Build Composite 10-Part 3D Players (Striker, Non-Striker, Bowler, Keeper, 9 Fielders)
    this.rebuildTeamCharacters();

    // Pre-compile shaders
    this.renderer.compile(this.scene, this.camera);
  }

  /**
   * Builds 3 wooden stumps + 2 bails with individual pivots for bowled/run-out bail flight
   */
  buildWicketSet(zPos) {
    const group = new THREE.Group();
    group.position.set(0, 0, zPos);

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0xfde68a,
      roughness: 0.42,
      metalness: 0.1,
      emissive: 0x000000
    });

    const stumps = [];
    const stumpGeo = new THREE.CylinderGeometry(0.019, 0.019, STUMP_HEIGHT, 12);
    stumpGeo.translate(0, STUMP_HEIGHT / 2, 0);

    [-STUMP_WIDTH / 2, 0, STUMP_WIDTH / 2].forEach((xOffset) => {
      const s = new THREE.Mesh(stumpGeo, woodMat.clone());
      s.position.set(xOffset, 0, 0);
      s.castShadow = true;
      group.add(s);
      stumps.push(s);
    });

    const bails = [];
    const bailGeo = new THREE.CylinderGeometry(0.009, 0.009, STUMP_WIDTH * 0.48, 8);
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
    // Flash LED Zing red on stumps & bails
    set.stumps.forEach((s) => s.material.emissive.setHex(0xef4444));
    set.bails.forEach((b) => b.material.emissive.setHex(0xef4444));
    sound.playStumpsHit();
  }

  /**
   * Builds a composite 10-part expressive low-poly 3D cricketer (THREE.Group)
   * Pivot at bottom-center (y = 0) with grounding contact shadow
   */
  createCricketerModel({
    primaryColor = '#0284c7',
    secondaryColor = '#f59e0b',
    jerseyNumber = 18,
    hasBat = false,
    hasPads = false
  }) {
    const root = new THREE.Group();

    // 1. Contact shadow disc at y = 0.015
    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.38, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false })
    );
    shadowDisc.position.y = 0.015;
    root.add(shadowDisc);

    const jerseyTex = this.createJerseyNumberTexture(primaryColor, secondaryColor, jerseyNumber);
    const jerseyMat = new THREE.MeshStandardMaterial({ map: jerseyTex, roughness: 0.65, metalness: 0.05 });
    const trouserMat = new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.75, metalness: 0.05 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd99b72, roughness: 0.55 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.15 });
    const padMat = new THREE.MeshStandardMaterial({ color: secondaryColor, roughness: 0.4, metalness: 0.1 });

    // 2. Left & Right Legs + Shoes (flush at y = 0)
    const shoeGeo = new THREE.BoxGeometry(0.13, 0.09, 0.26);
    const legGeo = new THREE.CapsuleGeometry(0.068, 0.58, 4, 8);
    const padGeo = new THREE.BoxGeometry(0.15, 0.48, 0.12);

    [-0.12, 0.12].forEach((lx) => {
      const shoe = new THREE.Mesh(shoeGeo, shoeMat);
      shoe.position.set(lx, 0.045, 0.03);
      shoe.castShadow = true;
      root.add(shoe);

      const leg = new THREE.Mesh(legGeo, trouserMat);
      leg.position.set(lx, 0.44, 0);
      leg.castShadow = true;
      root.add(leg);

      if (hasPads) {
        const pad = new THREE.Mesh(padGeo, padMat);
        pad.position.set(lx, 0.36, 0.05);
        pad.castShadow = true;
        root.add(pad);
      }
    });

    // 3. Torso with numbered jersey texture
    const torsoGeo = new THREE.BoxGeometry(0.42, 0.56, 0.24);
    const torso = new THREE.Mesh(torsoGeo, jerseyMat);
    torso.position.set(0, 1.06, 0);
    torso.castShadow = true;
    root.add(torso);

    // 4. Head + Sculpted Helmet / Cap + Metallic Grille Visor
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.48, 0);

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 16), skinMat);
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    const helmetMat = new THREE.MeshPhysicalMaterial({
      color: secondaryColor,
      roughness: 0.22,
      metalness: 0.35,
      clearcoat: 0.8
    });
    const helmetShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.152, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      helmetMat
    );
    helmetShell.position.y = 0.02;
    headGroup.add(helmetShell);

    // Helmet Peak / Brim
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.165, 0.025, 16, 1, false, -0.8, 1.6), helmetMat);
    brim.position.set(0, 0.03, 0.05);
    headGroup.add(brim);

    if (hasPads) {
      // Metallic steel faceguard grille for batters & keeper
      const grilleMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.18 });
      const grille = new THREE.Mesh(
        new THREE.CylinderGeometry(0.148, 0.135, 0.09, 12, 1, true, -0.9, 1.8),
        grilleMat
      );
      grille.position.set(0, -0.04, 0.02);
      headGroup.add(grille);
    }
    root.add(headGroup);

    // 5. Articulated Arms & Batting/Bowling Pivot
    const armGeo = new THREE.CapsuleGeometry(0.052, 0.46, 4, 8);
    armGeo.translate(0, -0.23, 0);

    const leftArm = new THREE.Mesh(armGeo, jerseyMat);
    leftArm.position.set(-0.27, 1.28, 0);
    leftArm.castShadow = true;
    root.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, jerseyMat);
    rightArm.position.set(0.27, 1.28, 0);
    rightArm.castShadow = true;
    root.add(rightArm);

    // 6. Cricket Bat Group (if batter)
    let batPivot = null;
    if (hasBat) {
      batPivot = new THREE.Group();
      batPivot.position.set(0.0, 1.12, 0.22);

      // Rubber grip cane handle
      const handleGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.32, 10);
      const handleMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
      const handle = new THREE.Mesh(handleGeo, handleMat);
      handle.position.set(0, -0.14, 0);
      batPivot.add(handle);

      // Sculpted English Willow Blade with bevelled ridge
      const bladeGeo = new THREE.BoxGeometry(0.115, 0.56, 0.042);
      const willowMat = new THREE.MeshStandardMaterial({ color: 0xe6c280, roughness: 0.38, metalness: 0.05 });
      const blade = new THREE.Mesh(bladeGeo, willowMat);
      blade.position.set(0, -0.56, 0);
      blade.castShadow = true;
      batPivot.add(blade);

      // Brand sticker accent on blade
      const sticker = new THREE.Mesh(
        new THREE.BoxGeometry(0.118, 0.14, 0.045),
        new THREE.MeshStandardMaterial({ color: secondaryColor, roughness: 0.3 })
      );
      sticker.position.set(0, -0.38, 0);
      batPivot.add(sticker);

      root.add(batPivot);
    }

    root.userData = { leftArm, rightArm, batPivot, headGroup };
    return root;
  }

  rebuildTeamCharacters() {
    if (this.actorsGroup) {
      this.scene.remove(this.actorsGroup);
    }
    this.actorsGroup = new THREE.Group();
    this.scene.add(this.actorsGroup);

    const batTeam = this.match.battingTeam;
    const bowlTeam = this.match.bowlingTeam;

    // Striker
    this.strikerMesh = this.createCricketerModel({
      primaryColor: batTeam.primaryColor,
      secondaryColor: batTeam.secondaryColor,
      jerseyNumber: batTeam.defaultNumber || 18,
      hasBat: true,
      hasPads: true
    });
    this.strikerMesh.position.set(0, 0, CREASE_Z);
    this.strikerMesh.rotation.y = Math.PI; // Faces bowler (-Z)
    this.actorsGroup.add(this.strikerMesh);

    // Non-Striker
    this.nonStrikerMesh = this.createCricketerModel({
      primaryColor: batTeam.primaryColor,
      secondaryColor: batTeam.secondaryColor,
      jerseyNumber: (batTeam.defaultNumber + 9) % 99 || 7,
      hasBat: true,
      hasPads: true
    });
    this.nonStrikerMesh.position.set(-0.95, 0, -CREASE_Z + 0.3);
    this.nonStrikerMesh.rotation.y = 0;
    this.actorsGroup.add(this.nonStrikerMesh);

    // Bowler
    this.bowlerMesh = this.createCricketerModel({
      primaryColor: bowlTeam.primaryColor,
      secondaryColor: bowlTeam.secondaryColor,
      jerseyNumber: 99,
      hasBat: false,
      hasPads: false
    });
    this.bowlerMesh.position.set(0.35, 0, -CREASE_Z - 6.5);
    this.bowlerMesh.rotation.y = 0;
    this.actorsGroup.add(this.bowlerMesh);

    // Wicketkeeper
    this.keeperMesh = this.createCricketerModel({
      primaryColor: bowlTeam.primaryColor,
      secondaryColor: bowlTeam.secondaryColor,
      jerseyNumber: 1,
      hasBat: false,
      hasPads: true
    });
    this.keeperMesh.position.copy(this.fielding.keeper.pos);
    this.keeperMesh.rotation.y = Math.PI;
    this.actorsGroup.add(this.keeperMesh);

    // 9 Fielders
    this.fielderMeshes = this.fielding.fielders.map((f, idx) => {
      const m = this.createCricketerModel({
        primaryColor: bowlTeam.primaryColor,
        secondaryColor: bowlTeam.secondaryColor,
        jerseyNumber: idx + 2,
        hasBat: false,
        hasPads: false
      });
      m.position.copy(f.pos);
      m.rotation.y = f.rotY;
      this.actorsGroup.add(m);
      return m;
    });
  }

  /**
   * Stadium 1: Street Cricket (Urban compound, brick buildings, streetlamps, trees)
   */
  buildStreetStadium() {
    const group = new THREE.Group();
    const buildingMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.75 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.55
    });

    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      if (Math.abs(Math.sin(angle)) < 0.25 && Math.cos(angle) < 0) continue; // Gap behind bowler
      const dist = BOUNDARY_RADIUS + 14 + (i % 3) * 4;
      const h = 14 + (i % 4) * 5;
      const w = 16;
      const d = 10;

      const bldg = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), i % 2 === 0 ? buildingMat : accentMat);
      body.position.y = h / 2;
      bldg.add(body);

      // Rooftop water tank
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.4, 12), buildingMat);
      tank.position.set(2, h + 1.2, 0);
      bldg.add(tank);

      // Illuminated apartment windows
      const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, h * 0.55), windowMat);
      win.position.set(0, h * 0.52, d / 2 + 0.08);
      bldg.add(win);

      bldg.position.set(Math.sin(angle) * dist, 0, Math.cos(angle) * dist);
      bldg.lookAt(0, 0, 0);
      group.add(bldg);
    }
    return group;
  }

  /**
   * Stadium 2: Club Ground (Classic clubhouse pavilion, white sightscreens, dense tree grove)
   */
  buildClubStadium() {
    const group = new THREE.Group();

    // Sightscreens behind bowler and striker
    const ssMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
    [-BOUNDARY_RADIUS - 4, BOUNDARY_RADIUS + 4].forEach((z) => {
      const ss = new THREE.Mesh(new THREE.BoxGeometry(12, 6.5, 0.8), ssMat);
      ss.position.set(0, 3.25, z);
      group.add(ss);
    });

    // Heritage Clubhouse Pavilion on flank
    const pavGroup = new THREE.Group();
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(24, 7, 12),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.7 })
    );
    walls.position.y = 3.5;
    pavGroup.add(walls);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(16, 4.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.6 })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 9.2;
    pavGroup.add(roof);
    pavGroup.position.set(-BOUNDARY_RADIUS - 14, 0, 0);
    group.add(pavGroup);

    // Instanced Lush Trees around perimeter
    const treeCount = 48;
    const trunkMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.45, 0.65, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 }),
      treeCount
    );
    const canopyMesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(3.8, 1),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 }),
      treeCount
    );

    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2;
      if (Math.abs(Math.sin(angle)) < 0.16) continue; // Keep sightscreen lane clear
      const r = BOUNDARY_RADIUS + 10 + (i % 3) * 4;
      const scale = 0.85 + (i % 4) * 0.12;

      _dummyObj.position.set(Math.sin(angle) * r, 2 * scale, Math.cos(angle) * r);
      _dummyObj.scale.setScalar(scale);
      _dummyObj.updateMatrix();
      trunkMesh.setMatrixAt(i, _dummyObj.matrix);

      _dummyObj.position.set(Math.sin(angle) * r, 5.8 * scale, Math.cos(angle) * r);
      _dummyObj.updateMatrix();
      canopyMesh.setMatrixAt(i, _dummyObj.matrix);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    trunkMesh.computeBoundingSphere();
    canopyMesh.computeBoundingSphere();
    group.add(trunkMesh, canopyMesh);

    return group;
  }

  /**
   * Stadium 3: Night Stadium with 4 Floodlight Towers, Tiered Bowl & Instanced Crowd
   */
  buildNightStadium() {
    const group = new THREE.Group();

    // Tiered Stadium Bowl
    const standGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 24, BOUNDARY_RADIUS + 6, 14, 48, 1, true);
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.7,
      side: THREE.DoubleSide
    });
    const standMesh = new THREE.Mesh(standGeo, standMat);
    standMesh.position.y = 7;
    group.add(standMesh);

    // Glowing LED Boundary Advertising Ribbon
    const ledGeo = new THREE.CylinderGeometry(BOUNDARY_RADIUS + 3.2, BOUNDARY_RADIUS + 3.2, 1.1, 64, 1, true);
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0284c7,
      emissiveIntensity: 0.65,
      side: THREE.DoubleSide
    });
    const ledRibbon = new THREE.Mesh(ledGeo, ledMat);
    ledRibbon.position.y = 0.55;
    group.add(ledRibbon);

    // Instanced Crowd Spectators (360° colorful jerseys)
    const crowdCount = 420;
    const crowdGeo = new THREE.BoxGeometry(0.65, 0.95, 0.65);
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    const crowdInst = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
    const palette = [0x38bdf8, 0xf59e0b, 0xef4444, 0x10b981, 0xa855f7, 0xf8fafc];

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

    // 4 Towering Floodlight Pylons
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.25 });
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfffbeb,
      emissiveIntensity: 2.2
    });

    [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75].forEach((ang) => {
      const pylon = new THREE.Group();
      const dist = BOUNDARY_RADIUS + 26;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.3, 42, 10), towerMat);
      mast.position.y = 21;
      pylon.add(mast);

      const head = new THREE.Mesh(new THREE.BoxGeometry(9.5, 5.2, 1.2), panelMat);
      head.position.set(0, 42, 0.8);
      head.rotation.x = 0.35;
      pylon.add(head);

      pylon.position.set(Math.sin(ang) * dist, 0, Math.cos(ang) * dist);
      pylon.lookAt(0, 0, 0);
      group.add(pylon);
    });

    return group;
  }

  setStadium(stadiumId = 'night') {
    this.match.stadium = stadiumId;
    this.physics.surface = stadiumId;
    this.pitchMat.map = this.createPitchTexture(stadiumId);
    this.pitchMat.needsUpdate = true;

    Object.entries(this.stadiumGroups).forEach(([id, grp]) => {
      grp.visible = id === stadiumId;
    });

    if (stadiumId === 'street') {
      this.scene.background.setHex(0x1e293b);
      this.scene.fog.color.setHex(0x1e293b);
      this.keyLight.color.setHex(0xfde68a);
      this.keyLight.intensity = 1.65;
      this.outfieldMat.color.setHex(0x475569); // Concrete compound floor
    } else if (stadiumId === 'club') {
      this.scene.background.setHex(0x38bdf8);
      this.scene.fog.color.setHex(0x38bdf8);
      this.keyLight.color.setHex(0xffffff);
      this.keyLight.intensity = 2.0;
      this.outfieldMat.color.setHex(0xffffff);
    } else {
      // Night Floodlit Stadium
      this.scene.background.setHex(0x090f1d);
      this.scene.fog.color.setHex(0x090f1d);
      this.keyLight.color.setHex(0xfffbeb);
      this.keyLight.intensity = 1.9;
      this.outfieldMat.color.setHex(0xffffff);
    }
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this.savedCameraMode = mode;
  }

  setFieldPreset(presetId) {
    this.fielding.applyFieldSetting(presetId, this.match.isPowerplayActive());
    this.fielding.resetToHomePositions(this.bowling.bowlerType);
  }

  setBowlerType(typeId) {
    this.bowling.bowlerType = typeId;
    this.fielding.resetToHomePositions(typeId);
  }

  setSoundEnabled(enabled) {
    sound.enabled = enabled;
  }

  applyGraphicsSettings(res = '1080p', fps = '60') {
    this.targetFps = Number(fps) || 60;
    const isHeadless = navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent);
    if (isHeadless) return;
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
   * Wire up WebSocket phone sensor callbacks
   */
  setupNetworkCallbacks() {
    this.net.callbacks.onSensorData = (packet, slot) => {
      if (this.match.userRole === 'bat' || slot === 'p1') {
        this.batting.ingestSensorPacket(packet, 0.014, {
          onCalibrationComplete: () => {
            this.net.vibratePhone(slot, [80, 50, 120]);
            this.ui.closeModal('modal-calibrate');
            this.ui.showEventBanner('PHONE CALIBRATED!', 'q_stance locked (q_current * inverse(q_stance)). Swing to bat!', 'text-emerald-400');
          },
          onSwingPeak: () => {
            if (this.physics.state === 'bowled') {
              this.checkAndExecuteBattingContact();
            } else if (this.physics.state === 'idle' && this.match.userRole === 'bat') {
              this.startNextDelivery();
            }
          },
          onQuickFlick: () => {
            if (this.physics.state === 'hit') {
              this.triggerExtraRun();
            }
          }
        });
      }

      if (this.match.userRole === 'bowl' || (this.match.matchType === 'local1v1' && slot === 'p2')) {
        this.bowling.ingestBowlingSensor(packet, 0.014, (delivery) => {
          this.releaseBowledBall(delivery);
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
      this.bowling.setRunupButtonState(isHeld);
      if (isHeld && this.physics.state === 'idle') {
        this.physics.state = 'runup';
        this.ui.setCommentary(
          'Bowler charging in from phone run-up... Swing overarm to release!',
          'गेंदबाज रन-अप पर... गेंद छोड़ने के लिए फ़ोन को ऊपर से घुमाएं!'
        );
      }
    };

    this.net.callbacks.onBowlerTypeChange = (bType) => {
      this.setBowlerType(bType);
      const sel = document.getElementById('select-bowler-type');
      if (sel) sel.value = bType;
    };

    this.net.callbacks.onQuickFlick = () => {
      this.triggerExtraRun();
    };

    this.net.callbacks.onTouchSwipe = (msg) => {
      if (this.physics.state === 'idle') {
        this.startNextDelivery();
      }
      this.batting.triggerManualSwing({
        speedDeg: msg.speedDeg || 450,
        dirX: msg.dirX || 0,
        planePitchDeg: typeof msg.planePitchDeg === 'number' ? msg.planePitchDeg : (this.batting.shotMode === 'fly' ? 28 : 4)
      });
      this.checkAndExecuteBattingContact();
    };

    this.net.callbacks.onPauseChange = (paused, remainingSec) => {
      const overlay = document.getElementById('pause-reconnect-banner');
      const secEl = document.getElementById('pause-reconnect-sec');
      if (overlay) overlay.classList.toggle('hidden', !paused);
      if (secEl) secEl.textContent = `${remainingSec}s`;
    };
  }

  /**
   * Keyboard + Touch Swipe Input Listeners (Phase 1 & Fallback)
   */
  setupInputListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const code = e.code;
      if (code === 'ArrowLeft' || code === 'KeyA') {
        this.batting.keys.left = true;
        this.bowling.aimTargetX = Math.max(-0.85, this.bowling.aimTargetX - 0.08);
      } else if (code === 'ArrowRight' || code === 'KeyD') {
        this.batting.keys.right = true;
        this.bowling.aimTargetX = Math.min(0.85, this.bowling.aimTargetX + 0.08);
      } else if (code === 'ArrowUp' || code === 'KeyW') {
        this.batting.keys.up = true;
        this.bowling.aimBounceZ = Math.min(8.6, this.bowling.aimBounceZ + 0.45);
      } else if (code === 'ArrowDown' || code === 'KeyS') {
        this.batting.keys.down = true;
        this.bowling.aimBounceZ = Math.max(0.5, this.bowling.aimBounceZ - 0.45);
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
        this.triggerExtraRun();
      } else if (code === 'Space') {
        e.preventDefault();
        sound.init();
        if (this.physics.state === 'idle') {
          if (e.shiftKey) this.selectShotMode('fly');
          this.startNextDelivery();
        } else if (this.physics.state === 'bowled') {
          const planePitchDeg = this.batting.shotMode === 'fly' ? 30 : 4;
          this.batting.triggerManualSwing({
            speedDeg: 465,
            dirX: this.batting.aimDirectionX,
            planePitchDeg
          });
          this.checkAndExecuteBattingContact();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      if (code === 'ArrowLeft' || code === 'KeyA') this.batting.keys.left = false;
      if (code === 'ArrowRight' || code === 'KeyD') this.batting.keys.right = false;
      if (code === 'ArrowUp' || code === 'KeyW') this.batting.keys.up = false;
      if (code === 'ArrowDown' || code === 'KeyS') this.batting.keys.down = false;
    });

    // Touch / Mouse Swipe on 3D Canvas
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

      if (distPx < 18) {
        if (this.physics.state === 'idle') this.startNextDelivery();
        return;
      }

      const swipeSpeedDeg = THREE.MathUtils.clamp((distPx / dtMs) * 265, 190, 560);
      const dirX = THREE.MathUtils.clamp(dx / 140, -1, 1);
      // Upward swipe sets a rising swing path; flat/horizontal swipe sets a flat swing path
      const planePitchDeg = dy < -45 ? THREE.MathUtils.clamp((-dy / 140) * 38, 16, 44) : 4;

      if (this.physics.state === 'idle') {
        this.startNextDelivery();
      } else if (this.physics.state === 'bowled') {
        this.batting.triggerManualSwing({
          speedDeg: swipeSpeedDeg,
          dirX,
          planePitchDeg
        });
        this.checkAndExecuteBattingContact();
      }
    });
  }

  triggerActionFromUI(action) {
    sound.init();
    if (action === 'bowl_or_swing') {
      if (this.physics.state === 'idle') {
        this.startNextDelivery();
      } else if (this.physics.state === 'bowled') {
        const planePitchDeg = this.batting.shotMode === 'fly' ? 30 : 4;
        this.batting.triggerManualSwing({
          speedDeg: 465,
          dirX: this.batting.aimDirectionX,
          planePitchDeg
        });
        this.checkAndExecuteBattingContact();
      }
    } else if (action === 'defend_shot') {
      if (this.physics.state === 'bowled') {
        this.batting.triggerManualSwing({
          speedDeg: 150,
          dirX: 0,
          planePitchDeg: 2,
          isDefensive: true
        });
        this.checkAndExecuteBattingContact();
      }
    } else if (action === 'take_extra_run') {
      this.triggerExtraRun();
    }
  }

  startCalibrationFlow() {
    this.batting.startCalibration();
    const bar = document.getElementById('calib-progress-bar');
    if (bar) bar.style.width = '0%';
    this.ui.openModal('modal-calibrate');
  }

  performCoinToss() {
    sound.playCoinFlip();
    const isHeads = Math.random() < 0.5;
    const userWon = Math.random() < 0.5;
    const resEl = document.getElementById('toss-result-text');
    if (resEl) {
      resEl.textContent = `${isHeads ? 'HEADS' : 'TAILS'}! ${userWon ? 'You won the toss — select Bat or Bowl below.' : 'AI won the toss and elected to Bowl first.'}`;
      resEl.className = 'text-xs font-semibold text-amber-400 mt-2';
    }
  }

  startConfiguredMatchFromUI() {
    const modeId = document.getElementById('setup-mode')?.value || 't5';
    const overs = Number(document.getElementById('setup-overs')?.value) || 5;
    const matchType = document.getElementById('setup-match-type')?.value || 'ai';
    const difficulty = document.getElementById('setup-difficulty')?.value || 'pro';
    const teamAIndex = Number(document.getElementById('setup-team-a')?.value) || 0;
    const teamBIndex = Number(document.getElementById('setup-team-b')?.value) || 1;
    const jerseyColorA = document.getElementById('setup-jersey-color')?.value || '#0284c7';
    const jerseyNumberA = Number(document.getElementById('setup-jersey-num')?.value) || 18;
    const roleChoice = document.getElementById('setup-role')?.value || 'bat';

    this.match.configureMatch({
      modeId,
      overs,
      matchType,
      difficulty,
      stadium: this.match.stadium,
      teamAIndex,
      teamBIndex,
      jerseyColorA,
      jerseyNumberA,
      userBattedFirst: roleChoice === 'bat'
    });

    this.rebuildTeamCharacters();
    this.resetBallAndFielders();
    this.ui.updateHUD();
    this.ui.showEventBanner(
      `${this.match.battingTeam.short} vs ${this.match.bowlingTeam.short}`,
      `${overs} Overs · ${roleChoice === 'bat' ? 'You are Batting' : 'You are Bowling'}`,
      'text-emerald-400'
    );
  }

  joinCustomRoom(code) {
    this.net.connect(code, 'p1');
    this.ui.showEventBanner(`ROOM ${code}`, 'Connected to room relay', 'text-sky-400');
  }

  /**
   * Starts bowler run-up (Shot Mode is still unlocked during run-up until release!)
   */
  startNextDelivery() {
    if (this.match.isMatchOver) {
      this.match.resetInningsState();
      this.match.isMatchOver = false;
    }

    this.resetWickets();
    this.batting.resetForNextBall();
    this.bowling.resetForNextBall();
    this.net.syncShotModeLock(this.batting.shotMode, false);
    this.ui.updateShotModeHUD();

    this.fielding.applyFieldSetting(this.fielding.setting, this.match.isPowerplayActive());
    this.fielding.resetToHomePositions(this.bowling.bowlerType);

    this.physics.state = 'runup';
    this.bowling.state = 'runup';
    this.runsCompletedThisBall = 0;
    this.runnersInMotion = false;
    this.strikerMeshZ = CREASE_Z;
    this.nonStrikerMeshZ = -CREASE_Z;
    this.bounceMarker.visible = false;

    this.ui.setCommentary(
      `${this.match.getActiveBowler().name} running in... Shot Mode (${this.batting.shotMode.toUpperCase()}) locks at release!`,
      `${this.match.getActiveBowler().name} दौड़ते हुए... गेंद छूटते ही शॉट मोड लॉक हो जाएगा!`
    );
  }

  /**
   * Bowler release moment: LOCKS the pre-selected shot mode (GROUND / FLY)
   */
  releaseBowledBall(delivery) {
    this.batting.lockShotMode();
    this.net.syncShotModeLock(this.batting.shotMode, true);
    this.ui.updateShotModeHUD();

    this.aimRing.position.set(delivery.targetX, 0.035, delivery.bounceZ);
    this.physics.launchDelivery(delivery);
    sound.playWhistle();
    this.ui.updateHUD();
    this.ui.setCommentary(
      `LOCKED [${this.batting.shotMode.toUpperCase()}] · ${delivery.speedKmh.toFixed(1)} km/h ${delivery.lengthLabelEn}! Swing now!`,
      `मोड लॉक [${this.batting.shotMode.toUpperCase()}] · ${delivery.speedKmh.toFixed(1)} km/h ${delivery.lengthLabelHi}! अब शॉट खेलें!`
    );
  }

  checkAndExecuteBattingContact() {
    const contact = this.batting.evaluateContact(this.physics, this.match.difficulty, {
      onBallHit: (info, isEdge) => {
        if (isEdge) {
          sound.playEdgeNick();
          this.net.vibratePhone('p1', [35]);
          this.ui.setCommentary(
            `${info.contactType}! Launch ${info.launchAngleDeg}° (${info.shotMode.toUpperCase()} mode).`,
            `${info.contactType}! लॉन्च कोण ${info.launchAngleDeg}°`
          );
        } else {
          sound.playBatHit(info.timingQuality, info.timingQuality > 0.7);
          this.net.vibratePhone('p1', [75]);
          this.savedCameraMode = this.cameraMode;
          this.cameraMode = 'follow';
          this.replayFrames = [];

          if (info.exitSpeedKmh > 30) {
            this.startSingleRunSprint();
          }

          this.ui.setCommentary(
            `${info.shotNameEn} [${info.shotMode.toUpperCase()} · ${info.launchAngleDeg}°]! ${info.timingLabelEn} (${info.exitSpeedKmh} km/h).`,
            `${info.shotNameHi} [${info.shotMode.toUpperCase()} · ${info.launchAngleDeg}°]! ${info.timingLabelHi} (${info.exitSpeedKmh} km/h).`
          );
        }
        this.ui.updateHUD();
      },
      onSwingMiss: (info) => {
        this.ui.setCommentary(
          `Play and miss! (${info.timingLabelEn}, gap ${info.timingOffsetMs}ms)`,
          `बल्ला चूका! (${info.timingLabelHi}, ${info.timingOffsetMs}ms)`
        );
        this.ui.updateHUD();
      }
    });
    return contact;
  }

  startSingleRunSprint() {
    if (!this.runnersInMotion && this.runsCompletedThisBall < 3) {
      this.runnersInMotion = true;
      this.runnerProgress = 0;
    }
  }

  triggerExtraRun() {
    if (this.physics.state === 'hit' || this.physics.state === 'fielded') {
      if (this.runnersInMotion) {
        this.pendingExtraRun = true;
      } else {
        this.startSingleRunSprint();
      }
      this.ui.setCommentary(
        'Calling for another run! Pushing hard between the wickets!',
        'दूसरे रन की कॉल! विकेटों के बीच तेज़ दौड़!'
      );
    }
  }

  completeDelivery(outcome) {
    this.physics.state = 'dead';
    this.runnersInMotion = false;
    this.pendingExtraRun = false;

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

    if (outcome.isBoundary && this.replayFrames.length > 12) {
      setTimeout(() => {
        this.isReplaying = true;
        this.replayIndex = 0;
        this.cameraMode = 'replay';
        this.ui.setCommentary('ACTION REPLAY · Boundary Highlight', 'एक्शन रीप्ले · बाउंड्री हाइलाइट');
      }, 900);
      setTimeout(() => {
        this.isReplaying = false;
        this.cameraMode = this.savedCameraMode;
        this.resetBallAndFielders();
      }, 3600);
    } else {
      setTimeout(() => {
        this.cameraMode = this.savedCameraMode;
        this.resetBallAndFielders();
      }, 1700);
    }

    if (this.match.isMatchOver) {
      const msg = this.ui.lang === 'hi' ? this.match.winnerTextHi : this.match.winnerTextEn;
      this.ui.showEventBanner('MATCH OVER', msg, 'text-emerald-400');
      setTimeout(() => {
        this.ui.renderScorecardAndWagonWheel();
        this.ui.openModal('modal-scorecard');
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

    this.fielding.applyFieldSetting(this.fielding.setting, this.match.isPowerplayActive());
    this.fielding.resetToHomePositions(this.bowling.bowlerType);
    this.strikerMeshZ = CREASE_Z;
    this.nonStrikerMeshZ = -CREASE_Z;
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

    if (this.net.disconnectPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.isReplaying && this.replayFrames.length > 0) {
      const frame = this.replayFrames[Math.floor(this.replayIndex) % this.replayFrames.length];
      this.ballGroup.position.copy(frame.ballPos);
      this.ballShadow.position.set(frame.ballPos.x, 0.03, frame.ballPos.z);
      this.replayIndex += 0.45;
      this.updateCameras(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // 1. Update Batting Stance & Crease Movement
    this.batting.updateFrame(dt);

    // 2. Update Bowler Run-up
    if (this.physics.state === 'runup') {
      this.bowling.updateRunup(dt, () => {
        if (this.bowling.state !== 'released') {
          if (this.match.userRole === 'bat') {
            const aiDelivery = this.bowling.generateAIDelivery(this.match.difficulty, this.match.legalBalls);
            this.releaseBowledBall(aiDelivery);
          } else {
            const manualDelivery = this.bowling.triggerManualDelivery(0.85);
            this.releaseBowledBall(manualDelivery);
          }
        }
      });
    }

    // 3. AI Batsman when Human is Bowling
    if (this.physics.state === 'bowled' && this.match.userRole === 'bowl') {
      this.batting.updateAIBatsman(this.physics, this.match.difficulty, {
        onBallHit: (info, isEdge) => {
          sound.playBatHit(info.timingQuality, !isEdge);
          this.savedCameraMode = this.cameraMode;
          this.cameraMode = 'follow';
          if (info.exitSpeedKmh > 30) this.startSingleRunSprint();
          this.ui.updateHUD();
        }
      });
    }

    // 4. Evaluate Bat Contact if player initiated swing as ball crosses crease
    if (this.physics.state === 'bowled' && this.physics.pos.z >= CREASE_Z - 1.35) {
      this.checkAndExecuteBattingContact();
    }

    // 5. Step Ball Physics
    this.physics.update(dt, {
      onPitchBounce: (bouncePos, surface) => {
        sound.playPitchBounce(surface);
        this.bounceMarker.position.set(bouncePos.x, 0.04, bouncePos.z);
        this.bounceMarker.visible = true;
      },
      onOutfieldBounce: () => {
        sound.playPitchBounce('club');
      },
      onStumpsHit: (end) => {
        this.dislodgeWickets(end);
        this.net.vibratePhone('p1', [150, 60, 200]);
        sound.playCrowdCheer(0.95, 2.5);
        const isPlayedOn = this.batting.lastContact.contactType === 'Played-On (Inside Edge)';
        this.ui.showEventBanner(isPlayedOn ? 'PLAYED ON · BOWLED!' : 'BOWLED HIM!', 'Timber! Stumps shattered!', 'text-red-500');
        this.ui.setCommentary(
          `BOWLED! ${this.match.getActiveStriker().name} is out!`,
          `बोल्ड! ${this.match.getActiveStriker().name} आउट!`
        );
        this.completeDelivery({
          runsScored: 0,
          isWicket: true,
          wicketTypeEn: 'Bowled',
          wicketTypeHi: 'बोल्ड'
        });
      },
      onBallThroughToKeeper: (ball) => {
        if (ball.isWide) {
          this.ui.showEventBanner('WIDE BALL', '+1 Extra Run & Re-Bowl', 'text-sky-400');
          this.ui.setCommentary('Wide signaled by the umpire.', 'अंपायर का इशारा वाइड बॉल।');
          this.completeDelivery({ runsScored: 0, isWide: true });
          return;
        }
        if (ball.isNoBall) {
          this.ui.showEventBanner('NO BALL · FREE HIT!', '+1 Extra Run', 'text-amber-400');
          this.completeDelivery({ runsScored: 0, isNoBall: true });
          return;
        }
        if (!this.batting.shotExecutedThisBall && ball.checkLBW(this.batting.creaseX)) {
          sound.playCrowdCheer(0.85, 2.0);
          this.ui.showEventBanner('OUT · LBW!', 'Plumb in front of middle stump!', 'text-red-500');
          this.ui.setCommentary('Huge appeal and the finger goes up! LBW!', 'जोरदार अपील और अंपायर ने उंगली उठाई! LBW आउट!');
          this.completeDelivery({
            runsScored: 0,
            isWicket: true,
            wicketTypeEn: 'LBW',
            wicketTypeHi: 'एलबीडब्ल्यू (LBW)'
          });
          return;
        }
        this.ui.setCommentary('Dot ball, safely gathered by the wicketkeeper.', 'डॉट बॉल, विकेटकीपर के दस्तानों में सुरक्षित।');
        this.completeDelivery({ runsScored: 0 });
      },
      onBoundary: (runs, ball) => {
        sound.playCrowdCheer(1.0, 2.8);
        this.net.vibratePhone('p1', runs === 6 ? [100, 50, 140, 50, 180] : [90, 50, 120]);
        if (runs === 6) {
          this.ui.showEventBanner('MAXIMUM SIX!', `${Math.round(ball.shotDistance)}m · Launch ${this.batting.lastLaunchAngleDeg}°`, 'text-amber-400');
          this.ui.setCommentary(
            `SIX RUNS! Launched at ${this.batting.lastLaunchAngleDeg}° in FLY mode (${Math.round(ball.shotDistance)}m)!`,
            `शानदार छक्का! (${Math.round(ball.shotDistance)} मीटर, लॉन्च कोण ${this.batting.lastLaunchAngleDeg}°)!`
          );
        } else {
          this.ui.showEventBanner('FOUR RUNS!', `Cracking ${this.batting.shotMode.toUpperCase()} shot (${this.batting.lastLaunchAngleDeg}°)!`, 'text-sky-400');
          this.ui.setCommentary(
            `FOUR! Races across the turf at ${this.batting.lastLaunchAngleDeg}° launch angle!`,
            `चौका! फील्डरों को चीरती हुई गेंद बाउंड्री के पार!`
          );
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

    if (this.physics.state === 'hit') {
      this.replayFrames.push({
        ballPos: this.physics.pos.clone()
      });
    }

    // 6. Step 9 AI Fielders + Wicketkeeper (with Probabilistic Catching & Dropped Catches)
    this.fielding.update(dt, this.physics, this.match.difficulty, {
      onCaught: (fielder, isCaughtBehind, catchPct) => {
        sound.playCrowdCheer(0.95, 2.4);
        this.net.vibratePhone('p1', [140, 60, 140]);
        const title = isCaughtBehind ? 'CAUGHT BEHIND!' : 'OUT · CAUGHT!';
        const sub = `Taken by ${fielder.role} (Catch Prob: ${catchPct}%)`;
        this.ui.showEventBanner(title, sub, 'text-red-500');
        this.ui.setCommentary(`${title} ${sub}`, `कैच आउट! ${fielder.role} ने कैच लपका (${catchPct}% संभावना)!`);
        this.completeDelivery({
          runsScored: 0,
          isWicket: true,
          wicketTypeEn: isCaughtBehind ? 'Caught Behind' : `c ${fielder.role}`,
          wicketTypeHi: isCaughtBehind ? 'विकेटकीपर कैच' : 'कैच आउट'
        });
      },
      onCatchDropped: (fielder, catchPct) => {
        sound.playEdgeNick();
        this.ui.showEventBanner('DROPPED CATCH!', `Spilled by ${fielder.role} (${catchPct}% chance)!`, 'text-amber-400');
        this.ui.setCommentary(
          `DROPPED! ${fielder.role} couldn't hang on to a tough chance (${catchPct}% probability)!`,
          `कैच छूटा! ${fielder.role} के हाथों से गेंद छिटकी (${catchPct}% संभावना)!`
        );
      },
      onFielded: (fielder) => {
        this.ui.setCommentary(
          `Fielded by ${fielder.role}, firing the throw back to the stumps!`,
          `${fielder.role} ने गेंद रोकी और स्टंप्स पर थ्रो किया!`
        );
      },
      onThrowReachedStumps: (targetEnd) => {
        if (this.runnersInMotion && this.runnerProgress > 0.12 && this.runnerProgress < 0.88) {
          this.dislodgeWickets(targetEnd);
          this.ui.showEventBanner('RUN OUT!', 'Direct hit catches the batter short of the crease!', 'text-red-500');
          this.completeDelivery({
            runsScored: this.runsCompletedThisBall,
            isWicket: true,
            wicketTypeEn: 'Run Out',
            wicketTypeHi: 'रन आउट'
          });
        } else {
          const totalRuns = this.runsCompletedThisBall;
          if (totalRuns > 0) {
            this.ui.showEventBanner(`${totalRuns} RUN${totalRuns > 1 ? 'S' : ''}`, 'Good running between the wickets', 'text-emerald-400');
          }
          this.completeDelivery({
            runsScored: totalRuns,
            isNoBall: this.physics.isNoBall,
            shotAngleRad: this.physics.shotAngleRad,
            shotDistance: this.physics.shotDistance
          });
        }
      }
    });

    // 7. Update Running Between Wickets
    if (this.runnersInMotion) {
      this.runnerProgress += dt * 0.65;
      const zA = THREE.MathUtils.lerp(CREASE_Z, -CREASE_Z, Math.min(1, this.runnerProgress));
      const zB = THREE.MathUtils.lerp(-CREASE_Z, CREASE_Z, Math.min(1, this.runnerProgress));
      this.strikerMeshZ = this.runsCompletedThisBall % 2 === 0 ? zA : zB;
      this.nonStrikerMeshZ = this.runsCompletedThisBall % 2 === 0 ? zB : zA;

      if (this.runnerProgress >= 1.0) {
        this.runsCompletedThisBall++;
        this.runnerProgress = 0;
        if (this.pendingExtraRun && this.runsCompletedThisBall < 3) {
          this.pendingExtraRun = false;
        } else {
          this.runnersInMotion = false;
        }
      }
    }

    // 8. Sync 3D Meshes with Simulation State
    this.syncMeshesWithState(dt);

    // 9. Update Camera
    this.updateCameras(dt);

    // 10. Update Live Phone Telemetry & Debug Panel
    this.ui.updateLivePhoneTelemetry(
      this.batting.angularSpeedDeg,
      this.batting.footwork,
      this.net.controllers.p1.connected,
      this.net.controllers.p1.latencyMs
    );

    this.renderer.render(this.scene, this.camera);
  }

  syncMeshesWithState(dt) {
    this.ballGroup.position.copy(this.physics.pos);
    this.ballGroup.rotation.x += this.physics.omega.x * dt;
    this.ballGroup.rotation.y += this.physics.omega.y * dt;
    this.ballShadow.position.set(this.physics.pos.x, 0.03, this.physics.pos.z);

    const posAttr = this.trailGeo.attributes.position;
    for (let i = 0; i < this.physics.maxTrail; i++) {
      const pt = i < this.physics.trailCount ? this.physics.trail[i] : this.physics.pos;
      posAttr.setXYZ(i, pt.x, pt.y, pt.z);
    }
    posAttr.needsUpdate = true;

    this.aimRing.position.x = THREE.MathUtils.damp(this.aimRing.position.x, this.bowling.aimTargetX, 10, dt);
    this.aimRing.position.z = THREE.MathUtils.damp(this.aimRing.position.z, this.bowling.aimBounceZ, 10, dt);

    // Striker Position & Real-Time Low-Lag 3D Bat Reproduction
    const targetStrikerZ = this.runnersInMotion ? this.strikerMeshZ : CREASE_Z - this.batting.creaseZOffset;
    this.strikerMesh.position.x = THREE.MathUtils.damp(this.strikerMesh.position.x, this.batting.creaseX, 24, dt);
    this.strikerMesh.position.z = THREE.MathUtils.damp(this.strikerMesh.position.z, targetStrikerZ, 24, dt);

    const batPivot = this.strikerMesh.userData.batPivot;
    if (batPivot) {
      if (this.batting.isCalibrated && this.net.controllers.p1.connected) {
        // Fast slerp (0.88) to predicted relative quaternion (q_current * inverse(q_stance))
        batPivot.quaternion.slerp(this.batting.currentQuat, 0.88);
      } else {
        batPivot.rotation.x = THREE.MathUtils.damp(batPivot.rotation.x, this.batting.backliftAngle, 24, dt);
        batPivot.rotation.y = THREE.MathUtils.damp(batPivot.rotation.y, -this.batting.swingPlaneYaw * 0.75, 24, dt);
        batPivot.rotation.z = THREE.MathUtils.damp(batPivot.rotation.z, this.batting.swingPlaneYaw * 0.45, 24, dt);
      }
    }

    this.nonStrikerMesh.position.z = THREE.MathUtils.damp(this.nonStrikerMesh.position.z, this.nonStrikerMeshZ, 12, dt);

    this.bowlerMesh.position.z = this.bowling.runupZ;
    this.bowlerMesh.position.x = this.bowling.bowlerSide === 'over' ? 0.36 : -0.36;
    if (this.bowlerMesh.userData.rightArm) {
      this.bowlerMesh.userData.rightArm.rotation.x = -this.bowling.armAngle;
    }

    this.keeperMesh.position.copy(this.fielding.keeper.pos);
    this.fielding.fielders.forEach((f, idx) => {
      if (this.fielderMeshes[idx]) {
        this.fielderMeshes[idx].position.copy(f.pos);
        this.fielderMeshes[idx].rotation.y = f.rotY;
      }
    });

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
      _camTargetPos.set(
        this.ballGroup.position.x + Math.cos(t) * 9.5,
        3.6,
        this.ballGroup.position.z + Math.sin(t) * 9.5
      );
      _camLookAt.copy(this.ballGroup.position);
    }

    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camTargetPos.x, 5.5, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camTargetPos.y, 5.5, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camTargetPos.z, 5.5, dt);

    _currentLookAt.x = THREE.MathUtils.damp(_currentLookAt.x, _camLookAt.x, 7.5, dt);
    _currentLookAt.y = THREE.MathUtils.damp(_currentLookAt.y, _camLookAt.y, 7.5, dt);
    _currentLookAt.z = THREE.MathUtils.damp(_currentLookAt.z, _camLookAt.z, 7.5, dt);
    this.camera.lookAt(_currentLookAt);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.boxCricketApp = new BoxCricketApp();
});
