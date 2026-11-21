// 구름섬 아르카 — 5단계: 걷기 + 싸우기 + 모으기 + 함께하기 + 넓히기(새 섬·글라이더·낮과 밤·꾸미기)
(() => {
'use strict';

// ================= 기본 설정 =================
const { R, SPAWN, MERCHANT, SHOP_RANGE, rng, islandH, groundAt, MONSTERS, MONSTER_KINDS, WEAPONS, UNLOCK, KEYS, ITEMS, ITEM_IDS, SHOP_ITEMS, BAG_SLOTS, needXp } = ARCA;
const { ISLANDS, UPDRAFTS, UPDRAFT_TOP, DECOS } = ARCA;
const LAYOUT = ARCA.buildLayout();
const GLIDE_SPEED = 13, GLIDE_FALL = 4;
const WALK = 6, RUN = 10.5, GRAV = 26, JUMP = 9.5, DASH_SPEED = 34, DASH_TIME = 0.2;
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#f8f9fa'];
const ANIM = { idle: 0, walk: 1, run: 2, air: 3, wave: 4, dance: 5, sit: 6, attack: 7, spin: 8, dead: 9, cast: 10, guard: 11, glide: 12 };
const EMOJI = { 1: '👋', 2: '💃', 3: '🪑' };

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 못 해도 괜찮음 */ } },
};
const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

// ================= 3D 화면 준비 =================
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe3ff, 130, 340);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 800);

const hemi = new THREE.HemisphereLight(0xe3f3ff, 0x6f8f4e, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 0.95);
sun.position.set(45, 90, 35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -72, right: 72, top: 72, bottom: -72, near: 10, far: 220 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const mats = {};
function mat(color, opts) {
  const key = color + JSON.stringify(opts || {});
  if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.92, metalness: 0 }, opts));
  return mats[key];
}
function mesh(geo, color, opts, shadow = true) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

// 하늘 (위는 파랗고 아래는 밝게)
let skyMat, stars;
{
  const g = new THREE.SphereGeometry(600, 24, 16);
  const pos = g.attributes.position, cols = [];
  const top = new THREE.Color(0x5aa9ff), mid = new THREE.Color(0xbfe3ff), bot = new THREE.Color(0xf3f8ff);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 600, c = new THREE.Color();
    if (y > 0) c.copy(mid).lerp(top, Math.min(1, y * 1.6)); else c.copy(mid).lerp(bot, Math.min(1, -y * 2));
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  scene.add(new THREE.Mesh(g, skyMat));
  // 별 (밤에만 보임)
  const sp = [], sr = rng(31);
  for (let i = 0; i < 350; i++) { const a = sr() * Math.PI * 2, e = 0.08 + sr() * 1.4; sp.push(Math.cos(a) * Math.cos(e) * 560, Math.sin(e) * 560, Math.sin(a) * Math.cos(e) * 560); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);
}

// ================= 섬 만들기 =================
const obstacles = LAYOUT.obstacles;   // 부딪히는 물건들 (서버와 같은 목록)
const houses = LAYOUT.houses;
const rand = rng(99);                 // 꽃·구름 같은 꾸밈용

// 섬 윗면(풀밭)
{
  const g = new THREE.PlaneGeometry(R * 2 + 2, R * 2 + 2, 120, 120).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, cols = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > R) { x *= R / r; z *= R / r; pos.setX(i, x); pos.setZ(i, z); }
    pos.setY(i, islandH(x, z));
  }
  for (let i = 0; i < pos.count; i += 3) { // 삼각형 하나씩 같은 색 → 로우폴리 느낌
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, r = Math.hypot(x, z);
    const n = Math.sin(x * 0.9 + z * 1.7) * 0.5 + Math.sin(x * 2.3 - z * 1.1) * 0.5;
    if (r < 12.5) c.set(((Math.floor(x / 2) + Math.floor(z / 2)) & 1) ? 0xc9b48a : 0xbca67c);
    else if (r < 14) c.set(0xa89068);
    else { c.setHSL(0.27 + n * 0.02, 0.5, 0.42 + n * 0.04 + Math.min(0.12, (y - 2) * 0.012)); }
    if (r > R - 2.5) c.setHSL(0.26, 0.42, 0.34);
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const top = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  top.receiveShadow = true;
  scene.add(top);
}

// 섬 아래 바위 덩어리
function rockBottom(radius, depth, seed, topY) {
  const r = rng(seed);
  const g = new THREE.ConeGeometry(radius, depth, 22, 5, true).toNonIndexed();
  g.rotateX(Math.PI);
  const pos = g.attributes.position, cols = [], c = new THREE.Color();
  const key = (x, y, z) => `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`, jit = {};
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = key(x, y, z);
    if (!jit[k]) { const t = (y + depth / 2) / depth; jit[k] = y > depth / 2 - 0.01 ? [1, 0] : [0.82 + r() * 0.3, (r() - 0.5) * depth * 0.08 * (1 - t)]; }
    pos.setX(i, x * jit[k][0]); pos.setZ(i, z * jit[k][0]); pos.setY(i, y + jit[k][1]);
  }
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + depth / 2) / depth;
    c.setHSL(0.07 + r() * 0.03, 0.22, 0.24 + y * 0.18 + r() * 0.05);
    if (y > 0.93) c.setHSL(0.25, 0.4, 0.3);
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  m.position.y = topY - depth / 2;
  m.castShadow = true;
  return m;
}
scene.add(rockBottom(R, 48, 7, 0.75));

// 광장 분수
let fountainOrb;
{
  const f = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.8, 12), '#b9b2a3'); base.position.y = 0.4;
  const water = mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.1, 12), '#5fc1ff', { roughness: 0.2, transparent: true, opacity: 0.85 }, false); water.position.y = 0.75;
  const pillar = mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 8), '#cfc7b6'); pillar.position.y = 1.5;
  const bowl = mesh(new THREE.CylinderGeometry(1.2, 0.4, 0.5, 10), '#cfc7b6'); bowl.position.y = 2.6;
  fountainOrb = mesh(new THREE.IcosahedronGeometry(0.55, 0), '#9be7ff', { emissive: '#3aa8ff', emissiveIntensity: 0.6, roughness: 0.3 }); fountainOrb.position.y = 3.4;
  f.add(base, water, pillar, bowl, fountainOrb);
  f.position.set(0, islandH(0, 0), 0);
  scene.add(f);
}

// 집
houses.forEach(({ x, z, color }) => {
  const y = Math.min(islandH(x, z), islandH(x + 2.5, z + 2.5), islandH(x - 2.5, z - 2.5), islandH(x + 2.5, z - 2.5), islandH(x - 2.5, z + 2.5));
  const h = new THREE.Group();
  const wall = mesh(new THREE.BoxGeometry(5, 4.2, 5), '#f4e7cf'); wall.position.y = 1.6;
  const roof = mesh(new THREE.ConeGeometry(4.4, 2.8, 4), color); roof.position.y = 5.1; roof.rotation.y = Math.PI / 4;
  const door = mesh(new THREE.BoxGeometry(1.2, 2, 0.15), '#7a4b2a'); door.position.set(0, 1.7, 2.52);
  const w1 = mesh(new THREE.BoxGeometry(0.9, 0.9, 0.12), '#8fd3ff', { emissive: '#204060', emissiveIntensity: 0.3 }); w1.position.set(-1.6, 2.4, 2.52);
  const w2 = w1.clone(); w2.position.x = 1.6;
  const chim = mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), '#a0522d'); chim.position.set(1.3, 5.6, -0.8);
  h.add(wall, roof, door, w1, w2, chim);
  h.position.set(x, y - 0.5, z);
  h.rotation.y = Math.atan2(-x, -z);
  scene.add(h);
});

// 환영 팻말
{
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#c8955a'; ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#7a4b2a'; ctx.lineWidth = 16; ctx.strokeRect(8, 8, 496, 240);
  ctx.fillStyle = '#3b2412'; ctx.textAlign = 'center';
  ctx.font = 'bold 64px sans-serif'; ctx.fillText('🌿 포근언덕', 256, 110);
  ctx.font = '30px sans-serif'; ctx.fillText('숲에는 몬스터가 살아요. 조심!', 256, 180);
  const tex = new THREE.CanvasTexture(cv);
  const s = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  board.position.y = 2; board.castShadow = true;
  const back = mesh(new THREE.BoxGeometry(2.7, 1.4, 0.1), '#7a4b2a'); back.position.set(0, 2, -0.07);
  const post = mesh(new THREE.BoxGeometry(0.18, 2, 0.18), '#7a4b2a'); post.position.set(0, 1, -0.12);
  s.add(board, back, post);
  s.position.set(5.5, islandH(5.5, 4), 4);
  s.rotation.y = -0.35;
  scene.add(s);
}

// 나무와 바위
function makeTree(s, pine, seedX, seedZ) {
  const t = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.18 * s, 0.28 * s, 1.6 * s, 6), '#8b5a2b'); trunk.position.y = 0.8 * s;
  t.add(trunk);
  const greens = ['#2f9e44', '#37b24d', '#40c057', '#2b8a3e'];
  if (pine) {
    for (let k = 0; k < 3; k++) {
      const cone = mesh(new THREE.ConeGeometry((1.5 - k * 0.35) * s, 1.7 * s, 7), greens[(k + Math.floor(seedX)) & 3]);
      cone.position.y = (1.7 + k * 0.9) * s; t.add(cone);
    }
  } else {
    const puff = mesh(new THREE.IcosahedronGeometry(1.4 * s, 0), greens[Math.abs(Math.floor(seedZ)) & 3]); puff.position.y = 2.4 * s;
    const puff2 = mesh(new THREE.IcosahedronGeometry(0.9 * s, 0), greens[(Math.abs(Math.floor(seedX)) + 1) & 3]); puff2.position.set(0.7 * s, 2.0 * s, 0.4 * s);
    t.add(puff, puff2);
  }
  t.rotation.y = seedX * 7.1;
  return t;
}
for (const tr of LAYOUT.trees) { const t = makeTree(tr.s, tr.pine, tr.x, tr.z); t.position.set(tr.x, islandH(tr.x, tr.z) - 0.1, tr.z); scene.add(t); }
for (const rk of LAYOUT.rocks) {
  const rock = mesh(new THREE.DodecahedronGeometry(rk.s, 0), rk.gray ? '#9a9a92' : '#868e96');
  rock.position.set(rk.x, islandH(rk.x, rk.z) + rk.s * 0.35, rk.z);
  rock.rotation.set(...rk.rot);
  rock.scale.y = 0.7;
  scene.add(rock);
}
// 꽃 (InstancedMesh 로 가볍게)
{
  const N = 260, geo = new THREE.IcosahedronGeometry(0.16, 0);
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 }), N);
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), fc = ['#ffffff', '#ffd43b', '#ff8787', '#da77f2', '#74c0fc'];
  for (let i = 0; i < N; i++) {
    const a = rand() * Math.PI * 2, r = 14 + rand() * (R - 17), x = Math.cos(a) * r, z = Math.sin(a) * r;
    m4.makeTranslation(x, islandH(x, z) + 0.12, z);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, col.set(fc[i % fc.length]));
  }
  scene.add(inst);
}

