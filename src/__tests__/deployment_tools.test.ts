import { describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
}));

vi.mock("../ipc/utils/github_api_utils", () => ({
  githubApiJson: vi.fn(),
  fetchGithubAccount: vi.fn(),
  parseRepoFullName: (fullName: string) => {
    const [owner, repo] = fullName.split("/");
    return { owner, repo };
  },
}));

const {
  buildDeploymentToolSet,
  deploymentToolsPrompt,
  hasGithubAccess,
  hasVercelAccess,
} = await import("@/ipc/utils/deployment_tools");

const settingsWith = (tokens: {
  github?: boolean;
  vercel?: boolean;
}): UserSettings =>
  ({
    ...(tokens.github ? { githubAccessToken: { value: "gh-token" } } : {}),
    ...(tokens.vercel ? { vercelAccessToken: { value: "vc-token" } } : {}),
  }) as unknown as UserSettings;

const noop = () => {};

describe("deployment tool availability", () => {
  it("exposes nothing when neither service is connected", () => {
    const tools = buildDeploymentToolSet(settingsWith({}), noop);
    expect(Object.keys(tools)).toEqual([]);
    expect(hasGithubAccess(settingsWith({}))).toBe(false);
    expect(hasVercelAccess(settingsWith({}))).toBe(false);
  });

  it("exposes only GitHub tools when only GitHub is connected", () => {
    const tools = buildDeploymentToolSet(settingsWith({ github: true }), noop);
    const names = Object.keys(tools);

    expect(names).toContain("github_create_repo");
    expect(names).toContain("github_put_file");
    expect(names.every((name) => !name.startsWith("vercel_"))).toBe(true);
  });

  it("exposes only Vercel tools when only Vercel is connected", () => {
    const tools = buildDeploymentToolSet(settingsWith({ vercel: true }), noop);
    const names = Object.keys(tools);

    expect(names).toContain("vercel_create_project");
    expect(names).toContain("vercel_deploy_project");
    expect(names.every((name) => !name.startsWith("github_"))).toBe(true);
  });

  it("exposes both sets when both tokens are active", () => {
    const tools = buildDeploymentToolSet(
      settingsWith({ github: true, vercel: true }),
      noop,
    );
    expect(Object.keys(tools).sort()).toEqual([
      "github_account",
      "github_create_repo",
      "github_list_repos",
      "github_put_file",
      "vercel_create_project",
      "vercel_deploy_project",
      "vercel_list_deployments",
      "vercel_list_projects",
    ]);
  });

  it("never exposes a delete capability", () => {
    const tools = buildDeploymentToolSet(
      settingsWith({ github: true, vercel: true }),
      noop,
    );
    for (const name of Object.keys(tools)) {
      expect(name).not.toMatch(/delete|remove|destroy/i);
    }
  });
});

describe("tool input validation", () => {
  const tools = buildDeploymentToolSet(
    settingsWith({ github: true, vercel: true }),
    noop,
  );

  it("rejects repository names with illegal characters", () => {
    const schema = (tools.github_create_repo as any).inputSchema;
    expect(schema.safeParse({ name: "my repo!" }).success).toBe(false);
    expect(schema.safeParse({ name: "my-repo" }).success).toBe(true);
  });

  it("defaults new repositories to private", () => {
    const schema = (tools.github_create_repo as any).inputSchema;
    expect(schema.parse({ name: "site" }).private).toBe(true);
  });

  it("rejects uppercase Vercel project names", () => {
    const schema = (tools.vercel_create_project as any).inputSchema;
    expect(schema.safeParse({ name: "MySite" }).success).toBe(false);
    expect(schema.safeParse({ name: "my-site" }).success).toBe(true);
  });

  it("defaults deployments to the main branch", () => {
    const schema = (tools.vercel_deploy_project as any).inputSchema;
    const parsed = schema.parse({
      projectName: "site",
      gitRepository: "acme/site",
    });
    expect(parsed.ref).toBe("main");
  });
});

describe("deploymentToolsPrompt", () => {
  it("tells the agent to ask for a connection when nothing is linked", () => {
    const prompt = deploymentToolsPrompt(settingsWith({}));
    expect(prompt).toContain("not connected");
    expect(prompt).toContain("Settings → Integrations");
  });

  it("describes only what is actually connected", () => {
    const githubOnly = deploymentToolsPrompt(settingsWith({ github: true }));
    expect(githubOnly).toContain("GitHub is connected");
    expect(githubOnly).toContain("Vercel is not connected");

    const vercelOnly = deploymentToolsPrompt(settingsWith({ vercel: true }));
    expect(vercelOnly).toContain("Vercel is connected");
    expect(vercelOnly).toContain("GitHub is not connected");
  });

  it("requires the agent to wait for tool confirmation before claiming a deploy", () => {
    const prompt = deploymentToolsPrompt(
      settingsWith({ github: true, vercel: true }),
    );
    expect(prompt).toContain("Never claim a deploy succeeded");
  });

  it("never contains a token value", () => {
    const prompt = deploymentToolsPrompt(
      settingsWith({ github: true, vercel: true }),
    );
    expect(prompt).not.toContain("gh-token");
    expect(prompt).not.toContain("vc-token");
  });
});
