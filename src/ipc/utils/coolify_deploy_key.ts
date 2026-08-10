import { createHash, generateKeyPairSync, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getUserDataPath } from "@/paths/paths";

const logger = log.scope("coolify_deploy_key");

/**
 * Manages the keypair Coolify uses to clone a private repository.
 *
 * Dyad never connects over SSH itself: it generates a keypair, hands the
 * public half to GitHub as a deploy key and the private half to Coolify.
 * GitHub allows a deploy key on only one repository, so each repo gets its own.
 */

/** Written into the key so a human reading the directory sees where it came from. */
const KEY_COMMENT = "dyad-deploy";

/**
 * Dyad's own directory, not ~/.ssh.
 *
 * These are keys Dyad generates and manages, not the user's. ~/.ssh is a
 * directory Dyad treats as off-limits everywhere else — the sandbox's
 * protected-path list and the MCP consent policy both name it — and writing
 * an unencrypted private key into it puts Dyad's own files among identities
 * the user maintains by hand.
 */
function keyDir(): string {
  return path.join(getUserDataPath(), "coolify_deploy_keys");
}

function keyFilePath(keyName: string): string {
  return path.join(keyDir(), keyName);
}

/**
 * Where a key sits, for an error that asks the user to delete it.
 *
 * Exported so no caller has to know the directory: the last one that did
 * still named ~/.ssh long after the keys moved out of it.
 */
export function deployKeyFilePath(keyName: string): string {
  return keyFilePath(keyName);
}

export function repoKeyName(owner: string, repo: string): string {
  // The readable part is lossy in both directions: every character outside the
  // safe set folds to one dash, and the separator between owner and repo is
  // itself inside that set. So owner_a/repo and owner/a_repo would name the
  // same file and share a keypair — and GitHub allows a deploy key on only one
  // repository, so the second app would be told to delete the key and start
  // again, by a name that collides identically the next time round.
  //
  // The suffix is what makes it a name for this repository rather than for a
  // shape, the same way coolifyKeyName below is a name for this key material.
  const readable = `${owner}_${repo}`
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .slice(0, 48);
  const distinct = createHash("sha256")
    .update(`${owner}/${repo}`)
    .digest("hex")
    .slice(0, 8);
  return `dyad_deploy_${readable}_${distinct}`;
}

/**
 * The name Coolify stores this key under, ending in a fingerprint of the key
 * itself.
 *
 * Coolify offers no way to replace a stored key, and we look one up by name, so
 * a name that ignored the key material would let a regenerated local pair
 * silently keep cloning with the old private half — which fails inside
 * Coolify's build as an unexplained "repository not found".
 */
export function coolifyKeyName(keyName: string, publicKey: string): string {
  // The comment field is user-editable and not part of the key.
  const material = publicKey.trim().split(/\s+/).slice(0, 2).join(" ");
  const fingerprint = createHash("sha256")
    .update(material)
    .digest("hex")
    .slice(0, 12);
  return `${keyName}_${fingerprint}`;
}

function readPublicKey(keyName: string): string | null {
  try {
    return fs.readFileSync(`${keyFilePath(keyName)}.pub`, "utf8").trim();
  } catch {
    return null;
  }
}

export function readPrivateKey(keyName: string): string {
  return fs.readFileSync(keyFilePath(keyName), "utf8");
}

/** Length-prefixed field, the one primitive the SSH wire format is built from. */
function sshField(value: Buffer | string): Buffer {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
}

function readFields(buffer: Buffer, offset: number, count: number) {
  const fields: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    // subarray clamps rather than throwing, so a truncated file would yield a
    // short field and be read as a key rather than rejected as damaged.
    if (offset + length > buffer.length) {
      throw new Error("Key data ends mid-field");
    }
    fields.push(buffer.subarray(offset, offset + length));
    offset += length;
  }
  return { fields, offset };
}

/**
 * An ed25519 pair in the two shapes OpenSSH expects on disk.
 *
 * The private file is the "openssh-key-v1" container: a header naming the
 * cipher and KDF (both "none" — this key is used unattended and cannot carry
 * a passphrase), the public blob, and then a section that would be encrypted
 * if there were a passphrase. That section repeats a random check value twice,
 * which is how a decrypting reader knows it got the passphrase right, and is
 * padded 1,2,3... because the format pads to the cipher's block size even when
 * the cipher is "none".
 */
export function generateDeployKeyPair(comment: string): {
  publicKey: string;
  privateKey: string;
} {
  const pair = generateKeyPairSync("ed25519");
  // JWK is the one export format that hands back the raw 32-byte values,
  // which is what the SSH encoding wants; DER would have to be unwrapped.
  const { x } = pair.publicKey.export({ format: "jwk" });
  const { d } = pair.privateKey.export({ format: "jwk" });
  if (!x || !d) {
    throw new DyadError(
      "Could not generate a deploy key: the runtime returned an ed25519 key " +
        "without its raw halves.",
      DyadErrorKind.Internal,
    );
  }
  const publicBytes = Buffer.from(x, "base64url");
  // OpenSSH stores the seed and the public key together as the secret half.
  const secretBytes = Buffer.concat([Buffer.from(d, "base64url"), publicBytes]);

  const blob = Buffer.concat([sshField("ssh-ed25519"), sshField(publicBytes)]);

  const check = randomBytes(4);
  const inner = Buffer.concat([
    check,
    check,
    sshField("ssh-ed25519"),
    sshField(publicBytes),
    sshField(secretBytes),
    sshField(comment),
  ]);
  const padding = (8 - (inner.length % 8)) % 8;
  const padded = Buffer.concat([
    inner,
    Buffer.from(Array.from({ length: padding }, (_, i) => i + 1)),
  ]);

  const container = Buffer.concat([
    Buffer.from("openssh-key-v1\0", "utf8"),
    sshField("none"),
    sshField("none"),
    sshField(""),
    Buffer.from([0, 0, 0, 1]),
    sshField(blob),
    sshField(padded),
  ]);

  const lines = container.toString("base64").match(/.{1,70}/g) ?? [];
  return {
    publicKey: `ssh-ed25519 ${blob.toString("base64")} ${comment}\n`,
    privateKey:
      `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join("\n")}\n` +
      `-----END OPENSSH PRIVATE KEY-----\n`,
  };
}

