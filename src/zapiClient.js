import { config } from "./config.js";
import fs from "node:fs";
import path from "node:path";
import { waitStatus, waitDelivery } from "./events.js";

function apiUrl(path) {
  return `${config.zapi.base}/instances/${config.zapi.instanceId}/token/${config.zapi.instanceToken}${path}`;
}

function mask(v) {
  if (!v) return "";
  const s = String(v);
  if (s.length <= 8) return s[0] + "***" + s.slice(-1);
  return s.slice(0, 4) + "..." + s.slice(-4);
}

function logAuth(event, extra) {
  if (!config.debug?.zapi) return;
  try {
    const dir = path.join(process.cwd(), "data", "logs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "auth.log");
    const entry = {
      ts: Date.now(),
      event,
      base: config.zapi.base,
      instanceId: mask(config.zapi.instanceId),
      instanceToken: mask(config.zapi.instanceToken),
      clientToken: mask(config.zapi.clientToken),
      ...extra
    };
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {}
}

function ensureConfig() {
  const missing = [];
  if (!config.zapi.base) missing.push("ZAPI_BASE_URL");
  if (!config.zapi.instanceId) missing.push("ZAPI_INSTANCE_ID");
  if (!config.zapi.instanceToken) missing.push("ZAPI_INSTANCE_TOKEN");
  if (!config.zapi.clientToken) missing.push("ZAPI_CLIENT_TOKEN");
  const tokenFmt = /^[A-Za-z0-9]{16,64}$/;
  if (config.zapi.clientToken && !tokenFmt.test(String(config.zapi.clientToken))) {
    const err = new Error("Client-Token inválido (formato)");
    err.status = 500;
    err.code = "invalid_client_token";
    throw err;
  }
  const isPlaceholder = (v) => /SEU[_\s-]?ID|SEU[_\s-]?TOKEN|CLIENTE[_\s-]?TOKEN/i.test(String(v || ""));
  const placeholders = [];
  if (isPlaceholder(config.zapi.instanceId)) placeholders.push("ZAPI_INSTANCE_ID");
  if (isPlaceholder(config.zapi.instanceToken)) placeholders.push("ZAPI_INSTANCE_TOKEN");
  if (isPlaceholder(config.zapi.clientToken)) placeholders.push("ZAPI_CLIENT_TOKEN");
  if (!config.zapi.mock && (missing.length || placeholders.length)) {
    const err = new Error(`Z-API configuração ausente: ${missing.join(", ")}`);
    err.status = 500;
    if (placeholders.length) {
      err.message = `Z-API configuração inválida ou placeholder: ${[...missing, ...placeholders].join(", ")}`;
    }
    throw err;
  }
}

function rndId(prefix = "") {
  return (
    prefix +
    Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2)
  ).slice(0, 32).toUpperCase();
}

function normalizeImageInput(src) {
  if (!src || typeof src !== "string") return "";
  const s = src.trim();
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) return s;
  // Heurística simples: se não é URL nem data:, tratar como base64 "crua"
  // e prefixar com image/jpeg por padrão
  const base64Like = /^[A-Za-z0-9+/=]+$/.test(s) && s.length > 100;
  if (base64Like) return `data:image/jpeg;base64,${s}`;
  return s; // deixar como está; a UI exibirá erro de preview se inválido
}

