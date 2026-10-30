// 카페 온기 실시간 서버: 정적 페이지 제공 + 웹소켓으로 접속자 위치·행동·채팅 중계
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const MAX_PER_ROOM = 60;      // 한 카페(방)에 동시에 들어올 수 있는 최대 인원
const HISTORY = 40;           // 새로 들어온 사람에게 보여 줄 최근 채팅 수
const HOST_KEY = process.env.HOST_KEY || "";
// 화면을 다른 도메인(Vercel 등)에 올렸다면, 그 주소만 접속을 허용하도록 쉼표로 적습니다. 예: https://cafe.mydomain.com,https://cafe-ongi.vercel.app
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean); // 이 값을 아는 사람(주소 뒤 ?host=값)만 네온 사인을 바꿀 수 있음
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".webm": "audio/webm" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/healthz") { res.writeHead(200); return res.end("ok"); }
  const rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8 * 1024 });
const rooms = new Map();
let seq = 0;
const clean = (s) => String(s || "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").trim();
const getRoom = (name) => { if (!rooms.has(name)) rooms.set(name, { clients: new Map(), history: [], neon: null }); return rooms.get(name); };
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = (room, o, exceptId) => { const s = JSON.stringify(o); for (const [id, ws] of room.clients) if (id !== exceptId && ws.readyState === 1) ws.send(s); };

wss.on("connection", (ws, req) => {
  if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(req.headers.origin || "")) { return ws.close(1008, "origin not allowed"); }
  const url = new URL(req.url, "http://localhost");
  const name = (url.searchParams.get("room") || "lobby").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "lobby";
  const room = getRoom(name);
  if (room.clients.size >= MAX_PER_ROOM) { send(ws, { t: "full" }); return ws.close(1013, "full"); }

  const id = (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
  ws.isHost = !!HOST_KEY && url.searchParams.get("host") === HOST_KEY;
  ws.alive = true; ws.presence = {}; ws.bucket = { p: 40, c: 3, last: Date.now() };
  room.clients.set(id, ws);
  send(ws, { t: "welcome", id, peers: [...room.clients].filter(([k]) => k !== id).map(([k, c]) => ({ id: k, presence: c.presence })), history: room.history, neon: room.neon, host: ws.isHost });
  broadcast(room, { t: "join", id, presence: {} }, id);

  ws.on("pong", () => { ws.alive = true; });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    // 간단한 속도 제한: 상태 갱신 초당 20회, 채팅 1.4초에 1회 정도
    const now = Date.now(), b = ws.bucket, dt = (now - b.last) / 1000; b.last = now;
    b.p = Math.min(40, b.p + dt * 20); b.c = Math.min(3, b.c + dt * 0.7);
    if (m.t === "presence" && m.presence && typeof m.presence === "object") {
      if (b.p < 1) return; b.p--;
      if (JSON.stringify(m.presence).length > 4096) return;
      ws.presence = m.presence;
      broadcast(room, { t: "presence", id, presence: m.presence }, id);
    } else if (m.t === "msg" && typeof m.topic === "string") {
      if (m.topic === "neon") {
        if (!ws.isHost) return;
        const d = m.data || {}; const colors = ["warm", "pink", "mint", "blue"];
        room.neon = { text: clean(d.text).slice(0, 60), nick: clean(d.nick).slice(0, 14), color: colors.includes(d.color) ? d.color : "warm", ts: now };
        broadcast(room, { t: "msg", id, topic: "neon", data: room.neon });
      } else if (m.topic === "chat") {
        if (b.c < 1) return; b.c--;
        const text = clean(m.data && m.data.text).slice(0, 120); if (!text) return;
        const nick = clean(m.data && m.data.nick).slice(0, 14) || "손님";
        const item = { id, topic: "chat", data: { text, nick }, ts: now };
        room.history.push(item); if (room.history.length > HISTORY) room.history.shift();
        broadcast(room, { t: "msg", ...item });
      } else {
        if (b.p < 1) return; b.p--;
        if (JSON.stringify(m.data || null).length > 4096) return;
        broadcast(room, { t: "msg", id, topic: m.topic.slice(0, 48), data: m.data });
      }
    }
  });
  ws.on("close", () => { room.clients.delete(id); broadcast(room, { t: "leave", id }); });
});

// 끊긴 연결 정리
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 30000);

server.listen(PORT, () => console.log(`카페 온기 서버 실행 중: http://localhost:${PORT}`));
