// 구름섬 아르카 — 5단계: 걷기 + 싸우기 + 모으기 + 함께하기 + 넓히기(새 섬·글라이더·낮과 밤·꾸미기) (정적 파일 서버 + WebSocket 멀티플레이)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const A = require('./public/shared.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_PER_CHANNEL = 40;     // 섬 하나(채널)에 들어갈 수 있는 사람 수
const TICK_MS = 100;            // 1초에 10번 위치를 나눠 줌
const VIEW_R = 110;             // 이보다 먼 몬스터는 보내지 않음 (가로+세로 거리)
const FULL_EVERY = 30;          // 이만큼마다 한 번은 달라진 것만이 아니라 전부 보냄 (약 3초)
const MAX_STEP = 4;             // 한 번 보낼 때 움직일 수 있는 최대 거리(순간이동 방지)
const SPAWN_R = 8;              // 광장 근처로는 언제든 돌아올 수 있음(떨어졌을 때 부활)
const CHAT_GAP_MS = 600;
const RESPAWN_MS = 4500;        // 쓰러지고 다시 일어나기까지
const BOSS_FIRST_MS = Number(process.env.BOSS_FIRST_MS) || 90000;    // 채널이 열리고 첫 보스까지
const BOSS_RESPAWN_MS = Number(process.env.BOSS_RESPAWN_MS) || A.MONSTERS.golem.respawn;
const BOSS_STAY_MS = 8 * 60000;  // 이 시간 안에 못 잡으면 보스가 떠남
const DAY_MS = Number(process.env.DAY_MS) || A.DAY_MS;   // 게임 속 하루 길이
const dayStart = Date.now() - DAY_MS * 0.1;              // 서버가 켜질 때는 아침
const phaseNow = () => ((Date.now() - dayStart) % DAY_MS) / DAY_MS;
const isNight = () => A.isNightPhase(phaseNow());
const AFK_MS = Number(process.env.AFK_MS) || 30 * 60000; // 이만큼 아무것도 안 하면 섬에서 내보냄
const HIDDEN_MS = Number(process.env.HIDDEN_MS) || 10 * 60000; // 화면을 가린 채(다른 탭·다른 앱) 이만큼 지나면 내보냄
const ASK_MS = 30000;            // 초대·거래 요청이 살아 있는 시간
const LEASH = 18;               // 몬스터가 집에서 이만큼 멀어지면 돌아감
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#f8f9fa'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const LAYOUT = A.buildLayout();
const HOMES = A.monsterHomes(LAYOUT.obstacles);

// ---------- 관리자용 유저 현황 ----------
// Render 환경 변수 ADMIN_KEY 를 정해 두어야 켜짐. 열쇠는 주소가 아니라 요청 머리말(x-admin-key)로 받음
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const startedAt = Date.now();
const seen = new Map();   // 서버가 켜진 뒤 다녀간 사람 (uid 또는 이름 기준). 서버가 다시 켜지면 비워짐
let peak = 0, peakAt = 0, totalJoins = 0;
const seenKey = (p) => p.uid || 'name:' + p.name;
function seenJoin(p) {
  p.joinedAt = Date.now(); totalJoins++;
  let e = seen.get(seenKey(p));
  if (!e) { e = { first: p.joinedAt, visits: 0, playMs: 0 }; seen.set(seenKey(p), e); if (seen.size > 2000) seen.delete(seen.keys().next().value); }
  e.visits++; seenTouch(p, e);
  let n = 0; for (const c of channels.values()) n += c.players.size;
  if (n > peak) { peak = n; peakAt = p.joinedAt; }
}
function seenTouch(p, e = seen.get(seenKey(p))) {
  if (!e) return;
  Object.assign(e, { name: p.name, lv: p.lv, gold: p.inv.gold, last: Date.now() });
}
function seenLeave(p) { const e = seen.get(seenKey(p)); if (e && p.joinedAt) { e.playMs += Date.now() - p.joinedAt; seenTouch(p, e); } }
function adminStatus(req, res) {
  const key = String(req.headers['x-admin-key'] || '');
  const ok = ADMIN_KEY.length >= 8 && key.length === ADMIN_KEY.length && require('crypto').timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_KEY));
  if (!ok) return setTimeout(() => { res.writeHead(ADMIN_KEY ? 401 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: ADMIN_KEY ? 'key' : 'off' })); }, 400);
  const now = Date.now(), online = [], onKeys = new Map();
  for (const [ch, c] of channels) for (const p of c.players.values()) {
    const I = A.islandOf(p.x, p.z); onKeys.set(seenKey(p), now - (p.joinedAt || now));
    online.push({
      name: p.name, lv: p.lv, gold: p.inv.gold, ch, isle: I ? I.name : '하늘', hp: Math.round(p.hp / p.maxHp * 100), dead: p.dead,
      weapon: (A.WEAPONS[p.inv.equip] || {}).name || p.inv.equip, title: (A.TITLES[p.title] || {}).name || '',
      items: Object.values(p.inv.items || {}).reduce((a, b) => a + b, 0), pets: (p.inv.pets || []).length,
      kills: p.st.kills || 0, wins: p.st.wins || 0, fish: p.st.fish || 0,
      party: p.party ? parties.get(p.party).size : 0, trading: !!p.trade, dueling: !!p.duel,
      onMs: now - (p.joinedAt || now), idleMs: now - p.lastAct, hidden: !!p.hiddenAt, id: (p.uid || '').slice(0, 6),
    });
  }
  const visitors = [...seen.entries()].map(([k, e]) => ({ name: e.name, lv: e.lv, gold: e.gold, visits: e.visits, first: e.first, last: e.last, playMs: e.playMs + (onKeys.get(k) || 0), online: onKeys.has(k), id: k.startsWith('name:') ? '' : k.slice(0, 6) }))
    .sort((a, b) => b.last - a.last).slice(0, 300);
  const mem = process.memoryUsage();
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ now, startedAt, version: A.VERSION, channels: [...channels.values()].filter((c) => c.players.size).length, online, visitors, seenCount: seen.size,
    peak, peakAt, totalJoins, night: isNight(), memMb: Math.round(mem.rss / 1048576), afkMin: AFK_MS / 60000, hiddenMin: HIDDEN_MS / 60000 }));
}

