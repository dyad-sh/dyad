import { describe, expect, it } from "vitest";
import {
  appSizeEventFields,
  type SessionAppSizeRecord,
} from "./app_size_telemetry";

const record = (
  overrides: Partial<SessionAppSizeRecord> = {},
): SessionAppSizeRecord => ({
  fileCount: 250,
  totalBytes: 1_200_000,
  appId: 3,
  distinctApps: 1,
  ...overrides,
});

describe("appSizeEventFields", () => {
  it("flattens the record into scalar properties", () => {
    expect(appSizeEventFields(record())).toEqual({
      prev_session_app_file_count: 250,
      prev_session_app_bytes: 1_200_000,
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

  it("carries the distinct app count so ambiguous sessions can be filtered", () => {
    expect(
      appSizeEventFields(record({ distinctApps: 3 }))
        .prev_session_distinct_apps,
    ).toBe(3);
  });

  it("does not emit the app id", () => {
    // The id identifies which app locally; it means nothing across installs.
    expect(Object.keys(appSizeEventFields(record()))).not.toContain(
      "prev_session_app_id",
    );
  });
});
