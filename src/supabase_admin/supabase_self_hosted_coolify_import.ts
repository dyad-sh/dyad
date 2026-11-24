import log from "electron-log";
import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { CoolifyClient } from "@/ipc/utils/coolify_client";
import { connectSsh, trustOnFirstUse } from "@/ipc/utils/ssh_client";

const logger = log.scope("supabase_self_hosted_coolify_import");

/**
 * Reads what the self-hosted Supabase form asks for from a Supabase service
 * deployed with Coolify's one-click template, so the user picks a service
 * instead of finding each value.
 */

const ServiceSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  service_type: z.string().nullable().optional(),
  server_id: z.number().nullable().optional(),
  docker_compose_raw: z.string().nullable().optional(),
});
type Service = z.infer<typeof ServiceSchema>;

const EnvSchema = z.object({
  key: z.string(),
  value: z.string().nullable().optional(),
  real_value: z.string().nullable().optional(),
});

const ServerSchema = z.object({
  id: z.number().optional(),
  ip: z.string().nullable().optional(),
  user: z.string().nullable().optional(),
  port: z.number().nullable().optional(),
  settings: z
    .object({ public_ipv4: z.string().nullable().optional() })
    .nullable()
    .optional(),
});
type Server = z.infer<typeof ServerSchema>;

const PrivateKeySchema = z.object({
  uuid: z.string().nullable().optional(),
  private_key: z.string().nullable().optional(),
  is_git_related: z.boolean().nullable().optional(),
});

/** Tried in order; more than this many keys is not a single Coolify box. */
const MAX_KEYS_TRIED = 10;

/** Coolify's name for the machine it runs on, from inside its container. */
const LOCAL_SERVER_HOSTS = new Set([
  "host.docker.internal",
  "localhost",
  "127.0.0.1",
  "::1",
]);

function parseList<T>(body: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(body)) {
    throw new DyadError(
      "Coolify answered with something other than a list. This instance may be a version Dyad does not understand.",
      DyadErrorKind.External,
    );
  }
  return body.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function isSupabaseService(service: Service): boolean {
  return (
    /supabase/i.test(service.service_type ?? "") ||
    /supabase\/(studio|edge-runtime|gotrue)/.test(
      service.docker_compose_raw ?? "",
    )
  );
}

async function readEnvs(
  client: CoolifyClient,
  serviceUuid: string,
): Promise<Map<string, string>> {
  const envs = parseList(
    await client.listServiceEnvsRaw(serviceUuid),
    EnvSchema,
  );
  const values = new Map<string, string>();
  for (const env of envs) {
    // real_value has references to other variables resolved.
    const value = (env.real_value || env.value || "").trim();
    if (value) values.set(env.key, value);
  }
  return values;
}

/** The gateway's public address: Coolify stores it with or without a scheme. */
function apiUrlFrom(envs: Map<string, string>): string | null {
  const value =
    envs.get("SERVICE_URL_SUPABASEKONG") ??
    envs.get("SERVICE_FQDN_SUPABASEKONG");
  if (!value) return null;
  const first = value.split(",")[0].trim();
  return (/^https?:\/\//i.test(first) ? first : `http://${first}`).replace(
    /\/+$/,
    "",
  );
}

export interface CoolifySupabaseService {
  uuid: string;
  name: string;
  url: string | null;
}

export async function listCoolifySupabaseServices(
  client: CoolifyClient,
): Promise<CoolifySupabaseService[]> {
  const services = parseList(await client.listServicesRaw(), ServiceSchema)
    .filter(isSupabaseService)
    .sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(
    services.map(async (service) => ({
      uuid: service.uuid,
      name: service.name,
      url: apiUrlFrom(await readEnvs(client, service.uuid)),
    })),
  );
}

export interface CoolifySupabaseImport {
  name: string;
  url: string;
  anonKey: string;
  serviceKey: string;
  studioUrl: string;
  ssh: {
    host: string;
    port: number;
    username: string;
    /**
     * The Coolify key that logs in to the server, or null when none does.
     * The key itself stays in main: adding the instance reads it again.
     */
    coolifyKeyUuid: string | null;
  } | null;
}