// ---------- 정적 파일 ----------
const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url.pathname === '/admin/status') return adminStatus(req, res);
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
    return { id: nextMonsterId++, kind: h.kind, def, isl: h.isl || 0, hx: h.x, hz: h.z, x: h.x, z: h.z, ry: Math.random() * 6, hp: def.hp, maxHp: def.hp, alive: true,
      st: 0, target: 0, wanderX: h.x, wanderZ: h.z, nextWander: 0, nextAtk: 0, windEnd: 0, circles: [], deadUntil: 0, hitters: new Set(), returning: false, slowUntil: 0,
      dmgBy: new Map(), pat: 0, despawnAt: 0, warned: false };
  };
  const monsters = HOMES.map(make);
  const boss = make({ kind: 'golem', x: A.BOSS.x, z: A.BOSS.z });
  boss.alive = false; boss.deadUntil = Date.now() + BOSS_FIRST_MS;
  monsters.push(boss);
  return { players: new Map(), monsters, boss, decos: new Map(), chest: null, nextChest: Date.now() + 60000 };
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
function publicInfo(p) { return { id: p.id, name: p.name, color: p.color, hat: p.hat, x: p.x, y: p.y, z: p.z, ry: p.ry, lv: p.lv, w: p.inv.equip, title: titleName(p), pet: p.inv.pet, cos: p.inv.wear }; } // cos: { 부위: 장신구 }
function cleanText(s, max) { return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max); }
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
function sendStats(p) { send(p.ws, { t: 'stats', hp: Math.ceil(p.hp), maxHp: p.maxHp, lv: p.lv, xp: p.xp, need: A.needXp(p.lv), atk: p.atk }); }
function titleName(p) { return p.title && A.TITLES[p.title] ? A.TITLES[p.title].name : ''; }
function statsOf(p) { return { lv: p.lv, gold: p.inv.gold, kills: p.st.kills, boss: p.st.boss, wins: p.st.wins, quests: p.st.quests, fish: p.st.fish, chests: p.st.chests, maxUp: Math.max(0, ...Object.values(p.inv.up)) }; }
function sendSt(p) { send(p.ws, { t: 'st', st: p.st, title: p.title }); }
function perk(p) { const pet = A.PETS[p.inv.pet]; return (pet && pet.perk) || {}; } // 데리고 있는 펫의 능력
function sendInv(p) {
  // 가방에서 사라진 장신구(팔았거나 거래로 넘김)는 몸에서도 떼어 냄
  let changed = false;
  for (const slot in p.inv.wear) if (!p.inv.items[p.inv.wear[slot]]) { delete p.inv.wear[slot]; changed = true; }
  if (changed && channels.has(p.ch)) broadcast(p.ch, { t: 'cos', id: p.id, cos: p.inv.wear });
  send(p.ws, { t: 'inv', ...p.inv });
}
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
  if (A.inSafe(p.x, p.z)) { // 안전 구역 안에서 밖의 몬스터를 때릴 수는 없음 (맞지 않는 대신 때리지도 못함)
    if (Date.now() - (p.safeTold || 0) > 4000) { p.safeTold = Date.now(); notice(p, '🛡️ 광장 안에서는 몬스터를 공격할 수 없어요. 밖으로 나가서 싸워요'); }
    return;
  }
  const sk = p.curSk || {};
  const crit = Math.random() < 0.12 + (sk.crit || 0) + (perk(p).crit || 0); // 단검과 꼬마 유령은 치명타가 더 잘 터짐
  const up = (1 + A.UP_BONUS * (p.inv.up[p.inv.equip] || 0)) * (Date.now() < p.buffUntil ? A.FOOD_BUFF.atk : 1); // 강화한 무기와 구운 생선은 더 아픔
  const dmg = Math.max(1, Math.round(p.atk * mult * up * (0.9 + Math.random() * 0.2) * (crit ? 1.6 : 1)));
  m.hp -= dmg;
  if (sk.leech && !p.dead && p.hp < p.maxHp) { // 낫은 준 피해의 일부만큼 체력을 되찾음
    const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(dmg * sk.leech)));
    broadcast(ch, { t: 'heal', id: p.id, amt: Math.round(p.hp - before) }); sendStats(p);
  }
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
  const loot = A.LOOT[m.kind], bonus = isNight() ? A.NIGHT_REWARD : 1; // 밤에는 보상이 더 많음
  for (const pid of m.hitters) {
    const p = list.get(pid); if (!p) continue;
    giveXp(ch, p, Math.round(m.def.xp * bonus * (1 + (perk(p).xp || 0))));
    questEvent(p, 'kill', m.kind);
    p.st.kills++; sendSt(p);
    const gold = Math.round((loot.gold[0] + Math.floor(Math.random() * (loot.gold[1] - loot.gold[0] + 1))) * bonus * (1 + (perk(p).gold || 0)));
    p.inv.gold = Math.min(999999, p.inv.gold + gold);
    const got = [];
    for (const [id, chance] of loot.drops) if (Math.random() < chance) { const n = addItem(p.inv, id, 1); got.push([id, n]); if (n) questEvent(p, 'collect', id); }
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
  const dmg = Math.max(1, Math.round(dmgRaw * (0.9 + Math.random() * 0.2) * (1 - guard) * (1 - (perk(p).def || 0))));
  p.hp -= dmg; p.lastHurt = Date.now();
  broadcast(ch, { t: 'hit', p: p.id, dmg });
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.deadAt = Date.now(); p.a = 9;
    if (p.duel) endDuel(p.duel, null, '결투 중에 몬스터에게 쓰러져서 결투가 무효가 됐어요');
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
  p.curSk = sk; // 피해 계산이 지금 쓴 기술의 특성(치명타·흡수)을 알 수 있게
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
      } else for (const m of targets) { hurtMonster(ch, m, p, sk.mult); if (sk.slow) m.slowUntil = now + sk.slow; }
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
  // 결투 중이면 상대도 맞음
  const q = p.duel && now >= p.duel.start ? (p.duel.a === p ? p.duel.b : p.duel.a) : null;
  if (q && !q.dead && sk.mult) {
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz), front = d < 0.8 ? 1 : (dx * fx + dz * fz) / d;
    let hit = false;
    if (sk.kind === 'arc') hit = d < sk.range + 0.5 && Math.acos(Math.max(-1, Math.min(1, front))) < sk.arc;
    else if (sk.kind === 'around') hit = d < sk.range + 0.5;
    else if (sk.kind === 'line') { const along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx); hit = along > -0.5 && along < sk.range + 0.5 && side < sk.width + 0.5; }
    else hit = d < sk.range + 0.5 && front > 0.3; // 화살·마법은 상대 쪽을 보고 있어야 맞음
    if (hit && Math.abs(q.y - p.y) < 4) { if (!fxMsg.tg) fxMsg.tg = [[r2(q.x), r2(q.z)]]; hurtDuel(ch, p, q, sk.mult); }
  }
  broadcast(ch, fxMsg, p.id);
}

// ---------- 보물 상자 ----------
let nextChestId = 1;
function spawnChest(ch) {
  const c = channels.get(ch);
  const I = A.ISLANDS[Math.random() < 0.55 ? 0 : Math.random() < 0.6 ? 1 : 2];
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2, r = (I.id ? 5 : A.SAFE_R + 4) + Math.random() * (I.R - (I.id ? 11 : A.SAFE_R + 10));
    const x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r;
    if (LAYOUT.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1.5) || A.UPDRAFTS.some((u) => Math.hypot(u.x - x, u.z - z) < u.r + 2)) continue;
    c.chest = { id: nextChestId++, x: r2(x), z: r2(z), isl: I.id, until: Date.now() + A.CHEST.lifeMs };
    broadcast(ch, { t: 'chest', chest: c.chest });
    broadcast(ch, { t: 'notice', text: `🧰 ${I.icon} ${I.name} 어딘가에 보물 상자가 나타났어요! 먼저 찾는 사람이 임자예요` });
    return;
  }
}
function openChest(p) {
  const c = channels.get(p.ch), ch = c.chest;
  if (!ch || p.dead || Math.hypot(p.x - ch.x, p.z - ch.z) > A.CHEST.reach + 1) return;
  c.chest = null; c.nextChest = Date.now() + A.CHEST.everyMs;
  const mult = [1, 1.6, 2.6][ch.isl], inv = p.inv;
  const gold = Math.round((100 + Math.random() * 150) * mult);
  inv.gold = Math.min(999999, inv.gold + gold);
  const got = [];
  const give = (id, n) => { const added = addItem(inv, id, n); if (added) got.push(`${A.ITEMS[id].icon} ${A.ITEMS[id].name}${A.ITEMS[id].type === 'acc' ? '' : ' ×' + added}`); };
  give('firework', 2);
  const r = Math.random();
  if (r < 0.25) { const shop = A.ACC_IDS.filter((id) => A.ACCS[id].buy); give(shop[Math.floor(Math.random() * shop.length)], 1); }
  else if (r < 0.6) give('bigpotion', 2);
  else if (r < 0.8) give(ch.isl === 2 ? 'heart' : 'shard', 1);
  else give('windstone', 1);
  p.st.chests++; sendSt(p); sendInv(p);
  broadcast(p.ch, { t: 'chest', chest: null, by: p.id });
  broadcast(p.ch, { t: 'notice', text: `🧰 ${p.name} 님이 보물 상자를 열었어요! ${gold}G${got.length ? ' · ' + got.join(', ') : ''}` });
}

