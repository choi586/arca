// 구름섬 아르카 — 4단계: 걷기 + 싸우기 + 모으기 + 함께하기(파티·거래·월드 보스) (정적 파일 서버 + WebSocket 멀티플레이)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const A = require('./public/shared.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_PER_CHANNEL = 40;     // 섬 하나(채널)에 들어갈 수 있는 사람 수
const TICK_MS = 66;             // 1초에 약 15번 위치를 나눠 줌
const MAX_STEP = 4;             // 한 번 보낼 때 움직일 수 있는 최대 거리(순간이동 방지)
const SPAWN_R = 8;              // 광장 근처로는 언제든 돌아올 수 있음(떨어졌을 때 부활)
const CHAT_GAP_MS = 600;
const RESPAWN_MS = 4500;        // 쓰러지고 다시 일어나기까지
const BOSS_FIRST_MS = Number(process.env.BOSS_FIRST_MS) || 90000;    // 채널이 열리고 첫 보스까지
const BOSS_RESPAWN_MS = Number(process.env.BOSS_RESPAWN_MS) || A.MONSTERS.golem.respawn;
const BOSS_STAY_MS = 8 * 60000;  // 이 시간 안에 못 잡으면 보스가 떠남
const ASK_MS = 30000;            // 초대·거래 요청이 살아 있는 시간
const LEASH = 18;               // 몬스터가 집에서 이만큼 멀어지면 돌아감
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#f8f9fa'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const LAYOUT = A.buildLayout();
const HOMES = A.monsterHomes(LAYOUT.obstacles);

// ---------- 정적 파일 ----------
const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      // 고친 내용이 바로 보이도록 html/js/css 는 매번 새로 확인
      'Cache-Control': ['.html', '.js', '.css'].includes(ext) && !file.endsWith('three.min.js') ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  });
});

// ---------- 채널(같은 섬의 여러 복사본) ----------
const channels = new Map(); // number -> { players: Map, monsters: [] }
let nextMonsterId = 1;
function makeChannel() {
  const make = (h) => {
    const def = A.MONSTERS[h.kind];
    return { id: nextMonsterId++, kind: h.kind, def, hx: h.x, hz: h.z, x: h.x, z: h.z, ry: Math.random() * 6, hp: def.hp, maxHp: def.hp, alive: true,
      st: 0, target: 0, wanderX: h.x, wanderZ: h.z, nextWander: 0, nextAtk: 0, windEnd: 0, circles: [], deadUntil: 0, hitters: new Set(), returning: false, slowUntil: 0,
      dmgBy: new Map(), pat: 0, despawnAt: 0, warned: false };
  };
  const monsters = HOMES.map(make);
  const boss = make({ kind: 'golem', x: A.BOSS.x, z: A.BOSS.z });
  boss.alive = false; boss.deadUntil = Date.now() + BOSS_FIRST_MS;
  monsters.push(boss);
  return { players: new Map(), monsters, boss };
}
function pickChannel() {
  for (let n = 1; ; n++) {
    if (!channels.has(n)) channels.set(n, makeChannel());
    if (channels.get(n).players.size < MAX_PER_CHANNEL) return n;
  }
}

let nextId = 1;
const wss = new WebSocketServer({ server, maxPayload: 2048 });

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(ch, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const p of channels.get(ch).players.values()) if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}
function publicInfo(p) { return { id: p.id, name: p.name, color: p.color, hat: p.hat, x: p.x, y: p.y, z: p.z, ry: p.ry, lv: p.lv, w: p.inv.equip }; }
function cleanText(s, max) { return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max); }
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
function sendStats(p) { send(p.ws, { t: 'stats', hp: Math.ceil(p.hp), maxHp: p.maxHp, lv: p.lv, xp: p.xp, need: A.needXp(p.lv), atk: p.atk }); }
function sendInv(p) { send(p.ws, { t: 'inv', ...p.inv }); }
function bagSlots(inv) { return Object.keys(inv.items).length; }
function addItem(inv, id, n) { // 가방이 꽉 차면 못 넣음
  if (!inv.items[id] && bagSlots(inv) >= A.BAG_SLOTS) return 0;
  const before = inv.items[id] || 0, after = Math.min(A.MAX_STACK, before + n);
  inv.items[id] = after; return after - before;
}
function removeItem(inv, id, n) { const have = inv.items[id] || 0; if (have < n) return false; if (have === n) delete inv.items[id]; else inv.items[id] = have - n; return true; }
function applyLevel(p) { const s = A.statsFor(p.lv); p.maxHp = s.maxHp; p.atk = s.atk; }

