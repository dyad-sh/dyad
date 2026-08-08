import { atomWithStorage } from "jotai/utils";
import type { PlannerTask } from "@/lib/planner_tasks";

export const plannerTasksAtom = atomWithStorage<PlannerTask[]>(
  "planner-custom-tasks",
  [],
);
