import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Keys live under the user's home directory, so point that at a scratch dir
// rather than writing into the real ~/.ssh during tests.
const h = vi.hoisted(() => ({ home: "" }));
vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return { ...actual, homedir: () => h.home };
});

import { classifySshError, regenerateDeployKey } from "./ssh_utils";

describe("classifySshError", () => {
  it.each([
    ["Permission denied (publickey).", 255, "auth-rejected"],
    [
      "@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @",
      255,
      "host-key-changed",
    ],
    ["Host key verification failed.", 255, "host-key-changed"],
    [
      "ssh: connect to host 1.2.3.4 port 22: Connection timed out",
      255,
      "timeout",
    ],
    ["ssh: Could not resolve hostname example.invalid", 255, "unreachable"],
    [
      "ssh: connect to host 1.2.3.4 port 22: Connection refused",
      255,
      "unreachable",
    ],
    ["something else entirely", 255, "unknown"],
  ])("classifies %s", (stderr, code, expected) => {
    expect(classifySshError(stderr, code)).toBe(expected);
  });

  it("treats a null exit code as a timeout (killed by our timer)", () => {
    expect(classifySshError("", null)).toBe("timeout");
  });
});

describe("regenerateDeployKey", () => {
  let sshDir: string;

  beforeEach(() => {
    h.home = mkdtempSync(join(tmpdir(), "ssh-regen-"));
    sshDir = join(h.home, ".ssh");
    mkdirSync(sshDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(h.home, { recursive: true, force: true });
  });

  it("keeps the previous pair instead of deleting it", async () => {
    writeFileSync(join(sshDir, "k"), "OLD PRIVATE");
    writeFileSync(join(sshDir, "k.pub"), "ssh-ed25519 OLDPUB old");

    await regenerateDeployKey("k");

    expect(readFileSync(join(sshDir, "k.pub"), "utf8")).not.toContain("OLDPUB");
    // The old pair may be the only way back into a server that trusts it, so
    // losing it silently would be worse than leaving a stale file behind.
    const kept = readdirSync(sshDir).filter((f) => f.includes(".replaced-"));
    expect(kept).toHaveLength(2);
    const keptPrivate = kept.find((f) => !f.endsWith(".pub"))!;
    expect(readFileSync(join(sshDir, keptPrivate), "utf8")).toBe("OLD PRIVATE");
  });

  it("generates a key when there is nothing to replace", async () => {
    const publicKey = await regenerateDeployKey("fresh");
    expect(publicKey).toMatch(/^ssh-ed25519 /);
    expect(readdirSync(sshDir).filter((f) => f.includes(".replaced-"))).toEqual(
      [],
    );
  });
});