// ---------- 전투 ----------
function hurtMonster(ch, m, p, mult) {
  if (!m.alive) return;
  const crit = Math.random() < 0.12;
  const dmg = Math.max(1, Math.round(p.atk * mult * (0.9 + Math.random() * 0.2) * (crit ? 1.6 : 1)));
  m.hp -= dmg;
  m.hitters.add(p.id);
  if (m.def.boss) m.dmgBy.set(p.id, (m.dmgBy.get(p.id) || 0) + dmg);
  if (!m.target || m.returning) { m.target = p.id; m.returning = false; }
  broadcast(ch, { t: 'hit', m: m.id, dmg, crit, by: p.id });
  if (m.hp <= 0) killMonster(ch, m);
}
function killMonster(ch, m) {
  m.alive = false; m.hp = 0; m.st = 0; m.deadUntil = Date.now() + m.def.respawn;
  broadcast(ch, { t: 'mdie', id: m.id });
  // 때린 사람 모두가 경험치를 다 받음 → 모르는 사람과도 같이 싸우면 이득
  const list = channels.get(ch).players;
  if (m.def.boss) return bossRewards(ch, m);
  // 같은 파티 사람은 가까이 있으면 때리지 않아도 같이 받음
  for (const pid of [...m.hitters]) {
    const p = list.get(pid), party = p && parties.get(p.party);
    if (party) for (const q of party) if (!q.dead && Math.hypot(q.x - m.x, q.z - m.z) < A.PARTY_SHARE_RANGE) m.hitters.add(q.id);
  }
  const loot = A.LOOT[m.kind];
  for (const pid of m.hitters) {
    const p = list.get(pid); if (!p) continue;
    giveXp(ch, p, m.def.xp);
    const gold = loot.gold[0] + Math.floor(Math.random() * (loot.gold[1] - loot.gold[0] + 1));
    p.inv.gold = Math.min(999999, p.inv.gold + gold);
    const got = [];
    for (const [id, chance] of loot.drops) if (Math.random() < chance) { const n = addItem(p.inv, id, 1); got.push([id, n]); }
    send(p.ws, { t: 'loot', gold, items: got, x: r2(m.x), z: r2(m.z) });
    sendInv(p);
  }
  m.hitters.clear(); m.target = 0;
}
function giveXp(ch, p, xp) {
  if (p.lv >= A.MAX_LV) return;
  p.xp += xp;
  let up = false;
  while (p.lv < A.MAX_LV && p.xp >= A.needXp(p.lv)) { p.xp -= A.needXp(p.lv); p.lv++; up = true; }
  if (p.lv >= A.MAX_LV) p.xp = 0;
  if (up) { applyLevel(p); p.hp = p.maxHp; broadcast(ch, { t: 'lvup', id: p.id, lv: p.lv }); }
  send(p.ws, { t: 'xp', gained: xp });
  sendStats(p);
}
function hurtPlayer(ch, p, dmgRaw) {
  if (p.dead) return;
  const guard = Date.now() < p.guardUntil ? p.guard : 0;
  const dmg = Math.max(1, Math.round(dmgRaw * (0.9 + Math.random() * 0.2) * (1 - guard)));
  p.hp -= dmg; p.lastHurt = Date.now();
  broadcast(ch, { t: 'hit', p: p.id, dmg });
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.deadAt = Date.now(); p.a = 9;
    broadcast(ch, { t: 'pdie', id: p.id });
  }
  sendStats(p);
}
function healAround(ch, p, frac, range) {
  const amt = Math.round(p.maxHp * frac);
  for (const q of channels.get(ch).players.values()) {
    if (q.dead || Math.hypot(q.x - p.x, q.z - p.z) > range) continue;
    const before = q.hp; q.hp = Math.min(q.maxHp, q.hp + amt);
    broadcast(ch, { t: 'heal', id: q.id, amt: Math.round(q.hp - before) });
    sendStats(q);
  }
}
// 앞쪽(없으면 주변)에서 가까운 몬스터 고르기
function pickTargets(ch, p, range, n, fx, fz) {
  const list = [];
  for (const m of channels.get(ch).monsters) {
    if (!m.alive || Math.abs(A.islandH(m.x, m.z) - p.y) > 5) continue;
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz);
    if (d > range + m.def.size * 0.7) continue;
    const front = d < 1 ? 1 : (dx * fx + dz * fz) / d;
    list.push({ m, score: d - front * 4, front });
  }
  list.sort((a, b) => a.score - b.score);
  return list.slice(0, n).map((o) => o.m);
}
function playerAttack(ch, p, k, ry) {
  const w = A.WEAPONS[p.inv.equip], sk = w && w.skills[k];
  const now = Date.now(), cdKey = p.inv.equip + k;
  if (!sk || p.dead || p.lv < A.UNLOCK[k] || now < (p.cds[cdKey] || 0)) return;
  p.cds[cdKey] = now + sk.cd - 80;
  p.ry = ry;
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const { monsters } = channels.get(ch);
  const fxMsg = { t: 'fx', id: p.id, w: p.inv.equip, k };
  const near = (m) => Math.abs(A.islandH(m.x, m.z) - p.y) < 4;

  if (sk.kind === 'heal') { healAround(ch, p, sk.heal, sk.range); }
  else if (sk.kind === 'guard') { p.guard = sk.guard; p.guardUntil = now + sk.dur; broadcast(ch, { t: 'buff', id: p.id, dur: sk.dur }); }
  else if (sk.kind === 'shield') {
    for (const q of channels.get(ch).players.values()) {
      if (q.dead || Math.hypot(q.x - p.x, q.z - p.z) > sk.range) continue;
      q.guard = sk.guard; q.guardUntil = now + sk.dur; broadcast(ch, { t: 'buff', id: q.id, dur: sk.dur });
    }
  } else if (sk.kind === 'taunt') {
    for (const m of monsters) if (m.alive && Math.hypot(m.x - p.x, m.z - p.z) < sk.range) { m.target = p.id; m.returning = false; }
    const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * sk.heal);
    broadcast(ch, { t: 'heal', id: p.id, amt: Math.round(p.hp - before) }); sendStats(p);
  } else if (sk.kind === 'shot' || sk.kind === 'multi' || sk.kind === 'blast') {
    const targets = pickTargets(ch, p, sk.range, sk.kind === 'multi' ? sk.n : 1, fx, fz);
    if (targets.length) {
      fxMsg.tg = targets.map((m) => [r2(m.x), r2(m.z)]);
      if (sk.kind === 'blast') {
        const c = targets[0];
        for (const m of monsters) if (m.alive && Math.hypot(m.x - c.x, m.z - c.z) < sk.radius + m.def.size * 0.6) hurtMonster(ch, m, p, sk.mult);
      } else for (const m of targets) hurtMonster(ch, m, p, sk.mult);
    }
  } else { // arc, around, line
    for (const m of monsters) {
      if (!m.alive || !near(m)) continue;
      const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz), mr = m.def.size * 0.7;
      let hit = false;
      if (sk.kind === 'arc') hit = d < sk.range + mr && (d < 0.8 || Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) < sk.arc);
      else if (sk.kind === 'around') hit = d < sk.range + mr;
      else if (sk.kind === 'line') { const along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx); hit = along > -0.5 && along < sk.range + mr && side < sk.width + mr; }
      if (hit) { hurtMonster(ch, m, p, sk.mult); if (sk.slow) m.slowUntil = now + sk.slow; }
    }
  }
  broadcast(ch, fxMsg, p.id);
}

