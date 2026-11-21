// 구름섬 아르카 — 서버와 화면이 함께 쓰는 규칙 (섬 모양, 물건 위치, 몬스터, 기술, 레벨)
(function (root) {
'use strict';

const R = 62;                 // 섬 반지름
const SPAWN = { x: 0, z: 7 }; // 광장 시작 위치
const MERCHANT = { x: -7.5, z: 6, ry: 1.3 }; // 광장 상인 모모
const SHOP_RANGE = 6;
const SAFE_R = 14; // 광장 안전 구역: 몬스터가 못 들어오고, 안에 있는 사람은 공격받지 않음
function inSafe(x, z) { return Math.hypot(x, z) < SAFE_R; }
const ELDER = { x: 8, z: 9.5, ry: -2.4 };    // 광장의 촌장 루루 (의뢰를 줌)
const TALK_RANGE = 6, ALTAR_RANGE = 8;        // 촌장과 이야기 / 분수 수정에 돌을 바치는 거리
// 바람의 다리: 모두가 바람의 돌을 모으면 두 섬 사이에 놓임 (서버가 world.bridge 를 켬)
const BRIDGE = { x0: 60, x1: 96, half: 2.2, y: 1.1, need: 10 };
const world = { bridge: false };
function onBridge(x, z) { return world.bridge && x >= BRIDGE.x0 && x <= BRIDGE.x1 && Math.abs(z) <= BRIDGE.half; }

function rng(seed) { // 모두에게 같은 섬이 보이도록 같은 순서의 난수
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 섬 목록: 0 포근언덕(처음 섬), 1 버섯숲(글라이더로 건너가는 동쪽 섬)
const ISLANDS = [
  { id: 0, name: '포근언덕', icon: '🌿', x: 0, z: 0, R },
  { id: 1, name: '버섯숲', icon: '🍄', x: 124, z: 0, R: 30 },
  { id: 2, name: '서리봉우리', icon: '❄️', x: 0, z: -132, R: 34 }, // 북쪽의 눈 덮인 섬. 바닥이 미끄러움
  { id: 3, name: '불꽃마루', icon: '🌋', x: 0, z: 136, R: 36, minLv: 30 }, // 남쪽의 화산섬. Lv30 이 되어야 나타남
];
// 바람 기둥: 글라이더를 편 채 들어가면 하늘 높이 올라감
const UPDRAFTS = [{ x: 56, z: 0, r: 4.5 }, { x: 99, z: 0, r: 4.5 }, { x: 0, z: -56, r: 4.5 }, { x: 0, z: -103, r: 4.5 },
  { x: 0, z: 56, r: 4.5, minLv: 30 }, { x: 0, z: 105, r: 4.5, minLv: 30 }]; // 뒤의 둘은 불꽃마루로 가는 기둥 (Lv30 부터 보임)
const UPDRAFT_TOP = 22;
// 레벨 제한이 있는 섬은 그 레벨이 되기 전에는 '없는 섬'이다. 화면 쪽에서 world.lv 에 내 레벨을 넣어 둠 (서버는 비워 둬서 모든 섬이 있음)
function unlocked(o) { return !o.minLv || world.lv === undefined || world.lv >= o.minLv; }
function islandOf(x, z) { for (const I of ISLANDS) if (unlocked(I) && Math.hypot(x - I.x, z - I.z) <= I.R) return I; return null; }
function shroomH(x, z) {
  const I = ISLANDS[1], dx = x - I.x, dz = z - I.z, r = Math.hypot(dx, dz);
  const bumps = 1.2 * Math.sin(dx * 0.21 + 0.5) * Math.cos(dz * 0.19) + 0.6 * Math.sin(dx * 0.43 + dz * 0.37);
  return Math.max(0.6, 2.8 + bumps * smooth(0, 8, I.R - r) - smooth(I.R - 7, I.R, r) * 2);
}
function frostH(x, z) { // 가운데가 봉우리처럼 솟은 눈 섬
  const I = ISLANDS[2], dx = x - I.x, dz = z - I.z, r = Math.hypot(dx, dz);
  const bumps = 1.0 * Math.sin(dx * 0.23 + 1.1) * Math.cos(dz * 0.2) + 0.5 * Math.sin(dx * 0.41 - dz * 0.33);
  return Math.max(0.6, 2.6 + 10 * Math.exp(-r * r / 150) + bumps * smooth(0, 8, I.R - r) - smooth(I.R - 7, I.R, r) * 1.8);
}
function fireH(x, z) { // 화산섬: 바깥은 낮고, 가운데 둘레가 솟은 분화구. 분화구 바닥은 평평함
  const I = ISLANDS[3], dx = x - I.x, dz = z - I.z, r = Math.hypot(dx, dz);
  const bumps = 0.9 * Math.sin(dx * 0.27 + 0.4) * Math.cos(dz * 0.24) + 0.5 * Math.sin(dx * 0.5 - dz * 0.41);
  const rim = 6.5 * Math.exp(-((r - 13) * (r - 13)) / 14);
  return Math.max(0.6, 2.6 + rim + bumps * smooth(0, 8, I.R - r) * smooth(9, 18, r) - smooth(I.R - 7, I.R, r) * 1.8);
}
function islandH(x, z) {
  const V = ISLANDS[3];
  if (Math.hypot(x - V.x, z - V.z) <= V.R + 0.5) return fireH(x, z);
  const I = ISLANDS[1], F = ISLANDS[2];
  if (Math.hypot(x - I.x, z - I.z) <= I.R + 0.5) return shroomH(x, z);
  if (Math.hypot(x - F.x, z - F.z) <= F.R + 0.5) return frostH(x, z);
  return mainH(x, z);
}
function mainH(x, z) {
  const r = Math.hypot(x, z);
  const hills = 2.4 * Math.sin(x * 0.075 + 1.3) * Math.cos(z * 0.062 - 0.4) + 1.3 * Math.sin(x * 0.16 + z * 0.11) + 0.5 * Math.sin(x * 0.31 - z * 0.27);
  const bigHill = 9 * Math.exp(-((x - 20) ** 2 + (z + 30) ** 2) / 240);
  const flat = smooth(13, 27, r);
  const edge = smooth(R - 10, R, r);
  return Math.max(0.6, 2 + flat * (hills + 1.2 + bigHill) - edge * 2.2);
}
function groundAt(x, z) { return islandOf(x, z) ? islandH(x, z) : onBridge(x, z) ? BRIDGE.y : -Infinity; }

// 섬 위 물건 배치 (집, 나무, 바위) — 서버도 똑같이 알아야 몬스터가 나무를 통과하지 않음
function buildLayout() {
  const rand = rng(20261120);
  const obstacles = [{ x: 0, z: 0, r: 3.5 }]; // 분수
  const houses = [], trees = [], rocks = [];
  const roofs = ['#e8590c', '#1c7ed6', '#2f9e44', '#c2255c', '#7048e8'];
  [[22, 19], [158, 20], [215, 19], [268, 21], [322, 19]].forEach(([deg, r], i) => {
    const a = deg * Math.PI / 180, x = Math.cos(a) * r, z = Math.sin(a) * r;
    houses.push({ x, z, color: roofs[i] });
    obstacles.push({ x, z, r: 3.4 });
  });
  obstacles.push({ x: 5.5, z: 4, r: 0.5 }); // 환영 팻말
  obstacles.push({ x: MERCHANT.x, z: MERCHANT.z, r: 1.7 }); // 상인 가게
  obstacles.push({ x: ELDER.x, z: ELDER.z, r: 0.7 });       // 촌장
  for (let i = 0, made = 0; i < 400 && made < 95; i++) {
    const a = rand() * Math.PI * 2, r = 25 + rand() * (R - 30), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 2.2)) continue;
    const s = 0.8 + rand() * 0.7, pine = rand() < 0.5;
    trees.push({ x, z, s, pine });
    obstacles.push({ x, z, r: 0.45 * s });
    made++;
  }
  for (let i = 0, made = 0; i < 200 && made < 28; i++) {
    const a = rand() * Math.PI * 2, r = 16 + rand() * (R - 20), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1.5)) continue;
    const s = 0.5 + rand() * 1.1;
    rocks.push({ x, z, s, gray: rand() < 0.5, rot: [rand() * 3, rand() * 3, rand() * 3] });
    obstacles.push({ x, z, r: s * 0.85 });
    made++;
  }
  // 버섯숲 섬: 큰 버섯 나무와 바위
  const r2 = rng(5150), I = ISLANDS[1], shrooms = [];
  for (let i = 0, made = 0; i < 300 && made < 24; i++) {
    const a = r2() * Math.PI * 2, r = 3 + r2() * (I.R - 8), x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 3.5)) continue;
    if (UPDRAFTS.some((u) => Math.hypot(u.x - x, u.z - z) < u.r + 3)) continue;
    const s = 0.8 + r2() * 1.1;
    shrooms.push({ x, z, s, c: Math.floor(r2() * 4) });
    obstacles.push({ x, z, r: 0.55 * s });
    made++;
  }
  // 서리봉우리 섬: 눈 덮인 나무와 얼음 바위
  const r3 = rng(6160), F = ISLANDS[2], frostTrees = [], iceRocks = [];
  for (let i = 0, made = 0; i < 400 && made < 30; i++) {
    const a = r3() * Math.PI * 2, r = 9 + r3() * (F.R - 13), x = F.x + Math.cos(a) * r, z = F.z + Math.sin(a) * r;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 3)) continue;
    if (UPDRAFTS.some((u) => Math.hypot(u.x - x, u.z - z) < u.r + 3) || (Math.abs(x - F.x) < 5 && z > F.z)) continue; // 내리는 길은 비워 둠
    const s = 0.9 + r3() * 0.9, ice = r3() < 0.3;
    (ice ? iceRocks : frostTrees).push({ x, z, s });
    obstacles.push({ x, z, r: (ice ? 0.8 : 0.45) * s });
    made++;
  }
  // 불꽃마루 섬: 검은 바위(부딪힘)와 용암 웅덩이(꾸밈)
  const r5 = rng(9090), V = ISLANDS[3], lavaRocks = [], lavaPools = [];
  for (let i = 0, made = 0; i < 400 && made < 22; i++) {
    const a = r5() * Math.PI * 2, r = 18 + r5() * (V.R - 23), x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 3)) continue;
    if (UPDRAFTS.some((u) => Math.hypot(u.x - x, u.z - z) < u.r + 3) || (Math.abs(x - V.x) < 5 && z < V.z)) continue; // 내리는 길은 비워 둠
    const s = 0.9 + r5() * 1.2;
    lavaRocks.push({ x, z, s });
    obstacles.push({ x, z, r: 0.75 * s });
    made++;
  }
  for (let i = 0; i < 9; i++) { const a = r5() * Math.PI * 2, r = 19 + r5() * (V.R - 26); lavaPools.push({ x: V.x + Math.cos(a) * r, z: V.z + Math.sin(a) * r, s: 1.2 + r5() * 1.6 }); }
  return { obstacles, houses, trees, rocks, shrooms, frostTrees, iceRocks, lavaRocks, lavaPools };
}

