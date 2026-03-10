const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3003}`;
const phone = (process.env.TEST_PHONE || "").replace(/\D+/g, "");
if (!phone) {
  console.error("TEST_PHONE ausente");
  process.exit(2);
}
async function http(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return json ?? text;
}
async function run() {
  const started = Date.now();
  try {
    const status = await http("GET", "/api/zapi/status");
    console.log("status:", status);
    const payload = { phone, message: `E2E ${new Date().toISOString()}` };
    const res = await http("POST", "/api/chat/send", payload);
    console.log("send:", res);
    const ok = Boolean(res?.messageId) && Boolean(res?.status);
    const spent = Date.now() - started;
    if (!ok) {
      console.error("e2e: falhou, sem confirmação de entrega");
      process.exit(1);
    }
    console.log(JSON.stringify({
      sentAt: new Date(started).toISOString(),
      messageId: res.messageId,
      status: res.status,
      elapsedMs: spent
    }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error("e2e erro:", e?.message || e);
    process.exit(1);
  }
}
run();
