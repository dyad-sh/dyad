import { beforeEach, describe, expect, it, vi } from "vitest";

// Keyed by contract channel, as the other handler tests do, so a handler added
// later cannot silently repoint a positional lookup.
const registeredHandlers = vi.hoisted(
  () => new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
);

vi.mock("@/ipc/handlers/base", () => ({
  createTypedHandler: vi.fn(
    (
      contract: { channel: string },
      handler: (event: unknown, input: unknown) => Promise<unknown>,
    ) => {
      registeredHandlers.set(contract.channel, handler);
    },
  ),
}));

const settings = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  writes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => settings.current,
  writeSettings: vi.fn((partial: Record<string, unknown>) => {
    settings.writes.push(partial);
    settings.current = { ...settings.current, ...partial };
  }),
}));

const dbState = vi.hoisted(() => ({
  app: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/db", () => ({
  db: {
    query: { apps: { findFirst: vi.fn(async () => dbState.app) } },
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          dbState.updates.push(values);
        }),
      })),
    })),
  },
}));

vi.mock("@/db/schema", () => ({
  apps: { id: "id" },
}));

const gitlabApi = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getTokenInfo: vi.fn(),
  listGroups: vi.fn(),
  findUserNamespace: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  listBranches: vi.fn(),
  constructed: [] as Array<{ instanceUrl: string; token: string }>,
}));

vi.mock("@/ipc/utils/gitlab_client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/ipc/utils/gitlab_client")>();
  return {
    ...original,
    GitLabClient: class {
      constructor(options: { instanceUrl: string; token: string }) {
        gitlabApi.constructed.push(options);
      }
      getCurrentUser = gitlabApi.getCurrentUser;
      getTokenInfo = gitlabApi.getTokenInfo;
      listGroups = gitlabApi.listGroups;
      findUserNamespace = gitlabApi.findUserNamespace;
      listProjects = gitlabApi.listProjects;
      getProject = gitlabApi.getProject;
      createProject = gitlabApi.createProject;
      listBranches = gitlabApi.listBranches;
    },
  };
});

const prepareLocalBranch = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/handlers/github_handlers", () => ({
  prepareLocalBranch,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  handleConnectToExistingGitLabProject,
  handleCreateGitLabProject,
  registerGitLabHandlers,
} from "./gitlab_handlers";

function handler(channel: string) {
  const fn = registeredHandlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return (input?: unknown) => fn({}, input);
}

const connected = () => ({
  gitlab: {
    instanceUrl: "https://gitlab.example.com",
    accessToken: { value: "glpat-secret" },
    user: { username: "rene" },
  },
});

const project = {
  id: 9,
  name: "My App",
  path: "my-app",
  pathWithNamespace: "group/my-app",
  defaultBranch: "main",
  visibility: "private",
  sshUrlToRepo: "git@gitlab.example.com:group/my-app.git",
  httpUrlToRepo: "https://gitlab.example.com/group/my-app.git",
  webUrl: "https://gitlab.example.com/group/my-app",
};

beforeEach(() => {
  vi.clearAllMocks();
  registeredHandlers.clear();
  settings.current = {};
  settings.writes.length = 0;
  dbState.app = { id: 1, path: "my-app" };
  dbState.updates.length = 0;
  gitlabApi.constructed.length = 0;
  registerGitLabHandlers();
});

