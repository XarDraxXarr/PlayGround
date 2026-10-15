import * as THREE from 'three';

/* ============================================================
   ELDEN REALM — Shadow of the Golden Tree
   A free fan-made 3D souls-like for desktop. No external assets:
   all geometry / audio is procedural. Three.js via CDN only.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
function angLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
  return a + d * t;
}
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.hypot(dx, dz); }

/* ---------------- world layout ---------------- */
const ARENA = { x: 0, z: -168, r: 26 };
const GATE = { x: 0, z: -136 };
const ERDTREE = { x: 0, z: -200 };
const GRACES = [
  { id: 0, name: 'Stranded Graveyard', x: 0, z: 62 },
  { id: 1, name: 'Stormhill Shack', x: 66, z: -34 },
  { id: 2, name: 'Gatefront Approach', x: -46, z: -108 },
];
const WORLD_R = 198;

/* ---------------- terrain height ---------------- */
function baseHeight(x, z) {
  let h = 2.1 * Math.sin(x * 0.021) * Math.cos(z * 0.024)
        + 1.1 * Math.sin(x * 0.052 + z * 0.031)
        + 0.5 * Math.sin(x * 0.11 - z * 0.09);
  // path flattening: main road from spawn to gate (x near 0, z from 70 to -136)
  const pathD = Math.abs(x) + Math.abs(z + 30) * 0.15;
  // flatten spots
  let flat = 1;
  const spots = [
    ...GRACES.map(g => [g.x, g.z, 16]),
    [0, 62, 20], [GATE.x, GATE.z, 18], [ARENA.x, ARENA.z, ARENA.r + 8],
    [ERDTREE.x, ERDTREE.z, 30],
  ];
  for (const [sx, sz, sr] of spots) {
    const d = dist2(x, z, sx, sz);
    if (d < sr) { const t = 1 - d / sr; flat = Math.min(flat, 1 - t * t * 0.96); }
  }
  // road flatten
  if (Math.abs(x) < 9 && z < 75 && z > -140) {
    const t = 1 - Math.abs(x) / 9;
    flat = Math.min(flat, 1 - t * 0.75);
  }
  void pathD;
  h *= flat;
  // rim mountains (capped wall so the world feels enclosed)
  const r = Math.hypot(x, z);
  if (r > 160) h += Math.min((r - 160) * 1.1, 45);
  // erdtree hill: gentle golden rise, never a spike
  const de = dist2(x, z, ERDTREE.x, ERDTREE.z);
  if (de < 42) { const t = 1 - de / 42; h = lerp(h, 6, t * t); }
  // arena floor exact
  if (dist2(x, z, ARENA.x, ARENA.z) < ARENA.r) h *= 0.04;
  return h;
}
function groundY(x, z) {
  x = clamp(x, -210, 210); z = clamp(z, -280, 120);
  return baseHeight(x, z);
}

/* ================= AUDIO (procedural) ================= */
const AudioSys = {
  ctx: null, master: null, muted: false, ambientNodes: [],
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startAmbient();
    } catch (e) { /* no audio */ }
  },
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  },
  env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  },
  tone(freq, type, dur, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    this.env(g, t0, 0.01, vol, dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.1);
  },
  noise(dur, vol, filterFreq, type = 'lowpass') {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.01, vol, dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  },
  swing() { this.noise(0.18, 0.25, 2400, 'bandpass'); },
  heavySwing() { this.noise(0.3, 0.35, 1400, 'bandpass'); },
  hit() { this.noise(0.15, 0.5, 900); this.tone(140, 'square', 0.12, 0.18, 60); },
  crit() { this.noise(0.25, 0.6, 700); this.tone(90, 'sawtooth', 0.3, 0.3, 40); },
  block() { this.tone(320, 'square', 0.1, 0.2, 180); this.noise(0.08, 0.3, 3000, 'highpass'); },
  roll() { this.noise(0.22, 0.18, 600); },
  flask() { this.tone(400, 'sine', 0.25, 0.2, 800); this.tone(600, 'sine', 0.3, 0.12, 1200); },
  runes() { this.tone(880, 'sine', 0.15, 0.15); setTimeout(() => this.tone(1320, 'sine', 0.2, 0.15), 90); },
  grace() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 'sine', 0.5, 0.16), i * 130)); },
  death() { this.tone(220, 'sawtooth', 1.2, 0.25, 40); this.noise(1.0, 0.2, 300); },
  bossRoar() { this.tone(70, 'sawtooth', 1.4, 0.4, 45); this.noise(1.2, 0.35, 250); },
  bolt() { this.tone(1200, 'sawtooth', 0.25, 0.16, 300); },
  levelup() { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this.tone(f, 'triangle', 0.4, 0.2), i * 110)); },
  victory() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 'triangle', 0.7, 0.2), i * 180)); },
  uiClick() { this.tone(660, 'sine', 0.08, 0.12); },
  startAmbient() {
    try {
      // wind: looped filtered noise
      const len = this.ctx.sampleRate * 3;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < len; i++) { v = v * 0.98 + (Math.random() * 2 - 1) * 0.02; d[i] = v * 8; }
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
      const g = this.ctx.createGain(); g.gain.value = 0.05;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lg = this.ctx.createGain(); lg.gain.value = 0.025;
      lfo.connect(lg); lg.connect(g.gain);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(); lfo.start();
      // deep drone
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 55;
      const og = this.ctx.createGain(); og.gain.value = 0.03;
      o.connect(og); og.connect(this.master); o.start();
    } catch (e) {}
  }
};

/* ================= INPUT ================= */
const Input = {
  keys: new Set(), attackQ: false, heavyQ: false, dodgeQ: false,
  interactQ: false, flaskQ: false, boltQ: false, lockQ: false, jumpQ: false,
  mouseDX: 0, mouseDY: 0, rmbDown: false, rmbHoldT: 0, locked: false,
  dragging: false, lastX: 0, lastY: 0,
  init(canvas, onPause) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ') { this.dodgeQ = true; e.preventDefault(); }
      if (k === 'e') this.interactQ = true;
      if (k === 'r') this.flaskQ = true;
      if (k === 'f') this.boltQ = true;
      if (k === 'q') this.lockQ = true;
      if (k === 'c') this.jumpQ = true;
      if (k === 'm') { AudioSys.init(); toast(AudioSys.toggleMute() ? 'Sound muted [M]' : 'Sound on [M]'); }
      if (k === 'escape') onPause();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      AudioSys.init();
      if (Game.state === 'playing' && !this.locked && e.button === 0 && !this.dragging) {
        // try pointer lock; drag-look is fallback
        try { canvas.requestPointerLock?.(); } catch (err) {}
      }
      if (e.button === 0) this.attackQ = true;
      if (e.button === 2) { this.rmbDown = true; this.rmbHoldT = 0; }
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        if (this.rmbHoldT < 0.28) this.heavyQ = true; // tap = heavy
        this.rmbDown = false;
      }
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
      else if (this.dragging && Game.state === 'playing') {
        this.mouseDX += e.clientX - this.lastX; this.mouseDY += e.clientY - this.lastY;
        this.lastX = e.clientX; this.lastY = e.clientY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && Game.state === 'playing' && Game.hasLockedOnce) Game.pause();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  consume() {
    const o = {
      attack: this.attackQ, heavy: this.heavyQ, dodge: this.dodgeQ,
      interact: this.interactQ, flask: this.flaskQ, bolt: this.boltQ,
      lock: this.lockQ, jump: this.jumpQ,
      mdx: this.mouseDX, mdy: this.mouseDY,
    };
    this.attackQ = this.heavyQ = this.dodgeQ = this.interactQ =
      this.flaskQ = this.boltQ = this.lockQ = this.jumpQ = false;
    this.mouseDX = this.mouseDY = 0;
    return o;
  }
};
const blocking = () => Input.rmbDown && Input.rmbHoldT > 0.28 && Game.state === 'playing' && Player.stamina > 1 && !Player.rolling;

/* ================= THREE SETUP ================= */
let renderer, scene, camera, canvas;
try {
  canvas = $('scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('load-error').classList.remove('hidden');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1322);
scene.fog = new THREE.FogExp2(0x141c30, 0.0034);
camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 900);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.HemisphereLight(0x9db4dd, 0x3a3220, 0.85));
const sun = new THREE.DirectionalLight(0xffd9a0, 1.35);
sun.position.set(-60, 90, 40);
scene.add(sun);
const erdLight = new THREE.PointLight(0xffc860, 2.2, 220, 1.2);
erdLight.position.set(ERDTREE.x, 40, ERDTREE.z);
scene.add(erdLight);
const graceLight = new THREE.PointLight(0xffd070, 1.6, 40, 1.4);
scene.add(graceLight);
const bossLight = new THREE.PointLight(0xff5040, 0, 60, 1.5);
bossLight.position.set(ARENA.x, 8, ARENA.z);
scene.add(bossLight);

/* sky dome */
{
  const geo = new THREE.SphereGeometry(820, 16, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x070b1a) },
      mid: { value: new THREE.Color(0x27334f) },
      hor: { value: new THREE.Color(0xc98f3d) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top,mid,hor;
      void main(){ float h = normalize(vP).y;
        vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25,0.9,h)) : mix(hor, mid, smoothstep(-0.08,0.25,h));
        if (h < 0.0) c = mix(hor*0.4, vec3(0.02,0.02,0.04), smoothstep(0.0,-0.3,h));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  // sun disc + stars
  const sunSpr = new THREE.Mesh(new THREE.CircleGeometry(26, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe0a0, fog: false }));
  sunSpr.position.set(-320, 190, -560); sunSpr.lookAt(0, 40, 0);
  scene.add(sunSpr);
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 500; i++) {
    const t = rand(0, TAU), p = rand(0.15, 1.2), r = 760;
    sp.push(Math.cos(t) * Math.cos(p) * r, Math.sin(p) * r, Math.sin(t) * Math.cos(p) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaFC4ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 })));
}

