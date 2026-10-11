import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { SandboxWorkerHostCall } from "./worker_protocol";
import { isSandboxSupportedPlatform, runSandboxScript } from "./runner";

/**
 * Runs the real sandbox worker, not the in-process fallback, so the bridge
 * for main-thread host functions is exercised across an actual thread
 * boundary: proxies in the worker, dispatcher in this process, structured
 * clone in between.
 *
 * The worker is a Vite library bundle; the runner only knows how to find the
 * packaged copy, so the suite builds it into the ignored `.vite/` directory
 * and points the runner at it through the test-only override.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WORKER_OUT_DIR = path.join(REPO_ROOT, ".vite", "sandbox-worker-test");

const supported = isSandboxSupportedPlatform();

describe.skipIf(!supported)("sandbox worker host-function bridge", () => {
  let appPath: string;
  let previousOverride: string | undefined;

  beforeAll(async () => {
    const { build } = await import("vite");
    await build({
      configFile: path.join(REPO_ROOT, "vite.sandbox-worker.config.mts"),
      logLevel: "silent",
      build: { outDir: WORKER_OUT_DIR, emptyOutDir: true },
    });
    const entries = await fs.readdir(WORKER_OUT_DIR);
    const bundle = entries.find((name) => /^sandbox_worker\.c?js$/.test(name));
    if (!bundle) {
      throw new Error(
        `Sandbox worker bundle not found in ${WORKER_OUT_DIR}: ${entries.join(", ")}`,
      );
    }
    previousOverride = process.env.DYAD_SANDBOX_WORKER_PATH;
    process.env.DYAD_SANDBOX_WORKER_PATH = path.join(WORKER_OUT_DIR, bundle);
  }, 120_000);

  afterAll(() => {
    if (previousOverride === undefined) {
      delete process.env.DYAD_SANDBOX_WORKER_PATH;
    } else {
      process.env.DYAD_SANDBOX_WORKER_PATH = previousOverride;
    }
  });

  beforeAll(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-sandbox-bridge-"));
    await fs.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.writeFile(path.join(appPath, "src", "data.txt"), "abcdef", "utf8");
  });

  it("calls a main-thread capability from the worker and returns its result", async () => {
    const seen: unknown[][] = [];
    const result = await runSandboxScript({
      appPath,
      script: `
        const doubled = await double(20);
        const text = await read_file("src/data.txt");
        doubled + text.length;
      `,
      remoteCapabilities: {
        double: async (...args: unknown[]) => {
          seen.push(args);
          return (args[0] as number) * 2;
        },
      },
    });

    expect(result).toMatchObject({ value: "46", truncated: false });
    expect(seen).toEqual([[20]]);
  });

  it("delivers a capability's error to the guest with its message intact", async () => {
    const result = await runSandboxScript({
      appPath,
      script: `
        let message = "no error";
        try {
          await deny();
        } catch (error) {
          message = String(error && error.message ? error.message : error);
        }
        message;
      `,
      remoteCapabilities: {
        deny: async () => {
          throw new DyadError(
            "Consent denied for write_file",
            DyadErrorKind.UserCancelled,
          );
        },
      },
    });

    expect(result.value).toContain("Consent denied for write_file");
  });

  it("fails the script when a capability error is not caught", async () => {
    await expect(
      runSandboxScript({
        appPath,
        script: `await deny(); 1;`,
        remoteCapabilities: {
          deny: async () => {
            throw new DyadError(
              "Blocked by policy",
              DyadErrorKind.Precondition,
            );
          },
        },
      }),
    ).rejects.toThrow("Blocked by policy");
  });

  it("still reports file host calls to the observer from inside the worker", async () => {
    const calls: SandboxWorkerHostCall[] = [];
    await runSandboxScript({
      appPath,
      script: `(await read_file("src/data.txt")).length;`,
      remoteCapabilities: { noop: async () => null },
      onHostCall: (call) => calls.push(call),
    });

    expect(calls).toEqual([{ name: "read_file", path: "src/data.txt" }]);
  });

  it("terminates the worker when the turn is cancelled mid-call", async () => {
    const abortController = new AbortController();
    const started = Date.now();
    const run = runSandboxScript({
      appPath,
      script: `await block(); 1;`,
      remoteCapabilities: {
        block: () =>
          new Promise<unknown>((resolve) => {
            // Resolve only after the abort to prove the cancellation won.
            abortController.signal.addEventListener("abort", () =>
              setTimeout(() => resolve("too late"), 50),
            );
          }),
      },
      signal: abortController.signal,
    });
    setTimeout(() => abortController.abort(), 100);

    await expect(run).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();
    await expect(
      runSandboxScript({
        appPath,
        script: `1;`,
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.UserCancelled });
  });
});