// 멀리 떠 있는 작은 섬들
// ---------- 버섯숲 섬 ----------
{
  const I = ISLANDS[1];
  const g = new THREE.PlaneGeometry(I.R * 2 + 2, I.R * 2 + 2, 64, 64).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, cols = [], c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > I.R) { x *= I.R / r; z *= I.R / r; }
    pos.setX(i, x + I.x); pos.setZ(i, z + I.z);
    pos.setY(i, islandH(x + I.x, z + I.z));
  }
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3 - I.x, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3 - I.z;
    const n = Math.sin(x * 1.1 + z * 1.9) * 0.5 + Math.sin(x * 2.7 - z * 1.3) * 0.5;
    c.setHSL(0.47 + n * 0.04, 0.38, 0.3 + n * 0.04);
    if (Math.hypot(x, z) > I.R - 2.5) c.setHSL(0.75, 0.25, 0.25);
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const top = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  top.receiveShadow = true;
  const bottom = rockBottom(I.R, 30, 11, 0.9); bottom.position.x = I.x; bottom.position.z = I.z;
  scene.add(top, bottom);
  const caps = ['#e64980', '#be4bdb', '#f76707', '#15aabf'];
  for (const sh of LAYOUT.shrooms) { // 큰 버섯 나무
    const t = new THREE.Group(), s_ = sh.s;
    const stem = mesh(new THREE.CylinderGeometry(0.3 * s_, 0.45 * s_, 2.8 * s_, 7), '#f1e9d2'); stem.position.y = 1.4 * s_;
    const cap = mesh(new THREE.SphereGeometry(1.9 * s_, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), caps[sh.c], { emissive: caps[sh.c], emissiveIntensity: 0.3 }); cap.position.y = 2.6 * s_; cap.scale.y = 0.6;
    t.add(stem, cap);
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + sh.x; const d = mesh(new THREE.SphereGeometry(0.2 * s_, 5, 4), '#fff9db', { emissive: '#ffe066', emissiveIntensity: 0.6 }, false); d.position.set(Math.cos(a) * 1.2 * s_, 3.25 * s_, Math.sin(a) * 1.2 * s_); t.add(d); }
    t.position.set(sh.x, islandH(sh.x, sh.z) - 0.1, sh.z);
    scene.add(t);
  }
}
// ---------- 서리봉우리 섬 ----------
{
  const I = ISLANDS[2];
  const g = new THREE.PlaneGeometry(I.R * 2 + 2, I.R * 2 + 2, 70, 70).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, cols = [], c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > I.R) { x *= I.R / r; z *= I.R / r; }
    pos.setX(i, x + I.x); pos.setZ(i, z + I.z);
    pos.setY(i, islandH(x + I.x, z + I.z));
  }
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3 - I.x, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3 - I.z;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const n = Math.sin(x * 1.3 + z * 1.7) * 0.5 + Math.sin(x * 2.9 - z * 1.1) * 0.5;
    if (n > 0.55 && y < 6) c.setHSL(0.56, 0.55, 0.78); // 군데군데 얼음판
    else c.setHSL(0.58, 0.25, 0.9 + n * 0.04);
    if (y > 9) c.setHSL(0.6, 0.2, 0.82);
    if (Math.hypot(x, z) > I.R - 2.5) c.setHSL(0.6, 0.2, 0.6);
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const top = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 }));
  top.receiveShadow = true;
  const bottom = rockBottom(I.R, 34, 12, 0.9); bottom.position.x = I.x; bottom.position.z = I.z;
  scene.add(top, bottom);
  for (const t of LAYOUT.frostTrees) { // 눈 덮인 나무
    const g2 = new THREE.Group(), s_ = t.s;
    const trunk = mesh(new THREE.CylinderGeometry(0.16 * s_, 0.26 * s_, 1.4 * s_, 6), '#6b4a2f'); trunk.position.y = 0.7 * s_; g2.add(trunk);
    for (let k = 0; k < 3; k++) {
      const cone = mesh(new THREE.ConeGeometry((1.4 - k * 0.35) * s_, 1.6 * s_, 7), k === 2 ? '#f8f9fa' : '#2f6f5e'); cone.position.y = (1.5 + k * 0.85) * s_; g2.add(cone);
      const snow = mesh(new THREE.ConeGeometry((1.0 - k * 0.25) * s_, 0.7 * s_, 7), '#ffffff'); snow.position.y = (1.95 + k * 0.85) * s_; g2.add(snow);
    }
    g2.position.set(t.x, islandH(t.x, t.z) - 0.1, t.z); g2.rotation.y = t.x; scene.add(g2);
  }
  for (const rk of LAYOUT.iceRocks) { // 얼음 바위
    const ice = mesh(new THREE.OctahedronGeometry(rk.s * 1.1, 0), '#a5d8ff', { transparent: true, opacity: 0.8, roughness: 0.15, metalness: 0.1, emissive: '#1c7ed6', emissiveIntensity: 0.15 });
    ice.position.set(rk.x, islandH(rk.x, rk.z) + rk.s * 0.5, rk.z); ice.rotation.set(0.3, rk.x, 0.2); ice.scale.y = 1.5; scene.add(ice);
  }
}
// 서리봉우리에 있을 때 내리는 눈
const snowFx = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false }));
{
  const pts = []; for (let i = 0; i < 500; i++) pts.push((Math.random() - 0.5) * 50, Math.random() * 22, (Math.random() - 0.5) * 50);
  snowFx.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  snowFx.visible = false; snowFx.frustumCulled = false; scene.add(snowFx);
}
// ---------- 바람 기둥 ----------
const updraftFx = [];
for (const u of UPDRAFTS) {
  const y0 = islandH(u.x, u.z);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(u.r, u.r, UPDRAFT_TOP, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
  col.position.set(u.x, y0 + UPDRAFT_TOP / 2, u.z); scene.add(col);
  for (let k = 0; k < 5; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(u.r * 0.8, 0.09, 5, 24), new THREE.MeshBasicMaterial({ color: 0xc5f6fa, transparent: true, opacity: 0.6, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; ring.position.set(u.x, y0, u.z); scene.add(ring);
    updraftFx.push({ ring, y0, off: k / 5 });
  }
}

const farIslands = [];
for (let i = 0; i < 7; i++) {
  const a = (i / 7) * Math.PI * 2 + 0.4, d = 120 + rand() * 60;
  const g = new THREE.Group(), rad = 8 + rand() * 9;
  const grass = mesh(new THREE.CylinderGeometry(rad, rad * 0.96, 1.2, 14), '#51cf66');
  g.add(grass, rockBottom(rad * 0.97, rad * 2.2, 100 + i, -0.5));
  for (let k = 0; k < 3; k++) { const x = (rand() - 0.5) * rad, z = (rand() - 0.5) * rad; const t = makeTree(0.9 + rand() * 0.6, rand() < 0.5, x, z); t.position.set(x, 0.5, z); g.add(t); }
  g.position.set(Math.cos(a) * d, -15 + rand() * 40, Math.sin(a) * d);
  g.userData.baseY = g.position.y; g.userData.phase = rand() * 6;
  if (ISLANDS.some((I) => I.id && Math.hypot(g.position.x - I.x, g.position.z - I.z) < I.R + rad + 12)) continue; // 다른 섬과 겹치면 뺌
  scene.add(g); farIslands.push(g);
}
// 구름
const clouds = [];
for (let i = 0; i < 46; i++) {
  const c = new THREE.Group(), n = 3 + Math.floor(rand() * 4);
  for (let k = 0; k < n; k++) {
    const s = 3 + rand() * 5;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mat('#ffffff', { roughness: 1, transparent: true, opacity: 0.92 }));
    puff.position.set(k * 4 - n * 2, rand() * 2, (rand() - 0.5) * 5);
    c.add(puff);
  }
  const below = i < 30;
  c.position.set((rand() - 0.5) * 500, below ? -55 + rand() * 35 : 35 + rand() * 40, (rand() - 0.5) * 500);
  c.userData.speed = 1 + rand() * 2;
  scene.add(c); clouds.push(c);
}

// ================= 캐릭터 =================
function makeAvatar(color, hat) {
  const g = new THREE.Group(), body = new THREE.Group();
  const darker = new THREE.Color(color).multiplyScalar(0.75).getStyle();
  const torso = mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.9, 8), color); torso.position.y = 0.95;
  const pack = mesh(new THREE.BoxGeometry(0.55, 0.6, 0.3), '#a0723a'); pack.position.set(0, 1.0, -0.45);
  const head = mesh(new THREE.SphereGeometry(0.38, 12, 10), '#ffd8b0'); head.position.y = 1.75;
  const eyeL = mesh(new THREE.SphereGeometry(0.05, 6, 6), '#222', null, false); eyeL.position.set(-0.13, 1.8, 0.34);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.13;
  const cheekL = mesh(new THREE.SphereGeometry(0.06, 6, 6), '#ff9aa2', null, false); cheekL.position.set(-0.22, 1.68, 0.3);
  const cheekR = cheekL.clone(); cheekR.position.x = 0.22;
  body.add(torso, pack, head, eyeL, eyeR, cheekL, cheekR);

  const limb = (len, rad, c) => { const p = new THREE.Group(); const m = mesh(new THREE.CylinderGeometry(rad, rad * 0.9, len, 6), c); m.position.y = -len / 2; p.add(m); return p; };
  const armL = limb(0.62, 0.11, darker); armL.position.set(-0.52, 1.32, 0);
  const armR = limb(0.62, 0.11, darker); armR.position.set(0.52, 1.32, 0);
  [armL, armR].forEach((a) => { const hnd = mesh(new THREE.SphereGeometry(0.12, 6, 6), '#ffd8b0'); hnd.position.y = -0.66; a.add(hnd); });
  // 손에 드는 무기 자리
  const holdR = new THREE.Group(); holdR.position.y = -0.68; armR.add(holdR);
  const holdL = new THREE.Group(); holdL.position.y = -0.66; armL.add(holdL);
  const legL = limb(0.52, 0.13, '#3b4a6b'); legL.position.set(-0.2, 0.52, 0);
  const legR = limb(0.52, 0.13, '#3b4a6b'); legR.position.set(0.2, 0.52, 0);
  body.add(armL, armR, legL, legR);

  if (hat === 1) { const h = mesh(new THREE.ConeGeometry(0.28, 0.6, 8), '#ffe066'); h.position.y = 2.32; h.rotation.z = 0.15; body.add(h); }
  if (hat === 2) {
    const brim = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 12), '#e9c46a'); brim.position.y = 2.05;
    const crown = mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.28, 10), '#e9c46a'); crown.position.y = 2.2;
    const band = mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.07, 10), '#e63946'); band.position.y = 2.12;
    body.add(brim, crown, band);
  }
  if (hat === 3) {
    const ring = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 10, 1, true), '#fcc419', { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }); ring.position.y = 2.1;
    body.add(ring);
    for (let k = 0; k < 5; k++) { const sp = mesh(new THREE.ConeGeometry(0.07, 0.18, 4), '#fcc419', { metalness: 0.6, roughness: 0.3 }); const a = k / 5 * Math.PI * 2; sp.position.set(Math.cos(a) * 0.28, 2.27, Math.sin(a) * 0.28); body.add(sp); }
  }
  g.add(body);
  const glider = new THREE.Group();
  const wing = mesh(new THREE.BoxGeometry(3.6, 0.06, 1.2), color); wing.position.z = -0.1;
  const tipL = mesh(new THREE.BoxGeometry(0.9, 0.06, 0.8), '#f8f9fa'); tipL.position.set(-2.1, -0.12, -0.2); tipL.rotation.z = 0.3;
  const tipR = tipL.clone(); tipR.position.x = 2.1; tipR.rotation.z = -0.3;
  const bar = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 4), '#7a4b2a'); bar.rotation.z = Math.PI / 2; bar.position.y = -0.35;
  glider.add(wing, tipL, tipR, bar); glider.position.y = 2.75; glider.visible = false;
  g.add(glider);
  g.userData = { body, armL, armR, legL, legR, holdR, holdL, glider, weapon: '', t: Math.random() * 10, lastA: 0, actT: 0 };
  setWeapon(g, 'sword');
  return g;
}
function setWeapon(av, w) {
  const u = av.userData;
  if (!WEAPONS[w] || u.weapon === w) return;
  u.weapon = w;
  u.holdR.clear(); u.holdL.clear();
  const R_ = u.holdR, L_ = u.holdL;
  if (w === 'sword') {
    const grip = mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), '#6b3f1f'); grip.position.z = 0.05;
    const guard = mesh(new THREE.BoxGeometry(0.34, 0.07, 0.07), '#c9a227', { metalness: 0.5, roughness: 0.4 }); guard.position.z = 0.22;
    const blade = mesh(new THREE.BoxGeometry(0.1, 0.035, 0.95), '#e9ecef', { metalness: 0.7, roughness: 0.25 }); blade.position.z = 0.72;
    R_.add(grip, guard, blade);
  } else if (w === 'bow') {
    const bow = new THREE.Group(), inner = new THREE.Group();
    const arc = mesh(new THREE.TorusGeometry(0.55, 0.045, 5, 14, Math.PI), '#8b5a2b');
    const str = mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.1, 4), '#f1f3f5', null, false); str.rotation.z = Math.PI / 2;
    inner.add(arc, str); inner.rotation.z = Math.PI / 2;
    bow.add(inner); bow.rotation.y = Math.PI / 2; bow.position.z = -0.5;
    R_.add(bow);
    const quiver = mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.6, 7), '#7a4b2a'); quiver.position.set(0.25, 1.1, -0.5); quiver.rotation.z = -0.4;
    av.userData.body.add(quiver); u.extra && av.userData.body.remove(u.extra); u.extra = quiver;
    return;
  } else if (w === 'staff') {
    const pole = mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.7, 6), '#7a4b2a'); pole.position.y = 0.25;
    const gem = mesh(new THREE.IcosahedronGeometry(0.17, 0), '#b197fc', { emissive: '#7048e8', emissiveIntensity: 0.8, roughness: 0.3 }); gem.position.y = 1.18;
    R_.add(pole, gem);
  } else if (w === 'hammer') {
    const handle = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.9, 6), '#6b3f1f'); handle.rotation.x = Math.PI / 2; handle.position.z = 0.35;
    const head = mesh(new THREE.BoxGeometry(0.32, 0.55, 0.32), '#868e96', { metalness: 0.4, roughness: 0.5 }); head.position.z = 0.82;
    R_.add(handle, head);
    const shield = mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 10), '#c92a2a'); shield.rotation.z = Math.PI / 2; shield.position.set(-0.14, 0.1, 0);
    const boss = mesh(new THREE.SphereGeometry(0.12, 6, 5), '#fcc419', { metalness: 0.6, roughness: 0.3 }); boss.position.set(-0.2, 0.1, 0);
    L_.add(shield, boss);
  } else if (w === 'lantern') {
    const hook = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 4), '#495057'); hook.position.y = -0.12;
    const frame = mesh(new THREE.BoxGeometry(0.26, 0.32, 0.26), '#495057', { transparent: true, opacity: 0.35 }); frame.position.y = -0.4;
    const glow = mesh(new THREE.IcosahedronGeometry(0.11, 0), '#fff3bf', { emissive: '#ffd43b', emissiveIntensity: 1.2 }, false); glow.position.y = -0.4;
    const capT = mesh(new THREE.ConeGeometry(0.2, 0.14, 4), '#2f9e44'); capT.position.y = -0.18; capT.rotation.y = Math.PI / 4;
    R_.add(hook, frame, glow, capT);
  }
  if (u.extra) { u.body.remove(u.extra); u.extra = null; }
}
function animate(av, a, dt) {
  const u = av.userData; u.t += dt;
  if (a !== u.lastA) { u.actT = 0; u.lastA = a; }
  u.glider.visible = a === ANIM.glide;
  u.actT += dt;
  const t = u.t, { body, armL, armR, legL, legR } = u;
  let la = 0, ra = 0, ll = 0, rl = 0, by = 0, bry = 0, brx = 0, laz = 0, raz = 0, k = Math.min(1, dt * 14);
  if (a === ANIM.walk || a === ANIM.run) {
    const sp = a === ANIM.run ? 13 : 9, amp = a === ANIM.run ? 0.95 : 0.6;
    const s = Math.sin(t * sp) * amp;
    ll = s; rl = -s; la = -s * 0.9; ra = s * 0.9; by = Math.abs(Math.cos(t * sp)) * 0.08;
  } else if (a === ANIM.air) {
    la = -2.6; ra = -2.6; laz = -0.3; raz = 0.3; ll = 0.4; rl = -0.2;
  } else if (a === ANIM.wave) {
    ra = -2.8; raz = 0.4 + Math.sin(t * 10) * 0.4;
  } else if (a === ANIM.dance) {
    bry = Math.sin(t * 6) * 0.5; by = Math.abs(Math.sin(t * 6)) * 0.15;
    la = -2.4 + Math.sin(t * 6) * 0.5; ra = -2.4 - Math.sin(t * 6) * 0.5; ll = Math.sin(t * 6) * 0.3; rl = -ll;
  } else if (a === ANIM.sit) {
    by = -0.45; ll = -1.5; rl = -1.5; la = -0.4; ra = -0.4;
  } else if (a === ANIM.attack) { // 칼을 들었다가 내려 베기
    k = Math.min(1, dt * 30);
    if (u.actT < 0.09) { ra = -2.7; raz = 0.5; bry = 0.35; } else { ra = -0.2; raz = -0.6; bry = -0.4; }
    la = 0.4; ll = 0.3; rl = -0.3;
  } else if (a === ANIM.spin) { // 빙글빙글 회전베기
    k = 1; bry = u.actT * 28; ra = -1.55; raz = 0; la = -1.4; laz = -0.6;
  } else if (a === ANIM.glide) { // 글라이더에 매달리기
    la = -3.0; ra = -3.0; laz = -0.25; raz = 0.25; ll = 0.5 + Math.sin(t * 3) * 0.1; rl = 0.35 - Math.sin(t * 3) * 0.1; brx = 0.25;
  } else if (a === ANIM.cast) { // 앞으로 팔을 뻗어 쏘기
    k = Math.min(1, dt * 25); ra = -1.55; la = u.weapon === 'bow' ? -1.4 : 0.2; laz = u.weapon === 'bow' ? -0.5 : 0; bry = -0.1;
  } else if (a === ANIM.guard) { // 방패 들기
    la = -1.4; laz = 0.7; ra = -0.4; ll = 0.25; rl = -0.25; by = -0.08;
  } else if (a === ANIM.dead) {
    brx = -1.45; by = 0.35; la = -2.8; ra = -2.8; k = Math.min(1, dt * 6);
  } else {
    by = Math.sin(t * 2) * 0.02; la = Math.sin(t * 2) * 0.05; ra = -la;
  }
  body.position.y += (by - body.position.y) * k;
  if (a === ANIM.spin) body.rotation.y = bry; else body.rotation.y = lerpAngle(body.rotation.y % (Math.PI * 2), bry, k);
  body.rotation.x += (brx - body.rotation.x) * k;
  armL.rotation.x += (la - armL.rotation.x) * k; armR.rotation.x += (ra - armR.rotation.x) * k;
  armL.rotation.z += (laz - armL.rotation.z) * k; armR.rotation.z += (raz - armR.rotation.z) * k;
  legL.rotation.x += (ll - legL.rotation.x) * k; legR.rotation.x += (rl - legR.rotation.x) * k;
}

