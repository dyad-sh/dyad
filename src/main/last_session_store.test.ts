import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let userDataDir: string;

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock("../paths/paths", () => ({
  getUserDataPath: () => userDataDir,
}));

import {
  claimPreviousSessionAppSize,
  clearLastSessionRecord,
  getPreviousSessionAppSize,
  readLastSessionRecord,
  recordAppSizeForSession,
  resetSessionStateForTesting,
  writeLastSessionRecord,
} from "./last_session_store";

const RECORD_PATH = () => path.join(userDataDir, "last-session.json");

const laneRecord = {
  fileCount: 120,
  totalBytes: 45_000,
  appId: 7,
  distinctApps: 1,
};

beforeEach(async () => {
  userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "last-sess-"));
  resetSessionStateForTesting();
});

afterEach(async () => {
  await fs.promises.rm(userDataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("writeLastSessionRecord / readLastSessionRecord", () => {
  it("round-trips both lanes", () => {
    const record = { viewed: laneRecord, chatted: { ...laneRecord, appId: 8 } };
    writeLastSessionRecord(record);
    expect(readLastSessionRecord()).toEqual(record);
  });

  it("round-trips a single lane", () => {
    writeLastSessionRecord({ viewed: laneRecord });
    expect(readLastSessionRecord()).toEqual({ viewed: laneRecord });
  });

  it("returns null when no record exists", () => {
    expect(readLastSessionRecord()).toBeNull();
  });

  it("returns null for unparseable JSON rather than throwing", () => {
    fs.writeFileSync(RECORD_PATH(), "{not json");
    expect(readLastSessionRecord()).toBeNull();
  });

  it("rejects a lane with the wrong shape", () => {
    fs.writeFileSync(
      RECORD_PATH(),
      JSON.stringify({ viewed: { ...laneRecord, fileCount: "many" } }),
    );
    expect(readLastSessionRecord()).toBeNull();
  });

  it("rejects a negative count rather than reporting it", () => {
    fs.writeFileSync(
      RECORD_PATH(),
      JSON.stringify({ chatted: { ...laneRecord, fileCount: -1 } }),
    );
    expect(readLastSessionRecord()).toBeNull();
  });

  it("leaves no temp file behind", () => {
    writeLastSessionRecord({ viewed: laneRecord });
    expect(fs.readdirSync(userDataDir)).toEqual(["last-session.json"]);
  });

  it("does not throw when the record cannot be written", () => {
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(() => writeLastSessionRecord({ viewed: laneRecord })).not.toThrow();
  });

  it("removes the temp file when the rename fails", () => {
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("rename failed");
    });

    writeLastSessionRecord({ viewed: laneRecord });

    expect(fs.readdirSync(userDataDir)).toEqual([]);
  });
});

describe("clearLastSessionRecord", () => {
  it("removes the record", () => {
    writeLastSessionRecord({ viewed: laneRecord });
    clearLastSessionRecord();
    expect(readLastSessionRecord()).toBeNull();
  });

  it("is a no-op when there is nothing to clear", () => {
    expect(() => clearLastSessionRecord()).not.toThrow();
  });
});

describe("claimPreviousSessionAppSize", () => {
  it("returns the previous record and clears it from disk", () => {
    writeLastSessionRecord({ viewed: laneRecord });

    expect(claimPreviousSessionAppSize()).toEqual({ viewed: laneRecord });
    // Cleared, so a session that never measures an app cannot cause these
    // numbers to be attributed to it at the launch after next.
    expect(fs.existsSync(RECORD_PATH())).toBe(false);
  });

  it("retains the record in memory after the file is gone", () => {
    writeLastSessionRecord({ chatted: laneRecord });
    claimPreviousSessionAppSize();

    expect(getPreviousSessionAppSize()).toEqual({ chatted: laneRecord });
  });

  it("reports nothing when the previous session measured no app", () => {
    expect(claimPreviousSessionAppSize()).toBeNull();
    expect(getPreviousSessionAppSize()).toBeNull();
  });

  it("reports nothing when the record cannot be deleted", () => {
    writeLastSessionRecord({ viewed: laneRecord });
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw new Error("permission denied");
    });

    // A record still on disk would be re-reported at every later launch, so an
    // incomplete claim reports nothing at all.
    expect(claimPreviousSessionAppSize()).toBeNull();
    expect(getPreviousSessionAppSize()).toBeNull();
  });

  it("does not resurrect a record written after the claim", () => {
    claimPreviousSessionAppSize();
    recordAppSizeForSession({
      lane: "viewed",
      appId: 1,
      fileCount: 5,
      totalBytes: 50,
    });

    // This session's own measurement must not be reported as the previous
    // session's, which is why the claim happens before any chat can run.
    expect(getPreviousSessionAppSize()).toBeNull();
  });
});