/* ground */
function buildGround() {
  const SIZE = 440, SEG = 100;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE + 120, SEG, SEG + 26);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x44542e), cGrass2 = new THREE.Color(0x5a6630),
    cDirt = new THREE.Color(0x6b5a3c), cStone = new THREE.Color(0x55555e),
    cGold = new THREE.Color(0x7a6f35), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i) - 70;
    const y = groundY(x, z);
    pos.setY(i, y); pos.setZ(i, z);
    const n = Math.sin(x * 0.4) * Math.cos(z * 0.37) * 0.5 + 0.5;
    tmp.copy(cGrass).lerp(cGrass2, n);
    if (Math.abs(x) < 8 && z < 75 && z > -140) tmp.lerp(cDirt, 0.75); // road
    if (dist2(x, z, ARENA.x, ARENA.z) < ARENA.r + 6) tmp.lerp(cStone, 0.8); // arena
    const dg = dist2(x, z, ERDTREE.x, ERDTREE.z);
    if (dg < 55) tmp.lerp(cGold, (1 - dg / 55) * 0.55); // golden roots zone
    const slope = Math.abs(baseHeight(x + 1.5, z) - y) + Math.abs(baseHeight(x, z + 1.5) - y);
    if (slope > 0.9) tmp.lerp(cStone, 0.6);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  scene.add(mesh);
}
buildGround();

/* scatter: instanced trees / rocks / grass */
const colliders = []; // {x,z,r}
function scatter() {
  const dummy = new THREE.Object3D();
  const treePos = [], rockPos = [], grassPos = [];
  let guard = 0;
  const clearOf = (x, z) => {
    if (Math.abs(x) < 11 && z < 78 && z > -142) return false; // road
    for (const g of GRACES) if (dist2(x, z, g.x, g.z) < 15) return false;
    if (dist2(x, z, ARENA.x, ARENA.z) < ARENA.r + 10) return false;
    if (dist2(x, z, GATE.x, GATE.z) < 16) return false;
    if (dist2(x, z, ERDTREE.x, ERDTREE.z) < 34) return false;
    if (dist2(x, z, 0, 62) < 18) return false;
    return true;
  };
  while (treePos.length < 90 && guard++ < 3000) {
    const x = rand(-190, 190), z = rand(-250, 110);
    if (Math.hypot(x, z) > WORLD_R) continue;
    if (!clearOf(x, z)) continue;
    treePos.push([x, groundY(x, z), z, rand(0.7, 1.5)]);
  }
  guard = 0;
  while (rockPos.length < 70 && guard++ < 3000) {
    const x = rand(-190, 190), z = rand(-250, 110);
    if (Math.hypot(x, z) > WORLD_R) continue;
    if (!clearOf(x, z)) continue;
    rockPos.push([x, groundY(x, z), z, rand(0.5, 2.2)]);
  }
  guard = 0;
  while (grassPos.length < 260 && guard++ < 6000) {
    const x = rand(-180, 180), z = rand(-240, 100);
    if (Math.hypot(x, z) > WORLD_R) continue;
    if (!clearOf(x, z)) continue;
    grassPos.push([x, groundY(x, z), z, rand(0.5, 1.1)]);
  }
  const trunkG = new THREE.CylinderGeometry(0.35, 0.6, 5, 6);
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 });
  const trunk = new THREE.InstancedMesh(trunkG, trunkM, treePos.length);
  const leafG = new THREE.ConeGeometry(2.6, 6.5, 7);
  const leafM = new THREE.MeshStandardMaterial({ color: 0x3d4f24, roughness: 1, flatShading: true, emissive: 0x332200, emissiveIntensity: 0.25 });
  const leaf = new THREE.InstancedMesh(leafG, leafM, treePos.length);
  treePos.forEach(([x, y, z, s], i) => {
    dummy.position.set(x, y + 2.2 * s, z); dummy.scale.setScalar(s);
    dummy.rotation.set(0, rand(0, TAU), 0); dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + (5 + 2.6) * s - 1.4, z); dummy.updateMatrix();
    leaf.setMatrixAt(i, dummy.matrix);
    if (i % 3 === 0) colliders.push({ x, z, r: 0.9 });
  });
  const rockG = new THREE.DodecahedronGeometry(1, 0);
  const rockM = new THREE.MeshStandardMaterial({ color: 0x5c5c64, roughness: 1, flatShading: true });
  const rock = new THREE.InstancedMesh(rockG, rockM, rockPos.length);
  rockPos.forEach(([x, y, z, s], i) => {
    dummy.position.set(x, y + 0.3 * s, z);
    dummy.scale.set(s, s * 0.7, s); dummy.rotation.set(rand(0, 3), rand(0, 3), 0);
    dummy.updateMatrix(); rock.setMatrixAt(i, dummy.matrix);
    if (s > 1.2) colliders.push({ x, z, r: s * 0.9 });
  });
  const grassG = new THREE.ConeGeometry(0.35, 1.3, 4);
  const grassM = new THREE.MeshStandardMaterial({ color: 0x9a8a3f, roughness: 1, emissive: 0x443a10, emissiveIntensity: 0.4 });
  const grass = new THREE.InstancedMesh(grassG, grassM, grassPos.length);
  grassPos.forEach(([x, y, z, s], i) => {
    dummy.position.set(x, y + 0.5 * s, z); dummy.scale.setScalar(s);
    dummy.rotation.set(0, rand(0, TAU), 0); dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
  });
  for (const m of [trunk, leaf, rock, grass]) { m.instanceMatrix.needsUpdate = true; scene.add(m); }
}
scatter();

/* ruins + church + shack */
function box(w, h, d, color, x, z, ry = 0, yOff = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  m.position.set(x, groundY(x, z) + h / 2 + yOff, z);
  m.rotation.y = ry; scene.add(m);
  colliders.push({ x, z, r: Math.max(w, d) * 0.55 });
  return m;
}
{
  // gatefront ruins (west of road)
  box(6, 7, 6, 0x6e6a60, -24, -88, 0.4); box(5, 4, 5, 0x67635a, -30, -80, 0.1);
  box(10, 1.2, 1.5, 0x6e6a60, -22, -94, 0.4);
  box(1.6, 9, 1.6, 0x6e6a60, -18, -84, 0); box(1.6, 9, 1.6, 0x6e6a60, -14, -86, 0);
  // stormhill shack (near grace 1)
  box(7, 4, 6, 0x5a4a36, 70, -30, -0.3); box(7.6, 0.5, 6.6, 0x3d3222, 70, -27.6, -0.3);
  // broken pillars along road
  for (let i = 0; i < 8; i++) {
    const x = (i % 2 ? 12 : -12) + rand(-2, 2), z = 40 - i * 18;
    const h = rand(2, 6);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, h, 7),
      new THREE.MeshStandardMaterial({ color: 0x77716a, roughness: 1 }));
    m.position.set(x, groundY(x, z) + h / 2, z); scene.add(m);
    colliders.push({ x, z, r: 1.2 });
  }
  // arena surrounding pillars
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU, x = ARENA.x + Math.cos(a) * (ARENA.r + 4), z = ARENA.z + Math.sin(a) * (ARENA.r + 4);
    const h = rand(5, 9);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.3, h, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 1 }));
    m.position.set(x, groundY(x, z) + h / 2, z); scene.add(m);
  }
}

/* Erdtree */
let erdCanopy;
{
  const g = new THREE.Group();
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x6a5230, roughness: 1, emissive: 0x664411, emissiveIntensity: 0.35 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(5, 9, 70, 8), trunkM);
  trunk.position.y = 35; g.add(trunk);
  const branchM = new THREE.MeshStandardMaterial({ color: 0x8a6a35, emissive: 0xaa7711, emissiveIntensity: 0.5, roughness: 1 });
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(1, 2.2, 30, 6), trunkM);
    const a = i / 7 * TAU;
    b.position.set(Math.cos(a) * 10, 62, Math.sin(a) * 10);
    b.rotation.set(Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6);
    g.add(b);
  }
  const leafM = new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.85, fog: false });
  const leafG = new THREE.SphereGeometry(1, 8, 6);
  erdCanopy = new THREE.Group();
  for (let i = 0; i < 60; i++) {
    const s = new THREE.Mesh(leafG, leafM);
    const a = rand(0, TAU), r = rand(4, 30), y = rand(60, 110);
    s.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    s.scale.setScalar(rand(3, 8));
    erdCanopy.add(s);
  }
  g.add(erdCanopy);
  const gy = groundY(ERDTREE.x, ERDTREE.z);
  g.position.set(ERDTREE.x, gy - 2, ERDTREE.z);
  scene.add(g);
}

/* Sites of Grace */
const graceObjs = [];
{
  const pillarM = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 });
  const glowM = new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const gr of GRACES) {
    const y = groundY(gr.x, gr.z);
    const grp = new THREE.Group(); grp.position.set(gr.x, y, gr.z);
    const sword = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.6, 6), pillarM);
    sword.position.y = 0.8; grp.add(sword);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 9, 10, 1, true), glowM.clone());
    beam.position.y = 4.5; grp.add(beam);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.08, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd070 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; grp.add(ring);
    // floating motes anchor
    scene.add(grp);
    graceObjs.push({ ...gr, grp, beam, ring, y });
  }
}