// ================= 몬스터 모양 =================
function monsterMesh(geo, color, list, opts) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.8 }, opts)));
  m.castShadow = true; list.push(m.material);
  return m;
}
function makeMonster(kind) {
  const g = new THREE.Group(), body = new THREE.Group(), mats = [];
  const eye = (x, y, z, s = 1) => { const e = monsterMesh(new THREE.SphereGeometry(0.09 * s, 6, 6), '#1d1d1d', mats); e.position.set(x, y, z); return e; };
  if (kind === 'slime') {
    const blob = monsterMesh(new THREE.SphereGeometry(0.75, 12, 9), '#63e66d', mats, { transparent: true, opacity: 0.88, roughness: 0.3 });
    blob.scale.y = 0.75; blob.position.y = 0.55;
    const shine = monsterMesh(new THREE.SphereGeometry(0.16, 6, 6), '#ffffff', mats, { transparent: true, opacity: 0.7 }); shine.position.set(-0.3, 0.9, 0.35);
    body.add(blob, shine, eye(-0.22, 0.7, 0.62), eye(0.22, 0.7, 0.62));
  } else if (kind === 'shroom') {
    const stem = monsterMesh(new THREE.CylinderGeometry(0.42, 0.5, 1.0, 9), '#f8f0dc', mats); stem.position.y = 0.6;
    const cap = monsterMesh(new THREE.SphereGeometry(1.0, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#e03131', mats); cap.position.y = 1.05; cap.scale.y = 0.75;
    body.add(stem, cap, eye(-0.17, 0.78, 0.42), eye(0.17, 0.78, 0.42));
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const d = monsterMesh(new THREE.SphereGeometry(0.13, 6, 5), '#ffffff', mats); d.position.set(Math.cos(a) * 0.62, 1.42, Math.sin(a) * 0.62); body.add(d); }
    const top = monsterMesh(new THREE.SphereGeometry(0.15, 6, 5), '#ffffff', mats); top.position.y = 1.78; body.add(top);
    [-0.25, 0.25].forEach((x) => { const f = monsterMesh(new THREE.SphereGeometry(0.18, 6, 5), '#d9c9a8', mats); f.position.set(x, 0.1, 0.1); f.scale.y = 0.6; body.add(f); });
  } else if (kind === 'yeti') { // 서리봉우리: 눈덩이 도깨비 (눈사람처럼 생김)
    const lo = monsterMesh(new THREE.SphereGeometry(0.85, 10, 8), '#f1f3f5', mats); lo.position.y = 0.8;
    const hi = monsterMesh(new THREE.SphereGeometry(0.6, 10, 8), '#ffffff', mats); hi.position.y = 1.9;
    const horn1 = monsterMesh(new THREE.ConeGeometry(0.12, 0.45, 5), '#74c0fc', mats); horn1.position.set(-0.3, 2.45, 0); horn1.rotation.z = 0.4;
    const horn2 = horn1.clone(); horn2.position.x = 0.3; horn2.rotation.z = -0.4;
    const nose = monsterMesh(new THREE.ConeGeometry(0.09, 0.4, 5), '#ff922b', mats); nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.85, 0.7);
    body.add(lo, hi, horn1, horn2, nose, eye(-0.2, 2.02, 0.52, 1.1), eye(0.2, 2.02, 0.52, 1.1));
    [-1, 1].forEach((x) => { const arm = monsterMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 5), '#6b4a2f', mats); arm.position.set(x * 0.95, 1.3, 0); arm.rotation.z = x * 1.0; body.add(arm); });
  } else if (kind === 'wolf') { // 서리봉우리: 서리 늑대
    const torso = monsterMesh(new THREE.BoxGeometry(0.7, 0.7, 1.6), '#ced4da', mats); torso.position.y = 0.9;
    const head = monsterMesh(new THREE.BoxGeometry(0.55, 0.55, 0.6), '#dee2e6', mats); head.position.set(0, 1.25, 0.95);
    const snout = monsterMesh(new THREE.BoxGeometry(0.28, 0.24, 0.4), '#adb5bd', mats); snout.position.set(0, 1.12, 1.38);
    const tail = monsterMesh(new THREE.ConeGeometry(0.16, 0.8, 5), '#f1f3f5', mats); tail.position.set(0, 1.15, -1.05); tail.rotation.x = -1.0;
    body.add(torso, head, snout, tail, eye(-0.17, 1.38, 1.26), eye(0.17, 1.38, 1.26));
    [-0.2, 0.2].forEach((x) => { const ear = monsterMesh(new THREE.ConeGeometry(0.12, 0.3, 4), '#74c0fc', mats); ear.position.set(x, 1.65, 0.85); body.add(ear); });
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([x, z]) => { const l = monsterMesh(new THREE.CylinderGeometry(0.11, 0.09, 0.6, 5), '#adb5bd', mats); l.position.set(x * 0.25, 0.3, z * 0.6); body.add(l); });
  } else if (kind === 'giant') { // 서리봉우리 꼭대기: 서리 거인
    const torso = monsterMesh(new THREE.DodecahedronGeometry(1.5, 0), '#a5d8ff', mats, { roughness: 0.3 }); torso.position.y = 2.6; torso.scale.set(1, 1.2, 0.8);
    const head = monsterMesh(new THREE.IcosahedronGeometry(0.7, 0), '#d0ebff', mats, { roughness: 0.3 }); head.position.y = 4.6;
    const crown = [0, 1, 2].map((i) => { const sp = monsterMesh(new THREE.ConeGeometry(0.18, 0.8, 4), '#4dabf7', mats, { emissive: '#1c7ed6', emissiveIntensity: 0.5 }); sp.position.set((i - 1) * 0.4, 5.4 - Math.abs(i - 1) * 0.15, 0); return sp; });
    const gem = monsterMesh(new THREE.OctahedronGeometry(0.4, 0), '#e7f5ff', mats, { emissive: '#74c0fc', emissiveIntensity: 1 }); gem.position.set(0, 2.9, 1.15);
    body.add(torso, head, ...crown, gem, eye(-0.25, 4.7, 0.6, 1.6), eye(0.25, 4.7, 0.6, 1.6));
    [-1, 1].forEach((x) => { const arm = monsterMesh(new THREE.BoxGeometry(0.7, 2.6, 0.7), '#74c0fc', mats, { roughness: 0.3 }); arm.position.set(x * 1.9, 2.3, 0); const leg = monsterMesh(new THREE.BoxGeometry(0.8, 1.4, 0.8), '#74c0fc', mats, { roughness: 0.3 }); leg.position.set(x * 0.7, 0.7, 0); body.add(arm, leg); });
  } else if (kind === 'toad') { // 버섯숲: 독버섯 두꺼비
    const belly = monsterMesh(new THREE.SphereGeometry(0.85, 10, 8), '#74b816', mats); belly.position.y = 0.65; belly.scale.set(1.1, 0.8, 1);
    const cap = monsterMesh(new THREE.SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#9c36b5', mats); cap.position.y = 1.05; cap.scale.y = 0.6;
    body.add(belly, cap, eye(-0.3, 0.95, 0.72, 1.3), eye(0.3, 0.95, 0.72, 1.3));
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const d = monsterMesh(new THREE.SphereGeometry(0.14, 6, 5), '#ffe066', mats); d.position.set(Math.cos(a) * 0.7, 1.52, Math.sin(a) * 0.7); body.add(d); }
    [-0.6, 0.6].forEach((x) => { const f = monsterMesh(new THREE.SphereGeometry(0.28, 6, 5), '#5c940d', mats); f.position.set(x, 0.15, 0.45); f.scale.y = 0.6; body.add(f); });
  } else if (kind === 'wisp') { // 버섯숲: 숲의 정령 (떠다니는 빛)
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshBasicMaterial({ color: 0xc3fae8 })); core.position.y = 1.5;
    const shell = monsterMesh(new THREE.IcosahedronGeometry(0.75, 0), '#38d9a9', mats, { transparent: true, opacity: 0.45, roughness: 0.2 }); shell.position.y = 1.5;
    body.add(core, shell, eye(-0.17, 1.58, 0.4), eye(0.17, 1.58, 0.4));
    [-1, 1].forEach((sd) => { const leaf = monsterMesh(new THREE.ConeGeometry(0.22, 0.9, 4), '#2f9e44', mats); leaf.position.set(sd * 0.85, 1.55, -0.1); leaf.rotation.z = sd * -1.2; body.add(leaf); });
    g.userData.float = true;
  } else if (kind === 'golem') { // 월드 보스: 큰 바위 거인
    const glow = (geo, x, y, z) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x66e3ff })); m.position.set(x, y, z); return m; };
    const torso = monsterMesh(new THREE.DodecahedronGeometry(1.7, 0), '#6c6480', mats); torso.position.y = 2.9; torso.scale.set(1.15, 1, 0.9);
    const hip = monsterMesh(new THREE.DodecahedronGeometry(1.0, 0), '#5a536b', mats); hip.position.y = 1.7;
    const head = monsterMesh(new THREE.BoxGeometry(1.1, 1.0, 1.0), '#7d7594', mats); head.position.y = 4.75;
    const horn = monsterMesh(new THREE.ConeGeometry(0.25, 0.9, 5), '#b197fc', mats); horn.position.set(0, 5.6, 0);
    body.add(torso, hip, head, horn, glow(new THREE.IcosahedronGeometry(0.5, 0), 0, 3.0, 1.35), glow(new THREE.SphereGeometry(0.13, 6, 6), -0.26, 4.85, 0.52), glow(new THREE.SphereGeometry(0.13, 6, 6), 0.26, 4.85, 0.52));
    [-0.8, 0.8].forEach((x) => { const l = monsterMesh(new THREE.BoxGeometry(0.9, 1.6, 0.9), '#5a536b', mats); l.position.set(x, 0.8, 0); body.add(l); });
    const arms = [-1, 1].map((sd) => {
      const a = new THREE.Group(); a.position.set(sd * 2.1, 3.7, 0);
      const sh = monsterMesh(new THREE.DodecahedronGeometry(0.75, 0), '#7d7594', mats);
      const fore = monsterMesh(new THREE.BoxGeometry(0.8, 2.3, 0.8), '#6c6480', mats); fore.position.y = -1.4;
      const fist = monsterMesh(new THREE.DodecahedronGeometry(0.7, 0), '#8a82a3', mats); fist.position.y = -2.7;
      a.add(sh, fore, fist); body.add(a); return a;
    });
    g.userData.arms = arms;
  } else { // turtle
    const shell = monsterMesh(new THREE.DodecahedronGeometry(1.5, 0), '#5c7a3a', mats); shell.position.y = 1.2; shell.scale.set(1, 0.65, 1.15);
    const moss = monsterMesh(new THREE.DodecahedronGeometry(0.9, 0), '#82c91e', mats); moss.position.set(0.2, 1.95, -0.2); moss.scale.y = 0.5;
    const rock = monsterMesh(new THREE.DodecahedronGeometry(0.5, 0), '#868e96', mats); rock.position.set(-0.5, 2.0, 0.3);
    const head = monsterMesh(new THREE.SphereGeometry(0.55, 9, 7), '#8f9c5a', mats); head.position.set(0, 1.1, 1.75);
    body.add(shell, moss, rock, head, eye(-0.25, 1.3, 2.2, 1.4), eye(0.25, 1.3, 2.2, 1.4));
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([x, z]) => { const l = monsterMesh(new THREE.CylinderGeometry(0.35, 0.4, 0.8, 7), '#7a8a4a', mats); l.position.set(x * 1.0, 0.4, z * 0.9); body.add(l); });
  }
  g.add(body);
  g.userData = { body, mats, t: Math.random() * 10, flash: 0, arms: g.userData.arms, float: g.userData.float };
  return g;
}
function animateMonster(mo, dt) {
  const u = mo.av.userData; u.t += dt;
  const { body } = u, t = u.t;
  let sy = 1, sx = 1, by = 0, rx = 0;
  if (mo.kind === 'slime') {
    if (mo.st === 2) { sy = 0.62; sx = 1.25; } else if (mo.st === 1) { const b = Math.abs(Math.sin(t * 8)); by = b * 0.45; sy = 0.85 + b * 0.3; sx = 1.1 - b * 0.15; } else { sy = 1 + Math.sin(t * 3) * 0.05; sx = 1 - Math.sin(t * 3) * 0.04; }
  } else if (mo.kind === 'shroom' || mo.kind === 'toad') {
    if (mo.st === 2) { sy = 1.15 + Math.sin(t * 30) * 0.06; sx = 1.15; } else if (mo.st === 1) { by = Math.abs(Math.sin(t * 9)) * 0.18; rx = Math.sin(t * 9) * 0.1; }
  } else {
    if (mo.st === 2) rx = -0.35; else if (mo.st === 1) by = Math.abs(Math.sin(t * 4)) * 0.1;
  }
  if (u.float) { by = Math.sin(t * 2.5) * 0.25; rx = mo.st === 2 ? 0.5 : 0; if (mo.st === 2) { sx = 1.3; sy = 1.3; } }
  const k = Math.min(1, dt * 12);
  if (u.arms) { // 골렘: 공격 준비 때 두 팔을 번쩍
    const ax = mo.st === 2 ? -2.7 : mo.st === 1 ? Math.sin(t * 4) * 0.4 : Math.sin(t * 1.5) * 0.08;
    u.arms[0].rotation.x += (ax - u.arms[0].rotation.x) * k;
    u.arms[1].rotation.x += ((mo.st === 1 ? -ax : ax) - u.arms[1].rotation.x) * k;
  }
  body.scale.x += (sx - body.scale.x) * k; body.scale.z = body.scale.x;
  body.scale.y += (sy - body.scale.y) * k;
  body.position.y += (by - body.position.y) * k;
  body.rotation.x += (rx - body.rotation.x) * k;
  // 맞으면 하얗게 번쩍, 공격 준비 중이면 붉게
  const fl = u.flash > 0 ? (u.flash -= dt, 1) : 0;
  const warn = mo.st === 2 ? 0.35 + Math.sin(t * 20) * 0.25 : 0;
  for (const m of u.mats) {
    if (fl) m.emissive.setRGB(0.9, 0.9, 0.9); else if (mo.slow && !warn) m.emissive.setRGB(0, 0.18, 0.4); else m.emissive.setRGB(warn, 0, 0);
  }
}

// ================= 이름표 / 말풍선 / 숫자 =================
const tagLayer = $('tags');
function makeTag(name, opts = {}) {
  const el = document.createElement('div'); el.className = 'tag' + (opts.me ? ' me' : '') + (opts.mon ? ' mon' : '');
  const emo = document.createElement('span'); emo.className = 'emo'; emo.hidden = true;
  const bub = document.createElement('span'); bub.className = 'bub'; bub.hidden = true;
  const nm = document.createElement('span'); nm.className = 'nm';
  const lvl = document.createElement('span'); lvl.className = 'lvl';
  const txt = document.createElement('span'); txt.textContent = name;
  nm.append(lvl, txt);
  const hpb = document.createElement('span'); hpb.className = 'hpb'; hpb.hidden = !opts.mon;
  const hpi = document.createElement('i'); hpb.appendChild(hpi);
  const ttl = document.createElement('span'); ttl.className = 'ttl'; ttl.hidden = true;
  el.append(emo, bub, ttl, nm, hpb); tagLayer.appendChild(el);
  return { el, emo, bub, ttl, lvl, hpb, hpi, bubT: 0, emoT: 0, lv: 0, hp: 100 };
}
function setTagTitle(tag, text) { tag.ttl.textContent = text ? `〈${text}〉` : ''; tag.ttl.hidden = !text; }
function setTagLv(tag, lv) { if (tag.lv !== lv) { tag.lv = lv; tag.lvl.textContent = 'Lv' + lv; } }
function setTagHp(tag, hp, hideFull) {
  if (tag.hp === hp && !hideFull) return;
  tag.hp = hp; tag.hpi.style.width = hp + '%';
  if (hideFull) tag.hpb.hidden = hp >= 100;
}
function say(tag, text) { tag.bub.textContent = text; tag.bub.hidden = false; tag.bubT = 5; }
function emote(tag, e) { tag.emo.textContent = EMOJI[e] || ''; tag.emo.hidden = false; tag.emoT = 2; }
const v3 = new THREE.Vector3();
function placeTag(tag, obj, dt, h, maxDist = 75) {
  if (tag.bubT > 0 && (tag.bubT -= dt) <= 0) tag.bub.hidden = true;
  if (tag.emoT > 0 && (tag.emoT -= dt) <= 0) tag.emo.hidden = true;
  v3.set(obj.position.x, obj.position.y + h, obj.position.z);
  const dist = v3.distanceTo(camera.position);
  v3.project(camera);
  if (v3.z > 1 || dist > maxDist) { tag.el.style.display = 'none'; return; }
  tag.el.style.display = '';
  tag.el.style.left = ((v3.x + 1) / 2 * innerWidth).toFixed(1) + 'px';
  tag.el.style.top = ((1 - v3.y) / 2 * innerHeight).toFixed(1) + 'px';
  tag.el.style.opacity = dist > maxDist * 0.7 ? String(1 - (dist - maxDist * 0.7) / (maxDist * 0.3)) : '1';
}
const popLayer = $('pops');
function pop(text, x, y, z, cls) { // 떠오르는 숫자
  v3.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6).project(camera);
  if (v3.z > 1) return;
  const d = document.createElement('div'); d.className = 'pop ' + (cls || ''); d.textContent = text;
  d.style.left = ((v3.x + 1) / 2 * innerWidth) + 'px'; d.style.top = ((1 - v3.y) / 2 * innerHeight) + 'px';
  popLayer.appendChild(d);
  setTimeout(() => d.remove(), cls === 'lvup' ? 1700 : 950);
}

// ================= 효과 (빨간 경고 원, 칼 휘두르기 등) =================
const effects = [];
function addEffect(obj, dur, update, onEnd) { scene.add(obj); effects.push({ obj, t: 0, dur, update, onEnd }); }
function flatMat(color, opacity) { return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }); }
function groundTop(x, z, r) { let y = islandH(x, z); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; y = Math.max(y, groundAt(x + Math.cos(a) * r, z + Math.sin(a) * r)); } return y; }
function telegraph(x, z, r, ms) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.15, r, 40), flatMat(0xff2222, 0.8));
  const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40), flatMat(0xff3b3b, 0.28));
  ring.rotation.x = fill.rotation.x = -Math.PI / 2;
  g.add(ring, fill);
  g.position.set(x, groundTop(x, z, r) + 0.1, z);
  fill.scale.setScalar(0.01);
  addEffect(g, ms / 1000 + 0.1, (e, p) => { fill.scale.setScalar(Math.min(1, p * 1.08)); ring.material.opacity = 0.5 + Math.sin(e.t * 25) * 0.3; });
}
function projectile(from, to, w, onHit) { // 화살·마법 구슬이 날아가기
  const col = WEAPONS[w].color;
  const m = w === 'bow'
    ? new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), new THREE.MeshBasicMaterial({ color: 0x8b5a2b }))
    : new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshBasicMaterial({ color: col }));
  m.position.copy(from); m.lookAt(to);
  const d = from.distanceTo(to);
  addEffect(m, Math.max(0.08, d / 32), (e, p) => { m.position.lerpVectors(from, to, p); }, onHit);
}
function burst(x, z, r, color, dur = 0.45) { // 땅에 퍼지는 원
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), flatMat(color, 0.55));
  m.rotation.x = -Math.PI / 2; m.position.set(x, groundTop(x, z, r) + 0.12, z);
  addEffect(m, dur, (e, p) => { m.material.opacity = 0.55 * (1 - p); m.scale.setScalar(0.3 + p * 0.7); });
}
function bubble(av, dur, color = 0x74c0fc) { // 방어막
  const m = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
  addEffect(m, dur / 1000, (e, p) => { m.position.set(av.position.x, av.position.y + 1.1, av.position.z); m.material.opacity = p > 0.85 ? 0.22 * (1 - p) / 0.15 : 0.22 + Math.sin(e.t * 6) * 0.04; });
}
function skillFx(av, w, k, tg) {
  const sk = WEAPONS[w].skills[k], col = WEAPONS[w].color;
  const x = av.position.x, y = av.position.y, z = av.position.z, ry = av.rotation.y;
  const from = new THREE.Vector3(x + Math.sin(ry) * 0.6, y + 1.35, z + Math.cos(ry) * 0.6);
  const range = sk.range || 3;
  if (sk.kind === 'arc') {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, range, 24, 1, -sk.arc * 0.9, sk.arc * 1.8), flatMat(col, 0.75));
    m.rotation.x = -Math.PI / 2; m.rotation.z = ry - Math.PI / 2; // 바라보는 쪽으로 부채꼴
    m.position.set(x, y + 1.1, z);
    addEffect(m, 0.22, (e, p) => { m.material.opacity = 0.75 * (1 - p); m.scale.setScalar(0.8 + p * 0.3); });
  } else if (sk.kind === 'around') {
    const color = sk.slow ? 0x99e9f2 : w === 'hammer' ? 0xd9a066 : 0xbfe9ff;
    const m = new THREE.Mesh(new THREE.RingGeometry(range - 0.8, range, 36), flatMat(color, 0.8));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + (w === 'hammer' ? 0.2 : 0.9), z);
    addEffect(m, 0.4, (e, p) => { m.material.opacity = 0.8 * (1 - p); m.scale.setScalar(0.4 + p * 0.7); });
    if (w !== 'sword') burst(x, z, range, color, 0.5);
  } else if (sk.kind === 'line') {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, range), flatMat(0xffffff, 0.55));
    m.rotation.x = -Math.PI / 2; m.rotation.z = ry; m.position.set(x + Math.sin(ry) * range / 2, y + 0.8, z + Math.cos(ry) * range / 2);
    addEffect(m, 0.35, (e, p) => { m.material.opacity = 0.55 * (1 - p); });
  } else if (sk.kind === 'shot' || sk.kind === 'multi' || sk.kind === 'blast') {
    const list = tg && tg.length ? tg : [[x + Math.sin(ry) * range, z + Math.cos(ry) * range]];
    for (const [tx, tz] of list) {
      const to = new THREE.Vector3(tx, islandH(tx, tz) + (sk.kind === 'blast' ? 0.3 : 0.9), tz);
      if (sk.kind === 'blast') {
        const high = from.clone(); high.y += 2;
        projectile(high, to, w, () => burst(tx, tz, sk.radius, w === 'bow' ? 0xffe066 : 0xff922b, 0.6));
      } else if (sk.name === '번개') {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 14, 5), new THREE.MeshBasicMaterial({ color: 0xfff3bf, transparent: true }));
        bolt.position.set(tx, to.y + 7, tz);
        addEffect(bolt, 0.3, (e, p) => { bolt.material.opacity = 1 - p; });
        burst(tx, tz, 1.4, 0xffe066, 0.4);
      } else projectile(from, to, w);
    }
  } else if (sk.kind === 'heal') {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.9, 30), flatMat(0x8ce99a, 0.85));
    m.rotation.x = -Math.PI / 2; m.position.set(x, groundTop(x, z, 1) + 0.15, z);
    addEffect(m, 0.7, (e, p) => { m.material.opacity = 0.85 * (1 - p); m.scale.setScalar(1 + p * range); });
  } else if (sk.kind === 'shield' || sk.kind === 'taunt') {
    burst(x, z, range, sk.kind === 'taunt' ? 0xff6b6b : 0x74c0fc, 0.6);
  }
}
function levelFx(av) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.2, 20, 1, true), flatMat(0xffd43b, 0.5));
  m.position.set(av.position.x, av.position.y + 1.6, av.position.z);
  addEffect(m, 1.2, (e, p) => { m.material.opacity = 0.5 * (1 - p); m.scale.set(1 + p * 0.5, 1 + p, 1 + p * 0.5); m.position.y = av.position.y + 1.6 + p; });
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.t += dt;
    const p = Math.min(1, e.t / e.dur);
    e.update(e, p);
    if (p >= 1) { if (e.onEnd) e.onEnd(); scene.remove(e.obj); e.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); effects.splice(i, 1); }
  }
}

// ================= 나와 다른 사람들 =================
const me = { id: 0, x: SPAWN.x, y: 3, z: SPAWN.z, vy: 0, ry: Math.PI, onGround: false, a: 0, emote: 0, emoteT: 0, av: null, tag: null,
  hp: 80, maxHp: 80, lv: 1, xp: 0, need: needXp(1), dead: false, deadT: 0, actA: 0, actT: 0, dashT: 0, dashDir: 1, cds: {},
  inv: { gold: 0, items: {}, weapons: ['sword'], equip: 'sword' } };
const others = new Map(); // id -> { av, tag, tx, ty, tz, tr, a, name }
const monsters = new Map(); // id -> { kind, av, tag, tx, tz, tr, hp, st, dying }
let profile = { name: '', color: COLORS[5], hat: 0 };

