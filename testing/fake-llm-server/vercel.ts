import type { Express } from "express";

interface EnvironmentVariable {
  key: string;
  value: string;
  type: string;
  target: string[];
}

interface Project {
  id: string;
  name: string;
  framework: string | null;
  gitRepository: { type: string; repo: string };
  env: EnvironmentVariable[];
  envRevision: number;
}

type BuildState = "BUILDING" | "ERROR" | "READY";

interface Deployment {
  id: string;
  projectId: string;
  name: string;
  url: string;
  target: string;
  gitSource: { type: string; org: string; repo: string; ref: string };
  readyState: BuildState;
  createdAt: number;
  /** Capture what a build actually received, rather than the latest project env. */
  env: EnvironmentVariable[];
  envRevision: number;
}

export interface FakeVercelState {
  projects: Project[];
  deployments: Deployment[];
}

const TEAM_ID = "team_guided_deployment";
const USER_ID = "user_guided_deployment";

/** Test builds already redirect the Vercel SDK to this server. */
export function registerFakeVercel(app: Express): void {
  // Each Playwright worker owns a server. Reset only this instance's state.
  let state: FakeVercelState = { projects: [], deployments: [] };
  let nextId = 1;
  const base = "/vercel/api";
  const pagination = (count: number) => ({ count, next: null, prev: null });

  app.post("/vercel/test/reset", (_req, res) => {
    state = { projects: [], deployments: [] };
    nextId = 1;
    res.json({ ok: true });
  });
  app.get("/vercel/test/state", (_req, res) => res.json(state));
  app.post("/vercel/test/deployment-state", (req, res) => {
    const deployment = state.deployments.find((d) => d.id === req.body.id);
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }
    if (!["BUILDING", "ERROR", "READY"].includes(req.body.readyState)) {
      res.status(400).json({ error: "Unsupported deployment state" });
      return;
    }
    deployment.readyState = req.body.readyState;
    res.json({ ok: true });
  });

  app.use(base, (req, res, next) => {
    if (req.headers.authorization !== "Bearer fake-vercel-token") {
      res.status(401).json({
        error: { code: "unauthorized", message: "Invalid test token" },
      });
      return;
    }
    next();
  });
  app.get(`${base}/v2/user`, (_req, res) => {
    res.json({
      user: {
        id: USER_ID,
        username: "test-user",
        email: "test@example.com",
        name: "Test User",
        avatar: null,
        defaultTeamId: TEAM_ID,
        limited: true,
      },
    });
  });
  app.get(`${base}/v2/teams`, (_req, res) => {
    res.json({
      teams: [{ id: TEAM_ID, slug: "test-team", name: "Test Team" }],
    });
  });
  app.get(`${base}/v2/teams/:id`, (_req, res) => {
    res.json({ id: TEAM_ID, slug: "test-team", name: "Test Team" });
  });
  app.get(`${base}/v9/projects`, (req, res) => {
    res.json({
      projects: state.projects
        .filter((p) => !req.query.search || p.name === req.query.search)
        .map((project) => ({ ...project, accountId: TEAM_ID })),
    });
  });
  app.post(`${base}/v11/projects`, (req, res) => {
    const project: Project = {
      id: `prj_${nextId++}`,
      name: req.body.name,
      framework: req.body.framework ?? null,
      gitRepository: req.body.gitRepository,
      env: [],
      envRevision: 0,
    };
    state.projects.push(project);
    // The real SDK validates the response, including these resource fields.
    res.json({
      id: project.id,
      name: project.name,
      framework: project.framework,
      accountId: TEAM_ID,
      alias: [],
      directoryListing: false,
      nodeVersion: "22.x",
      defaultResourceConfig: { functionDefaultRegions: ["iad1"] },
      resourceConfig: { functionDefaultRegions: ["iad1"] },
      deploymentExpiration: {},
    });
  });
  app.get(`${base}/v9/projects/:id/domains`, (req, res) => {
    const project = state.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res
        .status(404)
        .json({ error: { code: "not_found", message: "Project not found" } });
      return;
    }
    res.json({
      domains: [
        {
          name: `${project.name}.vercel.app`,
          apexName: "vercel.app",
          projectId: project.id,
          verified: true,
        },
      ],
      pagination: pagination(1),
    });
  });
  app.post(`${base}/v10/projects/:id/env`, (req, res) => {
    const project = state.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res
        .status(404)
        .json({ error: { code: "not_found", message: "Project not found" } });
      return;
    }
    if (
      req.query.teamId !== TEAM_ID ||
      req.query.upsert !== "true" ||
      !Array.isArray(req.body)
    ) {
      res.status(400).json({
        error: {
          code: "bad_request",
          message: "Expected environment upsert for the linked team",
        },
      });
      return;
    }
    project.env = req.body;
    project.envRevision++;
    res.status(201).json({ created: [], failed: [] });
  });
  app.post(`${base}/v13/deployments`, (req, res) => {
    const project = state.projects.find((p) => p.id === req.body.project);
    if (!project) {
      res
        .status(404)
        .json({ error: { code: "not_found", message: "Project not found" } });
      return;
    }
    const id = `dpl_${nextId++}`;
    const deployment: Deployment = {
      id,
      projectId: project.id,
      name: req.body.name,
      url: `${project.name}-${id}.vercel.app`,
      target: req.body.target,
      gitSource: req.body.gitSource,
      readyState: "BUILDING",
      createdAt: Date.now(),
      env: structuredClone(project.env),
      envRevision: project.envRevision,
    };
    state.deployments.push(deployment);
    res.json({
      id,
      readyState: deployment.readyState,
      aliasAssigned: false,
      target: deployment.target,
    });
  });
  app.get(`${base}/v7/deployments`, (req, res) => {
    const deployments = state.deployments
      .filter((d) => d.projectId === req.query.projectId)
      .slice()
      .reverse();
    res.json({
      deployments: deployments.map((d) => ({
        uid: d.id,
        name: d.name,
        projectId: d.projectId,
        url: d.url,
        target: d.target,
        readyState: d.readyState,
        state: d.readyState,
        created: d.createdAt,
        createdAt: d.createdAt,
        creator: { uid: USER_ID },
        inspectorUrl: `https://vercel.com/test-team/${d.name}/${d.id}`,
        type: "LAMBDAS",
      })),
      pagination: pagination(deployments.length),
    });
  });
}
