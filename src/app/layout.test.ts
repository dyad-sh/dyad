import { describe, expect, it } from "vitest";
import { isScrollableMainRoute } from "./layout";

describe("isScrollableMainRoute", () => {
  it("enables page scrolling for tall manager pages", () => {
    expect(isScrollableMainRoute("/settings")).toBe(true);
    expect(isScrollableMainRoute("/github")).toBe(true);
    expect(isScrollableMainRoute("/github/repos")).toBe(true);
    expect(isScrollableMainRoute("/vercel")).toBe(true);
    expect(isScrollableMainRoute("/library")).toBe(true);
  });

  it("keeps app-like routes fixed height", () => {
    expect(isScrollableMainRoute("/")).toBe(false);
    expect(isScrollableMainRoute("/coder")).toBe(false);
    expect(isScrollableMainRoute("/chat-agent")).toBe(false);
  });
});
