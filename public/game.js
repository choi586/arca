// 구름섬 아르카 — 1단계: 섬 하나에서 여러 명이 함께 걷고 이야기하기
(() => {
'use strict';

// ================= 기본 설정 =================
const R = 62;                       // 섬 반지름
const SPAWN = { x: 0, z: 7 };
const WALK = 6, RUN = 10.5, GRAV = 26, JUMP = 9.5;
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#f8f9fa'];
const ANIM = { idle: 0, walk: 1, run: 2, air: 3, wave: 4, dance: 5, sit: 6 };
const EMOJI = { 1: '👋', 2: '💃', 3: '🪑' };

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 못 해도 괜찮음 */ } },
};
function rng(seed) { // 모두에게 같은 섬이 보이도록 같은 순서의 난수
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

// ================= 땅 높이 =================
function islandH(x, z) {
  const r = Math.hypot(x, z);
  const hills = 2.4 * Math.sin(x * 0.075 + 1.3) * Math.cos(z * 0.062 - 0.4) + 1.3 * Math.sin(x * 0.16 + z * 0.11) + 0.5 * Math.sin(x * 0.31 - z * 0.27);
  const bigHill = 9 * Math.exp(-((x - 20) ** 2 + (z + 30) ** 2) / 240);
  const flat = smooth(13, 27, r);
  const edge = smooth(R - 10, R, r);
  return Math.max(0.6, 2 + flat * (hills + 1.2 + bigHill) - edge * 2.2);
}
function groundAt(x, z) { return Math.hypot(x, z) > R ? -Infinity : islandH(x, z); }

// ================= 3D 화면 준비 =================
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe3ff, 130, 340);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 800);

scene.add(new THREE.HemisphereLight(0xe3f3ff, 0x6f8f4e, 0.85));
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
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
}

// ================= 섬 만들기 =================
const obstacles = [];   // { x, z, r } — 부딪히는 물건들
const houses = [];      // 작은 지도에 그릴 집
const rand = rng(20261120);

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
{
  const y = islandH(0, 0);
  const f = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.8, 12), '#b9b2a3'); base.position.y = 0.4;
  const water = mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.1, 12), '#5fc1ff', { roughness: 0.2, transparent: true, opacity: 0.85 }, false); water.position.y = 0.75;
  const pillar = mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 8), '#cfc7b6'); pillar.position.y = 1.5;
  const bowl = mesh(new THREE.CylinderGeometry(1.2, 0.4, 0.5, 10), '#cfc7b6'); bowl.position.y = 2.6;
  const orb = mesh(new THREE.IcosahedronGeometry(0.55, 0), '#9be7ff', { emissive: '#3aa8ff', emissiveIntensity: 0.6, roughness: 0.3 }); orb.position.y = 3.4;
  f.add(base, water, pillar, bowl, orb);
  f.position.set(0, y, 0);
  f.userData.orb = orb;
  scene.add(f);
  window.__fountainOrb = orb;
  obstacles.push({ x: 0, z: 0, r: 3.5 });
}

// 집
[[22, 19], [158, 20], [215, 19], [268, 21], [322, 19]].forEach(([deg, r], i) => {
  const a = deg * Math.PI / 180, x = Math.cos(a) * r, z = Math.sin(a) * r;
  const y = Math.min(islandH(x, z), islandH(x + 2.5, z + 2.5), islandH(x - 2.5, z - 2.5), islandH(x + 2.5, z - 2.5), islandH(x - 2.5, z + 2.5));
  const roofs = ['#e8590c', '#1c7ed6', '#2f9e44', '#c2255c', '#7048e8'];
  const h = new THREE.Group();
  const wall = mesh(new THREE.BoxGeometry(5, 4.2, 5), '#f4e7cf'); wall.position.y = 1.6;
  const roof = mesh(new THREE.ConeGeometry(4.4, 2.8, 4), roofs[i]); roof.position.y = 5.1; roof.rotation.y = Math.PI / 4;
  const door = mesh(new THREE.BoxGeometry(1.2, 2, 0.15), '#7a4b2a'); door.position.set(0, 1.2 + 0.5, 2.52);
  const w1 = mesh(new THREE.BoxGeometry(0.9, 0.9, 0.12), '#8fd3ff', { emissive: '#204060', emissiveIntensity: 0.3 }); w1.position.set(-1.6, 2.4, 2.52);
  const w2 = w1.clone(); w2.position.x = 1.6;
  const chim = mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), '#a0522d'); chim.position.set(1.3, 5.6, -0.8);
  h.add(wall, roof, door, w1, w2, chim);
  h.position.set(x, y - 0.5, z);
  h.rotation.y = Math.atan2(-x, -z);
  scene.add(h);
  obstacles.push({ x, z, r: 3.4 });
  houses.push({ x, z, color: roofs[i] });
});

