const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3004}`;
const phone = (process.env.TEST_PHONE || "5511999999999").replace(/\D+/g, "");

async function http(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
  return json ?? text;
}

async function waitFor(predicate, timeoutMs = 5000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

async function run() {
  const status = await http("GET", "/api/zapi/status");
  console.log("status:", status);
  const payload = { phone, message: `MOCK ${new Date().toISOString()}` };
  const send = await http("POST", "/api/chat/send", payload);
  console.log("send:", send);
  const ok = await waitFor(async () => {
    const msgs = await http("GET", `/api/chat/messages?phone=${phone}&limit=10`);
    return (msgs.messages || []).some(m => m.text?.startsWith("MOCK"));
  }, 5000, 250);
  if (!ok) {
    console.error("mock test: mensagem não apareceu no histórico");
    process.exit(1);
  }
  console.log("mock test: ok");
}

run().catch(e => { console.error("erro:", e?.message || e); process.exit(1); });
