import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContentCalendar } from "./ContentCalendar";
import type { PlannerTask } from "@/lib/planner_tasks";
import type { SocialPost } from "@/ipc/types/social_media";

describe("ContentCalendar", () => {
  it("uses semantic theme surfaces instead of a forced dark calendar", () => {
    render(
      <ContentCalendar
        posts={[]}
        tasks={[]}
        onSelectDay={vi.fn()}
        onSelectPost={vi.fn()}
        onSelectTask={vi.fn()}
      />,
    );

    const calendar = screen.getByTestId("content-calendar");
    expect(calendar.className).toContain("bg-card");
    expect(calendar.className).toContain("border-border");
    expect(calendar.className).not.toContain("rgba(8,20,40");
  });

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

  it("keeps crowded post days compact instead of clipping the calendar", () => {
    const now = Date.now();
    const posts: SocialPost[] = Array.from({ length: 3 }, (_, index) => ({
      id: `post-${index}`,
      platform: "x",
      content: `Post ${index}`,
      image: null,
      prompt: null,
      status: "posted",
      scheduledFor: null,
      postedAt: now + index,
      externalId: String(index),
      externalUrl: `https://x.com/example/status/${index}`,
      error: null,
      metrics: null,
      metricsUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    }));

    render(
      <ContentCalendar
        posts={posts}
        tasks={[]}
        onSelectDay={vi.fn()}
        onSelectPost={vi.fn()}
        onSelectTask={vi.fn()}
      />,
    );

    expect(screen.getByTestId("calendar-post-post-0").className).toContain(
      "h-5",
    );
    expect(screen.getByTestId("calendar-post-post-1")).toBeTruthy();
    expect(screen.queryByTestId("calendar-post-post-2")).toBeNull();
    expect(screen.getByText("+1 more")).toBeTruthy();
    expect(
      screen.getByTestId(
        `calendar-day-${new Date(now).getFullYear()}-${String(new Date(now).getMonth() + 1).padStart(2, "0")}-${String(new Date(now).getDate()).padStart(2, "0")}`,
      ).className,
    ).toContain("min-h-[4.5rem]");
  });
});
