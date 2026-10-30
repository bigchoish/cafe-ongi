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
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end("not found"); }
    const type = MIME[path.extname(file)] || "application/octet-stream";
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) { // 아이폰 Safari는 소리 파일을 구간 요청(Range)으로 받아야 재생합니다
      const start = range[1] ? parseInt(range[1], 10) : st.size - parseInt(range[2], 10);
      const end = range[1] && range[2] ? parseInt(range[2], 10) : st.size - 1;
      if (isNaN(start) || start < 0 || start >= st.size || end >= st.size || start > end) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": "public, max-age=3600" });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": type.startsWith("audio") ? "public, max-age=3600" : "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8 * 1024 });
const rooms = new Map();
// 방명록: 카페(방)별로 data/guestbook.json 에 저장합니다. (Render 무료 요금제는 재배포하면 파일이 초기화됩니다)
const GB_FILE = process.env.GUESTBOOK_FILE || path.join(__dirname, "data", "guestbook.json");
const GB_MAX = 300;
let guestbooks = {};
try { guestbooks = JSON.parse(fs.readFileSync(GB_FILE, "utf8")) || {}; } catch (e) { guestbooks = {}; }
let gbSaveTimer = null;
const saveGuestbooks = () => { clearTimeout(gbSaveTimer); gbSaveTimer = setTimeout(() => {
  try { fs.mkdirSync(path.dirname(GB_FILE), { recursive: true }); fs.writeFileSync(GB_FILE, JSON.stringify(guestbooks)); } catch (e) { console.error("방명록 저장 실패", e.message); } }, 500); };
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
  ws.alive = true; ws.presence = {}; ws.bucket = { p: 40, c: 3, last: Date.now() }; ws.lastGb = 0;
  room.clients.set(id, ws);
  send(ws, { t: "welcome", id, peers: [...room.clients].filter(([k]) => k !== id).map(([k, c]) => ({ id: k, presence: c.presence })), history: room.history, neon: room.neon, host: ws.isHost, gb: guestbooks[name] || [] });
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
      if (m.topic === "gb_add") {
        if (now - ws.lastGb < 20000) return; ws.lastGb = now;
        const text = clean(m.data && m.data.text).slice(0, 100); if (!text) return;
        const entry = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), nick: clean(m.data && m.data.nick).slice(0, 14) || "손님", text, ts: now };
        const list = guestbooks[name] || (guestbooks[name] = []); list.push(entry); if (list.length > GB_MAX) list.shift(); saveGuestbooks();
        broadcast(room, { t: "msg", id, topic: "gb", data: { op: "add", entry } });
      } else if (m.topic === "gb_del") {
        if (!ws.isHost) return; const del = String(m.data && m.data.id || "");
        guestbooks[name] = (guestbooks[name] || []).filter((e) => e.id !== del); saveGuestbooks();
        broadcast(room, { t: "msg", id, topic: "gb", data: { op: "del", id: del } });
      } else if (m.topic === "neon") {
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