function addOther(p) {
  if (others.has(p.id) || p.id === me.id) return;
  const av = makeAvatar(p.color, p.hat);
  setWeapon(av, p.w);
  av.position.set(p.x, p.y, p.z); av.rotation.y = p.ry;
  scene.add(av);
  const tag = makeTag(p.name); setTagLv(tag, p.lv || 1); setTagTitle(tag, p.title);
  const o = { av, tag, tx: p.x, ty: p.y, tz: p.z, tr: p.ry, a: 0, name: p.name };
  others.set(p.id, o); setPet(o, p.pet);
}
function removeOther(id) {
  const o = others.get(id); if (!o) return;
  scene.remove(o.av); o.tag.el.remove(); setPet(o, ''); others.delete(id);
}
function clearOthers() { for (const id of [...others.keys()]) removeOther(id); for (const id of [...monsters.keys()]) removeMonster(id); }
function updateCount() { $('count').textContent = String(others.size + 1); }

function addMonster(id, kind, x, z, ry) {
  const def = MONSTERS[kind];
  const av = makeMonster(kind);
  av.position.set(x, islandH(x, z), z); av.rotation.y = ry;
  av.scale.setScalar(0.01);
  scene.add(av);
  const tag = makeTag(def.name, { mon: true }); setTagLv(tag, def.lv);
  const mo = { kind, av, tag, tx: x, tz: z, tr: ry, hp: 100, st: 0, dying: 0, born: 0 };
  monsters.set(id, mo);
  return mo;
}
function removeMonster(id) { const mo = monsters.get(id); if (!mo) return; scene.remove(mo.av); mo.tag.el.remove(); monsters.delete(id); }
function avatarOf(id) { return id === me.id ? me.av : others.get(id)?.av; }

// ================= 체력창 / 기술 칸 =================
const skillsEl = $('skills');
let skillSlots = [], potionSlot = null;
function weaponSkills() { return WEAPONS[me.inv.equip].skills; }
function buildSkillSlots() { // 든 무기에 따라 기술 칸이 바뀜
  skillsEl.textContent = '';
  skillSlots = weaponSkills().map((sk, k) => {
    const b = document.createElement('button'); b.className = 'sk'; b.dataset.k = k; b.title = `${sk.name} (${KEYS[k]})`;
    b.innerHTML = `<span class="ic"></span><span class="key"></span><span class="cdv"></span><span class="cdn"></span>`;
    b.querySelector('.ic').textContent = sk.icon; b.querySelector('.key').textContent = KEYS[k];
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); tryAttack(k); });
    skillsEl.appendChild(b);
    return { b, cdv: b.querySelector('.cdv'), cdn: b.querySelector('.cdn') };
  });
  const b = document.createElement('button'); b.className = 'sk potion'; b.title = '물약 마시기 (H)';
  b.innerHTML = '<span class="ic">🧪</span><span class="key">H</span><span class="cnt"></span>';
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); drinkPotion(); });
  skillsEl.appendChild(b);
  potionSlot = b;
  refreshPotion();
}
function refreshPotion() {
  if (!potionSlot) return;
  const n = (me.inv.items.potion || 0) + (me.inv.items.bigpotion || 0);
  potionSlot.querySelector('.cnt').textContent = n ? String(n) : '';
  potionSlot.classList.toggle('empty', !n);
}
function refreshStats() {
  $('lv').textContent = me.lv;
  $('gold').textContent = me.inv.gold;
  $('hpText').textContent = `${me.hp} / ${me.maxHp}`;
  $('hpFill').style.width = (me.hp / me.maxHp * 100) + '%';
  $('xpFill').style.width = (me.lv >= ARCA.MAX_LV ? 100 : me.xp / me.need * 100) + '%';
  if (me.tag) setTagLv(me.tag, me.lv);
}
function updateSkillSlots() {
  const now = performance.now();
  weaponSkills().forEach((sk, k) => {
    const s = skillSlots[k]; if (!s) return;
    const locked = me.lv < UNLOCK[k];
    s.b.classList.toggle('locked', locked);
    if (locked) { s.cdv.style.height = '0'; s.cdn.textContent = `Lv${UNLOCK[k]}`; return; }
    const left = (me.cds[me.inv.equip + k] || 0) - now;
    if (left > 0) { s.cdv.style.height = (left / sk.cd * 100) + '%'; s.cdn.textContent = left > 1000 ? Math.ceil(left / 1000) : ''; }
    else { s.cdv.style.height = '0'; s.cdn.textContent = ''; }
  });
}

// ================= 채팅 / 알림 =================
const logEl = $('log'), sayEl = $('say');
function addLog(text, name) {
  const d = document.createElement('div');
  if (name) { const b = document.createElement('b'); b.textContent = name + ': '; d.append(b, document.createTextNode(text)); }
  else { d.className = 'sys'; d.textContent = text; }
  logEl.appendChild(d);
  while (logEl.children.length > 60) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}
let toastTimer = 0;
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }

