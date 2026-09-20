import type { Express, Request, Response } from "express";

/**
 * Enough of the Cloudflare API to set up a Worker deployment against.
 *
 * Dyad is pointed here by the same build-time redirect the GitHub mock uses:
 * Cloudflare's API host is fixed, so unlike a self-hosted service there is no
 * address for a test to type in.
 *
 * State lives per server instance so parallel workers cannot see each other's
 * Workers.
 */

interface FakeWorker {
  name: string;
  tag: string;
  routeEnabled: boolean;
}

interface FakeTrigger {
  trigger_uuid: string;
  external_script_id: string;
  [key: string]: unknown;
}

interface FakeBuild {
  build_uuid: string;
  status: string;
  build_outcome: string | null;
  created_on: string;
  external_script_id: string;
  build_trigger_metadata: { commit_hash: string };
}

interface State {
  /** Whether Cloudflare's GitHub App can read repositories. */
  hasGithubAccess: boolean;
  subdomain: string | null;
  workers: FakeWorker[];
  buildTokens: { build_token_uuid: string; cloudflare_token_id: string }[];
  triggers: FakeTrigger[];
  /** Build-time variables, by rule. */
  buildVariables: Record<string, Record<string, unknown>>;
  builds: FakeBuild[];
}

// In Cloudflare's format: Dyad refuses an account id in any other.
const ACCOUNT_ID = "fa4ec10df1a7e0000000000000000001";

function initialState(): State {
  return {
    hasGithubAccess: true,
    subdomain: "fake-subdomain",
    workers: [],
    buildTokens: [],
    triggers: [],
    buildVariables: {},
    builds: [],
  };
}

