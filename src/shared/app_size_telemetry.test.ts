import { describe, expect, it } from "vitest";
import {
  appSizeEventFields,
  type SessionAppSizeRecord,
} from "./app_size_telemetry";

const lane = (
  overrides: Partial<SessionAppSizeRecord> = {},
): SessionAppSizeRecord => ({
  fileCount: 250,
  totalBytes: 1_200_000,
  appId: 3,
  distinctApps: 1,
  ...overrides,
});

describe("appSizeEventFields", () => {
  it("flattens both lanes into scalar properties", () => {
    expect(
      appSizeEventFields({ viewed: lane(), chatted: lane({ fileCount: 40 }) }),
    ).toEqual({
      has_prev_session_viewed_size: true,
      prev_session_viewed_file_count: 250,
      prev_session_viewed_bytes: 1_200_000,
      prev_session_viewed_distinct_apps: 1,
      has_prev_session_chat_size: true,
      prev_session_chat_file_count: 40,
      prev_session_chat_bytes: 1_200_000,
      prev_session_chat_distinct_apps: 1,
      prev_session_lanes_same_app: true,
    });
  });

  it("emits only scalars, since PostHog cannot aggregate nested JSON", () => {
    const fields = appSizeEventFields({ viewed: lane(), chatted: lane() });

    for (const value of Object.values(fields)) {
      expect(["number", "boolean", "string"]).toContain(typeof value);
    }
  });

  it("reports each lane independently", () => {
    // Browsed an app but never sent a message.
    const fields = appSizeEventFields({ viewed: lane() });

    expect(fields.has_prev_session_viewed_size).toBe(true);
    expect(fields.has_prev_session_chat_size).toBe(false);
    expect(fields).not.toHaveProperty("prev_session_chat_file_count");
  });

  it("omits both lanes when there is no record", () => {
    // Absent, not zeroed: a session with no app isn't a zero-size app.
    const expected = {
      has_prev_session_viewed_size: false,
      has_prev_session_chat_size: false,
    };
    expect(appSizeEventFields(null)).toEqual(expected);
    expect(appSizeEventFields(undefined)).toEqual(expected);
    expect(appSizeEventFields({})).toEqual(expected);
  });

  it("flags when the lanes measured different apps", () => {
    const fields = appSizeEventFields({
      viewed: lane({ appId: 1, fileCount: 2_000 }),
      chatted: lane({ appId: 2, fileCount: 30 }),
    });

    expect(fields.prev_session_lanes_same_app).toBe(false);
    expect(fields.prev_session_viewed_file_count).toBe(2_000);
    expect(fields.prev_session_chat_file_count).toBe(30);
  });

  it("omits the agreement flag when only one lane is present", () => {
    expect(appSizeEventFields({ viewed: lane() })).not.toHaveProperty(
      "prev_session_lanes_same_app",
    );
  });

  it("emits only file counts and bytes per lane", () => {
    // Both metrics come from the filesystem, so nothing here depends on chat
    // mode, the engine, or smart context. Line counts were deliberately
    // dropped: they were the only size figure that did.
    const keys = Object.keys(appSizeEventFields({ viewed: lane() }));

    expect(keys.filter((k) => k.includes("lines"))).toEqual([]);
    expect(keys.filter((k) => k.includes("context_filtered"))).toEqual([]);
    expect(keys.filter((k) => k.includes("age"))).toEqual([]);
  });
});
