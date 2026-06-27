'use strict';

/*
 * imageLink — educational canary-token / tracking-pixel server.
 *
 * Purpose: demonstrate, in a classroom or authorized lab, how much information
 * any link or image quietly reveals about whoever opens it (IP, approximate
 * location, device, browser, language, timestamp). This is the same mechanism
 * behind email "read receipts", web bugs, and tools like Thinkst Canarytokens.
 *
 * USE RESPONSIBLY. Only send these links to people who have consented, or in a
 * lab you control. See README.md and the ETHICS notice on the landing page.
 */

const path = require('path');
const express = require('express');
const db = require('./src/db');
const { detectBot, parseUA, clientIp, geolocate } = require('./src/inspect');

const app = express();
app.set('trust proxy', true); // Railway terminates TLS at a proxy
app.use(express.json({ limit: '64kb' }));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || ''; // set in Railway to lock the dashboard
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function baseUrl(req) {
  return process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next(); // no key configured = open (fine for local/lab)
  const key = req.query.key || req.get('x-admin-key');
  if (key === ADMIN_KEY) return next();
  return res.status(401).json({ error: 'unauthorized — provide ?key=ADMIN_KEY' });
}

// ── Core: record a visit ────────────────────────────────────────────────────
async function recordHit(req, token, kind) {
  const ua = req.get('user-agent') || '';
  const ip = clientIp(req);
  const bot = detectBot(ua);
  const { os, browser, device } = parseUA(ua);

  const hitId = db.insertHit({
    token_id: token.id,
    kind,
    ip,
    user_agent: ua,
    referer: req.get('referer') || null,
    language: req.get('accept-language') || null,
    is_bot: !!bot,
    browser: bot || browser,
    os,
    device,
  });

  // Geolocation is async/best-effort; enrich the row once it resolves.
  geolocate(ip)
    .then((geo) => geo && db.setHitGeo(hitId, geo))
    .catch(() => {});

  return hitId;
}

// ── Public landing page + create form ───────────────────────────────────────
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>imageLink — tracking-link demo (educational)</title>
<style>${CSS}</style></head><body>
<main class="wrap">
  <h1>🔗 imageLink</h1>
  <p class="sub">An <strong>educational</strong> tracking-link &amp; tracking-pixel demo. It shows how much
  any link or image reveals about whoever opens it.</p>

  <div class="ethics">
    <strong>⚠️ Ethics &amp; legality.</strong> Only share generated links with people who have consented,
    or inside a lab you control. Logging people without consent can be illegal (privacy / wiretap / computer-misuse
    laws) and violates the policies of Telegram, WhatsApp, etc. This tool exists to <em>teach</em> how web
    tracking works so people can defend against it — not to surveil anyone.
  </div>

  <section class="card">
    <h2>How it works</h2>
    <p class="sub">You create a tracking link from the dashboard, share it, and the dashboard shows
    every visit it captured (IP, approximate location, device, browser). The same mechanism powers
    email "read receipts" and web bugs.</p>
    <p class="foot"><a href="/dashboard">→ Open the dashboard</a> to create links and view captured visits.</p>
  </section>
