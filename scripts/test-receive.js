const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3004}`;
const phone = (process.env.TEST_PHONE || "5511999999999").replace(/\D+/g, "");
const msg = `INBOUND-${Date.now()}`;

async function http(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
  return json ?? text;
}

async function run() {
  // Simula callback de recebido da Z-API
  const payload = {
    type: "ReceivedCallBack",
    phone,
    fromMe: false,
    messageId: `SIM-${Math.random().toString(16).slice(2)}`.toUpperCase(),
    text: { message: msg }
  };
  await http("POST", "/webhooks/whatsapp/received", payload);
  // Verifica histórico
  const list = await http("GET", `/api/chat/messages?phone=${phone}&limit=10`);
  const found = (list.messages || []).some(m => m.text === msg);
  if (!found) {
    console.error("inbound test: mensagem não encontrada no histórico");
    process.exit(1);
  }
  console.log("inbound test: ok");
  process.exit(0);
}

run().catch(e => { console.error("inbound test erro:", e?.message || e); process.exit(1); });
