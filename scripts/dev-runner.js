#!/usr/bin/env node
/**
 * Dev Runner / Diagnóstico e Testes Locais
 *
 * Objetivo:
 * - Facilitar ciclo de desenvolvimento, diagnósticos e testes em localhost (Modo A).
 * - Oferecer comandos para health-check, status da Z-API, injeção de recebimento (mock),
 *   monitoramento de logs e start/stop controlado do servidor.
 *
 * Uso (exemplos):
 *   node scripts/dev-runner.js --help
 *   node scripts/dev-runner.js health
 *   node scripts/dev-runner.js status
 *   node scripts/dev-runner.js test:receive --phone 5511999999999 --count 5 --dedup
 *   node scripts/dev-runner.js monitor --minutes 2
 *   node scripts/dev-runner.js start --mock true --debug true
 *   node scripts/dev-runner.js stop
 *   node scripts/dev-runner.js full --phone 5511999999999 --minutes 1
 *
 * Notas:
 * - Este script foca em testes locais (sem túnel). Para testes reais com a Z-API,
 *   reative o túnel e aponte os webhooks usando /api/webhooks/quick-setup.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const LOG_DIR = path.join(DATA_DIR, "logs");
const RUNTIME_DIR = path.join(DATA_DIR, "runtime");
const PID_FILE = path.join(RUNTIME_DIR, "server.pid");

function println(msg = "") {
  process.stdout.write(String(msg) + "\n");
}
function printErr(msg = "") {
  process.stderr.write(String(msg) + "\n");
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function now() {
  return new Date().toISOString();
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

async function http(method, pathname, body, { timeoutMs = 8000 } = {}) {
  const url = BASE_URL.replace(/\/+$/, "") + pathname;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, text, json };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
}

function loadPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const s = fs.readFileSync(PID_FILE, "utf8").trim();
      const pid = Number(s || "0");
      return Number.isFinite(pid) ? pid : 0;
    }
  } catch {}
  return 0;
}
function savePid(pid) {
  try { fs.writeFileSync(PID_FILE, String(pid)); } catch {}
}
function clearPid() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch {}
}

async function startServer({ mock = false, debug = false } = {}) {
  ensureDirs();
  const existing = loadPid();
  if (existing) {
    println(`[${now()}] servidor aparenta estar rodando com PID=${existing}`);
    return;
  }
  const env = { ...process.env };
  if (mock) env.ZAPI_MOCK = "true";
  if (debug) env.DEBUG_ZAPI = "true";
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: ROOT,
    env,
    stdio: "ignore",
    detached: true
  });
  savePid(child.pid);
  child.unref();
  println(`[${now()}] servidor iniciado em background (PID=${child.pid})`);
  // aguardar health
  for (let i = 0; i < 20; i++) {
    const r = await http("GET", "/health", null, { timeoutMs: 3000 });
    if (r.ok) {
      println(`[${now()}] health ok: ${r.status}`);
      return;
    }
    await sleep(500);
  }
  printErr(`[${now()}] health não respondeu após timeout; verifique logs`);
}

async function stopServer() {
  const pid = loadPid();
  // tentativa graciosa via endpoint admin
  const r = await http("POST", "/admin/shutdown", null, { timeoutMs: 3000 });
  if (r.ok) {
    println(`[${now()}] shutdown solicitado via /admin/shutdown`);
    await sleep(1000);
    clearPid();
    return;
  }
  // se falhou, tenta matar por PID
  if (pid) {
    try {
      process.kill(pid);
      println(`[${now()}] processo ${pid} encerrado via sinal`);
    } catch (e) {
      printErr(`[${now()}] falha ao encerrar PID=${pid}: ${e?.message || e}`);
    } finally {
      clearPid();
    }
  } else {
    printErr(`[${now()}] PID não encontrado; servidor pode não estar rodando`);
  }
}

async function healthCmd() {
  const r = await http("GET", "/health");
  if (!r.ok) {
    printErr(`[${now()}] health FAIL: ${r.status || ""} ${r.error || r.text || ""}`);
    process.exitCode = 1;
    return;
  }
  println(r.text || JSON.stringify(r.json));
}

async function statusCmd() {
  const r = await http("GET", "/api/zapi/status", null, { timeoutMs: 12000 });
  if (!r.ok) {
    printErr(`[${now()}] status FAIL: ${r.status || ""} ${r.error || r.text || ""}`);
    process.exitCode = 1;
    return;
  }
  println(r.text || JSON.stringify(r.json));
}

async function testReceive({ phone = "5511999999999", count = 5, dedup = true } = {}) {
  phone = String(phone).replace(/\D+/g, "");
  if (!phone) {
    printErr("telefone inválido; use --phone 55DDDNUMERO");
    process.exitCode = 1;
    return;
  }
  for (let i = 0; i < count; i++) {
    const id = `LOCAL-${Date.now()}-${i}`;
    const payload = {
      type: "ReceivedCallBack",
      phone,
      fromMe: false,
      messageId: id,
      text: { message: `local-${i}` }
    };
    const r = await http("POST", "/webhooks/whatsapp/received", payload);
    if (!r.ok) {
      printErr(`inserção webhook FAIL ${i}: ${r.status || ""} ${r.error || r.text || ""}`);
      process.exitCode = 1;
      return;
    }
  }
  if (dedup) {
    // reenvia o último id para validar deduplicação
    const lastId = `LOCAL-${Date.now()}-DUP`;
    await http("POST", "/webhooks/whatsapp/received", {
      type: "ReceivedCallBack",
      phone,
      fromMe: false,
      messageId: lastId,
      text: { message: "dup-check" }
    });
    const r2 = await http("POST", "/webhooks/whatsapp/received", {
      type: "ReceivedCallBack",
      phone,
      fromMe: false,
      messageId: lastId,
      text: { message: "dup-check" }
    });
    // Aceita 200 com {dedup:true} ou 200 vazio (dependendo do caminho)
    if (!r2.ok) printErr(`dedup reenvio retornou status ${r2.status}`);
  }
  const list = await http("GET", `/api/chat/messages?phone=${phone}&limit=10`);
  if (!list.ok) {
    printErr(`consulta histórico FAIL: ${list.status || ""} ${list.error || list.text || ""}`);
    process.exitCode = 1;
    return;
  }
  println(`[${now()}] test:receive OK para ${phone}`);
}

async function monitor({ minutes = 1 } = {}) {
  // leitura incremental simples de access.log e webhooks.log
  const files = ["access.log", "webhooks.log"]
    .map((n) => path.join(LOG_DIR, n))
    .filter((p) => fs.existsSync(p));
  if (files.length === 0) {
    printErr("nenhum log encontrado em data/logs");
    return;
  }
  const positions = new Map();
  for (const f of files) positions.set(f, fs.statSync(f).size);
  const endAt = Date.now() + minutes * 60 * 1000;
  println(`[${now()}] monitorando logs por ${minutes} min...`);
  while (Date.now() < endAt) {
    for (const f of files) {
      try {
        const pos = positions.get(f) || 0;
        const cur = fs.statSync(f).size;
        if (cur > pos) {
          const fd = fs.openSync(f, "r");
          const buf = Buffer.alloc(cur - pos);
          fs.readSync(fd, buf, 0, cur - pos, pos);
          fs.closeSync(fd);
          positions.set(f, cur);
          const lines = buf.toString("utf8").trim().split(/\r?\n/);
          for (const ln of lines) println(`${path.basename(f)}: ${ln}`);
        }
      } catch {}
    }
    await sleep(1000);
  }
  println(`[${now()}] monitor finalizado`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      args[k] = v;
    } else if (!args._) {
      args._ = [a];
    } else {
      args._.push(a);
    }
  }
  return args;
}

function help() {
  println(`Dev Runner

Comandos:
  health                         Verifica /health
  status                         Verifica /api/zapi/status
  test:receive [--phone N] [--count N] [--dedup true|false]
  monitor [--minutes N]         Monitora logs access/webhooks por N minutos
  start [--mock true] [--debug true]  Inicia servidor em background
  stop                           Encerra servidor (admin/shutdown) ou por PID
  full [--phone N] [--minutes N] Inicia → health → test:receive → monitor → stop
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    help();
    return;
  }
  const args = parseArgs(argv);
  const cmd = args._ ? args._[0] : argv[0];
  switch (cmd) {
    case "health":
      await healthCmd();
      break;
    case "status":
      await statusCmd();
      break;
    case "test:receive":
      await testReceive({
        phone: args.phone,
        count: args.count ? Number(args.count) : 5,
        dedup: String(args.dedup ?? "true").toLowerCase() !== "false"
      });
      break;
    case "monitor":
      await monitor({ minutes: args.minutes ? Number(args.minutes) : 1 });
      break;
    case "start":
      await startServer({ mock: String(args.mock || "false").toLowerCase() === "true", debug: String(args.debug || "false").toLowerCase() === "true" });
      break;
    case "stop":
      await stopServer();
      break;
    case "full": {
      await startServer({ mock: true, debug: false });
      await healthCmd();
      await testReceive({ phone: args.phone, count: 5, dedup: true });
      await monitor({ minutes: args.minutes ? Number(args.minutes) : 1 });
      await stopServer();
      break;
    }
    default:
      help();
      process.exitCode = 1;
  }
}

main().catch((e) => {
  printErr(`fatal: ${e?.message || e}`);
  process.exit(1);
});

