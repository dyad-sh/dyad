import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MinidumpSummary } from "@/utils/minidump_summary";

const parsed = vi.hoisted(() => new Map<string, MinidumpSummary | null>());

// Parsing has its own tests; here each file's content names the summary
// it parses to.
const parseMinidumpBuffer = vi.hoisted(() =>
  vi.fn((buf: Buffer) => parsed.get(buf.toString()) ?? null),
);
vi.mock("@/utils/minidump_summary", () => ({ parseMinidumpBuffer }));

const { collectCrashDumps } = await import("@/utils/crash_dump_report");

describe("collectCrashDumps", () => {
  let dir: string;
  let crashpadDir: string;

  function makeDump(
    name: string,
    content: string,
    ageSeconds: number,
    inDir = dir,
  ) {
    const dump = path.join(inDir, name);
    fs.mkdirSync(path.dirname(dump), { recursive: true });
    fs.writeFileSync(dump, content);
    const t = new Date("2026-07-15T20:00:00Z").getTime() / 1000 - ageSeconds;
    fs.utimesSync(dump, t, t);
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-dump-report-test-"));
    crashpadDir = path.join(dir, "Crashpad");
    parsed.clear();
    parseMinidumpBuffer.mockClear();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports each dump newest first, with its crash details and stack", async () => {
    const stackTrace = {
      modules: [{ name: "dyad", debugFile: "dyad", debugId: "ABC0" }],
      threads: [
        {
          crashing: true,
          main: true,
          frames: [{ module: 0, offset: "0x10" as const }],
        },
      ],
    };
    parsed.set("browser", {
      exceptionCode: 11,
      crashReason: "SIGSEGV",
      faultAddress: "0x0",
      faultingModule: "dyad",
      ptype: "browser",
      annotations: {
        ptype: "browser",
        "switch-1": "--user-data-dir=/home/jo/.config/dyad",
      },
      stackTrace,
    });
    makeDump("crash-old.dmp", "garbage", 60);
    makeDump("crash-new.dmp", "browser", 0);

    expect(await collectCrashDumps(dir, crashpadDir)).toEqual([
      {
        file: "crash-new.dmp",
        crashedAt: "2026-07-15T20:00:00.000Z",
        readable: true,
        ptype: "browser",
        crashReason: "SIGSEGV",
        exceptionCode: 11,
        faultAddress: "0x0",
        // Only the keys crash telemetry keeps; switches carry paths.
        annotations: { ptype: "browser" },
        stack: stackTrace,
      },
      {
        file: "crash-old.dmp",
        crashedAt: "2026-07-15T19:59:00.000Z",
        readable: false,
      },
    ]);
  });

  it("asks the parser for stacks, with this machine's platform and arch", async () => {
    makeDump("crash-new.dmp", "browser", 0);
    await collectCrashDumps(dir, crashpadDir, "linux", "arm64");
    expect(parseMinidumpBuffer).toHaveBeenCalledWith(
      Buffer.from("browser"),
      "linux",
      "arm64",
      { stackTrace: true },
    );
  });

  it("includes dumps written since startup and keeps the newest five", async () => {
    for (let i = 1; i <= 5; i++) makeDump(`crash-${i}.dmp`, "kept", i * 60);
    makeDump(path.join("pending", "since-startup.dmp"), "new", 0, crashpadDir);

    const files = (await collectCrashDumps(dir, crashpadDir)).map(
      (dump) => dump.file,
    );
    expect(files).toEqual([
      "since-startup.dmp",
      "crash-1.dmp",
      "crash-2.dmp",
      "crash-3.dmp",
      "crash-4.dmp",
    ]);
  });

  it("keeps a dump it cannot read rather than dropping it", async () => {
    makeDump("crash-locked.dmp", "browser", 0);
    const read = vi
      .spyOn(fsp, "readFile")
      .mockRejectedValue(Object.assign(new Error("locked"), { code: "EBUSY" }));
    try {
      expect(await collectCrashDumps(dir, crashpadDir)).toEqual([
        {
          file: "crash-locked.dmp",
          crashedAt: "2026-07-15T20:00:00.000Z",
          readable: false,
        },
      ]);
    } finally {
      read.mockRestore();
    }
  });

  it("takes the crash time from a kept dump's name when it cannot stat it", async () => {
    makeDump("crash-2026-06-07T20-41-55-123Z-9ac4d4e8.dmp", "garbage", 0);
    const stat = vi
      .spyOn(fsp, "stat")
      .mockRejectedValue(
        Object.assign(new Error("denied"), { code: "EACCES" }),
      );
    try {
      const [dump] = await collectCrashDumps(dir, crashpadDir);
      expect(dump.crashedAt).toBe("2026-06-07T20:41:55.123Z");
    } finally {
      stat.mockRestore();
    }
  });

  it("ranks a dump it cannot stat by the time in its name", async () => {
    for (let i = 1; i <= 5; i++) makeDump(`crash-${i}.dmp`, "kept", i * 60);
    const newest = "crash-2026-07-15T20-30-00-000Z-9ac4d4e8.dmp";
    // Older on disk than the rest, so only its name can put it first.
    makeDump(newest, "garbage", 3600);
    const realStat = fsp.stat;
    const stat = vi
      .spyOn(fsp, "stat")
      .mockImplementation((p, ...rest) =>
        String(p).endsWith(newest)
          ? Promise.reject(
              Object.assign(new Error("denied"), { code: "EACCES" }),
            )
          : realStat(p, ...rest),
      );
    try {
      const files = (await collectCrashDumps(dir, crashpadDir)).map(
        (dump) => dump.file,
      );
      expect(files[0]).toBe(newest);
      expect(files).toHaveLength(5);
    } finally {
      stat.mockRestore();
    }
  });

  it("skips a dump removed after it was listed", async () => {
    makeDump("crash-gone.dmp", "browser", 0);
    const read = vi
      .spyOn(fsp, "readFile")
      .mockRejectedValue(Object.assign(new Error("gone"), { code: "ENOENT" }));
    try {
      expect(await collectCrashDumps(dir, crashpadDir)).toEqual([]);
    } finally {
      read.mockRestore();
    }
  });

  it("returns nothing for missing directories", async () => {
    expect(
      await collectCrashDumps(
        path.join(dir, "missing"),
        path.join(dir, "missing-crashpad"),
      ),
    ).toEqual([]);
  });
});
