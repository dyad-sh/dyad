import { describe, expect, it } from "vitest";
import {
  addConvexToPackageJsonContent,
  isConvexConfigured,
} from "@/ipc/utils/convex_setup";

describe("isConvexConfigured", () => {
  it("returns true when convex files are present", () => {
    expect(isConvexConfigured(["src/App.tsx", "convex/schema.ts"])).toBe(true);
  });

  it("returns false when convex files are absent", () => {
    expect(isConvexConfigured(["src/App.tsx", "package.json"])).toBe(false);
  });
});

describe("addConvexToPackageJsonContent", () => {
  it("adds Convex scripts and dependencies when missing", () => {
    const input = JSON.stringify(
      {
        name: "example",
        scripts: {
          dev: "vite",
        },
        dependencies: {
          react: "^19.2.3",
        },
      },
      null,
      2,
    );

    const { content, changed } = addConvexToPackageJsonContent(input);
    const output = JSON.parse(content);

    expect(changed).toBe(true);
    expect(output.scripts["dev:backend"]).toBe("convex dev");
    expect(output.scripts["convex:dev"]).toBe("convex dev");
    expect(output.scripts["convex:deploy"]).toBe("convex deploy");
    expect(output.dependencies.convex).toBe("^1.31.2");
    expect(output.dependencies["@convex-dev/auth"]).toBe("^0.0.80");
  });

  it("does not overwrite existing scripts or dependency versions", () => {
    const input = JSON.stringify(
      {
        name: "example",
        scripts: {
          "dev:backend": "pnpm convex dev --local",
          "convex:deploy": "custom deploy command",
        },
        dependencies: {
          convex: "1.0.0-custom",
        },
      },
      null,
      2,
    );

    const { content, changed } = addConvexToPackageJsonContent(input);
    const output = JSON.parse(content);

    expect(changed).toBe(true);
    expect(output.scripts["dev:backend"]).toBe("pnpm convex dev --local");
    expect(output.scripts["convex:deploy"]).toBe("custom deploy command");
    expect(output.dependencies.convex).toBe("1.0.0-custom");
    expect(output.scripts["convex:dev"]).toBe("convex dev");
    expect(output.dependencies["@convex-dev/auth"]).toBe("^0.0.80");
  });

  it("returns unchanged when convex config is already present", () => {
    const input = JSON.stringify(
      {
        scripts: {
          "dev:backend": "convex dev",
          "convex:dev": "convex dev",
          "convex:deploy": "convex deploy",
        },
        dependencies: {
          convex: "^1.31.2",
          "@convex-dev/auth": "^0.0.80",
        },
      },
      null,
      2,
    );

    const { changed } = addConvexToPackageJsonContent(input);
    expect(changed).toBe(false);
  });
});
