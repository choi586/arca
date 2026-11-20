// 구름섬 아르카 — 2단계: 함께 걷기 + 몬스터와 싸우기 (정적 파일 서버 + WebSocket 멀티플레이)
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
  const monsters = HOMES.map((h) => {
    const def = A.MONSTERS[h.kind];
    return { id: nextMonsterId++, kind: h.kind, def, hx: h.x, hz: h.z, x: h.x, z: h.z, ry: Math.random() * 6, hp: def.hp, alive: true,
      st: 0, target: 0, wanderX: h.x, wanderZ: h.z, nextWander: 0, nextAtk: 0, windEnd: 0, cx: 0, cz: 0, deadUntil: 0, hitters: new Set(), returning: false };
  });
  return { players: new Map(), monsters };
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
function publicInfo(p) { return { id: p.id, name: p.name, color: p.color, hat: p.hat, x: p.x, y: p.y, z: p.z, ry: p.ry, lv: p.lv }; }
function cleanText(s, max) { return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max); }
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
function sendStats(p) { send(p.ws, { t: 'stats', hp: Math.ceil(p.hp), maxHp: p.maxHp, lv: p.lv, xp: p.xp, need: A.needXp(p.lv), atk: p.atk }); }
function applyLevel(p) { const s = A.statsFor(p.lv); p.maxHp = s.maxHp; p.atk = s.atk; }

