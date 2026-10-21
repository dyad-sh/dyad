// @vitest-environment node

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("issue triage workflow", () => {
  it.each(["\n", "\r\n"])(
    "pre-approves the prompt's issue metadata commands with %j line endings",
    (lineEnding) => {
      const read = (file: string) =>
        fs.readFileSync(file, "utf8").replace(/\r?\n/g, lineEnding);
      const workflow = parse(read(".github/workflows/claude-triage.yml"));
      const triage = workflow.jobs.triage.steps.find(
        (step: { name: string }) => step.name === "Triage issue",
      );
      const prompt = read(".github/prompts/claude-triage.txt");
      const allowedTools = triage.with.claude_args
        .match(/--allowedTools "([^"]+)"/)[1]
        .split(",");

      // Keep prompt instructions, step environment, and command permissions
      // aligned so headless runs can identify the triggering issue.
      for (const variable of [
        "ISSUE_NUMBER",
        "ISSUE_TITLE",
        "ISSUE_BODY",
        "ISSUE_AUTHOR",
      ]) {
        expect(triage.env[variable]).toBeTruthy();
        expect(prompt).toContain(`\`printenv ${variable}\``);
        expect(allowedTools).toContain(`Bash(printenv ${variable})`);
        expect(prompt).not.toContain(`echo "$${variable}"`);
      }

      // Grant only these four literal reads, never a full environment dump
      // or access to another variable through a prefix/wildcard rule.
      expect(
        allowedTools
          .filter((rule: string) => rule.startsWith("Bash(printenv"))
          .sort(),
      ).toEqual(
        Object.keys(triage.env)
          .filter((name) => name.startsWith("ISSUE_"))
          .map((name) => `Bash(printenv ${name})`)
          .sort(),
      );
      expect(allowedTools).not.toContain("Bash");
      expect(allowedTools).not.toContain("Bash(*)");
    },
  );
});
