// neon-sim SQL proxy spike: speaks the @neondatabase/serverless fetch protocol
// (POST /sql) against local Postgres. Protocol extracted from
// node_modules/@neondatabase/serverless v1.0.1 index.mjs (identical in 1.1.0):
//   - endpoint: default fetchEndpoint = "https://" + host.replace(/^[^.]+\./, "api.") + "/sql"
//     (port from the connection URI is IGNORED; always https; overridable only
//     via neonConfig.fetchEndpoint)
//   - request headers: Neon-Connection-String (full URI), Neon-Raw-Text-Output: "true",
//     Neon-Array-Mode: "true"; batches add Neon-Batch-Isolation-Level /
//     Neon-Batch-Read-Only / Neon-Batch-Deferrable when set
//   - request body: {query, params} | {queries: [{query, params}, ...]}
//   - success 200: single -> {command, rowCount, fields:[{name,dataTypeID,...}],
//     rows: [[rawtext|null,...]]}; batch -> {results: [...]}. Driver parses raw
//     text client-side via pg-types getTypeParser(dataTypeID).
//   - error 400: JSON body whose fields are copied onto NeonDbError: message,
//     severity, code, detail, hint, position, internalPosition, internalQuery,
//     where, schema, table, column, dataType, constraint, file, line, routine.
//     Any other status -> "Server error (HTTP status N)" with text body.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import pg from "pg";

const { Pool, DatabaseError } = pg;

const HTTP_PORT = Number(process.env.PROXY_HTTP_PORT ?? 7790);
const HTTPS_PORT = process.env.PROXY_HTTPS_PORT
  ? Number(process.env.PROXY_HTTPS_PORT)
  : null;
const PG_HOST = process.env.PROXY_PG_HOST ?? "localhost";
const PG_PORT = Number(process.env.PROXY_PG_PORT ?? 5432);
const PG_USER = process.env.PROXY_PG_USER ?? "mini";
// Real-Neon fidelity for multi-statement queries with no params is not
// verifiable offline; default is permissive (simple protocol). Set
// STRICT_SINGLE_STATEMENT=1 to force the extended protocol for every query.
const STRICT = process.env.STRICT_SINGLE_STATEMENT === "1";

// Raw text passthrough: the driver does its own type parsing from dataTypeID.
const RAW_TYPES = { getTypeParser: () => (v) => v };

const pools = new Map();
function poolFor(database) {
  if (!pools.has(database)) {
    pools.set(
      database,
      new Pool({
        host: PG_HOST,
        port: PG_PORT,
        user: PG_USER,
        database,
        max: 5,
      }),
    );
  }
  return pools.get(database);
}

const ERROR_FIELDS = [
  "severity",
  "code",
  "detail",
  "hint",
  "position",
  "internalPosition",
  "internalQuery",
  "where",
  "schema",
  "table",
  "column",
  "dataType",
  "constraint",
  "file",
  "line",
  "routine",
];

function errorBody(err) {
  const body = { message: err.message };
  if (err instanceof DatabaseError) {
    for (const f of ERROR_FIELDS) body[f] = err[f] ?? null;
  }
  return body;
}

function toNeonResult(r) {
  return {
    command: r.command,
    rowCount: r.rowCount ?? 0,
    fields: (r.fields ?? []).map((f) => ({
      name: f.name,
      dataTypeID: f.dataTypeID,
      tableID: f.tableID,
      columnID: f.columnID,
      dataTypeSize: f.dataTypeSize,
      dataTypeModifier: f.dataTypeModifier,
      format: f.format,
    })),
    rows: r.rows ?? [],
    rowAsArray: true,
  };
}

async function runSingle(client, q) {
  const hasParams = Array.isArray(q.params) && q.params.length > 0;
  const cfg = { text: q.query, rowMode: "array", types: RAW_TYPES };
  if (hasParams || STRICT) cfg.values = q.params ?? [];
  const result = await client.query(cfg);
  // Multi-statement simple query returns an array of results; real Neon's
  // behavior here is unverified offline — we return the last result.
  return toNeonResult(
    Array.isArray(result) ? result[result.length - 1] : result,
  );
}

const ISOLATION_SQL = {
  ReadUncommitted: "READ UNCOMMITTED",
  ReadCommitted: "READ COMMITTED",
  RepeatableRead: "REPEATABLE READ",
  Serializable: "SERIALIZABLE",
};

async function handle(req, res) {
  if (req.method !== "POST" || !req.url.startsWith("/sql")) {
    res.writeHead(404).end("not found");
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "invalid JSON body" }));
    return;
  }
  const connStr = req.headers["neon-connection-string"];
  let database;
  try {
    database = decodeURIComponent(new URL(connStr).pathname.slice(1));
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ message: "missing/invalid Neon-Connection-String" }),
    );
    return;
  }

  const pool = poolFor(database);
  try {
    if (Array.isArray(payload.queries)) {
      const client = await pool.connect();
      try {
        let begin = "BEGIN";
        const iso = ISOLATION_SQL[req.headers["neon-batch-isolation-level"]];
        if (iso) begin += ` ISOLATION LEVEL ${iso}`;
        if (req.headers["neon-batch-read-only"] === "true")
          begin += " READ ONLY";
        if (req.headers["neon-batch-deferrable"] === "true")
          begin += " DEFERRABLE";
        await client.query(begin);
        const results = [];
        try {
          for (const q of payload.queries)
            results.push(await runSingle(client, q));
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ results }));
      } finally {
        client.release();
      }
    } else {
      const result = await runSingle(pool, payload);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    }
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify(errorBody(err)));
  }
}

http.createServer(handle).listen(HTTP_PORT, () => {
  console.log(`sql proxy (http) on :${HTTP_PORT}`);
});

if (HTTPS_PORT !== null) {
  https
    .createServer(
      {
        key: fs.readFileSync(new URL("./certs/server.key", import.meta.url)),
        cert: fs.readFileSync(new URL("./certs/server.pem", import.meta.url)),
      },
      handle,
    )
    .listen(HTTPS_PORT, () =>
      console.log(`sql proxy (https) on :${HTTPS_PORT}`),
    );
}
