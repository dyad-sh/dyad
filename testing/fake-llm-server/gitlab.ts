import type { Express, Request, Response } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync, spawn } from "child_process";
import { fakeLlmLog } from "./log";

const gitHttpMiddlewareFactory = require("git-http-mock-server/middleware");

/**
 * A GitLab instance, enough of one to publish to and deploy from.
 *
 * Mounted under /gitlab so a test types `http://localhost:<port>/gitlab` into
 * the instance-URL field the way a user types their own instance's address.
 * Nothing in production code knows this fake exists: the same handlers, the
 * same client and the same git plumbing run against it.
 *
 * Serves the REST API Dyad uses (user, token, groups, projects, branches,
 * deploy keys) and git-over-HTTP for the projects it knows, backed by real
 * bare repositories so pushes, fetches and clones behave.
 */

export const FAKE_GITLAB_TOKEN = "glpat-fake-token";

const USER = {
  id: 1,
  username: "gitlabuser",
  name: "GitLab User",
  email: "gitlabuser@example.com",
  namespace_id: 10,
};

const NAMESPACES = [
  { id: 10, full_path: "gitlabuser", kind: "user", name: "GitLab User" },
  { id: 20, full_path: "dyad-team", kind: "group", name: "Dyad Team" },
];

interface FakeProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  namespace_id: number;
  default_branch: string;
  visibility: string;
}

interface FakeDeployKey {
  id: number;
  title: string;
  key: string;
  can_push: boolean;
}

interface PushEvent {
  timestamp: Date;
  path: string;
  branch: string;
  operation: "push" | "create" | "delete";
  commitSha?: string;
}

function seedProjects(): FakeProject[] {
  return [
    {
      id: 100,
      name: "existing-app",
      path: "existing-app",
      path_with_namespace: "dyad-team/existing-app",
      namespace_id: 20,
      default_branch: "main",
      visibility: "private",
    },
  ];
}

const state = {
  projects: seedProjects(),
  nextProjectId: 101,
  deployKeys: new Map<number, FakeDeployKey[]>(),
  nextKeyId: 1,
  pushEvents: [] as PushEvent[],
  reposRoot: fs.mkdtempSync(path.join(os.tmpdir(), "dyad-gitlab-mock-")),
};

function reset() {
  state.projects = seedProjects();
  state.nextProjectId = 101;
  state.deployKeys.clear();
  state.nextKeyId = 1;
  state.pushEvents.length = 0;
  try {
    fs.rmSync(state.reposRoot, { recursive: true, force: true });
  } catch {
    // A root that is already gone is fine.
  }
  state.reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-gitlab-mock-"));
}

function authed(req: Request, res: Response): boolean {
  if (req.headers["private-token"] !== FAKE_GITLAB_TOKEN) {
    res.status(401).json({ message: "401 Unauthorized" });
    return false;
  }
  return true;
}

function instanceBase(req: Request): string {
  return `http://${req.headers.host}/gitlab`;
}

function projectJson(req: Request, project: FakeProject) {
  return {
    ...project,
    // A non-standard port, as a self-hosted instance often has; the deploy
    // path must pass this through rather than compose its own.
    ssh_url_to_repo: `ssh://git@fake-gitlab.local:2222/${project.path_with_namespace}.git`,
    http_url_to_repo: `${instanceBase(req)}/${project.path_with_namespace}.git`,
    web_url: `${instanceBase(req)}/${project.path_with_namespace}`,
  };
}

function findProject(ref: string): FakeProject | undefined {
  const decoded = decodeURIComponent(ref);
  if (/^\d+$/.test(decoded)) {
    return state.projects.find((p) => p.id === Number(decoded));
  }
  return state.projects.find((p) => p.path_with_namespace === decoded);
}

/** Group paths hold slashes; the bare repos sit flat under one directory. */
function bareRepoPath(pathWithNamespace: string): string {
  return path.join(
    state.reposRoot,
    `${pathWithNamespace.replace(/\//g, "__")}.git`,
  );
}

function ensureBareRepo(pathWithNamespace: string): string {
  const repoPath = bareRepoPath(pathWithNamespace);
  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync("git", ["init", "--bare", "--initial-branch=main"], {
      cwd: repoPath,
      stdio: "pipe",
    });
  }
  return repoPath;
}

function keyMaterial(key: string): string {
  return key.trim().split(/\s+/).slice(0, 2).join(" ");
}

