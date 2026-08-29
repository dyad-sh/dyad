import * as fs from "fs";
import * as path from "path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getUserDataPath } from "@/paths/paths";
import {
  generateDeployKeyPair,
  publicKeyFromPrivate,
} from "@/ipc/utils/coolify_deploy_key";

/**
 * The key Dyad uses to reach a server it is setting up.
 *
 * Separate from the deploy keys, which are per repository and handed to GitHub
 * and Coolify. This one is Dyad's own identity for logging into a machine, so
 * there is one of it, it is never uploaded anywhere, and it outlives any single
 * server: the user adds its public half once and can reuse it for the next
 * server they set up.
 *
 * Kept out of ~/.ssh deliberately, for the reason the deploy keys are: that
 * directory holds identities the user maintains by hand, and Dyad treats it as
 * off-limits everywhere else.
 */

const KEY_NAME = "server_access";
const KEY_COMMENT = "dyad-server-access";

export function serverKeyDirPath(): string {
  return path.join(getUserDataPath(), "coolify_server_key");
}

export function serverKeyPath(): string {
  return path.join(serverKeyDirPath(), KEY_NAME);
}

export interface ServerKey {
  /** What the user adds to the server's authorized_keys. */
  publicKey: string;
  /** OpenSSH format, which is what the wire library accepts. */
  privateKey: string;
}

/**
 * The stored line when it names the key on disk, and the derived one when not.
 *
 * Both halves matter. Deriving alone renames the key — the comment comes from
 * whichever constant did the deriving — and the panel would show a different
 * line each launch than the one already installed on the server. Trusting the
 * stored file alone would hand back a public half belonging to some other key.
 */
function storedMatching(keyPath: string, derived: string): string {
  try {
    // The first line only, and matched on both fields. What comes back is
    // pasted into a server's authorized_keys, so anything further down the
    // file would be installed alongside the key it was checked for.
    const stored = fs
      .readFileSync(`${keyPath}.pub`, "utf8")
      .split("\n")[0]
      .trim();
    const [storedType, storedKey] = stored.split(/\s+/);
    const [derivedType, derivedKey] = derived.split(/\s+/);
    const sameKey = storedType === derivedType && storedKey === derivedKey;
    return sameKey ? `${stored}\n` : derived;
  } catch {
    return derived;
  }
}

/**
 * Returns Dyad's server key, creating it the first time.
 *
 * Reused rather than regenerated per server: the public half is something the
 * user pastes into a console by hand, and making them do that again for every
 * server would be the most tedious part of the whole flow.
 */
export function ensureServerKey(): ServerKey {
  const keyPath = serverKeyPath();
  if (fs.existsSync(keyPath)) {
    const privateKey = fs.readFileSync(keyPath, "utf8");
    const derived = publicKeyFromPrivate(privateKey);
    if (derived) {
      return { privateKey, publicKey: storedMatching(keyPath, derived) };
    }
    // A file that cannot be read as a key is worse than none: it would fail at
    // connect time with something about the wire format. Say so here instead.
    throw new DyadError(
      `The server key at ${keyPath} could not be read. Delete it and Dyad will ` +
        `generate a new one — you will need to add the new public key to your ` +
        `server.`,
      DyadErrorKind.Precondition,
    );
  }

  const pair = generateDeployKeyPair(KEY_COMMENT);
  fs.mkdirSync(serverKeyDirPath(), { recursive: true, mode: 0o700 });
  // 0600 is a no-op on Windows, where the directory's own permissions are what
  // protects this. Set anyway, because it is what protects it everywhere else.
  fs.writeFileSync(keyPath, pair.privateKey, { mode: 0o600 });
  fs.writeFileSync(`${keyPath}.pub`, pair.publicKey, { mode: 0o644 });
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}