// ---------- 뽑기 상자 · 장식 ----------
function rollGacha(p, box, forceTier) {
  const inv = p.inv;
  let tier = box.tiers[0], r = Math.random() * 100;
  for (const t of box.tiers) { if (r < t.w) { tier = t; break; } r -= t.w; }
  if (forceTier !== undefined && A.RARITY.indexOf(tier.r) < forceTier) { // 천장: 영웅 이상 확정
    const hi = box.tiers.filter((t) => A.RARITY.indexOf(t.r) >= forceTier), sum = hi.reduce((a, t) => a + t.w, 0);
    let x = Math.random() * sum; tier = hi[0];
    for (const t of hi) { if (x < t.w) { tier = t; break; } x -= t.w; }
  }
  const [kind, a, b] = tier.pool[Math.floor(Math.random() * tier.pool.length)];
  const res = { r: tier.r };
  if (kind === 'gold') { inv.gold = Math.min(999999, inv.gold + a); res.icon = '💰'; res.text = `${a}G`; }
  else if (kind === 'item') {
    const it = A.ITEMS[a], had = inv.items[a] || 0, n = addItem(inv, a, b);
    res.icon = it.icon; res.text = it.type === 'acc' ? it.name : `${it.name} ×${b}`;
    if (it.type === 'acc' && !had && n) res.isNew = true;
    if (n < b) { const back = (b - n) * (it.sell || 20); inv.gold = Math.min(999999, inv.gold + back); res.text += ` (가방이 꽉 차서 ${back}G로)`; }
  } else {
    const list = inv.pets, def = A.PETS[a];
    res.icon = def.icon; res.text = def.name;
    if (list.includes(a)) { inv.gold = Math.min(999999, inv.gold + box.dup); res.text += ` (이미 있어서 ${box.dup}G로)`; }
    else { list.push(a); res.isNew = true; if (kind === 'pet') { inv.pet = a; broadcast(p.ch, { t: 'pet', id: p.id, pet: a }); } } // 새 펫은 바로 따라옴
  }
  return res;
}
function handleGacha(p, m) {
  const inv = p.inv;
  if (m.t === 'wear') { // { slot, id } id 가 비면 그 부위를 뗌
    const slotOk = A.SLOTS.some((x) => x[0] === m.slot); if (!slotOk) return;
    if (!m.id) delete inv.wear[m.slot];
    else { const acc = A.ACCS[m.id]; if (!acc || acc.slot !== m.slot || !inv.items[m.id]) return; inv.wear[m.slot] = m.id; }
    sendInv(p);
    return broadcast(p.ch, { t: 'cos', id: p.id, cos: inv.wear });
  }
  const box = A.GACHA[m.box]; if (!box) return;
  if (!nearShop(p)) return notice(p, '상인 모모 가까이에서만 뽑을 수 있어요');
  const n = m.n === 10 ? 10 : 1;
  if (inv.gold < box.price * n) return notice(p, '골드가 모자라요');
  for (const id in box.mats || {}) if ((inv.items[id] || 0) < box.mats[id] * n) return notice(p, `${A.ITEMS[id].name}이(가) 모자라요 (${box.mats[id] * n}개 필요)`);
  inv.gold -= box.price * n;
  for (const id in box.mats || {}) removeItem(inv, id, box.mats[id] * n);
  const pk = box.pityKey || 'pity', pt = box.pityTier || 3;
  const out = [];
  for (let i = 0; i < n; i++) {
    let force;
    if (box.pity) { inv[pk]++; if (inv[pk] >= box.pity) force = pt; }
    const res = rollGacha(p, box, force);
    if (box.pity && A.RARITY.indexOf(res.r) >= pt) inv[pk] = 0;
    out.push(res);
    if (res.r === '전설') broadcast(p.ch, { t: 'notice', text: `🎉 ${p.name} 님이 ${box.name}에서 전설 ${res.icon} ${res.text.split(' (')[0]}을(를) 뽑았어요!` });
  }
  sendInv(p);
  send(p.ws, { t: 'gacha', box: m.box, res: out });
}

