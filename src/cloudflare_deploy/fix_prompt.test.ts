import { describe, expect, it } from "vitest";
import { buildCloudflareDeployFixPrompt } from "./fix_prompt";

describe("buildCloudflareDeployFixPrompt", () => {
  it("names the folder, Worker and config and fences the log", () => {
    const prompt = buildCloudflareDeployFixPrompt({
      workerName: "shop-api",
      rootDirectory: "worker",
      target: { kind: "wrangler", configPath: "worker/wrangler.jsonc" },
      logTail: ["npm error missing script: build", "Failed: build command"],
    });

    expect(prompt).toContain("the `worker` folder");
    expect(prompt).toContain('Worker "shop-api"');
    expect(prompt).toContain("`worker/wrangler.jsonc`");
    expect(prompt).toContain(
      "Build log:\n```\nnpm error missing script: build\nFailed: build command\n```",
    );
  });

  it("describes the root folder and a missing config", () => {
    const prompt = buildCloudflareDeployFixPrompt({
      workerName: "site",
      rootDirectory: "",
      target: null,
      logTail: ["error"],
    });

    expect(prompt).toContain("deployment of this app");
    expect(prompt).toContain("Nitro setup is missing");
  });

  it("says a Nitro app generates its own config under the preset", () => {
    const prompt = buildCloudflareDeployFixPrompt({
      workerName: "site",
      rootDirectory: "",
      target: { kind: "nitro" },
      logTail: ["error"],
    });

    expect(prompt).toContain("It is a Nitro app");
    expect(prompt).toContain("NITRO_PRESET=cloudflare_module");
    expect(prompt).not.toContain("missing");
  });

  it("uses a fence the log cannot close when it contains backticks", () => {
    const prompt = buildCloudflareDeployFixPrompt({
      workerName: "site",
      rootDirectory: "",
      target: { kind: "wrangler", configPath: "wrangler.toml" },
      logTail: [
        'Or add the following to your "wrangler.toml" file:',
        "```",
        'main = "src/index.ts"',
        "```",
      ],
    });

    expect(prompt).toContain(
      'Build log:\n````\nOr add the following to your "wrangler.toml" file:\n```\nmain = "src/index.ts"\n```\n````',
    );
  });

  it("leaves the log out when Cloudflare returned none", () => {
    const prompt = buildCloudflareDeployFixPrompt({
      workerName: "site",
      rootDirectory: "",
      target: { kind: "wrangler", configPath: "wrangler.toml" },
      logTail: [],
    });

    expect(prompt).not.toContain("Build log");
  });
});