// ---------- 몬스터 ----------
const MONSTERS = {
  slime: { name: '말랑 슬라임', lv: 1, hp: 40, atk: 7, speed: 2.6, xp: 6, aggro: 9, reach: 1.9, hitR: 1.7, hitAt: 1.0, windup: 750, cd: 1800, size: 0.8, respawn: 12000 },
  shroom: { name: '버섯돌이', lv: 4, hp: 120, atk: 14, speed: 3.0, xp: 16, aggro: 11, reach: 2.6, hitR: 2.8, hitAt: 0.0, windup: 900, cd: 2200, size: 1.0, respawn: 16000 },
  turtle: { name: '이끼 돌거북', lv: 8, hp: 480, atk: 26, speed: 2.0, xp: 60, aggro: 12, reach: 3.4, hitR: 4.0, hitAt: 1.6, windup: 1200, cd: 2800, size: 1.6, respawn: 30000 },
};
// 월드 보스 (섬 서북쪽에 가끔 나타남)
MONSTERS.golem = { name: '폭풍 골렘', lv: 15, hp: 3000, atk: 30, speed: 2.6, xp: 300, aggro: 24, reach: 5, hitR: 5.5, hitAt: 2.5, windup: 1300, cd: 2600, size: 3, respawn: 600000, boss: true };
// 버섯숲 섬의 몬스터
MONSTERS.toad = { name: '독버섯 두꺼비', lv: 10, hp: 340, atk: 30, speed: 3.2, xp: 48, aggro: 9, reach: 2.6, hitR: 3.0, hitAt: 0.0, windup: 850, cd: 2000, size: 1.2, respawn: 20000 };
MONSTERS.wisp = { name: '숲의 정령', lv: 13, hp: 460, atk: 38, speed: 3.8, xp: 80, aggro: 10, reach: 3.0, hitR: 2.4, hitAt: 2.2, windup: 700, cd: 1700, size: 1.0, respawn: 26000 };
// 서리봉우리 섬의 몬스터
MONSTERS.yeti = { name: '눈덩이 도깨비', lv: 16, hp: 720, atk: 46, speed: 3.0, xp: 130, aggro: 10, reach: 2.8, hitR: 3.0, hitAt: 1.2, windup: 800, cd: 2000, size: 1.3, respawn: 22000 };
MONSTERS.wolf = { name: '서리 늑대', lv: 19, hp: 900, atk: 58, speed: 4.6, xp: 190, aggro: 13, reach: 2.6, hitR: 2.2, hitAt: 2.0, windup: 600, cd: 1500, size: 1.1, respawn: 26000 };
MONSTERS.giant = { name: '서리 거인', lv: 24, hp: 3200, atk: 85, speed: 2.2, xp: 700, aggro: 12, reach: 4.2, hitR: 5.0, hitAt: 2.0, windup: 1300, cd: 2600, size: 2.4, respawn: 90000 };
// 섬마다 두 종씩 더 (14단계)
MONSTERS.bee = { name: '붕붕 꿀벌', lv: 3, hp: 70, atk: 10, speed: 4.2, xp: 11, aggro: 10, reach: 1.8, hitR: 1.6, hitAt: 1.0, windup: 600, cd: 1500, size: 0.6, respawn: 12000 };
MONSTERS.scarecrow = { name: '심술 허수아비', lv: 6, hp: 260, atk: 20, speed: 2.4, xp: 34, aggro: 9, reach: 2.8, hitR: 3.2, hitAt: 0.0, windup: 1000, cd: 2400, size: 1.3, respawn: 20000 };
MONSTERS.bat = { name: '포자 박쥐', lv: 11, hp: 300, atk: 32, speed: 4.6, xp: 55, aggro: 12, reach: 2.0, hitR: 1.9, hitAt: 1.2, windup: 550, cd: 1400, size: 0.7, respawn: 18000 };
MONSTERS.treant = { name: '고목 나무지기', lv: 14, hp: 950, atk: 46, speed: 1.9, xp: 125, aggro: 9, reach: 3.6, hitR: 4.2, hitAt: 0.0, windup: 1200, cd: 2800, size: 2.0, respawn: 32000 };
MONSTERS.penguin = { name: '펭귄 병사', lv: 17, hp: 760, atk: 48, speed: 3.6, xp: 150, aggro: 10, reach: 2.4, hitR: 2.6, hitAt: 1.4, windup: 700, cd: 1800, size: 1.0, respawn: 22000 };
MONSTERS.icewisp = { name: '눈보라 정령', lv: 21, hp: 1100, atk: 64, speed: 3.4, xp: 260, aggro: 12, reach: 3.0, hitR: 3.0, hitAt: 2.4, windup: 750, cd: 1900, size: 1.1, respawn: 30000 };
// 버섯숲 섬의 보스. elite: 앞 내려찍기와 자기 주변 큰 원(ringR)을 번갈아 씀
MONSTERS.queen = { name: '버섯 여왕', lv: 16, hp: 2600, atk: 56, speed: 2.3, xp: 520, aggro: 11, reach: 3.8, hitR: 4.4, hitAt: 2.0, windup: 1200, cd: 2500, size: 2.2, respawn: 120000, elite: true, ringR: 7.5 };
MONSTERS.giant.elite = true; MONSTERS.giant.ringR = 8;
// 불꽃마루 섬의 몬스터 (Lv30 부터 보임)
MONSTERS.lizard = { name: '불씨 도마뱀', lv: 30, hp: 1700, atk: 78, speed: 3.8, xp: 420, aggro: 11, reach: 2.6, hitR: 2.8, hitAt: 1.6, windup: 700, cd: 1800, size: 1.1, respawn: 22000, minLv: 30 };
MONSTERS.magma = { name: '용암 덩어리', lv: 34, hp: 3800, atk: 120, speed: 2.2, xp: 640, aggro: 10, reach: 3.2, hitR: 4.0, hitAt: 0.0, windup: 1100, cd: 2600, size: 1.6, respawn: 30000, minLv: 30 };
MONSTERS.firebird = { name: '불새', lv: 38, hp: 3200, atk: 150, speed: 4.8, xp: 820, aggro: 13, reach: 2.8, hitR: 2.4, hitAt: 2.2, windup: 600, cd: 1600, size: 1.0, respawn: 30000, minLv: 30 };
MONSTERS.dragon = { name: '분화구의 용', lv: 45, hp: 15000, atk: 210, speed: 2.6, xp: 4200, aggro: 12, reach: 4.6, hitR: 5.2, hitAt: 2.6, windup: 1300, cd: 2600, size: 2.8, respawn: 180000, elite: true, ringR: 9, minLv: 30 };
// 새 종류는 반드시 맨 뒤에 붙임 (번호가 바뀌면 새로고침 안 한 화면에서 몬스터가 뒤바뀜)
const MONSTER_KINDS = ['slime', 'shroom', 'turtle', 'golem', 'toad', 'wisp', 'yeti', 'wolf', 'giant', 'bee', 'scarecrow', 'bat', 'treant', 'penguin', 'icewisp', 'queen', 'lizard', 'magma', 'firebird', 'dragon'];
const BOSS = { x: -30, z: -26 };
const PARTY_MAX = 4, PARTY_SHARE_RANGE = 30;