// ================= 서버 연결 =================
let ws = null, joined = false, everJoined = false, statsReady = false;
function loadDeco() { try { return JSON.parse(store.get('arca.deco') || '[]'); } catch (e) { return []; } }
let kickedOut = false, lastActSent = 0, waitVisible = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { net({ t: 'hide' }); return; }
  if (waitVisible && !kickedOut) { waitVisible = false; connect(); }
  else net({ t: 'act' });
});
function myUid() { // 이 브라우저의 이름표 (같은 브라우저로 두 번 들어오면 서버가 알아봄)
  let u = store.get('arca.uid');
  if (!u) { u = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('arca.uid', u); }
  return u;
}
function touchAct() { // 키나 화면을 누르면 '아직 여기 있어요'를 30초에 한 번 알림
  const now = performance.now();
  if (now - lastActSent > 30000) { lastActSent = now; net({ t: 'act' }); }
}
addEventListener('keydown', touchAct); addEventListener('pointerdown', touchAct);
function loadSt() { try { return JSON.parse(store.get('arca.st') || 'null'); } catch (e) { return null; } }
function loadQ() { try { return JSON.parse(store.get('arca.q') || 'null'); } catch (e) { return null; } }
function loadInv() { try { return JSON.parse(store.get('arca.inv') || 'null'); } catch (e) { return null; } }
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: profile.name, color: profile.color, hat: profile.hat,
    lv: Number(store.get('arca.lv')) || 1, xp: Number(store.get('arca.xp')) || 0, inv: loadInv(), deco: loadDeco(), q: loadQ(), uid: myUid(), st: loadSt(), title: store.get('arca.title') || '' }));
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    const h = handlers[m.t]; if (h) h(m);
  };
  ws.onclose = () => {
    const wasJoined = joined; joined = false;
    if (kickedOut) return; // 서버가 내보낸 창은 스스로 다시 들어가지 않음
    if (!everJoined) { $('status').textContent = '서버에 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.'; $('start').disabled = false; return; }
    if (wasJoined) { toast('연결이 끊겼어요. 다시 연결하는 중…'); addLog('연결이 끊겨서 다시 연결하는 중이에요'); }
    // 화면이 가려진 창(다른 탭, 꺼진 화면)은 다시 접속하지 않고, 다시 볼 때 접속함 → 안 보는 창이 유령 캐릭터로 남지 않게
    if (document.hidden) { waitVisible = true; return; }
    setTimeout(connect, 2000);
  };
}
const handlers = {
  welcome(m) {
    clearOthers();
    statsReady = false; // 접속 직후 받은 레벨은 '레벨 업'이 아님
    me.id = m.id;
    me.x = m.me.x; me.y = m.me.y; me.z = m.me.z; me.ry = m.me.ry; me.vy = 0; me.dead = false;
    document.body.classList.remove('deadtint'); $('deadView').hidden = true;
    m.players.forEach(addOther);
    for (const id of [...decos.keys()]) removeDeco(id);
    (m.decos || []).forEach(addDeco);
    dayPhase = m.phase || 0; dayMs = m.dayMs || ARCA.DAY_MS; phaseAt = performance.now();
    me.glide = false;
    party = []; partyIds = new Set(); trade = null; $('trade').hidden = true; renderPartyBox();
    $('chan').textContent = `채널 ${m.ch}`;
    updateCount();
    if (!everJoined) {
      everJoined = true;
      $('join').hidden = true; $('hud').hidden = false;
      me.av = makeAvatar(profile.color, profile.hat); scene.add(me.av);
      setWeapon(me.av, me.inv.equip); buildSkillSlots();
      me.tag = makeTag(profile.name || '바람잡이', { me: true });
      camYaw = 0;
      addLog(document.body.classList.contains('touch') ? '포근언덕에 도착했어요! 💬 버튼을 눌러 인사해 보세요' : '포근언덕에 도착했어요! Enter 키를 눌러 인사해 보세요');
      addLog(document.body.classList.contains('touch') ? '광장 밖 풀밭에 슬라임이 살아요. 🗡️ 공격 버튼으로 싸워 보세요!' : '광장 밖 풀밭에 슬라임이 살아요. 클릭하거나 F 키로 공격해 보세요!');
      toast('🌿 포근언덕에 도착!');
    } else addLog('다시 연결됐어요');
    joined = true;
  },
  s(m) {
    for (const [id, x, y, z, ry, a, hp, lv] of m.p) {
      if (id === me.id) continue;
      const o = others.get(id); if (!o) continue;
      o.tx = x; o.ty = y; o.tz = z; o.tr = ry; o.a = a;
      setTagLv(o.tag, lv); setTagHp(o.tag, hp, true);
      o.hp = hp; o.lv = lv;
    }
    const seen = new Set();
    let bossHp = null;
    for (const [id, ki, x, z, ry, hp, st, slow] of m.m) {
      seen.add(id);
      let mo = monsters.get(id);
      if (mo && mo.dying) continue;
      if (!mo) mo = addMonster(id, MONSTER_KINDS[ki], x, z, ry);
      mo.tx = x; mo.tz = z; mo.tr = ry; mo.st = st; mo.slow = slow;
      if (mo.kind === 'golem') bossHp = hp;
      if (mo.hp !== hp) { mo.hp = hp; setTagHp(mo.tag, hp); }
    }
    for (const [id, mo] of monsters) if (!seen.has(id) && !mo.dying) removeMonster(id);
    $('bossBar').hidden = bossHp === null;
    if (bossHp !== null) { $('bossFill').style.width = bossHp + '%'; $('bossPct').textContent = bossHp + '%'; }
  },
  join(m) { addOther(m.p); updateCount(); addLog(`${m.p.name} 님이 섬에 왔어요`); renderPeople(); },
  leave(m) { removeOther(m.id); updateCount(); addLog(`${m.name} 님이 섬을 떠났어요`); renderPeople(); },
  chat(m) {
    addLog(m.text, m.name);
    const tag = m.id === me.id ? me.tag : others.get(m.id)?.tag;
    if (tag) say(tag, m.text);
  },
  emote(m) { const o = others.get(m.id); if (o) emote(o.tag, m.e); },
  stats(m) {
    const wasLv = me.lv;
    Object.assign(me, { hp: m.hp, maxHp: m.maxHp, lv: m.lv, xp: m.xp, need: m.need });
    store.set('arca.lv', String(m.lv)); store.set('arca.xp', String(m.xp));
    refreshStats();
    const first = !statsReady; statsReady = true;
    if (first) return;
    if (me.lv > wasLv && statsReady) {
      UNLOCK.forEach((u, k) => {
        if (u <= wasLv || u > me.lv) return;
        const s = weaponSkills()[k];
        toast(`✨ 새 기술: ${s.name} (${KEYS[k]})`); addLog(`새 기술을 배웠어요: ${s.icon} ${s.name} — ${KEYS[k]} 키 (다른 무기도 같은 칸이 열려요)`);
      });
    }
  },
  hit(m) {
    if (m.m) {
      const mo = monsters.get(m.m); if (!mo) return;
      mo.av.userData.flash = 0.12;
      const h = MONSTERS[mo.kind].size * 1.4 + 0.6;
      pop(m.crit ? `${m.dmg}!` : String(m.dmg), mo.av.position.x, mo.av.position.y + h, mo.av.position.z, m.crit ? 'crit' : (m.by === me.id ? '' : 'other'));
    } else if (m.p) {
      const av = avatarOf(m.p); if (!av) return;
      pop(`-${m.dmg}`, av.position.x, av.position.y + 2.2, av.position.z, 'hurt');
      if (m.p === me.id) { shake = 0.25; }
    }
  },
  heal(m) { const av = avatarOf(m.id); if (av && m.amt > 0) pop(`+${m.amt}`, av.position.x, av.position.y + 2.3, av.position.z, 'heal'); },
  xp(m) { if (me.av) pop(`+${m.gained} 경험치`, me.av.position.x, me.av.position.y + 2.7, me.av.position.z, 'xp'); },
  lvup(m) {
    const av = avatarOf(m.id); if (!av) return;
    levelFx(av);
    pop(`레벨 업! Lv${m.lv}`, av.position.x, av.position.y + 3, av.position.z, 'lvup');
    if (m.id === me.id) addLog(`🎉 레벨이 올랐어요! 이제 Lv${m.lv}`);
  },
  tele(m) { telegraph(m.x, m.z, m.r, m.ms); },
  ask(m) { showAsk(m); },
  time(m) { dayPhase = m.phase; phaseAt = performance.now(); },
  decoadd(m) { addDeco(m.d); if (m.d.o === me.id) { saveDecos(); renderDeco(); } },
  decodel(m) { const mine = decos.get(m.id)?.d.o === me.id; removeDeco(m.id); if (mine) { saveDecos(); renderDeco(); } },
  party(m) {
    party = m.members; partyIds = new Set(party.map((q) => q.id));
    for (const [id, o] of others) o.tag.el.classList.toggle('pt', partyIds.has(id));
    renderPartyBox(); renderPeople();
  },
  topen(m) {
    trade = { with: m.with, name: m.name, mine: { gold: 0, items: {} }, theirs: { gold: 0, items: {} }, okMine: false, okTheirs: false };
    $('bag').hidden = $('shop').hidden = $('people').hidden = true;
    $('tradeName').textContent = m.name; $('tGold').value = 0; $('trade').hidden = false;
    renderTrade();
  },
  tstate(m) { if (!trade) return; Object.assign(trade, { mine: m.mine, theirs: m.theirs, okMine: m.okMine, okTheirs: m.okTheirs }); renderTrade(); },
  tclose(m) { trade = null; $('trade').hidden = true; if (m.text) { toast(m.text); addLog(m.text); } },
  bossinfo(m) { bossAlive = m.alive; bossAt = performance.now() + m.in; },
  mdie(m) {
    const mo = monsters.get(m.id); if (!mo) return;
    mo.dying = 0.4; mo.tag.el.remove();
  },
  fx(m) { const o = others.get(m.id); if (o && WEAPONS[m.w]) { setWeapon(o.av, m.w); skillFx(o.av, m.w, m.k, m.tg); } },
  inv(m) {
    const prevEquip = me.inv.equip;
    me.inv = { gold: m.gold, items: m.items, weapons: m.weapons, equip: m.equip, up: m.up || {}, pets: m.pets || [], pet: m.pet || '' };
    setPet(me, me.inv.pet);
    store.set('arca.inv', JSON.stringify(me.inv));
    if (me.av) {
      setWeapon(me.av, me.inv.equip);
      if (prevEquip !== me.inv.equip || !skillSlots.length) buildSkillSlots();
    }
    refreshStats(); refreshPotion(); renderPanels(); renderTrade(); renderQuest(); renderTrack(); if (knownTitles) checkNewTitles();
  },
  equip(m) { const o = others.get(m.id); if (o) setWeapon(o.av, m.w); },
  loot(m) {
    const y = islandH(m.x, m.z) + 2.2;
    pop(`+${m.gold}G`, m.x, y, m.z, 'gold');
    for (const [id, n] of m.items) {
      const it = ITEMS[id];
      if (n > 0) { pop(`${it.icon} +${n}`, m.x, y + 0.6, m.z, 'item'); addLog(`얻었어요: ${it.icon} ${it.name}`); }
      else addLog(`가방이 꽉 차서 못 주웠어요: ${it.name}`);
    }
  },
  notice(m) { toast(m.text); addLog(m.text); },
  fishing(m) { fishState = { biteAt: performance.now() + m.in, window: m.window, bit: false }; toast('🎣 찌를 던졌어요… 흔들릴 때까지 기다려요'); },
  caught(m) {
    stopFishing();
    if (m.fail) { toast(m.fail); return; }
    if (m.pet) { toast('🐳 아기 하늘고래를 만났어요!!'); pop('🐳', me.x, me.y + 3, me.z, 'lvup'); return; }
    const it = ITEMS[m.item];
    pop(`${it.icon} ${it.name}`, me.x, me.y + 2.8, me.z, 'item'); toast(`🎣 ${it.icon} ${it.name}을(를) 낚았어요!`); addLog(`🎣 낚았어요: ${it.icon} ${it.name}`);
  },
  foodbuff(m) { buffUntil = performance.now() + m.ms; toast('🍢 든든해요! 2분 동안 공격력이 올라요'); renderTrack(); },
  cookfx(m) { const av = avatarOf(m.id); if (av) pop('🍢', av.position.x, av.position.y + 2.6, av.position.z, 'item'); },
  pet(m) { const o = m.id === me.id ? me : others.get(m.id); if (o) setPet(o, m.pet); },
  st(m) {
    myst = m.st; myTitle = m.title || '';
    store.set('arca.st', JSON.stringify(myst)); store.set('arca.title', myTitle);
    if (me.tag) setTagTitle(me.tag, myTitle && ARCA.TITLES[myTitle] ? ARCA.TITLES[myTitle].name : '');
    checkNewTitles(); renderRecord();
  },
  title(m) { const o = others.get(m.id); if (o) setTagTitle(o.tag, m.title); },
  rank(m) { rankData = m; renderRecord(); },
  duel(m) {
    if (m.a !== me.id && m.b !== me.id) { addLog(`⚔️ ${m.an} 님과 ${m.bn} 님이 결투를 시작해요!`); return; }
    duelOp = m.a === me.id ? m.b : m.a; duelStart = performance.now() + m.in;
    const o = others.get(duelOp); if (o) { o.tag.el.classList.add('foe'); o.tag.hpb.hidden = false; }
    addLog(`⚔️ ${m.a === me.id ? m.bn : m.an} 님과 결투! 져도 쓰러지지 않아요`);
    ['⚔️ 결투 준비… 3', '⚔️ 2', '⚔️ 1', '⚔️ 시작!'].forEach((t, i) => setTimeout(() => { if (duelOp) toast(t); }, i * 1000));
    $('people').hidden = true; renderPeople();
  },
  duelend(m) {
    if (m.a === me.id || m.b === me.id) {
      const o = others.get(duelOp); if (o) o.tag.el.classList.remove('foe');
      duelOp = 0;
      if (m.win) pop(m.win === me.id ? '승리!' : '패배…', me.x, me.y + 3, me.z, 'lvup');
      toast(m.text); renderPeople();
    }
    if (m.text) addLog(m.text);
  },
  kicked(m) {
    kickedOut = true; joined = false;
    const box = $('kicked');
    box.querySelector('p').textContent = m.text;
    box.hidden = false;
  },
  quests(m) { quests = { active: m.active || {}, done: m.done || {} }; store.set('arca.q', JSON.stringify(quests)); renderQuest(); renderTrack(); },
  wind(m) {
    wind = { n: m.n, need: m.need, bridge: m.bridge };
    ARCA.world.bridge = m.bridge; bridgeMesh.visible = m.bridge;
    fountainOrb.material.emissiveIntensity = 0.6 + 1.6 * Math.min(1, m.n / m.need);
    if (m.by) addLog(`🌀 ${m.by} 님이 바람의 돌 ${m.add}개를 바쳤어요 (${Math.min(m.n, m.need)}/${m.need})`);
    if (m.opened) { toast('🌉 바람의 다리가 열렸어요! 섬 동쪽 끝으로 가 보세요'); addLog('🌉 바람의 다리가 열렸어요! 이제 걸어서 버섯숲 섬에 갈 수 있어요'); bridgeT = 0; }
    renderTrack();
  },
  buff(m) { const av = avatarOf(m.id); if (av) bubble(av, m.dur); },
  pdie(m) {
    if (m.id === me.id) {
      me.dead = true; me.deadT = 4.6; me.actT = 0; me.dashT = 0;
      $('deadView').hidden = false; document.body.classList.add('deadtint');
      addLog('쓰러졌어요… 잠시 뒤 광장에서 다시 일어나요');
    } else { const o = others.get(m.id); if (o) addLog(`${o.name} 님이 쓰러졌어요`); }
  },
  revive(m) {
    me.dead = false; me.x = m.x; me.y = m.y + 0.5; me.z = m.z; me.vy = 0; me.ry = Math.PI; camYaw = 0;
    $('deadView').hidden = true; document.body.classList.remove('deadtint');
    toast('광장에서 다시 일어났어요! 💪');
  },
  revived() {},
};
function net(obj) { if (joined && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// ================= 접속 화면 =================
{
  profile.name = store.get('arca.name') || '';
  const c = store.get('arca.color'); if (COLORS.includes(c)) profile.color = c;
  const h = Number(store.get('arca.hat')); if (h >= 0 && h <= 3) profile.hat = h;
  $('name').value = profile.name;
  const sw = $('colors');
  COLORS.forEach((col) => {
    const b = document.createElement('button'); b.style.background = col; b.setAttribute('aria-label', col);
    if (col === profile.color) b.classList.add('on');
    b.onclick = () => { profile.color = col; sw.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
    sw.appendChild(b);
  });
  const hats = $('hats');
  hats.querySelectorAll('button').forEach((b) => {
    if (Number(b.dataset.hat) === profile.hat) b.classList.add('on');
    b.onclick = () => { profile.hat = Number(b.dataset.hat); hats.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  const start = () => {
    profile.name = $('name').value.trim().slice(0, 12) || '바람잡이';
    store.set('arca.name', profile.name); store.set('arca.color', profile.color); store.set('arca.hat', String(profile.hat));
    $('start').disabled = true; $('status').textContent = '서버를 깨우는 중이에요… (처음엔 50초쯤 걸릴 수 있어요)';
    connect();
  };
  $('start').onclick = start;
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
}

// ================= 조작 =================
const keys = new Set();
let camYaw = 0, camPitch = 0.42, camDist = 9, shake = 0;
let jumpQueued = false, runToggle = false, glideQueued = false, updraftHint = false;
let curIsle = ISLANDS[0];
const joy = { x: 0, y: 0 };

function doEmote(e) {
  if (!joined || me.dead) return;
  me.emote = e; me.emoteT = e === 1 ? 2.2 : 999;
  emote(me.tag, e);
  net({ t: 'emote', e });
}
// 가까운 몬스터들 (앞쪽에 있는 걸 더 좋아함)
function nearMonsters(range) {
  const fx = Math.sin(me.ry), fz = Math.cos(me.ry), list = [];
  for (const mo of monsters.values()) {
    if (mo.dying) continue;
    const dx = mo.av.position.x - me.x, dz = mo.av.position.z - me.z, d = Math.hypot(dx, dz);
    if (d > range + MONSTERS[mo.kind].size * 0.7) continue;
    list.push({ mo, score: d - (d < 1 ? 1 : (dx * fx + dz * fz) / d) * 4 });
  }
  return list.sort((a, b) => a.score - b.score).map((o) => o.mo);
}
// 가까운 몬스터 쪽으로 몸을 돌려 주기 (조준 도우미)
function autoAim(range) {
  const foe = duelOp && performance.now() >= duelStart ? others.get(duelOp) : null; // 결투 중에는 상대를 먼저 겨눔
  if (foe && Math.hypot(foe.av.position.x - me.x, foe.av.position.z - me.z) < range + 0.5) { me.ry = Math.atan2(foe.av.position.x - me.x, foe.av.position.z - me.z); return foe; }
  const best = nearMonsters(range)[0];
  if (best) me.ry = Math.atan2(best.av.position.x - me.x, best.av.position.z - me.z);
  return best;
}
function tryAttack(k) {
  if (!joined || me.dead) return;
  const w = me.inv.equip, sk = WEAPONS[w].skills[k], now = performance.now(), key = w + k;
  if (me.lv < UNLOCK[k]) { toast(`${sk.icon} ${sk.name}은(는) Lv${UNLOCK[k]}에 배워요`); return; }
  if (now < (me.cds[key] || 0)) return;
  me.cds[key] = now + sk.cd;
  me.emote = 0;
  let tg = null;
  if (sk.kind === 'arc') autoAim(4.5);
  else if (sk.kind === 'line') autoAim(8);
  else if (sk.kind === 'shot' || sk.kind === 'blast') { const t = autoAim(sk.range); if (t) tg = [[t.av.position.x, t.av.position.z]]; }
  else if (sk.kind === 'multi') { const list = nearMonsters(sk.range).slice(0, sk.n); if (list[0]) { autoAim(sk.range); tg = list.map((mo) => [mo.av.position.x, mo.av.position.z]); } }
  me.av.rotation.y = me.ry;
  const A_ = { arc: ANIM.attack, line: ANIM.attack, around: ANIM.spin, shot: ANIM.cast, multi: ANIM.cast, blast: ANIM.cast, heal: ANIM.wave, shield: ANIM.wave, taunt: ANIM.wave, guard: ANIM.guard };
  me.actA = A_[sk.kind];
  if (w === 'hammer' && sk.kind === 'around') me.actA = ANIM.attack;
  me.actT = sk.kind === 'around' ? 0.45 : sk.kind === 'guard' ? sk.dur / 1000 : sk.kind === 'arc' || sk.kind === 'line' ? 0.28 : 0.4;
  if (sk.move === 'dash') { me.dashT = DASH_TIME; me.dashDir = 1; }
  if (sk.move === 'back') { me.dashT = 0.22; me.dashDir = -1; }
  net({ t: 'atk', k, ry: +me.ry.toFixed(3) });
  me.av.position.set(me.x, me.y, me.z);
  skillFx(me.av, w, k, tg);
}
function drinkPotion() {
  if (!joined || me.dead) return;
  const id = me.inv.items.potion ? 'potion' : me.inv.items.bigpotion ? 'bigpotion' : null;
  if (!id) { toast('물약이 없어요 — 광장의 상인 모모에게 살 수 있어요'); return; }
  if (me.hp >= me.maxHp) { toast('체력이 이미 가득해요'); return; }
  net({ t: 'use', item: id });
}

// ================= 상인 / 가방 / 상점 =================
let merchantAv = null, merchantTag = null, nearMerchant = false, shopTab = 'buy';
{
  const stall = new THREE.Group();
  const table = mesh(new THREE.BoxGeometry(2.6, 0.9, 1.1), '#a0723a'); table.position.set(0, 0.45, 1.1);
  const top = mesh(new THREE.BoxGeometry(2.8, 0.1, 1.3), '#7a4b2a'); top.position.set(0, 0.95, 1.1);
  stall.add(table, top);
  [[-1.3, 1.6], [1.3, 1.6], [-1.3, -0.7], [1.3, -0.7]].forEach(([x, z]) => { const p = mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.8, 5), '#7a4b2a'); p.position.set(x, 1.4, z); stall.add(p); });
  for (let i = 0; i < 5; i++) { const st = mesh(new THREE.BoxGeometry(0.6, 0.1, 2.7), i % 2 ? '#fff5f5' : '#fa5252'); st.position.set(-1.2 + i * 0.6, 2.85, 0.45); st.rotation.x = -0.15; stall.add(st); }
  const p1 = mesh(new THREE.IcosahedronGeometry(0.14, 0), '#ff6b6b', { emissive: '#c92a2a', emissiveIntensity: 0.4 }); p1.position.set(-0.6, 1.12, 1.1);
  const p2 = mesh(new THREE.IcosahedronGeometry(0.17, 0), '#cc5de8', { emissive: '#862e9c', emissiveIntensity: 0.4 }); p2.position.set(-0.2, 1.14, 1.1);
  const bowShow = mesh(new THREE.TorusGeometry(0.4, 0.04, 5, 12, Math.PI), '#8b5a2b'); bowShow.position.set(0.6, 1.0, 1.1); bowShow.rotation.x = -Math.PI / 2;
  stall.add(p1, p2, bowShow);
  stall.position.set(MERCHANT.x, islandH(MERCHANT.x, MERCHANT.z), MERCHANT.z);
  stall.rotation.y = MERCHANT.ry;
  scene.add(stall);
  merchantAv = makeAvatar('#82c91e', 2);
  merchantAv.userData.holdR.clear();
  merchantAv.position.set(MERCHANT.x, islandH(MERCHANT.x, MERCHANT.z), MERCHANT.z);
  merchantAv.rotation.y = MERCHANT.ry;
  scene.add(merchantAv);
  merchantTag = makeTag('🛒 상인 모모');
}
function openPanel(id, open) {
  const el = $(id), show = open === undefined ? el.hidden : open;
  el.hidden = !show;
  if (show) { for (const other of ['bag', 'shop', 'people', 'deco', 'quest', 'record']) if (other !== id) $(other).hidden = true; renderPanels(); renderPeople(); renderDeco(); renderQuest(); if (id === 'record') { net({ t: 'rank' }); renderRecord(); } }
}
function itemCount() { return Object.keys(me.inv.items).length; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function renderPanels() {
  document.querySelectorAll('.goldN').forEach((b) => { b.textContent = me.inv.gold; });
  if (!$('bag').hidden) renderBag();
  if (!$('shop').hidden) renderShop();
  renderDeco();
}
function renderBag() {
  const wl = $('bagWeapons'); wl.textContent = '';
  for (const id of me.inv.weapons) {
    const w = WEAPONS[id], b = el('button', 'wcard' + (id === me.inv.equip ? ' on' : ''));
    const what = el('span'); what.append(el('b', '', w.name + (me.inv.up[id] ? ` +${me.inv.up[id]}` : '')), el('small', '', `${w.desc} · ${w.skills.map((s) => s.icon).join(' ')}`));
    b.append(el('span', 'ic', w.icon), what, el('span', 'badge', id === me.inv.equip ? '들고 있음' : '바꿔 들기'));
    b.onclick = () => { if (id !== me.inv.equip) net({ t: 'equip', w: id }); };
    wl.appendChild(b);
  }
  let pl = $('bagPets');
  if (!pl) { pl = el('div', 'chips'); pl.id = 'bagPets'; const t = el('div', 'ptitle', '펫 '); t.id = 'bagPetsT'; t.appendChild(el('small', '', '눌러서 데리고 다녀요')); wl.after(t, pl); }
  pl.textContent = ''; $('bagPetsT').hidden = pl.hidden = !me.inv.pets.length;
  if (me.inv.pets.length) {
    const none = el('button', me.inv.pet ? '' : 'on', '쉬게 하기'); none.onclick = () => net({ t: 'pet', id: '' }); pl.appendChild(none);
    for (const k of me.inv.pets) { const b = el('button', k === me.inv.pet ? 'on' : '', `${ARCA.PETS[k].icon} ${ARCA.PETS[k].name}`); b.onclick = () => net({ t: 'pet', id: k }); pl.appendChild(b); }
  }
  const grid = $('bagItems'); grid.textContent = '';
  const ids = ITEM_IDS.filter((id) => me.inv.items[id]);
  $('bagCount').textContent = `${ids.length} / ${BAG_SLOTS}칸`;
  for (let i = 0; i < BAG_SLOTS; i++) {
    const id = ids[i], b = el('button', 'cell');
    if (!id) { b.disabled = true; grid.appendChild(b); continue; }
    const it = ITEMS[id];
    b.append(el('span', '', it.icon), el('span', 'n', String(me.inv.items[id])));
    b.title = `${it.name} — ${it.desc}`;
    b.onclick = () => {
      $('bagTip').textContent = `${it.icon} ${it.name}: ${it.desc}`;
      if (it.type === 'potion') { if (me.hp >= me.maxHp) toast('체력이 이미 가득해요'); else net({ t: 'use', item: id }); }
      if (it.type === 'food') net({ t: 'use', item: id });
    };
    grid.appendChild(b);
  }
}
function shopRow(icon, title, sub, price, buttons) {
  const r = el('div', 'row'), what = el('div', 'what');
  what.append(el('b', '', title), el('small', '', sub));
  const act = el('div', 'act');
  for (const [label, ok, fn] of buttons) { const b = el('button', '', label); b.disabled = !ok; b.onclick = fn; act.appendChild(b); }
  r.append(el('span', 'ic', icon), what, el('span', 'price', price), act);
  return r;
}
function renderShop() {
  document.querySelectorAll('#shop .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === shopTab));
  const list = $('shopList'); list.textContent = '';
  const g = me.inv.gold;
  if (shopTab === 'buy') {
    for (const id of SHOP_ITEMS) {
      const it = ITEMS[id];
      list.appendChild(shopRow(it.icon, it.name, it.desc, `${it.buy}G`, [
        ['1개', g >= it.buy, () => net({ t: 'buy', id, n: 1 })],
        ['5개', g >= it.buy * 5, () => net({ t: 'buy', id, n: 5 })],
      ]));
    }
    for (const id of ARCA.WEAPON_IDS) {
      const w = WEAPONS[id]; if (!w.price) continue;
      const own = me.inv.weapons.includes(id);
      const r = shopRow(w.icon, w.name, w.desc, own ? '' : `${w.price}G`, [[own ? '가지고 있음' : '사기', !own && g >= w.price, () => net({ t: 'buy', id })]]);
      r.querySelector('.what').appendChild(el('small', 'sks', w.skills.map((s) => s.icon).join(' ')));
      list.appendChild(r);
    }
    for (const k of ARCA.PET_IDS) {
      const pet = ARCA.PETS[k], own = me.inv.pets.includes(k);
      if (!pet.price && !own) { list.appendChild(shopRow(pet.icon, pet.name, pet.desc, '', [['낚시로만', false, () => {}]])); continue; }
      list.appendChild(shopRow(pet.icon, pet.name, pet.desc, own ? '' : `${pet.price}G`, [[own ? '함께하는 중' : '데려오기', !own && g >= pet.price, () => net({ t: 'buy', id: k })]]));
    }
  } else if (shopTab === 'up') { // 무기 강화
    list.appendChild(el('div', 'tip', `재료와 골드로 무기를 강화해요. 한 단계마다 그 무기의 피해가 ${ARCA.UP_BONUS * 100}%씩 늘어요 (최대 +${ARCA.MAX_UP}).`));
    for (const id of me.inv.weapons) {
      const w = WEAPONS[id], lv = me.inv.up[id] || 0, cost = ARCA.UPGRADES[lv];
      if (!cost) { list.appendChild(shopRow(w.icon, `${w.name} +${lv}`, `피해 +${Math.round(lv * ARCA.UP_BONUS * 100)}%`, '', [['끝까지 강화함', false, () => {}]])); continue; }
      const mats = Object.entries(cost.mats), ok = g >= cost.gold && mats.every(([m, n]) => (me.inv.items[m] || 0) >= n);
      const need = mats.map(([m, n]) => `${ITEMS[m].icon} ${ITEMS[m].name} ${me.inv.items[m] || 0}/${n}`).join(' · ');
      list.appendChild(shopRow(w.icon, `${w.name}${lv ? ` +${lv}` : ''} → +${lv + 1}`, need, `${cost.gold}G`, [['강화', ok, () => net({ t: 'upgrade', w: id })]]));
    }
  } else {
    const ids = ITEM_IDS.filter((id) => me.inv.items[id] && ITEMS[id].sell);
    if (!ids.length) { list.appendChild(el('div', 'empty', '팔 물건이 없어요. 몬스터를 잡으면 재료가 나와요!')); return; }
    for (const id of ids) {
      const it = ITEMS[id], n = me.inv.items[id];
      list.appendChild(shopRow(it.icon, `${it.name} ×${n}`, `하나에 ${it.sell}G`, `${it.sell * n}G`, [
        ['1개 팔기', true, () => net({ t: 'sell', id, n: 1 })],
        ['모두 팔기', true, () => net({ t: 'sell', id, n })],
      ]));
    }
  }
}
document.querySelectorAll('.panel .x').forEach((b) => { b.onclick = () => { b.closest('.panel').hidden = true; }; });
document.querySelectorAll('#shop .tabs button').forEach((b) => { b.onclick = () => { shopTab = b.dataset.tab; renderShop(); }; });
$('bagBtn').onclick = () => openPanel('bag');
$('peopleBtn').onclick = () => openPanel('people');
$('decoOpen').onclick = () => openPanel('deco', true);

// ================= 촌장 · 의뢰 · 바람의 돌 · 다리 =================
const { ELDER, QUESTS, BRIDGE } = ARCA;
let quests = { active: {}, done: {} }, wind = { n: 0, need: BRIDGE.need, bridge: false };
let elderAv = null, elderTag = null, nearElderNow = false, nearAltar = false, bridgeT = 9;
const bridgeMesh = new THREE.Group();
{
  // 촌장 루루
  elderAv = makeAvatar('#e8590c', 1);
  setWeapon(elderAv, 'staff');
  elderAv.position.set(ELDER.x, islandH(ELDER.x, ELDER.z), ELDER.z);
  elderAv.rotation.y = ELDER.ry;
  elderAv.scale.setScalar(0.92);
  scene.add(elderAv);
  elderTag = makeTag('📜 촌장 루루');
  const board = mesh(new THREE.BoxGeometry(1.6, 1.1, 0.1), '#c8955a'); board.position.set(ELDER.x + 1.5, islandH(ELDER.x, ELDER.z) + 1.5, ELDER.z + 0.6); board.rotation.y = ELDER.ry;
  const post = mesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), '#7a4b2a'); post.position.set(ELDER.x + 1.5, islandH(ELDER.x, ELDER.z) + 0.6, ELDER.z + 0.6);
  scene.add(board, post);
  for (let i = 0; i < 3; i++) { const note = mesh(new THREE.BoxGeometry(0.36, 0.42, 0.02), ['#fff9db', '#e7f5ff', '#fff0f6'][i], null, false); note.position.set(-0.5 + i * 0.5, 0.05 - (i % 2) * 0.12, 0.07); note.rotation.z = (i - 1) * 0.12; board.add(note); }

  // 바람의 다리 (열리기 전에는 안 보임)
  const len = BRIDGE.x1 - BRIDGE.x0, cx = (BRIDGE.x0 + BRIDGE.x1) / 2;
  for (let i = 0; i < len / 1.2; i++) {
    const plank = mesh(new THREE.BoxGeometry(1.0, 0.18, BRIDGE.half * 2), i % 2 ? '#c9a06a' : '#b98d58');
    plank.position.set(BRIDGE.x0 + 0.6 + i * 1.2, BRIDGE.y - 0.09, 0); bridgeMesh.add(plank);
  }
  for (const z of [-BRIDGE.half, BRIDGE.half]) {
    const rail = mesh(new THREE.BoxGeometry(len, 0.1, 0.1), '#7a4b2a'); rail.position.set(cx, BRIDGE.y + 0.9, z); bridgeMesh.add(rail);
    for (let x = BRIDGE.x0; x <= BRIDGE.x1; x += 4) { const p = mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), '#7a4b2a'); p.position.set(x, BRIDGE.y + 0.45, z); bridgeMesh.add(p); }
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(len, BRIDGE.half * 2 + 1.2), flatMat(0x9be7ff, 0.25)); glow.rotation.x = -Math.PI / 2; glow.position.set(cx, BRIDGE.y - 0.25, 0); bridgeMesh.add(glow);
  bridgeMesh.visible = false;
  scene.add(bridgeMesh);

  // 화면 틀: 안내 버튼 묶음, 의뢰 창, 진행 표시
  const hints = el('div'); hints.id = 'hints';
  const sh = $('shopHint'); sh.replaceWith(hints); hints.appendChild(sh);
  const mk = (id, text, fn) => { const d = el('div'); d.id = id; d.hidden = true; const b = el('button', '', text); b.onclick = fn; d.appendChild(b); hints.appendChild(d); };
  mk('elderHint', '📜 촌장 루루와 이야기하기 (T)', () => openPanel('quest', true));
  mk('altarHint', '🌀 바람의 돌 바치기 (V)', () => net({ t: 'donate' }));
  const panel = el('div', 'panel'); panel.id = 'quest'; panel.hidden = true;
  panel.innerHTML = '<div class="phead"><b>📜 촌장 루루의 의뢰</b><button class="x" aria-label="닫기">✕</button></div><div class="tip" id="questTip"></div><div id="questList"></div>';
  $('hud').appendChild(panel);
  const track = el('div'); track.id = 'qtrack'; $('hud').appendChild(track);
  const tabUp = el('button', '', '강화'); tabUp.dataset.tab = 'up'; document.querySelector('#shop .tabs').appendChild(tabUp);
  tabUp.onclick = () => { shopTab = 'up'; renderShop(); };
}
function questProg(id) { // [지금, 목표]
  const q = QUESTS[id];
  if (q.type === 'collect') return [Math.min(q.n, me.inv.items[q.key] || 0), q.n];
  return [quests.active[id] || 0, q.n];
}
function renderQuest() {
  if (!$('quest') || $('quest').hidden) return;
  const stones = me.inv.items.windstone || 0;
  $('questTip').textContent = wind.bridge
    ? '바람의 다리가 열려 있어요. 고마워요, 바람잡이!'
    : `바람의 돌을 모아 분수의 수정에 바치면 두 섬을 잇는 다리가 열려요. 지금 ${Math.min(wind.n, wind.need)}/${wind.need}개${stones ? ` · 내 가방에 ${stones}개` : ''}`;
  const list = $('questList'); list.textContent = '';
  for (const id of ARCA.QUEST_IDS) {
    const q = QUESTS[id], active = quests.active[id] !== undefined, [n, need] = questProg(id), done = quests.done[id] || 0;
    const reward = `${q.gold}G · 경험치 ${q.xp}${q.stones ? ` · 🌀×${q.stones}` : ''}`;
    const sub = `${q.desc} (추천 Lv ${q.lv}${done ? ` · ${done}번 해결` : ''})`;
    const btns = !active ? [['맡기', true, () => net({ t: 'qtake', id })]]
      : n >= need ? [['완료!', true, () => net({ t: 'qdone', id })]]
      : [[`${n}/${need}`, false, () => {}], ['그만두기', true, () => net({ t: 'qdrop', id })]];
    list.appendChild(shopRow(active ? (n >= need ? '✅' : '📌') : '📜', q.name, sub, reward, btns));
  }
}
function renderTrack() {
  const box = $('qtrack'); if (!box) return;
  box.textContent = '';
  box.appendChild(el('div', 'w', wind.bridge ? '🌉 바람의 다리 열림' : `🌀 바람의 돌 ${Math.min(wind.n, wind.need)}/${wind.need}`));
  const left = buffUntil - performance.now();
  if (left > 0) box.appendChild(el('div', 'ok', `🍢 공격력 +15% · ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`));
  for (const id in quests.active) {
    const [n, need] = questProg(id);
    box.appendChild(el('div', n >= need ? 'ok' : '', `${n >= need ? '✅' : '📌'} ${QUESTS[id].name} ${n}/${need}`));
  }
}
function updateElder(dt) {
  const d = Math.hypot(me.x - ELDER.x, me.z - ELDER.z);
  elderAv.rotation.y = lerpAngle(elderAv.rotation.y, d < 9 ? Math.atan2(me.x - ELDER.x, me.z - ELDER.z) : ELDER.ry, Math.min(1, dt * 4));
  animate(elderAv, !$('quest').hidden ? ANIM.wave : ANIM.idle, dt);
  placeTag(elderTag, elderAv, dt, 2.5, 40);
  const near = d < ARCA.TALK_RANGE - 1 && !me.dead;
  if (near !== nearElderNow) { nearElderNow = near; $('elderHint').hidden = !near; if (!near) $('quest').hidden = true; }
  const altar = Math.hypot(me.x, me.z) < ARCA.ALTAR_RANGE - 0.5 && !me.dead && (me.inv.items.windstone || 0) > 0;
  if (altar !== nearAltar) { nearAltar = altar; $('altarHint').hidden = !altar; }
  if (bridgeT < 3) { // 다리가 열릴 때 서쪽부터 차례로 나타남
    bridgeT += dt;
    const n = bridgeMesh.children.length;
    bridgeMesh.children.forEach((c, i) => { c.visible = i / n < bridgeT / 2.5; });
  }
}
$('quest').querySelector('.x').onclick = () => { $('quest').hidden = true; };

// ================= 기록 · 칭호 · 순위 · 결투 =================
let myst = { kills: 0, boss: 0, wins: 0, loses: 0, quests: 0 }, myTitle = '', rankData = null, duelOp = 0, duelStart = 0, knownTitles = null;
function myStats() { return { lv: me.lv, gold: me.inv.gold, fish: myst.fish || 0, kills: myst.kills, boss: myst.boss, wins: myst.wins, quests: myst.quests, maxUp: Math.max(0, ...Object.values(me.inv.up || {})) }; }
function earnedTitles() { const st = myStats(); return ARCA.TITLE_IDS.filter((id) => ARCA.TITLES[id].ok(st)); }
function checkNewTitles() { // 새 칭호를 얻으면 알려 줌
  const now = earnedTitles();
  if (knownTitles) for (const id of now) if (!knownTitles.includes(id)) { toast(`🏅 새 칭호: ${ARCA.TITLES[id].name}`); addLog(`🏅 새 칭호를 얻었어요: 〈${ARCA.TITLES[id].name}〉 — 기록 창(L)에서 달 수 있어요`); }
  knownTitles = now;
}
{
  const panel = el('div', 'panel'); panel.id = 'record'; panel.hidden = true;
  panel.innerHTML = '<div class="phead"><b>🏆 기록 · 칭호 · 순위</b><button class="x" aria-label="닫기">✕</button></div><div class="ptitle">내 기록</div><div id="recStats" class="recstats"></div><div class="ptitle">칭호 <small>눌러서 이름표 위에 달아요</small></div><div id="recTitles" class="chips"></div><div class="ptitle">지금 접속한 사람들의 순위 <small id="recN"></small></div><div id="recRank" class="rank3"></div>';
  $('hud').appendChild(panel);
  panel.querySelector('.x').onclick = () => { panel.hidden = true; };
  const btn = el('button', '', '🏆 기록 '); btn.id = 'recordBtn'; btn.appendChild(el('small', '', '(L)')); btn.onclick = () => openPanel('record');
  $('hud').appendChild(btn);
  const inPeople = el('button', 'wide-btn', '🏆 기록 · 칭호 · 순위 보기'); inPeople.onclick = () => openPanel('record', true);
  $('people').appendChild(inPeople);
}
function renderRecord() {
  if (!$('record') || $('record').hidden) return;
  const box = $('recStats'); box.textContent = '';
  for (const [label, v] of [['🗡️ 사냥', myst.kills], ['⚡ 골렘', myst.boss], ['⚔️ 결투', `${myst.wins}승 ${myst.loses}패`], ['📜 의뢰', myst.quests], ['🎣 낚시', myst.fish || 0]]) {
    const d = el('div'); d.append(el('small', '', label), el('b', '', String(v))); box.appendChild(d);
  }
  const st = myStats(), tl = $('recTitles'); tl.textContent = '';
  const none = el('button', myTitle ? '' : 'on', '칭호 없음'); none.onclick = () => net({ t: 'title', id: '' }); tl.appendChild(none);
  for (const id of ARCA.TITLE_IDS) {
    const t = ARCA.TITLES[id], ok = t.ok(st), b = el('button', id === myTitle ? 'on' : '', ok ? t.name : `🔒 ${t.name}`);
    b.title = t.how; b.disabled = !ok;
    if (!ok) b.appendChild(el('small', '', ` ${t.how}`));
    b.onclick = () => net({ t: 'title', id });
    tl.appendChild(b);
  }
  const rk = $('recRank'); rk.textContent = '';
  if (!rankData) { rk.appendChild(el('div', 'empty', '순위를 불러오는 중…')); return; }
  $('recN').textContent = `${rankData.n}명 접속 중`;
  for (const [label, key, unit] of [['레벨', 'lv', 'Lv'], ['결투 승', 'wins', '승'], ['사냥', 'kills', '마리']]) {
    const col = el('div'); col.appendChild(el('b', '', label));
    const rows = rankData[key];
    if (!rows.length) col.appendChild(el('small', '', '아직 없어요'));
    rows.forEach(([name, v, mine], i) => { const r = el('div', mine ? 'mine' : '', `${['🥇', '🥈', '🥉', '4.', '5.'][i]} ${name}`); r.appendChild(el('span', '', unit === 'Lv' ? `Lv${v}` : `${v}${unit}`)); col.appendChild(r); });
    rk.appendChild(col);
  }
}

// ================= 구름 낚시 · 요리 · 펫 =================
let fishState = null, buffUntil = 0, canFishNow = false, canCookNow = false, buffTick = 0;
const bobber = new THREE.Group();
{
  const ball = mesh(new THREE.SphereGeometry(0.18, 8, 6), '#fa5252', null, false); bobber.add(ball);
  const top = mesh(new THREE.SphereGeometry(0.1, 6, 5), '#ffffff', null, false); top.position.y = 0.16; bobber.add(top);
  bobber.visible = false; scene.add(bobber);
}
const fishLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff }));
fishLine.visible = false; fishLine.frustumCulled = false; scene.add(fishLine);
{
  const hints = $('hints');
  const mk = (id, text, fn) => { const d = el('div'); d.id = id; d.hidden = true; const b = el('button', '', text); b.onclick = fn; d.appendChild(b); hints.appendChild(d); };
  mk('fishHint', '🎣 구름 낚시 (X)', () => fishKey());
  mk('cookHint', '🍢 모닥불에 생선 굽기 (C)', () => net({ t: 'cook' }));
}
function stopFishing() { fishState = null; bobber.visible = false; fishLine.visible = false; me.actT = 0; }
function fishKey() { // X: 던지기 / 당기기
  if (!joined || me.dead) return;
  if (fishState) { net({ t: 'reel' }); return; }
  if (!ARCA.canFish(me.x, me.z) || !me.onGround) { toast('낚시는 섬 가장자리에 서서 할 수 있어요'); return; }
  const I = ARCA.islandOf(me.x, me.z);
  me.ry = Math.atan2(me.x - I.x, me.z - I.z); // 구름 쪽을 바라봄
  me.emote = 0;
  net({ t: 'm', p: [+me.x.toFixed(2), +me.y.toFixed(2), +me.z.toFixed(2), +me.ry.toFixed(2)], a: ANIM.cast });
  net({ t: 'fish' });
}
function rawFishCount() { let n = 0; for (const id of ITEM_IDS) if (ITEMS[id].type === 'fish') n += me.inv.items[id] || 0; return n; }
let safeNow = null;
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(ARCA.SAFE_R - 0.25, ARCA.SAFE_R, 72), flatMat(0x74c0fc, 0.45));
  ring.rotation.x = -Math.PI / 2; ring.position.y = islandH(ARCA.SAFE_R, 0) + 0.25; scene.add(ring);
  const badge = el('span'); badge.id = 'safeBadge'; badge.textContent = ' · 🛡️ 안전 구역'; badge.hidden = true; $('info').appendChild(badge);
}
function updateLeisure(dt) {
  const now = performance.now();
  const safe = ARCA.inSafe(me.x, me.z);
  if (safe !== safeNow) { if (safeNow !== null) toast(safe ? '🛡️ 광장에 들어왔어요. 여기는 몬스터가 못 와요' : '⚠️ 광장을 나왔어요. 몬스터를 조심해요'); safeNow = safe; $('safeBadge').hidden = !safe; }
  if (fishState) {
    const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => keys.has(k)) || Math.hypot(joy.x, joy.y) > 0.2;
    if (moving || me.dead) { stopFishing(); toast('낚시를 그만뒀어요'); }
    else {
      me.actA = ANIM.cast; me.actT = 0.3;
      const fx = Math.sin(me.ry), fz = Math.cos(me.ry), bit = now >= fishState.biteAt;
      if (bit && !fishState.bit) { fishState.bit = true; toast('❗ 지금이에요! X 를 눌러 당겨요'); pop('❗', me.x + fx * 2, me.y + 2.2, me.z + fz * 2, 'lvup'); }
      if (now > fishState.biteAt + fishState.window + 400 && !fishState.late) { fishState.late = true; net({ t: 'reel' }); } // 너무 늦으면 서버가 놓쳤다고 알려 줌
      bobber.visible = fishLine.visible = true;
      bobber.position.set(me.x + fx * 7, me.y - 3 + Math.sin(now / (bit ? 60 : 400)) * (bit ? 0.25 : 0.1), me.z + fz * 7);
      const pos = fishLine.geometry.attributes.position;
      pos.setXYZ(0, me.x + fx * 0.6, me.y + 1.5, me.z + fz * 0.6); pos.setXYZ(1, bobber.position.x, bobber.position.y, bobber.position.z); pos.needsUpdate = true;
    }
  }
  const cf = !fishState && !me.dead && me.onGround && ARCA.canFish(me.x, me.z);
  if (cf !== canFishNow) { canFishNow = cf; $('fishHint').hidden = !cf; }
  let cook = false;
  if (!me.dead && rawFishCount() > 0) for (const e of decos.values()) if (e.d.k === 'campfire' && Math.hypot(e.d.x - me.x, e.d.z - me.z) < ARCA.COOK_RANGE) { cook = true; break; }
  if (cook !== canCookNow) { canCookNow = cook; $('cookHint').hidden = !cook; }
  if (buffUntil && (buffTick += dt) > 1) { buffTick = 0; if (now > buffUntil) buffUntil = 0; renderTrack(); }
}
// 펫: 주인 뒤를 따라다니는 작은 친구 (꾸밈용)
function makePet(kind) {
  const g = new THREE.Group();
  if (kind === 'slimy') {
    const b = mesh(new THREE.SphereGeometry(0.32, 10, 8), '#8ce99a', { transparent: true, opacity: 0.9, roughness: 0.3 }); b.scale.y = 0.75; b.position.y = 0.24; g.add(b);
    for (const x of [-0.1, 0.1]) { const e = mesh(new THREE.SphereGeometry(0.04, 5, 5), '#222', null, false); e.position.set(x, 0.3, 0.27); g.add(e); }
  } else if (kind === 'shelly') {
    const sh = mesh(new THREE.DodecahedronGeometry(0.34, 0), '#5c7a3a'); sh.scale.y = 0.6; sh.position.y = 0.28; g.add(sh);
    const hd = mesh(new THREE.SphereGeometry(0.14, 7, 6), '#8f9c5a'); hd.position.set(0, 0.24, 0.38); g.add(hd);
    for (const x of [-0.06, 0.06]) { const e = mesh(new THREE.SphereGeometry(0.03, 5, 5), '#222', null, false); e.position.set(x, 0.29, 0.49); g.add(e); }
  } else if (kind === 'firefly') {
    const b = mesh(new THREE.IcosahedronGeometry(0.12, 0), '#fff3bf', { emissive: '#ffd43b', emissiveIntensity: 1.5 }, false); g.add(b);
    for (const x of [-0.14, 0.14]) { const w = mesh(new THREE.SphereGeometry(0.09, 5, 4), '#e7f5ff', { transparent: true, opacity: 0.6 }, false); w.scale.set(1, 0.2, 0.6); w.position.set(x, 0.06, 0); g.add(w); }
  } else { // whale
    const b = mesh(new THREE.SphereGeometry(0.42, 10, 8), '#74c0fc'); b.scale.set(0.8, 0.7, 1.25); g.add(b);
    const belly = mesh(new THREE.SphereGeometry(0.36, 8, 6), '#e7f5ff'); belly.scale.set(0.75, 0.5, 1.1); belly.position.y = -0.12; g.add(belly);
    const tail = mesh(new THREE.ConeGeometry(0.22, 0.3, 4), '#4dabf7'); tail.rotation.x = -Math.PI / 2; tail.position.z = -0.62; tail.scale.x = 1.8; g.add(tail);
    for (const x of [-0.24, 0.24]) { const e = mesh(new THREE.SphereGeometry(0.04, 5, 5), '#222', null, false); e.position.set(x, 0.06, 0.4); g.add(e); }
  }
  return g;
}
function setPet(o, kind) {
  kind = ARCA.PETS[kind] ? kind : '';
  if (o.petKind === kind) return;
  if (o.petMesh) scene.remove(o.petMesh);
  o.petKind = kind; o.petMesh = null;
  if (kind) { o.petMesh = makePet(kind); o.petT = Math.random() * 9; scene.add(o.petMesh); if (o.av) o.petMesh.position.copy(o.av.position); }
}
function updatePet(o, dt) {
  const m = o.petMesh; if (!m || !o.av) return;
  o.petT += dt;
  const av = o.av, k = o.petKind, fly = k === 'firefly' || k === 'whale';
  let tx, tz, ty;
  if (k === 'firefly') { tx = av.position.x + Math.cos(o.petT * 1.6) * 0.9; tz = av.position.z + Math.sin(o.petT * 1.6) * 0.9; ty = av.position.y + 2.3 + Math.sin(o.petT * 3) * 0.15; }
  else {
    tx = av.position.x - Math.sin(av.rotation.y) * 1.3 + Math.cos(av.rotation.y) * 0.8; tz = av.position.z - Math.cos(av.rotation.y) * 1.3 - Math.sin(av.rotation.y) * 0.8;
    ty = fly ? av.position.y + 1.5 + Math.sin(o.petT * 2) * 0.2 : av.position.y;
  }
  const dx = tx - m.position.x, dz = tz - m.position.z, d = Math.hypot(dx, dz);
  if (d > 25) m.position.set(tx, ty, tz);
  const sp = Math.min(1, dt * (k === 'shelly' ? 2.2 : 5));
  m.position.x += dx * sp; m.position.z += dz * sp;
  const hop = k === 'slimy' && d > 0.25 ? Math.abs(Math.sin(o.petT * 9)) * 0.35 : 0;
  m.position.y += (ty + hop - m.position.y) * Math.min(1, dt * 8);
  if (d > 0.1 && k !== 'firefly') m.rotation.y = lerpAngle(m.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 8));
}

