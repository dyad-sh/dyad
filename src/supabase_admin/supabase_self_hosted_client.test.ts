// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  startFakeSupabaseSelfHosted,
  type FakeSupabaseSelfHosted,
  type FakeSupabaseSelfHostedMode,
} from "@/testing/fake_supabase_self_hosted_server";
import {
  checkSupabaseSelfHostedInstance,
  normalizeSupabaseSelfHostedUrl,
  runSupabaseSelfHostedQuery,
  SupabaseSelfHostedRequestError,
} from "./supabase_self_hosted_client";
import { SUPABASE_SELF_HOSTED_TRANSPORT_ERROR_NAME } from "@/shared/supabase_self_hosted_error_names";
import cloudReference from "./__fixtures__/supabase_self_hosted/cloud-reference.json";
import coolifyTypes from "./__fixtures__/supabase_self_hosted/coolify/pg_query.types.json";
import coolifyErrorWithDetail from "./__fixtures__/supabase_self_hosted/coolify/pg_query.error_with_detail.json";
import coolifyStorageGuard from "./__fixtures__/supabase_self_hosted/coolify/pg_query.error_storage_delete_guard.json";
import coolifyTimeout from "./__fixtures__/supabase_self_hosted/coolify/pg_query.timeout_long_query.json";
import coolifyIdentity from "./__fixtures__/supabase_self_hosted/coolify/pg_query.identity.json";
import coolifyIdentityAsPostgres from "./__fixtures__/supabase_self_hosted/coolify/pg_query.identity_as_postgres.json";
import coolifyMissingTable from "./__fixtures__/supabase_self_hosted/coolify/pg_query.error_missing_table.json";
import coolifyAlterAuthUsers from "./__fixtures__/supabase_self_hosted/coolify/pg_query.alter_auth_users.json";
import coolifyAlterAuthUsersAsPostgres from "./__fixtures__/supabase_self_hosted/coolify/pg_query.alter_auth_users_as_postgres.json";

let fake: FakeSupabaseSelfHosted | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function start(mode: FakeSupabaseSelfHostedMode) {
  fake = await startFakeSupabaseSelfHosted(mode);
  return fake;
}

function queryRequests(server: FakeSupabaseSelfHosted) {
  return server.requests.filter((request) => request.path === "/pg/query");
}

describe("runSupabaseSelfHostedQuery", () => {
  it("runs the query as postgres with a statement timeout and returns the rows", async () => {
    const server = await start("upstream");
    server.onQuery = () => ({ status: 200, body: [{ x: 1 }] });

    await expect(
      runSupabaseSelfHostedQuery(
        { url: server.url, serviceKey: server.serviceKey },
        "select 1 as x",
      ),
    ).resolves.toEqual([{ x: 1 }]);

    const [request] = queryRequests(server);
    expect((request.body as { query: string }).query).toBe(
      "set role postgres; set statement_timeout = '45s';\nselect 1 as x",
    );
  });

  it("sends a new-format secret key on apikey only", async () => {
    const server = await start("upstream");
    await runSupabaseSelfHostedQuery(
      { url: server.url, serviceKey: server.serviceKey },
      "select 1",
    );
    const [request] = queryRequests(server);
    expect(request.headers.apikey).toBe(server.serviceKey);
    expect(request.headers.authorization).toBeUndefined();
  });

  it("also sends a legacy service_role JWT as the bearer token", async () => {
    const server = await start("coolify");
    await runSupabaseSelfHostedQuery(
      { url: server.url, serviceKey: server.serviceKey },
      "select 1",
    );
    const [request] = queryRequests(server);
    expect(request.headers.authorization).toBe(`Bearer ${server.serviceKey}`);
  });

  it("returns rows exactly as Supabase Cloud does (recorded)", async () => {
    const server = await start("coolify");
    server.onQuery = () => ({
      status: coolifyTypes.response.status,
      body: coolifyTypes.response.body,
    });

    const rows = await runSupabaseSelfHostedQuery(
      { url: server.url, serviceKey: server.serviceKey },
      "select ...",
    );
    // The recorded Cloud query also selected a json column the self-hosted
    // capture did not.
    const { js: _js, ...cloudRow } = cloudReference.types.body[0];
    expect(rows).toEqual([cloudRow]);
  });

  it.each([
    ["a missing table", coolifyMissingTable],
    ["a constraint violation with DETAIL", coolifyErrorWithDetail],
    ["the storage delete guard with HINT", coolifyStorageGuard],
  ])(
    "reports %s in Cloud's error format (recorded)",
    async (_label, fixture) => {
      const server = await start("coolify");
      server.onQuery = () => ({
        status: fixture.response.status,
        body: fixture.response.body,
      });

      const error = await runSupabaseSelfHostedQuery(
        { url: server.url, serviceKey: server.serviceKey },
        "select ...",
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(SupabaseSelfHostedRequestError);
      expect((error as Error).message).toBe(
        `Failed to run sql query: ${fixture.response.body.formattedError}`,
      );
      expect((error as SupabaseSelfHostedRequestError).kind).toBe(
        DyadErrorKind.Validation,
      );
    },
  );

  it("keeps DETAIL and HINT lines that Cloud's message also carries", () => {
    // Guards the premise of the test above: both backends put the full
    // Postgres text, including DETAIL and HINT, after the same prefix.
    expect(cloudReference.error_with_detail.body.message).toMatch(
      /^Failed to run sql query: ERROR: {2}23505: [\s\S]*\nDETAIL: {2}Key \(x\)=\(1\) already exists\.\n$/,
    );
    expect(coolifyErrorWithDetail.response.body.formattedError).toMatch(
      /^ERROR: {2}23505: [\s\S]*\nDETAIL: {2}Key \(x\)=\(1\) already exists\.\n$/,
    );
    expect(cloudReference.error_storage_delete_guard.body.message).toBe(
      `Failed to run sql query: ${coolifyStorageGuard.response.body.formattedError}`,
    );
  });

  it("reports the user's own line numbers despite the prefix line", async () => {
    const server = await start("upstream");
    server.onQuery = () => ({
      status: 400,
      body: {
        message: 'syntax error at or near "selec"',
        formattedError:
          'ERROR:  42601: syntax error at or near "selec"\nLINE 2: selec 1\n        ^\n',
      },
    });

    await expect(
      runSupabaseSelfHostedQuery(
        { url: server.url, serviceKey: server.serviceKey },
        "selec 1",
      ),
    ).rejects.toThrow(cloudReference.error_syntax.body.message);
  });

  it("explains a query that postgres-meta timed out (recorded)", async () => {
    const server = await start("coolify");
    server.onQuery = () => ({
      status: coolifyTimeout.response.status,
      body: coolifyTimeout.response.body,
    });

    await expect(
      runSupabaseSelfHostedQuery(
        { url: server.url, serviceKey: server.serviceKey },
        "select pg_sleep(70)",
      ),
    ).rejects.toThrow("the query took too long and was stopped");
  });

  it("names a missing /pg/ route as a gateway precondition", async () => {
    const server = await start("upstream");
    server.onQuery = () => ({ status: 404, body: { message: "no route" } });

    await expect(
      runSupabaseSelfHostedQuery(
        { url: server.url, serviceKey: server.serviceKey },
        "select 1",
      ),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition, status: 404 });
  });

  it("raises a transport error, filtered from telemetry, when nothing answers", async () => {
    const server = await start("upstream");
    const url = server.url;
    await server.close();
    fake = undefined;

    await expect(
      runSupabaseSelfHostedQuery(
        { url, serviceKey: "sb_secret_x" },
        "select 1",
      ),
    ).rejects.toMatchObject({
      name: SUPABASE_SELF_HOSTED_TRANSPORT_ERROR_NAME,
    });
  });
});

