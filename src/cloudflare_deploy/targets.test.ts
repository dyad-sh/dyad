import { describe, expect, it } from "vitest";
import {
  describeCloudflareTarget,
  detectCloudflareTargets,
  readWranglerWorkerName,
} from "./targets";

describe("detectCloudflareTargets", () => {
  it("finds a Worker in a subfolder of an app that is not itself one", () => {
    expect(
      detectCloudflareTargets([
        "package.json",
        "src/App.tsx",
        "worker/wrangler.jsonc",
        "worker/src/index.ts",
      ]),
    ).toEqual([
      { rootDirectory: "worker", configPath: "worker/wrangler.jsonc" },
    ]);
  });

  it("treats a config at the top level as the root target", () => {
    expect(detectCloudflareTargets(["wrangler.toml", "src/index.ts"])).toEqual([
      { rootDirectory: "", configPath: "wrangler.toml" },
    ]);
  });

  it("orders targets shallowest first so the first one is the default", () => {
    const targets = detectCloudflareTargets([
      "services/zeta/wrangler.toml",
      "services/alpha/wrangler.toml",
      "api/wrangler.json",
      "wrangler.jsonc",
    ]);
    expect(targets.map((target) => target.rootDirectory)).toEqual([
      "",
      "api",
      "services/alpha",
      "services/zeta",
    ]);
  });

  it("ignores configs inside dependencies and build output", () => {
    expect(
      detectCloudflareTargets([
        "node_modules/some-package/wrangler.toml",
        ".output/server/wrangler.json",
        ".wrangler/tmp/wrangler.json",
        "dist/wrangler.json",
        "packages/api/node_modules/dep/wrangler.toml",
      ]),
    ).toEqual([]);
  });

  it("reports a folder once, preferring the config Wrangler itself prefers", () => {
    expect(
      detectCloudflareTargets([
        "api/wrangler.toml",
        "api/wrangler.json",
        "api/wrangler.jsonc",
      ]),
    ).toEqual([{ rootDirectory: "api", configPath: "api/wrangler.jsonc" }]);
  });

  it("does not mistake similarly named files for a config", () => {
    expect(
      detectCloudflareTargets([
        "docs/wrangler.toml.md",
        "my-wrangler.toml",
        "wrangler.toml.bak",
      ]),
    ).toEqual([]);
  });

  it("accepts Windows separators", () => {
    expect(detectCloudflareTargets(["worker\\wrangler.toml"])).toEqual([
      { rootDirectory: "worker", configPath: "worker/wrangler.toml" },
    ]);
  });
});

describe("describeCloudflareTarget", () => {
  it("names the root and shows a subfolder by its path", () => {
    expect(
      describeCloudflareTarget({ rootDirectory: "", configPath: "w.toml" }),
    ).toBe("App root");
    expect(
      describeCloudflareTarget({
        rootDirectory: "services/api",
        configPath: "services/api/wrangler.toml",
      }),
    ).toBe("services/api");
  });
});

describe("readWranglerWorkerName", () => {
  it("reads the name from JSON with comments and trailing commas", () => {
    const contents = `{
      // The Worker's name
      "$schema": "node_modules/wrangler/config-schema.json",
      "name": "orders-api", /* inline */
      "main": "src/index.ts",
      "vars": { "DOCS": "https://example.com/a//b" },
    }`;
    expect(readWranglerWorkerName("wrangler.jsonc", contents)).toBe(
      "orders-api",
    );
  });

  it("reads the top-level name from TOML", () => {
    const contents = `# config\nname = "orders-api"\nmain = "src/index.ts"\n`;
    expect(readWranglerWorkerName("wrangler.toml", contents)).toBe(
      "orders-api",
    );
    expect(readWranglerWorkerName("wrangler.toml", "name = 'single'")).toBe(
      "single",
    );
  });

  it("does not take a name that belongs to a TOML table", () => {
    const contents = `main = "src/index.ts"\n\n[env.staging]\nname = "orders-api-staging"\n`;
    expect(readWranglerWorkerName("wrangler.toml", contents)).toBeNull();
  });

  it("returns null when there is no usable name", () => {
    expect(readWranglerWorkerName("wrangler.json", "{ not json")).toBeNull();
    expect(readWranglerWorkerName("wrangler.json", `{"main":"x"}`)).toBeNull();
    expect(readWranglerWorkerName("wrangler.json", `{"name": 3}`)).toBeNull();
    expect(
      readWranglerWorkerName("wrangler.json", `{"name": "  "}`),
    ).toBeNull();
  });
});
