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
    const publicKey = publicKeyFromPrivate(privateKey);
    if (publicKey) return { privateKey, publicKey };
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