// ---------- 가방과 상점 ----------
function nearShop(p) { return Math.hypot(p.x - A.MERCHANT.x, p.z - A.MERCHANT.z) < A.SHOP_RANGE; }
function notice(p, text) { send(p.ws, { t: 'notice', text }); }
function handleShop(p, m) {
  const inv = p.inv;
  if (m.t === 'use') {
    const it = A.ITEMS[m.item];
    if (!it || it.type !== 'potion' || p.dead) return;
    const now = Date.now();
    if (now < (p.potionAt || 0)) return;
    if (p.hp >= p.maxHp) return notice(p, '체력이 이미 가득해요');
    if (!removeItem(inv, m.item, 1)) return;
    p.potionAt = now + 1000;
    const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * it.heal);
    broadcast(p.ch, { t: 'heal', id: p.id, amt: Math.round(p.hp - before) });
    sendStats(p); sendInv(p);
  } else if (m.t === 'equip') {
    if (!inv.weapons.includes(m.w) || inv.equip === m.w) return;
    inv.equip = m.w;
    broadcast(p.ch, { t: 'equip', id: p.id, w: m.w });
    sendInv(p);
  } else if (m.t === 'buy') {
    if (!nearShop(p)) return notice(p, '상인 모모 가까이에서만 살 수 있어요');
    if (A.WEAPONS[m.id]) {
      const w = A.WEAPONS[m.id];
      if (inv.weapons.includes(m.id)) return notice(p, '이미 가지고 있어요');
      if (inv.gold < w.price) return notice(p, '골드가 모자라요');
      inv.gold -= w.price; inv.weapons.push(m.id);
      notice(p, `샀어요: ${w.icon} ${w.name} — 가방(I)에서 바꿔 들 수 있어요`);
    } else if (A.SHOP_ITEMS.includes(m.id)) {
      const it = A.ITEMS[m.id], n = Math.max(1, Math.min(10, Math.floor(num(m.n, 1))));
      if (inv.gold < it.buy * n) return notice(p, '골드가 모자라요');
      const added = addItem(inv, m.id, n);
      if (!added) return notice(p, '가방이 꽉 찼어요');
      inv.gold -= it.buy * added;
      notice(p, `${it.icon} ${it.name} ${added}개를 샀어요`);
    } else return;
    sendInv(p);
  } else if (m.t === 'sell') {
    if (!nearShop(p)) return notice(p, '상인 모모 가까이에서만 팔 수 있어요');
    const it = A.ITEMS[m.id]; if (!it) return;
    const have = inv.items[m.id] || 0, n = Math.max(1, Math.min(have, Math.floor(num(m.n, 1))));
    if (!have || !removeItem(inv, m.id, n)) return;
    inv.gold = Math.min(999999, inv.gold + it.sell * n);
    notice(p, `${it.icon} ${it.name} ${n}개를 ${it.sell * n}G에 팔았어요`);
    sendInv(p);
  }
}

