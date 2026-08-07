// Neon v2 control-plane shim. Endpoint surface mirrors Dyad's in-process E2E
// mock (src/neon_admin/neon_management_client.ts:113-359) — the set of
// @neondatabase/api-client calls Dyad actually makes — served over HTTP so the
// REAL api-client (axios) works against it. Any Bearer token is accepted.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  state,
  newProject,
  newBranch,
  findProject,
  createDatabase,
  dropDatabase,
  listSimDatabases,
  connectionUriFor,
  branchWire,
  ensureSimRole,
  adminPool,
} from "./state.mjs";
import {
  getAuthMount,
  findMountByPath,
  closeMountsForDb,
  closeAllMounts,
} from "./auth-mounts.mjs";

const DEFAULT_EMAIL_PASSWORD_CONFIG = {
  enabled: true,
  email_verification_method: "otp",
  require_email_verification: false,
  auto_sign_in_after_verification: true,
  send_verification_email_on_sign_up: false,
  send_verification_email_on_sign_in: false,
  disable_sign_up: false,
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function createControlPlane({ port = 7788, ledgerDir, sqlProxy }) {
  const dbToProject = new Map(); // dbName -> projectId (for the ledger)

  function ledgerAppend(dbName, entry) {
    const projectId = dbToProject.get(dbName) ?? "unknown";
    fs.appendFileSync(
      path.join(ledgerDir, `${projectId}.jsonl`),
      JSON.stringify({ ts: new Date().toISOString(), db: dbName, ...entry }) +
        "\n",
    );
  }

  const authBaseUrl = (pid, bid) =>
    `http://127.0.0.1:${port}/authsvc/${pid}/${bid}`;

  async function mountAuth(project, branch) {
    await getAuthMount({
      projectId: project.id,
      branchId: branch.id,
      dbName: branch.db,
      baseUrl: authBaseUrl(project.id, branch.id),
    });
    if (!project.auth.has(branch.id)) {
      project.auth.set(branch.id, { createdAt: new Date().toISOString() });
    }
  }

  const neonAuthWire = (project, branch) => ({
    auth_provider: "better_auth",
    auth_provider_project_id: `sim-auth-${project.id}`,
    branch_id: branch.id,
    db_name: branch.db,
    created_at: project.auth.get(branch.id)?.createdAt,
    owned_by: "neon",
    jwks_url: `${authBaseUrl(project.id, branch.id)}/jwks`,
    base_url: authBaseUrl(project.id, branch.id),
  });

  async function handleApi(req, res, url) {
    const p = url.pathname.replace(/^\/api\/v2/, "");
    const seg = p.split("/").filter(Boolean);
    const method = req.method;

    // GET /users/me/organizations
    if (method === "GET" && p === "/users/me/organizations") {
      return json(res, 200, {
        organizations: [{ id: "sim-org", name: "Sim Organization" }],
      });
    }

    // /projects and below
    if (seg[0] !== "projects") return json(res, 404, { message: "not found" });

    // GET|POST /projects
    if (seg.length === 1) {
      if (method === "GET") {
        return json(res, 200, {
          projects: [...state.projects.values()].map(
            ({ branches: _b, auth: _a, emailPasswordConfig: _e, ...w }) => w,
          ),
        });
      }
      if (method === "POST") {
        const body = await readBody(req);
        const project = newProject(
          body.project?.name ?? "unnamed",
          body.project?.org_id,
        );
        const main = newBranch(project, { name: "main", isDefault: true });
        await createDatabase(main.db);
        dbToProject.set(main.db, project.id);
        return json(res, 201, {
          project: {
            id: project.id,
            name: project.name,
            org_id: project.org_id,
            region_id: project.region_id,
            created_at: project.created_at,
            updated_at: project.updated_at,
          },
          branch: branchWire(main),
          connection_uris: [{ connection_uri: connectionUriFor(main.db) }],
        });
      }
    }

    const project = findProject(seg[1]);
    if (!project) return json(res, 404, { message: "project not found" });

    // /projects/{pid}
    if (seg.length === 2) {
      if (method === "GET") {
        const {
          branches: _b,
          auth: _a,
          emailPasswordConfig: _e,
          ...w
        } = project;
        return json(res, 200, { project: w });
      }
      if (method === "DELETE") {
        for (const branch of project.branches.values()) {
          await closeMountsForDb(branch.db);
          await sqlProxy.closePoolsForDb(branch.db);
          await dropDatabase(branch.db);
          dbToProject.delete(branch.db);
        }
        state.projects.delete(project.id);
        return json(res, 200, { project: { id: project.id } });
      }
    }

    // GET /projects/{pid}/connection_uri
    if (seg.length === 3 && seg[2] === "connection_uri" && method === "GET") {
      const branchId = url.searchParams.get("branch_id");
      const branch = project.branches.get(branchId);
      if (!branch) return json(res, 404, { message: "branch not found" });
      const dbName = url.searchParams.get("database_name") || branch.db;
      return json(res, 200, { uri: connectionUriFor(dbName) });
    }

    // /projects/{pid}/branches...
    if (seg[2] !== "branches") return json(res, 404, { message: "not found" });

    if (seg.length === 3) {
      if (method === "GET") {
        return json(res, 200, {
          branches: [...project.branches.values()].map(branchWire),
        });
      }
      if (method === "POST") {
        const body = await readBody(req);
        const name = body.branch?.name ?? "child";
        const parentId = body.branch?.parent_id;
        const parent = parentId ? project.branches.get(parentId) : null;
        if (parentId && !parent)
          return json(res, 404, { message: "parent branch not found" });
        const branch = newBranch(project, { name, parentId });
        if (parent) {
          // Template copy = branch semantics. Sources must be connection-free.
          await closeMountsForDb(parent.db);
          await sqlProxy.closePoolsForDb(parent.db);
          await createDatabase(branch.db, { template: parent.db });
          // Remount parent auth if it had been provisioned (its pool was closed).
          if (project.auth.has(parent.id)) await mountAuth(project, parent);
        } else {
          await createDatabase(branch.db);
        }
        dbToProject.set(branch.db, project.id);
        return json(res, 201, {
          branch: branchWire(branch),
          connection_uris: [{ connection_uri: connectionUriFor(branch.db) }],
        });
      }
    }

    const branch = project.branches.get(seg[3]);
    if (!branch) return json(res, 404, { message: "branch not found" });

    if (seg.length === 4) {
      if (method === "GET")
        return json(res, 200, { branch: branchWire(branch) });
      if (method === "DELETE") {
        await closeMountsForDb(branch.db);
        await sqlProxy.closePoolsForDb(branch.db);
        await dropDatabase(branch.db);
        dbToProject.delete(branch.db);
        project.branches.delete(branch.id);
        project.auth.delete(branch.id);
        return json(res, 200, {
          branch: { id: branch.id, project_id: project.id },
        });
      }
    }

    const leaf = seg[4];

    if (leaf === "databases" && method === "GET") {
      return json(res, 200, { databases: [{ name: branch.db }] });
    }
    if (leaf === "roles" && method === "GET") {
      return json(res, 200, { roles: [{ name: "simuser", protected: false }] });
    }

    if (leaf === "auth" && seg.length === 5) {
      if (method === "GET") {
        if (!project.auth.has(branch.id))
          return json(res, 404, { message: "neon auth not enabled" });
        return json(res, 200, neonAuthWire(project, branch));
      }
      if (method === "POST") {
        await mountAuth(project, branch);
        return json(res, 201, {
          ...neonAuthWire(project, branch),
          pub_client_key: "sim-pub-key",
          secret_server_key: "sim-secret-key",
          schema_name: "neon_auth",
          table_name: "users",
        });
      }
    }

    if (leaf === "auth" && seg[5] === "domains") {
      if (method === "GET") return json(res, 200, { domains: [] });
      if (method === "POST") return json(res, 200, {});
    }

    if (leaf === "auth" && seg[5] === "email_and_password") {
      const existing =
        project.emailPasswordConfig.get(branch.id) ??
        DEFAULT_EMAIL_PASSWORD_CONFIG;
      if (method === "GET") return json(res, 200, existing);
      if (method === "PATCH") {
        const body = await readBody(req);
        const merged = { ...existing, ...body };
        project.emailPasswordConfig.set(branch.id, merged);
        return json(res, 200, merged);
      }
    }

    return json(res, 404, { message: "not found" });
  }

  async function handleSim(req, res, url) {
    const op = url.pathname.replace(/^\/__sim\//, "");
    if (op === "state" && req.method === "GET") {
      return json(res, 200, {
        projects: [...state.projects.values()].map((p) => ({
          id: p.id,
          name: p.name,
          branches: [...p.branches.values()],
          auth: [...p.auth.keys()],
        })),
        snapshots: [...state.snapshots.entries()],
        databases: await listSimDatabases(),
      });
    }
    if (req.method !== "POST") return json(res, 404, { message: "not found" });
    const body = await readBody(req);
    // 59, not 50: Postgres truncates identifiers at 63 bytes, and "sim_" eats
    // four of them. The old cap of 50 was arbitrary and rejected any cell whose
    // model name was long — deepseek-v4-flash-0731 produced a 60-char body and
    // failed a full milestone's work at the snapshot step, after the model
    // spend had already been incurred.
    const validLabel = (l) => /^sim_[a-z0-9_]{1,59}$/.test(l ?? "");

    if (op === "snapshot") {
      const project = findProject(body.projectId);
      const branch = project?.branches.get(body.branchId);
      if (!branch) return json(res, 404, { message: "branch not found" });
      if (!validLabel(body.label))
        return json(res, 400, {
          message: `label must match ^sim_[a-z0-9_]{1,59}$ (got ${JSON.stringify(body.label)}, length ${(body.label ?? "").length}) — 59 is the Postgres 63-byte identifier limit minus the "sim_" prefix`,
        });
      await closeMountsForDb(branch.db);
      await sqlProxy.closePoolsForDb(branch.db);
      await createDatabase(body.label, { template: branch.db });
      if (project.auth.has(branch.id)) await mountAuth(project, branch);
      state.snapshots.set(body.label, {
        projectId: project.id,
        branchId: branch.id,
        sourceDb: branch.db,
        createdAt: new Date().toISOString(),
      });
      return json(res, 200, { snapshot: body.label });
    }

    if (op === "clone") {
      if (!state.snapshots.has(body.snapshot)) {
        // Snapshots are durable Postgres databases; the in-memory registry
        // dies with each sim instance. Recognize any existing sim_* database
        // so scoring works across sim restarts (observed: an entire scoring
        // phase silently cloned nothing because the registry was empty).
        const durable =
          validLabel(body.snapshot) &&
          (await listSimDatabases()).includes(body.snapshot);
        if (!durable) return json(res, 404, { message: "snapshot not found" });
        state.snapshots.set(body.snapshot, {
          projectId: "recovered",
          branchId: "recovered",
          sourceDb: body.snapshot,
          createdAt: new Date().toISOString(),
        });
      }
      if (!validLabel(body.label))
        return json(res, 400, {
          message: `label must match ^sim_[a-z0-9_]{1,59}$ (got ${JSON.stringify(body.label)}, length ${(body.label ?? "").length}) — 59 is the Postgres 63-byte identifier limit minus the "sim_" prefix`,
        });
      await createDatabase(body.label, { template: body.snapshot });
      // Mount better-auth over the clone's neon_auth schema so scoring runs
      // can sign up/sign in against the cloned checkpoint database.
      await getAuthMount({
        projectId: "clone",
        branchId: body.label,
        dbName: body.label,
        baseUrl: authBaseUrl("clone", body.label),
      });
      return json(res, 200, {
        clone: body.label,
        connection_uri: connectionUriFor(body.label),
        auth_base_url: authBaseUrl("clone", body.label),
      });
    }

    if (op === "reset") {
      await closeAllMounts();
      for (const db of await listSimDatabases()) {
        await sqlProxy.closePoolsForDb(db);
        await dropDatabase(db);
      }
      state.projects.clear();
      state.snapshots.clear();
      dbToProject.clear();
      return json(res, 200, { reset: true });
    }

    return json(res, 404, { message: "not found" });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith("/api/v2/"))
        return await handleApi(req, res, url);
      if (url.pathname.startsWith("/authsvc/")) {
        const mount = findMountByPath(url.pathname);
        if (!mount) return json(res, 404, { message: "auth mount not found" });
        return mount.handler(req, res);
      }
      if (url.pathname.startsWith("/__sim/"))
        return await handleSim(req, res, url);
      if (url.pathname === "/healthz") {
        res.writeHead(200);
        return res.end("ok");
      }
      return json(res, 404, { message: "not found" });
    } catch (err) {
      console.error("[neon-sim] handler error:", err);
      return json(res, 500, { message: err.message });
    }
  });

  return {
    async start() {
      await ensureSimRole();
      fs.mkdirSync(ledgerDir, { recursive: true });
      await new Promise((resolve) => server.listen(port, resolve));
    },
    ledgerAppend,
    async close() {
      await closeAllMounts();
      await adminPool.end().catch(() => {});
      server.close();
    },
  };
}