// ---------- 구름 낚시 · 요리 · 펫 ----------
function handleLeisure(p, m) {
  const inv = p.inv, now = Date.now();
  if (m.t === 'fish') {
    if (p.dead || p.duel) return;
    if (!A.canFish(p.x, p.z)) return notice(p, '낚시는 섬 가장자리에서 할 수 있어요');
    const wait = (A.FISH.minMs + Math.random() * (A.FISH.maxMs - A.FISH.minMs)) * (1 - (perk(p).fish || 0));
    p.fish = { bite: now + wait, x: p.x, z: p.z };
    return send(p.ws, { t: 'fishing', in: Math.round(wait), window: A.FISH.window });
  }
  if (m.t === 'reel') {
    const f = p.fish; p.fish = null;
    if (!f) return;
    if (Math.hypot(p.x - f.x, p.z - f.z) > 1.5) return send(p.ws, { t: 'caught', fail: '움직여서 낚싯줄이 끊어졌어요' });
    if (now < f.bite) return send(p.ws, { t: 'caught', fail: '너무 빨리 당겼어요! 찌가 흔들릴 때까지 기다려요' });
    if (now > f.bite + A.FISH.window + 250) return send(p.ws, { t: 'caught', fail: '아깝다, 놓쳤어요!' });
    p.st.fish++; sendSt(p);
    const noWhale = !inv.pets.includes('whale');
    if (noWhale) inv.wp++;
    if (noWhale && (Math.random() < A.FISH.whale || inv.wp >= A.FISH.whalePity)) { // 100번째에는 반드시 만남
      inv.pets.push('whale'); inv.pet = 'whale'; inv.wp = 0;
      sendInv(p);
      broadcast(p.ch, { t: 'pet', id: p.id, pet: 'whale' });
      broadcast(p.ch, { t: 'notice', text: `🐳 ${p.name} 님이 낚시로 아기 하늘고래를 만났어요!` });
      return send(p.ws, { t: 'caught', pet: 'whale' });
    }
    const table = isNight() ? A.FISH_NIGHT : A.FISH_DAY;
    let r = Math.random(), id = table[0][0];
    for (const [k, w] of table) { if (r < w) { id = k; break; } r -= w; }
    if (id === 'cloudfish' && (A.islandOf(p.x, p.z) || {}).id === 2) id = 'icefish'; // 서리봉우리에서는 얼음새우가 낚임
    const n = addItem(inv, id, 1);
    sendInv(p);
    return send(p.ws, n ? { t: 'caught', item: id, wp: noWhale ? inv.wp : -1 } : { t: 'caught', fail: `${A.ITEMS[id].name}을(를) 낚았지만 가방이 꽉 차서 놓아줬어요` });
  }
  if (m.t === 'cook') {
    const fire = [...channels.get(p.ch).decos.values()].some((d) => d.k === 'campfire' && Math.hypot(d.x - p.x, d.z - p.z) < A.COOK_RANGE);
    if (!fire) return notice(p, '모닥불 가까이에서 구울 수 있어요. 꾸미기(K)로 모닥불을 놓아 보세요');
    let total = 0;
    for (const id of A.ITEM_IDS) if (A.ITEMS[id].type === 'fish' && inv.items[id]) { total += inv.items[id]; }
    if (!total) return notice(p, '구울 물고기가 없어요. 섬 가장자리에서 낚시(X)해 보세요');
    const room = A.MAX_STACK - (inv.items.grilled || 0);
    if (room <= 0) return notice(p, '구운 생선을 더 가질 수 없어요');
    let left = Math.min(total, room), cooked = 0;
    for (const id of A.ITEM_IDS) if (A.ITEMS[id].type === 'fish' && inv.items[id] && left > 0) { const n = Math.min(left, inv.items[id]); removeItem(inv, id, n); left -= n; cooked += n; }
    inv.items.grilled = (inv.items.grilled || 0) + cooked; // 날생선 칸이 비니 가방이 넘칠 일은 없음
    sendInv(p);
    broadcast(p.ch, { t: 'cookfx', id: p.id });
    return notice(p, `🍢 생선 ${cooked}마리를 구웠어요! 가방에서 눌러 먹어요`);
  }
  if (m.t === 'pet') {
    if (m.id && !inv.pets.includes(m.id)) return;
    inv.pet = m.id || '';
    sendInv(p);
    broadcast(p.ch, { t: 'pet', id: p.id, pet: inv.pet });
  }
}

// ---------- 결투 ----------
function hurtDuel(ch, p, q, mult) {
  const crit = Math.random() < 0.12 + ((p.curSk || {}).crit || 0), up = (1 + A.UP_BONUS * (p.inv.up[p.inv.equip] || 0)) * (Date.now() < p.buffUntil ? A.FOOD_BUFF.atk : 1);
  const guard = Date.now() < q.guardUntil ? q.guard : 0;
  const dmg = Math.max(1, Math.round(p.atk * mult * up * A.DUEL.dmg * (0.9 + Math.random() * 0.2) * (crit ? 1.6 : 1) * (1 - guard)));
  q.hp -= dmg; q.lastHurt = Date.now();
  broadcast(ch, { t: 'hit', p: q.id, dmg, crit, by: p.id });
  if (q.hp <= 0) { q.hp = Math.ceil(q.maxHp * A.DUEL.loserHp); endDuel(p.duel, p); }
  sendStats(q);
}
function startDuel(a, b) {
  const d = { a, b, start: Date.now() + A.DUEL.countdown, end: Date.now() + A.DUEL.countdown + A.DUEL.maxMs };
  a.duel = b.duel = d;
  for (const p of [a, b]) { p.hp = p.maxHp; sendStats(p); }
  broadcast(a.ch, { t: 'duel', a: a.id, b: b.id, an: a.name, bn: b.name, in: A.DUEL.countdown });
}
function endDuel(d, winner, text) {
  const { a, b } = d;
  a.duel = b.duel = null;
  if (winner) {
    const loser = winner === a ? b : a;
    winner.st.wins++; loser.st.loses++; sendSt(winner); sendSt(loser);
    text = `⚔️ ${winner.name} 님이 ${loser.name} 님과의 결투에서 이겼어요!`;
  }
  if (channels.has(a.ch)) broadcast(a.ch, { t: 'duelend', a: a.id, b: b.id, win: winner ? winner.id : 0, text });
}
function handleRecord(me, m) {
  if (m.t === 'title') {
    const t = A.TITLES[m.id];
    if (m.id && (!t || !t.ok(statsOf(me)))) return notice(me, '아직 얻지 못한 칭호예요');
    me.title = m.id || '';
    sendSt(me);
    broadcast(me.ch, { t: 'title', id: me.id, title: titleName(me) });
  } else if (m.t === 'rank') {
    const all = []; for (const c of channels.values()) for (const p of c.players.values()) all.push(p);
    const top = (f) => all.filter((p) => f(p) > 0).sort((x, y) => f(y) - f(x)).slice(0, 5).map((p) => [p.name, f(p), p.id === me.id]);
    send(me.ws, { t: 'rank', lv: top((p) => p.lv), wins: top((p) => p.st.wins), kills: top((p) => p.st.kills), n: all.length });
  }
}

// ---------- 가방과 상점 ----------
function nearShop(p) { return Math.hypot(p.x - A.MERCHANT.x, p.z - A.MERCHANT.z) < A.SHOP_RANGE; }
function notice(p, text) { send(p.ws, { t: 'notice', text }); }
function handleShop(p, m) {
  const inv = p.inv;
  if (m.t === 'use') {
    const it = A.ITEMS[m.item];
    if (it && it.type === 'fun' && !p.dead) { // 폭죽: 모두에게 보이는 불꽃
      if (Date.now() < (p.funAt || 0) || !removeItem(inv, m.item, 1)) return;
      p.funAt = Date.now() + 700;
      broadcast(p.ch, { t: 'firework', x: r2(p.x), y: r2(p.y), z: r2(p.z), c: Math.floor(Math.random() * 6) });
      return sendInv(p);
    }
    if (it && it.type === 'food' && !p.dead) { // 구운 생선: 회복 + 잠깐 공격력 증가
      if (Date.now() < (p.potionAt || 0) || !removeItem(inv, m.item, 1)) return;
      p.potionAt = Date.now() + 1000;
      const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * it.heal);
      p.buffUntil = Date.now() + A.FOOD_BUFF.ms;
      broadcast(p.ch, { t: 'heal', id: p.id, amt: Math.round(p.hp - before) });
      send(p.ws, { t: 'foodbuff', ms: A.FOOD_BUFF.ms });
      sendStats(p); sendInv(p);
      return;
    }
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
    } else if (A.PETS[m.id]) {
      const pet = A.PETS[m.id];
      if (!pet.price) return notice(p, `${pet.name}은(는) 살 수 없어요. ${pet.gacha ? '뽑기 상자에서만 나와요' : '낚시로만 만날 수 있어요'}`);
      if (inv.pets.includes(m.id)) return notice(p, '이미 함께하고 있어요');
      if (inv.gold < pet.price) return notice(p, '골드가 모자라요');
      inv.gold -= pet.price; inv.pets.push(m.id); inv.pet = m.id;
      broadcast(p.ch, { t: 'pet', id: p.id, pet: m.id });
      notice(p, `${pet.icon} ${pet.name}이(가) 따라오기 시작했어요! 가방(I)에서 바꿀 수 있어요`);
    } else if (A.ACCS[m.id]) {
      const it = A.ITEMS[m.id];
      if (!it.buy) return notice(p, `${it.name}은(는) 상점에서 팔지 않아요. 뽑기 상자에서 나와요`);
      if (inv.gold < it.buy) return notice(p, '골드가 모자라요');
      if (!addItem(inv, m.id, 1)) return notice(p, '가방이 꽉 찼어요');
      inv.gold -= it.buy;
      const slot = it.slot;
      if (!inv.wear[slot]) { inv.wear[slot] = m.id; broadcast(p.ch, { t: 'cos', id: p.id, cos: inv.wear }); } // 그 부위가 비어 있으면 바로 달아 줌
      notice(p, `${it.icon} ${it.name}을(를) 샀어요! 가방(I)에서 달고 뗄 수 있어요`);
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
    if (!it.sell) return notice(p, `${it.icon} ${it.name}은(는) 팔 수 없어요`);
    const have = inv.items[m.id] || 0, n = Math.max(1, Math.min(have, Math.floor(num(m.n, 1))));
    if (!have || !removeItem(inv, m.id, n)) return;
    inv.gold = Math.min(999999, inv.gold + it.sell * n);
    notice(p, `${it.icon} ${it.name} ${n}개를 ${it.sell * n}G에 팔았어요`);
    sendInv(p);
  }
}