// ---------- 몬스터 움직임 ----------
function pushOut(m) {
  for (const o of LAYOUT.obstacles) {
    const dx = m.x - o.x, dz = m.z - o.z, d = Math.hypot(dx, dz), min = o.r + m.def.size * 0.6;
    if (d < min && d > 0.0001) { m.x = o.x + dx / d * min; m.z = o.z + dz / d * min; }
  }
  const r = Math.hypot(m.x, m.z), lim = A.R - 3;
  if (r > lim) { m.x *= lim / r; m.z *= lim / r; }
}
function stepToward(m, tx, tz, speed, dt) {
  const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return d;
  const s = Math.min(d, speed * dt);
  m.x += dx / d * s; m.z += dz / d * s;
  m.ry = Math.atan2(dx, dz);
  return d;
}
// 공격 준비 시작: 빨간 원(들)을 바닥에 보여 줌
// 패턴 0 앞 내려찍기 · 1 자기 주변 큰 원 · 2 근처 사람들 발밑(보스 전용)
function startAttack(ch, m, pat) {
  const def = m.def, now = Date.now();
  let wind = def.windup;
  if (pat === 1) { wind = 1900; m.circles = [{ x: m.x, z: m.z, r: 10 }]; }
  else if (pat === 2) {
    wind = 1500; m.circles = [];
    for (const p of channels.get(ch).players.values()) {
      if (p.dead || m.circles.length >= 6 || Math.hypot(p.x - m.x, p.z - m.z) > 30) continue;
      m.circles.push({ x: p.x, z: p.z, r: 3.2 });
    }
    if (!m.circles.length) return;
  } else m.circles = [{ x: m.x + Math.sin(m.ry) * def.hitAt, z: m.z + Math.cos(m.ry) * def.hitAt, r: def.hitR }];
  m.st = 2; m.windEnd = now + wind;
  for (const c of m.circles) broadcast(ch, { t: 'tele', id: m.id, x: r2(c.x), z: r2(c.z), r: c.r, ms: wind });
}
function bossRewards(ch, m) {
  const list = channels.get(ch).players;
  const total = [...m.dmgBy.values()].reduce((a, b) => a + b, 0) || 1;
  const rank = [...m.dmgBy.entries()].sort((a, b) => b[1] - a[1]);
  const names = [];
  rank.forEach(([pid, dmg], i) => {
    const p = list.get(pid); if (!p) return;
    if (names.length < 3) names.push(`${['🥇', '🥈', '🥉'][names.length]} ${p.name} (${Math.round(dmg / total * 100)}%)`);
    giveXp(ch, p, m.def.xp);
    const gold = 80 + Math.round(dmg / total * 400);
    p.inv.gold = Math.min(999999, p.inv.gold + gold);
    const n = addItem(p.inv, 'shard', i === 0 ? 2 : 1);
    send(p.ws, { t: 'loot', gold, items: [['shard', n]], x: r2(m.x), z: r2(m.z) });
    sendInv(p);
  });
  broadcast(ch, { t: 'notice', text: `🎉 폭풍 골렘을 쓰러뜨렸어요! ${names.join(' · ')}` });
  broadcast(ch, { t: 'bossinfo', alive: false, in: BOSS_RESPAWN_MS });
  m.deadUntil = Date.now() + BOSS_RESPAWN_MS; m.warned = false;
  m.hitters.clear(); m.dmgBy.clear(); m.target = 0;
}
function updateMonsters(ch, dt) {
  const { monsters, players } = channels.get(ch);
  const now = Date.now();
  for (const m of monsters) {
    const def = m.def;
    if (!m.alive) {
      if (def.boss && !m.warned && m.deadUntil - now < 30000) { m.warned = true; broadcast(ch, { t: 'notice', text: '⚡ 30초 뒤 섬 서북쪽에 폭풍 골렘이 나타나요!' }); }
      if (now >= m.deadUntil) {
        Object.assign(m, { alive: true, hp: def.hp, maxHp: def.hp, x: m.hx, z: m.hz, st: 0, target: 0, returning: false });
        if (def.boss) { // 사람이 많을수록 튼튼해짐
          m.maxHp = m.hp = def.hp + 1200 * Math.max(0, players.size - 1);
          m.dmgBy.clear(); m.hitters.clear(); m.pat = 0; m.despawnAt = now + BOSS_STAY_MS; m.nextAtk = now + 2500;
          broadcast(ch, { t: 'notice', text: '⚡ 폭풍 골렘이 섬 서북쪽에 나타났어요! 다 같이 잡으러 가요!' });
          broadcast(ch, { t: 'bossinfo', alive: true, in: 0 });
        }
      }
      continue;
    }
    if (def.boss && now >= m.despawnAt) { // 너무 오래 못 잡으면 떠남
      m.alive = false; m.st = 0; m.target = 0; m.warned = false; m.deadUntil = now + BOSS_RESPAWN_MS;
      broadcast(ch, { t: 'mdie', id: m.id });
      broadcast(ch, { t: 'notice', text: '폭풍 골렘이 구름 속으로 사라졌어요…' });
      broadcast(ch, { t: 'bossinfo', alive: false, in: BOSS_RESPAWN_MS });
      continue;
    }
    // 공격 준비가 끝나면 빨간 원 안에 있는 사람이 다침
    if (m.st === 2) {
      if (now >= m.windEnd) {
        for (const p of players.values()) { // 원이 여러 개여도 한 번만 다침
          if (p.dead) continue;
          if (m.circles.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.r + 0.45 && Math.abs(p.y - A.islandH(c.x, c.z)) < 3)) hurtPlayer(ch, p, def.atk);
        }
        m.st = 0; m.nextAtk = now + def.cd;
      }
      continue;
    }
    let tgt = m.target ? players.get(m.target) : null;
    if (tgt && (tgt.dead || Math.hypot(tgt.x - m.x, tgt.z - m.z) > def.aggro * 1.6)) { tgt = null; m.target = 0; }
    if (!def.boss && Math.hypot(m.x - m.hx, m.z - m.hz) > LEASH) { m.returning = true; m.target = 0; tgt = null; }
    if (m.returning) {
      m.st = 1;
      if (stepToward(m, m.hx, m.hz, def.speed * 1.6, dt) < 0.5) { m.returning = false; m.hp = m.maxHp; m.hitters.clear(); m.st = 0; }
      continue;
    }
    if (!tgt) { // 가장 가까운 사람을 찾음
      let best = null, bd = def.aggro;
      for (const p of players.values()) {
        if (p.dead || Math.abs(p.y - A.islandH(m.x, m.z)) > 4) continue;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) { tgt = best; m.target = best.id; }
    }
    if (tgt) {
      const d = Math.hypot(tgt.x - m.x, tgt.z - m.z);
      if (d > def.reach) {
        if (def.boss && now >= m.nextAtk) startAttack(ch, m, 2); // 멀리 있어도 발밑에 번개를 떨어뜨림
        else { m.st = 1; stepToward(m, tgt.x, tgt.z, def.speed * (now < m.slowUntil ? 0.45 : 1), dt); }
      } else {
        m.st = 0; m.ry = Math.atan2(tgt.x - m.x, tgt.z - m.z);
        if (now >= m.nextAtk) startAttack(ch, m, def.boss ? (m.pat = (m.pat + 1) % 3) : 0);
      }
    } else { // 집 근처를 어슬렁어슬렁
      if (now >= m.nextWander) { m.wanderX = m.hx + (Math.random() - 0.5) * 8; m.wanderZ = m.hz + (Math.random() - 0.5) * 8; m.nextWander = now + 3000 + Math.random() * 4000; }
      m.st = stepToward(m, m.wanderX, m.wanderZ, def.speed * 0.4, dt) > 0.3 ? 1 : 0;
    }
    pushOut(m);
  }
}

