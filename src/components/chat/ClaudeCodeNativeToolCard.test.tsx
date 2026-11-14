import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClaudeCodeToolCard } from "./ClaudeCodeToolCard";

const copy: Record<string, string> = {
  "claudeNativeTool.runningCommand": "Running {{command}}",
  "claudeNativeTool.ranCommand": "Ran {{command}}",
  "claudeNativeTool.searched": "Searched for {{pattern}}",
  "claudeNativeTool.searchedWeb": "Searched the web for {{query}}",
  "claudeNativeTool.ranSubagent": "Subagent finished {{task}}",
  "claudeNativeTool.usedTool": "Used {{tool}}",
  "claudeNativeTool.steps": "Steps",
  "claudeNativeTool.compacted": "Claude Code compacted the conversation",
  "claudeNativeTool.steered": "You, while Claude was working",
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string> = {}) =>
      (copy[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name]),
  }),
}));
afterEach(cleanup);

const card = (value: Record<string, unknown>) => (
  <ClaudeCodeToolCard content={JSON.stringify({ body: "", ...value })} />
);

it("titles shell commands by their description and shows the output", () => {
  render(
    card({
      kind: "shell",
      state: "finished",
      subject: "npm test -- --run",
      summary: "Run the tests",
      body: "12 passed",
    }),
  );
  fireEvent.click(screen.getByText("Ran Run the tests"));
  expect(screen.getByText(/\$ npm test -- --run/)).toBeTruthy();
  expect(screen.getByText(/12 passed/)).toBeTruthy();
});

it("shows a running command while it is still pending", () => {
  render(card({ kind: "shell", state: "pending", subject: "sleep 5" }));
  expect(screen.getByText("Running sleep 5")).toBeTruthy();
});

it("lists a subagent's steps", () => {
  render(
    card({
      kind: "task",
      state: "finished",
      subject: "Find the login form",
      steps: ["Grep: LoginForm", "Read src/Login.tsx"],
      body: "It is in src/Login.tsx",
    }),
  );
  fireEvent.click(screen.getByText("Subagent finished Find the login form"));
  expect(screen.getByText(/- Read src\/Login\.tsx/)).toBeTruthy();
});

it("labels searches, web lookups and other tools", () => {
  render(
    <>
      {card({ kind: "search", state: "finished", subject: "useAuth" })}
      {card({ kind: "web", state: "finished", subject: "vite 7 release" })}
      {card({
        kind: "tool",
        state: "finished",
        title: "linear / create_issue",
      })}
    </>,
  );
  expect(screen.getByText("Searched for useAuth")).toBeTruthy();
  expect(screen.getByText("Searched the web for vite 7 release")).toBeTruthy();
  expect(screen.getByText("Used linear / create_issue")).toBeTruthy();
});

it("shows compaction and messages sent while Claude was working", () => {
  render(
    <>
      {card({ kind: "status", state: "finished", tool: "compact_boundary" })}
      {card({
        kind: "status",
        state: "finished",
        tool: "steer",
        body: "Also add a footer",
      })}
    </>,
  );
  expect(
    screen.getByText("Claude Code compacted the conversation"),
  ).toBeTruthy();
  expect(
    screen.getByText("You, while Claude was working — Also add a footer"),
  ).toBeTruthy();
});

it("keeps multi-line subjects to one title line", () => {
  render(
    card({
      kind: "shell",
      state: "finished",
      subject: "cat <<'EOF' > a.txt\nsecret body\nEOF",
    }),
  );
  expect(screen.getByText("Ran cat <<'EOF' > a.txt")).toBeTruthy();
});