/* fog gate */
let fogWall, gateBarrier = true;
{
  const pilM = new THREE.MeshStandardMaterial({ color: 0x3c3c44, roughness: 1 });
  for (const sx of [-7, 7]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.5, 12, 2.5), pilM);
    p.position.set(GATE.x + sx, groundY(GATE.x + sx, GATE.z) + 6, GATE.z);
    scene.add(p);
    colliders.push({ x: GATE.x + sx, z: GATE.z, r: 2 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(17, 2, 3), pilM);
  lintel.position.set(GATE.x, groundY(GATE.x, GATE.z) + 12.5, GATE.z);
  scene.add(lintel);
  fogWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 11),
    new THREE.MeshBasicMaterial({ color: 0xd8cf9a, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  fogWall.position.set(GATE.x, groundY(GATE.x, GATE.z) + 5.5, GATE.z);
  scene.add(fogWall);
}

/* boss arena barrier */
let arenaBarrier;
{
  arenaBarrier = new THREE.Mesh(new THREE.CylinderGeometry(ARENA.r + 2, ARENA.r + 2, 10, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xd8a03a, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
  arenaBarrier.position.set(ARENA.x, groundY(ARENA.x, ARENA.z) + 5, ARENA.z);
  scene.add(arenaBarrier);
}

/* ================= PARTICLES ================= */
function makeDotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grd; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}
const dotTex = makeDotTexture();
const Particles = {
  pool: [], idx: 0,
  init() {
    const geo = new THREE.PlaneGeometry(0.35, 0.35);
    for (let i = 0; i < 220; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, map: dotTex,
      }));
      m.visible = false; scene.add(m);
      this.pool.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grav: 0 });
    }
  },
  burst(x, y, z, { n = 12, color = 0xffcf6a, speed = 5, up = 3, life = 0.6, grav = -9, size = 1 } = {}) {
    for (let k = 0; k < n; k++) {
      const p = this.pool[this.idx++ % this.pool.length];
      p.m.visible = true; p.m.material.color.setHex(color);
      p.m.position.set(x + rand(-0.3, 0.3), y + rand(-0.3, 0.3), z + rand(-0.3, 0.3));
      const a = rand(0, TAU), s = rand(0.3, 1) * speed;
      p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = rand(0.2, 1) * up;
      p.life = p.max = life * rand(0.6, 1.2); p.grav = grav;
      p.m.scale.setScalar(rand(0.6, 1.6) * size);
      p.m.material.opacity = 0.7;
    }
  },
  update(dt) {
    for (const p of this.pool) {
      if (!p.m.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      p.vy += p.grav * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      p.m.material.opacity = (p.life / p.max) * 0.7;
      p.m.lookAt(camera.position);
    }
  }
};
Particles.init();

/* projectiles */
const projectiles = [];
function fireBolt(x, y, z, dir, { dmg = 40, fromPlayer = true, color = 0x9fd0ff } = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6),
    new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z); scene.add(m);
  projectiles.push({ m, vx: dir.x * 26, vy: dir.y * 26 + 1, vz: dir.z * 26, life: 2.2, dmg, fromPlayer });
  Particles.burst(x, y, z, { n: 6, color, speed: 2, life: 0.3 });
  AudioSys.bolt();
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    const gy = groundY(p.m.position.x, p.m.position.z);
    let dead = p.life <= 0 || p.m.position.y < gy;
    if (!dead) {
      if (p.fromPlayer) {
        for (const e of enemies) {
          if (e.dead) continue;
          if (dist2(p.m.position.x, p.m.position.z, e.grp.position.x, e.grp.position.z) < e.radius + 0.4 &&
            Math.abs(p.m.position.y - (e.grp.position.y + 1.2)) < 2.4) {
            damageEnemy(e, p.dmg, false, p.m.position);
            dead = true; break;
          }
        }
      } else if (Player.alive && Game.state === 'playing') {
        const pp = Player.grp.position;
        if (dist2(p.m.position.x, p.m.position.z, pp.x, pp.z) < 0.9 && Math.abs(p.m.position.y - (pp.y + 1.2)) < 2) {
          damagePlayer(p.dmg, p.m.position);
          dead = true;
        }
      }
    }
    if (Math.random() < 0.5) Particles.burst(p.m.position.x, p.m.position.y, p.m.position.z, { n: 1, color: 0x9fd0ff, speed: 0.5, life: 0.25 });
    if (dead) { scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); projectiles.splice(i, 1); }
  }
}

/* damage numbers (HTML) */
const dmgPool = [];
for (let i = 0; i < 24; i++) {
  const d = document.createElement('div');
  d.className = 'dmg-num'; d.style.display = 'none';
  document.body.appendChild(d);
  dmgPool.push({ el: d, t: 0 });
}
let dmgIdx = 0;
const v3 = new THREE.Vector3();
function damageNumber(x, y, z, amount, cls = '') {
  v3.set(x, y, z).project(camera);
  if (v3.z > 1) return;
  const sx = (v3.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v3.y * 0.5 + 0.5) * window.innerHeight;
  const d = dmgPool[dmgIdx++ % dmgPool.length];
  d.el.className = 'dmg-num ' + cls;
  d.el.textContent = Math.round(amount);
  d.el.style.display = 'block';
  d.el.style.left = (sx + rand(-20, 20)) + 'px';
  d.el.style.top = (sy - 10) + 'px';
  d.el.style.opacity = '1';
  d.el.style.transform = 'translateY(0)';
  d.t = 0.8;
}
function updateDamageNumbers(dt) {
  for (const d of dmgPool) {
    if (d.el.style.display === 'none') continue;
    d.t -= dt;
    if (d.t <= 0) { d.el.style.display = 'none'; continue; }
    d.el.style.transform = `translateY(${(0.8 - d.t) * -70}px)`;
    d.el.style.opacity = String(clamp(d.t / 0.8, 0, 1));
  }
}

/* ================= CHARACTER BUILDERS ================= */
function limbMat(color) { return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.25 }); }
function buildHumanoid({ armor = 0x3a3f4a, trim = 0x8a6f2f, skin = 0xc8a080, scale = 1, cape = 0, horns = false, glowEyes = 0 } = {}) {
  const g = new THREE.Group();
  const parts = {};
  const mat = limbMat(armor), trimM = limbMat(trim), skinM = limbMat(skin);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.42), mat);
  torso.position.y = 1.35; g.add(torso); parts.torso = torso;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.14, 0.44), trimM);
  belt.position.y = 0.98; g.add(belt);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.42), trimM);
  head.position.y = 2.02; g.add(head); parts.head = head;
  if (glowEyes) {
    const eM = new THREE.MeshBasicMaterial({ color: glowEyes });
    for (const sx of [-0.11, 0.11]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eM);
      e.position.set(sx, 2.04, 0.22); g.add(e);
    }
  } else {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x11131a }));
    slit.position.set(0, 2.02, 0.22); g.add(slit);
  }
  if (horns) {
    for (const sx of [-0.3, 0.3]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 6), trimM);
      h.position.set(sx, 2.4, 0); h.rotation.z = -sx * 1.6; g.add(h);
    }
  }
  const mkLimb = (w, l, m, x, y) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, l, w), m);
    mesh.position.y = -l / 2; pivot.add(mesh); g.add(pivot);
    return pivot;
  };
  parts.armL = mkLimb(0.2, 0.75, mat, -0.48, 1.72);
  parts.armR = mkLimb(0.2, 0.75, mat, 0.48, 1.72);
  parts.legL = mkLimb(0.24, 0.9, mat, -0.18, 0.95);
  parts.legR = mkLimb(0.24, 0.9, mat, 0.18, 0.95);
  // sword in right hand
  const sword = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.15, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.3, metalness: 0.9, emissive: 0x222222, emissiveIntensity: 0.4 }));
  blade.position.y = -0.95; sword.add(blade);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.26), trimM);
  guard.position.y = -0.38; sword.add(guard);
  sword.position.set(0, -0.75, 0.1);
  parts.armR.add(sword); parts.sword = sword;
  // shield on left
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 12),
    new THREE.MeshStandardMaterial({ color: 0x4a3f28, roughness: 0.7, metalness: 0.5 }));
  shield.rotation.z = Math.PI / 2; shield.position.set(0, -0.7, -0.15);
  parts.armL.add(shield); parts.shield = shield;
  if (cape) {
    const capeM = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.2),
      new THREE.MeshStandardMaterial({ color: cape, roughness: 1, side: THREE.DoubleSide }));
    capeM.position.set(0, 1.1, -0.28); capeM.rotation.x = 0.12; g.add(capeM);
    parts.cape = capeM;
  }
  g.scale.setScalar(scale);
  return { grp: g, parts };
}

