// THE key design question: can the shim's connection URIs make the driver hit
// our proxy with ZERO neonConfig overrides (Dyad's neon_context.ts never sets
// any)? The driver builds: "https://" + host.replace(/^[^.]+\./, "api.") + "/sql"
// — port ignored, always https, default fetch (Node trusts NODE_EXTRA_CA_CERTS).
// So URI host db.localtest.me -> https://api.localtest.me/sql -> needs a TLS
// listener on 443 for api.localtest.me with a cert Node trusts.
// Run with: NODE_EXTRA_CA_CERTS=certs/ca.pem node test-no-config.mjs
import { neon } from "@neondatabase/serverless";
import assert from "node:assert/strict";

// NO neonConfig overrides here — that is the point.
const sql = neon("postgresql://mini:none@db.localtest.me/spike_ssql");

const rows = await sql.query("SELECT 'no-config-path' AS via, 1+1 AS sum", []);
assert.equal(rows[0].via, "no-config-path");
assert.equal(rows[0].sum, 2);
console.log(
  "ok - driver reached https://api.localtest.me:443/sql with zero neonConfig",
);
process.exit(0);