// 환영 팻말
{
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#c8955a'; ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#7a4b2a'; ctx.lineWidth = 16; ctx.strokeRect(8, 8, 496, 240);
  ctx.fillStyle = '#3b2412'; ctx.textAlign = 'center';
  ctx.font = 'bold 64px sans-serif'; ctx.fillText('🌿 포근언덕', 256, 110);
  ctx.font = '34px sans-serif'; ctx.fillText('구름섬 아르카에 온 걸 환영해요', 256, 180);
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
  obstacles.push({ x: 5.5, z: 4, r: 0.5 });
}

// 나무와 바위
function addTree(x, z, s, pine) {
  const y = islandH(x, z), t = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.18 * s, 0.28 * s, 1.6 * s, 6), '#8b5a2b'); trunk.position.y = 0.8 * s;
  t.add(trunk);
  const greens = ['#2f9e44', '#37b24d', '#40c057', '#2b8a3e'];
  if (pine) {
    for (let k = 0; k < 3; k++) {
      const cone = mesh(new THREE.ConeGeometry((1.5 - k * 0.35) * s, 1.7 * s, 7), greens[(k + Math.floor(x)) & 3]);
      cone.position.y = (1.7 + k * 0.9) * s; t.add(cone);
    }
  } else {
    const puff = mesh(new THREE.IcosahedronGeometry(1.4 * s, 0), greens[Math.abs(Math.floor(z)) & 3]); puff.position.y = 2.4 * s;
    const puff2 = mesh(new THREE.IcosahedronGeometry(0.9 * s, 0), greens[(Math.abs(Math.floor(x)) + 1) & 3]); puff2.position.set(0.7 * s, 2.0 * s, 0.4 * s);
    t.add(puff, puff2);
  }
  t.position.set(x, y - 0.1, z);
  t.rotation.y = x * 7.1;
  return t;
}
for (let i = 0, made = 0; i < 400 && made < 95; i++) {
  const a = rand() * Math.PI * 2, r = 25 + rand() * (R - 30), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 2.2)) continue;
  const s = 0.8 + rand() * 0.7;
  scene.add(addTree(x, z, s, rand() < 0.5));
  obstacles.push({ x, z, r: 0.45 * s });
  made++;
}
for (let i = 0, made = 0; i < 200 && made < 28; i++) {
  const a = rand() * Math.PI * 2, r = 16 + rand() * (R - 20), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1.5)) continue;
  const s = 0.5 + rand() * 1.1;
  const rock = mesh(new THREE.DodecahedronGeometry(s, 0), rand() < 0.5 ? '#9a9a92' : '#868e96');
  rock.position.set(x, islandH(x, z) + s * 0.35, z);
  rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
  rock.scale.y = 0.7;
  scene.add(rock);
  obstacles.push({ x, z, r: s * 0.85 });
  made++;
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
const farIslands = [];
for (let i = 0; i < 7; i++) {
  const a = (i / 7) * Math.PI * 2 + 0.4, d = 120 + rand() * 60;
  const g = new THREE.Group(), rad = 8 + rand() * 9;
  const topY = 0;
  const grass = mesh(new THREE.CylinderGeometry(rad, rad * 0.96, 1.2, 14), '#51cf66'); grass.position.y = topY;
  g.add(grass, rockBottom(rad * 0.97, rad * 2.2, 100 + i, topY - 0.5));
  for (let k = 0; k < 3; k++) { const t = addTree((rand() - 0.5) * rad, (rand() - 0.5) * rad, 0.9 + rand() * 0.6, rand() < 0.5); t.position.y = topY + 0.5; g.add(t); }
  g.position.set(Math.cos(a) * d, -15 + rand() * 40, Math.sin(a) * d);
  g.userData.baseY = g.position.y; g.userData.phase = rand() * 6;
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
  g.userData = { body, armL, armR, legL, legR, t: Math.random() * 10 };
  return g;
}
function animate(av, a, dt) {
  const u = av.userData; u.t += dt;
  const t = u.t, { body, armL, armR, legL, legR } = u;
  let la = 0, ra = 0, ll = 0, rl = 0, by = 0, bry = 0, laz = 0, raz = 0;
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
  } else {
    by = Math.sin(t * 2) * 0.02; la = Math.sin(t * 2) * 0.05; ra = -la;
  }
  const k = Math.min(1, dt * 14);
  body.position.y += (by - body.position.y) * k;
  body.rotation.y += (bry - body.rotation.y) * k;
  armL.rotation.x += (la - armL.rotation.x) * k; armR.rotation.x += (ra - armR.rotation.x) * k;
  armL.rotation.z += (laz - armL.rotation.z) * k; armR.rotation.z += (raz - armR.rotation.z) * k;
  legL.rotation.x += (ll - legL.rotation.x) * k; legR.rotation.x += (rl - legR.rotation.x) * k;
}

