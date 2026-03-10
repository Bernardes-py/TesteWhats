import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

let db;

export function initDB() {
  const file = path.isAbsolute(config.db.file)
    ? config.db.file
    : path.join(process.cwd(), config.db.file);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      messageId TEXT,
      phone TEXT,
      text TEXT,
      imageUrl TEXT,
      fromMe INTEGER,
      isGroup INTEGER,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outgoing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zaapId TEXT,
      messageId TEXT,
      phone TEXT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);
}

export function saveEvent(type, payload) {
  if (!db) return;
  const stmt = db.prepare(
    "INSERT INTO events (type, payload, ts) VALUES (?, ?, ?)"
  );
  stmt.run(type, JSON.stringify(payload), Date.now());
}

export function saveMessage({ messageId, phone, text, imageUrl, fromMe, isGroup, ts }) {
  if (!db) return;
  const stmt = db.prepare(
    "INSERT INTO messages (messageId, phone, text, imageUrl, fromMe, isGroup, ts) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  stmt.run(messageId || null, phone || null, text || null, imageUrl || null, fromMe ? 1 : 0, isGroup ? 1 : 0, ts || Date.now());
}

export function saveOutgoing(kind, phone, payload, result) {
  if (!db) return;
  const stmt = db.prepare(
    "INSERT INTO outgoing (zaapId, messageId, phone, kind, payload, ts) VALUES (?, ?, ?, ?, ?, ?)"
  );
  stmt.run(result?.zaapId || null, result?.messageId || null, phone || null, kind, JSON.stringify(payload || {}), Date.now());
}

export function getStats() {
  if (!db) return { events: 0, messages: 0, outgoing: 0 };
  const getCount = (t) => db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
  return {
    events: getCount("events"),
    messages: getCount("messages"),
    outgoing: getCount("outgoing")
  };
}

export function listContacts({ limit = 50 } = {}) {
  if (!db) return [];
  const stmt = db.prepare(`
    SELECT phone,
           MAX(ts) AS lastTs,
           SUM(CASE WHEN fromMe=0 THEN 1 ELSE 0 END) AS receivedCount,
           SUM(CASE WHEN fromMe=1 THEN 1 ELSE 0 END) AS sentCount
    FROM messages
    WHERE phone IS NOT NULL AND phone <> ''
    GROUP BY phone
    ORDER BY lastTs DESC
    LIMIT ?
  `);
  return stmt.all(limit).map(row => ({
    phone: row.phone,
    lastTs: row.lastTs,
    receivedCount: Number(row.receivedCount || 0),
    sentCount: Number(row.sentCount || 0)
  }));
}

export function listMessages({ phone, limit = 50, beforeTs } = {}) {
  if (!db || !phone) return [];
  let sql = `
    SELECT messageId, phone, text, imageUrl, fromMe, isGroup, ts
    FROM messages
    WHERE phone = ?
  `;
  const params = [phone];
  if (beforeTs) {
    sql += " AND ts < ? ";
    params.push(beforeTs);
  }
  sql += " ORDER BY ts DESC LIMIT ?";
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.reverse().map(r => ({
    messageId: r.messageId,
    phone: r.phone,
    text: r.text,
    imageUrl: r.imageUrl,
    fromMe: !!r.fromMe,
    isGroup: !!r.isGroup,
    ts: r.ts
  }));
}

export function deleteMessagesByPhone(phone) {
  if (!db || !phone) return 0;
  const stmt = db.prepare("DELETE FROM messages WHERE phone = ?");
  const info = stmt.run(phone);
  return info.changes || 0;
}
