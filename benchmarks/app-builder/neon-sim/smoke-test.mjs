// neon-sim end-to-end smoke test. Run with the stack up:
//   node server.mjs &
//   NODE_EXTRA_CA_CERTS=certs/ca.pem node smoke-test.mjs
// Mirrors Dyad's real call sequence (neon_handlers.ts create flow) using the
// REAL @neondatabase/api-client and @neondatabase/serverless packages.
import { createApiClient } from "@neondatabase/api-client";
import { neon } from "@neondatabase/serverless";
import pg from "pg";

if (!process.env.NODE_EXTRA_CA_CERTS) {
  console.error("Run with NODE_EXTRA_CA_CERTS=certs/ca.pem");
  process.exit(2);
}

const CONTROL = "http://127.0.0.1:7788";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const api = createApiClient({
  apiKey: "any-token-works",
  baseURL: `${CONTROL}/api/v2`,
});

// (a) Dyad's create flow: project -> auth(main) -> dev branch -> auth(dev)
//     -> preview branch -> auth(preview)
const orgs = await api.getCurrentUserOrganizations();
check("orgs", orgs.data.organizations?.[0]?.id === "sim-org");

const created = await api.createProject({
  project: { name: "smoke", org_id: orgs.data.organizations[0].id },
});
const project = created.data.project;
const main = created.data.branch;
check(
  "createProject",
  Boolean(project?.id && main?.id && main.default) &&
    created.data.connection_uris?.[0]?.connection_uri?.includes(
      "db.localtest.me:5433",
    ),
);

// getNeonAuth must 404 before provisioning (ensureNeonAuth relies on this)
let sawAuth404 = false;
try {
  await api.getNeonAuth(project.id, main.id);
} catch (e) {
  sawAuth404 = e.response?.status === 404;
}
check("getNeonAuth-404-before-create", sawAuth404);

const authMain = await api.createNeonAuth(project.id, main.id, {
  auth_provider: "better_auth",
});
check(
  "createNeonAuth-main",
  authMain.data.base_url?.startsWith(`${CONTROL}/authsvc/`) &&
    authMain.data.schema_name === "neon_auth",
);

const dev = await api.createProjectBranch(project.id, {
  endpoints: [{ type: "read_write" }],
  branch: { name: "development", parent_id: main.id },
});
check(
  "createBranch-development",
  Boolean(dev.data.branch?.id) &&
    dev.data.connection_uris?.length > 0 &&
    dev.data.branch.parent_id === main.id,
);
const devBranch = dev.data.branch;
const authDev = await api.createNeonAuth(project.id, devBranch.id, {
  auth_provider: "better_auth",
});

const preview = await api.createProjectBranch(project.id, {
  endpoints: [{ type: "read_write" }],
  branch: { name: "preview", parent_id: devBranch.id },
});
check("createBranch-preview", Boolean(preview.data.branch?.id));
await api.createNeonAuth(project.id, preview.data.branch.id, {
  auth_provider: "better_auth",
});

const branches = await api.listProjectBranches({ projectId: project.id });
check(
  "topology-main-dev-preview",
  branches.data.branches.length === 3 &&
    ["main", "development", "preview"].every((n) =>
      branches.data.branches.some((b) => b.name === n),
    ),
);

const dbs = await api.listProjectBranchDatabases(project.id, devBranch.id);
const roles = await api.listProjectBranchRoles(project.id, devBranch.id);
const uriResp = await api.getConnectionUri({
  projectId: project.id,
  branch_id: devBranch.id,
  database_name: dbs.data.databases[0].name,
  role_name: roles.data.roles[0].name,
});
const devUri = uriResp.data.uri;
check(
  "getConnectionUri",
  devUri.startsWith("postgresql://simuser:simpass@db.localtest.me:5433/sim_"),
  devUri,
);

