// neon-sim entry point. Starts:
//   :7788  Neon v2 control-plane shim + /authsvc better-auth mounts + /__sim ops
//   :443   SQL proxy (TLS) — @neondatabase/serverless fetch path (host rewrite
//          means the driver always hits https://api.localtest.me/sql)
//   :7790  SQL proxy (plain HTTP, debug convenience)
//   :5433  pg-tls-front — TCP Postgres clients that hardcode ssl:true
// Every consuming process needs NODE_EXTRA_CA_CERTS=<neon-sim>/certs/ca.pem.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlProxy } from "./lib/sql-proxy.mjs";
import { createPgTlsFront } from "./lib/pg-tls-front.mjs";
import { createControlPlane } from "./lib/control-plane.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CERTS = path.join(ROOT, "certs");
const LEDGER = path.join(ROOT, "ledger");

const CONTROL_PORT = Number(process.env.SIM_CONTROL_PORT ?? 7788);
const SQL_HTTPS_PORT = Number(process.env.SIM_SQL_HTTPS_PORT ?? 443);
const SQL_HTTP_PORT = Number(process.env.SIM_SQL_HTTP_PORT ?? 7790);
const TLS_FRONT_PORT = Number(process.env.SIM_TLS_FRONT_PORT ?? 5433);

let controlPlane;
const sqlProxy = createSqlProxy({
  certsDir: CERTS,
  httpPort: SQL_HTTP_PORT,
  httpsPort: SQL_HTTPS_PORT,
  onStatement: (entry) => controlPlane?.ledgerAppend(entry.database, entry),
});
const tlsFront = createPgTlsFront({
  listenPort: TLS_FRONT_PORT,
  certsDir: CERTS,
});
controlPlane = createControlPlane({
  port: CONTROL_PORT,
  ledgerDir: LEDGER,
  sqlProxy,
});

await controlPlane.start();
console.log(
  `[neon-sim] control plane + authsvc on http://127.0.0.1:${CONTROL_PORT}`,
);
console.log(
  `[neon-sim] sql proxy on :${SQL_HTTPS_PORT} (tls) / :${SQL_HTTP_PORT} (http)`,
);
console.log(`[neon-sim] pg-tls-front on :${TLS_FRONT_PORT} -> :5432`);
console.log(
  `[neon-sim] Dyad env: DYAD_NEON_API_BASE_URL=http://127.0.0.1:${CONTROL_PORT}/api/v2`,
);

async function shutdown() {
  console.log("[neon-sim] shutting down");
  await controlPlane.close();
  await sqlProxy.close();
  tlsFront.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
