import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentContext } from "./types";
import {
  runTypeScriptCheck,
  TypeCheckPreconditionError,
} from "@/ipc/processors/tsc";
import { BufferedProcessSpawnError } from "@/ipc/utils/buffered_process";
import { safeSend } from "@/ipc/utils/safe_sender";
import { runTypeChecksTool } from "./run_type_checks";

vi.mock("@/ipc/processors/tsc", async () => {
  const actual = await vi.importActual<typeof import("@/ipc/processors/tsc")>(
    "@/ipc/processors/tsc",
  );

  return {
    ...actual,
    runTypeScriptCheck: vi.fn(),
  };
});

vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: vi.fn(),
}));

describe("runTypeChecksTool precondition guidance", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    vi.mocked(runTypeScriptCheck).mockReset();
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
      rebuildAppToolAvailable: true,
    } as unknown as AgentContext;
  }

  function expectWarningOutput(ctx: AgentContext): string {
    expect(ctx.onXmlComplete).toHaveBeenCalledTimes(1);
    const output = vi.mocked(ctx.onXmlComplete).mock.calls[0][0];
    expect(output).toContain(
      '<dyad-output type="warning" message="Type checking unavailable">',
    );
    expect(output).not.toContain("<dyad-status");
    expect(output).not.toContain('type="error"');
    return output;
  }

  function problem(file: string, message = "Type mismatch") {
    return {
      file,
      line: 1,
      column: 1,
      code: 2322,
      message,
      snippet: "",
    };
  }

  it("tells the agent to rebuild when TypeScript is declared but missing", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^5.0.0" },
    });
    const ctx = makeCtx(appPath);
    vi.mocked(runTypeScriptCheck).mockRejectedValue(
      new TypeCheckPreconditionError(
        "typescript-not-found",
        "Failed to load TypeScript from app",
      ),
    );

    const result = await runTypeChecksTool.execute({}, ctx);

    expect(result).toMatch(/^Type checking could not run/);
    expect(result).toContain("TypeScript is listed in package.json");
    expect(result).toContain("Call `rebuild_app`");
    expect(result).not.toContain('<dyad-command type="rebuild">');
    expect(result).not.toContain("add_dependency");
    expect(result).toContain("retry `run_type_checks`");
    expect(safeSend).toHaveBeenCalledWith(
      undefined,
      "agent-tool:problems-update",
      {
        appId: 1,
        problems: { problems: [] },
      },
    );
    expect(expectWarningOutput(ctx)).toContain(
      "TypeScript is listed in package.json",
    );
    expect(expectWarningOutput(ctx)).toContain("Call `rebuild_app`");
  });

  it("falls back to a user command when rebuild_app is unavailable", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^5.0.0" },
    });
    const ctx = makeCtx(appPath);
    ctx.rebuildAppToolAvailable = false;
    vi.mocked(runTypeScriptCheck).mockRejectedValue(
      new TypeCheckPreconditionError(
        "typescript-not-found",
        "Failed to load TypeScript from app",
      ),
    );

    const result = await runTypeChecksTool.execute({}, ctx);

    expect(result).toContain("use Rebuild");
    expect(result).toContain('<dyad-command type="rebuild">');
    expect(result).not.toContain("Call `rebuild_app`");
  });

  it("tells the agent not to retry and to suggest adding TypeScript for plain JavaScript projects", async () => {
    const appPath = await makeApp({ dependencies: { react: "^19.0.0" } });
    const ctx = makeCtx(appPath);
    vi.mocked(runTypeScriptCheck).mockRejectedValue(
      new TypeCheckPreconditionError(
        "typescript-not-found",
        "Failed to load TypeScript from app",
      ),
    );

    const result = await runTypeChecksTool.execute({}, ctx);

    expect(result).toMatch(/^Type checking is unavailable/);
    expect(result).toContain("does not use TypeScript");
    expect(result).toContain("Do not call `run_type_checks` again");
    expect(result).toContain('<dyad-command type="add-typescript">');
    expect(expectWarningOutput(ctx)).toContain(
      '&lt;dyad-command type="add-typescript"',
    );
  });

  it("explains missing tsconfig separately", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^5.0.0" },
    });
    const ctx = makeCtx(appPath);
    vi.mocked(runTypeScriptCheck).mockRejectedValue(
      new TypeCheckPreconditionError(
        "tsconfig-not-found",
        "No TypeScript configuration file found in app",
      ),
    );

    const result = await runTypeChecksTool.execute({}, ctx);

    expect(result).toMatch(/^Type checking could not run/);
    expect(result).toContain("no tsconfig was found");
    expect(result).toContain("tsconfig.app.json");
    expect(result).not.toContain("add_dependency");
    expectWarningOutput(ctx);
  });

  it("rethrows unexpected type-check failures for the generic error path", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^5.0.0" },
    });
    const ctx = makeCtx(appPath);
    vi.mocked(runTypeScriptCheck).mockRejectedValue(
      new Error("worker exploded"),
    );

    await expect(runTypeChecksTool.execute({}, ctx)).rejects.toThrow(
      "worker exploded",
    );

    expect(ctx.onXmlComplete).not.toHaveBeenCalled();
    expect(safeSend).not.toHaveBeenCalled();
  });

  it("surfaces the real CLI spawn error instead of suggesting a rebuild", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^7.0.0" },
    });
    const ctx = makeCtx(appPath);
    const spawnError = new BufferedProcessSpawnError(
      "spawn node ENOENT",
      "",
      "",
    );
    vi.mocked(runTypeScriptCheck).mockRejectedValue(spawnError);

    await expect(runTypeChecksTool.execute({}, ctx)).rejects.toBe(spawnError);

    expect(ctx.onXmlComplete).not.toHaveBeenCalled();
    expect(safeSend).not.toHaveBeenCalled();
  });

  it("warns that configuration errors prevented a complete scoped check", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^7.0.0" },
    });
    const ctx = makeCtx(appPath);
    vi.mocked(runTypeScriptCheck).mockResolvedValue({
      outcome: "incomplete",
      problems: [
        problem("tsconfig.app.json", "Option 'baseUrl' has been removed."),
      ],
    });

    const result = await runTypeChecksTool.execute(
      { paths: ["src/App.tsx"] },
      ctx,
    );

    expect(result).toContain("Type checking could not complete");
    expect(result).toContain("tsconfig.app.json:1:1");
    expect(result).toContain("Fix the configuration error");
    expect(result).toContain("rerun `run_type_checks`");
    expect(result).not.toContain("No type errors found");
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining(
        '<dyad-status title="Type check incomplete" state="warning">',
      ),
    );
  });

  it("discloses project errors outside a requested path", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^7.0.0" },
    });
    const ctx = makeCtx(appPath);
    vi.mocked(runTypeScriptCheck).mockResolvedValue({
      outcome: "errors",
      problems: [problem("src/Other.tsx")],
    });

    const result = await runTypeChecksTool.execute(
      { paths: ["src/App.tsx"] },
      ctx,
    );

    expect(result).toBe(
      "No type errors found in `src/App.tsx`, but the project has 1 type error outside this scope.",
    );
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining(
        '<dyad-status title="Type errors found" state="finished">',
      ),
    );
  });

  it("reports matching and out-of-scope errors separately", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^7.0.0" },
    });
    const ctx = makeCtx(appPath);
    vi.mocked(runTypeScriptCheck).mockResolvedValue({
      outcome: "errors",
      problems: [problem("src/App.tsx"), problem("src/Other.tsx")],
    });

    const result = await runTypeChecksTool.execute(
      { paths: ["src/App.tsx"] },
      ctx,
    );

    expect(result).toContain("Found 1 type error in `src/App.tsx`");
    expect(result).toContain(
      "The project also has 1 type error outside this scope.",
    );
    expect(result).not.toContain("src/Other.tsx:1:1");
  });

  it("describes a clean scoped check without claiming a project-wide result", async () => {
    const appPath = await makeApp({
      devDependencies: { typescript: "^7.0.0" },
    });
    const ctx = makeCtx(appPath);
    vi.mocked(runTypeScriptCheck).mockResolvedValue({
      outcome: "passed",
      problems: [],
    });

    const result = await runTypeChecksTool.execute(
      { paths: ["src/App.tsx"] },
      ctx,
    );

    expect(result).toBe("No type errors found in `src/App.tsx`.");
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining(
        '<dyad-status title="Type check passed" state="finished">',
      ),
    );
  });
});
