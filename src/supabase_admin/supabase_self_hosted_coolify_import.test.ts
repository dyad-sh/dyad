// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import type { CoolifyClient } from "@/ipc/utils/coolify_client";
import { generateSshKeyPair } from "@/testing/fake_ssh_server";
import {
  startFakeEdgeRuntimeSsh,
  type FakeEdgeRuntimeSsh,
} from "@/testing/fake_supabase_edge_runtime_ssh";
import {
  importCoolifySupabaseService,
  listCoolifySupabaseServices,
} from "./supabase_self_hosted_coolify_import";

let ssh: FakeEdgeRuntimeSsh | undefined;
afterEach(async () => {
  await ssh?.close();
  ssh = undefined;
});

const SUPABASE_SERVICE = {
  uuid: "svc-supabase",
  name: "supabase-t2np",
  service_type: "supabase",
  server_id: 0,
  docker_compose_raw: "services:\n  supabase-kong:\n    image: kong:2.8.1\n",
};
const URL_ENV = {
  key: "SERVICE_URL_SUPABASEKONG",
  value: "http://supabasekong-t2np.203.0.113.7.sslip.io",
  real_value: "http://supabasekong-t2np.203.0.113.7.sslip.io",
};
const KEY_ENVS = [
  {
    key: "SERVICE_SUPABASEANON_KEY",
    value: "anon-jwt",
    real_value: "anon-jwt",
  },
  {
    key: "SERVICE_SUPABASESERVICE_KEY",
    value: "service-jwt",
    real_value: "service-jwt",
  },
  // Coolify's newer template declares these but leaves them empty.
  { key: "SUPABASE_PUBLISHABLE_KEY", value: "", real_value: "" },
];

/** Answers the reads the import makes, in the shapes Coolify's API documents. */
function fakeCoolify({
  services = [SUPABASE_SERVICE] as unknown[],
  envs = [URL_ENV, ...KEY_ENVS],
  servers = [
    { id: 0, ip: "host.docker.internal", user: "root", port: 22 },
  ] as unknown[],
  keys = [] as unknown[] | Error,
} = {}): CoolifyClient {
  return {
    listServicesRaw: async () => services,
    listServiceEnvsRaw: async () => envs,
    listServersRaw: async () => servers,
    listPrivateKeysRaw: async () => {
      if (keys instanceof Error) throw keys;
      return keys;
    },
  } as unknown as CoolifyClient;
}

describe("listCoolifySupabaseServices", () => {
  it("lists only Supabase services, with their API URL", async () => {
    const client = fakeCoolify({
      services: [
        { uuid: "svc-other", name: "plausible", service_type: "plausible" },
        SUPABASE_SERVICE,
        // An older service without service_type, found by its images.
        {
          uuid: "svc-old",
          name: "old-supabase",
          docker_compose_raw: "image: supabase/studio:2024",
        },
      ],
    });

    await expect(listCoolifySupabaseServices(client)).resolves.toEqual([
      { uuid: "svc-old", name: "old-supabase", url: URL_ENV.value },
      { uuid: "svc-supabase", name: "supabase-t2np", url: URL_ENV.value },
    ]);
  });
});

describe("importCoolifySupabaseService", () => {
  it("fills in the URL and the keys Coolify's gateway accepts", async () => {
    const imported = await importCoolifySupabaseService({
      client: fakeCoolify({ servers: [] }),
      coolifyInstanceUrl: "http://203.0.113.7:8000",
      serviceUuid: "svc-supabase",
    });

    expect(imported).toEqual({
      name: "supabase-t2np",
      url: URL_ENV.value,
      anonKey: "anon-jwt",
      serviceKey: "service-jwt",
      studioUrl: URL_ENV.value,
      ssh: null,
    });
  });

  it("adds a scheme to a bare FQDN", async () => {
    const imported = await importCoolifySupabaseService({
      client: fakeCoolify({
        servers: [],
        envs: [
          {
            key: "SERVICE_FQDN_SUPABASEKONG",
            value: "supabasekong.example.com/",
            real_value: "supabasekong.example.com/",
          },
          ...KEY_ENVS,
        ],
      }),
      coolifyInstanceUrl: "http://203.0.113.7:8000",
      serviceUuid: "svc-supabase",
    });

    expect(imported.url).toBe("http://supabasekong.example.com");
  });

  it("finds the Coolify key that logs in to the server Coolify runs on", async () => {
    ssh = await startFakeEdgeRuntimeSsh();
    const right = generateSshKeyPair();
    const wrong = generateSshKeyPair();
    const gitKey = generateSshKeyPair();
    // The Git key would log in too, so using it would show here.
    ssh.authorizedKeys = [gitKey.public, right.public];

    const imported = await importCoolifySupabaseService({
      client: fakeCoolify({
        servers: [
          { id: 3, ip: "198.51.100.1", user: "admin", port: 2222 },
          // Coolify's own machine, as Coolify names it.
          { id: 0, ip: "host.docker.internal", user: "root", port: ssh.port },
        ],
        keys: [
          // A Git deploy key is never tried on a server.
          { private_key: gitKey.private, is_git_related: true },
          { private_key: wrong.private, is_git_related: false },
          { private_key: right.private, is_git_related: false },
        ],
      }),
      coolifyInstanceUrl: "http://127.0.0.1:8000",
      serviceUuid: "svc-supabase",
    });

    expect(imported.ssh).toEqual({
      host: "127.0.0.1",
      port: ssh.port,
      username: "root",
      privateKey: `${right.private.trim()}\n`,
    });
    // The wrong key, then the right one.
    expect(ssh.connections).toBe(1);
  });

  it("leaves the key out when the token can't read keys", async () => {
    const imported = await importCoolifySupabaseService({
      client: fakeCoolify({ keys: new Error("403") }),
      coolifyInstanceUrl: "http://203.0.113.7:8000",
      serviceUuid: "svc-supabase",
    });

    expect(imported.ssh).toEqual({
      host: "203.0.113.7",
      port: 22,
      username: "root",
      privateKey: null,
    });
  });

  it("explains a service without its URL or keys", async () => {
    await expect(
      importCoolifySupabaseService({
        client: fakeCoolify({ envs: [URL_ENV] }),
        coolifyInstanceUrl: "http://203.0.113.7:8000",
        serviceUuid: "svc-supabase",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  });
});
