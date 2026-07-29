// neon-sim state: project/branch registry (in-memory) + Postgres admin ops.
import crypto from "node:crypto";
import pg from "pg";

const PG_HOST = process.env.SIM_PG_HOST ?? "127.0.0.1";
const PG_PORT = Number(process.env.SIM_PG_PORT ?? 5432);
const PG_ADMIN_USER = process.env.SIM_PG_ADMIN_USER ?? "mini";

export const SIM_ROLE = "simuser";
export const SIM_ROLE_PASSWORD = "simpass";
// URI host per the S-SQL spike verdict: the serverless driver rewrites the
// first host label to "api." and always fetches https://api.localtest.me/sql
// (port in the URI is ignored); TCP pg clients honor :5433 (pg-tls-front).
export const URI_HOST = "db.localtest.me";
export const URI_PORT = 5433;

export const adminPool = new pg.Pool({
  host: PG_HOST,
  port: PG_PORT,
  user: PG_ADMIN_USER,
  database: "postgres",
  max: 3,
});

const ident = (name) => {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `"${name}"`;
};

export async function ensureSimRole() {
  const { rows } = await adminPool.query(
    "SELECT 1 FROM pg_roles WHERE rolname = $1",
    [SIM_ROLE],
  );
  if (rows.length === 0) {
    await adminPool.query(
      `CREATE ROLE ${ident(SIM_ROLE)} LOGIN PASSWORD '${SIM_ROLE_PASSWORD}' CREATEDB`,
    );
  }
}

export async function terminateConnections(dbName) {
  await adminPool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  );
}

export async function createDatabase(dbName, { template } = {}) {
  if (template) {
    await terminateConnections(template);
    await adminPool.query(
      `CREATE DATABASE ${ident(dbName)} OWNER ${ident(SIM_ROLE)} TEMPLATE ${ident(template)}`,
    );
  } else {
    await adminPool.query(
      `CREATE DATABASE ${ident(dbName)} OWNER ${ident(SIM_ROLE)}`,
    );
  }
}

export async function dropDatabase(dbName) {
  await terminateConnections(dbName);
  await adminPool.query(`DROP DATABASE IF EXISTS ${ident(dbName)}`);
}

export async function listSimDatabases() {
  const { rows } = await adminPool.query(
    `SELECT datname FROM pg_database WHERE datname LIKE 'sim\\_%'`,
  );
  return rows.map((r) => r.datname);
}

// ---------------------------------------------------------------------------
// Registry

const now = () => new Date().toISOString();

export const state = {
  projects: new Map(), // projectId -> project record
  snapshots: new Map(), // label -> { projectId, branchId, sourceDb, createdAt }
};

export function newProject(name, orgId) {
  const pid = `simproj-${crypto.randomBytes(4).toString("hex")}`;
  const project = {
    id: pid,
    name,
    org_id: orgId ?? "sim-org",
    region_id: "sim-local-1",
    platform_id: "sim",
    created_at: now(),
    updated_at: now(),
    branches: new Map(), // branchId -> branch record
    auth: new Map(), // branchId -> { createdAt }
    emailPasswordConfig: new Map(), // branchId -> config
  };
  state.projects.set(pid, project);
  return project;
}

export function newBranch(project, { name, parentId, isDefault }) {
  const short = crypto.randomBytes(3).toString("hex");
  const bid = `br-${name}-${short}`;
  const dbName = `sim_${project.id.replace("simproj-", "")}_${name}_${short}`;
  const branch = {
    id: bid,
    name,
    project_id: project.id,
    parent_id: parentId,
    default: Boolean(isDefault),
    db: dbName,
    created_at: now(),
    updated_at: now(),
  };
  project.branches.set(bid, branch);
  return branch;
}

export function findProject(pid) {
  return state.projects.get(pid);
}

export function connectionUriFor(dbName) {
  return `postgresql://${SIM_ROLE}:${SIM_ROLE_PASSWORD}@${URI_HOST}:${URI_PORT}/${dbName}?sslmode=require`;
}

export function branchWire(branch) {
  const { db: _db, ...wire } = branch;
  return wire;
}
