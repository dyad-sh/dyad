import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContentCalendar } from "./ContentCalendar";
import type { PlannerTask } from "@/lib/planner_tasks";

describe("ContentCalendar", () => {
  it("shows custom tasks and opens their editor", () => {
    const onSelectTask = vi.fn();
    const task: PlannerTask = {
      id: "task-1",
      title: "Prepare launch brief",
      notes: "",
      dueAt: Date.now(),
      priority: "high",
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    render(
      <ContentCalendar
        posts={[]}
        tasks={[task]}
        onSelectDay={vi.fn()}
        onSelectPost={vi.fn()}
        onSelectTask={onSelectTask}
      />,
    );

    fireEvent.click(screen.getByTestId("calendar-task-task-1"));
    expect(onSelectTask).toHaveBeenCalledWith(task);
  });

  it("opens task creation when an empty calendar day is clicked", () => {
    const onSelectDay = vi.fn();
    render(
      <ContentCalendar
        posts={[]}
        tasks={[]}
        onSelectDay={onSelectDay}
        onSelectPost={vi.fn()}
        onSelectTask={vi.fn()}
      />,
    );

    const today = new Date();
    const key = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    fireEvent.click(screen.getByTestId(`calendar-day-${key}`));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
  });
});