// ================= 이름표 / 말풍선 =================
const tagLayer = $('tags');
function makeTag(name, isMe) {
  const el = document.createElement('div'); el.className = 'tag' + (isMe ? ' me' : '');
  const emo = document.createElement('span'); emo.className = 'emo'; emo.hidden = true;
  const bub = document.createElement('span'); bub.className = 'bub'; bub.hidden = true;
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name;
  el.append(emo, bub, nm); tagLayer.appendChild(el);
  return { el, emo, bub, bubT: 0, emoT: 0 };
}
function say(tag, text) { tag.bub.textContent = text; tag.bub.hidden = false; tag.bubT = 5; }
function emote(tag, e) { tag.emo.textContent = EMOJI[e] || ''; tag.emo.hidden = false; tag.emoT = 2; }
const v3 = new THREE.Vector3();
function placeTag(tag, obj, dt, sitting) {
  if (tag.bubT > 0 && (tag.bubT -= dt) <= 0) tag.bub.hidden = true;
  if (tag.emoT > 0 && (tag.emoT -= dt) <= 0) tag.emo.hidden = true;
  v3.set(obj.position.x, obj.position.y + (sitting ? 2.05 : 2.5), obj.position.z);
  const dist = v3.distanceTo(camera.position);
  v3.project(camera);
  if (v3.z > 1 || dist > 75) { tag.el.style.display = 'none'; return; }
  tag.el.style.display = '';
  tag.el.style.left = ((v3.x + 1) / 2 * innerWidth).toFixed(1) + 'px';
  tag.el.style.top = ((1 - v3.y) / 2 * innerHeight).toFixed(1) + 'px';
  tag.el.style.opacity = dist > 50 ? String(1 - (dist - 50) / 25) : '1';
}

// ================= 나와 다른 사람들 =================
const me = { id: 0, x: SPAWN.x, y: 3, z: SPAWN.z, vy: 0, ry: Math.PI, onGround: false, a: 0, emote: 0, emoteT: 0, av: null, tag: null };
const others = new Map(); // id -> { av, tag, tx, ty, tz, tr, a, name }
let profile = { name: '', color: COLORS[5], hat: 0 };