// ---------- 파티 ----------
const parties = new Map(); // id -> Set(player)
let nextPartyId = 1;
function sendParty(pid) {
  const set = parties.get(pid); if (!set) return;
  if (set.size < 2) { // 혼자 남으면 파티가 없어짐
    for (const p of set) { p.party = 0; send(p.ws, { t: 'party', members: [] }); }
    parties.delete(pid); return;
  }
  const members = [...set].map((p) => ({ id: p.id, name: p.name }));
  for (const p of set) send(p.ws, { t: 'party', members });
}
function leaveParty(p, quiet) {
  const set = parties.get(p.party); if (!set) return;
  const pid = p.party;
  set.delete(p); p.party = 0;
  if (!quiet) send(p.ws, { t: 'party', members: [] });
  for (const q of set) notice(q, `${p.name} 님이 파티에서 나갔어요`);
  sendParty(pid);
}
function findPlayer(me, id) { const q = channels.get(me.ch).players.get(id); return q && q !== me ? q : null; }
function handleSocial(me, m) {
  const now = Date.now();
  if (m.t === 'pleave') return leaveParty(me);
  if (m.t === 'pinvite' || m.t === 'treq') {
    const q = findPlayer(me, m.id); if (!q) return;
    const kind = m.t === 'pinvite' ? 'party' : 'trade';
    if (kind === 'party') {
      if (q.party) return notice(me, q.party === me.party ? '이미 같은 파티예요' : `${q.name} 님은 이미 다른 파티에 있어요`);
      if (me.party && parties.get(me.party).size >= A.PARTY_MAX) return notice(me, `파티는 ${A.PARTY_MAX}명까지예요`);
    } else {
      if (me.trade || q.trade) return notice(me, '지금은 거래할 수 없어요 (이미 거래 중)');
      if (Math.hypot(q.x - me.x, q.z - me.z) > 10) return notice(me, '거래하려면 더 가까이 가야 해요');
    }
    q.asks.set(kind + me.id, now);
    send(q.ws, { t: 'ask', kind, from: me.id, name: me.name });
    return notice(me, `${q.name} 님에게 ${kind === 'party' ? '파티 초대를' : '거래 요청을'} 보냈어요`);
  }
  if (m.t === 'answer') {
    const kind = m.kind === 'party' ? 'party' : 'trade', key = kind + m.from;
    const at = me.asks.get(key); me.asks.delete(key);
    const q = findPlayer(me, m.from);
    if (!at || now - at > ASK_MS || !q) return;
    if (!m.yes) return notice(q, `${me.name} 님이 ${kind === 'party' ? '초대' : '거래'}를 거절했어요`);
    if (kind === 'party') {
      if (me.party) return notice(me, '이미 파티가 있어요. 먼저 나가야 해요');
      if (!q.party) { q.party = nextPartyId++; parties.set(q.party, new Set([q])); }
      const set = parties.get(q.party);
      if (set.size >= A.PARTY_MAX) { sendParty(q.party); return notice(me, '파티가 꽉 찼어요'); }
      set.add(me); me.party = q.party;
      for (const r of set) notice(r, `${me.name} 님이 파티에 들어왔어요`);
      sendParty(q.party);
    } else {
      if (me.trade || q.trade) return notice(me, '지금은 거래할 수 없어요');
      if (Math.hypot(q.x - me.x, q.z - me.z) > 10) return notice(me, '거래하려면 더 가까이 가야 해요');
      const tr = { a: q, b: me, offer: new Map([[q.id, { gold: 0, items: {} }], [me.id, { gold: 0, items: {} }]]), ok: new Set() };
      q.trade = me.trade = tr;
      send(q.ws, { t: 'topen', with: me.id, name: me.name });
      send(me.ws, { t: 'topen', with: q.id, name: q.name });
      sendTrade(tr);
    }
    return;
  }
  const tr = me.trade; if (!tr) return;
  if (m.t === 'tcancel') return cancelTrade(tr, `${me.name} 님이 거래를 취소했어요`);
  if (m.t === 'toffer') {
    const o = { gold: Math.max(0, Math.min(me.inv.gold, Math.floor(num(m.gold)))), items: {} };
    if (m.items && typeof m.items === 'object') for (const id of A.ITEM_IDS) {
      const n = Math.max(0, Math.min(me.inv.items[id] || 0, Math.floor(num(m.items[id]))));
      if (n > 0) o.items[id] = n;
    }
    tr.offer.set(me.id, o); tr.ok.clear(); // 내용이 바뀌면 양쪽 확인이 풀림
    return sendTrade(tr);
  }
  if (m.t === 'tok') {
    tr.ok.add(me.id); sendTrade(tr);
    if (tr.ok.size === 2) finishTrade(tr);
  }
}

