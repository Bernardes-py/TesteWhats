import fs from "node:fs";
import path from "node:path";

try {
  const p = path.join(process.cwd(), "data", "secrets.json");
  if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw);
    const isPlaceholder = (v) => {
      const s = String(v || "").trim().toUpperCase();
      // Abrange variações como SEU_ID, SEU-TOKEN, SEU CLIENT TOKEN, SEU_CLIENT_TOKEN, CLIENTE_TOKEN
      return /(^SEU([\s_-].*)?$)|(^SEU.*ID$)|(^SEU.*TOKEN$)|(^CLIENTE.*TOKEN$)/i.test(s);
    };
    for (const [k, v] of Object.entries(j || {})) {
      const cur = process.env[k];
      if ((typeof cur !== "string" || cur.trim() === "" || isPlaceholder(cur)) && typeof v === "string" && v.trim() !== "") {
        process.env[k] = v;
      }
    }
  }
} catch {}

const env = (k, def = "") => {
  const v = process.env[k];
  return (typeof v === "string" ? v.trim() : def) || def;
};

export const config = {
  zapi: {
    base: env("ZAPI_BASE_URL", "https://api.z-api.io").replace(/\/+$/, ""),
    instanceId: env("ZAPI_INSTANCE_ID", ""),
    instanceToken: env("ZAPI_INSTANCE_TOKEN", ""),
    clientToken: env("ZAPI_CLIENT_TOKEN", ""),
    mock: /^true|1|yes$/i.test(env("ZAPI_MOCK", "false")),
    mockEchoReceived: /^true|1|yes$/i.test(env("ZAPI_MOCK_ECHO_RECEIVED", "true"))
  },
  port: Number(env("PORT", "3000")),
  db: {
    file: env("DB_FILE", "data/app.db")
  },
  debug: {
    zapi: /^true|1|yes$/i.test(env("DEBUG_ZAPI", "false"))
  },
  webhooks: {
    received: env("WEBHOOK_RECEIVED_URL", ""),
    delivery: env("WEBHOOK_DELIVERY_URL", ""),
    status: env("WEBHOOK_STATUS_URL", ""),
    connected: env("WEBHOOK_CONNECTED_URL", ""),
    disconnected: env("WEBHOOK_DISCONNECTED_URL", "")
  }
};
