// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shellExecutionGuidance } from "@/shared/shell_capability";
import { claudeSessionFingerprint } from "./session_fingerprint";

const declarations = [["read_file", "Reads a file", { type: "object" }]];

function systemFor(turnPath: string) {
  return `Build the app.\n<shell_execution>\n${shellExecutionGuidance("linux", turnPath)}\n</shell_execution>\nPaths are relative to ${turnPath}.`;
}

describe("claudeSessionFingerprint", () => {
  it("matches the pre-isolation fingerprint for turns in the app's folder", () => {
    const appPath = "/home/me/dyad-apps/violet";
    const system = systemFor(appPath);
    expect(
      claudeSessionFingerprint({
        appPath,
        turnPath: appPath,
        system,
        declarations,
      }),
    ).toBe(
      createHash("sha256")
        .update(JSON.stringify([appPath, system, declarations]))
        .digest("hex"),
    );
  });

  it.each([
    ["POSIX", "/home/me/dyad-apps/violet", "/home/me/.dyad/ws/chat-7-a1b2c3"],
    [
      "Windows",
      "C:\\Users\\me\\dyad-apps\\violet",
      "C:\\Users\\me\\AppData\\dyad\\ws\\chat-7-a1b2c3",
    ],
  ])(
    "is the same in an isolated worktree as in the app's folder (%s paths)",
    (_platform, appPath, worktreePath) => {
      const inApp = claudeSessionFingerprint({
        appPath,
        turnPath: appPath,
        system: systemFor(appPath),
        declarations,
      });
      expect(
        claudeSessionFingerprint({
          appPath,
          turnPath: worktreePath,
          system: systemFor(worktreePath),
          declarations,
        }),
      ).toBe(inApp);
    },
  );

  it("changes when the system prompt, tools, or app change", () => {
    const appPath = "/home/me/dyad-apps/violet";
    const base = {
      appPath,
      turnPath: appPath,
      system: systemFor(appPath),
      declarations,
    };
    const fingerprint = claudeSessionFingerprint(base);
    expect(
      claudeSessionFingerprint({ ...base, system: `${base.system}\nPlan.` }),
    ).not.toBe(fingerprint);
    expect(claudeSessionFingerprint({ ...base, declarations: [] })).not.toBe(
      fingerprint,
    );
    expect(
      claudeSessionFingerprint({
        ...base,
        appPath: "/home/me/dyad-apps/teal",
        turnPath: "/home/me/dyad-apps/teal",
      }),
    ).not.toBe(fingerprint);
  });
});
