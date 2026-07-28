import { describe, expect, it } from "vitest";
import { initialWindowNavigation } from "./initial_window_navigation";

describe("initialWindowNavigation", () => {
  it("restores an app details route", () => {
    expect(initialWindowNavigation({ kind: "app", id: 7 })).toEqual({
      to: "/app-details",
      search: { appId: 7 },
    });
  });

  it("restores the selected chat route instead of downgrading to app details", () => {
    expect(initialWindowNavigation({ kind: "chat", id: 11 })).toEqual({
      to: "/chat",
      search: { id: 11 },
    });
  });
});
