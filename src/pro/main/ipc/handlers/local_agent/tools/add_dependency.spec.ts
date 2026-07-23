import { describe, expect, it } from "vitest";
import { addDependencyTool } from "./add_dependency";

describe("addDependencyTool", () => {
  it("requires at least one package", () => {
    expect(
      addDependencyTool.inputSchema.safeParse({ packages: [] }).success,
    ).toBe(false);
  });

  it("guides the model to use @latest only for explicit upgrades", () => {
    expect(addDependencyTool.description).toContain(
      "use package@latest to explicitly upgrade",
    );
  });

  it("tracks successful installs and updates as mutations", () => {
    expect(
      addDependencyTool.shouldTrackMutation?.(
        { packages: ["react"] },
        "Successfully installed or updated react",
        {} as any,
      ),
    ).toBe(true);
  });
});
