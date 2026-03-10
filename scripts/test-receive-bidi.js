// Teste de recebimento bidirecional (mock webhooks) + consulta
const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const phone = (process.env.TEST_PHONE || "5511999999999").replace(/\D+/g, "");

async function http(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} ${txt}`);
  return json ?? txt;
}

async function main() {
  // injeta 5 mensagens como se fossem webhooks de recebimento
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const id = `BIDI-${Date.now()}-${i}`;
    ids.push(id);
    const payload = {
      type: "ReceivedCallBack",
      phone,
      fromMe: false,
      messageId: id,
      text: { message: `bidi-${i}` }
    };
    await http("POST", "/webhooks/whatsapp/received", payload);
  }
  // duplica o último para testar dedup
  await http("POST", "/webhooks/whatsapp/received", {
    type: "ReceivedCallBack",
    phone,
    fromMe: false,
    messageId: ids[ids.length - 1],
    text: { message: "should-dedup" }
  });
  // consulta
  const list = await http("GET", `/api/chat/messages?phone=${phone}&limit=10`);
  const msgs = (list.messages || []).filter(m => String(m.text || "").startsWith("bidi-"));
  if (msgs.length < 5) {
    console.error("bidi test: mensagens insuficientes", msgs.length);
    process.exit(1);
  }
  console.log("bidi test: ok", msgs.length);
}

main().catch(e => { console.error("bidi test: fail", e?.message || e); process.exit(1); });