describe("recorded Coolify install", () => {
  it("runs postgres-meta as a superuser, which the prefix switches to postgres", () => {
    expect(coolifyIdentity.response.body).toEqual([
      { current_user: "supabase_admin", super: true },
    ]);
    expect(coolifyIdentityAsPostgres.response.body).toEqual(
      cloudReference.identity.body,
    );
  });

  it("lets the superuser alter auth.users, which the prefix refuses as Cloud does", () => {
    expect(coolifyAlterAuthUsers.response.status).toBe(200);
    expect(
      `Failed to run sql query: ${coolifyAlterAuthUsersAsPostgres.response.body.formattedError}`,
    ).toBe(cloudReference.alter_auth_users.body.message);
  });
});

describe("checkSupabaseSelfHostedInstance", () => {
  it.each(["upstream", "coolify"] as const)(
    "accepts a %s install without creating anything on it",
    async (mode) => {
      const server = await start(mode);

      await expect(
        checkSupabaseSelfHostedInstance({
          url: server.url,
          anonKey: server.anonKey,
          serviceKey: server.serviceKey,
        }),
      ).resolves.toBeUndefined();
      // Connecting creates no users on the instance.
      expect(server.liveUserIds.size).toBe(0);
      expect(
        server.requests.some((r) => r.path.startsWith("/auth/v1/admin/")),
      ).toBe(false);
    },
  );

  it("refuses an instance that lets the anon key run SQL", async () => {
    const server = await start("upstream");
    server.anonCanQuery = true;

    await expect(
      checkSupabaseSelfHostedInstance({
        url: server.url,
        anonKey: server.anonKey,
        serviceKey: server.serviceKey,
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("lets the anon key run SQL"),
    });
  });

  it("names the service key when the instance rejects it", async () => {
    const server = await start("upstream");

    await expect(
      checkSupabaseSelfHostedInstance({
        url: server.url,
        anonKey: server.anonKey,
        serviceKey: "sb_secret_wrong",
      }),
    ).rejects.toThrow("rejected the service key");
  });

  it("names the anon key when the instance rejects it", async () => {
    const server = await start("upstream");

    await expect(
      checkSupabaseSelfHostedInstance({
        url: server.url,
        anonKey: "sb_publishable_wrong",
        serviceKey: server.serviceKey,
      }),
    ).rejects.toThrow("rejected the anon key");
  });
});

describe("normalizeSupabaseSelfHostedUrl", () => {
  it.each([
    ["https://supabase.example.com/", "https://supabase.example.com"],
    ["  http://10.0.0.5:8000  ", "http://10.0.0.5:8000"],
    ["https://example.com/supabase//", "https://example.com/supabase"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeSupabaseSelfHostedUrl(input)).toBe(expected);
  });

  it.each([
    "supabase.example.com",
    "ftp://example.com",
    "https://user:pass@example.com",
  ])("rejects %j", (input) => {
    expect(normalizeSupabaseSelfHostedUrl(input)).toBeNull();
  });
});