function recordPushEvents(pathWithNamespace: string, body: string) {
  const events: PushEvent[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(
      // eslint-disable-next-line
      /([0-9a-f]{40})\s+([0-9a-f]{40})\s+refs\/heads\/([^\s\x00]+)/,
    );
    if (!match) continue;
    const [, oldSha, newSha, branch] = match;
    const operation: PushEvent["operation"] =
      newSha === "0".repeat(40)
        ? "delete"
        : oldSha === "0".repeat(40)
          ? "create"
          : "push";
    const event: PushEvent = {
      timestamp: new Date(),
      path: pathWithNamespace,
      branch,
      operation,
      commitSha: operation === "delete" ? oldSha : newSha,
    };
    events.push(event);
    state.pushEvents.push(event);
    fakeLlmLog(`* [gitlab] ${operation} ${pathWithNamespace}/${branch}`);
  }
  return events;
}

function pointHeadAtCreatedBranch(repoPath: string, events: PushEvent[]) {
  const created = events.find((e) => e.operation === "create")?.branch;
  if (!created) return;
  try {
    execFileSync(
      "git",
      ["--git-dir", repoPath, "symbolic-ref", "HEAD", `refs/heads/${created}`],
      { stdio: "pipe" },
    );
  } catch (error) {
    console.warn("* [gitlab] failed to point HEAD at the pushed branch", error);
  }
}