async function postLocalWebhook(route, payload) {
  try {
    await fetch(`http://localhost:${config.port}/webhooks/whatsapp/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    // silencioso em modo mock
  }
}

async function zapiFetch(method, path, body) {
  ensureConfig();
  if (config.zapi.mock) {
    // Simulação local de respostas da Z-API
    if (path === "/status" && method === "GET") {
      return {
        connected: true,
        smartphoneConnected: true,
        error: null
      };
    }
    if (path.startsWith("/update-webhook-") && method === "PUT") {
      return { value: true };
    }
    if (
      (path === "/send-text" ||
        path === "/send-image" ||
        path === "/send-video" ||
        path.startsWith("/send-document") ||
        path === "/send-audio") &&
      method === "POST"
    ) {
      const zaapId = rndId();
      const messageId = rndId();
      // Simular callbacks assíncronos
      setTimeout(() => {
        postLocalWebhook("delivery", {
          phone: body?.phone || "",
          zaapId,
          messageId,
          type: "DeliveryCallback",
          instanceId: config.zapi.instanceId || "mock.instance"
        });
        postLocalWebhook("status", {
          status: "SENT",
          ids: [messageId],
          momment: Date.now(),
          phone: body?.phone || "",
          type: "MessageStatusCallback",
          instanceId: config.zapi.instanceId || "mock.instance"
        });
        if (config.zapi.mockEchoReceived && path === "/send-text") {
          postLocalWebhook("received", {
            phone: body?.phone || "",
            fromMe: false,
            text: { message: body?.message || "" },
            type: "ReceivedCallBack",
            messageId
          });
        }
        if (config.zapi.mockEchoReceived && path === "/send-image") {
          const imgUrl = normalizeImageInput(body?.image || body?.imageUrl || "");
          postLocalWebhook("received", {
            phone: body?.phone || "",
            fromMe: false,
            image: { caption: body?.caption || "", imageUrl: imgUrl },
            type: "ReceivedCallBack",
            messageId
          });
        }
      }, 50);
      return { zaapId, messageId };
    }
    // fallback mock
    return { ok: true };
  }
  const attempt = async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    try {
      const url = apiUrl(path);
      const reqId = Math.random().toString(36).slice(2, 10);
      logAuth("request", { method, path, url, reqId });
      const res = await fetch(url, {
        method,
        headers: {
          "Client-Token": config.zapi.clientToken,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Request-Id": reqId
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        const err = new Error(`HTTP ${res.status} ${txt}`);
        err.status = res.status;
        err.body = txt;
        if (res.status === 401 || res.status === 403) {
          err.code = "auth_failed";
          logAuth("auth_failed", { status: res.status, body: txt, reqId });
        }
        if (res.status === 400 || res.status === 404) {
          const lowered = (txt || "").toLowerCase();
          if (lowered.includes("instance not found")) {
            err.code = "instance_not_found";
          }
        }
        throw err;
      }
      const data = await res.json().catch(() => ({}));
      logAuth("response", { method, path, status: res.status, reqId });
      return data;
    } finally {
      clearTimeout(t);
    }
  };
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      const code = e?.status;
      if (code === 429 || (code >= 500 && code < 600) || e.name === "AbortError") {
        const backoff = Math.pow(2, i) * 1000;
        await new Promise(r => setTimeout(r, backoff || 1000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export async function sendText({ phone, message, delayMessage, delayTyping, messageId }) {
  const body = { phone: String(phone || "").replace(/\D+/g, ""), message: String(message ?? "") };
  if (typeof delayMessage === "number") body.delayMessage = delayMessage;
  if (typeof delayTyping === "number") body.delayTyping = delayTyping;
  if (messageId) body.messageId = messageId;
  return zapiFetch("POST", "/send-text", body);
}

export async function sendImage({ phone, image, caption, delayMessage, messageId, viewOnce }) {
  const body = { phone: String(phone || "").replace(/\D+/g, ""), image };
  if (caption) body.caption = caption;
  if (typeof delayMessage === "number") body.delayMessage = delayMessage;
  if (messageId) body.messageId = messageId;
  if (typeof viewOnce === "boolean") body.viewOnce = viewOnce;
  return zapiFetch("POST", "/send-image", body);
}

export async function sendDocument({ phone, document, fileName, extension, delayMessage, messageId }) {
  const path = `/send-document/${extension || ""}`.replace(/\/$/, "");
  const body = { phone, document };
  if (fileName) body.fileName = fileName;
  if (typeof delayMessage === "number") body.delayMessage = delayMessage;
  if (messageId) body.messageId = messageId;
  return zapiFetch("POST", path, body);
}

export async function sendAudio({ phone, audio, delayMessage, messageId, viewOnce, async: asyncMode, waveform }) {
  const body = { phone, audio };
  if (typeof delayMessage === "number") body.delayMessage = delayMessage;
  if (messageId) body.messageId = messageId;
  if (typeof viewOnce === "boolean") body.viewOnce = viewOnce;
  if (typeof asyncMode === "boolean") body.async = asyncMode;
  if (typeof waveform === "boolean") body.waveform = waveform;
  return zapiFetch("POST", "/send-audio", body);
}

export async function sendVideo({ phone, video, caption, delayMessage, messageId, viewOnce, async: asyncMode }) {
  const body = { phone, video };
  if (caption) body.caption = caption;
  if (typeof delayMessage === "number") body.delayMessage = delayMessage;
  if (messageId) body.messageId = messageId;
  if (typeof viewOnce === "boolean") body.viewOnce = viewOnce;
  if (typeof asyncMode === "boolean") body.async = asyncMode;
  return zapiFetch("POST", "/send-video", body);
}

export async function updateWebhookReceived(urlValue) {
  return zapiFetch("PUT", "/update-webhook-received", { value: urlValue });
}

export async function updateWebhookDelivery(urlValue) {
  return zapiFetch("PUT", "/update-webhook-delivery", { value: urlValue });
}

export async function updateWebhookMessageStatus(urlValue) {
  return zapiFetch("PUT", "/update-webhook-message-status", { value: urlValue });
}

export async function updateWebhookConnected(urlValue) {
  return zapiFetch("PUT", "/update-webhook-connected", { value: urlValue });
}

export async function updateWebhookDisconnected(urlValue) {
  return zapiFetch("PUT", "/update-webhook-disconnected", { value: urlValue });
}

export async function updateEveryWebhooks(urlValue, notifySentByMe) {
  const body = { value: urlValue };
  if (typeof notifySentByMe === "boolean") body.notifySentByMe = notifySentByMe;
  return zapiFetch("PUT", "/update-every-webhooks", body);
}

export async function status() {
  return zapiFetch("GET", "/status");
}

function logSend(entry) {
  try {
    const dir = path.join(process.cwd(), "data", "logs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "sends.log");
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {}
}

export async function ensureConnected() {
  const s = await status();
  if (!s?.connected || !s?.smartphoneConnected) {
    const err = new Error("instance not connected");
    err.status = 503;
    throw err;
  }
  return s;
}

export async function sendTextEnsured({ phone, message }) {
  const startedAt = Date.now();
  const dest = String(phone || "").replace(/\D+/g, "");
  if (!dest) {
    const err = new Error("invalid phone");
    err.status = 400;
    throw err;
  }
  await ensureConnected();
  const res = await sendText({ phone: dest, message, delayMessage: 1 });
  const id = res?.messageId;
  // Tentar confirmar 'sent' rapidamente via webhook de delivery
  let deliveryPayload = null;
  try { deliveryPayload = await waitDelivery(id, 3000); } catch {}
  let statusPayload = null;
  try {
    statusPayload = await waitStatus(id, ["RECEIVED", "READ"], 1000);
  } catch {}
  const ok = Boolean(statusPayload);
  const sent = Boolean(deliveryPayload);
  const entry = { ts: startedAt, phone: dest, messageId: id, ok, status: statusPayload?.status || (sent ? "SENT" : "SENT") };
  logSend(entry);
  return { ...res, status: statusPayload?.status || "SENT", pending: (!ok && !sent) };
}