// 몬스터가 사는 곳 (집 위치) — 슬라임은 광장 가까이, 버섯은 숲, 돌거북은 큰 언덕
function monsterHomes(obstacles) {
  const rand = rng(777);
  const homes = [];
  const free = (x, z, pad) => !obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + pad);
  const place = (kind, n, minR, maxR, cx = 0, cz = 0) => {
    for (let i = 0, made = 0; i < 400 && made < n; i++) {
      const a = rand() * Math.PI * 2, r = minR + rand() * (maxR - minR);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (Math.hypot(x, z) > R - 5 || !free(x, z, 1.5)) continue;
      if (kind !== 'turtle' && Math.hypot(x - 20, z + 30) < 14) continue; // 언덕은 돌거북 자리
      homes.push({ kind, x, z }); made++;
    }
  };
  place('slime', 14, 20, 36);
  place('shroom', 10, 37, 54);
  place('turtle', 3, 2, 9, 20, -30);
  // 버섯숲 섬
  const I = ISLANDS[1], r2 = rng(4242);
  const place2 = (kind, n) => {
    for (let i = 0, made = 0; i < 400 && made < n; i++) {
      const a = r2() * Math.PI * 2, r = 4 + r2() * (I.R - 10), x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r;
      if (!free(x, z, 1.5) || Math.abs(z - I.z) < 9) continue; // 가운데 길(착륙하는 곳과 바람 기둥)은 비워 둠
      homes.push({ kind, x, z, isl: 1 }); made++;
    }
  };
  place2('toad', 8);
  place2('wisp', 4);
  // 서리봉우리 섬: 도깨비와 늑대는 산자락, 거인은 봉우리 꼭대기
  const F = ISLANDS[2], r3 = rng(8686);
  const place3 = (kind, n) => {
    for (let i = 0, made = 0; i < 400 && made < n; i++) {
      const a = r3() * Math.PI * 2, r = 10 + r3() * (F.R - 16), x = F.x + Math.cos(a) * r, z = F.z + Math.sin(a) * r;
      if (!free(x, z, 1.5) || (Math.abs(x - F.x) < 9 && z > F.z + 8)) continue; // 내리는 길은 비워 둠
      homes.push({ kind, x, z, isl: 2 }); made++;
    }
  };
  place3('yeti', 7);
  place3('wolf', 5);
  homes.push({ kind: 'giant', x: F.x, z: F.z, isl: 2 });
  // 14단계에서 늘어난 몬스터. 앞의 자리들이 바뀌지 않게 따로 뽑고 맨 뒤에 붙임
  const r4 = rng(1414);
  const placeMore = (kind, n, isl, minR, maxR, ok) => {
    const C = ISLANDS[isl];
    for (let i = 0, made = 0; i < 500 && made < n; i++) {
      const a = r4() * Math.PI * 2, r = minR + r4() * (maxR - minR), x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      if (!free(x, z, 1.5) || UPDRAFTS.some((u) => Math.hypot(u.x - x, u.z - z) < u.r + 6) || (ok && !ok(x, z))) continue;
      if (homes.some((h) => Math.hypot(h.x - x, h.z - z) < 3.5)) continue; // 다른 몬스터 집과 너무 붙지 않게
      homes.push({ kind, x, z, isl }); made++;
    }
  };
  placeMore('bee', 6, 0, 22, 40, (x, z) => Math.hypot(x - 20, z + 30) > 14);
  placeMore('scarecrow', 4, 0, 32, 52, (x, z) => Math.hypot(x - 20, z + 30) > 14 && Math.hypot(x - BOSS.x, z - BOSS.z) > 12);
  placeMore('bat', 5, 1, 5, I.R - 7, (x, z) => Math.abs(z - I.z) > 8);
  placeMore('treant', 2, 1, 8, I.R - 9, (x, z) => Math.abs(z - I.z) > 9);
  placeMore('penguin', 5, 2, 10, F.R - 7, (x, z) => !(Math.abs(x - F.x) < 9 && z > F.z + 8));
  placeMore('icewisp', 3, 2, 8, F.R - 12, (x, z) => !(Math.abs(x - F.x) < 9 && z > F.z + 8));
  placeMore('queen', 1, 1, 15, 19, (x, z) => z < I.z - 13); // 버섯숲 북쪽 깊은 곳
  // 불꽃마루 섬: 바깥 둘레에 도마뱀·용암 덩어리·불새, 분화구 한가운데에 용
  const V = ISLANDS[3], lane = (x, z) => !(Math.abs(x - V.x) < 9 && z < V.z - 8);
  placeMore('lizard', 7, 3, 19, V.R - 7, lane);
  placeMore('magma', 5, 3, 19, V.R - 8, lane);
  placeMore('firebird', 4, 3, 20, V.R - 9, lane);
  homes.push({ kind: 'dragon', x: V.x, z: V.z, isl: 3 });
  return homes;
}

