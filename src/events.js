import { EventEmitter } from "node:events";
const bus = new EventEmitter();
export function emitStatus(payload) {
  const ids = Array.isArray(payload?.ids) ? payload.ids : [];
  for (const id of ids) bus.emit(`status:${id}`, payload);
  bus.emit("evt", { type: "status", payload });
}
export function waitStatus(messageId, desired = ["RECEIVED", "READ"], timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bus.removeAllListeners(`status:${messageId}`);
      reject(new Error("timeout waiting status"));
    }, timeoutMs);
    const handler = (p) => {
      if (desired.includes(p?.status)) {
        clearTimeout(timer);
        bus.removeAllListeners(`status:${messageId}`);
        resolve(p);
      }
    };
    bus.on(`status:${messageId}`, handler);
  });
}
export function emitEvent(type, payload) {
  bus.emit("evt", { type, payload });
}
export function onAnyEvent(handler) {
  bus.on("evt", handler);
}
export function emitDelivery(payload) {
  const id = payload?.messageId;
  if (id) bus.emit(`delivery:${id}`, payload);
  bus.emit("evt", { type: "delivery", payload });
}
export function waitDelivery(messageId, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bus.removeAllListeners(`delivery:${messageId}`);
      reject(new Error("timeout waiting delivery"));
    }, timeoutMs);
    const handler = (p) => {
      clearTimeout(timer);
      bus.removeAllListeners(`delivery:${messageId}`);
      resolve(p);
    };
    bus.on(`delivery:${messageId}`, handler);
  });
}