// ---------- 의뢰 · 바람의 돌 · 무기 강화 ----------
let windStones = 0; // 서버 전체가 함께 모은 바람의 돌 (서버가 잠들면 0으로 돌아감)
function windMsg(extra) { return Object.assign({ t: 'wind', n: windStones, need: A.BRIDGE.need, bridge: A.world.bridge }, extra); }
function broadcastAll(msg) { for (const ch of channels.keys()) broadcast(ch, msg); }
function sendQuests(p) { send(p.ws, { t: 'quests', active: p.q.active, done: p.q.done }); }
function questEvent(p, type, key) {
  for (const id in p.q.active) {
    const q = A.QUESTS[id];
    if (q.type !== type || q.key !== key || p.q.active[id] >= q.n) continue;
    p.q.active[id]++;
    sendQuests(p);
    if (p.q.active[id] >= q.n) notice(p, `📜 '${q.name}' 의뢰를 다 했어요! 촌장 루루에게 돌아가요`);
  }
}
function nearElder(p) { return Math.hypot(p.x - A.ELDER.x, p.z - A.ELDER.z) < A.TALK_RANGE; }
function handleQuest(p, m) {
  const inv = p.inv;
  if (m.t === 'donate') {
    if (Math.hypot(p.x, p.z) > A.ALTAR_RANGE) return notice(p, '광장 분수 가까이에서 바칠 수 있어요');
    const n = inv.items.windstone || 0;
    if (!n) return notice(p, '바람의 돌이 없어요. 촌장 루루의 의뢰를 해결하면 얻을 수 있어요');
    removeItem(inv, 'windstone', n);
    const was = A.world.bridge;
    windStones += n;
    if (windStones >= A.BRIDGE.need) A.world.bridge = true;
    inv.gold = Math.min(999999, inv.gold + 40 * n);
    giveXp(p.ch, p, 30 * n);
    sendInv(p);
    broadcastAll(windMsg({ by: p.name, add: n, opened: !was && A.world.bridge }));
    return;
  }
  if (m.t === 'upgrade') {
    if (!nearShop(p)) return notice(p, '상인 모모 가까이에서만 강화할 수 있어요');
    const w = A.WEAPONS[m.w]; if (!w || !inv.weapons.includes(m.w)) return;
    const lv = inv.up[m.w] || 0, cost = A.UPGRADES[lv];
    if (!cost) return notice(p, '이미 끝까지 강화했어요');
    if (inv.gold < cost.gold) return notice(p, '골드가 모자라요');
    for (const id in cost.mats) if ((inv.items[id] || 0) < cost.mats[id]) return notice(p, `${A.ITEMS[id].name}이(가) 모자라요`);
    inv.gold -= cost.gold;
    for (const id in cost.mats) removeItem(inv, id, cost.mats[id]);
    const fails = inv.upf[m.w] || 0;
    if (cost.chance && Math.random() >= A.upChance(lv, fails)) { // +6부터는 실패할 수 있음 (단계는 그대로, 다음 확률이 오름)
      inv.upf[m.w] = Math.min(20, fails + 1);
      sendInv(p);
      send(p.ws, { t: 'upres', ok: false, w: m.w, lv });
      return notice(p, `💨 ${w.name} +${lv + 1} 강화에 실패했어요… 골드와 재료만 사라졌어요. 다음 성공 확률 ${Math.round(A.upChance(lv, inv.upf[m.w]) * 100)}%`);
    }
    inv.up[m.w] = lv + 1; delete inv.upf[m.w];
    sendInv(p);
    send(p.ws, { t: 'upres', ok: true, w: m.w, lv: lv + 1 });
    if (lv + 1 >= 8) broadcast(p.ch, { t: 'notice', text: `🔨 ${p.name} 님이 ${w.name} +${lv + 1} 강화에 성공했어요!` });
    notice(p, `🔨 ${w.name} +${lv + 1} 강화 성공! 피해가 ${Math.round(A.UP_BONUS * (lv + 1) * 100)}% 늘었어요`);
    return;
  }
  const q = A.QUESTS[m.id]; if (!q) return;
  if (m.t === 'qdrop') { if (p.q.active[m.id] !== undefined) { delete p.q.active[m.id]; sendQuests(p); } return; }
  if (!nearElder(p)) return notice(p, '촌장 루루 가까이에서 이야기할 수 있어요');
  if (m.t === 'qtake') {
    if (p.q.active[m.id] !== undefined) return;
    if (Object.keys(p.q.active).length >= A.QUEST_ACTIVE_MAX) return notice(p, `의뢰는 한 번에 ${A.QUEST_ACTIVE_MAX}개까지 맡을 수 있어요`);
    p.q.active[m.id] = 0;
    if (q.type === 'visit') { const I = A.islandOf(p.x, p.z); if (I && String(I.id) === q.key) p.q.active[m.id] = 1; }
    sendQuests(p);
    notice(p, `📜 의뢰를 맡았어요: ${q.name}`);
  } else if (m.t === 'qdone') {
    if (p.q.active[m.id] === undefined) return;
    if (p.q.active[m.id] < q.n) return notice(p, q.type === 'collect' ? `의뢰를 맡은 뒤에 몬스터에게서 새로 얻은 것만 쳐 줘요 (${p.q.active[m.id]}/${q.n})` : '아직 다 하지 못했어요');
    if (q.type === 'collect' && (inv.items[q.key] || 0) < q.n) return notice(p, `${A.ITEMS[q.key].name}이(가) 가방에 모자라요`);
    if (q.stones && !inv.items.windstone && bagSlots(inv) >= A.BAG_SLOTS && !(q.type === 'collect' && inv.items[q.key] === q.n)) return notice(p, '가방이 꽉 차서 보상을 받을 수 없어요');
    if (q.type === 'collect') removeItem(inv, q.key, q.n);
    delete p.q.active[m.id];
    p.q.done[m.id] = (p.q.done[m.id] || 0) + 1;
    p.st.quests++; sendSt(p);
    inv.gold = Math.min(999999, inv.gold + q.gold);
    if (q.stones) addItem(inv, 'windstone', q.stones);
    giveXp(p.ch, p, q.xp);
    sendInv(p); sendQuests(p);
    notice(p, `🎉 '${q.name}' 완료! ${q.gold}G${q.stones ? ` · 🌀 바람의 돌 ${q.stones}개` : ''}`);
  }
}

