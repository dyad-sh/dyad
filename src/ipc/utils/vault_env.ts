import fs from "node:fs";
import path from "node:path";

import { PROVIDER_TO_ENV_VAR } from "../shared/language_model_constants";
import type { UserSettings } from "../../lib/schemas";

/**
 * Mirrors the API keys held in settings into a `.env` inside the vault, and
 * reads them back when settings have lost them.
 *
 * The point is that the vault carries the keys: reinstall the app, move to
 * another machine, or lose the encrypted settings file, and the keys come back
 * from the vault instead of being typed in again.
 *
 * These values are stored in the clear. Settings keep the authoritative copy
 * encrypted via safeStorage; this file is a portable mirror, written owner-only
 * and accompanied by a .gitignore so a vault under version control never
 * commits it.
 */

export const VAULT_ENV_FILENAME = ".env";

/** Secrets that are not provider API keys, and the names they take. */
const STANDALONE_SECRETS = [
  {
    envName: "GITHUB_ACCESS_TOKEN",
    read: (s: UserSettings) => s.githubAccessToken?.value,
    apply: (value: string) => ({ githubAccessToken: { value } }),
    has: (s: UserSettings) => Boolean(s.githubAccessToken?.value),
  },
  {
    envName: "VERCEL_ACCESS_TOKEN",
    read: (s: UserSettings) => s.vercelAccessToken?.value,
    apply: (value: string) => ({ vercelAccessToken: { value } }),
    has: (s: UserSettings) => Boolean(s.vercelAccessToken?.value),
  },
  {
    envName: "VERCEL_AI_GATEWAY_API_KEY",
    read: (s: UserSettings) => s.vercelAiGatewayApiKey?.value,
    apply: (value: string) => ({ vercelAiGatewayApiKey: { value } }),
    has: (s: UserSettings) => Boolean(s.vercelAiGatewayApiKey?.value),
  },
  {
    envName: "ELEVENLABS_API_KEY",
    read: (s: UserSettings) => s.jarvis?.elevenLabsApiKey?.value,
    // Only the one field: the settings writer merges `jarvis` field by field.
    apply: (value: string) => ({ jarvis: { elevenLabsApiKey: { value } } }),
    has: (s: UserSettings) => Boolean(s.jarvis?.elevenLabsApiKey?.value),
  },
  {
    envName: "BLOB_READ_WRITE_TOKEN",
    read: (s: UserSettings) => s.vercelBlob?.token?.value,
    apply: (value: string) => ({ vercelBlob: { token: { value } } }),
    has: (s: UserSettings) => Boolean(s.vercelBlob?.token?.value),
  },
] as const;

/**
 * Provider id for an env var name, for the providers the app knows about.
 *
 * Only the reverse of the `PROVIDER_TO_ENV_VAR` half of `providerEnvName`: a
 * custom provider's name is slugged lossily and cannot be turned back into its
 * id, so those are recoverable only while settings still lists the provider.
 */
const ENV_VAR_TO_PROVIDER: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_TO_ENV_VAR).map(([providerId, envName]) => [
    envName,
    providerId,
  ]),
);

/** Env var name for a provider's API key. */
export function providerEnvName(providerId: string): string {
  const known = PROVIDER_TO_ENV_VAR[providerId];
  if (known) return known;
  // Custom providers: derive a stable, valid name from the id.
  const slug = providerId
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `${slug || "CUSTOM"}_API_KEY`;
}

/** Every populated API key in settings, keyed by env var name. */
export function collectSettingsSecrets(
  settings: UserSettings,
): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const [providerId, provider] of Object.entries(
    settings.providerSettings ?? {},
  )) {
    const value = provider?.apiKey?.value;
    if (value) entries[providerEnvName(providerId)] = value;
  }

  for (const secret of STANDALONE_SECRETS) {
    const value = secret.read(settings);
    if (value) entries[secret.envName] = value;
  }

  return entries;
}