/* ================= PLAYER ================= */
const CLASSES = {
  vagabond: { hp: 130, fp: 60, st: 110, dmg: 30, name: 'Vagabond', armor: 0x4a4a55, trim: 0xa8893f, cape: 0x5a1a1a },
  astrologer: { hp: 95, fp: 120, st: 95, dmg: 24, name: 'Astrologer', armor: 0x2a3550, trim: 0x6a8ac0, cape: 0x1a2a4a },
  bandit: { hp: 110, fp: 70, st: 130, dmg: 27, name: 'Bandit', armor: 0x3a3226, trim: 0x7a7a7a, cape: 0x2a2a2a },
};
const Player = {
  grp: null, parts: null, cls: 'vagabond',
  pos: new THREE.Vector3(0, 0, 62), vel: new THREE.Vector3(),
  yaw: Math.PI, vy: 0, grounded: true, // yaw = heading; forward = (sin yaw, cos yaw); PI = north
  level: 1, runes: 0, vigor: 0, endurance: 0, strength: 0,
  maxHP: 130, hp: 130, maxFP: 60, fp: 60, maxST: 110, stamina: 110,
  flasks: 3, maxFlasks: 3, alive: true,
  atkT: 99, atkKind: 'light', combo: 0, comboWin: 0, didHit: false,
  rollT: 99, rollDir: 0, iframes: 0, blockHold: false,
  castT: 99, hurtT: 99, staminaDelay: 0, stepT: 0,
  bloodstain: null, kills: 0, deaths: 0, startTime: 0,
  build(cls) {
    this.cls = cls;
    const c = CLASSES[cls];
    if (this.grp) scene.remove(this.grp);
    const { grp, parts } = buildHumanoid({ armor: c.armor, trim: c.trim, cape: c.cape });
    this.grp = grp; this.parts = parts;
    scene.add(grp);
    this.maxHP = c.hp; this.hp = c.hp; this.maxFP = c.fp; this.fp = c.fp;
    this.maxST = c.st; this.stamina = c.st;
    this.level = 1; this.runes = 0; this.vigor = this.endurance = this.strength = 0;
    this.flasks = this.maxFlasks = cls === 'bandit' ? 4 : 3;
    this.alive = true; this.kills = 0; this.deaths = 0;
    this.startTime = performance.now();
    this.respawn(GRACES[0], true);
  },
  get lightDmg() { return CLASSES[this.cls].dmg + this.strength * 4 + this.level * 1.5; },
  get heavyDmg() { return (CLASSES[this.cls].dmg + this.strength * 4 + this.level * 1.5) * 1.9; },
  respawn(grace, fullReset = false) {
    this.pos.set(grace.x + 2, 0, grace.z + 2);
    this.pos.y = groundY(this.pos.x, this.pos.z);
    this.yaw = Math.PI; // face north (-z, toward the gate / Erdtree)
    this.hp = this.maxHP; this.fp = this.maxFP; this.stamina = this.maxST;
    this.flasks = this.maxFlasks; this.alive = true;
    this.atkT = 99; this.rollT = 99; this.castT = 99; this.vel.set(0, 0, 0);
    if (!fullReset) { this.hp = this.maxHP; }
  },
  useStamina(n) {
    if (this.stamina < n) return false;
    this.stamina -= n; this.staminaDelay = 0.65;
    return true;
  },
  update(dt, inp, cam) {
    const alive = this.alive && Game.state === 'playing';
    // camera orbit always (even dead, slow)
    const sens = 0.0026;
    cam.yaw -= inp.mdx * sens;
    cam.pitch = clamp(cam.pitch + inp.mdy * sens, -0.15, 1.05);
    if (Input.rmbDown) Input.rmbHoldT += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    this.hurtT += dt; this.castT += dt; this.atkT += dt; this.rollT += dt;
    this.comboWin -= dt; this.staminaDelay -= dt;
    if (this.staminaDelay <= 0 && this.stamina < this.maxST && !this.blockHold)
      this.stamina = Math.min(this.maxST, this.stamina + 30 * dt);
    this.fp = Math.min(this.maxFP, this.fp + 7 * dt);

    if (!alive) return;

    // lock-on handling
    if (inp.lock) Game.toggleLock();
    if (Game.lockTarget && (Game.lockTarget.dead ||
      dist2(this.pos.x, this.pos.z, Game.lockTarget.grp.position.x, Game.lockTarget.grp.position.z) > 34)) {
      Game.lockTarget = null; updateLockHUD();
    }
    if (Game.lockTarget) {
      const t = Game.lockTarget.grp.position;
      const want = Math.atan2(-(t.x - this.pos.x), -(t.z - this.pos.z));
      cam.yaw = angLerp(cam.yaw, want, Math.min(1, dt * 5));
    }

    // movement input (camera relative)
    let mx = 0, mz = 0;
    if (Input.keys.has('w')) mz -= 1; if (Input.keys.has('s')) mz += 1;
    if (Input.keys.has('a')) mx -= 1; if (Input.keys.has('d')) mx += 1;
    const sprinting = (Input.keys.has('shift')) && mz < 0 && this.stamina > 1 && !blocking();
    const moving = (mx !== 0 || mz !== 0);
    const rolling = this.rollT < 0.48;
    const attacking = this.atkT < (this.atkKind === 'heavy' ? 0.85 : 0.46);

    // dodge roll
    if (inp.dodge && !rolling && !attacking && this.grounded) {
      if (this.useStamina(22)) {
        this.rollT = 0; this.iframes = 0.38; this.atkT = -9;
        this.rollDir = moving ? Math.atan2(mx, mz) + cam.yaw + Math.PI : this.yaw;
        AudioSys.roll();
        Particles.burst(this.pos.x, this.pos.y + 0.3, this.pos.z, { n: 8, color: 0x9a9178, speed: 3, life: 0.4 });
      } else toast('Not enough stamina!');
    }
    // jump
    if (inp.jump && this.grounded && !rolling && !attacking) {
      this.vy = 6.2; this.grounded = false;
      AudioSys.roll();
    }
    // attacks
    if (!rolling) {
      if (inp.attack && !attacking && this.castT > 0.4) {
        const chained = this.comboWin > 0;
        if (this.useStamina(18)) {
          this.atkKind = 'light'; this.atkT = 0; this.didHit = false;
          this.combo = chained ? (this.combo + 1) % 2 : 0;
          this.comboWin = 0;
          if (Game.lockTarget) {
            const t = Game.lockTarget.grp.position;
            this.yaw = Math.atan2(-(t.x - this.pos.x), -(t.z - this.pos.z)) + Math.PI;
          } else if (moving) this.yaw = Math.atan2(mx, mz) + cam.yaw;
          AudioSys.swing();
        } else toast('Not enough stamina!');
      } else if (inp.heavy && !attacking && this.castT > 0.4) {
        if (this.useStamina(34)) {
          this.atkKind = 'heavy'; this.atkT = 0; this.didHit = false;
          this.comboWin = 0;
          if (Game.lockTarget) {
            const t = Game.lockTarget.grp.position;
            this.yaw = Math.atan2(-(t.x - this.pos.x), -(t.z - this.pos.z)) + Math.PI;
          } else if (moving) this.yaw = Math.atan2(mx, mz) + cam.yaw;
          AudioSys.heavySwing();
        } else toast('Not enough stamina!');
      }
    }
    // cast bolt
    if (inp.bolt && this.castT > 0.6 && !rolling && !attacking) {
      if (this.fp >= 25) {
        this.fp -= 25; this.castT = 0;
        const dir = new THREE.Vector3(Math.sin(this.yaw), 0.05, Math.cos(this.yaw)).normalize();
        fireBolt(this.pos.x, this.pos.y + 1.6, this.pos.z, dir, { dmg: 45 + this.level * 3, fromPlayer: true });
      } else toast('Not enough FP!');
    }
    // flask
    if (inp.flask && this.flasks > 0 && this.hp < this.maxHP && !rolling) {
      this.flasks--; this.hp = Math.min(this.maxHP, this.hp + this.maxHP * 0.55);
      AudioSys.flask();
      Particles.burst(this.pos.x, this.pos.y + 1, this.pos.z, { n: 16, color: 0x7fe08a, speed: 2, up: 4, life: 0.8 });
      $('heal-flash').style.opacity = '1';
      setTimeout(() => $('heal-flash').style.opacity = '0', 120);
      message('Flask of Crimson Tears  (' + this.flasks + ' left)');
    } else if (inp.flask && this.flasks <= 0) toast('No flasks left — rest at grace!');

    // attack strike moment
    const strikeAt = this.atkKind === 'heavy' ? 0.38 : 0.16;
    if (attacking && !this.didHit && this.atkT >= strikeAt) {
      this.didHit = true;
      this.comboWin = 0.9;
      const dmg = this.atkKind === 'heavy' ? this.heavyDmg : this.lightDmg * (this.combo === 1 ? 1.15 : 1);
      const range = this.atkKind === 'heavy' ? 3.1 : 2.7;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw); // heading forward
      let hitAny = false;
      for (const e of enemies) {
        if (e.dead) continue;
        const dx = e.grp.position.x - this.pos.x, dz = e.grp.position.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < range + e.radius) {
          const dot = (dx * fx + dz * fz) / (d || 1);
          if (dot > 0.25 || d < 1.4) {
            const crit = Math.random() < (this.cls === 'bandit' ? 0.25 : 0.1);
            damageEnemy(e, dmg * (crit ? 1.6 : 1) * rand(0.92, 1.08), crit, e.grp.position);
            hitAny = true;
          }
        }
      }
      if (hitAny) AudioSys.hit(); else AudioSys.swing();
      // lunge
      this.pos.x += fx * (this.atkKind === 'heavy' ? 1.2 : 0.6);
      this.pos.z += fz * (this.atkKind === 'heavy' ? 1.2 : 0.6);
    }

    // locomotion
    this.blockHold = blocking();
    let speed = 0;
    if (!attacking || this.atkT > 0.3) {
      if (moving) {
        const wantYaw = Math.atan2(mx, mz) + cam.yaw;
        // face movement (unless locked + attacking/blocking → strafe face target)
        if (Game.lockTarget && (this.blockHold || attacking)) {
          const t = Game.lockTarget.grp.position;
          this.yaw = angLerp(this.yaw, Math.atan2(-(t.x - this.pos.x), -(t.z - this.pos.z)) + Math.PI, Math.min(1, dt * 10));
        } else this.yaw = angLerp(this.yaw, wantYaw, Math.min(1, dt * 12));
        speed = sprinting ? 7.6 : this.blockHold ? 2.2 : 5.1;
        if (sprinting) this.stamina = Math.max(0, this.stamina - 11 * dt);
        const nx = this.pos.x + Math.sin(wantYaw) * speed * dt * (rolling ? 0.2 : 1);
        const nz = this.pos.z + Math.cos(wantYaw) * speed * dt * (rolling ? 0.2 : 1);
        // collide world
        if (Math.hypot(nx, nz) < WORLD_R && !hitCollider(nx, nz) && !arenaBlocked(nx, nz)) {
          this.pos.x = nx; this.pos.z = nz;
        }
        this.stepT += dt * speed;
      }
    }
    if (rolling) {
      const rs = 8.6 * (1 - this.rollT / 0.55);
      const nx = this.pos.x + Math.sin(this.rollDir) * rs * dt;
      const nz = this.pos.z + Math.cos(this.rollDir) * rs * dt;
      if (Math.hypot(nx, nz) < WORLD_R && !hitCollider(nx, nz) && !arenaBlocked(nx, nz)) {
        this.pos.x = nx; this.pos.z = nz;
      }
    }
    // gravity / ground
    const gy = groundY(this.pos.x, this.pos.z);
    if (!this.grounded) {
      this.vy -= 18 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gy) { this.pos.y = gy; this.grounded = true; this.vy = 0; }
    } else this.pos.y = lerp(this.pos.y, gy, Math.min(1, dt * 14));

    // bloodstain pickup
    if (this.bloodstain && dist2(this.pos.x, this.pos.z, this.bloodstain.x, this.bloodstain.z) < 2.2) {
      this.runes += this.bloodstain.runes;
      message('Recovered ' + this.bloodstain.runes + ' runes!');
      AudioSys.runes();
      scene.remove(this.bloodstain.mesh);
      this.bloodstain = null;
    }

    // burn patches
    for (const b of burnPatches) {
      if (performance.now() < b.until && dist2(this.pos.x, this.pos.z, b.x, b.z) < b.r && this.iframes <= 0) {
        damagePlayer(12 * dt * 3, this.pos, true);
      }
    }

    this.grp.position.copy(this.pos);
    this.grp.rotation.y = this.yaw; // model faces local +z; yaw is heading
    this.animate(dt, moving, speed, sprinting, rolling, attacking);
  },
  animate(dt, moving, speed, sprinting, rolling, attacking) {
    const P = this.parts, t = performance.now() / 1000;
    if (!P) return;
    if (!this.alive) { this.grp.rotation.x = lerp(this.grp.rotation.x, -Math.PI / 2.4, dt * 3); return; }
    this.grp.rotation.x = 0;
    if (rolling) {
      const k = this.rollT / 0.48;
      P.torso.rotation.x = lerp(0.9, -0.4, k);
      P.armR.rotation.x = -2.4; P.armL.rotation.x = -2.4;
      P.legL.rotation.x = -1.2; P.legR.rotation.x = 1.0;
      this.grp.position.y += Math.sin(k * Math.PI) * 0.15;
      return;
    }
    P.torso.rotation.x = this.blockHold ? 0.12 : (attacking ? -0.12 : (moving && sprinting ? 0.18 : 0.03 * Math.sin(t * 2)));
    if (attacking) {
      const total = this.atkKind === 'heavy' ? 0.85 : 0.46;
      const k = clamp(this.atkT / total, 0, 1);
      const swing = this.combo === 1 ? 1 : -1;
      P.armR.rotation.x = lerp(-2.6 * swing, 1.2 * swing, k);
      P.armR.rotation.z = lerp(0.5, -0.6, Math.sin(k * Math.PI));
      P.sword.rotation.x = lerp(0.6, -0.5, k);
    } else if (this.blockHold) {
      P.armL.rotation.x = -1.5; P.armL.rotation.z = 0.7;
      P.armR.rotation.x = -0.4;
      P.sword.rotation.x = 0;
    } else if (this.castT < 0.5) {
      P.armR.rotation.x = -2.2 + this.castT * 3; P.armR.rotation.z = 0;
    } else {
      const sw = moving ? Math.sin(this.stepT * 1.9) * (sprinting ? 0.85 : 0.6) : Math.sin(t * 1.6) * 0.05;
      P.armR.rotation.x = sw; P.armR.rotation.z = 0.08;
      P.armL.rotation.x = this.blockHold ? -1.5 : -sw;
      P.armL.rotation.z = this.blockHold ? 0.7 : -0.08;
      P.sword.rotation.x = 0;
    }
    if (!attacking && !rolling) {
      const sw = moving ? Math.sin(this.stepT * 1.9) * (sprinting ? 0.9 : 0.65) : 0;
      P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
    }
    if (P.cape) P.cape.rotation.x = 0.12 + (moving && sprinting ? 0.7 : moving ? 0.3 : 0.06 * Math.sin(t * 2));
    // shield dip when stamina low
    if (P.shield) P.shield.material.emissive = P.shield.material.emissive || new THREE.Color();
  }
};
function hitCollider(x, z) {
  for (const c of colliders) {
    if (dist2(x, z, c.x, c.z) < c.r + 0.5) return true;
  }
  return false;
}
function arenaBlocked(nx, nz) {
  // before boss starts: free; during boss: keep player inside; after: free
  if (Game.bossActive && !Game.bossDead) {
    return dist2(nx, nz, ARENA.x, ARENA.z) > ARENA.r;
  }
  return false;
}