function listBranches(pathWithNamespace: string): string[] {
  const repoPath = bareRepoPath(pathWithNamespace);
  if (!fs.existsSync(repoPath)) return [];
  try {
    return execFileSync(
      "git",
      [
        "--git-dir",
        repoPath,
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
      ],
      { stdio: "pipe" },
    )
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function registerFakeGitLab(app: Express) {
  fakeLlmLog("Setting up GitLab mock endpoints");

  // --- Test controls ---
  app.post("/gitlab/test/reset", (_req, res) => {
    reset();
    res.json({ ok: true });
  });
  app.get("/gitlab/test/push-events", (req, res) => {
    const filter = typeof req.query.path === "string" ? req.query.path : null;
    res.json(
      filter
        ? state.pushEvents.filter((e) => e.path === filter)
        : state.pushEvents,
    );
  });
  app.get("/gitlab/test/deploy-keys", (_req, res) => {
    const keys: Array<FakeDeployKey & { project: string }> = [];
    for (const [projectId, list] of state.deployKeys) {
      const project = state.projects.find((p) => p.id === projectId);
      for (const key of list) {
        keys.push({ ...key, project: project?.path_with_namespace ?? "?" });
      }
    }
    res.json(keys);
  });

  // --- REST API ---
  app.get("/gitlab/api/v4/user", (req, res) => {
    if (!authed(req, res)) return;
    res.json(USER);
  });
  app.get("/gitlab/api/v4/personal_access_tokens/self", (req, res) => {
    if (!authed(req, res)) return;
    res.json({
      id: 1,
      name: "Dyad",
      scopes: ["api"],
      active: true,
      expires_at: null,
    });
  });
  app.get("/gitlab/api/v4/groups", (req, res) => {
    if (!authed(req, res)) return;
    res.json(NAMESPACES.filter((ns) => ns.kind === "group"));
  });
  app.get("/gitlab/api/v4/namespaces", (req, res) => {
    if (!authed(req, res)) return;
    const search = typeof req.query.search === "string" ? req.query.search : "";
    res.json(NAMESPACES.filter((ns) => ns.full_path.includes(search)));
  });

  app.get("/gitlab/api/v4/projects", (req, res) => {
    if (!authed(req, res)) return;
    res.json(state.projects.map((p) => projectJson(req, p)));
  });
  app.post("/gitlab/api/v4/projects", (req, res) => {
    if (!authed(req, res)) return;
    const {
      name,
      path: projectPath,
      namespace_id: namespaceId,
    } = req.body ?? {};
    const namespace = NAMESPACES.find((ns) => ns.id === Number(namespaceId));
    if (!namespace) {
      return res.status(400).json({ message: { namespace: ["is not valid"] } });
    }
    if (typeof projectPath !== "string" || !projectPath) {
      return res.status(400).json({ message: { path: ["can't be blank"] } });
    }
    const pathWithNamespace = `${namespace.full_path}/${projectPath}`;
    if (
      state.projects.some((p) => p.path_with_namespace === pathWithNamespace)
    ) {
      return res
        .status(400)
        .json({ message: { path: ["has already been taken"] } });
    }
    const project: FakeProject = {
      id: state.nextProjectId++,
      name: String(name ?? projectPath),
      path: projectPath,
      path_with_namespace: pathWithNamespace,
      namespace_id: namespace.id,
      default_branch: "main",
      visibility: String(req.body?.visibility ?? "private"),
    };
    state.projects.push(project);
    ensureBareRepo(pathWithNamespace);
    fakeLlmLog(
      `* [gitlab] created project ${pathWithNamespace} (${project.id})`,
    );
    res.status(201).json(projectJson(req, project));
  });
  app.get("/gitlab/api/v4/projects/:id", (req, res) => {
    if (!authed(req, res)) return;
    const project = findProject(req.params.id);
    if (!project) {
      return res.status(404).json({ message: "404 Project Not Found" });
    }
    res.json(projectJson(req, project));
  });
  app.get("/gitlab/api/v4/projects/:id/repository/branches", (req, res) => {
    if (!authed(req, res)) return;
    const project = findProject(req.params.id);
    if (!project) {
      return res.status(404).json({ message: "404 Project Not Found" });
    }
    const names = listBranches(project.path_with_namespace);
    // A project nothing has been pushed to yet still advertises its default
    // branch, as GitLab's UI would after "create from template".
    const branches = names.length > 0 ? names : ["main", "develop"];
    res.json(
      branches.map((name) => ({ name, commit: { id: "0".repeat(40) } })),
    );
  });
  app.get("/gitlab/api/v4/projects/:id/deploy_keys", (req, res) => {
    if (!authed(req, res)) return;
    const project = findProject(req.params.id);
    if (!project) {
      return res.status(404).json({ message: "404 Project Not Found" });
    }
    res.json(state.deployKeys.get(project.id) ?? []);
  });
  app.post("/gitlab/api/v4/projects/:id/deploy_keys", (req, res) => {
    if (!authed(req, res)) return;
    const project = findProject(req.params.id);
    if (!project) {
      return res.status(404).json({ message: "404 Project Not Found" });
    }
    const material = keyMaterial(String(req.body?.key ?? ""));
    const existing = state.deployKeys.get(project.id) ?? [];
    if (existing.some((k) => keyMaterial(k.key) === material)) {
      return res
        .status(400)
        .json({ message: { fingerprint: ["has already been taken"] } });
    }
    const created: FakeDeployKey = {
      id: state.nextKeyId++,
      title: String(req.body?.title ?? ""),
      key: String(req.body?.key ?? ""),
      can_push: req.body?.can_push === true,
    };
    state.deployKeys.set(project.id, [...existing, created]);
    res.status(201).json(created);
  });

  // --- git over HTTP: /gitlab/<namespace>/<project>.git/... ---
  app.all(/^\/gitlab\/(?!api\/|test\/|git\/)[^?]+\.git(?:\/|$)/, (req, res) => {
    const match = req.url.match(/^\/gitlab\/([^?]+?)\.git(\/[^?]*)?(\?.*)?$/);
    if (!match) {
      return res.status(404).json({ message: "not a repository" });
    }
    const pathWithNamespace = match[1];
    const project = state.projects.find(
      (p) => p.path_with_namespace === pathWithNamespace,
    );
    if (!project) {
      return res.status(404).json({ message: "404 Project Not Found" });
    }
    const repoPath = ensureBareRepo(pathWithNamespace);
    const flatName = path.basename(repoPath);

    if (req.url.includes("/git-receive-pack") && req.method === "POST") {
      // Pushes run against the real bare repo (the middleware would use a
      // throwaway copy), with the body buffered so ref updates can be read.
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks);
        const events = recordPushEvents(
          pathWithNamespace,
          rawBody.toString("latin1"),
        );
        const env = req.headers["git-protocol"]
          ? {
              ...process.env,
              GIT_PROTOCOL: String(req.headers["git-protocol"]),
            }
          : process.env;
        res.setHeader("content-type", "application/x-git-receive-pack-result");
        const ps = spawn("git-receive-pack", ["--stateless-rpc", repoPath], {
          env,
        });
        ps.on("error", (error) => {
          console.error("* [gitlab] git-receive-pack failed to spawn:", error);
          if (!res.headersSent) res.status(500);
          res.end();
        });
        ps.stdin.on("error", (error) => {
          console.error("* [gitlab] git-receive-pack stdin error:", error);
        });
        ps.stdin.write(rawBody);
        ps.stdin.end();
        ps.stdout.pipe(res);
        ps.on("close", (code) => {
          if (code === 0) pointHeadAtCreatedBranch(repoPath, events);
        });
      });
      return;
    }

    // Everything else (info/refs, upload-pack) goes through the middleware,
    // which expects the repository directly under its root.
    req.url = `/gitlab/git/${flatName}${match[2] ?? ""}${match[3] ?? ""}`;
    const middleware = gitHttpMiddlewareFactory({
      root: state.reposRoot,
      route: "/gitlab/git",
      glob: "*.git",
    });
    middleware(req, res, () => {
      res.status(404).json({ message: "git operation not supported" });
    });
  });
}
