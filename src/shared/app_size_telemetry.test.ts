import { describe, expect, it } from "vitest";
import {
  appSizeEventFields,
  type AppSizeTelemetry,
} from "./app_size_telemetry";

const record = (
  overrides: Partial<AppSizeTelemetry> = {},
): AppSizeTelemetry => ({
  fileCount: 250,
  totalBytes: 1_200_000,
  maxFileCount: 250,
  maxTotalBytes: 1_200_000,
  distinctApps: 1,
  ...overrides,
});

describe("appSizeEventFields", () => {
  it("flattens the record into scalar properties", () => {
    expect(appSizeEventFields(record())).toEqual({
      prev_session_app_file_count: 250,
      prev_session_app_bytes: 1_200_000,
      prev_session_max_app_file_count: 250,
      prev_session_max_app_bytes: 1_200_000,
      prev_session_distinct_apps: 1,
    });
  });

  it("emits only scalars, since PostHog cannot aggregate nested JSON", () => {
    for (const value of Object.values(appSizeEventFields(record()))) {
      expect(["number", "boolean", "string"]).toContain(typeof value);
    }
  });

  it("emits nothing when there is no record", () => {
    // Absent, not zeroed: a session with no app isn't a zero-size app.
    expect(appSizeEventFields(null)).toEqual({});
    expect(appSizeEventFields(undefined)).toEqual({});
  });

  it("reports the most recent and the largest app separately", () => {
    // A session that worked in a big app and then switched to a scratch one.
    const fields = appSizeEventFields(
      record({
        fileCount: 20,
        totalBytes: 4_000,
        maxFileCount: 5_000,
        maxTotalBytes: 900_000,
        distinctApps: 2,
      }),
    );

    expect(fields.prev_session_app_file_count).toBe(20);
    expect(fields.prev_session_max_app_file_count).toBe(5_000);
    // Bytes is what max is chosen on, so this is the pair that matters most.
    // Every other fixture has recent === max, which cannot tell them apart.
    expect(fields.prev_session_app_bytes).toBe(4_000);
    expect(fields.prev_session_max_app_bytes).toBe(900_000);
  });

  it("carries the distinct app count so ambiguous sessions can be filtered", () => {
    expect(
      appSizeEventFields(record({ distinctApps: 3 }))
        .prev_session_distinct_apps,
    ).toBe(3);
  });

  it("uses snake_case throughout to match app:crash_detected", () => {
    for (const key of Object.keys(appSizeEventFields(record()))) {
      expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
