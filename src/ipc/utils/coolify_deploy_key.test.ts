import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ESM exports cannot be spied on, and both paths are read at call time.
const testHome = vi.hoisted(() => ({ dir: "" }));
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => testHome.dir || actual.homedir() };
});
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => testHome.dir,
}));
import {
  coolifyKeyName,
  ensureDeployKey,
  generateDeployKeyPair,
  publicKeyFromPrivate,
  repoKeyName,
} from "./coolify_deploy_key";

/**
 * Whether real OpenSSH is on this machine, which is exactly what the key
 * generation no longer requires — so the tests that use it to check our
 * encoding skip rather than fail where it is absent.
 */
const hasSshKeygen = (() => {
  try {
    execFileSync("ssh-keygen", ["-?"], { stdio: "ignore" });
    return true;
  } catch (err) {
    // ssh-keygen exits non-zero for an unknown flag; only a missing binary
    // means it cannot be used.
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
})();

/**
 * Whether that OpenSSH also has `-Y sign`, which older and cut-down builds do
 * not. Probed separately: a test skipped for a missing subcommand is honest,
 * where the same test failing would report a fault in our encoder.
 */
const hasSshSigning = (() => {
  if (!hasSshKeygen) return false;
  try {
    // Piped, not ignored: ignoring leaves err.stderr null, and the check
    // below would then read "" and call every build capable. Piping also
    // keeps the child's complaint out of the test output.
    execFileSync("ssh-keygen", ["-Y", "sign"], { stdio: "pipe" });
    return true;
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer }).stderr ?? "");
    // Missing arguments means the subcommand exists; an unknown operation
    // means it does not. GNU getopt says "unknown option", BSD and macOS say
    // "illegal option".
    return !/unknown|illegal|invalid|unsupported/i.test(stderr);
  }
})();

/**
 * A throwaway directory standing in for both Dyad's userData and the home
 * the migration reads from, so these never touch anything real.
 *
 * This is the one module in the feature that writes keys to disk, and the
 * half-written-keypair case it recovers from cannot be reproduced without a
 * real filesystem.
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

const keyFile = (name: string) => path.join(home, "coolify_deploy_keys", name);
/** Where an earlier version wrote them. */
const legacyPath = (name: string) => path.join(home, ".ssh", name);

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

describe("generateDeployKeyPair", () => {
  /**
   * The one test that is not self-referential.
   *
   * Everything else here reads our own keys with our own reader, so a wrong
   * byte in the container would round-trip happily and only surface as a
   * refused clone inside a Coolify build. This hands the private half to real
   * OpenSSH and asks what public key it sees.
   */
  it.skipIf(!hasSshKeygen)(
    "writes a private key that OpenSSH reads as the pair we generated",
    () => {
      const { publicKey, privateKey } = generateDeployKeyPair("dyad-deploy");
      const keyPath = keyFile("interop");
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });

      const derived = execFileSync("ssh-keygen", ["-y", "-f", keyPath], {
        encoding: "utf8",
      });
      const material = (line: string) =>
        line.trim().split(/\s+/).slice(0, 2).join(" ");
      expect(material(derived)).toBe(material(publicKey));
    },
  );

  /**
   * `ssh-keygen -y` reports the public blob stored alongside the secret rather
   * than recomputing it, so it cannot tell whether the secret half is intact.
   * Signing does, and it checks the invariant the deploy actually depends on:
   * the private key handed to Coolify must be the one GitHub authorised.
   */
  it.skipIf(!hasSshSigning)(
    "signs for the public key that goes to GitHub",
    () => {
      const { publicKey, privateKey } = generateDeployKeyPair("dyad-deploy");
      const keyPath = keyFile("signing");
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
      const message = keyFile("message");
      fs.writeFileSync(message, "deploy");

      execFileSync(
        "ssh-keygen",
        ["-Y", "sign", "-f", keyPath, "-n", "test", message],
        { stdio: "pipe" },
      );

      const allowed = keyFile("allowed_signers");
      fs.writeFileSync(allowed, `tester ${publicKey.trim()}\n`);
      expect(() =>
        execFileSync(
          "ssh-keygen",
          [
            "-Y",
            "verify",
            "-f",
            allowed,
            "-I",
            "tester",
            "-n",
            "test",
            "-s",
            `${message}.sig`,
          ],
          { input: "deploy", stdio: "pipe" },
        ),
      ).not.toThrow();
    },
  );

  it.skipIf(!hasSshKeygen)("stores the comment where OpenSSH finds it", () => {
    const keyPath = keyFile("commented");
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, generateDeployKeyPair("dyad-deploy").privateKey, {
      mode: 0o600,
    });

    const derived = execFileSync("ssh-keygen", ["-y", "-f", keyPath], {
      encoding: "utf8",
    });
    expect(derived.trim().split(/\s+/)[2]).toBe("dyad-deploy");
  });

  it("gives every call its own key", () => {
    const a = generateDeployKeyPair("dyad-deploy");
    const b = generateDeployKeyPair("dyad-deploy");
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it("round-trips through the reader", () => {
    const { publicKey, privateKey } = generateDeployKeyPair("dyad-deploy");
    expect(publicKeyFromPrivate(privateKey)).toBe(publicKey);
  });
});