/* ================= ENEMIES ================= */
const enemies = [];
const burnPatches = [];
let enemyId = 0;
class Enemy {
  constructor(kind, x, z) {
    this.id = enemyId++;
    this.kind = kind;
    const cfg = {
      hollow: { hp: 65, dmg: 14, speed: 3.2, aggro: 13, range: 2.2, runes: 150, scale: 0.95, armor: 0x4c4a42, trim: 0x6a6558, radius: 0.6, windup: 0.7 },
      knight: { hp: 170, dmg: 24, speed: 3.8, aggro: 17, range: 2.6, runes: 420, scale: 1.08, armor: 0x23262e, trim: 0x8a2a2a, radius: 0.7, windup: 0.6 },
      boss: { hp: 1500, dmg: 34, speed: 4.6, aggro: 60, range: 3.8, runes: 6000, scale: 1.75, armor: 0x1c1e26, trim: 0xc09a3a, radius: 1.1, windup: 0.8, horns: true, eyes: 0xff3020, cape: 0x401010 },
    }[kind];
    Object.assign(this, cfg);
    this.maxHP = cfg.hp; this.home = { x, z };
    const { grp, parts } = buildHumanoid({
      armor: cfg.armor, trim: cfg.trim, scale: cfg.scale,
      horns: !!cfg.horns, glowEyes: cfg.eyes || 0, cape: cfg.cape || 0,
    });
    if (kind === 'boss') {
      // great axe
      const axe = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), limbMat(0x3a2c1c));
      shaft.position.y = -1.4; axe.add(shaft);
      const headA = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.85, roughness: 0.35, emissive: 0x881111, emissiveIntensity: 0.35 }));
      headA.position.y = -2.4; axe.add(headA);
      parts.armR.add(axe); this.axe = axe;
    }
    this.grp = grp; this.parts = parts;
    this.pos = grp.position;
    this.pos.set(x, groundY(x, z), z);
    this.yaw = rand(0, TAU);
    this.state = 'idle'; this.stateT = rand(0, 2);
    this.atkT = -9; this.didHit = false; this.stagger = 0;
    this.dead = false; this.deathT = 0; this.wanderA = rand(0, TAU);
    this.phase2 = false; this.comboN = 0;
    scene.add(grp);
  }
  reset() {
    if (this.kind === 'boss' && Game.bossDead) return;
    this.dead = false; this.hp = this.maxHP;
    this.pos.set(this.home.x, groundY(this.home.x, this.home.z), this.home.z);
    this.state = 'idle'; this.grp.visible = true;
    this.grp.rotation.x = 0; this.phase2 = this.kind === 'boss' ? (this.hp < this.maxHP / 2 ? this.phase2 : false) : false;
  }
  update(dt, t) {
    if (this.dead) {
      this.deathT += dt;
      this.grp.rotation.x = lerp(this.grp.rotation.x, -Math.PI / 2.2, Math.min(1, dt * 4));
      this.grp.position.y = lerp(this.grp.position.y, groundY(this.pos.x, this.pos.z) - 0.4, dt * 2);
      if (this.deathT > 6 && this.kind !== 'boss') this.grp.visible = false;
      return;
    }
    const P = Player.pos;
    const d = dist2(this.pos.x, this.pos.z, P.x, P.z);
    const dh = dist2(this.pos.x, this.pos.z, this.home.x, this.home.z);
    this.stateT += dt;
    this.stagger = Math.max(0, this.stagger - dt);
    const playerAlive = Player.alive && Game.state === 'playing';
    const windup = this.kind === 'boss' && this.phase2 ? this.windup * 0.7 : this.windup;

    // separation
    for (const o of enemies) {
      if (o === this || o.dead) continue;
      const dd = dist2(this.pos.x, this.pos.z, o.pos.x, o.pos.z);
      if (dd < 1.2 && dd > 0.001) {
        const push = (1.2 - dd) * dt * 2;
        this.pos.x += (this.pos.x - o.pos.x) / dd * push;
        this.pos.z += (this.pos.z - o.pos.z) / dd * push;
      }
    }

    if (this.state === 'attack') {
      this.atkT += dt;
      const targetYaw = Math.atan2(-(P.x - this.pos.x), -(P.z - this.pos.z)) + Math.PI;
      if (this.atkT < windup) this.yaw = angLerp(this.yaw, targetYaw, Math.min(1, dt * 4));
      if (!this.didHit && this.atkT >= windup) {
        this.didHit = true;
        const dd = dist2(this.pos.x, this.pos.z, P.x, P.z);
        if (dd < this.range + 0.7 && playerAlive) {
          damagePlayer(this.dmg * rand(0.9, 1.1) * (this.kind === 'boss' && this.phase2 ? 1.15 : 1), this.pos);
        }
        Particles.burst(this.pos.x + Math.sin(this.yaw) * 1.5, this.pos.y + 1.2, this.pos.z + Math.cos(this.yaw) * 1.5,
          { n: 8, color: 0xff8866, speed: 4, life: 0.35 });
        AudioSys.swing();
        // boss slam AoE
        if (this.kind === 'boss' && this.slamAOE) {
          this.slamAOE = false;
          Particles.burst(this.pos.x + Math.sin(this.yaw) * 3, this.pos.y + 0.3, this.pos.z + Math.cos(this.yaw) * 3,
            { n: 30, color: 0xff6030, speed: 8, up: 5, life: 0.7 });
          AudioSys.crit();
          if (dd < 6 && playerAlive && Player.iframes <= 0) damagePlayer(this.dmg * 0.7, this.pos);
          if (this.phase2) {
            burnPatches.push({ x: this.pos.x + Math.sin(this.yaw) * 3, z: this.pos.z + Math.cos(this.yaw) * 3, r: 4, until: performance.now() + 6000 });
          }
        }
      }
      const total = windup + 0.55;
      if (this.atkT >= total) {
        // boss chains
        if (this.kind === 'boss' && this.comboN > 0 && d < this.range + 2) {
          this.comboN--; this.atkT = 0; this.didHit = false;
          this.slamAOE = Math.random() < 0.35;
        } else { this.state = 'chase'; this.stateT = 0; }
      }
    } else if (!playerAlive) {
      this.state = 'return'; this.wander(dt, t);
    } else if (d < this.range && Math.abs(P.y - this.pos.y) < 3) {
      // begin attack
      this.state = 'attack'; this.atkT = 0; this.didHit = false;
      this.slamAOE = this.kind === 'boss' && (d > 2.5 || Math.random() < 0.3);
      if (this.kind === 'boss' && Math.random() < 0.45) this.comboN = 1 + (this.phase2 ? 1 : 0);
      // telegraph flash
      Particles.burst(this.pos.x, this.pos.y + 2.2, this.pos.z, { n: 6, color: 0xff2222, speed: 1, life: 0.4 });
    } else if (d < this.aggro && dh < 42) {
      this.state = 'chase'; this.stateT = 0;
      this.moveToward(P.x, P.z, dt, this.speed * (this.kind === 'boss' && this.phase2 ? 1.2 : 1));
    } else if (this.state === 'chase' && d < this.aggro + 8 && dh < 46) {
      this.moveToward(P.x, P.z, dt, this.speed);
    } else if (dh > 6) {
      this.state = 'return';
      this.moveToward(this.home.x, this.home.z, dt, this.speed * 0.7);
      if (dh < 2) { this.hp = Math.min(this.maxHP, this.hp + this.maxHP * 0.02); }
    } else {
      this.state = 'idle';
      this.wander(dt, t);
    }
    // ranged: boss throws bolt at mid range
    if (this.kind === 'boss' && playerAlive && this.state === 'chase' && d > 9 && d < 30 && Math.random() < dt * 0.5) {
      const dir = new THREE.Vector3(P.x - this.pos.x, 1, P.z - this.pos.z).normalize();
      fireBolt(this.pos.x, this.pos.y + 2.5, this.pos.z, dir, { dmg: 22, fromPlayer: false, color: 0xff7040 });
    }
    this.pos.y = groundY(this.pos.x, this.pos.z);
    this.grp.rotation.y = this.yaw;
    this.animate(dt, t);
  }
  moveToward(x, z, dt, speed) {
    if (this.stagger > 0) speed *= 0.25;
    // yaw is heading: forward = (sin yaw, cos yaw)
    const moveYaw = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.yaw = angLerp(this.yaw, moveYaw, Math.min(1, dt * 6));
    const nx = this.pos.x + Math.sin(moveYaw) * speed * dt;
    const nz = this.pos.z + Math.cos(moveYaw) * speed * dt;
    if (!hitCollider(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    this.moving = true;
  }
  wander(dt, t) {
    this.moving = false;
    if (this.stateT > rand(2, 4)) { this.stateT = 0; this.wanderA = rand(0, TAU); }
    if (Math.random() < dt * 0.4) {
      const nx = this.pos.x + Math.sin(this.wanderA) * 1.2 * dt;
      const nz = this.pos.z + Math.cos(this.wanderA) * 1.2 * dt;
      if (dist2(nx, nz, this.home.x, this.home.z) < 8 && !hitCollider(nx, nz)) {
        this.pos.x = nx; this.pos.z = nz;
        this.yaw = angLerp(this.yaw, this.wanderA, dt * 3);
        this.moving = true;
      }
    }
  }
  animate(dt, t) {
    const P = this.parts;
    if (this.state === 'attack') {
      const windup = this.windup;
      const k = clamp(this.atkT / (windup + 0.55), 0, 1);
      if (this.atkT < windup) { P.armR.rotation.x = lerp(0, -2.4, this.atkT / windup); }
      else { const s = (this.atkT - windup) / 0.55; P.armR.rotation.x = lerp(-2.4, 1.4, s); }
      P.legL.rotation.x = 0.2; P.legR.rotation.x = -0.2;
    } else if (this.moving) {
      const sw = Math.sin(t * 7 + this.id) * 0.6;
      P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
      P.armR.rotation.x = -sw * 0.7; P.armL.rotation.x = sw * 0.7;
    } else {
      P.armR.rotation.x = Math.sin(t * 1.5 + this.id) * 0.06;
      P.armL.rotation.x = -P.armR.rotation.x;
      P.legL.rotation.x = P.legR.rotation.x = 0;
    }
    if (P.cape) P.cape.rotation.x = 0.15 + Math.sin(t * 2 + this.id) * 0.08;
  }
}

function spawnWorld() {
  for (const e of enemies) scene.remove(e.grp);
  enemies.length = 0;
  const spots = [
    ['hollow', 8, 40], ['hollow', -9, 28], ['hollow', 14, 8], ['hollow', -14, -6],
    ['hollow', 10, -28], ['hollow', -12, -48], ['knight', 40, -52], ['hollow', 58, -18],
    ['hollow', -38, -88], ['knight', -24, -100], ['hollow', -58, -118], ['knight', 12, -120],
    ['hollow', -8, -128], ['hollow', 20, -60], ['knight', -60, -60],
  ];
  for (const [k, x, z] of spots) enemies.push(new Enemy(k, x, z));
  const boss = new Enemy('boss', ARENA.x, ARENA.z - 8);
  boss.grp.visible = false; boss.dormant = true; boss.dead = false;
  enemies.push(boss);
  Game.boss = boss;
}

/* damage resolution */
function damageEnemy(e, dmg, crit, fromPos) {
  if (e.dead) return;
  if (e.dormant) return;
  e.hp -= dmg;
  e.stagger = 0.35;
  damageNumber(e.pos.x, e.pos.y + 2.4 * (e.kind === 'boss' ? 1.75 : 1), e.pos.z, dmg, crit ? 'crit' : '');
  Particles.burst(e.pos.x, e.pos.y + 1.4, e.pos.z, { n: crit ? 18 : 10, color: crit ? 0xffd070 : 0xff5040, speed: 5, life: 0.5 });
  if (e.hp <= 0) {
    e.hp = 0; e.dead = true; e.deathT = 0; e.state = 'dead';
    Player.runes += e.runes; Player.kills++;
    message(`+${e.runes} runes`);
    AudioSys.crit(); AudioSys.runes();
    Particles.burst(e.pos.x, e.pos.y + 1, e.pos.z, { n: 26, color: 0xffd070, speed: 6, up: 5, life: 0.9 });
    if (Game.lockTarget === e) { Game.lockTarget = null; updateLockHUD(); }
    if (e.kind === 'boss') Game.onBossKilled();
    updateHUD(true);
  } else if (e.kind === 'boss' && !e.phase2 && e.hp < e.maxHP / 2) {
    e.phase2 = true;
    message('Morgath burns with fell flame!');
    AudioSys.bossRoar();
    Particles.burst(e.pos.x, e.pos.y + 2, e.pos.z, { n: 40, color: 0xff4400, speed: 8, up: 6, life: 1 });
  }
  updateHUD(true);
  updateBossBar();
}
function damagePlayer(dmg, fromPos, isDot = false) {
  if (!Player.alive || Game.state !== 'playing' || Player.iframes > 0) return;
  // block
  if (blocking() && !isDot) {
    const fromA = Math.atan2(Player.pos.x - fromPos.x, Player.pos.z - fromPos.z);
    let diff = Math.abs(((fromA - Player.yaw) % TAU + TAU * 2) % TAU);
    if (diff > Math.PI) diff = TAU - diff;
    if (diff < 1.4 && Player.useStamina(dmg * 1.2)) {
      dmg *= 0.28;
      AudioSys.block();
      Particles.burst(Player.pos.x, Player.pos.y + 1.3, Player.pos.z, { n: 8, color: 0x9fc0ff, speed: 4, life: 0.3 });
    }
  }
  Player.hp -= dmg;
  Player.hurtT = 0;
  damageNumber(Player.pos.x, Player.pos.y + 2.4, Player.pos.z, dmg, 'player');
  Particles.burst(Player.pos.x, Player.pos.y + 1.2, Player.pos.z, { n: 10, color: 0xc02020, speed: 4, life: 0.5 });
  AudioSys.hit();
  $('vignette').style.opacity = String(clamp(0.4 + (1 - Player.hp / Player.maxHP) * 0.6, 0, 1));
  setTimeout(() => { if (Player.hp / Player.maxHP > 0.35) $('vignette').style.opacity = '0'; }, 350);
  if (Player.hp <= 0) {
    Player.hp = 0; Player.alive = false; Player.deaths++;
    Game.onPlayerDied();
  }
  updateHUD(true);
}

/* ================= GAME STATE ================= */
const Game = {
  state: 'title', boss: null, bossActive: false, bossDead: false, bossIntroT: 0,
  lockTarget: null, cam: { yaw: 0, pitch: 0.32, dist: 6 },
  hasLockedOnce: false, time: 0, graceOpen: null, pausedFrom: null,
  toggleLock() {
    if (this.lockTarget) { this.lockTarget = null; }
    else {
      let best = null, bd = 30;
      for (const e of enemies) {
        if (e.dead || e.dormant) continue;
        const d = dist2(Player.pos.x, Player.pos.z, e.pos.x, e.pos.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) this.lockTarget = best;
      else toast('No target in range');
    }
    AudioSys.uiClick();
    updateLockHUD();
  },
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    document.exitPointerLock?.();
    $('pause-menu').classList.remove('hidden');
    $('pause-stats').textContent = statLine();
  },
  resume() {
    if (this.state !== 'paused') return;
    $('pause-menu').classList.add('hidden');
    this.state = 'playing';
  },
  toTitle() {
    this.state = 'title';
    $('pause-menu').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('title').style.display = 'flex';
  },
  startRun() {
    AudioSys.init(); AudioSys.uiClick();
    $('title').style.display = 'none';
    $('hud').classList.remove('hidden');
    $('victory-screen').classList.add('hidden');
    this.resetWorld();
    this.state = 'playing';
    try { canvas.requestPointerLock?.(); this.hasLockedOnce = true; } catch (e) {}
    toast('Find the golden fog gate to the north...');
    message('Rise, Tarnished — seek the Erdtree');
  },
  resetWorld() {
    Player.build(Player.cls);
    for (const e of enemies) { e.dormant = e.kind === 'boss'; e.dead = false; e.grp.visible = e.kind !== 'boss'; e.hp = e.maxHP; e.phase2 = false; }
    this.bossActive = false; this.bossDead = false; this.lockTarget = null;
    bossLight.intensity = 0;
    $('boss-plate').classList.add('hidden');
    $('boss-intro').classList.add('hidden');
    $('fell-banner').classList.add('hidden');
    $('died-screen').classList.add('hidden');
    arenaBarrier.material.opacity = 0;
    fogWall.visible = true;
    projectiles.forEach(p => scene.remove(p.m)); projectiles.length = 0;
    burnPatches.length = 0;
    this.cam.yaw = 0; this.cam.pitch = 0.32;
    updateHUD(true); updateBossBar(); updateLockHUD();
  },
  onPlayerDied() {
    AudioSys.death();
    // drop bloodstain
    if (Player.bloodstain) scene.remove(Player.bloodstain.mesh);
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1.1, 16),
      new THREE.MeshBasicMaterial({ color: 0x30ff70, transparent: true, opacity: 0.8 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(Player.pos.x, groundY(Player.pos.x, Player.pos.z) + 0.05, Player.pos.z);
    scene.add(mesh);
    Player.bloodstain = { x: Player.pos.x, z: Player.pos.z, runes: Player.runes, mesh };
    Player.runes = 0;
    $('died-screen').classList.remove('hidden');
    setTimeout(() => {
      $('died-screen').classList.add('hidden');
      if (this.bossActive && !this.bossDead) { this.deactivateBoss(); }
      const g = GRACES[Game.lastGrace] || GRACES[0];
      Player.respawn(g);
      Game.cam.yaw = 0; Game.cam.pitch = 0.32; // face the road north again
      this.respawnEnemies();
      this.lockTarget = null; updateLockHUD(); updateHUD(true);
      $('vignette').style.opacity = '0';
      message('You respawn at ' + g.name);
    }, 3200);
    updateHUD(true);
  },
  lastGrace: 0,
  respawnEnemies() {
    for (const e of enemies) {
      if (e.kind === 'boss') continue;
      e.reset();
    }
  },
  restAtGrace(g) {
    Player.hp = Player.maxHP; Player.fp = Player.maxFP; Player.stamina = Player.maxST;
    Player.flasks = Player.maxFlasks;
    this.lastGrace = g.id;
    this.respawnEnemies();
    AudioSys.grace();
    Particles.burst(g.x, 1, g.z, { n: 30, color: 0xffd070, speed: 3, up: 6, life: 1.1 });
    updateHUD(true);
  },
  levelCost() { return Math.floor(80 * Math.pow(Player.level, 1.35)); },
  tryLevel(stat) {
    const cost = this.levelCost();
    if (Player.runes < cost) { toast(`Need ${cost} runes (have ${Player.runes})`); return; }
    Player.runes -= cost; Player.level++;
    if (stat === 'vig') { Player.vigor++; Player.maxHP += 22; Player.hp = Player.maxHP; }
    if (stat === 'end') { Player.endurance++; Player.maxST += 10; Player.stamina = Player.maxST; }
    if (stat === 'str') { Player.strength++; }
    AudioSys.levelup();
    Particles.burst(Player.pos.x, Player.pos.y + 1, Player.pos.z, { n: 24, color: 0xffe080, speed: 4, up: 6, life: 1 });
    refreshGraceMenu(); updateHUD(true);
  },
  activateBoss() {
    if (this.bossActive || this.bossDead) return;
    this.bossActive = true;
    const b = this.boss;
    b.dormant = false; b.grp.visible = true;
    b.pos.set(ARENA.x, groundY(ARENA.x, ARENA.z - 8), ARENA.z - 8);
    b.hp = b.maxHP; b.state = 'chase';
    bossLight.intensity = 2;
    arenaBarrier.material.opacity = 0.35;
    fogWall.visible = false;
    AudioSys.bossRoar();
    $('boss-plate').classList.remove('hidden');
    $('boss-intro').classList.remove('hidden');
    setTimeout(() => $('boss-intro').classList.add('hidden'), 3600);
    message('MORGATH, THE FELL OMEN');
    updateBossBar();
  },
  deactivateBoss() {
    this.bossActive = false;
    const b = this.boss;
    b.dormant = true; b.grp.visible = false; b.hp = b.maxHP; b.phase2 = false;
    bossLight.intensity = 0;
    arenaBarrier.material.opacity = 0;
    fogWall.visible = true;
    $('boss-plate').classList.add('hidden');
  },
  onBossKilled() {
    this.bossDead = true; this.bossActive = false;
    bossLight.intensity = 0.6;
    arenaBarrier.material.opacity = 0;
    $('boss-plate').classList.add('hidden');
    $('fell-banner').classList.remove('hidden');
    AudioSys.victory();
    Particles.burst(ARENA.x, 3, ARENA.z, { n: 80, color: 0xffd070, speed: 10, up: 8, life: 1.5 });
    setTimeout(() => $('fell-banner').classList.add('hidden'), 4000);
    setTimeout(() => {
      if (this.state !== 'playing') return;
      this.state = 'victory';
      document.exitPointerLock?.();
      const secs = Math.floor((performance.now() - Player.startTime) / 1000);
      const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
      let best = null;
      try {
        const prev = Number(localStorage.getItem('elden-realm-best') || '0');
        if (!prev || secs < prev) { localStorage.setItem('elden-realm-best', String(secs)); best = '★ New record!'; }
        else best = 'Best: ' + Math.floor(prev / 60) + ':' + String(prev % 60).padStart(2, '0');
      } catch (e) { best = ''; }
      $('victory-stats').innerHTML =
        `Level ${Player.level} ${CLASSES[Player.cls].name} · ${mm}:${ss} · ${Player.kills} foes felled · ${Player.deaths} deaths<br/>${best}`;
      $('victory-screen').classList.remove('hidden');
    }, 4500);
    updateBossBar();
  },
};
function statLine() {
  return `Level ${Player.level} ${CLASSES[Player.cls].name} · Runes ${Player.runes}\nHP ${Math.ceil(Player.hp)}/${Player.maxHP} · FP ${Math.ceil(Player.fp)}/${Player.maxFP} · ST ${Math.ceil(Player.stamina)}/${Player.maxST}\nFoes felled ${Player.kills} · Deaths ${Player.deaths} · Flasks ${Player.flasks}/${Player.maxFlasks}`;
}

/* ================= HUD ================= */
function toast(t, ms = 2200) {
  const el = $('toast');
  el.textContent = t; el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}
function message(t, ms = 3400) {
  const feed = $('message-feed');
  const d = document.createElement('div');
  d.className = 'msg'; d.textContent = t;
  feed.appendChild(d);
  while (feed.children.length > 3) feed.removeChild(feed.firstChild);
  setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .5s'; setTimeout(() => d.remove(), 500); }, ms);
}
function updateHUD(force) {
  $('hp-fill').style.width = clamp(Player.hp / Player.maxHP * 100, 0, 100) + '%';
  $('fp-fill').style.width = clamp(Player.fp / Player.maxFP * 100, 0, 100) + '%';
  $('st-fill').style.width = clamp(Player.stamina / Player.maxST * 100, 0, 100) + '%';
  $('hp-text').textContent = `${Math.ceil(Player.hp)}/${Player.maxHP}`;
  $('runes').textContent = Player.runes.toLocaleString();
  $('level-tag').textContent = 'LV ' + Player.level;
  $('flasks').textContent = Player.flasks;
}
function updateLockHUD() { $('lock-state').textContent = Game.lockTarget ? 'ON' : 'off'; }
function updateBossBar() {
  if (!Game.boss) return;
  $('boss-fill').style.width = clamp(Game.boss.hp / Game.boss.maxHP * 100, 0, 100) + '%';
}
const compassEl = $('compass-strip');
function updateCompass() {
  // yaw: 0 = looking -z? our cam yaw: forward = (sin(yaw+PI)?..) — approximate cardinal display
  const yaw = Game.cam.yaw;
  const dirs = [['N', 0], ['E', -Math.PI / 2], ['S', Math.PI], ['W', Math.PI / 2]];
  let html = '';
  for (let k = -2; k <= 2; k++) {
    const a = yaw + k * 0.5;
    let label = '·';
    for (const [name, da] of dirs) {
      let diff = Math.abs(((a - da) % TAU + TAU * 1.5) % TAU - Math.PI);
      if (diff > Math.PI) diff = TAU - diff;
      if (diff < 0.18) label = `<span class="tick">${name}</span>`;
    }
    // grace / boss markers
    const px = Player.pos.x, pz = Player.pos.z;
    const marks = [];
    for (const g of GRACES) marks.push([g.x, g.z, '✦', '#ffd070']);
    if (!Game.bossDead) marks.push([ARENA.x, ARENA.z, '◆', '#ff5040']);
    for (const [mx, mz, sym, col] of marks) {
      const ma = Math.atan2(-(mx - px), -(mz - pz));
      let diff = ((ma - a) % TAU + TAU) % TAU;
      if (diff > Math.PI) diff -= TAU;
      if (Math.abs(diff) < 0.2) label = `<span style="color:${col}">${sym}</span>`;
    }
    html += `<span style="display:inline-block;width:60px;text-align:center">${label}</span>`;
  }
  compassEl.innerHTML = html;
}
const mm = $('minimap').getContext('2d');
let mmT = 0;
function updateMinimap(dt) {
  mmT -= dt; if (mmT > 0) return; mmT = 0.15;
  const S = 148, R = 60; // world radius shown
  mm.clearRect(0, 0, S, S);
  mm.save(); mm.translate(S / 2, S / 2);
  const yaw = Game.cam.yaw;
  const rot = (wx, wz) => {
    const dx = (wx - Player.pos.x) / R * (S / 2 - 6);
    const dz = (wz - Player.pos.z) / R * (S / 2 - 6);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [dx * c - dz * s, dx * s + dz * c];
  };
  // range ring
  mm.strokeStyle = 'rgba(216,180,90,.25)'; mm.beginPath(); mm.arc(0, 0, S / 2 - 4, 0, TAU); mm.stroke();
  // road
  mm.strokeStyle = 'rgba(150,130,90,.4)'; mm.lineWidth = 3;
  mm.beginPath();
  const [rx1, rz1] = rot(0, 70), [rx2, rz2] = rot(0, -136);
  mm.moveTo(rx1, rz1); mm.lineTo(rx2, rz2); mm.stroke();
  // graces
  for (const g of GRACES) {
    const [x, y] = rot(g.x, g.z);
    if (Math.hypot(x, y) > S / 2 - 4) continue;
    mm.fillStyle = '#ffd070'; mm.beginPath(); mm.arc(x, y, 3.5, 0, TAU); mm.fill();
  }
  mm.fillStyle = '#2a7a35';
  mm.beginPath(); mm.arc(0, 0, S / 2 - 6, 0, TAU); mm.globalAlpha = 0.12; mm.fill(); mm.globalAlpha = 1;
  // erdtree
  {
    const [x, y] = rot(ERDTREE.x, ERDTREE.z);
    if (Math.hypot(x, y) < S / 2 - 4) { mm.fillStyle = '#ffb040'; mm.font = '12px serif'; mm.fillText('🌳', x - 6, y + 4); }
  }
  // enemies
  for (const e of enemies) {
    if (e.dead || e.dormant) continue;
    const [x, y] = rot(e.pos.x, e.pos.z);
    if (Math.hypot(x, y) > S / 2 - 6) continue;
    mm.fillStyle = e.kind === 'boss' ? '#ff3020' : '#ff7070';
    mm.beginPath(); mm.arc(x, y, e.kind === 'boss' ? 5 : 2.5, 0, TAU); mm.fill();
  }
  // player arrow
  mm.fillStyle = '#fff';
  mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4.5, 5); mm.lineTo(-4.5, 5); mm.closePath(); mm.fill();
  mm.restore();
}

/* grace menu */
function refreshGraceMenu() {
  const g = Game.graceOpen;
  if (!g) return;
  $('grace-name').textContent = g.name;
  $('grace-stats').textContent =
    `Level ${Player.level} ${CLASSES[Player.cls].name} · Runes: ${Player.runes}\n` +
    `HP ${Player.maxHP} · Stamina ${Player.maxST} · Attack ${Math.round(Player.lightDmg)}/${Math.round(Player.heavyDmg)} · Flasks ${Player.flasks}/${Player.maxFlasks}`;
  $('grace-cost').textContent = `Level-up cost: ${Game.levelCost()} runes  (Vigor +22 HP · Endurance +10 ST · Strength +dmg)`;
}
function openGrace(g) {
  Game.graceOpen = g; Game.state = 'grace';
  document.exitPointerLock?.();
  refreshGraceMenu();
  $('grace-menu').classList.remove('hidden');
  AudioSys.grace();
}
function closeGrace(rest = false) {
  $('grace-menu').classList.add('hidden');
  Game.graceOpen = null;
  if (Game.state === 'grace') Game.state = 'playing';
  if (rest && Game.lastGraceTarget) { /* noop */ }
}

/* ================= CAMERA ================= */
const camTmp = new THREE.Vector3();
function updateCamera(dt) {
  const c = Game.cam;
  const lock = Game.lockTarget;
  let tx, ty, tz;
  if (Game.state === 'title') {
    const t = performance.now() / 1000 * 0.08;
    const px = Math.sin(t) * 30, pz = 62 + Math.cos(t) * 30;
    camera.position.set(px, groundY(px, pz) + 7, pz);
    camera.lookAt(ERDTREE.x * 0.2, 18, -120);
    return;
  }
  const P = Player.pos;
  // desired distance (closer when locked / blocking)
  const wantDist = lock ? 5.2 : 6.2;
  c.dist = lerp(c.dist, wantDist, dt * 4);
  const cx = P.x + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist;
  const cz = P.z + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist;
  let cy = P.y + 1.9 + Math.sin(c.pitch) * c.dist;
  const minY = groundY(cx, cz) + 0.5;
  if (cy < minY) cy = minY;
  camera.position.lerp(camTmp.set(cx, cy, cz), Math.min(1, dt * 14));
  if (lock && !lock.dead) {
    const t = lock.pos;
    camTmp.set((P.x + t.x) / 2 - Math.sin(c.yaw) * 2, P.y + 1.6, (P.z + t.z) / 2 - Math.cos(c.yaw) * 2);
    camera.lookAt(camTmp);
  } else {
    tx = P.x - Math.sin(c.yaw) * 3; tz = P.z - Math.cos(c.yaw) * 3; ty = P.y + 1.7;
    camera.lookAt(tx, ty, tz);
  }
  // grace light follows nearest grace
  let ng = GRACES[0], nd = 1e9;
  for (const g of GRACES) { const d = dist2(P.x, P.z, g.x, g.z); if (d < nd) { nd = d; ng = g; } }
  graceLight.position.set(ng.x, groundY(ng.x, ng.z) + 3, ng.z);
}

/* ================= INTERACT ================= */
function nearestInteract() {
  const P = Player.pos;
  for (const g of GRACES) {
    if (dist2(P.x, P.z, g.x, g.z) < 3.4) return { type: 'grace', g, text: 'Rest at Site of Grace — ' + g.name };
  }
  const gd = dist2(P.x, P.z, GATE.x, GATE.z);
  if (gd < 5 && !Game.bossActive && !Game.bossDead) return { type: 'gate', text: 'Traverse the golden fog' };
  if (Game.bossDead && gd < 5) return { type: 'gate2', text: 'Enter the sanctum (victory)' };
  return null;
}

/* ================= MAIN LOOP ================= */
const clock = new THREE.Clock();
let hudT = 0, fpsAcc = 0, fpsN = 0, fpsT = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  Game.time += dt;
  const inp = Input.consume();

  // grace idle animation
  for (const g of graceObjs) {
    g.beam.rotation.y += dt * 0.8;
    g.beam.material.opacity = 0.4 + Math.sin(t * 2 + g.id) * 0.12;
    g.ring.scale.setScalar(1 + Math.sin(t * 2.4 + g.id) * 0.06);
    if (Math.random() < dt * 8) {
      Particles.burst(g.x + rand(-1, 1), 0.5, g.z + rand(-1, 1), { n: 1, color: 0xffd070, speed: 0.4, up: 2.2, life: 1.2, grav: 1, size: 0.45 });
    }
  }
  if (erdCanopy) erdCanopy.rotation.y += dt * 0.02;
  fogWall.material.opacity = 0.6 + Math.sin(t * 1.7) * 0.15;

  // burn patch visuals
  for (let i = burnPatches.length - 1; i >= 0; i--) {
    const b = burnPatches[i];
    if (performance.now() > b.until) { burnPatches.splice(i, 1); continue; }
    if (Math.random() < dt * 20) Particles.burst(b.x + rand(-3, 3), 0.3, b.z + rand(-3, 3), { n: 2, color: 0xff5010, speed: 1.5, up: 3, life: 0.6 });
  }

  if (Game.state === 'playing') {
    // pause via Esc handled in Input callback; also close with key
    Player.update(dt, inp, Game.cam);
    for (const e of enemies) { if (!e.dormant) e.update(dt, t); }
    updateProjectiles(dt);
    // boss trigger: entering arena
    if (!Game.bossActive && !Game.bossDead && dist2(Player.pos.x, Player.pos.z, ARENA.x, ARENA.z) < ARENA.r + 1 && Player.alive) {
      Game.activateBoss();
    }
    // interact
    const it = Player.alive ? nearestInteract() : null;
    if (it) {
      $('interact-prompt').classList.remove('hidden');
      $('interact-text').textContent = it.text;
      if (inp.interact) {
        if (it.type === 'grace') { openGrace(it.g); }
        else if (it.type === 'gate') {
          // teleport just inside arena + activate
          Player.pos.set(ARENA.x, groundY(ARENA.x, ARENA.z + 18), ARENA.z + 18);
          Game.activateBoss();
        }
      }
    } else $('interact-prompt').classList.add('hidden');
    // fell off world guard
    if (Player.pos.y < -30) { Player.pos.set(0, groundY(0, 62), 62); Player.hp -= 20; }
    updateCompass();
    updateMinimap(dt);
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.12; updateHUD(); }
  } else if (Game.state === 'grace') {
    if (inp.interact) closeGrace();
    Player.grp.position.copy(Player.pos);
  } else if (Game.state === 'title') {
    // idle: enemies wander slowly for a lively backdrop
    for (const e of enemies) { if (!e.dormant && !e.dead) { e.wander(dt, t); e.pos.y = groundY(e.pos.x, e.pos.z); } }
  } else if (Game.state === 'victory' || Game.state === 'paused' || Game.state === 'dead') {
    // frozen world, still render
  }

  Particles.update(dt);
  updateDamageNumbers(dt);
  updateCamera(dt);

  // fps tag (debug, subtle)
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    $('fps-tag').textContent = Math.round(fpsN / fpsAcc) + ' fps';
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }

  renderer.render(scene, camera);
}