// ---------- 전투 ----------
function hurtMonster(ch, m, p, mult) {
  if (!m.alive) return;
  const crit = Math.random() < 0.12;
  const dmg = Math.max(1, Math.round(p.atk * mult * (0.9 + Math.random() * 0.2) * (crit ? 1.6 : 1)));
  m.hp -= dmg;
  m.hitters.add(p.id);
  if (!m.target || m.returning) { m.target = p.id; m.returning = false; }
  broadcast(ch, { t: 'hit', m: m.id, dmg, crit, by: p.id });
  if (m.hp <= 0) killMonster(ch, m);
}
function killMonster(ch, m) {
  m.alive = false; m.hp = 0; m.st = 0; m.deadUntil = Date.now() + m.def.respawn;
  broadcast(ch, { t: 'mdie', id: m.id });
  // 때린 사람 모두가 경험치를 다 받음 → 모르는 사람과도 같이 싸우면 이득
  const list = channels.get(ch).players;
  for (const pid of m.hitters) { const p = list.get(pid); if (p) giveXp(ch, p, m.def.xp); }
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
  const dmg = Math.max(1, Math.round(dmgRaw * (0.9 + Math.random() * 0.2)));
  p.hp -= dmg; p.lastHurt = Date.now();
  broadcast(ch, { t: 'hit', p: p.id, dmg });
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.deadAt = Date.now(); p.a = 9;
    broadcast(ch, { t: 'pdie', id: p.id });
  }
  sendStats(p);
}
function playerAttack(ch, p, k, ry) {
  const sk = A.SKILLS[k];
  const now = Date.now();
  if (!sk || p.dead || p.lv < sk.unlock || now < (p.cds[k] || 0)) return;
  p.cds[k] = now + sk.cd - 80;
  p.ry = ry;
  p.lastAtk = now;
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const { monsters, players } = channels.get(ch);
  broadcast(ch, { t: 'fx', id: p.id, k }, p.id);
  if (k === 3) { // 치유의 바람: 나와 가까운 사람들 회복
    const amt = Math.round(p.maxHp * sk.heal);
    for (const q of players.values()) {
      if (q.dead || Math.hypot(q.x - p.x, q.z - p.z) > sk.range) continue;
      const before = q.hp; q.hp = Math.min(q.maxHp, q.hp + amt);
      broadcast(ch, { t: 'heal', id: q.id, amt: Math.round(q.hp - before) });
      sendStats(q);
    }
    return;
  }
  for (const m of monsters) {
    if (!m.alive) continue;
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz), mr = m.def.size * 0.7;
    if (Math.abs(A.islandH(m.x, m.z) - p.y) > 4) continue;
    let hit = false;
    if (k === 0) hit = d < sk.range + mr && (d < 0.8 || Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) < sk.arc);
    else if (k === 1) hit = d < sk.range + mr;
    else if (k === 2) { const along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx); hit = along > -0.5 && along < sk.range + mr && side < sk.width + mr; }
    if (hit) hurtMonster(ch, m, p, sk.mult);
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
function updateMonsters(ch, dt) {
  const { monsters, players } = channels.get(ch);
  const now = Date.now();
  for (const m of monsters) {
    const def = m.def;
    if (!m.alive) {
      if (now >= m.deadUntil) { Object.assign(m, { alive: true, hp: def.hp, x: m.hx, z: m.hz, st: 0, target: 0, returning: false }); }
      continue;
    }
    // 공격 준비가 끝나면 빨간 원 안에 있는 사람이 다침
    if (m.st === 2) {
      if (now >= m.windEnd) {
        for (const p of players.values()) {
          if (!p.dead && Math.hypot(p.x - m.cx, p.z - m.cz) < def.hitR + 0.45 && Math.abs(p.y - A.islandH(m.cx, m.cz)) < 2.5) hurtPlayer(ch, p, def.atk);
        }
        m.st = 0; m.nextAtk = now + def.cd;
      }
      continue;
    }
    let tgt = m.target ? players.get(m.target) : null;
    if (tgt && (tgt.dead || Math.hypot(tgt.x - m.x, tgt.z - m.z) > def.aggro * 1.6)) { tgt = null; m.target = 0; }
    if (Math.hypot(m.x - m.hx, m.z - m.hz) > LEASH) { m.returning = true; m.target = 0; tgt = null; }
    if (m.returning) {
      m.st = 1;
      if (stepToward(m, m.hx, m.hz, def.speed * 1.6, dt) < 0.5) { m.returning = false; m.hp = def.hp; m.hitters.clear(); m.st = 0; }
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
      if (d > def.reach) { m.st = 1; stepToward(m, tgt.x, tgt.z, def.speed, dt); }
      else {
        m.st = 0; m.ry = Math.atan2(tgt.x - m.x, tgt.z - m.z);
        if (now >= m.nextAtk) {
          m.st = 2; m.windEnd = now + def.windup;
          m.cx = m.x + Math.sin(m.ry) * def.hitAt; m.cz = m.z + Math.cos(m.ry) * def.hitAt;
          broadcast(ch, { t: 'tele', id: m.id, x: r2(m.cx), z: r2(m.cz), r: def.hitR, ms: def.windup });
        }
      }
    } else { // 집 근처를 어슬렁어슬렁
      if (now >= m.nextWander) { m.wanderX = m.hx + (Math.random() - 0.5) * 8; m.wanderZ = m.hz + (Math.random() - 0.5) * 8; m.nextWander = now + 3000 + Math.random() * 4000; }
      m.st = stepToward(m, m.wanderX, m.wanderZ, def.speed * 0.4, dt) > 0.3 ? 1 : 0;
    }
    pushOut(m);
  }
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
        hp: 0, maxHp: 0, atk: 0, dead: false, deadAt: 0, lastHurt: 0, lastAtk: 0, cds: [],
      };
      applyLevel(me); me.hp = me.maxHp;
      const c = channels.get(ch);
      send(ws, { t: 'welcome', id: me.id, ch, players: [...c.players.values()].map(publicInfo), me: publicInfo(me) });
      c.players.set(me.id, me);
      sendStats(me);
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
      me.a = Math.max(0, Math.min(9, Math.floor(num(m.a))));
    } else if (m.t === 'atk') {
      playerAttack(me.ch, me, Math.floor(num(m.k, -1)), num(m.ry, me.ry));
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
    for (const mo of c.monsters) { if (mo.target === me.id) mo.target = 0; mo.hitters.delete(me.id); }
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
    for (const m of c.monsters) if (m.alive) mo.push([m.id, A.MONSTER_KINDS.indexOf(m.kind), r2(m.x), r2(m.z), r2(m.ry), Math.round(m.hp / m.def.hp * 100), m.st]);
    broadcast(ch, { t: 's', p, m: mo });
  }
}, TICK_MS);

// 싸우지 않을 때 체력이 조금씩 차오름
setInterval(() => {
  const now = Date.now();
  for (const c of channels.values()) for (const p of c.players.values()) {
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