// ---------- 1:1 거래 ----------
function sendTrade(tr) {
  for (const [p, q] of [[tr.a, tr.b], [tr.b, tr.a]]) {
    send(p.ws, { t: 'tstate', mine: tr.offer.get(p.id), theirs: tr.offer.get(q.id), okMine: tr.ok.has(p.id), okTheirs: tr.ok.has(q.id) });
  }
}
function closeTrade(tr, done, text) {
  for (const p of [tr.a, tr.b]) { p.trade = null; send(p.ws, { t: 'tclose', done, text }); }
}
function cancelTrade(tr, text) { closeTrade(tr, false, text); }
function finishTrade(tr) {
  const { a, b } = tr, oa = tr.offer.get(a.id), ob = tr.offer.get(b.id);
  // 마지막으로 한 번 더 확인: 정말 가지고 있는지, 받을 칸이 있는지
  const check = (p, give, take) => {
    if (p.inv.gold < give.gold) return null;
    const items = { ...p.inv.items };
    for (const [id, n] of Object.entries(give.items)) { if ((items[id] || 0) < n) return null; items[id] -= n; if (!items[id]) delete items[id]; }
    for (const [id, n] of Object.entries(take.items)) { items[id] = (items[id] || 0) + n; if (items[id] > A.MAX_STACK) return null; }
    return Object.keys(items).length <= A.BAG_SLOTS ? items : null;
  };
  const ia = check(a, oa, ob), ib = check(b, ob, oa);
  if (!ia || !ib) {
    tr.ok.clear(); sendTrade(tr);
    for (const p of [a, b]) notice(p, '거래할 수 없어요: 가방이 꽉 찼거나 물건이 모자라요');
    return;
  }
  a.inv.items = ia; b.inv.items = ib;
  a.inv.gold = Math.min(999999, a.inv.gold - oa.gold + ob.gold);
  b.inv.gold = Math.min(999999, b.inv.gold - ob.gold + oa.gold);
  sendInv(a); sendInv(b);
  closeTrade(tr, true, '🤝 거래가 끝났어요!');
}