/**
 * Reads the public half back out of a stored private key.
 *
 * The public blob sits in the clear ahead of the section a passphrase would
 * encrypt, so this works without knowing the cipher, and so reads any
 * unmodified OpenSSH key rather than only the ones written here.
 */
export function publicKeyFromPrivate(pem: string): string | null {
  try {
    const body = Buffer.from(
      pem
        .split("\n")
        .filter((line) => !line.startsWith("-----"))
        .join(""),
      "base64",
    );
    const magic = "openssh-key-v1\0";
    if (body.subarray(0, magic.length).toString("utf8") !== magic) return null;

    // ciphername, kdfname, kdfoptions, then the number of keys.
    const header = readFields(body, magic.length, 3);
    const cipher = header.fields[0]?.toString("utf8");
    const count = body.readUInt32BE(header.offset);
    if (count !== 1) return null;
    const { fields, offset } = readFields(body, header.offset + 4, 1);
    const blob = fields[0];
    if (!blob?.length) return null;

    // The blob names its own type; anything else is a key we did not write.
    const { fields: parts } = readFields(blob, 0, 1);
    if (parts[0]?.toString("utf8") !== "ssh-ed25519") return null;

    // The public blob is only the first half. A file truncated after it still
    // reads as a key here, and the caller would write a .pub for a private
    // half Coolify cannot clone with — so the rest is read too, which the
    // bounds check in readFields turns into a rejection.
    const { fields: secret } = readFields(body, offset, 1);
    const section = secret[0];
    if (!section?.length) return null;
    // For an unencrypted key the section starts with the same random value
    // twice, which is how OpenSSH itself tells intact from damaged. An
    // encrypted one is unreadable here, and its length is all we can check.
    if (cipher === "none") {
      if (section.length < 8) return null;
      if (!section.subarray(0, 4).equals(section.subarray(4, 8))) return null;
    }
    return `ssh-ed25519 ${blob.toString("base64")} ${KEY_COMMENT}\n`;
  } catch {
    // A truncated or non-OpenSSH file lands here; the caller reports it as an
    // unreadable key rather than replacing one that is still in use.
    return null;
  }
}

/**
 * Generates the keypair if it does not exist and returns the public half.
 * It is passphrase-less because it is used non-interactively, and is a
 * dedicated identity rather than the user's personal key.
 *
 * The body never yields, so two deploys starting together cannot interleave
 * and end up with one registering a pair the other has already replaced.
 */
export async function ensureDeployKey(keyName: string): Promise<string> {
  const keyPath = keyFilePath(keyName);
  const hasPrivate = fs.existsSync(keyPath);
  const hasPublic = fs.existsSync(`${keyPath}.pub`);

  if (hasPrivate && !hasPublic) {
    // The private half is what GitHub authorised and Coolify stored, so it is
    // worth keeping: the public half is read back out of it rather than the
    // pair being replaced.
    const derived = publicKeyFromPrivate(readPrivateKey(keyName));
    if (!derived) {
      throw new DyadError(
        `The deploy key at ${keyPath} could not be read, and its public half ` +
          `is missing. Delete it to have a new pair generated, then add the ` +
          `new key to the repository's deploy keys.`,
        // Precondition, not External: a corrupt local file is user state the
        // user is told how to fix, not a fault of Coolify's or GitHub's. The
        // kind also decides telemetry, and this message carries the userData
        // path — the OS username on macOS and Windows — plus the owner and
        // repo in the filename. External is not filtered, so classifying it
        // that way shipped all three to PostHog.
        DyadErrorKind.Precondition,
      );
    }
    fs.writeFileSync(`${keyPath}.pub`, derived, { mode: 0o644 });
    logger.info(`Rebuilt the public half of ${keyPath}`);
  } else if (!hasPrivate) {
    fs.mkdirSync(keyDir(), { recursive: true, mode: 0o700 });
    // Nothing usable survives without the private half, so a stray public one
    // describes a pair that no longer exists.
    fs.rmSync(`${keyPath}.pub`, { force: true });
    const pair = generateDeployKeyPair(KEY_COMMENT);
    // Private first: the half that cannot be rebuilt is the one to have on
    // disk if only one write lands.
    fs.writeFileSync(keyPath, pair.privateKey, { mode: 0o600 });
    fs.writeFileSync(`${keyPath}.pub`, pair.publicKey, { mode: 0o644 });
    logger.info(`Generated deploy key at ${keyPath}`);
  }

  const publicKey = readPublicKey(keyName);
  if (!publicKey) {
    throw new DyadError(
      `Deploy key exists but ${keyPath}.pub is unreadable`,
      // Same reason as above: the message embeds the userData path.
      DyadErrorKind.Precondition,
    );
  }
  return publicKey;
}
