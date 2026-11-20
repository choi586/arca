// 구름섬 아르카 — 1단계: 함께 걷기 (정적 파일 서버 + WebSocket 멀티플레이)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_PER_CHANNEL = 40;     // 섬 하나(채널)에 들어갈 수 있는 사람 수
const TICK_MS = 66;             // 1초에 약 15번 위치를 나눠 줌
const MAX_STEP = 4;             // 한 번 보낼 때 움직일 수 있는 최대 거리(순간이동 방지)
const SPAWN_R = 8;              // 광장 근처로는 언제든 돌아올 수 있음(떨어졌을 때 부활)
const CHAT_GAP_MS = 600;
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#f8f9fa'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

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
const channels = new Map(); // number -> Map(id -> player)
function pickChannel() {
  for (let n = 1; ; n++) {
    if (!channels.has(n)) channels.set(n, new Map());
    if (channels.get(n).size < MAX_PER_CHANNEL) return n;
  }
}

let nextId = 1;
const wss = new WebSocketServer({ server, maxPayload: 2048 });

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(ch, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const p of channels.get(ch).values()) if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}
function publicInfo(p) { return { id: p.id, name: p.name, color: p.color, hat: p.hat, x: p.x, y: p.y, z: p.z, ry: p.ry }; }
function cleanText(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

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
      me = {
        id: nextId++, ws, ch,
        name: cleanText(m.name, 12) || '바람잡이',
        color: COLORS.includes(m.color) ? m.color : COLORS[(nextId * 3) % COLORS.length],
        hat: Math.max(0, Math.min(3, Math.floor(num(m.hat)))),
        x: (Math.random() - 0.5) * 6, y: 3, z: 6 + Math.random() * 3, ry: Math.PI, a: 0,
        lastChat: 0,
      };
      const list = channels.get(ch);
      send(ws, { t: 'welcome', id: me.id, ch, players: [...list.values()].map(publicInfo), me: publicInfo(me) });
      list.set(me.id, me);
      broadcast(ch, { t: 'join', p: publicInfo(me) }, me.id);
      return;
    }
    if (!me) return;

    if (m.t === 'm' && Array.isArray(m.p) && m.p.length === 4) {
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
    channels.get(me.ch).delete(me.id);
    broadcast(me.ch, { t: 'leave', id: me.id, name: me.name });
  });
});

// 모두의 위치를 주기적으로 나눠 주기
const r2 = (v) => Math.round(v * 100) / 100;
setInterval(() => {
  for (const [ch, list] of channels) {
    if (list.size === 0) continue;
    const snap = [];
    for (const p of list.values()) snap.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), p.a]);
    broadcast(ch, { t: 's', p: snap });
  }
}, TICK_MS);

// 끊긴 연결 정리
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

server.listen(PORT, () => console.log(`구름섬 아르카 서버: http://localhost:${PORT}`));