// ---------- 접속 ----------
wss.on('connection', (ws) => {
  let me = null;
  let budget = 60; // 1초에 받을 수 있는 메시지 수(도배 방지)
  const refill = setInterval(() => { budget = 60; }, 1000);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    if (--budget < 0) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join' && !me) {
      const ch = pickChannel();
      // 레벨은 브라우저에 저장된 값을 이어받음 (무료 서버는 잠들면 기억이 지워져서)
      const lv = Math.max(1, Math.min(A.MAX_LV, Math.floor(num(m.lv, 1))));
      me = {
        id: nextId++, ws, ch,
        name: cleanText(m.name, 12) || '바람잡이',
        color: COLORS.includes(m.color) ? m.color : COLORS[(nextId * 3) % COLORS.length],
        hat: Math.max(0, Math.min(3, Math.floor(num(m.hat)))),
        x: (Math.random() - 0.5) * 6, y: 3, z: 6 + Math.random() * 3, ry: Math.PI, a: 0,
        lastChat: 0, lv, xp: Math.max(0, Math.min(A.needXp(lv) - 1, Math.floor(num(m.xp)))),
        hp: 0, maxHp: 0, atk: 0, dead: false, deadAt: 0, lastHurt: 0, lastAtk: 0, cds: {}, guard: 0, guardUntil: 0, potionAt: 0,
        inv: A.cleanInv(m.inv), // 가방도 브라우저에 저장된 것을 이어받음
        party: 0, trade: null, asks: new Map(),
      };
      applyLevel(me); me.hp = me.maxHp;
      const c = channels.get(ch);
      send(ws, { t: 'welcome', id: me.id, ch, players: [...c.players.values()].map(publicInfo), me: publicInfo(me) });
      c.players.set(me.id, me);
      sendStats(me); sendInv(me);
      send(ws, { t: 'bossinfo', alive: c.boss.alive, in: c.boss.alive ? 0 : Math.max(0, c.boss.deadUntil - Date.now()) });
      broadcast(ch, { t: 'join', p: publicInfo(me) }, me.id);
      return;
    }
    if (!me) return;

    if (m.t === 'm' && Array.isArray(m.p) && m.p.length === 4) {
      if (me.dead) return;
      let [x, y, z, ry] = m.p.map((v) => num(v));
      const dx = x - me.x, dz = z - me.z;
      const d = Math.hypot(dx, dz);
      const nearSpawn = Math.hypot(x, z - 7) < SPAWN_R;
      if (d > MAX_STEP && !nearSpawn) { x = me.x + (dx / d) * MAX_STEP; z = me.z + (dz / d) * MAX_STEP; }
      me.x = Math.max(-200, Math.min(200, x));
      me.y = Math.max(-80, Math.min(80, y));
      me.z = Math.max(-200, Math.min(200, z));
      me.ry = ry;
      me.a = Math.max(0, Math.min(12, Math.floor(num(m.a))));
    } else if (m.t === 'atk') {
      playerAttack(me.ch, me, Math.floor(num(m.k, -1)), num(m.ry, me.ry));
    } else if (m.t === 'use' || m.t === 'equip' || m.t === 'buy' || m.t === 'sell') {
      handleShop(me, m);
    } else if (['pinvite', 'pleave', 'treq', 'answer', 'toffer', 'tok', 'tcancel'].includes(m.t)) {
      handleSocial(me, m);
    } else if (m.t === 'respawn') {
      if (!me.dead || Date.now() - me.deadAt < RESPAWN_MS - 300) return;
      me.dead = false; me.hp = me.maxHp; me.a = 0;
      me.x = (Math.random() - 0.5) * 4; me.z = A.SPAWN.z + Math.random() * 2; me.y = A.islandH(me.x, me.z);
      send(ws, { t: 'revive', x: me.x, y: me.y, z: me.z });
      broadcast(me.ch, { t: 'revived', id: me.id }, me.id);
      sendStats(me);
    } else if (m.t === 'chat') {
      const text = cleanText(m.text, 80);
      const now = Date.now();
      if (!text || now - me.lastChat < CHAT_GAP_MS) return;
      me.lastChat = now;
      broadcast(me.ch, { t: 'chat', id: me.id, name: me.name, text });
    } else if (m.t === 'emote') {
      const e = Math.max(1, Math.min(3, Math.floor(num(m.e))));
      broadcast(me.ch, { t: 'emote', id: me.id, e }, me.id);
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    if (!me) return;
    const c = channels.get(me.ch);
    c.players.delete(me.id);
    if (me.trade) cancelTrade(me.trade, `${me.name} 님이 나가서 거래가 취소됐어요`);
    leaveParty(me, true);
    for (const mo of c.monsters) { if (mo.target === me.id) mo.target = 0; mo.hitters.delete(me.id); mo.dmgBy.delete(me.id); }
    broadcast(me.ch, { t: 'leave', id: me.id, name: me.name });
  });
});

