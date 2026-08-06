import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("coolify_deploy_key");

/**
 * Manages the keypair Coolify uses to clone a private repository.
 *
 * Dyad never connects over SSH itself: it generates a keypair, hands the
 * public half to GitHub as a deploy key and the private half to Coolify.
 * GitHub allows a deploy key on only one repository, so each repo gets its own.
 */

function keyDir(): string {
  return path.join(os.homedir(), ".ssh");
}

function keyFilePath(keyName: string): string {
  return path.join(keyDir(), keyName);
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

export function readPublicKey(keyName: string): string | null {
  try {
    return fs.readFileSync(`${keyFilePath(keyName)}.pub`, "utf8").trim();
  } catch {
    return null;
  }
}

export function readPrivateKey(keyName: string): string {
  return fs.readFileSync(keyFilePath(keyName), "utf8");
}

function findKeygenBinary(): string {
  const fileName =
    process.platform === "win32" ? "ssh-keygen.exe" : "ssh-keygen";
  const dirs =
    process.platform === "win32"
      ? [
          path.join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "OpenSSH",
          ),
        ]
      : ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
  for (const dir of dirs) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "ssh-keygen";
}

/** Writes the public half from the private one, leaving the private untouched. */
function derivePublicKey(keyPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(findKeygenBinary(), ["-y", "-f", keyPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(
        new DyadError(
          `Could not run ssh-keygen: ${err.message}`,
          DyadErrorKind.External,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !stdout.trim()) {
        reject(
          new DyadError(
            `Could not rebuild the public key from ${keyPath}: ${
              stderr.trim() || `exit code ${code}`
            }`,
            DyadErrorKind.External,
          ),
        );
        return;
      }
      // Written only once ssh-keygen has succeeded, so a failure leaves the
      // pair exactly as it was rather than half-removed.
      fs.writeFileSync(`${keyPath}.pub`, `${stdout.trim()}\n`, { mode: 0o644 });
      resolve();
    });
  });
}

function runKeygen(keyPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      findKeygenBinary(),
      ["-t", "ed25519", "-N", "", "-C", "dyad-deploy", "-f", keyPath],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 30_000);
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timeout);
      // A missing ssh-keygen arrives here rather than as a non-zero exit, and
      // an unclassified error would be reported as a crash.
      reject(
        new DyadError(
          `Could not run ssh-keygen: ${err.message}`,
          DyadErrorKind.External,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve();
      reject(
        new DyadError(
          timedOut
            ? "ssh-keygen did not finish within 30s and was stopped."
            : `ssh-keygen failed: ${stderr.trim() || `exit code ${code}`}`,
          DyadErrorKind.External,
        ),
      );
    });
  });
}

// Two deploys starting together would otherwise both find the key missing and
// race, leaving one waiting on ssh-keygen's overwrite prompt.
const inFlight = new Map<string, Promise<string>>();

/**
 * Generates the keypair if it does not exist and returns the public half.
 * It is passphrase-less because it is used non-interactively, and is a
 * dedicated identity rather than the user's personal key.
 */
export async function ensureDeployKey(keyName: string): Promise<string> {
  const existing = inFlight.get(keyName);
  if (existing) return existing;

  const work = (async () => {
    const keyPath = keyFilePath(keyName);
    const hasPrivate = fs.existsSync(keyPath);
    const hasPublic = fs.existsSync(`${keyPath}.pub`);
    if (hasPrivate && !hasPublic) {
      // The private half is what GitHub authorised and Coolify stored, so it
      // is worth keeping: the public half is derived from it rather than the
      // pair being replaced. ssh-keygen writes them in sequence, so a crash
      // or the kill on its own timeout leaves exactly this.
      await derivePublicKey(keyPath);
      logger.info(`Rebuilt the public half of ${keyPath}`);
    } else if (!hasPrivate) {
      fs.mkdirSync(keyDir(), { recursive: true, mode: 0o700 });
      // Nothing usable survives without the private half, and ssh-keygen
      // will not overwrite or prompt with stdin ignored.
      fs.rmSync(`${keyPath}.pub`, { force: true });
      await runKeygen(keyPath);
      logger.info(`Generated deploy key at ${keyPath}`);
    }
    const publicKey = readPublicKey(keyName);
    if (!publicKey) {
      throw new DyadError(
        `Deploy key exists but ${keyPath}.pub is unreadable`,
        DyadErrorKind.External,
      );
    }
    return publicKey;
  })();

  inFlight.set(keyName, work);
  try {
    return await work;
  } finally {
    inFlight.delete(keyName);
  }
}