// ---------- 몬스터 움직임 ----------
function pushOut(m) {
  for (const o of LAYOUT.obstacles) {
    const dx = m.x - o.x, dz = m.z - o.z, d = Math.hypot(dx, dz), min = o.r + m.def.size * 0.6;
    if (d < min && d > 0.0001) { m.x = o.x + dx / d * min; m.z = o.z + dz / d * min; }
  }
  const I = A.ISLANDS[m.isl], dx = m.x - I.x, dz = m.z - I.z, r = Math.hypot(dx, dz), lim = I.R - 3;
  if (r > lim) { m.x = I.x + dx * lim / r; m.z = I.z + dz * lim / r; }
  const safe = A.SAFE_R + m.def.size * 0.6; // 광장 안으로는 못 들어감
  if (m.isl === 0 && r < safe && r > 0.0001) { m.x = dx * safe / r; m.z = dz * safe / r; }
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
  if (pat === 1) { wind = 1900; m.circles = [{ x: m.x, z: m.z, r: def.ringR || 10 }]; }
  else if (pat === 2) {
    wind = 1500; m.circles = [];
    for (const p of channels.get(ch).players.values()) {
      if (p.dead || A.inSafe(p.x, p.z) || m.circles.length >= 6 || Math.hypot(p.x - m.x, p.z - m.z) > 30) continue;
      m.circles.push({ x: p.x, z: p.z, r: 3.2 });
    }
    if (!m.circles.length) return;
  } else m.circles = [{ x: m.x + Math.sin(m.ry) * def.hitAt, z: m.z + Math.cos(m.ry) * def.hitAt, r: def.hitR }];
  m.st = 2; m.windEnd = now + wind;
  for (const c of m.circles) broadcast(ch, { t: 'tele', id: m.id, x: r2(c.x), z: r2(c.z), r: c.r, ms: wind });
}
function bossRewards(ch, m) {
  const list = channels.get(ch).players;
  for (const pid of m.dmgBy.keys()) { const p = list.get(pid); if (p) { questEvent(p, 'kill', 'golem'); p.st.boss++; p.st.kills++; sendSt(p); } }
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
          if (p.dead || A.inSafe(p.x, p.z)) continue; // 광장 안은 안전
          if (m.circles.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.r + 0.45 && Math.abs(p.y - A.islandH(c.x, c.z)) < 3)) hurtPlayer(ch, p, def.atk * (isNight() ? A.NIGHT_ATK : 1));
        }
        m.st = 0; m.nextAtk = now + def.cd;
      }
      continue;
    }
    let tgt = m.target ? players.get(m.target) : null;
    if (tgt && (tgt.dead || A.inSafe(tgt.x, tgt.z) || Math.hypot(tgt.x - m.x, tgt.z - m.z) > def.aggro * 1.6)) { tgt = null; m.target = 0; }
    if (!def.boss && Math.hypot(m.x - m.hx, m.z - m.hz) > LEASH) { m.returning = true; m.target = 0; tgt = null; }
    if (m.returning) {
      m.st = 1;
      if (stepToward(m, m.hx, m.hz, def.speed * 1.6, dt) < 0.5) { m.returning = false; m.hp = m.maxHp; m.hitters.clear(); m.st = 0; }
      continue;
    }
    if (!tgt) { // 가장 가까운 사람을 찾음
      let best = null, bd = def.aggro;
      for (const p of players.values()) {
        if (p.dead || A.inSafe(p.x, p.z) || Math.abs(p.y - A.islandH(m.x, m.z)) > 4) continue;
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
        if (now >= m.nextAtk) startAttack(ch, m, def.boss ? (m.pat = (m.pat + 1) % 3) : def.elite ? (m.pat = (m.pat + 1) % 2) : 0);
      }
    } else { // 집 근처를 어슬렁어슬렁
      if (now >= m.nextWander) { m.wanderX = m.hx + (Math.random() - 0.5) * 8; m.wanderZ = m.hz + (Math.random() - 0.5) * 8; m.nextWander = now + 3000 + Math.random() * 4000; }
      m.st = stepToward(m, m.wanderX, m.wanderZ, def.speed * 0.4, dt) > 0.3 ? 1 : 0;
    }
    pushOut(m);
  }
}

