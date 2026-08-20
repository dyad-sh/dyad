import { randomInt } from "crypto";

/**
 * The admin account Coolify seeds itself with during installation.
 *
 * Coolify creates its first user from environment variables the installer
 * writes, which is what lets Dyad set a server up without the user ever opening
 * the dashboard. The values only take effect while no admin exists, so this
 * cannot take over an instance somebody is already using.
 */

/**
 * Excludes quote, backslash, backtick and $ so the value survives a shell, and
 * # and ! because these land in a .env file, where # starts a comment and would
 * silently truncate the password.
 */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "@%^*_-+=";

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

/**
 * A password Coolify will accept.
 *
 * Its rule is at least eight characters with an upper case letter, a lower case
 * letter, a digit and a symbol, and it additionally rejects passwords found in
 * known breaches. A generated 24-character value clears both, though the breach
 * check is a network call made by the server, so seeding needs the server to
 * have outbound access.
 */
export function generateAdminPassword(length = 24): string {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const rest = Array.from(
    { length: Math.max(0, length - required.length) },
    () => pick(all),
  );
  const chars = [...required, ...rest];
  // Fisher-Yates, so the four required characters are not always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export interface AdminCredentials {
  username: string;
  email: string;
  password: string;
}

/**
 * Whether a value can be carried to the server without being escaped.
 *
 * These are written into a shell assignment and then into a .env file. Rather
 * than escape them for each, values containing a character that would end the
 * quoting are rejected outright — getting that subtly wrong runs arbitrary text
 * as a command on somebody's server.
 */
export function isShellSafe(value: string): boolean {
  return !/['"\\`$\n\r#!]/.test(value);
}

export function buildAdminCredentials(email: string): AdminCredentials {
  return {
    username: "dyad-admin",
    // Asked for rather than invented, because the domain has to resolve and
    // because this is the address the user signs in with afterwards.
    email: email.trim(),
    password: generateAdminPassword(),
  };
}