// ================= 꾸미기 =================
const decos = new Map(); // id -> { d, obj, tag, flame }
function makeDeco(d) {
  const g = new THREE.Group(), col = d.color || '#4dabf7';
  let flame = null;
  if (d.k === 'campfire') {
    for (let i = 0; i < 3; i++) { const log = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 5), '#6b3f1f'); log.rotation.z = Math.PI / 2; log.rotation.y = i * 1.05; log.position.y = 0.12; g.add(log); }
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const st = mesh(new THREE.DodecahedronGeometry(0.16, 0), '#868e96'); st.position.set(Math.cos(a) * 0.65, 0.1, Math.sin(a) * 0.65); g.add(st); }
    flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0xff922b })); flame.position.y = 0.6;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.55, 5), new THREE.MeshBasicMaterial({ color: 0xffe066 })); inner.position.y = -0.1; flame.add(inner);
    g.add(flame);
  } else if (d.k === 'tent') {
    const t = mesh(new THREE.ConeGeometry(1.7, 2.2, 4), col); t.position.y = 1.1; t.rotation.y = Math.PI / 4;
    const door = mesh(new THREE.BoxGeometry(0.7, 1.1, 0.05), '#343a40'); door.position.set(0, 0.55, 0.93); door.rotation.x = -0.5;
    g.add(t, door);
  } else if (d.k === 'bench') {
    const seat = mesh(new THREE.BoxGeometry(1.6, 0.1, 0.5), '#a0723a'); seat.position.y = 0.45;
    const back = mesh(new THREE.BoxGeometry(1.6, 0.5, 0.08), '#a0723a'); back.position.set(0, 0.8, -0.22);
    g.add(seat, back);
    [-0.65, 0.65].forEach((x) => { const leg = mesh(new THREE.BoxGeometry(0.1, 0.45, 0.45), '#7a4b2a'); leg.position.set(x, 0.22, 0); g.add(leg); });
  } else if (d.k === 'lamp') {
    const pole = mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6), '#495057'); pole.position.y = 1.2;
    const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), new THREE.MeshBasicMaterial({ color: 0xffe8a3 })); glow.position.y = 2.55;
    const capT = mesh(new THREE.ConeGeometry(0.34, 0.22, 6), '#343a40'); capT.position.y = 2.9;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.16, depthWrite: false })); halo.position.y = 2.55;
    g.add(pole, glow, capT, halo);
  } else if (d.k === 'flag') {
    const pole = mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), '#ced4da'); pole.position.y = 1.5;
    const cloth = mesh(new THREE.BoxGeometry(1.1, 0.7, 0.04), col); cloth.position.set(0.6, 2.55, 0);
    g.add(pole, cloth);
  } else if (d.k === 'flower') {
    const pot = mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.4, 7), '#c2703d'); pot.position.y = 0.2;
    g.add(pot);
    ['#ff8787', '#ffd43b', '#da77f2'].forEach((c, i) => { const f = mesh(new THREE.IcosahedronGeometry(0.16, 0), c); f.position.set(Math.cos(i * 2.1) * 0.14, 0.62 + i * 0.07, Math.sin(i * 2.1) * 0.14); g.add(f); });
    const leaf = mesh(new THREE.ConeGeometry(0.2, 0.35, 5), '#2f9e44'); leaf.position.y = 0.5; g.add(leaf);
  } else { // sign
    const post = mesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), '#7a4b2a'); post.position.y = 0.65;
    const board = mesh(new THREE.BoxGeometry(1.3, 0.6, 0.08), '#c8955a'); board.position.y = 1.35;
    g.add(post, board);
  }
  return { obj: g, flame };
}
function addDeco(d) {
  if (decos.has(d.id) || !DECOS[d.k]) return;
  const { obj, flame } = makeDeco(d);
  obj.position.set(d.x, islandH(d.x, d.z), d.z); obj.rotation.y = d.ry;
  scene.add(obj);
  let tag = null;
  if (d.k === 'sign') { tag = makeTag(`🪧 ${d.text || '…'}`); tag.el.classList.add('sign'); tag.el.title = d.name; }
  decos.set(d.id, { d, obj, tag, flame });
}
function removeDeco(id) {
  const e = decos.get(id); if (!e) return;
  scene.remove(e.obj); if (e.tag) e.tag.el.remove(); decos.delete(id);
}
function myDecos() { return [...decos.values()].filter((e) => e.d.o === me.id); }
function saveDecos() { store.set('arca.deco', JSON.stringify(myDecos().map(({ d }) => ({ k: d.k, x: d.x, z: d.z, ry: d.ry, text: d.text })))); }
function renderDeco() {
  if ($('deco').hidden) return;
  const mine = myDecos(), box = $('decoMine'); box.textContent = '';
  $('decoCount').textContent = `${mine.length} / ${ARCA.DECO_MAX}개`;
  if (!mine.length) box.appendChild(el('div', 'empty', '아직 놓은 물건이 없어요'));
  for (const { d } of mine) {
    const def = DECOS[d.k], r = el('div', 'prow'), b = el('button', 'gray', '치우기');
    b.onclick = () => net({ t: 'decodel', id: d.id });
    r.append(el('span', 'who', `${def.icon} ${def.name}${d.text ? ` "${d.text}"` : ''}`), b); box.appendChild(r);
  }
  const list = $('decoList'); list.textContent = '';
  for (const [k, def] of Object.entries(DECOS)) {
    const ok = me.inv.gold >= def.price && mine.length < ARCA.DECO_MAX;
    list.appendChild(shopRow(def.icon, def.name, def.text ? '위 칸에 쓴 말이 팻말 위에 떠요' : '', `${def.price}G`, [['놓기', ok, () => net({ t: 'deco', k, text: $('signText').value })]]));
  }
}
function updateDecos(dt) {
  for (const e of decos.values()) {
    if (e.flame) { const f = 1 + Math.sin(time * 13 + e.d.id) * 0.12; e.flame.scale.set(f, 1 + Math.sin(time * 9 + e.d.id * 2) * 0.2, f); }
    if (e.tag) placeTag(e.tag, e.obj, dt, 2.1, 30);
  }
}