/** A value quoted only when it needs to be, and escaped when quoted. */
function renderValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function renderEnvFile(entries: Record<string, string>): string {
  const lines = [
    "# Meta Human OS — API keys mirrored from Settings.",
    "# Written automatically. Edit a value here and the app picks it up for",
    "# any key it is missing; keys already set in Settings win.",
    "# Contains credentials in plain text: do not share or commit this file.",
    "",
  ];
  for (const name of Object.keys(entries).sort()) {
    lines.push(`${name}=${renderValue(entries[name])}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseEnvFile(contents: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;
    const [, name, rawValue] = match;
    let value = rawValue.trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (
      value.startsWith("'") &&
      value.endsWith("'") &&
      value.length >= 2
    ) {
      value = value.slice(1, -1);
    }
    if (value) entries[name] = value;
  }
  return entries;
}

export function vaultEnvPath(vaultPath: string): string {
  return path.join(vaultPath, VAULT_ENV_FILENAME);
}

/**
 * Writes the vault `.env`. Values already in the file that settings no longer
 * knows about are kept: the vault is the durable copy, and a settings file that
 * has lost a key should not take the vault's copy down with it.
 */
export async function writeVaultEnv(
  vaultPath: string,
  settings: UserSettings,
): Promise<{ path: string; count: number }> {
  const filePath = vaultEnvPath(vaultPath);
  const existing = await readVaultEnv(vaultPath);
  const merged = { ...existing, ...collectSettingsSecrets(settings) };

  await fs.promises.mkdir(vaultPath, { recursive: true });
  await fs.promises.writeFile(filePath, renderEnvFile(merged), {
    encoding: "utf8",
    mode: 0o600,
  });
  // writeFile only applies mode when creating, so enforce it on rewrites too.
  await fs.promises.chmod(filePath, 0o600).catch(() => {});
  await ensureEnvIgnored(vaultPath);

  return { path: filePath, count: Object.keys(merged).length };
}

export async function readVaultEnv(
  vaultPath: string,
): Promise<Record<string, string>> {
  try {
    const contents = await fs.promises.readFile(
      vaultEnvPath(vaultPath),
      "utf8",
    );
    return parseEnvFile(contents);
  } catch {
    return {};
  }
}

/** Keeps the file out of version control if the vault is ever a git repo. */
async function ensureEnvIgnored(vaultPath: string): Promise<void> {
  const ignorePath = path.join(vaultPath, ".gitignore");
  try {
    const current = await fs.promises
      .readFile(ignorePath, "utf8")
      .catch(() => "");
    if (current.split(/\r?\n/).some((line) => line.trim() === ".env")) return;
    const next = current && !current.endsWith("\n") ? `${current}\n` : current;
    await fs.promises.writeFile(ignorePath, `${next}.env\n`, "utf8");
  } catch {
    // A vault that will not take a .gitignore is not a reason to fail the sync.
  }
}

/**
 * Settings patch that fills in secrets the vault knows and settings does not.
 *
 * Never overwrites a populated key: what the user last entered in the app wins
 * over whatever the file happens to hold.
 */
export function settingsPatchFromEnv(
  settings: UserSettings,
  env: Record<string, string>,
): Partial<UserSettings> | null {
  const patch: Record<string, unknown> = {};

  const providerSettings: Record<string, unknown> = {};
  // Settings that were reset lose the provider entries themselves, not just the
  // keys they held, so take the ids the vault names as well rather than only
  // those settings still lists. Recovering from a wiped settings file is the
  // case this whole mirror exists for.
  const providerIds = new Set([
    ...Object.keys(settings.providerSettings ?? {}),
    ...Object.keys(env)
      .map((envName) => ENV_VAR_TO_PROVIDER[envName])
      .filter((providerId) => Boolean(providerId)),
  ]);

  for (const providerId of providerIds) {
    const provider = settings.providerSettings?.[providerId];
    if (provider?.apiKey?.value) continue;
    const value = env[providerEnvName(providerId)];
    if (value) {
      providerSettings[providerId] = { ...provider, apiKey: { value } };
    }
  }
  if (Object.keys(providerSettings).length > 0) {
    patch.providerSettings = {
      ...settings.providerSettings,
      ...providerSettings,
    };
  }

  for (const secret of STANDALONE_SECRETS) {
    if (secret.has(settings)) continue;
    const value = env[secret.envName];
    if (value) Object.assign(patch, secret.apply(value));
  }

  return Object.keys(patch).length > 0
    ? (patch as Partial<UserSettings>)
    : null;
}
