import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

function httpRequest(method, fullUrl, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(fullUrl);
    const isHttps = u.protocol === "https:";
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ""),
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data ? Buffer.byteLength(data) : 0,
        Connection: "close"
      },
      agent: isHttps ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false })
    };
    const req = (isHttps ? https : http).request(opts, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} ${raw}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function httpCall(method, path, body) {
  const url = `${base}${path}`;
  return httpRequest(method, url, body);
}

async function run() {
  try {
    const health = await httpCall("GET", "/health");
    process.stdout.write(`[1/4] health: ${JSON.stringify(health)}\n`);

    const status = await httpCall("GET", "/api/zapi/status");
    process.stdout.write(`[2/4] zapi status: ${JSON.stringify(status)}\n`);

    const setup = await httpCall("POST", "/api/webhooks/setup");
    process.stdout.write(`[3/4] webhooks setup: ${JSON.stringify(setup)}\n`);

    const phone = process.env.TEST_PHONE || "5511999999999";
    const send = await httpCall("POST", "/api/send/text", {
      phone,
      message: "Smoke test",
      delayMessage: 1
    });
    process.stdout.write(`[4/4] send text: ${JSON.stringify(send)}\n`);

    process.stdout.write("smoke: ok\n");
    // aguarda event loop esvaziar naturalmente
  } catch (e) {
    process.stderr.write(`smoke: fail -> ${e.message || e}\n`);
    process.exitCode = 1;
  }
}

run();