// ---------- 무기와 기술 ----------
// kind: arc 앞쪽 부채꼴 · around 내 주변 원 · line 앞으로 돌진 · shot 가까운 적 하나 · multi 여러 적
//       blast 적 자리에 폭발 · heal 주변 회복 · guard 내 방어 · shield 친구 방어 · taunt 몬스터 끌어오기
// 슬롯마다 배우는 레벨: 기본 1, Q 2, E 3, R 4
const UNLOCK = [1, 2, 3, 4];
const KEYS = ['클릭', 'Q', 'E', 'R'];
const WEAPONS = {
  sword: { name: '바람검', icon: '🗡️', price: 0, color: 0xffffff, desc: '균형 잡힌 근접 무기',
    skills: [
      { name: '베기', icon: '🗡️', kind: 'arc', cd: 450, mult: 1.0, range: 2.9, arc: 1.25 },
      { name: '회전베기', icon: '🌀', kind: 'around', cd: 4000, mult: 1.6, range: 3.6 },
      { name: '돌진 찌르기', icon: '💨', kind: 'line', cd: 6000, mult: 2.3, range: 7, width: 1.6, move: 'dash' },
      { name: '치유의 바람', icon: '🍃', kind: 'heal', cd: 12000, heal: 0.35, range: 7 },
    ] },
  bow: { name: '참나무 활', icon: '🏹', price: 150, color: 0xffe066, desc: '멀리서 쏘는 무기',
    skills: [
      { name: '화살', icon: '🏹', kind: 'shot', cd: 650, mult: 0.95, range: 15 },
      { name: '세 갈래 화살', icon: '🎯', kind: 'multi', cd: 4000, mult: 1.15, range: 13, n: 3 },
      { name: '뒤구르기 사격', icon: '↩️', kind: 'shot', cd: 6000, mult: 2.0, range: 15, move: 'back' },
      { name: '화살비', icon: '🌧️', kind: 'blast', cd: 10000, mult: 1.7, range: 15, radius: 4.2 },
    ] },
  staff: { name: '별빛 지팡이', icon: '🪄', price: 150, color: 0xb197fc, desc: '마법으로 여러 적을 한 번에',
    skills: [
      { name: '마법 구슬', icon: '🔮', kind: 'shot', cd: 700, mult: 1.05, range: 12 },
      { name: '불꽃 폭발', icon: '🔥', kind: 'blast', cd: 4500, mult: 1.9, range: 12, radius: 3.2 },
      { name: '얼음 고리', icon: '❄️', kind: 'around', cd: 7000, mult: 1.2, range: 4.5, slow: 3000 },
      { name: '번개', icon: '⚡', kind: 'shot', cd: 11000, mult: 3.4, range: 15 },
    ] },
  hammer: { name: '바위 망치와 방패', icon: '🔨', price: 220, color: 0xadb5bd, desc: '튼튼하게 버티며 친구를 지키는 역할',
    skills: [
      { name: '망치질', icon: '🔨', kind: 'arc', cd: 750, mult: 1.35, range: 2.8, arc: 1.4 },
      { name: '내려찍기', icon: '💥', kind: 'around', cd: 5000, mult: 1.6, range: 4 },
      { name: '방패 막기', icon: '🛡️', kind: 'guard', cd: 9000, guard: 0.7, dur: 3000 },
      { name: '도발 함성', icon: '📣', kind: 'taunt', cd: 12000, range: 11, heal: 0.2 },
    ] },
  lantern: { name: '반딧불 등불', icon: '🏮', price: 220, color: 0x8ce99a, desc: '친구를 치료하고 지켜 주는 역할',
    skills: [
      { name: '빛 구슬', icon: '✨', kind: 'shot', cd: 600, mult: 0.8, range: 11 },
      { name: '치유의 빛', icon: '💚', kind: 'heal', cd: 5000, heal: 0.3, range: 8 },
      { name: '보호막', icon: '🫧', kind: 'shield', cd: 9000, guard: 0.5, dur: 5000, range: 8 },
      { name: '회복의 비', icon: '🌈', kind: 'heal', cd: 14000, heal: 0.6, range: 11 },
    ] },
};
// 새 무기 3종. crit: 치명타 확률 추가 · leech: 준 피해의 일부만큼 체력 흡수 · slow: 맞은 적을 느리게
WEAPONS.dagger = { name: '그림자 쌍단검', icon: '🔪', price: 1200, color: 0xced4da, desc: '아주 빠르고 치명타가 잘 터져요',
  skills: [
    { name: '찌르기', icon: '🔪', kind: 'arc', cd: 300, mult: 0.72, range: 2.5, arc: 1.0, crit: 0.25 },
    { name: '연속 베기', icon: '✂️', kind: 'arc', cd: 3500, mult: 2.2, range: 2.7, arc: 1.2, crit: 0.25 },
    { name: '그림자 이동', icon: '🌑', kind: 'line', cd: 5000, mult: 1.8, range: 9, width: 1.4, move: 'dash', crit: 0.25 },
    { name: '급소 찌르기', icon: '🎯', kind: 'arc', cd: 10000, mult: 4.2, range: 2.7, arc: 0.9, crit: 0.5 },
  ] };
WEAPONS.spear = { name: '천둥 창', icon: '⚡', price: 1500, color: 0xffe066, desc: '멀리 찌르는 근접 무기. 번개로 적을 느리게',
  skills: [
    { name: '창 찌르기', icon: '🔱', kind: 'line', cd: 600, mult: 1.1, range: 4.8, width: 0.9 },
    { name: '휩쓸기', icon: '💫', kind: 'around', cd: 4000, mult: 1.5, range: 4.4 },
    { name: '도약 찌르기', icon: '🦘', kind: 'line', cd: 6000, mult: 2.6, range: 9, width: 1.6, move: 'dash' },
    { name: '천둥 투창', icon: '⚡', kind: 'shot', cd: 9000, mult: 3.0, range: 16, slow: 2500 },
  ] };
WEAPONS.scythe = { name: '달빛 낫', icon: '🌙', price: 1800, color: 0xb197fc, desc: '넓게 베고, 준 피해만큼 체력을 조금씩 흡수',
  skills: [
    { name: '베어내기', icon: '🌙', kind: 'arc', cd: 800, mult: 1.25, range: 3.6, arc: 1.7, leech: 0.08 },
    { name: '초승달', icon: '🌒', kind: 'around', cd: 4500, mult: 1.7, range: 4.6, leech: 0.1 },
    { name: '영혼 수확', icon: '👻', kind: 'blast', cd: 8000, mult: 2.2, range: 9, radius: 4, leech: 0.15 },
    { name: '달의 장막', icon: '🌫️', kind: 'guard', cd: 14000, guard: 0.4, dur: 6000 },
  ] };
