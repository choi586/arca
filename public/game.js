// 구름섬 아르카 — 3단계: 걷기 + 싸우기 + 모으기(아이템·가방·상점·무기)
(() => {
'use strict';

// ================= 기본 설정 =================
const { R, SPAWN, MERCHANT, SHOP_RANGE, rng, islandH, groundAt, MONSTERS, MONSTER_KINDS, WEAPONS, UNLOCK, KEYS, ITEMS, ITEM_IDS, SHOP_ITEMS, BAG_SLOTS, needXp } = ARCA;
const LAYOUT = ARCA.buildLayout();
const WALK = 6, RUN = 10.5, GRAV = 26, JUMP = 9.5, DASH_SPEED = 34, DASH_TIME = 0.2;
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#f8f9fa'];
const ANIM = { idle: 0, walk: 1, run: 2, air: 3, wave: 4, dance: 5, sit: 6, attack: 7, spin: 8, dead: 9, cast: 10, guard: 11 };
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
const farIslands = [];
for (let i = 0; i < 7; i++) {
  const a = (i / 7) * Math.PI * 2 + 0.4, d = 120 + rand() * 60;
  const g = new THREE.Group(), rad = 8 + rand() * 9;
  const grass = mesh(new THREE.CylinderGeometry(rad, rad * 0.96, 1.2, 14), '#51cf66');
  g.add(grass, rockBottom(rad * 0.97, rad * 2.2, 100 + i, -0.5));
  for (let k = 0; k < 3; k++) { const x = (rand() - 0.5) * rad, z = (rand() - 0.5) * rad; const t = makeTree(0.9 + rand() * 0.6, rand() < 0.5, x, z); t.position.set(x, 0.5, z); g.add(t); }
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
  g.userData = { body, armL, armR, legL, legR, holdR, holdL, weapon: '', t: Math.random() * 10, lastA: 0, actT: 0 };
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
  } else { // turtle
    const shell = monsterMesh(new THREE.DodecahedronGeometry(1.5, 0), '#5c7a3a', mats); shell.position.y = 1.2; shell.scale.set(1, 0.65, 1.15);
    const moss = monsterMesh(new THREE.DodecahedronGeometry(0.9, 0), '#82c91e', mats); moss.position.set(0.2, 1.95, -0.2); moss.scale.y = 0.5;
    const rock = monsterMesh(new THREE.DodecahedronGeometry(0.5, 0), '#868e96', mats); rock.position.set(-0.5, 2.0, 0.3);
    const head = monsterMesh(new THREE.SphereGeometry(0.55, 9, 7), '#8f9c5a', mats); head.position.set(0, 1.1, 1.75);
    body.add(shell, moss, rock, head, eye(-0.25, 1.3, 2.2, 1.4), eye(0.25, 1.3, 2.2, 1.4));
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([x, z]) => { const l = monsterMesh(new THREE.CylinderGeometry(0.35, 0.4, 0.8, 7), '#7a8a4a', mats); l.position.set(x * 1.0, 0.4, z * 0.9); body.add(l); });
  }
  g.add(body);
  g.userData = { body, mats, t: Math.random() * 10, flash: 0 };
  return g;
}
function animateMonster(mo, dt) {
  const u = mo.av.userData; u.t += dt;
  const { body } = u, t = u.t;
  let sy = 1, sx = 1, by = 0, rx = 0;
  if (mo.kind === 'slime') {
    if (mo.st === 2) { sy = 0.62; sx = 1.25; } else if (mo.st === 1) { const b = Math.abs(Math.sin(t * 8)); by = b * 0.45; sy = 0.85 + b * 0.3; sx = 1.1 - b * 0.15; } else { sy = 1 + Math.sin(t * 3) * 0.05; sx = 1 - Math.sin(t * 3) * 0.04; }
  } else if (mo.kind === 'shroom') {
    if (mo.st === 2) { sy = 1.15 + Math.sin(t * 30) * 0.06; sx = 1.15; } else if (mo.st === 1) { by = Math.abs(Math.sin(t * 9)) * 0.18; rx = Math.sin(t * 9) * 0.1; }
  } else {
    if (mo.st === 2) rx = -0.35; else if (mo.st === 1) by = Math.abs(Math.sin(t * 4)) * 0.1;
  }
  const k = Math.min(1, dt * 12);
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
  el.append(emo, bub, nm, hpb); tagLayer.appendChild(el);
  return { el, emo, bub, lvl, hpb, hpi, bubT: 0, emoT: 0, lv: 0, hp: 100 };
}
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
  const tag = makeTag(p.name); setTagLv(tag, p.lv || 1);
  others.set(p.id, { av, tag, tx: p.x, ty: p.y, tz: p.z, tr: p.ry, a: 0, name: p.name });
}
function removeOther(id) {
  const o = others.get(id); if (!o) return;
  scene.remove(o.av); o.tag.el.remove(); others.delete(id);
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
function loadInv() { try { return JSON.parse(store.get('arca.inv') || 'null'); } catch (e) { return null; } }
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: profile.name, color: profile.color, hat: profile.hat,
    lv: Number(store.get('arca.lv')) || 1, xp: Number(store.get('arca.xp')) || 0, inv: loadInv() }));
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    const h = handlers[m.t]; if (h) h(m);
  };
  ws.onclose = () => {
    const wasJoined = joined; joined = false;
    if (!everJoined) { $('status').textContent = '서버에 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.'; $('start').disabled = false; return; }
    if (wasJoined) { toast('연결이 끊겼어요. 다시 연결하는 중…'); addLog('연결이 끊겨서 다시 연결하는 중이에요'); }
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
    }
    const seen = new Set();
    for (const [id, ki, x, z, ry, hp, st, slow] of m.m) {
      seen.add(id);
      let mo = monsters.get(id);
      if (mo && mo.dying) continue;
      if (!mo) mo = addMonster(id, MONSTER_KINDS[ki], x, z, ry);
      mo.tx = x; mo.tz = z; mo.tr = ry; mo.st = st; mo.slow = slow;
      if (mo.hp !== hp) { mo.hp = hp; setTagHp(mo.tag, hp); }
    }
    for (const [id, mo] of monsters) if (!seen.has(id) && !mo.dying) removeMonster(id);
  },
  join(m) { addOther(m.p); updateCount(); addLog(`${m.p.name} 님이 섬에 왔어요`); },
  leave(m) { removeOther(m.id); updateCount(); addLog(`${m.name} 님이 섬을 떠났어요`); },
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
  mdie(m) {
    const mo = monsters.get(m.id); if (!mo) return;
    mo.dying = 0.4; mo.tag.el.remove();
  },
  fx(m) { const o = others.get(m.id); if (o && WEAPONS[m.w]) { setWeapon(o.av, m.w); skillFx(o.av, m.w, m.k, m.tg); } },
  inv(m) {
    const prevEquip = me.inv.equip;
    me.inv = { gold: m.gold, items: m.items, weapons: m.weapons, equip: m.equip };
    store.set('arca.inv', JSON.stringify(me.inv));
    if (me.av) {
      setWeapon(me.av, me.inv.equip);
      if (prevEquip !== me.inv.equip || !skillSlots.length) buildSkillSlots();
    }
    refreshStats(); refreshPotion(); renderPanels();
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
let jumpQueued = false, runToggle = false;
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
  if (show) { (id === 'bag' ? $('shop') : $('bag')).hidden = true; renderPanels(); }
}
function itemCount() { return Object.keys(me.inv.items).length; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function renderPanels() {
  document.querySelectorAll('.goldN').forEach((b) => { b.textContent = me.inv.gold; });
  if (!$('bag').hidden) renderBag();
  if (!$('shop').hidden) renderShop();
}
function renderBag() {
  const wl = $('bagWeapons'); wl.textContent = '';
  for (const id of me.inv.weapons) {
    const w = WEAPONS[id], b = el('button', 'wcard' + (id === me.inv.equip ? ' on' : ''));
    const what = el('span'); what.append(el('b', '', w.name), el('small', '', `${w.desc} · ${w.skills.map((s) => s.icon).join(' ')}`));
    b.append(el('span', 'ic', w.icon), what, el('span', 'badge', id === me.inv.equip ? '들고 있음' : '바꿔 들기'));
    b.onclick = () => { if (id !== me.inv.equip) net({ t: 'equip', w: id }); };
    wl.appendChild(b);
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
  } else {
    const ids = ITEM_IDS.filter((id) => me.inv.items[id]);
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
    if (e.code === 'KeyB') { if (nearMerchant) openPanel('shop'); else toast('상점은 광장의 상인 모모 가까이에서 열 수 있어요'); }
    if (e.code === 'Escape') { $('bag').hidden = true; $('shop').hidden = true; }
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
  me.x += mx * speed * dt; me.z += mz * speed * dt;

  // 물건에 부딪히면 밀려나기
  for (const o of obstacles) {
    const dx = me.x - o.x, dz = me.z - o.z, d = Math.hypot(dx, dz), min = o.r + 0.45;
    if (d < min && d > 0.0001 && me.y < groundAt(o.x, o.z) + 6) { me.x = o.x + dx / d * min; me.z = o.z + dz / d * min; }
  }

  // 점프와 중력
  if (jumpQueued && me.onGround && !me.dead) { me.vy = JUMP; me.onGround = false; me.emote = 0; }
  jumpQueued = false;
  me.vy -= GRAV * dt;
  me.y += me.vy * dt;
  const g = groundAt(me.x, me.z);
  if (me.y <= g || (me.onGround && me.y - g < 0.6 && me.vy <= 0)) { me.y = g; me.vy = 0; me.onGround = true; }
  else me.onGround = false;

  if (me.y < -45) { // 구름 아래로 떨어지면 광장으로
    me.x = SPAWN.x + (Math.random() - 0.5) * 4; me.z = SPAWN.z + Math.random() * 2; me.y = 6; me.vy = 0; me.ry = Math.PI; camYaw = 0; me.dashT = 0;
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
    : !me.onGround ? ANIM.air
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

let sendT = 0, lastSent = '';
function sendMove(dt) {
  sendT += dt;
  if (sendT < 1 / 15 || me.dead) return;
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
function drawMinimap() {
  const W = 150, c = W / 2, s = (W / 2 - 6) / R;
  mm.clearRect(0, 0, W, W);
  mm.fillStyle = '#69b34c'; mm.beginPath(); mm.arc(c, c, R * s, 0, Math.PI * 2); mm.fill();
  mm.fillStyle = '#e6d6ae'; mm.beginPath(); mm.arc(c, c, 13 * s, 0, Math.PI * 2); mm.fill();
  mm.fillStyle = '#5fc1ff'; mm.beginPath(); mm.arc(c, c, 3 * s, 0, Math.PI * 2); mm.fill();
  for (const h of houses) { mm.fillStyle = h.color; mm.fillRect(c + h.x * s - 4, c + h.z * s - 4, 8, 8); }
  for (const mo of monsters.values()) {
    if (mo.dying) continue;
    mm.fillStyle = mo.kind === 'turtle' ? '#7a3b00' : '#e03131';
    mm.beginPath(); mm.arc(c + mo.av.position.x * s, c + mo.av.position.z * s, mo.kind === 'turtle' ? 3.5 : 2, 0, Math.PI * 2); mm.fill();
  }
  mm.fillStyle = '#fff';
  for (const o of others.values()) {
    const x = o.av.position.x, z = o.av.position.z; if (Math.hypot(x, z) > R + 4) continue;
    mm.beginPath(); mm.arc(c + x * s, c + z * s, 3, 0, Math.PI * 2); mm.fill();
  }
  mm.fillStyle = '#ffd43b'; mm.strokeStyle = '#7a4b2a'; mm.lineWidth = 1.5; mm.beginPath(); mm.arc(c + MERCHANT.x * s, c + MERCHANT.z * s, 4, 0, Math.PI * 2); mm.fill(); mm.stroke();
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
  fountainOrb.rotation.y += dt; fountainOrb.position.y = 3.4 + Math.sin(time * 2) * 0.15;

  if (everJoined) {
    updateMe(dt);
    updateCamera(dt);
    sendMove(dt);
    updateOthers(dt);
    updateMonsters(dt);
    updateMerchant(dt);
    placeTag(me.tag, me.av, dt, me.a === ANIM.sit ? 2.05 : me.a === ANIM.dead ? 1.2 : 2.5);
    updateSkillSlots();
    if ((mmT += dt) > 0.1) { mmT = 0; drawMinimap(); }
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
window.__arca = { me, others: () => others.size, monsters: () => monsters, groundAt, tryAttack, net: (o) => net(o), openPanel };
})();
