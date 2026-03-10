// Minimal unit checks without external frameworks
process.env.ZAPI_MOCK = process.env.ZAPI_MOCK || "true";
const { default: path } = await import("node:path");
const { sendTextEnsured, status } = await import(path.join(process.cwd(), "src", "zapiClient.js"));

function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

async function run() {
  const s = await status();
  assert(s.connected === true, "status should be connected in mock");

  let threw = false;
  try {
    await sendTextEnsured({ phone: "", message: "x" });
  } catch { threw = true; }
  assert(threw, "sendTextEnsured must throw for invalid phone");

  console.log("unit tests: ok");
}

run().catch(e => { console.error("unit tests failed:", e?.message || e); process.exit(1); });
