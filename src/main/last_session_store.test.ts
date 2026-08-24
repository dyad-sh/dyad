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

const record = {
  fileCount: 120,
  totalBytes: 45_000,
  maxFileCount: 120,
  maxTotalBytes: 45_000,
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
  it("round-trips a record", () => {
    writeLastSessionRecord(record);
    expect(readLastSessionRecord()).toEqual(record);
  });

  it("returns null when no record exists", () => {
    expect(readLastSessionRecord()).toBeNull();
  });

  it("returns null for unparseable JSON rather than throwing", () => {
    fs.writeFileSync(RECORD_PATH(), "{not json");
    expect(readLastSessionRecord()).toBeNull();
  });

  it("rejects a record with the wrong shape", () => {
    fs.writeFileSync(
      RECORD_PATH(),
      JSON.stringify({ ...record, fileCount: "many" }),
    );
    expect(readLastSessionRecord()).toBeNull();
  });

  it("rejects a negative count rather than reporting it", () => {
    fs.writeFileSync(
      RECORD_PATH(),
      JSON.stringify({ ...record, fileCount: -1 }),
    );
    expect(readLastSessionRecord()).toBeNull();
  });

  it("leaves no temp file behind", () => {
    writeLastSessionRecord(record);
    expect(fs.readdirSync(userDataDir)).toEqual(["last-session.json"]);
  });

  it("reports failure and does not throw when the write fails", () => {
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(writeLastSessionRecord(record)).toBe(false);
  });

  it("removes the temp file when the rename fails", () => {
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("rename failed");
    });

    expect(writeLastSessionRecord(record)).toBe(false);
    expect(fs.readdirSync(userDataDir)).toEqual([]);
  });
});

describe("clearLastSessionRecord", () => {
  it("removes the record", () => {
    writeLastSessionRecord(record);
    expect(clearLastSessionRecord()).toBe(true);
    expect(readLastSessionRecord()).toBeNull();
  });

  it("counts an already-absent record as cleared", () => {
    expect(clearLastSessionRecord()).toBe(true);
  });
});

describe("claimPreviousSessionAppSize", () => {
  it("returns the previous record and clears it from disk", () => {
    writeLastSessionRecord(record);

    expect(claimPreviousSessionAppSize()).toEqual(record);
    // Cleared, so a session that never measures an app cannot cause these
    // numbers to be attributed to it at the launch after next.
    expect(fs.existsSync(RECORD_PATH())).toBe(false);
  });

  it("retains the record in memory after the file is gone", () => {
    writeLastSessionRecord(record);
    claimPreviousSessionAppSize();

    expect(getPreviousSessionAppSize()).toEqual(record);
  });

  it("reports nothing when the previous session measured no app", () => {
    expect(claimPreviousSessionAppSize()).toBeNull();
    expect(getPreviousSessionAppSize()).toBeNull();
  });

  it("reports nothing when the record cannot be deleted", () => {
    writeLastSessionRecord(record);
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
    recordAppSizeForSession({ appId: 1, fileCount: 5, totalBytes: 50 });

    // This session's own measurement must not be reported as the previous
    // session's, which is why the claim happens before any chat can run.
    expect(getPreviousSessionAppSize()).toBeNull();
  });
});