</main>
</body></html>`);
});

// ── API: create / list / delete tokens, list hits ───────────────────────────
app.post('/api/tokens', requireAdmin, (req, res) => {
  const { label, targetUrl } = req.body || {};
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: 'targetUrl must be a valid http(s) URL' });
  }
  const token = db.createToken({ label, targetUrl });
  res.json(token);
});

app.get('/api/tokens', requireAdmin, (req, res) => res.json(db.listTokens()));
app.get('/api/tokens/:id/hits', requireAdmin, (req, res) => {
  if (!db.getToken(req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json(db.listHits(req.params.id));
});
app.delete('/api/tokens/:id', requireAdmin, (req, res) => {
  db.deleteToken(req.params.id);
  res.json({ ok: true });
});

// Optional client-side enrichment beacon (timezone, screen, etc.).
// Posted by the landing page after it loads — only data the browser hands over.
app.post('/api/hits/:hitId/client', (req, res) => {
  try {
    db.setHitClient(Number(req.params.hitId), req.body || {});
  } catch {}
  res.json({ ok: true });
});

// ── Tracking pixel: logs, returns a 1x1 transparent PNG ─────────────────────
app.get('/p/:id.png', async (req, res) => {
  const token = db.getToken(req.params.id);
  if (token) await recordHit(req, token, 'pixel');
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store, max-age=0' });
  res.send(PIXEL);
});

// ── Tracking link: logs, shows the real image with social preview cards ──────
app.get('/i/:id', async (req, res) => {
  const token = db.getToken(req.params.id);
  if (!token) return res.status(404).type('html').send('<h1>404 — link not found</h1>');

  const hitId = await recordHit(req, token, 'landing');
  const url = baseUrl(req);
  const img = esc(token.target_url);

  res.type('html').send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(token.label || 'Image')}</title>
<meta property="og:title" content="${esc(token.label || 'Image')}">
<meta property="og:image" content="${img}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${img}">
<style>${CSS}
  .photo{max-width:100%;border-radius:12px;display:block;margin:0 auto}
  .disclose{margin-top:18px;font-size:13px;color:#9aa4b2;text-align:center}
</style></head><body>
<main class="wrap" style="max-width:760px">
  <img class="photo" src="${img}" alt="">
  <p class="disclose">ℹ️ This is an educational tracking-link demo. Opening it logged standard request
  metadata (IP, approximate location, device) — the same thing every link you click can do.</p>
</main>
<script>
(function(){
  try{
    var c={
      tz:Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen:screen.width+'x'+screen.height,
      viewport:innerWidth+'x'+innerHeight,
      dpr:devicePixelRatio,
      platform:navigator.platform,
      cores:navigator.hardwareConcurrency,
      memory:navigator.deviceMemory,
      languages:(navigator.languages||[]).join(','),
      touch:('ontouchstart' in window)
    };
    fetch('/api/hits/${hitId}/client',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(c)});
  }catch(e){}
})();
</script>
</body></html>`);
});