// ---------- 꾸미기 (접속해 있는 동안 섬에 놓이는 내 물건) ----------
let nextDecoId = 1;
function cleanDeco(p, d, x, z, ry) {
  if (!d || !A.DECOS[d.k] || !A.decoAllowed(x, z)) return null;
  return { id: nextDecoId++, o: p.id, k: d.k, x: r2(x), z: r2(z), ry: r2(num(ry)), text: A.DECOS[d.k].text ? cleanText(d.text, A.DECO_TEXT) : '', color: p.color, name: p.name };
}
function myDecos(p) { return [...channels.get(p.ch).decos.values()].filter((d) => d.o === p.id); }
function handleDeco(p, m) {
  const c = channels.get(p.ch);
  if (m.t === 'decodel') {
    const d = c.decos.get(m.id);
    if (!d || d.o !== p.id) return;
    c.decos.delete(d.id); broadcast(p.ch, { t: 'decodel', id: d.id });
    return;
  }
  const def = A.DECOS[m.k]; if (!def || p.dead) return;
  if (myDecos(p).length >= A.DECO_MAX) return notice(p, `꾸미기 물건은 ${A.DECO_MAX}개까지 놓을 수 있어요`);
  if (p.inv.gold < def.price) return notice(p, '골드가 모자라요');
  const d = cleanDeco(p, m, p.x + Math.sin(p.ry) * 2, p.z + Math.cos(p.ry) * 2, p.ry + Math.PI);
  if (!d) return notice(p, '여기에는 놓을 수 없어요 (광장 안, 바람 기둥, 섬 밖은 안 돼요)');
  p.inv.gold -= def.price; sendInv(p);
  c.decos.set(d.id, d); broadcast(p.ch, { t: 'decoadd', d });
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
  if (m.t === 'pinvite' || m.t === 'treq' || m.t === 'dreq') {
    const q = findPlayer(me, m.id); if (!q) return;
    const kind = m.t === 'pinvite' ? 'party' : m.t === 'treq' ? 'trade' : 'duel';
    if (kind === 'party') {
      if (q.party) return notice(me, q.party === me.party ? '이미 같은 파티예요' : `${q.name} 님은 이미 다른 파티에 있어요`);
      if (me.party && parties.get(me.party).size >= A.PARTY_MAX) return notice(me, `파티는 ${A.PARTY_MAX}명까지예요`);
    } else if (kind === 'duel') {
      if (me.duel || q.duel) return notice(me, '지금은 결투할 수 없어요 (이미 결투 중)');
      if (me.dead || q.dead) return notice(me, '쓰러져 있을 때는 결투할 수 없어요');
      if (Math.hypot(q.x - me.x, q.z - me.z) > A.DUEL.range) return notice(me, '결투하려면 더 가까이 가야 해요');
    } else {
      if (me.trade || q.trade) return notice(me, '지금은 거래할 수 없어요 (이미 거래 중)');
      if (Math.hypot(q.x - me.x, q.z - me.z) > 10) return notice(me, '거래하려면 더 가까이 가야 해요');
    }
    q.asks.set(kind + me.id, now);
    send(q.ws, { t: 'ask', kind, from: me.id, name: me.name });
    return notice(me, `${q.name} 님에게 ${kind === 'party' ? '파티 초대를' : kind === 'duel' ? '결투 신청을' : '거래 요청을'} 보냈어요`);
  }
  if (m.t === 'answer') {
    const kind = m.kind === 'party' ? 'party' : m.kind === 'duel' ? 'duel' : 'trade', key = kind + m.from;
    const at = me.asks.get(key); me.asks.delete(key);
    const q = findPlayer(me, m.from);
    if (!at || now - at > ASK_MS || !q) return;
    if (!m.yes) return notice(q, `${me.name} 님이 ${kind === 'party' ? '초대' : kind === 'duel' ? '결투' : '거래'}를 거절했어요`);
    if (kind === 'duel') {
      if (me.duel || q.duel || me.dead || q.dead) return notice(me, '지금은 결투할 수 없어요');
      if (Math.hypot(q.x - me.x, q.z - me.z) > A.DUEL.range) return notice(me, '결투하려면 더 가까이 가야 해요');
      return startDuel(q, me);
    }
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
    // 가만히 서 있어도 1초마다 오는 위치 신호('m')는 '움직임'으로 치지 않음 → 켜 두기만 한 화면도 AFK_MS 뒤에 내보냄
    if (me) { if (m.t !== 'm') me.lastAct = Date.now(); me.hiddenAt = m.t === 'hide' ? Date.now() : 0; }

    if (m.t === 'join' && !me) {
      // 새로고침을 안 한 예전 화면은 새 몬스터·아이템을 몰라서 오류가 나므로, 다시 들어오게 안내함
      if (num(m.v) < A.VERSION) { send(ws, { t: 'kicked', text: '🆕 새 버전이 나왔어요! 아래 버튼을 누르면 새 버전으로 다시 들어가요. 캐릭터는 그대로예요.' }); return ws.close(); }
      // 같은 브라우저가 또 들어오면 먼저 있던 캐릭터를 내보냄 (창을 두 개 열었거나, 끊긴 접속이 남은 경우)
      const uid = cleanText(m.uid, 40);
      if (uid) for (const c of channels.values()) for (const q of c.players.values()) if (q.uid === uid) kick(q, '다른 창에서 다시 접속해서 이 창은 섬에서 나왔어요');
      const ch = pickChannel();
      // 레벨은 브라우저에 저장된 값을 이어받음 (무료 서버는 잠들면 기억이 지워져서)
      const lv = Math.max(1, Math.min(A.MAX_LV, Math.floor(num(m.lv, 1))));
      me = {
        id: nextId++, ws, ch,
        name: cleanText(m.name, 12) || '바람잡이',
        color: COLORS.includes(m.color) ? m.color : COLORS[(nextId * 3) % COLORS.length],
        hat: Math.max(0, Math.min(3, Math.floor(num(m.hat)))),
        x: (Math.random() - 0.5) * 6, y: 2, z: 6 + Math.random() * 3, ry: Math.PI, a: 0, // 광장 바닥 높이(공중에 떠 보이지 않게)
        lastChat: 0, lv, xp: Math.max(0, Math.min(A.needXp(lv) - 1, Math.floor(num(m.xp)))),
        hp: 0, maxHp: 0, atk: 0, dead: false, deadAt: 0, lastHurt: 0, lastAtk: 0, cds: {}, guard: 0, guardUntil: 0, potionAt: 0,
        inv: A.cleanInv(m.inv), // 가방도 브라우저에 저장된 것을 이어받음
        party: 0, trade: null, asks: new Map(), uid, lastAct: Date.now(),
        st: A.cleanStats(m.st), title: '', duel: null, fish: null, buffUntil: 0, // 기록도 브라우저에 저장된 것을 이어받음
        q: A.cleanQuests(m.q), // 의뢰 진행도 브라우저에 저장된 것을 이어받음
      };
      applyLevel(me); me.hp = me.maxHp;
      if (A.TITLES[m.title] && A.TITLES[m.title].ok(statsOf(me))) me.title = m.title;
      // 보장이 생기기 전에 낚은 횟수도 쳐 줌 (처음 한 번만)
      if (m.inv && m.inv.wp === undefined && !me.inv.pets.includes('whale')) me.inv.wp = Math.min(A.FISH.whalePity - 1, me.st.fish);
      const c = channels.get(ch);
      c.players.set(me.id, me);
      seenJoin(me);
      // 전에 놓아 둔 꾸미기 물건을 다시 놓음 (브라우저에 저장된 목록)
      if (Array.isArray(m.deco)) for (const raw of m.deco.slice(0, A.DECO_MAX)) {
        const d = raw && cleanDeco(me, raw, num(raw.x, 999), num(raw.z, 999), raw.ry);
        if (d) { c.decos.set(d.id, d); broadcast(ch, { t: 'decoadd', d }, me.id); }
      }
      send(ws, { t: 'welcome', id: me.id, ch, players: [...c.players.values()].filter((q) => q !== me).map(publicInfo), me: publicInfo(me), decos: [...c.decos.values()], phase: phaseNow(), dayMs: DAY_MS, chest: c.chest, v: A.VERSION });
      sendStats(me); sendInv(me); sendQuests(me); sendSt(me); send(ws, windMsg());
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
      if (d > 0.05 || Math.abs(ry - me.ry) > 0.02) me.lastAct = Date.now(); // 실제로 움직이거나 몸을 돌렸을 때만
      const nearSpawn = Math.hypot(x, z - 7) < SPAWN_R;
      if (d > MAX_STEP && !nearSpawn) { x = me.x + (dx / d) * MAX_STEP; z = me.z + (dz / d) * MAX_STEP; }
      me.x = Math.max(-200, Math.min(200, x));
      me.y = Math.max(-80, Math.min(80, y));
      me.z = Math.max(-200, Math.min(200, z));
      me.ry = ry;
      me.a = Math.max(0, Math.min(15, Math.floor(num(m.a))));
      if (Math.hypot(me.x, me.z) > A.R) { const I = A.islandOf(me.x, me.z); if (I && I.id) questEvent(me, 'visit', String(I.id)); }
    } else if (m.t === 'atk') {
      playerAttack(me.ch, me, Math.floor(num(m.k, -1)), num(m.ry, me.ry));
    } else if (m.t === 'use' || m.t === 'equip' || m.t === 'buy' || m.t === 'sell') {
      handleShop(me, m);
    } else if (m.t === 'chestopen') {
      openChest(me);
    } else if (m.t === 'gacha' || m.t === 'wear') {
      handleGacha(me, m);
    } else if (m.t === 'fish' || m.t === 'reel' || m.t === 'cook' || m.t === 'pet') {
      handleLeisure(me, m);
    } else if (m.t === 'title' || m.t === 'rank') {
      handleRecord(me, m);
    } else if (['pinvite', 'pleave', 'treq', 'dreq', 'answer', 'toffer', 'tok', 'tcancel'].includes(m.t)) {
      handleSocial(me, m);
    } else if (m.t === 'deco' || m.t === 'decodel') {
      handleDeco(me, m);
    } else if (['qtake', 'qdone', 'qdrop', 'donate', 'upgrade'].includes(m.t)) {
      handleQuest(me, m);
    } else if (m.t === 'respawn') {
      if (!me.dead || Date.now() - me.deadAt < RESPAWN_MS - 300) return;
      revive(me);
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
    seenLeave(me);
    const c = channels.get(me.ch);
    c.players.delete(me.id);
    if (me.duel) endDuel(me.duel, null, `${me.name} 님이 나가서 결투가 끝났어요`);
    if (me.trade) cancelTrade(me.trade, `${me.name} 님이 나가서 거래가 취소됐어요`);
    leaveParty(me, true);
    for (const d of myDecos(me)) { c.decos.delete(d.id); broadcast(me.ch, { t: 'decodel', id: d.id }); }
    for (const mo of c.monsters) { if (mo.target === me.id) mo.target = 0; mo.hitters.delete(me.id); mo.dmgBy.delete(me.id); }
    if (!me.kicked) broadcast(me.ch, { t: 'leave', id: me.id, name: me.name });
  });
});