// ================= 낮과 밤 =================
let dayPhase = 0.1, dayMs = ARCA.DAY_MS, phaseAt = performance.now(), nightShown = -1;
const curPhase = () => (dayPhase + (performance.now() - phaseAt) / dayMs) % 1;
const cDay = { fog: new THREE.Color(0xbfe3ff), cloud: new THREE.Color(0xffffff) }, cNight = { fog: new THREE.Color(0x1a2140), cloud: new THREE.Color(0x56608a) }, cDusk = new THREE.Color(0xffa94d);
function updateSky() {
  const ph = curPhase();
  // 밤의 정도: 노을(0.62~0.7)에 어두워지고 새벽(0.93~1)에 밝아짐
  const n = ph < 0.62 ? 0 : ph < 0.7 ? (ph - 0.62) / 0.08 : ph < 0.93 ? 1 : 1 - (ph - 0.93) / 0.07;
  const dusk = Math.max(0, 1 - Math.abs(n - 0.5) * 2) * 0.6; // 노을빛
  skyMat.color.setRGB(1 - 0.86 * n, 1 - 0.84 * n, 1 - 0.66 * n).lerp(cDusk, dusk * 0.5);
  scene.fog.color.copy(cDay.fog).lerp(cNight.fog, n).lerp(cDusk, dusk * 0.35);
  hemi.intensity = 0.85 - 0.5 * n; sun.intensity = 0.95 - 0.78 * n;
  sun.color.setRGB(1, 0.96 - 0.1 * n, 0.88 + 0.12 * n).lerp(cDusk, dusk * 0.5);
  stars.material.opacity = Math.max(0, n * 1.3 - 0.3);
  mat('#ffffff', { roughness: 1, transparent: true, opacity: 0.92 }).color.copy(cDay.cloud).lerp(cNight.cloud, n);
  const night = ARCA.isNightPhase(ph) ? 1 : 0, hour = Math.floor((6 + ph * 24) % 24);
  const label = `${night ? '🌙' : n > 0 ? '🌇' : '☀️'} ${hour}시`;
  if ($('clock').textContent !== label) $('clock').textContent = label;
  if (night !== nightShown) { nightShown = night; document.body.classList.toggle('night', !!night); }
}

