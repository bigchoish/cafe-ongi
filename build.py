# Builds public/index.html (standalone site) from the artifact page ../cafe-ongi.html
# Adds a full HTML document shell and a small shim that gives the page the same "room" API over this site's WebSocket server.
import pathlib, re
here = pathlib.Path(__file__).parent
src = (here.parent / "cafe-ongi.html").read_text()
shim = r"""<script>
(function(){
  if (window.claude && window.claude.use) return;
  function makeRoom(){
    var qs = new URLSearchParams(location.search), q = qs.get("room"), hk = qs.get("host");
    var wsBase = (window.CAFE_WS && String(window.CAFE_WS).trim()) || ((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    var url = wsBase + "?room=" + encodeURIComponent(q || "lobby") + (hk ? "&host=" + encodeURIComponent(hk) : "");
    var isHost = false, hostReady, hostKnown = new Promise(function(r){ hostReady = r; });
    var ws = null, myId = null, connected = false, myPres = {}, peers = new Map(), snapshot = Object.freeze([]), backoff = 500;
    var L = { peers: new Set(), conn: new Set(), topics: new Map() };
    function mk(id, pres){ return Object.freeze({ peer:id, by:null, isMe:id===myId, sameTab:id===myId, kind:"viewer", guest:false, presence:Object.freeze(Object.assign({}, pres||{})), updatedAt:Date.now() }); }
    function fire(ch){ snapshot = Object.freeze(Array.from(peers.values())); var c = { peers:snapshot, joined:ch.joined||[], left:ch.left||[], updated:ch.updated||[] }; L.peers.forEach(function(f){ try{ f(c); }catch(e){} }); }
    function setConn(v){ if (connected === v) return; connected = v; L.conn.forEach(function(f){ try{ f(v); }catch(e){} }); }
    function deliver(m, hist){ var fs = L.topics.get(m.topic); if (!fs) return; var msg = { topic:m.topic, data:m.data, peer:m.id, by:null, isMe:m.id===myId, sameTab:m.id===myId, kind:"viewer", guest:false, history:!!hist }; fs.forEach(function(f){ try{ f(msg); }catch(e){} }); }
    function connect(){
      try { ws = new WebSocket(url); } catch(e){ setTimeout(connect, backoff = Math.min(8000, backoff*2)); return; }
      ws.onopen = function(){ backoff = 500; };
      ws.onmessage = function(ev){ var m; try { m = JSON.parse(ev.data); } catch(e){ return; }
        if (m.t === "welcome"){ myId = m.id; var old = Array.from(peers.values()); peers.clear(); peers.set(myId, mk(myId, myPres)); m.peers.forEach(function(p){ peers.set(p.id, mk(p.id, p.presence)); });
          fire({ joined:Array.from(peers.values()), left:old }); setConn(true); ws.send(JSON.stringify({ t:"presence", presence:myPres })); (m.history||[]).forEach(function(h){ deliver(h, true); }); isHost = !!m.host; hostReady(isHost); if (m.neon) deliver({ topic:"neon", id:"server", data:m.neon }, true); }
        else if (m.t === "join"){ var p = mk(m.id, m.presence); peers.set(m.id, p); fire({ joined:[p] }); }
        else if (m.t === "presence"){ var u = mk(m.id, m.presence); peers.set(m.id, u); fire({ updated:[u] }); }
        else if (m.t === "leave"){ var l = peers.get(m.id); if (l){ peers.delete(m.id); fire({ left:[l] }); } }
        else if (m.t === "msg") deliver(m, false); };
      ws.onclose = function(){ setConn(false); setTimeout(connect, backoff = Math.min(8000, backoff*2)); };
      ws.onerror = function(){};
    }
    connect();
    return {
      presence: function(patch){ for (var k in patch){ if (patch[k] === null) delete myPres[k]; else myPres[k] = patch[k]; }
        if (myId){ var p = mk(myId, myPres); peers.set(myId, p); fire({ updated:[p] }); }
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t:"presence", presence:myPres })); return Promise.resolve(); },
      emit: function(topic, data){ if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t:"msg", topic:topic, data:data })); return Promise.resolve(); },
      on: function(topic, fn){ if (!L.topics.has(topic)) L.topics.set(topic, new Set()); L.topics.get(topic).add(fn); return function(){ L.topics.get(topic).delete(fn); }; },
      peers: function(){ return snapshot; },
      onPeers: function(fn){ L.peers.add(fn); setTimeout(function(){ fn({ peers:snapshot, joined:snapshot, left:[], updated:[] }); }, 0); return function(){ L.peers.delete(fn); }; },
      connected: function(){ return connected; },
      _host: function(){ return hostKnown; },
      onConnection: function(fn){ L.conn.add(fn); setTimeout(function(){ fn(connected); }, 0); return function(){ L.conn.delete(fn); }; }
    };
  }
  var room = null;
  window.claude = { use: function(n){
    if (n === "room") return Promise.resolve(room || (room = makeRoom()));
    if (n === "user") return Promise.resolve({ canEdit: function(){ return (room || (room = makeRoom()))._host(); }, isOwner: function(){ return (room || (room = makeRoom()))._host(); } });
    return Promise.resolve(null); } };
})();
</script>
"""
split = src.index('<div class="wrap">')
head, body = src[:split], src[split:]
reset = "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n"
meta = '<meta name="description" content="함께 앉아 조용히 작업하는 3D 가상 카페. 음악과 빗소리, 바리스타 소리, 채팅.">\n<meta property="og:title" content="카페 온기">\n<meta property="og:description" content="함께 앉아 조용히 작업하는 3D 가상 카페">\n'
body = body.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', '<script src="config.js"></script>\n' + shim + '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', 1)
body = body.replace("다른 손님의 모습은 같은 링크를 연 사람에게만 보이고", "같은 주소로 들어온 사람들은 서로의 모습과 채팅이 보이고")
out = '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + meta + head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '') + reset + '</head>\n<body>\n' + body + '\n</body>\n</html>\n'
(here / "public" / "index.html").write_text(out)
cfg = here / "public" / "config.js"
if not cfg.exists():
    cfg.write_text('// 화면(Vercel)과 실시간 서버(Render 등)를 따로 둘 때, 실시간 서버 주소를 적습니다.\n// 예: window.CAFE_WS = "wss://cafe-ongi.onrender.com/ws";\n// 비워 두면 화면을 연 주소와 같은 서버에 연결합니다(Render 하나로 운영할 때).\nwindow.CAFE_WS = "";\n')
print("built", len(out))
