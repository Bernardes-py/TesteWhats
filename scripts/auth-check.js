// Verificador de autenticação Z-API em dev (carrega cliente após setar env)

async function run() {
  const forceBad = process.env.FORCE_BAD_TOKEN === "1";
  const orig = process.env.ZAPI_CLIENT_TOKEN;
  if (forceBad) {
    process.env.ZAPI_CLIENT_TOKEN = "INVALIDTOKEN123";
    console.log("FORCE_BAD_TOKEN=1: usando token inválido para testar 401/403");
  }
  try {
    // Import dinâmico após eventual troca do env
    const { status: zapiStatus } = await import("../src/zapiClient.js");
    const s = await zapiStatus();
    console.log("status OK:", JSON.stringify(s));
  } catch (e) {
    console.error("status FAIL:", e.status || "?", e.code || "", e.message);
  } finally {
    if (forceBad) process.env.ZAPI_CLIENT_TOKEN = orig;
  }
}

run().catch(e => {
  console.error("auth-check fatal:", e?.message || e);
  process.exit(1);
});
