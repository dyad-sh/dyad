import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ userData: "" }));

vi.mock("@/paths/paths", () => ({ getUserDataPath: () => h.userData }));

const { ensureServerKey, serverKeyPath } = await import("./server_key");

describe("the key the user installs on their server", () => {
  beforeEach(() => {
    h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-server-key-"));
  });

  afterEach(() => {
    fs.rmSync(h.userData, { recursive: true, force: true });
  });

  it("refuses a private half that cannot be read, whatever the .pub says", () => {
    // The stored public half is not evidence about the private one. Handing
    // it back for a key that cannot be parsed gives the user a line to
    // install that nothing can connect with.
    ensureServerKey();
    fs.writeFileSync(
      serverKeyPath(),
      "-----BEGIN OPENSSH PRIVATE KEY-----\nbroken\n-----END OPENSSH PRIVATE KEY-----\n",
    );

    expect(() => ensureServerKey()).toThrow();
  });

  it("ignores a stored public half that belongs to another key", () => {
    // The .pub is kept for its comment, not taken as evidence. A line for a
    // different key is one the server would accept from someone else.
    const derived = ensureServerKey().publicKey;
    fs.writeFileSync(
      `${serverKeyPath()}.pub`,
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISOMEOTHERKEYENTIRELYAAAAAAAAAAAA someone-else\n",
    );

    // The key itself, not the comment: a rejected line falls back to the
    // derived one, which names itself differently.
    const blob = (line: string) => line.split(" ")[1];
    expect(blob(ensureServerKey().publicKey)).toBe(blob(derived));
  });

  it("hands back one key, whatever else the file has collected", () => {
    // What this returns is pasted into a server's authorized_keys. A second
    // line riding along would install a key nobody checked.
    const derived = ensureServerKey().publicKey;
    fs.appendFileSync(
      `${serverKeyPath()}.pub`,
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISOMEOTHERKEYENTIRELYAAAAAAAAAAAA someone-else\n",
    );

    const shown = ensureServerKey().publicKey;
    expect(shown.trim().split("\n")).toHaveLength(1);
    expect(shown).toBe(derived);
  });

  it("ignores a stored line that claims a different key type", () => {
    // The key is ed25519. A line naming it as something else describes a key
    // no server would accept it as.
    const blob = ensureServerKey().publicKey.split(" ")[1];
    fs.writeFileSync(`${serverKeyPath()}.pub`, `ssh-rsa ${blob} borrowed\n`);

    expect(ensureServerKey().publicKey.startsWith("ssh-ed25519 ")).toBe(true);
  });

  it("shows the same line every time it is asked", () => {
    // The user pastes this into their server once. A different line on the
    // next launch reads as a different key.
    const first = ensureServerKey().publicKey;
    const second = ensureServerKey().publicKey;

    expect(second).toBe(first);
  });
});
