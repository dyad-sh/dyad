import { describe, expect, it } from "vitest";
import { shouldFilterTelemetryException } from "@/ipc/utils/telemetry";

describe("shouldFilterTelemetryException", () => {
  it("filters the known Supabase auth noise message", () => {
    expect(
      shouldFilterTelemetryException(
        new Error(
          "Supabase access token not found. Please authenticate first.",
        ),
      ),
    ).toBe(true);
  });

  it("does not filter different Supabase auth failures", () => {
    expect(
      shouldFilterTelemetryException(
        new Error(
          "Supabase access token not found for organization acme. Please authenticate first.",
        ),
      ),
    ).toBe(false);
  });
});
