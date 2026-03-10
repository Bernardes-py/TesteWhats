import express from "express";
import fs from "node:fs";
import path from "node:path";
import { saveEvent, saveMessage } from "./db.js";
import { emitStatus, emitEvent, emitDelivery } from "./events.js";
const router = express.Router();

const events = [];
const messages = [];
// Deduplicação simples por messageId (LRU)
const recentIds = new Map(); // id -> ts
const MAX_RECENT = 1000;
function seen(id) {
  const now = Date.now();
  if (!id) return false;
  if (recentIds.has(id)) return true;
  recentIds.set(id, now);
  if (recentIds.size > MAX_RECENT) {
    // remove mais antigos
    const toRemove = recentIds.size - MAX_RECENT;
    let i = 0;
    for (const k of recentIds.keys()) {
      recentIds.delete(k);
      if (++i >= toRemove) break;
    }
  }
  return false;
}
const push = (type, body) => {
  events.push({ type, body, ts: Date.now() });
  if (events.length > 200) events.shift();
  try { saveEvent(type, body); } catch {}
  try {
    const dir = path.join(process.cwd(), "data", "logs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "webhooks.log"), JSON.stringify({ type, ts: Date.now(), body }) + "\n");
  } catch {}
};

const getPhone = (body) => {
  const raw = body?.phone || body?.participantPhone || body?.senderPhone || body?.connectedPhone || "";
  return String(raw).replace(/\D+/g, "");
};
const getText = (body) =>
  body?.text?.message ||
  body?.message ||
  body?.image?.caption ||
  body?.video?.caption ||
  body?.document?.title ||
  body?.contact?.displayName ||
  "";
const getImageUrl = (body) =>
  body?.image?.imageUrl ||
  body?.imageUrl ||
  body?.image?.url ||
  body?.image?.thumbnailUrl ||
  "";

router.post("/received", (req, res) => {
  push("received", req.body);
  const text = getText(req.body);
  const phone = getPhone(req.body);
  const imageUrl = getImageUrl(req.body);
  const fromMe = Boolean(req.body?.fromMe);
  const isGroup = Boolean(req.body?.isGroup);
  const messageId = req.body?.messageId || req.body?.id || "";
  if (seen(messageId)) {
    return res.status(200).json({ dedup: true });
  }
  const msg = { phone, text, imageUrl, fromMe, isGroup, messageId, ts: Date.now() };
  messages.push(msg);
  if (messages.length > 200) messages.shift();
  try { saveMessage({ phone, text, imageUrl, fromMe, isGroup, messageId, ts: Date.now() }); } catch {}
  try { emitEvent("received", msg); } catch {}
  res.sendStatus(200);
});

router.post("/status", (req, res) => {
  push("status", req.body);
  try { emitStatus(req.body); } catch {}
  res.sendStatus(200);
});

router.post("/delivery", (req, res) => {
  push("delivery", req.body);
  try { emitDelivery(req.body); } catch {}
  res.sendStatus(200);
});

router.post("/connected", (req, res) => {
  push("connected", req.body);
  res.sendStatus(200);
});

router.post("/disconnected", (req, res) => {
  push("disconnected", req.body);
  res.sendStatus(200);
});

router.get("/events", (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const data = events.slice(-limit).reverse();
  res.json({ events: data });
});

router.delete("/events", (req, res) => {
  events.length = 0;
  res.json({ cleared: true });
});

router.get("/messages", (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  const data = messages.slice(-limit).reverse();
  res.json({ messages: data });
});

router.delete("/messages", (req, res) => {
  messages.length = 0;
  res.json({ cleared: true });
});

export default router;
