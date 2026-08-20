import type { Express, Request, Response } from "express";

/**
 * A Coolify instance, enough of one to deploy against.
 *
 * Unlike the GitHub mock beside it, nothing in production needs redirecting
 * here: the instance URL is typed in by the user, so a test points Dyad at
 * this by filling the connection form. The only build-time seam it relies on
 * is the one every e2e test already uses for the app's user data directory,
 * which is where deploy keys are written.
 *
 * State lives per server instance so parallel workers cannot see each other's
 * applications.
 */

interface FakeApplication {
  uuid: string;
  name: string;
  server_uuid: string;
  project_uuid: string;
  domains: string | null;
  fqdn: string | null;
  build_pack: string;
  ports_exposes: string;
  start_command?: string;
  private_key_id: number | null;
  envs: Record<string, string>;
}

interface FakeKey {
  uuid: string;
  id: number;
  name: string;
  private_key: string;
}

/** What a deployment reports on each successive poll. */
type DeploymentScript = string[];

export interface FakeCoolifyState {
  servers: Array<{ uuid: string; name: string; ip: string }>;
  projects: Array<{ uuid: string; name: string }>;
  keys: FakeKey[];
  applications: Map<string, FakeApplication>;
  deployments: Map<string, { remaining: DeploymentScript; last: string }>;
  /** Statuses each new deployment walks through, oldest first. */
  deploymentScript: DeploymentScript;
}

function initialState(): FakeCoolifyState {
  return {
    servers: [{ uuid: "srv-1", name: "production", ip: "203.0.113.10" }],
    projects: [{ uuid: "prj-1", name: "demo-project" }],
    keys: [],
    applications: new Map(),
    deployments: new Map(),
    // One poll and done, so a spec that only cares about the outcome does not
    // sit through the pipeline's five-second interval more than once.
    deploymentScript: ["finished"],
  };
}

