import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isReady: () => false,
    whenReady: () => new Promise<void>(() => undefined),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import { vectorRestartDelay } from "./vector_service_manager";

describe("Vector service supervisor", () => {
  it("backs off failed restarts and caps the recovery delay", () => {
    expect(vectorRestartDelay(0)).toBe(1_000);
    expect(vectorRestartDelay(1)).toBe(2_000);
    expect(vectorRestartDelay(4)).toBe(16_000);
    expect(vectorRestartDelay(5)).toBe(30_000);
    expect(vectorRestartDelay(20)).toBe(30_000);
  });
});