function addOther(p) {
  if (others.has(p.id) || p.id === me.id) return;
  const av = makeAvatar(p.color, p.hat);
  av.position.set(p.x, p.y, p.z); av.rotation.y = p.ry;
  scene.add(av);
  others.set(p.id, { av, tag: makeTag(p.name), tx: p.x, ty: p.y, tz: p.z, tr: p.ry, a: 0, name: p.name });
}
function removeOther(id) {
  const o = others.get(id); if (!o) return;
  scene.remove(o.av); o.tag.el.remove(); others.delete(id);
}
function clearOthers() { for (const id of [...others.keys()]) removeOther(id); }
function updateCount() { $('count').textContent = String(others.size + 1); }

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
let ws = null, joined = false, everJoined = false;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: profile.name, color: profile.color, hat: profile.hat }));
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'welcome') onWelcome(m);
    else if (m.t === 's') onSnapshot(m.p);
    else if (m.t === 'join') { addOther(m.p); updateCount(); addLog(`${m.p.name} 님이 섬에 왔어요`); }
    else if (m.t === 'leave') { removeOther(m.id); updateCount(); addLog(`${m.name} 님이 섬을 떠났어요`); }
    else if (m.t === 'chat') {
      addLog(m.text, m.name);
      const tag = m.id === me.id ? me.tag : others.get(m.id)?.tag;
      if (tag) say(tag, m.text);
    } else if (m.t === 'emote') { const o = others.get(m.id); if (o) emote(o.tag, m.e); }
  };
  ws.onclose = () => {
    const wasJoined = joined; joined = false;
    if (!everJoined) { $('status').textContent = '서버에 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.'; $('start').disabled = false; return; }
    if (wasJoined) { toast('연결이 끊겼어요. 다시 연결하는 중…'); addLog('연결이 끊겨서 다시 연결하는 중이에요'); }
    setTimeout(connect, 2000);
  };
}
function onWelcome(m) {
  clearOthers();
  me.id = m.id;
  me.x = m.me.x; me.y = m.me.y; me.z = m.me.z; me.ry = m.me.ry; me.vy = 0;
  m.players.forEach(addOther);
  $('chan').textContent = `채널 ${m.ch}`;
  updateCount();
  if (!everJoined) {
    everJoined = true;
    $('join').hidden = true; $('hud').hidden = false;
    me.av = makeAvatar(profile.color, profile.hat); scene.add(me.av);
    me.tag = makeTag(profile.name || '바람잡이', true);
    camYaw = 0;
    addLog(document.body.classList.contains('touch') ? '포근언덕에 도착했어요! 💬 버튼을 눌러 인사해 보세요' : '포근언덕에 도착했어요! Enter 키를 눌러 인사해 보세요');
    toast('🌿 포근언덕에 도착!');
  } else addLog('다시 연결됐어요');
  joined = true;
}
function onSnapshot(list) {
  for (const [id, x, y, z, ry, a] of list) {
    if (id === me.id) continue;
    const o = others.get(id); if (!o) continue;
    o.tx = x; o.ty = y; o.tz = z; o.tr = ry; o.a = a;
  }
}
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
    $('start').disabled = true; $('status').textContent = '';
    connect();
  };
  $('start').onclick = start;
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
}

// ================= 조작 =================
const keys = new Set();
let camYaw = 0, camPitch = 0.42, camDist = 9;
let jumpQueued = false, runToggle = false;
const joy = { x: 0, y: 0 };

function doEmote(e) {
  if (!joined) return;
  me.emote = e; me.emoteT = e === 1 ? 2.2 : 999;
  emote(me.tag, e);
  net({ t: 'emote', e });
}
addEventListener('keydown', (e) => {
  if (!everJoined) return;
  if (e.target === sayEl) {
    if (e.key === 'Enter') {
      const text = sayEl.value.trim(); sayEl.value = '';
      if (text) net({ t: 'chat', text });
      sayEl.blur();
    } else if (e.key === 'Escape') sayEl.blur();
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter') { e.preventDefault(); sayEl.focus(); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpQueued = true; }
  if (e.code === 'Digit1') doEmote(1);
  if (e.code === 'Digit2') doEmote(2);
  if (e.code === 'Digit3') doEmote(3);
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
sayEl.addEventListener('focus', () => keys.clear());

// 마우스 / 손가락으로 끌어서 시점 돌리기
let lookId = null, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => { if (lookId !== null) return; lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); if (document.activeElement === sayEl) sayEl.blur(); });
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookId) return;
  const s = e.pointerType === 'touch' ? 0.008 : 0.005;
  camYaw -= (e.clientX - lastX) * s;
  camPitch = Math.max(0.05, Math.min(1.25, camPitch + (e.clientY - lastY) * s));
  lastX = e.clientX; lastY = e.clientY;
});
const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
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
    else if (act === 'run') { runToggle = !runToggle; b.classList.toggle('on', runToggle); }
    else if (act === 'chat') sayEl.focus();
    else if (act.startsWith('emote')) doEmote(Number(act.slice(5)));
  }));
}

