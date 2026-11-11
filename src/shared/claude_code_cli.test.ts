import { expect, it } from "vitest";
import { canClaudeResumeFromAnotherDirectory } from "./claude_code_cli";

it.each(["2.1.19", "2.1.20", "2.1.94", "2.1.281", "2.2.0", "3.0.0"])(
  "allows worktree isolation with Claude Code %s",
  (version) => expect(canClaudeResumeFromAnotherDirectory(version)).toBe(true),
);

it.each([null, "unknown", "", "2.1", "1.9.99", "2.0.999", "2.1.9", "2.1.18"])(
  "refuses new worktrees with an older or unknown Claude Code version: %s",
  (version) => expect(canClaudeResumeFromAnotherDirectory(version)).toBe(false),
);
