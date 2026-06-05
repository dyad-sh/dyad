import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { exploreCode } from "../../../workers/code_explorer/core";

const tempDirs: string[] = [];

describe("exploreCode", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns cross-file TypeScript symbols and line-numbered windows", () => {
    const appPath = createTempProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "src/auth/session.ts": [
        "export interface Session {",
        "  token: string;",
        "}",
        "",
        "export function createSession(userId: string): Session {",
        "  return { token: `session:${userId}` };",
        "}",
        "",
      ].join("\n"),
      "src/auth/AuthService.ts": [
        "import { createSession } from './session';",
        "",
        "export class AuthService {",
        "  login(userId: string) {",
        "    return createSession(userId);",
        "  }",
        "}",
        "",
      ].join("\n"),
    });

    const result = exploreCode(ts, {
      appPath,
      query: "login session auth service flow",
      maxFiles: 4,
      maxDepth: 2,
    });

    expect(result.files.map((file) => file.path)).toContain(
      "src/auth/AuthService.ts",
    );
    expect(result.files.map((file) => file.path)).toContain(
      "src/auth/session.ts",
    );
    expect(result.totalSymbols).toBeGreaterThan(0);
    expect(
      result.files.some((file) =>
        file.windows.some((window) =>
          window.lines.some((line) => line.includes("4   login")),
        ),
      ),
    ).toBe(true);
  });
});

function createTempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-code-explorer-"));
  tempDirs.push(dir);

  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }

  return dir;
}