const WEAPON_IDS = Object.keys(WEAPONS);

// ---------- 아이템 ----------
const ITEMS = {
  potion: { name: '빨간 물약', icon: '🧪', type: 'potion', heal: 0.5, buy: 20, sell: 5, desc: '체력을 절반 채워요' },
  bigpotion: { name: '큰 물약', icon: '⚗️', type: 'potion', heal: 1.0, buy: 60, sell: 15, desc: '체력을 모두 채워요' },
  jelly: { name: '슬라임 젤리', icon: '🟢', type: 'mat', sell: 3, desc: '말랑말랑. 상인에게 팔 수 있어요' },
  spore: { name: '버섯 포자', icon: '🍄', type: 'mat', sell: 8, desc: '반짝이는 가루. 상인에게 팔 수 있어요' },
  shell: { name: '이끼 껍질', icon: '🐚', type: 'mat', sell: 30, desc: '돌거북의 단단한 껍질 조각' },
  glowcap: { name: '빛나는 갓', icon: '🌟', type: 'mat', sell: 20, desc: '독버섯 두꺼비의 반짝이는 갓 조각' },
  dust: { name: '정령 가루', icon: '✨', type: 'mat', sell: 38, desc: '숲의 정령이 남긴 가루' },
  cloudfish: { name: '구름붕어', icon: '🐟', type: 'fish', sell: 6, desc: '구름 속을 헤엄치는 흔한 물고기. 모닥불에 구울 수 있어요' },
  starfish: { name: '별정어리', icon: '🐠', type: 'fish', sell: 14, desc: '비늘이 별처럼 반짝여요. 모닥불에 구울 수 있어요' },
  moonjelly: { name: '달빛해파리', icon: '🦑', type: 'mat', sell: 35, desc: '밤에만 낚여요. 귀해서 굽지 않고 팔아요' },
  rainbow: { name: '무지개송어', icon: '🐡', type: 'mat', sell: 50, desc: '아주 드문 물고기. 귀해서 굽지 않고 팔아요' },
  boot: { name: '낡은 장화', icon: '🥾', type: 'mat', sell: 1, desc: '누가 구름 아래로 떨어뜨린 장화. 한 짝뿐이에요' },
  grilled: { name: '구운 생선', icon: '🍢', type: 'food', heal: 0.4, sell: 10, desc: '먹으면 체력 40% 회복 + 2분 동안 공격력 15% 증가' },
  icecrystal: { name: '얼음 결정', icon: '🧊', type: 'mat', sell: 45, desc: '눈덩이 도깨비가 떨어뜨리는 차가운 결정' },
  fang: { name: '서리 송곳니', icon: '🦷', type: 'mat', sell: 65, desc: '서리 늑대의 날카로운 이빨' },
  heart: { name: '거인의 심장', icon: '💙', type: 'mat', sell: 300, desc: '서리 거인이 남긴 얼지 않는 심장. 아주 비싸요' },
  icefish: { name: '얼음새우', icon: '🦐', type: 'fish', sell: 24, desc: '서리봉우리에서만 낚여요. 모닥불에 구울 수 있어요' },
  crown: { name: '여왕의 왕관 조각', icon: '👑', type: 'mat', sell: 220, desc: '버섯 여왕이 남긴 반짝이는 조각. 비싸요' },
  emberscale: { name: '불씨 비늘', icon: '🔥', type: 'mat', sell: 120, desc: '불씨 도마뱀의 따뜻한 비늘' },
  magmastone: { name: '용암석', icon: '🪨', type: 'mat', sell: 180, desc: '용암 덩어리가 식으며 남긴 돌' },
  phoenixfeather: { name: '불새 깃털', icon: '🪶', type: 'mat', sell: 260, desc: '꺼지지 않는 불새의 깃털' },
  dragonheart: { name: '용의 심장', icon: '❤️‍🔥', type: 'mat', sell: 1500, desc: '분화구의 용이 남긴 심장. 엄청나게 비싸요' },
  honey: { name: '달콤한 꿀', icon: '🍯', type: 'mat', sell: 6, desc: '붕붕 꿀벌이 떨어뜨려요' },
  straw: { name: '바삭한 밀짚', icon: '🌾', type: 'mat', sell: 14, desc: '심술 허수아비의 속' },
  batwing: { name: '박쥐 날개', icon: '🦇', type: 'mat', sell: 26, desc: '포자 박쥐의 얇은 날개' },
  bark: { name: '오래된 나무껍질', icon: '🪵', type: 'mat', sell: 55, desc: '고목 나무지기의 단단한 껍질' },
  feather: { name: '펭귄 깃털', icon: '🪶', type: 'mat', sell: 50, desc: '펭귄 병사의 매끈한 깃털' },
  frostflower: { name: '서리꽃', icon: '❄️', type: 'mat', sell: 75, desc: '눈보라 정령이 남기는 얼음 꽃' },
  windstone: { name: '바람의 돌', icon: '🌀', type: 'key', sell: 0, desc: '광장 분수의 수정에 바치면 바람의 다리가 가까워져요' },
  shard: { name: '폭풍의 조각', icon: '💎', type: 'mat', sell: 120, desc: '폭풍 골렘을 쓰러뜨린 증표. 비싸게 팔려요' },
};
const ITEM_IDS = Object.keys(ITEMS);
// ---------- 장신구 (부위별로 하나씩 달 수 있는 아이템. 가방에 들어가고 거래·판매 가능) ----------
const SLOTS = [['head', '머리'], ['face', '얼굴'], ['neck', '목'], ['back', '등'], ['side', '옆']];
const ACCS = {
  a_flower: { name: '꽃 머리핀', icon: '🌸', slot: 'head', buy: 150 },
  a_horns: { name: '도깨비 뿔', icon: '😈', slot: 'head', buy: 400 },
  a_propeller: { name: '프로펠러', icon: '🚁', slot: 'head', buy: 600 },
  a_star: { name: '머리 위 별', icon: '⭐', slot: 'head', buy: 0, sell: 60 },
  a_halo: { name: '천사 고리', icon: '😇', slot: 'head', buy: 0, sell: 300 },
  a_glasses: { name: '선글라스', icon: '🕶️', slot: 'face', buy: 250 },
  a_mustache: { name: '콧수염', icon: '🥸', slot: 'face', buy: 200 },
  a_blush: { name: '빨간 코', icon: '🤡', slot: 'face', buy: 120 },
  a_bowtie: { name: '나비넥타이', icon: '🎀', slot: 'neck', buy: 150 },
  a_medal: { name: '금메달', icon: '🥇', slot: 'neck', buy: 500 },
  a_scarf: { name: '빨간 목도리', icon: '🧣', slot: 'neck', buy: 0, sell: 60 },
  a_cape: { name: '영웅 망토', icon: '🦸', slot: 'back', buy: 600 },
  a_tshell: { name: '거북 등껍질', icon: '🐢', slot: 'back', buy: 450 },
  a_wings: { name: '작은 날개', icon: '🪽', slot: 'back', buy: 0, sell: 300 },
  a_orb: { name: '떠다니는 구슬', icon: '🔮', slot: 'side', buy: 700 },
  a_flag: { name: '작은 깃발', icon: '🚩', slot: 'side', buy: 200 },
  a_balloon: { name: '분홍 풍선', icon: '🎈', slot: 'side', buy: 0, sell: 60 },
};
const ACC_IDS = Object.keys(ACCS);
for (const id of ACC_IDS) { // 가방에 들어가는 아이템으로도 등록
  const a = ACCS[id], slotName = SLOTS.find((x) => x[0] === a.slot)[1];
  ITEMS[id] = { name: a.name, icon: a.icon, type: 'acc', slot: a.slot, buy: a.buy, sell: a.sell || Math.round(a.buy * 0.4), desc: `${slotName}에 다는 장신구${a.buy ? '' : ' (뽑기 상자에서만 나와요)'}. 눌러서 달고 떼요` };
}
ITEMS.firework = { name: '폭죽', icon: '🎆', type: 'fun', buy: 30, sell: 5, desc: '눌러서 쏘면 하늘에서 터져요. 모두에게 보여요' };
ITEM_IDS.push(...ACC_IDS, 'firework');
// ---------- 보물 상자 (가끔 섬 어딘가에 나타남. 먼저 찾아서 닿는 사람이 가짐) ----------
const CHEST = { everyMs: 150000, lifeMs: 150000, reach: 2.6 };
const SHOP_ITEMS = ['potion', 'bigpotion', 'firework'];
const MAX_STACK = 99, BAG_SLOTS = 30;
// 몬스터를 잡으면 나오는 것
const LOOT = {
  slime: { gold: [2, 5], drops: [['jelly', 0.6], ['potion', 0.06]] },
  shroom: { gold: [6, 12], drops: [['spore', 0.55], ['potion', 0.12]] },
  turtle: { gold: [25, 40], drops: [['shell', 1], ['bigpotion', 0.3]] },
  toad: { gold: [15, 25], drops: [['glowcap', 0.6], ['potion', 0.15]] },
  wisp: { gold: [22, 36], drops: [['dust', 0.55], ['bigpotion', 0.1]] },
  yeti: { gold: [30, 45], drops: [['icecrystal', 0.6], ['bigpotion', 0.1]] },
  wolf: { gold: [40, 60], drops: [['fang', 0.55], ['bigpotion', 0.12]] },
  giant: { gold: [150, 220], drops: [['heart', 1], ['bigpotion', 0.5]] },
  queen: { gold: [120, 180], drops: [['crown', 1], ['bigpotion', 0.5]] },
  lizard: { gold: [90, 130], drops: [['emberscale', 0.6], ['bigpotion', 0.15]] },
  magma: { gold: [130, 180], drops: [['magmastone', 0.6], ['bigpotion', 0.15]] },
  firebird: { gold: [170, 230], drops: [['phoenixfeather', 0.55], ['bigpotion', 0.15]] },
  dragon: { gold: [600, 900], drops: [['dragonheart', 1], ['bigpotion', 1]] },
  bee: { gold: [3, 6], drops: [['honey', 0.6], ['potion', 0.08]] },
  scarecrow: { gold: [10, 18], drops: [['straw', 0.6], ['potion', 0.15]] },
  bat: { gold: [16, 26], drops: [['batwing', 0.55], ['potion', 0.15]] },
  treant: { gold: [30, 45], drops: [['bark', 0.7], ['bigpotion', 0.15]] },
  penguin: { gold: [32, 48], drops: [['feather', 0.6], ['bigpotion', 0.1]] },
  icewisp: { gold: [50, 70], drops: [['frostflower', 0.55], ['bigpotion', 0.12]] },
};
// ---------- 구름 낚시 · 요리 · 펫 ----------
// 섬 가장자리(끝에서 FISH.edge 걸음 안)에서 구름 속으로 낚싯줄을 던짐. 찌가 흔들린 뒤 window 안에 당겨야 잡힘
const FISH = { edge: 7, minMs: 2000, maxMs: 6000, window: 1300, whale: 0.01, whalePity: 100 }; // 고래는 1%, 못 만나도 100번째에는 반드시
const FISH_DAY = [['cloudfish', 0.5], ['starfish', 0.25], ['boot', 0.14], ['rainbow', 0.08], ['windstone', 0.03]];
const FISH_NIGHT = [['cloudfish', 0.33], ['starfish', 0.22], ['moonjelly', 0.27], ['boot', 0.08], ['rainbow', 0.08], ['windstone', 0.02]];
function canFish(x, z) { const I = islandOf(x, z); return !!I && Math.hypot(x - I.x, z - I.z) > I.R - FISH.edge; }
const FOOD_BUFF = { atk: 1.15, ms: 120000 };
const COOK_RANGE = 5; // 모닥불에서 이만큼 안
const PETS = {
  slimy: { name: '꼬마 슬라임', icon: '🟢', price: 300, desc: '통통 튀며 따라와요', perk: { gold: 0.1 }, perkText: '몬스터가 주는 골드 +10%' },
  firefly: { name: '반딧불이', icon: '✨', price: 400, desc: '머리 위를 빙글빙글 돌아요. 밤에 예뻐요', perk: { xp: 0.1 }, perkText: '몬스터가 주는 경험치 +10%' },
  shelly: { name: '아기 돌거북', icon: '🐢', price: 500, desc: '느릿느릿 열심히 따라와요', perk: { def: 0.1 }, perkText: '몬스터에게 받는 피해 -10%' },
  whale: { name: '아기 하늘고래', icon: '🐳', price: 0, desc: '낚시로만 만날 수 있는 아주 드문 친구', perk: { fish: 0.3, xp: 0.05 }, perkText: '낚시 기다리는 시간 -30%, 경험치 +5%' },
  goldie: { name: '황금 슬라임', icon: '🟡', price: 0, gacha: true, desc: '뽑기 상자에서만 나오는 번쩍이는 슬라임', perk: { gold: 0.25 }, perkText: '몬스터가 주는 골드 +25%' },
  ghosty: { name: '꼬마 유령', icon: '👻', price: 0, gacha: true, desc: '고급 뽑기 상자에서만 나오는 둥둥 유령', perk: { crit: 0.08 }, perkText: '치명타 확률 +8%' },
};
// ---------- 뽑기 상자 ----------
// tiers: 등급 이름 r, 확률 w(%), pool 에서 하나를 고름. 이미 가진 장식·펫이 나오면 dup 골드로 돌려줌
// pool 항목: ['item', id, 개수] · ['gold', 양] · ['pet', id]  (장신구도 아이템)
const GACHA = {
  n: { name: '나무 상자', icon: '📦', price: 100, dup: 60, tiers: [
    { r: '흔함', w: 60, pool: [['item', 'potion', 2], ['item', 'grilled', 2], ['item', 'jelly', 4], ['item', 'spore', 3], ['gold', 40]] },
    { r: '좋음', w: 30, pool: [['item', 'bigpotion', 2], ['item', 'shell', 2], ['item', 'glowcap', 2], ['item', 'icecrystal', 1], ['gold', 180]] },
    { r: '희귀', w: 9, pool: [['item', 'a_scarf', 1], ['item', 'a_balloon', 1], ['item', 'a_star', 1], ['item', 'shard', 1], ['item', 'fang', 2]] },
    { r: '전설', w: 1, pool: [['pet', 'goldie']] },
  ] },
  p: { name: '황금 상자', icon: '🎁', price: 500, dup: 300, pity: 10, tiers: [
    { r: '좋음', w: 45, pool: [['item', 'bigpotion', 4], ['item', 'icecrystal', 3], ['item', 'fang', 3], ['item', 'dust', 3], ['gold', 350]] },
    { r: '희귀', w: 40, pool: [['item', 'a_scarf', 1], ['item', 'a_balloon', 1], ['item', 'a_star', 1], ['item', 'shard', 2], ['item', 'heart', 1], ['gold', 800]] },
    { r: '영웅', w: 13, pool: [['item', 'a_halo', 1], ['item', 'a_wings', 1], ['item', 'windstone', 2], ['item', 'heart', 2]] },
    { r: '전설', w: 2, pool: [['pet', 'ghosty'], ['pet', 'goldie']] },
  ] },
};
const RARITY = ['흔함', '좋음', '희귀', '영웅', '전설'];
const PET_IDS = Object.keys(PETS);