describe("recordAppSizeForSession", () => {
  it("persists a measurement", () => {
    recordAppSizeForSession({ appId: 42, fileCount: 10, totalBytes: 100 });

    // A session's first measurement is both the most recent and the largest.
    expect(readLastSessionRecord()).toEqual({
      appId: 42,
      fileCount: 10,
      totalBytes: 100,
      maxFileCount: 10,
      maxTotalBytes: 100,
      distinctApps: 1,
    });
  });

  it("keeps the largest app alongside the most recent one", () => {
    recordAppSizeForSession({
      appId: 1,
      fileCount: 5_000,
      totalBytes: 900_000,
    });
    recordAppSizeForSession({ appId: 2, fileCount: 20, totalBytes: 4_000 });

    // Switching to a scratch app before dying would otherwise report 20 files
    // for a session that spent its time in a 5,000-file codebase.
    expect(readLastSessionRecord()).toMatchObject({
      appId: 2,
      fileCount: 20,
      totalBytes: 4_000,
      maxFileCount: 5_000,
      maxTotalBytes: 900_000,
      distinctApps: 2,
    });
  });

  it("moves both max fields together so they describe one app", () => {
    // More files but fewer bytes: max must not mix a count from one app with
    // a byte total from another.
    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 900_000 });
    recordAppSizeForSession({ appId: 2, fileCount: 5_000, totalBytes: 4_000 });

    expect(readLastSessionRecord()).toMatchObject({
      maxFileCount: 10,
      maxTotalBytes: 900_000,
    });
  });

  it("advances the max when the same app grows", () => {
    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });
    recordAppSizeForSession({ appId: 1, fileCount: 30, totalBytes: 400 });

    expect(readLastSessionRecord()).toMatchObject({
      fileCount: 30,
      totalBytes: 400,
      maxFileCount: 30,
      maxTotalBytes: 400,
      distinctApps: 1,
    });
  });

  it("counts distinct apps", () => {
    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });
    recordAppSizeForSession({ appId: 2, fileCount: 900, totalBytes: 90_000 });

    // Size is attributed to the last app measured; distinctApps flags that the
    // attribution is not unambiguous.
    expect(readLastSessionRecord()).toMatchObject({
      appId: 2,
      distinctApps: 2,
    });
  });

  it("skips the write when the measurement is unchanged", () => {
    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    for (let i = 0; i < 3; i++) {
      recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });
    }

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("retries after a failed write instead of treating it as recorded", () => {
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });

    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });
    expect(readLastSessionRecord()).toBeNull();

    // The identical measurement must not look unchanged, or the size would be
    // lost for the rest of the session.
    writeSpy.mockRestore();
    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });

    expect(readLastSessionRecord()).toMatchObject({
      appId: 1,
      fileCount: 10,
      distinctApps: 1,
    });
  });

  it("remembers an app whose write failed", () => {
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    recordAppSizeForSession({
      appId: 1,
      fileCount: 5_000,
      totalBytes: 900_000,
    });
    writeSpy.mockRestore();

    recordAppSizeForSession({ appId: 2, fileCount: 20, totalBytes: 4_000 });

    // What the session saw is a fact about the session, not about the disk. If
    // the failed measurement were forgotten, this record would claim a
    // single-app session and slip past the distinctApps filter with the
    // largest app erased.
    expect(readLastSessionRecord()).toMatchObject({
      appId: 2,
      fileCount: 20,
      maxFileCount: 5_000,
      maxTotalBytes: 900_000,
      distinctApps: 2,
    });
  });

  it("writes an unchanged measurement when the max drifted during a failed write", () => {
    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });

    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    recordAppSizeForSession({
      appId: 2,
      fileCount: 5_000,
      totalBytes: 900_000,
    });
    writeSpy.mockRestore();

    // Back to app 1 at exactly the size already on disk. The measurement is
    // unchanged, but the record is not, so skipping the write would leave the
    // session claiming a single-app 100-byte session with the large app gone.
    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });

    expect(readLastSessionRecord()).toEqual({
      appId: 1,
      fileCount: 10,
      totalBytes: 100,
      maxFileCount: 5_000,
      maxTotalBytes: 900_000,
      distinctApps: 2,
    });
  });

  it("writes again once the codebase actually changes", () => {
    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });
    recordAppSizeForSession({ appId: 1, fileCount: 11, totalBytes: 120 });

    // Re-measuring the same app must not consume another distinctApps slot.
    expect(readLastSessionRecord()).toMatchObject({
      fileCount: 11,
      totalBytes: 120,
      distinctApps: 1,
    });

    recordAppSizeForSession({ appId: 2, fileCount: 5, totalBytes: 50 });

    expect(readLastSessionRecord()).toMatchObject({
      appId: 2,
      distinctApps: 2,
    });
  });

  it("writes again when the same size is measured for a different app", () => {
    recordAppSizeForSession({ appId: 1, fileCount: 10, totalBytes: 100 });
    recordAppSizeForSession({ appId: 2, fileCount: 10, totalBytes: 100 });

    // Identical numbers for a different app is a real app switch, not a
    // repeat, so it must not be skipped by the unchanged check.
    expect(readLastSessionRecord()).toMatchObject({
      appId: 2,
      distinctApps: 2,
    });
  });
});
