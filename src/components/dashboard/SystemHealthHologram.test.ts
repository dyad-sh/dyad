import { describe, expect, it } from "vitest";

import { buildDashboardNotifications } from "./SystemHealthHologram";

describe("dashboard notification summary", () => {
  it("promotes unhealthy services ahead of recent activity", () => {
    const notices = buildDashboardNotifications(
      [
        {
          id: "storage",
          label: "Storage",
          status: "No vault connected",
          tone: "attention",
          to: "/storage",
        },
        {
          id: "providers",
          label: "AI Providers",
          status: "2 connected",
          tone: "healthy",
          to: "/settings",
        },
      ],
      [
        {
          id: "indexed",
          message: "Indexed project notes",
          at: "2026-08-18T08:00:00.000Z",
          tone: "success",
        },
      ],
    );

    expect(notices).toMatchObject([
      { id: "health-storage", tone: "attention" },
      { id: "activity-indexed", tone: "info" },
    ]);
  });

  it("does not invent alerts when every service is healthy", () => {
    expect(
      buildDashboardNotifications(
        [
          {
            id: "storage",
            label: "Storage",
            status: "Online",
            tone: "healthy",
            to: "/storage",
          },
        ],
        [],
      ),
    ).toEqual([]);
  });
});