// ---------- 무기 강화 ----------
// 한 단계마다 그 무기의 피해가 8%씩 늘어남. UPGRADES[n] = n강에서 n+1강으로 올릴 때 드는 것
const MAX_UP = 10, UP_BONUS = 0.08; // +5까지는 반드시 성공, +6부터는 확률(chance). 실패해도 단계는 안 내려감
const UPGRADES = [
  { gold: 60, mats: { jelly: 4 } },
  { gold: 120, mats: { spore: 4 } },
  { gold: 200, mats: { shell: 3 } },
  { gold: 300, mats: { glowcap: 4 } },
  { gold: 450, mats: { dust: 3, shard: 1 } },
  { gold: 800, mats: { icecrystal: 3 }, chance: 0.7 },
  { gold: 1200, mats: { fang: 3 }, chance: 0.6 },
  { gold: 1800, mats: { icecrystal: 4, fang: 3 }, chance: 0.5 },
  { gold: 2600, mats: { heart: 1 }, chance: 0.4 },
  { gold: 4000, mats: { heart: 2, shard: 2 }, chance: 0.3 },
];

// ---------- 의뢰(퀘스트) ----------
// type: kill 몬스터 잡기 · collect 재료 가져오기(완료할 때 가져감) · visit 섬에 가 보기
const QUESTS = {
  q1: { name: '말랑말랑 대청소', type: 'kill', key: 'slime', n: 5, gold: 60, xp: 20, stones: 0, lv: 1, desc: '광장 밖 풀밭의 말랑 슬라임을 5마리 잡아 줘요.' },
  q2: { name: '포자 수집', type: 'collect', key: 'spore', n: 3, gold: 120, xp: 50, stones: 0, lv: 3, desc: '버섯돌이가 떨어뜨리는 버섯 포자 3개를 가져다줘요.' },
  q3: { name: '언덕 위의 돌덩이', type: 'kill', key: 'turtle', n: 2, gold: 250, xp: 120, stones: 1, lv: 6, desc: '큰 언덕의 이끼 돌거북을 2마리 잡아 줘요.' },
  q4: { name: '하늘을 건너', type: 'visit', key: '1', n: 1, gold: 200, xp: 80, stones: 1, lv: 5, desc: '글라이더를 타고 동쪽의 버섯숲 섬에 발을 디뎌 봐요.' },
  q5: { name: '두꺼비 소동', type: 'kill', key: 'toad', n: 4, gold: 320, xp: 220, stones: 1, lv: 9, desc: '버섯숲 섬의 독버섯 두꺼비를 4마리 잡아 줘요.' },
  q6: { name: '정령의 흔적', type: 'collect', key: 'dust', n: 2, gold: 380, xp: 200, stones: 2, lv: 12, desc: '숲의 정령이 남기는 정령 가루 2개를 가져다줘요.' },
  q8: { name: '설산 정찰', type: 'visit', key: '2', n: 1, gold: 250, xp: 400, stones: 2, lv: 15, desc: '포근언덕 북쪽 끝의 바람 기둥을 타고 서리봉우리에 발을 디뎌 봐요.' },
  q9: { name: '늑대 무리', type: 'kill', key: 'wolf', n: 5, gold: 450, xp: 700, stones: 2, lv: 18, desc: '서리봉우리의 서리 늑대를 5마리 잡아 줘요.' },
  q10: { name: '산꼭대기의 주인', type: 'kill', key: 'giant', n: 1, gold: 650, xp: 1000, stones: 3, lv: 22, desc: '서리봉우리 꼭대기의 서리 거인을 쓰러뜨려요.' },
  q11: { name: '꿀단지 채우기', type: 'collect', key: 'honey', n: 4, gold: 80, xp: 35, stones: 0, lv: 2, desc: '붕붕 꿀벌이 떨어뜨리는 달콤한 꿀 4개를 가져다줘요.' },
  q12: { name: '박쥐 소탕', type: 'kill', key: 'bat', n: 5, gold: 340, xp: 260, stones: 1, lv: 11, desc: '버섯숲 섬의 포자 박쥐를 5마리 잡아 줘요.' },
  q13: { name: '펭귄 부대 해산', type: 'kill', key: 'penguin', n: 5, gold: 400, xp: 600, stones: 2, lv: 17, desc: '서리봉우리의 펭귄 병사를 5마리 잡아 줘요.' },
  q14: { name: '버섯 여왕 알현', type: 'kill', key: 'queen', n: 1, gold: 550, xp: 600, stones: 2, lv: 14, desc: '버섯숲 섬 북쪽 깊은 곳의 버섯 여왕을 쓰러뜨려요.' },
  q15: { name: '남쪽 하늘의 불빛', type: 'visit', key: '3', n: 1, gold: 600, xp: 2000, stones: 2, lv: 30, desc: 'Lv30이 되면 남쪽 하늘에 나타나는 불꽃마루에 발을 디뎌 봐요.' },
  q16: { name: '불씨 사냥', type: 'kill', key: 'lizard', n: 6, gold: 800, xp: 3500, stones: 2, lv: 30, desc: '불꽃마루의 불씨 도마뱀을 6마리 잡아 줘요.' },
  q17: { name: '분화구의 주인', type: 'kill', key: 'dragon', n: 1, gold: 2000, xp: 9000, stones: 3, lv: 40, desc: '불꽃마루 분화구 한가운데의 용을 쓰러뜨려요.' },
  q7: { name: '폭풍을 잠재워라', type: 'kill', key: 'golem', n: 1, gold: 450, xp: 300, stones: 3, lv: 10, desc: '월드 보스 폭풍 골렘을 함께 쓰러뜨려요. 한 대라도 때리면 돼요.' },
};
const QUEST_IDS = Object.keys(QUESTS), QUEST_ACTIVE_MAX = 3;
function cleanQuests(raw) {
  const q = { active: {}, done: {} };
  if (!raw || typeof raw !== 'object') return q;
  const n = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  let cnt = 0;
  for (const id of QUEST_IDS) {
    if (raw.active && raw.active[id] !== undefined && cnt < QUEST_ACTIVE_MAX) { q.active[id] = n(raw.active[id], QUESTS[id].n); cnt++; }
    const d = raw.done && n(raw.done[id], 9999); if (d) q.done[id] = d;
  }
  return q;
}

