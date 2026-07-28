import { randomInt } from "crypto";

// Coolify can seed its first admin account from environment variables during
// install, which is what lets Dyad set a server up without the user opening a
// terminal. The values only take effect when no admin exists yet, so this
// cannot take over an existing instance.

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
// Excludes quotes, backslash, backtick and $ so the value survives the
// single-quoted shell assignment below, and also # and ! because installers
// commonly write these into a .env file, where # starts a comment and would
// silently truncate the password.
const SYMBOLS = "@%^*_-+=";

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

/**
 * Builds a password meeting Coolify's rules: at least 8 characters with an
 * upper case letter, a lower case letter, a digit and a symbol.
 */
export function generateAdminPassword(length = 24): string {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const rest = Array.from(
    { length: Math.max(0, length - required.length) },
    () => pick(all),
  );
  const chars = [...required, ...rest];
  // Fisher-Yates, so the required characters are not always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export interface CoolifyAdminCredentials {
  username: string;
  email: string;
  password: string;
}

export function generateAdminCredentials(
  email: string,
): CoolifyAdminCredentials {
  return {
    username: "dyad-admin",
    // Asked for rather than invented: a made-up address on a reserved domain
    // fails validation that checks the domain resolves, and this is the
    // address the user signs in with.
    email,
    password: generateAdminPassword(),
  };
}

function assertShellSafe(value: string, label: string): void {
  if (/['\\]/.test(value)) {
    throw new Error(
      `${label} contains a character that cannot be passed safely`,
    );
  }
}

/**
 * The command that installs Coolify and seeds its admin account.
 *
 * Values are single-quoted, and characters that would escape those quotes are
 * rejected rather than escaped, since getting that subtly wrong would run
 * arbitrary text as a command on the user's server.
 */
export function buildInstallCommand(
  credentials: CoolifyAdminCredentials,
): string {
  assertShellSafe(credentials.username, "Username");
  assertShellSafe(credentials.email, "Email");
  assertShellSafe(credentials.password, "Password");
  return (
    `env ROOT_USERNAME='${credentials.username}' ` +
    `ROOT_USER_EMAIL='${credentials.email}' ` +
    `ROOT_USER_PASSWORD='${credentials.password}' ` +
    `bash -c "curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash"`
  );
}

export function dashboardUrl(host: string): string {
  return `http://${host}:8000`;
}

/** Polls the dashboard until it answers, since the install returns before it is up. */
export async function waitForDashboard(
  host: string,
  { timeoutMs = 5 * 60 * 1000, intervalMs = 5000 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(dashboardUrl(host), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      // Any answer means it is listening; the status itself does not matter.
      if (res.status > 0) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
