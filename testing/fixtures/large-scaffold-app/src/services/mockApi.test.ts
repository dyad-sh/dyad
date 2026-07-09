import { describe, expect, it } from "vitest";
import { getProject, getProjects, getWorkspaceOverview } from "./mockApi";

describe("mock api", () => {
  it("returns deterministic projects", async () => {
    const projects = await getProjects();
    expect(projects.length).toBeGreaterThan(50);
    expect(await getProject(projects[0].id)).toEqual(projects[0]);
  });

  it("returns overview rollups", async () => {
    const overview = await getWorkspaceOverview();
    expect(overview.projects).toBeGreaterThan(50);
    expect(overview.revenue).toBeGreaterThan(0);
  });
});