function cleanInv(raw) { // 저장된 가방을 안전하게 정리
  const inv = { gold: 0, items: {}, weapons: ['sword'], equip: 'sword', up: {}, pets: [], pet: '', wear: {}, pity: 0, wp: 0 };
  if (!raw || typeof raw !== 'object') return inv;
  const n = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  inv.gold = n(raw.gold, 999999);
  if (raw.items && typeof raw.items === 'object') {
    let slots = 0;
    for (const id of ITEM_IDS) { const c = n(raw.items[id], MAX_STACK); if (c > 0 && slots < BAG_SLOTS) { inv.items[id] = c; slots++; } }
  }
  if (Array.isArray(raw.weapons)) for (const w of raw.weapons) if (WEAPONS[w] && !inv.weapons.includes(w)) inv.weapons.push(w);
  if (inv.weapons.includes(raw.equip)) inv.equip = raw.equip;
  if (Array.isArray(raw.pets)) for (const k of raw.pets) if (PETS[k] && !inv.pets.includes(k)) inv.pets.push(k);
  if (inv.pets.includes(raw.pet)) inv.pet = raw.pet;
  // 예전 방식(장식 목록)으로 저장된 것은 가방 아이템으로 옮김
  if (Array.isArray(raw.cos)) for (const k of raw.cos) { const id = 'a_' + k; if (ACCS[id] && !inv.items[id]) inv.items[id] = 1; }
  const wearRaw = typeof raw.wear === 'string' ? (ACCS['a_' + raw.wear] ? { [ACCS['a_' + raw.wear].slot]: 'a_' + raw.wear } : {}) : (raw.wear && typeof raw.wear === 'object' ? raw.wear : {});
  for (const [slot] of SLOTS) { const id = wearRaw[slot]; if (ACCS[id] && ACCS[id].slot === slot && inv.items[id]) inv.wear[slot] = id; }
  inv.pity = n(raw.pity, 9);
  inv.wp = n(raw.wp, FISH.whalePity - 1); // 고래를 못 만난 채 낚시에 성공한 횟수
  if (raw.up && typeof raw.up === 'object') for (const w of inv.weapons) { const u = n(raw.up[w], MAX_UP); if (u) inv.up[w] = u; }
  return inv;
}

