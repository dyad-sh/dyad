import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentContext } from "./types";
import {
  generateProblemReport,
  TypeCheckPreconditionError,
} from "@/ipc/processors/tsc";
import { safeSend } from "@/ipc/utils/safe_sender";
import { runTypeChecksTool } from "./run_type_checks";

vi.mock("@/ipc/processors/tsc", async () => {
  const actual = await vi.importActual<typeof import("@/ipc/processors/tsc")>(
    "@/ipc/processors/tsc",
  );

  return {
    ...actual,
    generateProblemReport: vi.fn(),
  };
});

vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: vi.fn(),
}));

describe("runTypeChecksTool precondition guidance", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    vi.mocked(generateProblemReport).mockReset();
    vi.mocked(safeSend).mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    tempDirs = [];
  });

  async function makeApp(packageJson: object): Promise<string> {
    const appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-tsc-"));
    tempDirs.push(appPath);
    await fs.writeFile(
      path.join(appPath, "package.json"),
      JSON.stringify(packageJson),
    );
    return appPath;
  }

  function makeCtx(appPath: string): AgentContext {
    return {
      appId: 1,
      appPath,
      event: { sender: undefined },
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;
  }

  it("tells the agent to install dependencies when TypeScript is declared but missing", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^5.0.0" },
    });
    const ctx = makeCtx(appPath);
    vi.mocked(generateProblemReport).mockRejectedValue(
      new TypeCheckPreconditionError(
        "typescript-not-found",
        "Failed to load TypeScript from app",
      ),
    );

    const result = await runTypeChecksTool.execute({}, ctx);

    expect(result).toContain("TypeScript is listed in package.json");
    expect(result).toContain("add_dependency");
    expect(result).toContain('{ "packages": ["typescript"] }');
    expect(result).toContain("retry `run_type_checks`");
    expect(safeSend).toHaveBeenCalledWith(
      undefined,
      "agent-tool:problems-update",
      {
        appId: 1,
        problems: { problems: [] },
      },
    );
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining("TypeScript is listed in package.json"),
    );
  });

  it("tells the agent not to retry and to suggest adding TypeScript for plain JavaScript projects", async () => {
    const appPath = await makeApp({ dependencies: { react: "^19.0.0" } });
    const ctx = makeCtx(appPath);
    vi.mocked(generateProblemReport).mockRejectedValue(
      new TypeCheckPreconditionError(
        "typescript-not-found",
        "Failed to load TypeScript from app",
      ),
    );

    const result = await runTypeChecksTool.execute({}, ctx);

    expect(result).toContain("does not use TypeScript");
    expect(result).toContain("Do not call `run_type_checks` again");
    expect(result).toContain('<dyad-command type="add-typescript">');
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('&lt;dyad-command type="add-typescript"'),
    );
  });

  it("explains missing tsconfig separately", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^5.0.0" },
    });
    const ctx = makeCtx(appPath);
    vi.mocked(generateProblemReport).mockRejectedValue(
      new TypeCheckPreconditionError(
        "tsconfig-not-found",
        "No TypeScript configuration file found in app",
      ),
    );

    const result = await runTypeChecksTool.execute({}, ctx);

    expect(result).toContain("no tsconfig was found");
    expect(result).toContain("tsconfig.app.json");
    expect(result).not.toContain("add_dependency");
  });
});