export function registerFakeCloudflare(app: Express): void {
  let state = initialState();
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  const ok = (res: Response, result: unknown) =>
    res.json({ success: true, errors: [], messages: [], result });
  const fail = (res: Response, status: number, code: number, message: string) =>
    res
      .status(status)
      .json({ success: false, errors: [{ code, message }], result: null });

  const authed = (req: Request, res: Response): boolean => {
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      fail(res, 401, 10000, "Authentication error");
      return false;
    }
    return true;
  };

  app.post("/cloudflare/test/reset", (req, res) => {
    state = initialState();
    if (typeof req.body?.hasGithubAccess === "boolean") {
      state.hasGithubAccess = req.body.hasGithubAccess;
    }
    res.json({ ok: true });
  });

  app.post("/cloudflare/test/grant-github-access", (_req, res) => {
    state.hasGithubAccess = true;
    res.json({ ok: true });
  });

  app.get("/cloudflare/test/state", (_req, res) => {
    res.json({
      workers: state.workers,
      triggers: state.triggers,
      buildVariables: state.buildVariables,
    });
  });

  const base = "/cloudflare/api";
  const account = `${base}/accounts/:accountId`;

  app.get(`${base}/user/tokens/verify`, (req, res) => {
    if (!authed(req, res)) return;
    ok(res, { id: "fake-token-id", status: "active" });
  });

  app.get(`${base}/accounts`, (req, res) => {
    if (!authed(req, res)) return;
    ok(res, [{ id: ACCOUNT_ID, name: "Fake Account" }]);
  });

  app.get(`${account}/workers/subdomain`, (req, res) => {
    if (!authed(req, res)) return;
    if (!state.subdomain) {
      return fail(res, 404, 10007, "You do not have a workers.dev subdomain.");
    }
    ok(res, { subdomain: state.subdomain });
  });

  app.get(`${account}/workers/scripts`, (req, res) => {
    if (!authed(req, res)) return;
    ok(
      res,
      state.workers.map((worker) => ({ id: worker.name, tag: worker.tag })),
    );
  });

  app.put(`${account}/workers/scripts/:name`, (req, res) => {
    if (!authed(req, res)) return;
    const worker = {
      name: req.params.name,
      tag: id("tag"),
      routeEnabled: false,
    };
    state.workers = state.workers.filter((w) => w.name !== worker.name);
    state.workers.push(worker);
    ok(res, { id: worker.name, tag: worker.tag });
  });

  app.delete(`${account}/workers/scripts/:name`, (req, res) => {
    if (!authed(req, res)) return;
    state.workers = state.workers.filter((w) => w.name !== req.params.name);
    ok(res, null);
  });

  app.post(`${account}/workers/scripts/:name/subdomain`, (req, res) => {
    if (!authed(req, res)) return;
    const worker = state.workers.find((w) => w.name === req.params.name);
    if (!worker) return fail(res, 404, 10007, "Worker not found");
    worker.routeEnabled = true;
    ok(res, { enabled: true, previews_enabled: true });
  });

  app.get(
    `${account}/builds/repos/:provider/:ownerId/:repoId/config_autofill`,
    (req, res) => {
      if (!authed(req, res)) return;
      if (!req.query.branch) {
        return fail(res, 400, 12013, "Invalid query parameter");
      }
      if (!state.hasGithubAccess) return fail(res, 404, 12000, "Not found");
      ok(res, { package_manager: "npm", scripts: {} });
    },
  );

  app.put(`${account}/builds/repos/connections`, (req, res) => {
    if (!authed(req, res)) return;
    ok(res, {
      repo_connection_uuid: `connection-${req.body.repo_id}`,
      repo_id: req.body.repo_id,
      repo_name: req.body.repo_name,
    });
  });

  app.get(`${account}/builds/tokens`, (req, res) => {
    if (!authed(req, res)) return;
    ok(res, state.buildTokens);
  });

  app.post(`${account}/builds/tokens`, (req, res) => {
    if (!authed(req, res)) return;
    const token = {
      build_token_uuid: id("build-token"),
      cloudflare_token_id: String(req.body.cloudflare_token_id),
    };
    state.buildTokens.push(token);
    ok(res, token);
  });

  app.get(`${account}/builds/workers/:tag/triggers`, (req, res) => {
    if (!authed(req, res)) return;
    ok(
      res,
      state.triggers.filter((t) => t.external_script_id === req.params.tag),
    );
  });

  app.post(`${account}/builds/triggers`, (req, res) => {
    if (!authed(req, res)) return;
    // The real API refuses a rule that names no deploy credential.
    if (!req.body?.build_token_uuid) {
      return fail(res, 400, 12002, "Invalid request body");
    }
    // As Cloudflare does: one rule for named branches and one preview rule
    // per Worker, and a 409 for another of either kind.
    const isPreview = (rule: { branch_includes?: string[] }) =>
      (rule.branch_includes ?? []).includes("*");
    const clash = state.triggers.some(
      (existing) =>
        existing.external_script_id === req.body.external_script_id &&
        isPreview(existing as { branch_includes?: string[] }) ===
          isPreview(req.body),
    );
    if (clash) {
      return fail(
        res,
        409,
        12042,
        "A trigger already exists for this configuration",
      );
    }
    const trigger = { ...req.body, trigger_uuid: id("trigger") } as FakeTrigger;
    state.triggers.push(trigger);
    ok(res, trigger);
  });

  app.patch(
    `${account}/builds/triggers/:uuid/environment_variables`,
    (req, res) => {
      if (!authed(req, res)) return;
      const { uuid } = req.params;
      if (!state.triggers.some((t) => t.trigger_uuid === uuid)) {
        return fail(res, 404, 12000, "Not found");
      }
      state.buildVariables[uuid] = {
        ...state.buildVariables[uuid],
        ...req.body,
      };
      ok(res, state.buildVariables[uuid]);
    },
  );

  app.patch(`${account}/builds/triggers/:uuid`, (req, res) => {
    if (!authed(req, res)) return;
    const trigger = state.triggers.find(
      (t) => t.trigger_uuid === req.params.uuid,
    );
    if (!trigger) return fail(res, 404, 12000, "Not found");
    Object.assign(trigger, req.body);
    ok(res, trigger);
  });

  app.delete(`${account}/builds/triggers/:uuid`, (req, res) => {
    if (!authed(req, res)) return;
    const before = state.triggers.length;
    state.triggers = state.triggers.filter(
      (t) => t.trigger_uuid !== req.params.uuid,
    );
    if (state.triggers.length === before) {
      return fail(res, 404, 12000, "Not found");
    }
    ok(res, null);
  });

  // A build finishes the moment it is started: what a spec watches for is the
  // status reaching the card, not the time a real build takes.
  app.post(`${account}/builds/triggers/:uuid/builds`, (req, res) => {
    if (!authed(req, res)) return;
    const trigger = state.triggers.find(
      (t) => t.trigger_uuid === req.params.uuid,
    );
    if (!trigger) return fail(res, 404, 12000, "Not found");
    const build: FakeBuild = {
      build_uuid: id("build"),
      status: "stopped",
      build_outcome: "success",
      created_on: new Date().toISOString(),
      external_script_id: trigger.external_script_id,
      build_trigger_metadata: { commit_hash: "fa4ec0ffee0000" },
    };
    state.builds.push(build);
    ok(res, build);
  });

  app.get(`${account}/builds/workers/:tag/builds`, (req, res) => {
    if (!authed(req, res)) return;
    ok(
      res,
      state.builds.filter((b) => b.external_script_id === req.params.tag),
    );
  });

  app.get(`${account}/builds/builds/:uuid/logs`, (req, res) => {
    if (!authed(req, res)) return;
    ok(res, { lines: [] });
  });
}