/* ================= WIRING ================= */
function wireUI() {
  document.querySelectorAll('.class-card').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.class-card').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      Player.cls = btn.dataset.class;
      AudioSys.init(); AudioSys.uiClick();
    });
  });
  $('start-btn').addEventListener('click', () => Game.startRun());
  $('btn-rest').addEventListener('click', () => {
    if (Game.graceOpen) { Game.restAtGrace(Game.graceOpen); refreshGraceMenu(); toast('Rested — flasks refilled, world respawned'); }
  });
  $('btn-vig').addEventListener('click', () => Game.tryLevel('vig'));
  $('btn-end').addEventListener('click', () => Game.tryLevel('end'));
  $('btn-str').addEventListener('click', () => Game.tryLevel('str'));
  $('btn-leave').addEventListener('click', () => closeGrace());
  $('btn-resume').addEventListener('click', () => Game.resume());
  $('btn-quit-title').addEventListener('click', () => Game.toTitle());
  $('victory-btn').addEventListener('click', () => {
    Game.startRun();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'e' && Game.state === 'grace') closeGrace();
  });
}

/* ================= BOOT ================= */
Player.cls = 'vagabond';
Player.build('vagabond');
spawnWorld();
Input.init(canvas, () => {
  if (Game.state === 'playing') Game.pause();
  else if (Game.state === 'paused') Game.resume();
});
wireUI();
updateHUD(true);
loop();

// expose for debugging / automated checks
window.__game = { Game, Player, enemies, THREE };