describe("publicKeyFromPrivate", () => {
  it("refuses a file that is not an OpenSSH key", () => {
    // The caller replaces the pair on a null, so anything it cannot vouch for
    // has to come back null rather than as a plausible-looking string.
    expect(publicKeyFromPrivate("not a key")).toBeNull();
    expect(publicKeyFromPrivate("")).toBeNull();
    expect(
      publicKeyFromPrivate(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nZm9v\n-----END OPENSSH PRIVATE KEY-----\n",
      ),
    ).toBeNull();
  });

  it("refuses a truncated key rather than guessing at it", () => {
    const { privateKey } = generateDeployKeyPair("dyad-deploy");
    const lines = privateKey.split("\n");
    const truncated = [lines[0], lines[1]?.slice(0, 20), lines.at(-2)].join(
      "\n",
    );
    expect(publicKeyFromPrivate(truncated)).toBeNull();
  });

  it("refuses a key truncated after its public half", () => {
    // The public blob sits in the clear near the front, so it survives a
    // truncation that destroys the private half. Accepting it would write a
    // .pub for a key Coolify cannot clone with, and the deploy would fail
    // inside the build as an unexplained missing repository.
    const { privateKey } = generateDeployKeyPair("dyad-deploy");
    const lines = privateKey.trim().split("\n");
    const body = lines.slice(1, -1).join("");
    const bytes = Buffer.from(body, "base64");
    // Two thirds keeps the header and the public blob, losing the secret.
    const cut = bytes.subarray(0, Math.floor(bytes.length * 0.66));
    const truncated =
      `-----BEGIN OPENSSH PRIVATE KEY-----\n` +
      `${cut
        .toString("base64")
        .match(/.{1,70}/g)!
        .join("\n")}\n` +
      `-----END OPENSSH PRIVATE KEY-----\n`;

    expect(publicKeyFromPrivate(truncated)).toBeNull();
  });

  it.skipIf(!hasSshKeygen)("reads a key OpenSSH wrote", () => {
    // Nothing says the only keys on disk are ones we generated.
    const keyPath = keyFile("foreign");
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    execFileSync(
      "ssh-keygen",
      ["-t", "ed25519", "-N", "", "-C", "someone-else", "-f", keyPath],
      { stdio: "ignore" },
    );

    const parsed = publicKeyFromPrivate(fs.readFileSync(keyPath, "utf8"));
    const onDisk = fs.readFileSync(`${keyPath}.pub`, "utf8");
    const material = (line: string) =>
      line.trim().split(/\s+/).slice(0, 2).join(" ");
    expect(parsed).not.toBeNull();
    expect(material(parsed!)).toBe(material(onDisk));
  });
});

describe("keys written by an earlier version", () => {
  it("moves them out of ~/.ssh rather than generating a new pair", async () => {
    // GitHub allows a deploy key on one repository, so a fresh public half is
    // refused by the very key it would replace. Regenerating would strand the
    // user on advice they cannot follow.
    fs.mkdirSync(path.dirname(legacyPath("dyad_deploy_old")), {
      recursive: true,
    });
    const pair = generateDeployKeyPair("dyad-deploy");
    fs.writeFileSync(legacyPath("dyad_deploy_old"), pair.privateKey);
    fs.writeFileSync(`${legacyPath("dyad_deploy_old")}.pub`, pair.publicKey);

    const returned = await ensureDeployKey("dyad_deploy_old");

    expect(returned.trim()).toBe(pair.publicKey.trim());
    expect(fs.existsSync(keyFile("dyad_deploy_old"))).toBe(true);
    // And the old location is left clean rather than holding a second copy.
    expect(fs.existsSync(legacyPath("dyad_deploy_old"))).toBe(false);
  });

  it("rebuilds a missing public half after moving the private one", async () => {
    fs.mkdirSync(path.dirname(legacyPath("dyad_deploy_halved")), {
      recursive: true,
    });
    const pair = generateDeployKeyPair("dyad-deploy");
    fs.writeFileSync(legacyPath("dyad_deploy_halved"), pair.privateKey);

    const returned = await ensureDeployKey("dyad_deploy_halved");

    expect(returned.trim()).toBe(pair.publicKey.trim());
  });

  it("leaves the old copy alone once one already exists in the new place", async () => {
    // Nothing to migrate, and overwriting would replace a key GitHub and
    // Coolify already know with an older one.
    const current = await ensureDeployKey("dyad_deploy_both");
    fs.mkdirSync(path.dirname(legacyPath("dyad_deploy_both")), {
      recursive: true,
    });
    fs.writeFileSync(
      legacyPath("dyad_deploy_both"),
      generateDeployKeyPair("dyad-deploy").privateKey,
    );

    expect(await ensureDeployKey("dyad_deploy_both")).toBe(current);
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
    expect(fs.existsSync(keyFile("dyad_deploy_test_a"))).toBe(true);
    expect(fs.existsSync(keyFile("dyad_deploy_test_a.pub"))).toBe(true);
  });

  it("reuses an existing pair rather than rotating it", async () => {
    const first = await ensureDeployKey("dyad_deploy_test_b");
    const second = await ensureDeployKey("dyad_deploy_test_b");
    expect(second).toBe(first);
  });

  it("rebuilds the public half without replacing the private one", async () => {
    // Generation writes the private half first, so an interrupted run leaves
    // exactly this. The private half is what GitHub authorised and Coolify
    // stored, so rotating the pair would orphan a key still in use.
    const first = await ensureDeployKey("dyad_deploy_test_c");
    const privateBefore = fs.readFileSync(
      keyFile("dyad_deploy_test_c"),
      "utf8",
    );
    fs.rmSync(keyFile("dyad_deploy_test_c.pub"));

    const recovered = await ensureDeployKey("dyad_deploy_test_c");

    expect(recovered).toBe(first);
    expect(fs.readFileSync(keyFile("dyad_deploy_test_c"), "utf8")).toBe(
      privateBefore,
    );
  });

  it("gives concurrent callers the same pair", async () => {
    // Two deploys starting together must not each generate a pair.
    const [a, b] = await Promise.all([
      ensureDeployKey("dyad_deploy_test_d"),
      ensureDeployKey("dyad_deploy_test_d"),
    ]);
    expect(a).toBe(b);
  });
});