// ── Dashboard ───────────────────────────────────────────────────────────────
app.get('/dashboard', requireAdmin, (req, res) => {
  const key = req.query.key || '';
  res.type('html').send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>imageLink — dashboard</title><style>${CSS}${DASH_CSS}</style></head><body>
<main class="wrap" style="max-width:1100px">
  <h1>📊 Dashboard</h1>
  <p class="sub">Educational use only. <a href="/">← home</a></p>

  <section class="card">
    <h2>Create a tracking link</h2>
    <label>Label (for your reference)
      <input id="label" placeholder="e.g. phishing-awareness demo" />
    </label>
    <label>Destination image URL (what the visitor actually sees)
      <input id="target" placeholder="https://cataas.com/cat" />
    </label>
    <button id="create">Generate</button>
    <div id="out"></div>
  </section>

  <div id="tokens">Loading…</div>
</main>
<script>
const KEY=${JSON.stringify(key)};
const q=(k)=>KEY?('?key='+encodeURIComponent(KEY)):'';
const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
document.getElementById('create').onclick=async()=>{
  const targetUrl=document.getElementById('target').value.trim();
  if(!targetUrl){alert('Enter a destination image URL');return;}
  const r=await fetch('/api/tokens'+q(),{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({label:document.getElementById('label').value.trim(),targetUrl})});
  const d=await r.json();
  const out=document.getElementById('out');
  if(d.error){out.textContent=d.error;return;}
  const link=location.origin+'/i/'+d.id, pixel=location.origin+'/p/'+d.id+'.png';
  out.innerHTML='<div class="result"><p><strong>Share link</strong> (opens the image, logs the visit):</p>'
    +'<code>'+esc(link)+'</code><p><strong>Tracking pixel</strong> (embed in a page/email):</p>'
    +'<code>&lt;img src="'+esc(pixel)+'"&gt;</code></div>';
  document.getElementById('label').value='';document.getElementById('target').value='';
  load();
};
async function load(){
  const r=await fetch('/api/tokens'+q());
  const toks=await r.json();
  if(!Array.isArray(toks)){document.getElementById('tokens').textContent=toks.error||'error';return;}
  if(!toks.length){document.getElementById('tokens').innerHTML='<p>No links yet.</p>';return;}
  document.getElementById('tokens').innerHTML=toks.map(t=>
    '<div class="tok"><div class="tokhead"><div><strong>'+esc(t.label||'(no label)')+'</strong>'
    +' <span class="muted">/i/'+esc(t.id)+'</span></div>'
    +'<div><span class="badge">'+t.hit_count+' hits</span> '
    +'<button onclick="showHits(\\''+t.id+'\\')">view</button> '
    +'<button class="del" onclick="del(\\''+t.id+'\\')">delete</button></div></div>'
    +'<div id="h_'+t.id+'" class="hits"></div></div>'
  ).join('');
}
async function showHits(id){
  const el=document.getElementById('h_'+id);
  if(el.dataset.open){el.innerHTML='';el.dataset.open='';return;}
  el.dataset.open='1';el.textContent='Loading…';
  const hits=await (await fetch('/api/tokens/'+id+'/hits'+q())).json();
  if(!hits.length){el.innerHTML='<p class="muted">No visits captured yet.</p>';return;}
  el.innerHTML='<table><tr><th>Time (UTC)</th><th>Type</th><th>IP</th><th>Location</th><th>Device</th><th>Browser / OS</th><th>Lang</th></tr>'
    +hits.map(h=>{
      let g={};try{g=JSON.parse(h.geo||'{}')}catch(e){}
      const loc=g.city?(esc(g.city)+', '+esc(g.country||'')+(g.proxy?' ⚠️proxy':'')):'—';
      const kind=h.is_bot?'🤖 '+esc(h.browser):esc(h.kind);
      return '<tr><td>'+esc(h.ts)+'</td><td>'+kind+'</td><td>'+esc(h.ip)+'</td><td>'+loc+'</td>'
        +'<td>'+esc(h.device||'')+'</td><td>'+esc(h.is_bot?'—':h.browser)+' / '+esc(h.os||'')+'</td>'
        +'<td>'+esc((h.language||'').split(',')[0])+'</td></tr>';
    }).join('')+'</table>';
}
async function del(id){if(!confirm('Delete this link and its captures?'))return;await fetch('/api/tokens/'+id+q(),{method:'DELETE'});load();}
load();
</script>
</body></html>`);
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`imageLink listening on :${PORT}`);
  if (!ADMIN_KEY) console.log('⚠️  ADMIN_KEY not set — dashboard/API are open. Set ADMIN_KEY in production.');
});

// ── Shared styles ───────────────────────────────────────────────────────────
const CSS = `
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.55 system-ui,sans-serif;background:#0d1117;color:#e6edf3}
  .wrap{max-width:640px;margin:0 auto;padding:32px 20px}
  h1{margin:0 0 6px}
  .sub{color:#9aa4b2;margin-top:0}
  a{color:#58a6ff}
  .ethics{background:#241a14;border:1px solid #6b4a2b;border-radius:10px;padding:14px 16px;margin:18px 0;font-size:14px;color:#f0d9c0}
  .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;margin-top:18px}
  label{display:block;margin:12px 0 4px;font-size:13px;color:#9aa4b2}
  input{width:100%;padding:10px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3}
  button{margin-top:14px;padding:10px 16px;border:0;border-radius:8px;background:#238636;color:#fff;font-weight:600;cursor:pointer}
  button:hover{background:#2ea043}
  code{display:block;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;margin:6px 0;word-break:break-all;color:#7ee787}
  .result{margin-top:14px}
  .foot{margin-top:24px}
`;
const DASH_CSS = `
  .tok{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px;margin:12px 0}
  .tokhead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
  .muted{color:#9aa4b2;font-size:13px}
  .badge{background:#1f6feb33;border:1px solid #1f6feb;color:#79c0ff;border-radius:20px;padding:2px 10px;font-size:12px}
  button{margin-top:0;padding:6px 12px;font-size:13px;background:#21262d;border:1px solid #30363d}
  button:hover{background:#30363d}
  button.del{color:#ff7b72}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #21262d;white-space:nowrap}
  th{color:#9aa4b2;font-weight:600}
  .hits{overflow-x:auto}
`;
