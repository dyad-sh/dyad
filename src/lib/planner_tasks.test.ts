import { describe, expect, it } from "vitest";
import {
  sortPlannerTasks,
  upsertPlannerTask,
  type PlannerTask,
} from "./planner_tasks";

function task(id: string, dueAt: number, completed = false): PlannerTask {
  return {
    id,
    title: id,
    notes: "",
    dueAt,
    priority: "medium",
    completed,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("planner tasks", () => {
  it("keeps upcoming tasks first and completed tasks last", () => {
    expect(
      sortPlannerTasks([
        task("done", 1, true),
        task("later", 20),
        task("now", 10),
      ]).map(({ id }) => id),
    ).toEqual(["now", "later", "done"]);
  });

  it("updates an existing task without creating a duplicate", () => {
    expect(
      upsertPlannerTask([task("a", 1)], {
        ...task("a", 2),
        title: "Updated",
      }),
    ).toHaveLength(1);
  });
});
