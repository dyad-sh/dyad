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
    expect(repoKeyName("acme", "demo")).toBe(repoKeyName("acme", "demo"));
    expect(repoKeyName("a/b", "c d")).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("gives different repositories different names", () => {
    // The readable part folds every unsafe character to one dash and uses a
    // safe character as its separator, so it cannot be relied on to tell
    // repositories apart. GitHub allows a deploy key on one repository only,
    // so a collision sends the second app to an error whose advice — delete
    // the key and regenerate — produces the same collision again.
    const collidingPairs: Array<[string, string]> = [
      ["owner_a", "repo"],
      ["owner", "a_repo"],
    ];
    const names = collidingPairs.map(([o, r]) => repoKeyName(o, r));
    expect(new Set(names).size).toBe(collidingPairs.length);

    // And the same for the character folding, which is equally lossy.
    expect(repoKeyName("a/b", "c")).not.toBe(repoKeyName("a", "b/c"));
    expect(repoKeyName("a b", "c")).not.toBe(repoKeyName("a-b", "c"));
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

  it("rebuilds the public half without replacing the private one", async () => {
    // ssh-keygen writes the private half first, so an interrupted run leaves
    // exactly this. The private half is what GitHub authorised and Coolify
    // stored, so rotating the pair would orphan a key still in use.
    const first = await ensureDeployKey("dyad_deploy_test_c");
    const privateBefore = fs.readFileSync(
      sshPath("dyad_deploy_test_c"),
      "utf8",
    );
    fs.rmSync(sshPath("dyad_deploy_test_c.pub"));

    const recovered = await ensureDeployKey("dyad_deploy_test_c");

    expect(recovered).toBe(first);
    expect(fs.readFileSync(sshPath("dyad_deploy_test_c"), "utf8")).toBe(
      privateBefore,
    );
  });

  it("leaves an intact pair alone when only the public half is unreadable", async () => {
    // A derive that fails must not take the private half with it.
    await ensureDeployKey("dyad_deploy_test_e");
    const privateBefore = fs.readFileSync(
      sshPath("dyad_deploy_test_e"),
      "utf8",
    );
    fs.rmSync(sshPath("dyad_deploy_test_e.pub"));
    await ensureDeployKey("dyad_deploy_test_e");
    expect(fs.readFileSync(sshPath("dyad_deploy_test_e"), "utf8")).toBe(
      privateBefore,
    );
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
