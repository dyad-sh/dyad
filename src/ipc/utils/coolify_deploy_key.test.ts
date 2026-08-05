import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ESM exports cannot be spied on, and the module reads homedir() at call time.
const testHome = vi.hoisted(() => ({ dir: "" }));
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => testHome.dir || actual.homedir() };
});
import {
  coolifyKeyName,
  ensureDeployKey,
  readPublicKey,
  repoKeyName,
} from "./coolify_deploy_key";

/**
 * A throwaway home directory, so these never touch the real ~/.ssh.
 *
 * This is the one module in the feature that spawns a process and writes into
 * the user's home, and the half-written-keypair case it recovers from cannot
 * be reproduced without a real filesystem.
 */
let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-keytest-"));
  testHome.dir = home;
});

afterEach(() => {
  testHome.dir = "";
  fs.rmSync(home, { recursive: true, force: true });
});

const sshPath = (name: string) => path.join(home, ".ssh", name);

describe("repoKeyName", () => {
  it("is stable per repository and safe as a filename", () => {
    expect(repoKeyName("acme", "demo")).toBe("dyad_deploy_acme_demo");
    expect(repoKeyName("a/b", "c d")).toBe("dyad_deploy_a-b_c-d");
  });
});

describe("coolifyKeyName", () => {
  it("changes when the key material changes", () => {
    const a = coolifyKeyName("k", "ssh-ed25519 AAAA one");
    const b = coolifyKeyName("k", "ssh-ed25519 BBBB two");
    expect(a).not.toBe(b);
    expect(a.startsWith("k_")).toBe(true);
  });

  it("ignores the comment, which the user can edit", () => {
    expect(coolifyKeyName("k", "ssh-ed25519 AAAA laptop")).toBe(
      coolifyKeyName("k", "ssh-ed25519 AAAA desktop"),
    );
  });
});

describe("ensureDeployKey", () => {
  it("generates a usable pair and returns the public half", async () => {
    const publicKey = await ensureDeployKey("dyad_deploy_test_a");
    expect(publicKey.startsWith("ssh-ed25519 ")).toBe(true);
    expect(fs.existsSync(sshPath("dyad_deploy_test_a"))).toBe(true);
    expect(fs.existsSync(sshPath("dyad_deploy_test_a.pub"))).toBe(true);
  });

  it("reuses an existing pair rather than rotating it", async () => {
    const first = await ensureDeployKey("dyad_deploy_test_b");
    const second = await ensureDeployKey("dyad_deploy_test_b");
    expect(second).toBe(first);
  });

  it("regenerates when only the private half survived", async () => {
    // ssh-keygen writes the private half first, so an interrupted run leaves
    // exactly this. Skipping generation would wedge every later deploy.
    await ensureDeployKey("dyad_deploy_test_c");
    fs.rmSync(sshPath("dyad_deploy_test_c.pub"));

    const recovered = await ensureDeployKey("dyad_deploy_test_c");

    expect(recovered.startsWith("ssh-ed25519 ")).toBe(true);
    expect(readPublicKey("dyad_deploy_test_c")).toBe(recovered);
  });

  it("gives concurrent callers the same pair", async () => {
    // Two deploys starting together must not race ssh-keygen.
    const [a, b] = await Promise.all([
      ensureDeployKey("dyad_deploy_test_d"),
      ensureDeployKey("dyad_deploy_test_d"),
    ]);
    expect(a).toBe(b);
  });
});