const epCfg = await api.getNeonAuthEmailAndPasswordConfig(
  project.id,
  devBranch.id,
);
check(
  "email-password-config",
  epCfg.data.enabled === true &&
    epCfg.data.require_email_verification === false,
);

// (b) real serverless driver against the dev URI (fetch path: 443 TLS)
const sql = neon(devUri);
await sql.query(
  "CREATE TABLE IF NOT EXISTS smoke_items (id serial primary key, label text)",
  [],
);
await sql.query("INSERT INTO smoke_items (label) VALUES ($1)", ["first"]);
const items = await sql`SELECT label FROM smoke_items ORDER BY id`;
check(
  "serverless-driver-crud",
  items.length === 1 && items[0].label === "first",
);

const [txa, txb] = await sql.transaction([
  sql`INSERT INTO smoke_items (label) VALUES ('tx1') RETURNING label`,
  sql`SELECT count(*)::int AS n FROM smoke_items`,
]);
check(
  "serverless-driver-transaction",
  txa[0].label === "tx1" && txb[0].n === 2,
);

// (c) auth: sign-up via the dev branch's better-auth mount, verify neon_auth rows
const authBase = authDev.data.base_url;
const email = `smoke-${Date.now()}@example.com`;
const signup = await fetch(`${authBase}/sign-up/email`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "http://localhost:3123",
  },
  body: JSON.stringify({ name: "Smoke", email, password: "Passw0rd!Sim1" }),
});
const setCookie = signup.headers.get("set-cookie") ?? "";
check(
  "auth-signup",
  signup.ok && setCookie.includes("__Secure-neon-auth.session_token"),
  `status=${signup.status}`,
);

const cookie = setCookie.split(";")[0];
const session = await fetch(`${authBase}/get-session`, {
  headers: { cookie, origin: "http://localhost:3123" },
});
const sessionBody = await session.json();
check("auth-get-session", session.ok && sessionBody?.user?.email === email);

const devDbName = new URL(devUri).pathname.slice(1);
const inspect = new pg.Pool({
  host: "127.0.0.1",
  port: 5432,
  user: "mini",
  database: devDbName,
  max: 1,
});
const userRows = await inspect.query(
  `SELECT email FROM neon_auth."user" WHERE email = $1`,
  [email],
);
const viewRows = await inspect.query(
  `SELECT email FROM neon_auth.users WHERE email = $1`,
  [email],
);
check(
  "auth-rows-in-branch-db-neon_auth-schema",
  userRows.rows.length === 1 && viewRows.rows.length === 1,
);
await inspect.end();

// (d) snapshot -> mutate -> clone -> clone lacks the mutation
const snap = await fetch(`${CONTROL}/__sim/snapshot`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    projectId: project.id,
    branchId: devBranch.id,
    label: "sim_snap_smoke",
  }),
});
check("snapshot", snap.ok);
await sql.query("INSERT INTO smoke_items (label) VALUES ('after-snap')", []);
const clone = await fetch(`${CONTROL}/__sim/clone`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    snapshot: "sim_snap_smoke",
    label: "sim_clone_smoke",
  }),
});
const cloneBody = await clone.json();
const cloneSql = neon(cloneBody.connection_uri);
const cloneItems = await cloneSql`SELECT label FROM smoke_items ORDER BY id`;
const liveItems = await sql`SELECT label FROM smoke_items ORDER BY id`;
check(
  "clone-is-point-in-time",
  clone.ok &&
    liveItems.some((r) => r.label === "after-snap") &&
    !cloneItems.some((r) => r.label === "after-snap") &&
    cloneItems.length === 2,
);

// (e) reset wipes everything
const reset = await fetch(`${CONTROL}/__sim/reset`, { method: "POST" });
const stateResp = await (await fetch(`${CONTROL}/__sim/state`)).json();
check(
  "reset",
  reset.ok &&
    stateResp.projects.length === 0 &&
    stateResp.databases.length === 0,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