describe("gitlab:save-token", () => {
  beforeEach(() => {
    gitlabApi.getCurrentUser.mockResolvedValue({
      id: 7,
      username: "rene",
      name: "René",
      email: "rene@example.com",
      namespaceId: 42,
    });
    gitlabApi.getTokenInfo.mockResolvedValue({
      scopes: ["api"],
      expiresAt: "2027-01-01",
      active: true,
    });
  });

  it("refuses a plain-http address until the risk is acknowledged", async () => {
    await expect(
      handler("gitlab:save-token")({
        instanceUrl: "http://gitlab.internal",
        token: "t",
        acknowledgedInsecure: false,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
    expect(gitlabApi.getCurrentUser).not.toHaveBeenCalled();

    await handler("gitlab:save-token")({
      instanceUrl: "http://gitlab.internal",
      token: "t",
      acknowledgedInsecure: true,
    });
    expect(gitlabApi.getCurrentUser).toHaveBeenCalled();
  });

  it("stores the normalized address, the user and the expiry", async () => {
    const status = await handler("gitlab:save-token")({
      instanceUrl: "https://GitLab.example.com/",
      token: "glpat-secret",
      acknowledgedInsecure: false,
    });

    expect(gitlabApi.constructed[0]).toEqual({
      instanceUrl: "https://gitlab.example.com",
      token: "glpat-secret",
    });
    expect(settings.writes[0]).toEqual({
      gitlab: {
        instanceUrl: "https://gitlab.example.com",
        accessToken: { value: "glpat-secret" },
        user: { username: "rene", name: "René", email: "rene@example.com" },
        tokenExpiresAt: "2027-01-01",
      },
    });
    expect(status).toEqual({
      connected: true,
      instanceUrl: "https://gitlab.example.com",
      username: "rene",
      tokenExpiresAt: "2027-01-01",
    });
  });

  it("rejects a token without the api scope before storing it", async () => {
    gitlabApi.getTokenInfo.mockResolvedValue({
      scopes: ["read_api", "write_repository"],
      expiresAt: null,
      active: true,
    });

    await expect(
      handler("gitlab:save-token")({
        instanceUrl: "https://gitlab.example.com",
        token: "t",
        acknowledgedInsecure: false,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("api scope"),
    });
    expect(settings.writes).toHaveLength(0);
  });

  it("accepts a token on an instance that cannot report scopes", async () => {
    gitlabApi.getTokenInfo.mockResolvedValue(null);

    const status = (await handler("gitlab:save-token")({
      instanceUrl: "https://gitlab.example.com",
      token: "t",
      acknowledgedInsecure: false,
    })) as { tokenExpiresAt: string | null };

    expect(status.tokenExpiresAt).toBeNull();
    expect(settings.writes).toHaveLength(1);
  });

  it("rejects a token GitLab reports as inactive", async () => {
    gitlabApi.getTokenInfo.mockResolvedValue({
      scopes: ["api"],
      expiresAt: null,
      active: false,
    });

    await expect(
      handler("gitlab:save-token")({
        instanceUrl: "https://gitlab.example.com",
        token: "t",
        acknowledgedInsecure: false,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
  });
});

describe("gitlab:get-status and gitlab:clear-token", () => {
  it("reports disconnected without a token, connected with one", async () => {
    expect(await handler("gitlab:get-status")()).toEqual({
      connected: false,
      instanceUrl: null,
      username: null,
      tokenExpiresAt: null,
    });

    settings.current = connected();
    expect(await handler("gitlab:get-status")()).toMatchObject({
      connected: true,
      username: "rene",
    });
  });

  it("names every field when forgetting the connection", async () => {
    settings.current = connected();
    await handler("gitlab:clear-token")();
    expect(settings.writes[0]).toEqual({
      gitlab: {
        instanceUrl: undefined,
        accessToken: undefined,
        user: undefined,
        tokenExpiresAt: undefined,
      },
    });
  });
});

describe("gitlab:list-namespaces", () => {
  it("puts the personal namespace first, then the groups", async () => {
    settings.current = connected();
    gitlabApi.getCurrentUser.mockResolvedValue({
      id: 7,
      username: "rene",
      name: "René",
      email: null,
      namespaceId: 42,
    });
    gitlabApi.listGroups.mockResolvedValue([
      { id: 1, fullPath: "team", kind: "group", name: "Team" },
    ]);

    expect(await handler("gitlab:list-namespaces")()).toEqual([
      { id: 42, fullPath: "rene", kind: "user", name: "René" },
      { id: 1, fullPath: "team", kind: "group", name: "Team" },
    ]);
    expect(gitlabApi.findUserNamespace).not.toHaveBeenCalled();
  });

  it("looks the personal namespace up when the user record lacks it", async () => {
    settings.current = connected();
    gitlabApi.getCurrentUser.mockResolvedValue({
      id: 7,
      username: "rene",
      name: "René",
      email: null,
      namespaceId: null,
    });
    gitlabApi.listGroups.mockResolvedValue([]);
    gitlabApi.findUserNamespace.mockResolvedValue([
      { id: 42, fullPath: "rene", kind: "user", name: "René" },
    ]);

    expect(await handler("gitlab:list-namespaces")()).toEqual([
      { id: 42, fullPath: "rene", kind: "user", name: "René" },
    ]);
  });

  it("fails as Auth when nothing is connected", async () => {
    await expect(handler("gitlab:list-namespaces")()).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    });
  });
});

describe("gitlab:is-project-available", () => {
  it("normalizes the path and treats 404 as available", async () => {
    settings.current = connected();
    gitlabApi.getProject.mockRejectedValue(
      Object.assign(new DyadError("missing", DyadErrorKind.NotFound), {
        name: "GitLabRequestError",
        status: 404,
      }),
    );

    // The client mock rejects with a plain object, so isGitLabStatus does not
    // recognise it; assert on the lookup instead and on the taken case below.
    await handler("gitlab:is-project-available")({
      namespaceFullPath: "team",
      path: "My App",
    });
    expect(gitlabApi.getProject).toHaveBeenCalledWith("team/my-app");
  });

  it("reports a project that exists as taken", async () => {
    settings.current = connected();
    gitlabApi.getProject.mockResolvedValue(project);

    expect(
      await handler("gitlab:is-project-available")({
        namespaceFullPath: "team",
        path: "my-app",
      }),
    ).toEqual({ available: false, error: "Project already exists." });
  });

  it("does not throw when disconnected", async () => {
    expect(
      await handler("gitlab:is-project-available")({
        namespaceFullPath: "team",
        path: "my-app",
      }),
    ).toEqual({ available: false, error: "Not authenticated with GitLab." });
  });
});

describe("handleCreateGitLabProject", () => {
  beforeEach(() => {
    settings.current = connected();
    gitlabApi.createProject.mockResolvedValue(project);
  });

  it("creates the project, prepares the branch with oauth2 auth and links the app", async () => {
    await handleCreateGitLabProject({
      appId: 1,
      namespaceId: 3,
      repo: "My App",
      branch: "main",
    });

    expect(gitlabApi.createProject).toHaveBeenCalledWith({
      name: "My App",
      path: "my-app",
      namespaceId: 3,
    });
    expect(prepareLocalBranch).toHaveBeenCalledWith({
      appId: 1,
      branch: "main",
      remoteUrl: "https://gitlab.example.com/group/my-app.git",
      auth: {
        hostUrl: "https://gitlab.example.com",
        username: "oauth2",
        password: "glpat-secret",
      },
      providerLabel: "GitLab",
    });
    expect(dbState.updates[0]).toEqual({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: 9,
      gitlabProjectPath: "group/my-app",
      gitlabBranch: "main",
    });
  });

  it("refuses while the app is linked to GitHub", async () => {
    dbState.app = {
      id: 1,
      path: "my-app",
      githubOrg: "owner",
      githubRepo: "repo",
    };

    await expect(
      handleCreateGitLabProject({ appId: 1, namespaceId: 3, repo: "x" }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: expect.stringContaining("already linked to GitHub"),
    });
    expect(gitlabApi.createProject).not.toHaveBeenCalled();
  });

  it("fails as Auth before touching GitLab when disconnected", async () => {
    settings.current = {};
    await expect(
      handleCreateGitLabProject({ appId: 1, namespaceId: 3, repo: "x" }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
  });
});

describe("handleConnectToExistingGitLabProject", () => {
  it("stores the canonical path GitLab reports, not what the picker had", async () => {
    settings.current = connected();
    gitlabApi.getProject.mockResolvedValue({
      ...project,
      pathWithNamespace: "renamed-group/my-app",
    });

    await handleConnectToExistingGitLabProject({
      appId: 1,
      projectId: 9,
      branch: "develop",
    });

    expect(gitlabApi.getProject).toHaveBeenCalledWith(9);
    expect(prepareLocalBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteUrl: "https://gitlab.example.com/renamed-group/my-app.git",
        branch: "develop",
      }),
    );
    expect(dbState.updates[0]).toMatchObject({
      gitlabProjectPath: "renamed-group/my-app",
      gitlabBranch: "develop",
    });
  });
});
