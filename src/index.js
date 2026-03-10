import express from "express";
import fs from "node:fs";
import { config } from "./config.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDB, saveOutgoing, getStats, listContacts, listMessages, saveMessage, deleteMessagesByPhone } from "./db.js";
import webhooks from "./webhooks.js";
import {
  sendText,
  sendTextEnsured,
  sendImage,
  sendDocument,
  sendAudio,
  sendVideo,
  status as zapiStatus,
  updateWebhookReceived,
  updateWebhookDelivery,
  updateWebhookMessageStatus,
  updateWebhookConnected,
  updateWebhookDisconnected,
  updateEveryWebhooks
} from "./zapiClient.js";
import { onAnyEvent } from "./events.js";

const app = express();
app.use(express.json({ limit: "10mb" }));
// Tratamento global de erros e exceções
try {
  const dir = path.join(process.cwd(), "data", "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const errFile = path.join(dir, "error.log");
  const writeErr = (label, e) => {
    const entry = { ts: Date.now(), label, message: e?.message || String(e), stack: e?.stack || null };
    try { fs.appendFileSync(errFile, JSON.stringify(entry) + "\n"); } catch {}
  };
  process.on("uncaughtException", (e) => writeErr("uncaughtException", e));
  process.on("unhandledRejection", (e) => writeErr("unhandledRejection", e));
} catch {}
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    process.stdout.write(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms\n`);
    try {
      const dir = path.join(process.cwd(), "data", "logs");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "access.log");
      fs.appendFileSync(file, JSON.stringify({ ts: Date.now(), m: req.method, u: req.originalUrl, s: res.statusCode, ms }) + "\n");
    } catch {}
  });
  next();
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", async (req, res) => {
  try {
    const deep = String(req.query.deep || "").toLowerCase() === "1";
    let z = null;
    if (deep) {
      try { z = await zapiStatus(); } catch (e) { z = { error: e.message || String(e) }; }
    }
    const id = (config.zapi.instanceId || "");
    const mask = id ? id.slice(0, 4) + "..." : "";
    res.json({
      ok: true,
      zapi: {
        base: Boolean(config.zapi.base),
        instanceIdSet: Boolean(config.zapi.instanceId && !/SEU[_\s-]?ID/i.test(config.zapi.instanceId)),
        instanceTokenSet: Boolean(config.zapi.instanceToken && !/SEU[_\s-]?TOKEN/i.test(config.zapi.instanceToken)),
        clientTokenSet: Boolean(config.zapi.clientToken && !/CLIENTE[_\s-]?TOKEN/i.test(config.zapi.clientToken)),
        mock: config.zapi.mock,
        idPrefix: mask
      },
      status: z
    });
  } catch {
    res.json({ ok: true });
  }
});

app.use("/webhooks/whatsapp", webhooks);

// SSE for real-time events
const sseClients = new Set();
app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: ping\ndata: ok\n\n`);
  sseClients.add(res);
  req.on("close", () => { sseClients.delete(res); });
});
onAnyEvent((evt) => {
  const data = `data: ${JSON.stringify(evt)}\n\n`;
  for (const c of sseClients) {
    try { c.write(data); } catch {}
  }
});

