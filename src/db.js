'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// On Railway, mount a Volume and set DB_PATH=/data/tracker.db so captures survive
// redeploys. Locally it falls back to ./data/tracker.db.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tracker.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL DEFAULT '',
    target_url  TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id    TEXT NOT NULL,
    ts          TEXT NOT NULL,
    kind        TEXT NOT NULL,            -- 'pixel' | 'landing' | 'client'
    ip          TEXT,
    user_agent  TEXT,
    referer     TEXT,
    language    TEXT,
    is_bot      INTEGER DEFAULT 0,        -- 1 = link-preview crawler (Telegram/WhatsApp/etc.)
    browser     TEXT,
    os          TEXT,
    device      TEXT,
    geo         TEXT,                     -- JSON blob from IP geolocation
    client      TEXT,                     -- JSON blob of optional client-side data
    FOREIGN KEY (token_id) REFERENCES tokens(id)
  );

  CREATE INDEX IF NOT EXISTS idx_hits_token ON hits(token_id, ts);
`);

function newId() {
  // URL-safe, short, hard to guess
  return crypto.randomBytes(6).toString('base64url');
}

const stmts = {
  insertToken: db.prepare(
    `INSERT INTO tokens (id, label, target_url, created_at) VALUES (@id, @label, @target_url, @created_at)`
  ),
  getToken: db.prepare(`SELECT * FROM tokens WHERE id = ?`),
  listTokens: db.prepare(`
    SELECT t.*,
           (SELECT COUNT(*) FROM hits h WHERE h.token_id = t.id) AS hit_count,
           (SELECT MAX(ts) FROM hits h WHERE h.token_id = t.id) AS last_hit
    FROM tokens t ORDER BY t.created_at DESC
  `),
  deleteToken: db.prepare(`DELETE FROM tokens WHERE id = ?`),
  deleteTokenHits: db.prepare(`DELETE FROM hits WHERE token_id = ?`),
  insertHit: db.prepare(`
    INSERT INTO hits (token_id, ts, kind, ip, user_agent, referer, language, is_bot, browser, os, device, geo, client)
    VALUES (@token_id, @ts, @kind, @ip, @user_agent, @referer, @language, @is_bot, @browser, @os, @device, @geo, @client)
  `),
  listHits: db.prepare(`SELECT * FROM hits WHERE token_id = ? ORDER BY ts DESC LIMIT 500`),
  getHit: db.prepare(`SELECT * FROM hits WHERE id = ?`),
  updateHitGeo: db.prepare(`UPDATE hits SET geo = ? WHERE id = ?`),
  updateHitClient: db.prepare(`UPDATE hits SET client = ? WHERE id = ?`),
};

module.exports = {
  db,
  newId,
  createToken({ label, targetUrl }) {
    const token = { id: newId(), label: label || '', target_url: targetUrl, created_at: new Date().toISOString() };
    stmts.insertToken.run(token);
    return token;
  },
  getToken: (id) => stmts.getToken.get(id),
  listTokens: () => stmts.listTokens.all(),
  deleteToken(id) {
    stmts.deleteTokenHits.run(id);
    return stmts.deleteToken.run(id);
  },
  insertHit(hit) {
    const info = stmts.insertHit.run({
      token_id: hit.token_id,
      ts: hit.ts || new Date().toISOString(),
      kind: hit.kind,
      ip: hit.ip || null,
      user_agent: hit.user_agent || null,
      referer: hit.referer || null,
      language: hit.language || null,
      is_bot: hit.is_bot ? 1 : 0,
      browser: hit.browser || null,
      os: hit.os || null,
      device: hit.device || null,
      geo: hit.geo ? JSON.stringify(hit.geo) : null,
      client: hit.client ? JSON.stringify(hit.client) : null,
    });
    return info.lastInsertRowid;
  },
  listHits: (tokenId) => stmts.listHits.all(tokenId),
  setHitGeo: (id, geo) => stmts.updateHitGeo.run(JSON.stringify(geo), id),
  setHitClient: (id, client) => stmts.updateHitClient.run(JSON.stringify(client), id),
};
