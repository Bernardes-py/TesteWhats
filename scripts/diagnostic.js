// Simple diagnostic runner for localhost
import fs from "node:fs";
import path from "node:path";

const base = process.env.BASE_URL || "http://localhost:3000";
const outDir = path.join(process.cwd(), "data", "logs");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "diagnostic.log");

function log(entry) {
  const e = { ts: Date.now(), ...entry };
  process.stdout.write(JSON.stringify(e) + "\n");
  try { fs.appendFileSync(outFile, JSON.stringify(e) + "\n"); } catch {}
}

async function hit(pathname, opts) {
  const url = base.replace(/\/+$/,"") + pathname;
  const started = Date.now();
  try {
    const res = await fetch(url, opts);
    const text = await res.text().catch(()=> "");
    log({ kind: "http", url, status: res.status, ms: Date.now()-started });
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    log({ kind: "http_err", url, error: e?.message || String(e), ms: Date.now()-started });
    return { ok: false, error: e?.message || String(e) };
  }
}

async function round(i) {
  await hit("/health");
  await hit("/chat.html");
  await Promise.all(Array.from({ length: 10 }, () => hit("/chat.html")));
  await hit("/api/chat/messages?phone=5511999999999&limit=1");
  log({ kind: "round_done", round: i });
}

async function main() {
  log({ kind: "begin", base });
  for (let i = 1; i <= 3; i++) {
    await round(i);
    await new Promise(r => setTimeout(r, 500));
  }
  log({ kind: "end" });
}

main().catch(e => {
  log({ kind: "fatal", error: e?.message || String(e) });
  process.exit(1);
});