app.post("/api/send/text", async (req, res) => {
  try {
    const result = await sendText(req.body);
    try { saveOutgoing("text", req.body?.phone, req.body, result); } catch {}
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

app.post("/api/send/image", async (req, res) => {
  try {
    const result = await sendImage(req.body);
    try { saveOutgoing("image", req.body?.phone, req.body, result); } catch {}
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

app.post("/api/send/document", async (req, res) => {
  try {
    const result = await sendDocument(req.body);
    try { saveOutgoing("document", req.body?.phone, req.body, result); } catch {}
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

app.post("/api/send/audio", async (req, res) => {
  try {
    const result = await sendAudio(req.body);
    try { saveOutgoing("audio", req.body?.phone, req.body, result); } catch {}
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

app.post("/api/send/video", async (req, res) => {
  try {
    const result = await sendVideo(req.body);
    try { saveOutgoing("video", req.body?.phone, req.body, result); } catch {}
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

app.post("/api/webhooks/setup", async (req, res) => {
  try {
    const received = config.webhooks.received;
    const delivery = config.webhooks.delivery;
    const status = config.webhooks.status;
    const connected = config.webhooks.connected;
    const disconnected = config.webhooks.disconnected;
    const results = {};
    if (received) results.received = await updateWebhookReceived(received);
    if (delivery) results.delivery = await updateWebhookDelivery(delivery);
    if (status) results.status = await updateWebhookMessageStatus(status);
    if (connected) results.connected = await updateWebhookConnected(connected);
    if (disconnected) results.disconnected = await updateWebhookDisconnected(disconnected);
    res.json(results);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

// Quick-setup: define um baseUrl e atualiza todos os webhooks
app.post("/api/webhooks/quick-setup", async (req, res) => {
  try {
    const baseUrl = String(req.body?.baseUrl || req.query?.baseUrl || "").trim();
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return res.status(400).json({ error: "baseUrl inválido (requer http/https)" });
    const v = s => baseUrl.replace(/\/+$/, "") + s;
    const results = {};
    results.received = await updateWebhookReceived(v("/webhooks/whatsapp/received"));
    results.delivery = await updateWebhookDelivery(v("/webhooks/whatsapp/delivery"));
    results.status = await updateWebhookMessageStatus(v("/webhooks/whatsapp/status"));
    results.connected = await updateWebhookConnected(v("/webhooks/whatsapp/connected"));
    results.disconnected = await updateWebhookDisconnected(v("/webhooks/whatsapp/disconnected"));
    res.json(results);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

// Suporte a GET para facilitar execução via navegador
app.get("/api/webhooks/quick-setup", async (req, res) => {
  try {
    const baseUrl = String(req.query?.baseUrl || "").trim();
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return res.status(400).json({ error: "baseUrl inválido (requer http/https)" });
    const v = s => baseUrl.replace(/\/+$/, "") + s;
    const results = {};
    results.received = await updateWebhookReceived(v("/webhooks/whatsapp/received"));
    results.delivery = await updateWebhookDelivery(v("/webhooks/whatsapp/delivery"));
    results.status = await updateWebhookMessageStatus(v("/webhooks/whatsapp/status"));
    results.connected = await updateWebhookConnected(v("/webhooks/whatsapp/connected"));
    results.disconnected = await updateWebhookDisconnected(v("/webhooks/whatsapp/disconnected"));
    res.json(results);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

app.get("/api/zapi/status", async (req, res) => {
  try {
    const result = await zapiStatus();
    res.json(result);
  } catch (e) {
    const payload = { error: e.message, detail: e.body || null };
    if (e.code === "auth_failed") payload.tip = "Falha de autenticação na Z-API (verifique Client-Token e Instance Token)";
    if (e.code === "instance_not_found") payload.tip = "Instância não encontrada na Z-API (verifique Instance ID/Token)";
    res.status(e.status || 500).json(payload);
  }
});

app.get("/api/db/stats", (req, res) => {
  try {
    res.json(getStats());
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Endpoint de debug (mascarado) da autenticação — apenas se DEBUG_ZAPI=true
app.get("/api/debug/auth", (req, res) => {
  try {
    if (!config.debug?.zapi) return res.status(404).end();
    const mask = (v) => v ? String(v).slice(0,4) + "..." + String(v).slice(-4) : "";
    const base = (config.zapi.base || "").replace(/\/+$/,"");
    const sample = `${base}/instances/${config.zapi.instanceId}/token/${config.zapi.instanceToken}/status`;
    res.json({
      base,
      instanceId: mask(config.zapi.instanceId),
      instanceToken: mask(config.zapi.instanceToken),
      clientToken: mask(config.zapi.clientToken),
      sampleStatusUrl: sample
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Configuração de credenciais via API (persistência local em data/secrets.json)
app.get("/api/config/secrets", (req, res) => {
  try {
    const current = {
      ZAPI_INSTANCE_ID: config.zapi.instanceId ? config.zapi.instanceId.slice(0, 4) + "..." : "",
      ZAPI_INSTANCE_TOKEN: config.zapi.instanceToken ? config.zapi.instanceToken.slice(0, 4) + "..." : "",
      ZAPI_CLIENT_TOKEN: config.zapi.clientToken ? config.zapi.clientToken.slice(0, 4) + "..." : ""
    };
    res.json({ set: Boolean(config.zapi.instanceId && config.zapi.instanceToken && config.zapi.clientToken), current });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
app.post("/api/config/secrets", (req, res) => {
  try {
    const { ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN } = req.body || {};
    if (!ZAPI_INSTANCE_ID && !ZAPI_INSTANCE_TOKEN && !ZAPI_CLIENT_TOKEN) {
      return res.status(400).json({ error: "Informe ao menos um dos campos: ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN" });
    }
    const dir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "secrets.json");
    let current = {};
    try {
      if (fs.existsSync(file)) current = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    const merged = { ...current };
    if (ZAPI_INSTANCE_ID) { merged.ZAPI_INSTANCE_ID = String(ZAPI_INSTANCE_ID); process.env.ZAPI_INSTANCE_ID = String(ZAPI_INSTANCE_ID); }
    if (ZAPI_INSTANCE_TOKEN) { merged.ZAPI_INSTANCE_TOKEN = String(ZAPI_INSTANCE_TOKEN); process.env.ZAPI_INSTANCE_TOKEN = String(ZAPI_INSTANCE_TOKEN); }
    if (ZAPI_CLIENT_TOKEN) { merged.ZAPI_CLIENT_TOKEN = String(ZAPI_CLIENT_TOKEN); process.env.ZAPI_CLIENT_TOKEN = String(ZAPI_CLIENT_TOKEN); }
    fs.writeFileSync(file, JSON.stringify(merged, null, 2));
    res.json({
      saved: true,
      masked: {
        ZAPI_INSTANCE_ID: merged.ZAPI_INSTANCE_ID ? String(merged.ZAPI_INSTANCE_ID).slice(0, 4) + "..." : "",
        ZAPI_INSTANCE_TOKEN: merged.ZAPI_INSTANCE_TOKEN ? String(merged.ZAPI_INSTANCE_TOKEN).slice(0, 4) + "..." : "",
        ZAPI_CLIENT_TOKEN: merged.ZAPI_CLIENT_TOKEN ? String(merged.ZAPI_CLIENT_TOKEN).slice(0, 4) + "..." : ""
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/chat/contacts", (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    res.json({ contacts: listContacts({ limit }) });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/chat/messages", (req, res) => {
  try {
    const phone = String(req.query.phone || "").trim();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const beforeTs = req.query.before ? Number(req.query.before) : undefined;
    if (!phone) return res.status(400).json({ error: "phone is required" });
    res.json({ messages: listMessages({ phone, limit, beforeTs }) });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.delete("/api/chat/messages", (req, res) => {
  try {
    const phone = String((req.query.phone || req.body?.phone || "")).trim();
    if (!phone) return res.status(400).json({ error: "phone is required" });
    const deleted = deleteMessagesByPhone(phone);
    res.json({ deleted });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/chat/send", async (req, res) => {
  try {
    let { phone, message } = req.body || {};
    if (typeof phone === "string") phone = phone.replace(/\D+/g, "");
    if (typeof message === "string") message = message.trim();
    if (!phone || !message) return res.status(400).json({ error: "phone and message are required" });
    const result = await sendTextEnsured({ phone, message });
    try {
      saveOutgoing("text", phone, { phone, message }, result);
      saveMessage({ phone, text: message, fromMe: true, isGroup: false, messageId: result?.messageId, ts: Date.now() });
    } catch {}
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

app.post("/api/chat/send-image", async (req, res) => {
  try {
    let { phone, image, caption, viewOnce } = req.body || {};
    if (typeof phone === "string") phone = phone.replace(/\D+/g, "");
    if (typeof caption === "string") caption = caption.trim();
    if (!phone || !image) return res.status(400).json({ error: "phone and image are required" });
    const result = await sendImage({ phone, image, caption, viewOnce, delayMessage: 1 });
    try {
      saveOutgoing("image", phone, { phone, image, caption, viewOnce }, result);
      saveMessage({ phone, text: caption || "", imageUrl: image, fromMe: true, isGroup: false, messageId: result?.messageId, ts: Date.now() });
    } catch {}
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.body || null });
  }
});

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
let server;

// Encerramento controlado (loopback ou header X-Admin-Token)
const isLocal = (req) => {
  const ip = req.ip || req.connection?.remoteAddress || "";
  return ip.includes("127.0.0.1") || ip.includes("::1");
};
const authAdmin = (req) => {
  const hdr = req.headers["x-admin-token"];
  return (ADMIN_TOKEN && hdr && String(hdr) === ADMIN_TOKEN) || isLocal(req);
};
app.post("/admin/shutdown", (req, res) => {
  if (!authAdmin(req)) return res.status(403).json({ error: "forbidden" });
  res.json({ shuttingDown: true });
  try { server?.close(() => process.exit(0)); } catch { process.exit(0); }
});

server = app.listen(config.port, () => {
  try { initDB(); } catch (e) { process.stdout.write(`db init error: ${e?.message || e}\n`); }
  const id = (config.zapi.instanceId || "").slice(0, 6);
  process.stdout.write(`listening on :${config.port} | zapi id:${id ? id + "..." : "<unset>"}\n`);
});
