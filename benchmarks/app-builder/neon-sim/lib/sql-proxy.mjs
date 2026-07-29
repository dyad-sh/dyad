// SQL proxy speaking the @neondatabase/serverless fetch protocol (POST /sql)
// against local Postgres. Ported verbatim from the validated S-SQL spike
// (spikes/s-sql/proxy.mjs — see its header for the protocol notes), with two
// changes: (1) pools connect as the user in the Neon-Connection-String rather
// than a fixed user, (2) an onStatement callback feeds the diagnostic ledger.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import pg from "pg";

const { Pool, DatabaseError } = pg;

const STRICT = process.env.STRICT_SINGLE_STATEMENT === "1";
const RAW_TYPES = { getTypeParser: () => (v) => v };

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

const ISOLATION_SQL = {
  ReadUncommitted: "READ UNCOMMITTED",
  ReadCommitted: "READ COMMITTED",
  RepeatableRead: "REPEATABLE READ",
  Serializable: "SERIALIZABLE",
};

export function createSqlProxy({
  pgHost = "127.0.0.1",
  pgPort = 5432,
  certsDir,
  httpPort = 7790,
  httpsPort = 443,
  onStatement = () => {},
} = {}) {
  const pools = new Map();
  function poolFor(user, password, database) {
    const key = `${user}@${database}`;
    if (!pools.has(key)) {
      pools.set(
        key,
        new Pool({
          host: pgHost,
          port: pgPort,
          user,
          password,
          database,
          max: 5,
        }),
      );
    }
    return pools.get(key);
  }

  async function runSingle(client, q) {
    const hasParams = Array.isArray(q.params) && q.params.length > 0;
    const cfg = { text: q.query, rowMode: "array", types: RAW_TYPES };
    if (hasParams || STRICT) cfg.values = q.params ?? [];
    const result = await client.query(cfg);
    return toNeonResult(
      Array.isArray(result) ? result[result.length - 1] : result,
    );
  }

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
    let database, user, password;
    try {
      const u = new URL(req.headers["neon-connection-string"]);
      database = decodeURIComponent(u.pathname.slice(1));
      user = decodeURIComponent(u.username);
      password = decodeURIComponent(u.password);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ message: "missing/invalid Neon-Connection-String" }),
      );
      return;
    }

    const pool = poolFor(user, password, database);
    const statements = Array.isArray(payload.queries)
      ? payload.queries.map((q) => q.query)
      : [payload.query];
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
      onStatement({ database, statements, ok: true });
    } catch (err) {
      onStatement({ database, statements, ok: false, error: err.message });
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify(errorBody(err)));
    }
  }

  const servers = [];
  const httpServer = http.createServer(handle);
  httpServer.listen(httpPort);
  servers.push(httpServer);
  if (httpsPort !== null) {
    const httpsServer = https.createServer(
      {
        key: fs.readFileSync(`${certsDir}/server.key`),
        cert: fs.readFileSync(`${certsDir}/server.pem`),
      },
      handle,
    );
    httpsServer.listen(httpsPort);
    servers.push(httpsServer);
  }

  return {
    async closePoolsForDb(dbName) {
      for (const [key, pool] of pools) {
        if (key.endsWith(`@${dbName}`)) {
          await pool.end().catch(() => {});
          pools.delete(key);
        }
      }
    },
    async close() {
      for (const [, pool] of pools) await pool.end().catch(() => {});
      pools.clear();
      for (const s of servers) s.close();
    },
  };
}
