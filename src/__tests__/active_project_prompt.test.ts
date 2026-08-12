import { beforeEach, describe, expect, it, vi } from "vitest";

const settings: { activeProjectId?: string | null } = {};
const rows: Array<{ id: string; name: string; instructions: string | null }> =
  [];

vi.mock("@/main/settings", () => ({
  readSettings: () => settings,
}));
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => rows,
        }),
      }),
    }),
  },
}));

const { activeProjectPrompt } = await import("@/ipc/utils/active_project");

/**
 * The project's instructions reach the model, so the cases that matter are the
 * ones where they should not: no project, a deleted project, or a project with
 * nothing written in it. Each must produce an empty string, because the caller
 * concatenates the result unconditionally and a stray heading would otherwise
 * appear in every prompt.
 */
describe("active project prompt", () => {
  beforeEach(() => {
    rows.length = 0;
    settings.activeProjectId = undefined;
  });

  it("is empty when no project is active", async () => {
    expect(await activeProjectPrompt()).toBe("");
  });

  it("is empty when the active project no longer exists", async () => {
    settings.activeProjectId = "gone";
    expect(await activeProjectPrompt()).toBe("");
  });

  it("is empty when the project has nothing in it", async () => {
    settings.activeProjectId = "p1";
    rows.push({ id: "p1", name: "Client work", instructions: null });
    expect(await activeProjectPrompt()).toBe("");

    rows[0].instructions = "   \n  ";
    expect(await activeProjectPrompt()).toBe("");
  });

  it("uses the conversation's project rather than the active one", async () => {
    // The whole point of a project sitting above a conversation: a chat
    // started inside one keeps its instructions after the user moves on.
    settings.activeProjectId = "other";
    rows.push({
      id: "p1",
      name: "Client work",
      instructions: "British spelling.",
    });

    expect(await activeProjectPrompt("p1")).toContain("Client work");
  });

  it("treats an explicit null as no project at all", async () => {
    // A conversation started outside every project stays outside, even while
    // one is active. Undefined means "no conversation", which falls back.
    settings.activeProjectId = "p1";
    rows.push({
      id: "p1",
      name: "Client work",
      instructions: "British spelling.",
    });

    expect(await activeProjectPrompt(null)).toBe("");
    expect(await activeProjectPrompt()).toContain("Client work");
  });

  it("labels the instructions as the user's rather than the app's", async () => {
    settings.activeProjectId = "p1";
    rows.push({
      id: "p1",
      name: "Client work",
      instructions: "British spelling.",
    });

    const prompt = await activeProjectPrompt();
    expect(prompt).toContain("## Project: Client work");
    expect(prompt).toContain("British spelling.");
    // The model must be able to tell a standing preference from a rule.
    expect(prompt).toContain("Standing instructions from the user");
  });
});