function sshTargetFor(
  server: Server | undefined,
  coolifyInstanceUrl: string,
): { host: string; port: number; username: string } | null {
  if (!server) return null;
  const ip = server.ip?.trim() ?? "";
  // Coolify reaches its own machine as host.docker.internal. From Dyad that
  // machine is the one serving Coolify.
  let host = ip;
  if (!ip || LOCAL_SERVER_HOSTS.has(ip)) {
    host = server.settings?.public_ipv4?.trim() || "";
    if (!host) {
      try {
        host = new URL(coolifyInstanceUrl).hostname;
      } catch {
        host = "";
      }
    }
  }
  if (!host) return null;
  return {
    host,
    port: server.port || 22,
    username: server.user || "root",
  };
}

/** Keys that let Coolify into the user's servers; deploy keys for Git are not. */
async function listServerKeys(
  client: CoolifyClient,
): Promise<{ uuid: string; privateKey: string }[]> {
  return parseList(await client.listPrivateKeysRaw(), PrivateKeySchema).flatMap(
    (key) =>
      !key.is_git_related && key.uuid && key.private_key?.trim()
        ? [{ uuid: key.uuid, privateKey: key.private_key.trim() }]
        : [],
  );
}

/**
 * Coolify does not say which key a server uses, so each of its server keys
 * is tried until one logs in.
 */
async function findWorkingKey(
  client: CoolifyClient,
  target: { host: string; port: number; username: string },
): Promise<string | null> {
  let keys;
  try {
    keys = await listServerKeys(client);
  } catch (error) {
    // A token without the root permission cannot read keys. The rest of the
    // import still works; the user can paste a key.
    logger.warn("Could not list Coolify's private keys", error);
    return null;
  }
  for (const key of keys.slice(0, MAX_KEYS_TRIED)) {
    try {
      const session = await connectSsh(
        { ...target, privateKey: `${key.privateKey}\n` },
        // Only checks that the key logs in. Adding the instance pins the
        // host key, as for a key the user pastes.
        trustOnFirstUse(() => {}),
      );
      session.end();
      return key.uuid;
    } catch (error) {
      logger.info("A Coolify key did not log in to the Supabase server", error);
    }
  }
  return null;
}

/** The private key an import chose, read from Coolify when the instance is added. */
export async function readCoolifyServerKey(
  client: CoolifyClient,
  keyUuid: string,
): Promise<string> {
  const key = (await listServerKeys(client)).find(
    (candidate) => candidate.uuid === keyUuid,
  );
  if (!key) {
    throw new DyadError(
      "Coolify no longer has the SSH key the import chose. Import the service again, or paste a key.",
      DyadErrorKind.NotFound,
    );
  }
  return key.privateKey;
}

export async function importCoolifySupabaseService({
  client,
  coolifyInstanceUrl,
  serviceUuid,
}: {
  client: CoolifyClient;
  coolifyInstanceUrl: string;
  serviceUuid: string;
}): Promise<CoolifySupabaseImport> {
  const service = parseList(await client.listServicesRaw(), ServiceSchema).find(
    (candidate) => candidate.uuid === serviceUuid,
  );
  if (!service) {
    throw new DyadError(
      "That Supabase service is no longer in Coolify.",
      DyadErrorKind.NotFound,
    );
  }
  const envs = await readEnvs(client, serviceUuid);
  const url = apiUrlFrom(envs);
  // Coolify's gateway checks the older JWT keys, so they come first.
  const anonKey =
    envs.get("SERVICE_SUPABASEANON_KEY") ??
    envs.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey =
    envs.get("SERVICE_SUPABASESERVICE_KEY") ?? envs.get("SUPABASE_SECRET_KEY");
  if (!url || !anonKey || !serviceKey) {
    throw new DyadError(
      "Coolify didn't return this service's URL and keys. Make sure it was created from Coolify's Supabase template and has been deployed.",
      DyadErrorKind.Precondition,
    );
  }

  const servers = parseList(await client.listServersRaw(), ServerSchema);
  const server =
    servers.find(
      (candidate) =>
        candidate.id !== undefined && candidate.id === service.server_id,
    ) ?? (servers.length === 1 ? servers[0] : undefined);
  const target = sshTargetFor(server, coolifyInstanceUrl);

  return {
    name: service.name,
    url,
    anonKey,
    serviceKey,
    // Kong serves Studio at the gateway's root.
    studioUrl: url,
    ssh: target
      ? { ...target, coolifyKeyUuid: await findWorkingKey(client, target) }
      : null,
  };
}