// 몬스터를 움직이고 모두의 위치를 나눠 주기
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.2, (now - lastTick) / 1000); lastTick = now;
  for (const [ch, c] of channels) {
    if (c.players.size === 0) continue;
    updateMonsters(ch, dt);
    const p = [], mo = [];
    for (const q of c.players.values()) p.push([q.id, r2(q.x), r2(q.y), r2(q.z), r2(q.ry), q.a, Math.round(q.hp / q.maxHp * 100), q.lv]);
    for (const m of c.monsters) if (m.alive) mo.push([m.id, A.MONSTER_KINDS.indexOf(m.kind), r2(m.x), r2(m.z), r2(m.ry), Math.max(1, Math.round(m.hp / m.maxHp * 100)), m.st, now < m.slowUntil ? 1 : 0]);
    broadcast(ch, { t: 's', p, m: mo });
  }
}, TICK_MS);

// 싸우지 않을 때 체력이 조금씩 차오름 (+ 너무 멀어진 거래는 취소)
setInterval(() => {
  const now = Date.now();
  for (const c of channels.values()) for (const p of c.players.values()) {
    if (p.trade && Math.hypot(p.trade.a.x - p.trade.b.x, p.trade.a.z - p.trade.b.z) > 14) cancelTrade(p.trade, '서로 너무 멀어져서 거래가 취소됐어요');
    if (p.dead || p.hp >= p.maxHp || now - p.lastHurt < 6000) continue;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.04);
    sendStats(p);
  }
}, 1000);

// 끊긴 연결 정리
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

server.listen(PORT, () => console.log(`구름섬 아르카 서버: http://localhost:${PORT}`));