// ---------- 낮과 밤 ----------
// phase 0~1 이 하루. 0 해 뜸 · 0.62 노을 · 0.7~0.93 밤(몬스터가 세지고 보상이 많아짐)
const DAY_MS = 24 * 60000;
const isNightPhase = (ph) => ph >= 0.7 && ph < 0.93;
const NIGHT_ATK = 1.25, NIGHT_REWARD = 1.5;

// ---------- 꾸미기 ----------
const DECOS = {
  campfire: { name: '모닥불', icon: '🔥', price: 40 },
  tent: { name: '천막', icon: '⛺', price: 80 },
  bench: { name: '나무 의자', icon: '🪑', price: 30 },
  lamp: { name: '등불 기둥', icon: '🏮', price: 35 },
  flag: { name: '깃발', icon: '🚩', price: 25 },
  flower: { name: '꽃 화분', icon: '🌷', price: 15 },
  sign: { name: '팻말', icon: '🪧', price: 20, text: true },
};
const DECO_MAX = 8, DECO_TEXT = 16;
function decoAllowed(x, z) { return groundAt(x, z) > -Infinity && Math.hypot(x, z) > 15 && !UPDRAFTS.some((u) => Math.hypot(u.x - x, u.z - z) < u.r + 1); }

// ---------- 기록과 칭호 ----------
// s = { lv, gold, kills 사냥 수, boss 골렘 처치, wins 결투 승, quests 의뢰 완료, maxUp 가장 높은 강화 }
const TITLES = {
  rookie: { name: '새내기 바람잡이', how: '처음부터', ok: () => true },
  hunter: { name: '슬라임의 악몽', how: '몬스터 50마리 사냥', ok: (s) => s.kills >= 50 },
  veteran: { name: '백전노장', how: '몬스터 300마리 사냥', ok: (s) => s.kills >= 300 },
  helper: { name: '마을의 해결사', how: '의뢰 10번 완료', ok: (s) => s.quests >= 10 },
  smith: { name: '모모의 단골', how: '무기 하나를 +5까지 강화', ok: (s) => s.maxUp >= 5 },
  rich: { name: '걸어 다니는 금고', how: '골드 2,000G 넘게 가지기', ok: (s) => s.gold >= 2000 },
  storm: { name: '폭풍을 잠재운 자', how: '폭풍 골렘 처치에 참여', ok: (s) => s.boss >= 1 },
  duelist: { name: '결투가', how: '결투 3번 승리', ok: (s) => s.wins >= 3 },
  champion: { name: '광장의 챔피언', how: '결투 10번 승리', ok: (s) => s.wins >= 10 },
  legend: { name: '전설의 대장장이', how: '무기 하나를 +10까지 강화', ok: (s) => s.maxUp >= 10 },
  treasure: { name: '보물 사냥꾼', how: '보물 상자 10개 열기', ok: (s) => s.chests >= 10 },
  angler: { name: '구름 강태공', how: '낚시 30번 성공', ok: (s) => s.fish >= 30 },
  sky: { name: '하늘의 주인', how: 'Lv 20 달성', ok: (s) => s.lv >= 20 },
  lv40: { name: '구름 위의 전설', how: 'Lv 40 달성', ok: (s) => s.lv >= 40 },
  lv60: { name: '아르카의 끝을 본 자', how: 'Lv 60 달성', ok: (s) => s.lv >= 60 },
};
const TITLE_IDS = Object.keys(TITLES);
function cleanStats(raw) {
  const n = (v) => Math.max(0, Math.min(9999999, Math.floor(Number(v) || 0)));
  raw = raw && typeof raw === 'object' ? raw : {};
  return { kills: n(raw.kills), boss: n(raw.boss), wins: n(raw.wins), loses: n(raw.loses), quests: n(raw.quests), fish: n(raw.fish), chests: n(raw.chests) };
}
// ---------- 결투 ----------
const DUEL = { countdown: 3000, maxMs: 90000, range: 12, leave: 45, dmg: 0.5, loserHp: 0.3 };

const MAX_LV = 60; // 처음에는 30이었는데 하루 만에 끝까지 간 사람이 나와서 올림
const needXp = (lv) => 10 * lv * lv + 10;
const statsFor = (lv) => ({ maxHp: 80 + (lv - 1) * 15, atk: 10 + (lv - 1) * 3 });

const VERSION = 16; // 화면과 서버의 버전이 다르면 '새로고침' 안내를 띄움. 배포할 때마다 올림
const api = { unlocked, VERSION, SLOTS, ACCS, ACC_IDS, CHEST, GACHA, RARITY, SAFE_R, inSafe, FISH, FISH_DAY, FISH_NIGHT, canFish, FOOD_BUFF, COOK_RANGE, PETS, PET_IDS, TITLES, TITLE_IDS, cleanStats, DUEL, ELDER, TALK_RANGE, ALTAR_RANGE, BRIDGE, world, onBridge, MAX_UP, UP_BONUS, UPGRADES, QUESTS, QUEST_IDS, QUEST_ACTIVE_MAX, cleanQuests, ISLANDS, UPDRAFTS, UPDRAFT_TOP, islandOf, DAY_MS, isNightPhase, NIGHT_ATK, NIGHT_REWARD, DECOS, DECO_MAX, DECO_TEXT, decoAllowed, R, SPAWN, MERCHANT, SHOP_RANGE, rng, smooth, islandH, groundAt, buildLayout, MONSTERS, MONSTER_KINDS, BOSS, PARTY_MAX, PARTY_SHARE_RANGE, monsterHomes,
  UNLOCK, KEYS, WEAPONS, WEAPON_IDS, ITEMS, ITEM_IDS, SHOP_ITEMS, MAX_STACK, BAG_SLOTS, LOOT, cleanInv, MAX_LV, needXp, statsFor };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ARCA = api;
})(this);