// ================= 사람들 / 파티 / 거래 / 보스 =================
let party = [], partyIds = new Set(), trade = null, bossAlive = false, bossAt = 0, pendingAsk = null, askTimer = 0;
function renderPeople() {
  if ($('people').hidden) return;
  const pl = $('partyList'); pl.textContent = '';
  if (!party.length) pl.appendChild(el('div', 'empty', '아직 파티가 없어요. 아래에서 초대해 보세요!'));
  else {
    for (const q of party) {
      const r = el('div', 'prow'), who = el('span', 'who', q.id === me.id ? `${q.name} (나)` : q.name);
      r.appendChild(who); pl.appendChild(r);
    }
    const r = el('div', 'prow'), b = el('button', 'gray', '파티 나가기');
    b.onclick = () => net({ t: 'pleave' });
    r.append(el('span', 'who', `${party.length} / ${ARCA.PARTY_MAX}명`), b); pl.appendChild(r);
  }
  const list = $('peopleList'); list.textContent = '';
  if (!others.size) { list.appendChild(el('div', 'empty', '지금은 혼자예요. 친구에게 주소를 보내 보세요!')); return; }
  for (const [id, o] of others) {
    const r = el('div', 'prow'), who = el('span', 'who', o.name);
    who.appendChild(el('small', '', `Lv${o.lv || 1}`));
    const inv = el('button', '', partyIds.has(id) ? '같은 파티' : '파티 초대');
    inv.disabled = partyIds.has(id) || party.length >= ARCA.PARTY_MAX;
    inv.onclick = () => net({ t: 'pinvite', id });
    const tr = el('button', '', '거래');
    tr.onclick = () => net({ t: 'treq', id });
    const du = el('button', '', '결투');
    du.disabled = !!duelOp;
    du.onclick = () => net({ t: 'dreq', id });
    r.append(who, inv, tr, du); list.appendChild(r);
  }
}
function renderPartyBox() {
  const box = $('partyBox'); box.textContent = '';
  for (const q of party) {
    if (q.id === me.id) continue;
    const d = el('div', 'pm'); d.dataset.id = q.id;
    const bar = el('div', 'bar'); bar.appendChild(el('i'));
    d.append(el('span', '', `💚 ${q.name}`), bar); box.appendChild(d);
  }
}
function updatePartyBox() {
  for (const d of $('partyBox').children) {
    const o = others.get(Number(d.dataset.id)); if (!o) continue;
    d.querySelector('i').style.width = (o.hp === undefined ? 100 : o.hp) + '%';
    d.classList.toggle('far', Math.hypot(o.av.position.x - me.x, o.av.position.z - me.z) > ARCA.PARTY_SHARE_RANGE);
  }
  const bt = $('bossTimer');
  if (bossAlive) bt.textContent = '';
  else { const left = Math.max(0, Math.ceil((bossAt - performance.now()) / 1000)); bt.textContent = `⚡ 보스까지 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; }
}
function showAsk(m) {
  pendingAsk = m;
  $('askText').textContent = m.kind === 'party' ? `👥 ${m.name} 님이 파티에 초대했어요` : m.kind === 'duel' ? `⚔️ ${m.name} 님이 결투를 신청했어요` : `🤝 ${m.name} 님이 거래를 신청했어요`;
  $('ask').hidden = false;
  clearTimeout(askTimer); askTimer = setTimeout(() => answerAsk(false), 15000);
}
function answerAsk(yes) {
  if (!pendingAsk) return;
  net({ t: 'answer', kind: pendingAsk.kind, from: pendingAsk.from, yes });
  pendingAsk = null; clearTimeout(askTimer); $('ask').hidden = true;
}
$('askYes').onclick = () => answerAsk(true);
$('askNo').onclick = () => answerAsk(false);

function sendOffer() { if (trade) net({ t: 'toffer', gold: trade.mine.gold, items: trade.mine.items }); }
function tradeCells(box, items, onClick) {
  box.textContent = '';
  for (const id of ITEM_IDS) {
    const n = items[id]; if (!n) continue;
    const it = ITEMS[id], b = el('button', 'cell');
    b.append(el('span', '', it.icon), el('span', 'n', String(n)));
    b.title = it.name;
    if (onClick) b.onclick = () => onClick(id); else b.disabled = true;
    box.appendChild(b);
  }
}
function renderTrade() {
  if (!trade || $('trade').hidden) return;
  const mine = trade.mine;
  if (document.activeElement !== $('tGold')) $('tGold').value = mine.gold;
  $('tGold').max = me.inv.gold;
  $('tGoldTheirs').textContent = trade.theirs.gold;
  $('tOkMine').textContent = trade.okMine ? '✅ 확인함' : ''; $('tOkTheirs').textContent = trade.okTheirs ? '✅ 확인함' : '고르는 중…';
  tradeCells($('tMine'), mine.items, (id) => { mine.items[id]--; if (!mine.items[id]) delete mine.items[id]; sendOffer(); });
  tradeCells($('tTheirs'), trade.theirs.items);
  const left = {};
  for (const id of ITEM_IDS) { const n = (me.inv.items[id] || 0) - (mine.items[id] || 0); if (n > 0) left[id] = n; }
  tradeCells($('tBag'), left, (id) => { mine.items[id] = (mine.items[id] || 0) + 1; sendOffer(); });
  if (!$('tBag').children.length) $('tBag').appendChild(el('div', 'empty', '올릴 물건이 없어요'));
  $('tOk').textContent = trade.okMine ? '확인함 ✓ (상대를 기다려요)' : '확인';
  $('tOk').classList.toggle('done', trade.okMine);
}
$('tGold').addEventListener('input', () => {
  if (!trade) return;
  trade.mine.gold = Math.max(0, Math.min(me.inv.gold, Math.floor(Number($('tGold').value) || 0)));
  sendOffer();
});
$('tOk').onclick = () => { if (trade && !trade.okMine) net({ t: 'tok' }); };
$('tCancel').onclick = $('trade').querySelector('.x').onclick = () => net({ t: 'tcancel' });
$('shopHint').querySelector('button').onclick = () => openPanel('shop', true);
function updateMerchant(dt) {
  // 상인은 가까이 온 사람을 바라봄
  const d = Math.hypot(me.x - MERCHANT.x, me.z - MERCHANT.z);
  const face = d < 9 ? Math.atan2(me.x - MERCHANT.x, me.z - MERCHANT.z) : MERCHANT.ry;
  merchantAv.rotation.y = lerpAngle(merchantAv.rotation.y, face, Math.min(1, dt * 4));
  animate(merchantAv, d < 4 && d > 0 && !$('shop').hidden ? ANIM.wave : ANIM.idle, dt);
  placeTag(merchantTag, merchantAv, dt, 2.6, 40);
  const near = d < SHOP_RANGE - 1 && !me.dead;
  if (near !== nearMerchant) { nearMerchant = near; $('shopHint').hidden = !near; if (!near) $('shop').hidden = true; }
}
addEventListener('keydown', (e) => {
  if (!everJoined) return;
  if (e.target === sayEl) {
    if (e.key === 'Enter') {
      if (e.isComposing) return; // 한글 입력 중 Enter 는 글자 확정
      const text = sayEl.value.trim(); sayEl.value = '';
      if (text) net({ t: 'chat', text });
      sayEl.blur();
    } else if (e.key === 'Escape') sayEl.blur();
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter') { e.preventDefault(); sayEl.focus(); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpQueued = true; }
  if (!e.repeat) {
    if (e.code === 'Digit1') doEmote(1);
    if (e.code === 'Digit2') doEmote(2);
    if (e.code === 'Digit3') doEmote(3);
    if (e.code === 'KeyF' || e.code === 'KeyJ') tryAttack(0);
    if (e.code === 'KeyQ') tryAttack(1);
    if (e.code === 'KeyE') tryAttack(2);
    if (e.code === 'KeyR') tryAttack(3);
    if (e.code === 'KeyH') drinkPotion();
    if (e.code === 'KeyI') openPanel('bag');
    if (e.code === 'KeyP') openPanel('people');
    if (e.code === 'KeyK') openPanel('deco');
    if (e.code === 'KeyL') openPanel('record');
    if (e.code === 'KeyX') fishKey();
    if (e.code === 'KeyC') net({ t: 'cook' });
    if (e.code === 'KeyT') { if (nearElderNow) openPanel('quest'); else toast('의뢰는 광장의 촌장 루루 가까이에서 볼 수 있어요'); }
    if (e.code === 'KeyV') net({ t: 'donate' });
    if (e.code === 'KeyG') glideQueued = true;
    if (e.code === 'KeyB') { if (nearMerchant) openPanel('shop'); else toast('상점은 광장의 상인 모모 가까이에서 열 수 있어요'); }
    if (e.code === 'Escape') { $('bag').hidden = true; $('shop').hidden = true; $('people').hidden = true; $('deco').hidden = true; }
  }
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
sayEl.addEventListener('focus', () => keys.clear());

// 마우스 / 손가락으로 끌면 시점 돌리기, 짧게 누르면 공격
let lookId = null, lastX = 0, lastY = 0, downX = 0, downY = 0, downT = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (lookId !== null) return;
  lookId = e.pointerId; lastX = downX = e.clientX; lastY = downY = e.clientY; downT = performance.now();
  canvas.setPointerCapture(e.pointerId);
  if (document.activeElement === sayEl) sayEl.blur();
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookId) return;
  const s = e.pointerType === 'touch' ? 0.008 : 0.005;
  camYaw -= (e.clientX - lastX) * s;
  camPitch = Math.max(0.05, Math.min(1.25, camPitch + (e.clientY - lastY) * s));
  lastX = e.clientX; lastY = e.clientY;
});
const endLook = (e) => {
  if (e.pointerId !== lookId) return;
  lookId = null;
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (e.type === 'pointerup' && e.button === 0 && moved < 7 && performance.now() - downT < 350) tryAttack(0);
};
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', endLook);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); camDist = Math.max(4, Math.min(20, camDist + e.deltaY * 0.01)); }, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// 휴대폰
if (('ontouchstart' in window) || navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
{
  const stick = $('stick'), knob = $('knob');
  let sid = null, cx = 0, cy = 0;
  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; stick.setPointerCapture(sid); move(e); });
  const move = (e) => {
    if (e.pointerId !== sid) return;
    let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy), max = 45;
    if (d > max) { dx *= max / d; dy *= max / d; }
    joy.x = dx / max; joy.y = dy / max; setKnob(dx, dy);
  };
  stick.addEventListener('pointermove', move);
  const end = (e) => { if (e.pointerId !== sid) return; sid = null; joy.x = joy.y = 0; setKnob(0, 0); };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  $('tbtns').querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const act = b.dataset.act;
    if (act === 'jump') jumpQueued = true;
    else if (act === 'attack') tryAttack(0);
    else if (act === 'run') { runToggle = !runToggle; b.classList.toggle('on', runToggle); }
    else if (act === 'chat') sayEl.focus();
    else if (act === 'bag') openPanel('bag');
    else if (act === 'people') openPanel('people');
    else if (act === 'potion') drinkPotion();
    else if (act.startsWith('emote')) doEmote(Number(act.slice(5)));
  }));
}

// ================= 움직임 =================
function updateMe(dt) {
  let ix = 0, iz = 0;
  if (document.activeElement !== sayEl && !me.dead) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    ix += joy.x; iz -= joy.y;
  }
  let len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; len = 1; }
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = -fz, rz = fx;
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle;
  let speed = (running ? RUN : WALK) * len;
  if (me.actT > 0 && me.actA !== ANIM.spin) speed *= me.actA === ANIM.guard ? 0.5 : 0.35; // 기술 쓰는 동안은 천천히
  let mx = 0, mz = 0;
  if (me.dashT > 0) { // 돌진
    me.dashT -= dt;
    mx = Math.sin(me.ry) * me.dashDir; mz = Math.cos(me.ry) * me.dashDir; speed = me.dashDir > 0 ? DASH_SPEED : 22;
  } else if (len > 0.05) {
    mx = (fx * iz + rx * ix) / len; mz = (fz * iz + rz * ix) / len;
    if (me.actT <= 0) me.ry = lerpAngle(me.ry, Math.atan2(mx, mz), Math.min(1, dt * 12));
    if (me.emote) { me.emote = 0; me.emoteT = 0; }
  }
  if (me.glide && me.dashT <= 0) { mx = Math.sin(me.ry); mz = Math.cos(me.ry); speed = GLIDE_SPEED * (me.lift && me.y < UPDRAFT_TOP ? 0.25 : 1); } // 글라이더는 바라보는 쪽으로 계속 나아감 (바람 기둥 안에서는 천천히 떠오름)
  let vx = mx * speed, vz = mz * speed;
  if (curIsle.id === 2 && me.onGround && !me.glide && me.dashT <= 0 && !me.dead) { // 서리봉우리는 바닥이 미끄러워서 바로 서거나 꺾지 못함
    const k = Math.min(1, dt * 2.2);
    me.svx += (vx - me.svx) * k; me.svz += (vz - me.svz) * k; vx = me.svx; vz = me.svz;
  } else { me.svx = vx; me.svz = vz; }
  me.x += vx * dt; me.z += vz * dt;

  // 물건에 부딪히면 밀려나기
  for (const o of obstacles) {
    const dx = me.x - o.x, dz = me.z - o.z, d = Math.hypot(dx, dz), min = o.r + 0.45;
    if (d < min && d > 0.0001 && me.y < groundAt(o.x, o.z) + 6) { me.x = o.x + dx / d * min; me.z = o.z + dz / d * min; }
  }

  // 점프와 중력
  if (jumpQueued && me.onGround && !me.dead) { me.vy = JUMP; me.onGround = false; me.emote = 0; }
  else if ((jumpQueued || glideQueued) && !me.onGround && !me.dead) me.glide = !me.glide; // 공중에서 한 번 더 누르면 글라이더
  jumpQueued = glideQueued = false;
  const inDraft = UPDRAFTS.some((u) => Math.hypot(u.x - me.x, u.z - me.z) < u.r);
  if (inDraft && !updraftHint) { updraftHint = true; toast('🌬️ 바람 기둥! 점프한 뒤 공중에서 한 번 더 누르면 글라이더를 펴요'); addLog('🌬️ 바람 기둥에서 글라이더를 펴면 높이 올라가요. 그대로 옆 섬까지 날아갈 수 있어요!'); }
  // 낮은 곳에서 들어온 사람만 띄움 (높이 날아서 지나가는 사람은 그대로 통과)
  if (!inDraft || !me.glide) me.lift = false; else if (me.y < 11) me.lift = true;
  if (me.glide) me.vy = me.lift && me.y < UPDRAFT_TOP ? Math.min(11, me.vy + 45 * dt) : Math.max(-GLIDE_FALL, me.vy - GRAV * dt);
  else me.vy -= GRAV * dt;
  me.y += me.vy * dt;
  const g = groundAt(me.x, me.z);
  if (me.y <= g || (me.onGround && me.y - g < 0.6 && me.vy <= 0)) { me.y = g; me.vy = 0; me.onGround = true; me.glide = false; }
  else me.onGround = false;
  if (me.dead) me.glide = false;
  const isle = ARCA.islandOf(me.x, me.z);
  if (isle && isle !== curIsle && me.onGround) {
    curIsle = isle; $('isle').textContent = `${isle.icon} ${isle.name}`;
    toast(`${isle.icon} ${isle.name}에 도착!`);
    if (isle.id === 1) addLog('🍄 버섯숲은 Lv10 안팎의 몬스터가 살아요. 돌아갈 때는 서쪽 끝의 바람 기둥을 타세요');
    if (isle.id === 2) addLog('❄️ 서리봉우리는 Lv16이 넘는 몬스터가 살고 바닥이 미끄러워요. 돌아갈 때는 남쪽 끝의 바람 기둥을 타세요');
  }

  if (me.y < -45) { // 구름 아래로 떨어지면 광장으로
    me.x = SPAWN.x + (Math.random() - 0.5) * 4; me.z = SPAWN.z + Math.random() * 2; me.y = 6; me.vy = 0; me.ry = Math.PI; camYaw = 0; me.dashT = 0; me.glide = false;
    toast('구름 아래로 떨어졌다가 광장으로 돌아왔어요! ☁️');
  }

  // 쓰러졌을 때
  if (me.dead) {
    me.deadT -= dt;
    $('deadCount').textContent = String(Math.max(0, Math.ceil(me.deadT)));
    if (me.deadT <= 0) { net({ t: 'respawn' }); me.deadT = 1; }
  }

  if (me.actT > 0) me.actT -= dt;
  if (me.emoteT > 0 && me.emoteT < 900 && (me.emoteT -= dt) <= 0) me.emote = 0;
  me.a = me.dead ? ANIM.dead
    : me.actT > 0 ? me.actA
    : !me.onGround ? (me.glide ? ANIM.glide : ANIM.air)
    : len > 0.05 ? (running ? ANIM.run : ANIM.walk)
    : me.emote === 1 ? ANIM.wave : me.emote === 2 ? ANIM.dance : me.emote === 3 ? ANIM.sit : ANIM.idle;

  me.av.position.set(me.x, me.y, me.z);
  me.av.rotation.y = me.ry;
  animate(me.av, me.a, dt);
}

function updateCamera(dt) {
  const tx = me.x, ty = me.y + 1.6, tz = me.z;
  let cx = tx + Math.sin(camYaw) * Math.cos(camPitch) * camDist;
  let cz = tz + Math.cos(camYaw) * Math.cos(camPitch) * camDist;
  let cy = ty + Math.sin(camPitch) * camDist;
  const g = groundAt(cx, cz);
  if (cy < g + 0.6) cy = g + 0.6;
  if (shake > 0) { shake -= dt; const s = shake * 0.6; cx += (Math.random() - 0.5) * s; cy += (Math.random() - 0.5) * s; }
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, ty, tz);
}

let sendT = 0, lastSent = '', sameT = 0;
function sendMove(dt) {
  sendT += dt;
  if (sendT < 1 / 15 || me.dead) return;
  sendT = 0;
  const p = [+me.x.toFixed(2), +me.y.toFixed(2), +me.z.toFixed(2), +me.ry.toFixed(2)];
  const key = p.join(',') + ':' + me.a;
  // 가만히 있어도 1초에 한 번은 다시 보냄 (서버가 아는 내 위치가 뒤처졌을 때 따라잡도록)
  if (key === lastSent && (sameT += 1 / 15) < 1) return;
  lastSent = key; sameT = 0;
  net({ t: 'm', p, a: me.a });
}

function updateOthers(dt) {
  const k = 1 - Math.exp(-dt * 12);
  for (const o of others.values()) {
    const av = o.av;
    if (Math.hypot(o.tx - av.position.x, o.tz - av.position.z) > 15) av.position.set(o.tx, o.ty, o.tz);
    av.position.x += (o.tx - av.position.x) * k;
    av.position.y += (o.ty - av.position.y) * k;
    av.position.z += (o.tz - av.position.z) * k;
    av.rotation.y = lerpAngle(av.rotation.y, o.tr, k);
    animate(av, o.a, dt);
    placeTag(o.tag, av, dt, o.a === ANIM.sit ? 2.05 : o.a === ANIM.dead ? 1.2 : 2.5);
  }
}
function updateMonsters(dt) {
  const k = 1 - Math.exp(-dt * 10);
  for (const [id, mo] of monsters) {
    const av = mo.av;
    if (mo.dying) { // 퐁! 하고 사라지기
      mo.dying -= dt;
      av.scale.setScalar(Math.max(0.01, mo.dying / 0.4));
      av.position.y += dt * 2;
      if (mo.dying <= 0) removeMonster(id);
      continue;
    }
    if (av.scale.x < 1) av.scale.setScalar(Math.min(1, av.scale.x + dt * 3)); // 새로 나타날 때 커지기
    av.position.x += (mo.tx - av.position.x) * k;
    av.position.z += (mo.tz - av.position.z) * k;
    av.position.y = islandH(av.position.x, av.position.z);
    av.rotation.y = lerpAngle(av.rotation.y, mo.tr, k);
    animateMonster(mo, dt);
    placeTag(mo.tag, av, dt, MONSTERS[mo.kind].size * 1.4 + 0.5, 32);
  }
}

// ================= 작은 지도 =================
const mm = $('minimap').getContext('2d');
function drawMinimap() { // 내가 있는 섬을 보여 줌
  const I = curIsle, W = 150, c = W / 2, s = (W / 2 - 6) / I.R;
  const X = (x) => c + (x - I.x) * s, Z = (z) => c + (z - I.z) * s, on = (x, z, pad = 4) => Math.hypot(x - I.x, z - I.z) < I.R + pad;
  const dot = (x, z, r) => { mm.beginPath(); mm.arc(X(x), Z(z), r, 0, Math.PI * 2); mm.fill(); };
  mm.clearRect(0, 0, W, W);
  mm.fillStyle = I.id === 2 ? '#dbe4ff' : I.id ? '#3f8f7f' : '#69b34c'; dot(I.x, I.z, I.R * s);
  if (I.id === 0) {
    mm.fillStyle = '#e6d6ae'; dot(0, 0, 13 * s);
    mm.fillStyle = '#5fc1ff'; dot(0, 0, 3 * s);
    for (const h of houses) { mm.fillStyle = h.color; mm.fillRect(X(h.x) - 4, Z(h.z) - 4, 8, 8); }
  } else if (I.id === 2) { mm.fillStyle = '#74c0fc'; for (const t of LAYOUT.iceRocks) dot(t.x, t.z, 2.5); mm.fillStyle = '#5c8f7f'; for (const t of LAYOUT.frostTrees) dot(t.x, t.z, 1.6); }
  else { mm.fillStyle = '#e599f7'; for (const sh of LAYOUT.shrooms) dot(sh.x, sh.z, 2); }
  mm.strokeStyle = '#c5f6fa'; mm.lineWidth = 2;
  for (const u of UPDRAFTS) if (on(u.x, u.z, 8)) { mm.beginPath(); mm.arc(X(u.x), Z(u.z), 4, 0, Math.PI * 2); mm.stroke(); }
  mm.fillStyle = '#a0723a';
  for (const e of decos.values()) if (on(e.d.x, e.d.z)) mm.fillRect(X(e.d.x) - 1.5, Z(e.d.z) - 1.5, 3, 3);
  for (const mo of monsters.values()) {
    if (mo.dying || !on(mo.av.position.x, mo.av.position.z)) continue;
    mm.fillStyle = mo.kind === 'golem' ? '#9c36b5' : mo.kind === 'turtle' || mo.kind === 'giant' ? '#7a3b00' : '#e03131';
    dot(mo.av.position.x, mo.av.position.z, mo.kind === 'golem' ? 6 : mo.kind === 'giant' ? 5 : mo.kind === 'turtle' ? 3.5 : 2);
  }
  for (const [id, o] of others) {
    if (!on(o.av.position.x, o.av.position.z)) continue;
    mm.fillStyle = partyIds.has(id) ? '#40c057' : '#fff';
    dot(o.av.position.x, o.av.position.z, 3);
  }
  if (I.id === 0) { mm.fillStyle = '#ffd43b'; mm.strokeStyle = '#7a4b2a'; mm.lineWidth = 1.5; dot(MERCHANT.x, MERCHANT.z, 4); mm.stroke(); mm.fillStyle = '#ff922b'; dot(ARCA.ELDER.x, ARCA.ELDER.z, 4); mm.stroke(); }
  if (wind.bridge) { mm.strokeStyle = '#c9a06a'; mm.lineWidth = 4; mm.beginPath(); mm.moveTo(X(BRIDGE.x0), Z(0)); mm.lineTo(X(BRIDGE.x1), Z(0)); mm.stroke(); }
  mm.save(); mm.translate(X(me.x), Z(me.z)); mm.rotate(-me.ry + Math.PI);
  mm.fillStyle = '#1c7ed6'; mm.strokeStyle = '#fff'; mm.lineWidth = 1.5;
  mm.beginPath(); mm.moveTo(0, -7); mm.lineTo(5, 5); mm.lineTo(0, 2); mm.lineTo(-5, 5); mm.closePath(); mm.fill(); mm.stroke();
  mm.restore();
}

// ================= 매 프레임 =================
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

let last = performance.now(), mmT = 0, time = 0;
camera.position.set(30, 25, 50); camera.lookAt(0, 2, 0);
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;

  for (const c of clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > 260) c.position.x = -260; }
  for (const u of updraftFx) { const p = (time * 0.35 + u.off) % 1; u.ring.position.y = u.y0 + p * UPDRAFT_TOP; u.ring.material.opacity = 0.6 * Math.sin(p * Math.PI); u.ring.scale.setScalar(0.7 + p * 0.5); }
  updateSky();
  for (const f of farIslands) f.position.y = f.userData.baseY + Math.sin(time * 0.4 + f.userData.phase) * 1.5;
  fountainOrb.rotation.y += dt; fountainOrb.position.y = 3.4 + Math.sin(time * 2) * 0.15;

  if (everJoined) {
    updateMe(dt);
    updateCamera(dt);
    sendMove(dt);
    updateOthers(dt);
    updateMonsters(dt);
    updateMerchant(dt);
    updateElder(dt);
    updateLeisure(dt);
    snowFx.visible = curIsle.id === 2;
    if (snowFx.visible) {
      const sp = snowFx.geometry.attributes.position;
      for (let i = 0; i < sp.count; i++) { let y = sp.getY(i) - dt * 3.5; if (y < 0) y += 22; sp.setY(i, y); }
      sp.needsUpdate = true; snowFx.position.set(me.x, me.y - 4, me.z);
    }
    updatePet(me, dt); for (const o of others.values()) updatePet(o, dt);
    updateDecos(dt);
    placeTag(me.tag, me.av, dt, me.a === ANIM.sit ? 2.05 : me.a === ANIM.dead ? 1.2 : 2.5);
    updateSkillSlots();
    if ((mmT += dt) > 0.1) { mmT = 0; drawMinimap(); updatePartyBox(); }
  } else { // 접속 전에는 섬 주위를 천천히 돌기
    const a = time * 0.08;
    camera.position.set(Math.sin(a) * 75, 32, Math.cos(a) * 75); camera.lookAt(0, 2, 0);
  }
  updateEffects(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
refreshStats();

// 자동 확인용
window.__arca = { fish: () => fishState, fishKey: () => fishKey(), me, others: () => others.size, monsters: () => monsters, groundAt, tryAttack, net: (o) => net(o), openPanel, decos: () => decos, setPhase: (p) => { dayPhase = p; phaseAt = performance.now(); }, party: () => party, trade: () => trade, otherIds: () => [...others.keys()] };
})();