export function registerFakeCoolify(app: Express): void {
  let state = initialState();
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  /** Coolify answers everything with 401 when the token is not accepted. */
  const authed = (req: Request, res: Response): boolean => {
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      res.status(401).json({ message: "Unauthenticated." });
      return false;
    }
    return true;
  };

  const base = "/coolify/api/v1";

  // The same API at the root of the host too: an installed Coolify lives
  // there, while a pasted URL points at the /coolify mount. Rewritten rather
  // than registered twice, which would drift.
  app.use((req, _res, next) => {
    if (req.url.startsWith("/api/v1")) req.url = `/coolify${req.url}`;
    next();
  });

  // Lets a spec choose the shape of the run before it starts. Named fields
  // rather than a spread, which would also let a caller replace the Maps.
  app.post("/coolify/test/reset", (req, res) => {
    state = initialState();
    if (Array.isArray(req.body?.servers)) state.servers = req.body.servers;
    if (Array.isArray(req.body?.projects)) state.projects = req.body.projects;
    if (Array.isArray(req.body?.deploymentScript)) {
      state.deploymentScript = req.body.deploymentScript;
    }
    res.json({ ok: true });
  });

  app.get("/coolify/test/applications", (_req, res) => {
    res.json([...state.applications.values()]);
  });

  app.get(`${base}/servers`, (req, res) => {
    if (!authed(req, res)) return;
    res.json(state.servers);
  });

  app.get(`${base}/projects`, (req, res) => {
    if (!authed(req, res)) return;
    res.json(state.projects);
  });

  app.post(`${base}/projects`, (req, res) => {
    if (!authed(req, res)) return;
    const project = { uuid: id("prj"), name: String(req.body?.name ?? "") };
    state.projects.push(project);
    res.json(project);
  });

  app.get(`${base}/security/keys`, (req, res) => {
    if (!authed(req, res)) return;
    // The private half is echoed back the way an instance with
    // read:sensitive would, so a spec can assert what Dyad uploaded.
    res.json(state.keys);
  });

  app.post(`${base}/security/keys`, (req, res) => {
    if (!authed(req, res)) return;
    const key: FakeKey = {
      uuid: id("key"),
      id: nextId++,
      name: String(req.body?.name ?? ""),
      private_key: String(req.body?.private_key ?? ""),
    };
    state.keys.push(key);
    res.json({ uuid: key.uuid });
  });

  app.post(`${base}/applications/private-deploy-key`, (req, res) => {
    if (!authed(req, res)) return;
    const uuid = id("app");
    // Resolved, not guessed: the pipeline compares this against the key it
    // registered to decide whether a stored application still clones with the
    // right one. An id that never matches makes every redeploy look stale and
    // hides the reuse path entirely.
    const keyId =
      state.keys.find((k) => k.uuid === req.body?.private_key_uuid)?.id ?? null;
    const address = req.body?.domains
      ? String(req.body.domains)
      : req.body?.autogenerate_domain
        ? `http://${uuid}.203.0.113.10.sslip.io`
        : null;
    state.applications.set(uuid, {
      uuid,
      name: String(req.body?.name ?? ""),
      server_uuid: String(req.body?.server_uuid ?? ""),
      project_uuid: String(req.body?.project_uuid ?? ""),
      // Coolify generates an sslip.io address when asked to, which is what
      // an app deployed without a domain gets. Reported as fqdn as well as
      // domains, because fqdn is the field the deploy reads to learn where
      // the app ended up — without it no address is ever recorded.
      domains: address,
      fqdn: address,
      build_pack: String(req.body?.build_pack ?? ""),
      ports_exposes: String(req.body?.ports_exposes ?? ""),
      start_command: req.body?.start_command,
      private_key_id: keyId,
      envs: {},
    });
    res.json({ uuid });
  });

  app.get(`${base}/applications/:uuid`, (req, res) => {
    if (!authed(req, res)) return;
    const found = state.applications.get(req.params.uuid);
    if (!found) {
      res.status(404).json({ message: "Application not found." });
      return;
    }
    res.json(found);
  });

  app.patch(`${base}/applications/:uuid`, (req, res) => {
    if (!authed(req, res)) return;
    const found = state.applications.get(req.params.uuid);
    if (!found) {
      res.status(404).json({ message: "Application not found." });
      return;
    }
    Object.assign(found, req.body ?? {});
    res.json({ uuid: found.uuid });
  });

  app.delete(`${base}/applications/:uuid`, (req, res) => {
    if (!authed(req, res)) return;
    state.applications.delete(req.params.uuid);
    res.json({ ok: true });
  });

  app.post(`${base}/applications/:uuid/envs`, (req, res) => {
    if (!authed(req, res)) return;
    const found = state.applications.get(req.params.uuid);
    if (!found) {
      res.status(404).json({ message: "Application not found." });
      return;
    }
    found.envs[String(req.body?.key ?? "")] = String(req.body?.value ?? "");
    res.json({ ok: true });
  });

  // The client falls back to this when POSTing an existing variable 409s.
  app.patch(`${base}/applications/:uuid/envs`, (req, res) => {
    if (!authed(req, res)) return;
    const found = state.applications.get(req.params.uuid);
    if (!found) {
      res.status(404).json({ message: "Application not found." });
      return;
    }
    found.envs[String(req.body?.key ?? "")] = String(req.body?.value ?? "");
    res.json({ ok: true });
  });

  app.post(`${base}/applications/:uuid/start`, (req, res) => {
    if (!authed(req, res)) return;
    const deploymentUuid = id("dep");
    state.deployments.set(deploymentUuid, {
      remaining: [...state.deploymentScript],
      last: "queued",
    });
    res.json({ deployment_uuid: deploymentUuid });
  });

  app.get(`${base}/deployments/:uuid`, (req, res) => {
    if (!authed(req, res)) return;
    const deployment = state.deployments.get(req.params.uuid);
    if (!deployment) {
      res.status(404).json({ message: "Deployment not found." });
      return;
    }
    // Each poll advances one step and then holds, so a script shorter than
    // the number of polls still settles rather than looping.
    if (deployment.remaining.length > 0) {
      deployment.last = deployment.remaining.shift()!;
    }
    res.json({
      status: deployment.last,
      logs:
        deployment.last === "failed"
          ? JSON.stringify([{ output: "npm ERR! build failed" }])
          : JSON.stringify([{ output: "Build finished" }]),
    });
  });
}
