export type PlannerTaskPriority = "low" | "medium" | "high";

export type PlannerTask = {
  id: string;
  title: string;
  notes: string;
  dueAt: number;
  priority: PlannerTaskPriority;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
};

export function sortPlannerTasks(tasks: PlannerTask[]): PlannerTask[] {
  return [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.dueAt - b.dueAt;
  });
}

export function upsertPlannerTask(
  tasks: PlannerTask[],
  task: PlannerTask,
): PlannerTask[] {
  const exists = tasks.some((item) => item.id === task.id);
  return sortPlannerTasks(
    exists
      ? tasks.map((item) => (item.id === task.id ? task : item))
      : [...tasks, task],
  );
}