describe("recordAppSizeForSession", () => {
  it("persists a measurement on the lane it was recorded for", () => {
    recordAppSizeForSession({
      lane: "chatted",
      appId: 42,
      fileCount: 10,
      totalBytes: 100,
    });

    const record = readLastSessionRecord();
    expect(record?.chatted).toMatchObject({
      appId: 42,
      fileCount: 10,
      totalBytes: 100,
      distinctApps: 1,
    });
    expect(record?.viewed).toBeUndefined();
  });

  it("keeps the two lanes independent", () => {
    recordAppSizeForSession({
      lane: "viewed",
      appId: 1,
      fileCount: 2_000,
      totalBytes: 900_000,
    });
    recordAppSizeForSession({
      lane: "chatted",
      appId: 2,
      fileCount: 30,
      totalBytes: 4_000,
    });

    const record = readLastSessionRecord();
    // Writing one lane must not clobber the other; this is the case that
    // distinguishes browsing a big app from working in a small one.
    expect(record?.viewed).toMatchObject({ appId: 1, fileCount: 2_000 });
    expect(record?.chatted).toMatchObject({ appId: 2, fileCount: 30 });
  });

  it("counts distinct apps per lane", () => {
    recordAppSizeForSession({
      lane: "viewed",
      appId: 1,
      fileCount: 10,
      totalBytes: 100,
    });
    recordAppSizeForSession({
      lane: "viewed",
      appId: 2,
      fileCount: 900,
      totalBytes: 90_000,
    });
    recordAppSizeForSession({
      lane: "chatted",
      appId: 2,
      fileCount: 900,
      totalBytes: 90_000,
    });

    const record = readLastSessionRecord();
    // Size is attributed to the last app measured; distinctApps flags that the
    // viewed lane's attribution is not unambiguous, while the chat lane's is.
    expect(record?.viewed).toMatchObject({ appId: 2, distinctApps: 2 });
    expect(record?.chatted).toMatchObject({ appId: 2, distinctApps: 1 });
  });

  it("skips the write when the measurement is unchanged", () => {
    recordAppSizeForSession({
      lane: "viewed",
      appId: 1,
      fileCount: 10,
      totalBytes: 100,
    });
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    // Re-selecting the same app refires the effect; an unchanged codebase
    // must not rewrite the file each time.
    for (let i = 0; i < 3; i++) {
      recordAppSizeForSession({
        lane: "viewed",
        appId: 1,
        fileCount: 10,
        totalBytes: 100,
      });
    }

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("retries after a failed write instead of treating it as recorded", () => {
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });

    recordAppSizeForSession({
      lane: "viewed",
      appId: 1,
      fileCount: 10,
      totalBytes: 100,
    });
    expect(readLastSessionRecord()).toBeNull();

    // The identical measurement must not look unchanged, or the lane would be
    // lost for the rest of the session.
    writeSpy.mockRestore();
    recordAppSizeForSession({
      lane: "viewed",
      appId: 1,
      fileCount: 10,
      totalBytes: 100,
    });

    expect(readLastSessionRecord()?.viewed).toMatchObject({
      appId: 1,
      fileCount: 10,
      distinctApps: 1,
    });
  });

  it("writes again once the codebase actually changes", () => {
    recordAppSizeForSession({
      lane: "viewed",
      appId: 1,
      fileCount: 10,
      totalBytes: 100,
    });
    recordAppSizeForSession({
      lane: "viewed",
      appId: 1,
      fileCount: 11,
      totalBytes: 120,
    });

    // Re-measuring the same app must not consume another distinctApps slot.
    expect(readLastSessionRecord()?.viewed).toMatchObject({
      fileCount: 11,
      totalBytes: 120,
      distinctApps: 1,
    });

    recordAppSizeForSession({
      lane: "viewed",
      appId: 2,
      fileCount: 5,
      totalBytes: 50,
    });

    expect(readLastSessionRecord()?.viewed).toMatchObject({
      appId: 2,
      distinctApps: 2,
    });
  });

  it("writes again when the same size is measured for a different app", () => {
    recordAppSizeForSession({
      lane: "viewed",
      appId: 1,
      fileCount: 10,
      totalBytes: 100,
    });
    recordAppSizeForSession({
      lane: "viewed",
      appId: 2,
      fileCount: 10,
      totalBytes: 100,
    });

    // Identical numbers for a different app is a real app switch, not a
    // repeat, so it must not be skipped by the unchanged check.
    expect(readLastSessionRecord()?.viewed).toMatchObject({
      appId: 2,
      distinctApps: 2,
    });
  });
});