// 몬스터를 움직이고 모두의 위치를 나눠 주기
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.2, (now - lastTick) / 1000); lastTick = now;
  for (const [ch, c] of channels) {
    if (c.players.size === 0) continue;
    updateMonsters(ch, dt);
    // 전송량 줄이기: 사람마다 ①가까운 몬스터만 ②지난번과 달라진 것만 보냄. FULL_EVERY 번에 한 번은 전부(f:1) 보내서 화면을 맞춤
    const pl = [], ml = [];
    for (const q of c.players.values()) pl.push([q.id, JSON.stringify([q.id, r2(q.x), r2(q.y), r2(q.z), r2(q.ry), q.a, Math.round(q.hp / q.maxHp * 100), q.lv])]);
    for (const m of c.monsters) if (m.alive) ml.push([m, JSON.stringify([m.id, A.MONSTER_KINDS.indexOf(m.kind), r1(m.x), r1(m.z), r1(m.ry), Math.max(1, Math.round(m.hp / m.maxHp * 100)), m.st, now < m.slowUntil ? 1 : 0])]);
    for (const q of c.players.values()) {
      if (q.ws.readyState !== 1) continue;
      const full = !q.sent || ++q.sentN >= FULL_EVERY;
      if (full) { q.sent = new Map(); q.sentN = 0; }
      const sent = q.sent, ps = [], ms = [];
      for (const [id, e] of pl) { if (id !== q.id && sent.get('p' + id) !== e) { sent.set('p' + id, e); ps.push(e); } }
      for (const [m, e] of ml) {
        if (!m.def.boss && Math.abs(m.x - q.x) + Math.abs(m.z - q.z) > VIEW_R) continue; // 먼 섬의 몬스터는 안 보냄 (보스는 체력 막대 때문에 늘 보냄)
        if (sent.get(m.id) !== e) { sent.set(m.id, e); ms.push(e); }
      }
      if (!full && !ps.length && !ms.length) continue;
      q.ws.send('{"t":"s","p":[' + ps.join(',') + '],"m":[' + ms.join(',') + ']' + (full ? ',"f":1' : '') + '}');
    }
  }
}, TICK_MS);

// 섬에서 내보내기 (오래 쉰 사람, 같은 브라우저의 예전 접속)
function kick(p, text) {
  send(p.ws, { t: 'kicked', text });
  channels.get(p.ch).players.delete(p.id); // 바로 안 보이게 하고, 나머지 정리는 연결이 닫힐 때
  broadcast(p.ch, { t: 'leave', id: p.id, name: p.name });
  p.kicked = true;
  p.ws.close();
}
setInterval(() => {
  const now = Date.now();
  for (const c of channels.values()) for (const p of [...c.players.values()]) {
    if (now - p.lastAct > AFK_MS) kick(p, '오랫동안 움직임이 없어서 섬에서 나왔어요');
    else if (p.hiddenAt && now - p.hiddenAt > HIDDEN_MS) kick(p, '게임 화면을 오래 가려 두어서 섬에서 나왔어요');
  }
}, 15000);

// 쓰러진 사람을 광장에서 다시 일으킴
function revive(p) {
  p.dead = false; p.hp = p.maxHp; p.a = 0;
  p.x = (Math.random() - 0.5) * 4; p.z = A.SPAWN.z + Math.random() * 2; p.y = A.islandH(p.x, p.z);
  send(p.ws, { t: 'revive', x: p.x, y: p.y, z: p.z });
  broadcast(p.ch, { t: 'revived', id: p.id }, p.id);
  sendStats(p);
}

// 보물 상자: 사람이 있는 채널에 가끔 나타나고, 오래 안 찾으면 사라짐
setInterval(() => {
  const now = Date.now();
  for (const [ch, c] of channels) {
    if (!c.players.size) continue;
    if (c.chest && now > c.chest.until) { c.chest = null; c.nextChest = now + A.CHEST.everyMs; broadcast(ch, { t: 'chest', chest: null }); broadcast(ch, { t: 'notice', text: '🧰 아무도 찾지 못한 보물 상자가 사라졌어요…' }); }
    else if (!c.chest && now > c.nextChest) spawnChest(ch);
  }
}, 2000);

// 싸우지 않을 때 체력이 조금씩 차오름 (+ 너무 멀어진 거래는 취소)
setInterval(() => {
  const now = Date.now();
  for (const c of channels.values()) for (const p of c.players.values()) {
    if (p.trade && Math.hypot(p.trade.a.x - p.trade.b.x, p.trade.a.z - p.trade.b.z) > 14) cancelTrade(p.trade, '서로 너무 멀어져서 거래가 취소됐어요');
    // 화면을 안 보고 있어서(다른 창, 꺼진 화면) 부활 요청을 못 보낸 사람은 서버가 대신 일으킴
    if (p.dead && now - p.deadAt > RESPAWN_MS + 4000) revive(p);
    if (p.duel && p.duel.a === p) { // 결투가 너무 길어지거나 서로 멀어지면 끝냄
      const d = p.duel;
      if (now > d.end) endDuel(d, null, '⚔️ 시간이 다 돼서 결투가 비겼어요');
      else if (Math.hypot(d.a.x - d.b.x, d.a.z - d.b.z) > A.DUEL.leave) endDuel(d, null, '⚔️ 서로 너무 멀어져서 결투가 끝났어요');
    }
    if (p.dead || p.hp >= p.maxHp || now - p.lastHurt < 6000) continue;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.04);
    sendStats(p);
  }
}, 1000);

// 낮과 밤: 시간을 가끔 알려 주고, 밤이 되거나 아침이 되면 알림
let wasNight = isNight(), timeTick = 0;
setInterval(() => {
  const night = isNight(), changed = night !== wasNight; wasNight = night;
  if (!changed && ++timeTick % 20) return;
  for (const [ch, c] of channels) {
    if (!c.players.size) continue;
    broadcast(ch, { t: 'time', phase: phaseNow() });
    if (changed) broadcast(ch, { t: 'notice', text: night ? '🌙 밤이 됐어요. 몬스터가 세지지만 경험치와 골드를 1.5배로 줘요!' : '🌅 아침이 밝았어요. 몬스터가 다시 순해졌어요' });
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