// ================= 움직임 =================
function updateMe(dt) {
  let ix = 0, iz = 0;
  if (document.activeElement !== sayEl) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  }
  ix += joy.x; iz -= joy.y;
  let len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; len = 1; }
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = -fz, rz = fx;
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle;
  const speed = (running ? RUN : WALK) * len;
  let mx = 0, mz = 0;
  if (len > 0.05) {
    mx = (fx * iz + rx * ix) / len; mz = (fz * iz + rz * ix) / len;
    me.ry = lerpAngle(me.ry, Math.atan2(mx, mz), Math.min(1, dt * 12));
    if (me.emote) { me.emote = 0; me.emoteT = 0; }
  }
  me.x += mx * speed * dt; me.z += mz * speed * dt;

  // 물건에 부딪히면 밀려나기
  for (const o of obstacles) {
    const dx = me.x - o.x, dz = me.z - o.z, d = Math.hypot(dx, dz), min = o.r + 0.45;
    if (d < min && d > 0.0001 && me.y < groundAt(o.x, o.z) + 6) { me.x = o.x + dx / d * min; me.z = o.z + dz / d * min; }
  }

  // 점프와 중력
  if (jumpQueued && me.onGround) { me.vy = JUMP; me.onGround = false; if (me.emote) { me.emote = 0; } }
  jumpQueued = false;
  me.vy -= GRAV * dt;
  me.y += me.vy * dt;
  const g = groundAt(me.x, me.z);
  if (me.y <= g || (me.onGround && me.y - g < 0.6 && me.vy <= 0)) { me.y = g; me.vy = 0; me.onGround = true; }
  else me.onGround = false;

  if (me.y < -45) { // 구름 아래로 떨어지면 광장으로
    me.x = SPAWN.x + (Math.random() - 0.5) * 4; me.z = SPAWN.z + Math.random() * 2; me.y = 6; me.vy = 0; me.ry = Math.PI; camYaw = 0;
    toast('구름 아래로 떨어졌다가 광장으로 돌아왔어요! ☁️');
  }

  if (me.emoteT > 0 && me.emoteT < 900 && (me.emoteT -= dt) <= 0) me.emote = 0;
  me.a = !me.onGround ? ANIM.air
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
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, ty, tz);
}

let sendT = 0, lastSent = '';
function sendMove(dt) {
  sendT += dt;
  if (sendT < 1 / 15) return;
  sendT = 0;
  const p = [+me.x.toFixed(2), +me.y.toFixed(2), +me.z.toFixed(2), +me.ry.toFixed(2)];
  const key = p.join(',') + ':' + me.a;
  if (key === lastSent) return;
  lastSent = key;
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
    placeTag(o.tag, av, dt, o.a === ANIM.sit);
  }
}

// ================= 작은 지도 =================
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const W = 150, c = W / 2, s = (W / 2 - 6) / R;
  mm.clearRect(0, 0, W, W);
  mm.fillStyle = '#69b34c'; mm.beginPath(); mm.arc(c, c, R * s, 0, Math.PI * 2); mm.fill();
  mm.fillStyle = '#e6d6ae'; mm.beginPath(); mm.arc(c, c, 13 * s, 0, Math.PI * 2); mm.fill();
  mm.fillStyle = '#5fc1ff'; mm.beginPath(); mm.arc(c, c, 3 * s, 0, Math.PI * 2); mm.fill();
  for (const h of houses) { mm.fillStyle = h.color; mm.fillRect(c + h.x * s - 4, c + h.z * s - 4, 8, 8); }
  mm.fillStyle = '#fff';
  for (const o of others.values()) {
    const x = o.av.position.x, z = o.av.position.z; if (Math.hypot(x, z) > R + 4) continue;
    mm.beginPath(); mm.arc(c + x * s, c + z * s, 3, 0, Math.PI * 2); mm.fill();
  }
  mm.save(); mm.translate(c + me.x * s, c + me.z * s); mm.rotate(-me.ry + Math.PI);
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
  for (const f of farIslands) f.position.y = f.userData.baseY + Math.sin(time * 0.4 + f.userData.phase) * 1.5;
  window.__fountainOrb.rotation.y += dt; window.__fountainOrb.position.y = 3.4 + Math.sin(time * 2) * 0.15;

  if (everJoined) {
    updateMe(dt);
    updateCamera(dt);
    sendMove(dt);
    updateOthers(dt);
    placeTag(me.tag, me.av, dt, me.a === ANIM.sit);
    if ((mmT += dt) > 0.1) { mmT = 0; drawMinimap(); }
  } else { // 접속 전에는 섬 주위를 천천히 돌기
    const a = time * 0.08;
    camera.position.set(Math.sin(a) * 75, 32, Math.cos(a) * 75); camera.lookAt(0, 2, 0);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// 자동 확인용
window.__arca = { me, others: () => others.size, groundAt };
})();
