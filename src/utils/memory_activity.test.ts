import { describe, it, expect, beforeEach } from "vitest";
import {
  extractCodebaseStarted,
  extractCodebaseFinished,
  isExtractCodebaseActive,
  resetExtractCodebaseCount,
} from "@/utils/memory_activity";

describe("memory_activity", () => {
  beforeEach(() => {
    resetExtractCodebaseCount();
  });

  it("is inactive by default", () => {
    expect(isExtractCodebaseActive()).toBe(false);
  });

  it("is active while at least one extraction is in flight", () => {
    extractCodebaseStarted();
    extractCodebaseStarted();
    extractCodebaseFinished();
    expect(isExtractCodebaseActive()).toBe(true);
    extractCodebaseFinished();
    expect(isExtractCodebaseActive()).toBe(false);
  });

  it("does not go negative on unbalanced finishes", () => {
    extractCodebaseFinished();
    extractCodebaseStarted();
    expect(isExtractCodebaseActive()).toBe(true);
  });
});
