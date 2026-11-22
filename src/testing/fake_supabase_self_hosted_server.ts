import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A fake self-hosted Supabase instance for tests, modeled on responses
 * recorded from real installs:
 *
 * - "upstream": the official Docker Compose setup (Envoy gateway, new
 *   sb_publishable/sb_secret keys, postgres-meta running as `postgres`, auth
 *   links on the public URL).
 * - "coolify": Coolify's one-click template (Kong gateway, legacy JWT keys that
 *   the admin API wants on both apikey and Authorization, postgres-meta running
 *   as the `supabase_admin` superuser, auth links on the internal
 *   http://supabase-kong:8000).
 */
export type FakeSupabaseSelfHostedMode = "upstream" | "coolify";

export interface FakeSupabaseSelfHostedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

export interface FakeSupabaseSelfHosted {
  url: string;
  anonKey: string;
  serviceKey: string;
  requests: FakeSupabaseSelfHostedRequest[];
  /** Overrides the /pg/query answer for a service-key request. */
  onQuery: (query: string) => { status: number; body: unknown } | undefined;
  /** Lets the anon key run SQL, as a misconfigured gateway would. */
  anonCanQuery: boolean;
  /** Ids of admin-created users that have not been deleted. */
  liveUserIds: Set<string>;
  /** The body /functions/v1/<name> answers with, or undefined for 404. */
  serveFunction: (name: string) => string | undefined;
  /** What /auth/v1/settings reports as mailer_autoconfirm. */
  mailerAutoconfirm: boolean;
  close: () => Promise<void>;
}

const KEYS: Record<
  FakeSupabaseSelfHostedMode,
  { anonKey: string; serviceKey: string }
> = {
  upstream: {
    anonKey: "sb_publishable_fake-anon",
    serviceKey: "sb_secret_fake-service",
  },
  coolify: {
    anonKey: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.fake-anon",
    serviceKey: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake",
  },
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function startFakeSupabaseSelfHosted(
  mode: FakeSupabaseSelfHostedMode,
): Promise<FakeSupabaseSelfHosted> {
  const { anonKey, serviceKey } = KEYS[mode];
  let nextUserId = 1;

  const fake: FakeSupabaseSelfHosted = {
    url: "",
    anonKey,
    serviceKey,
    requests: [],
    onQuery: () => undefined,
    anonCanQuery: false,
    liveUserIds: new Set(),
    serveFunction: () => undefined,
    mailerAutoconfirm: false,
    close: async () => {},
  };

  const keyOf = (req: http.IncomingMessage) => {
    const apikey = req.headers.apikey;
    return typeof apikey === "string" ? apikey : undefined;
  };
  const isService = (req: http.IncomingMessage) => {
    if (keyOf(req) !== serviceKey) return false;
    // Kong's admin routes read the role from the bearer JWT.
    return (
      mode === "upstream" ||
      req.headers.authorization === `Bearer ${serviceKey}`
    );
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const path = req.url ?? "/";
      fake.requests.push({
        method: req.method ?? "GET",
        path,
        headers: req.headers,
        body,
      });
      const key = keyOf(req);

      if (!key) {
        return json(res, 401, { message: "No API key found in request" });
      }
      if (key !== anonKey && key !== serviceKey) {
        return json(res, 401, {
          message: "Invalid authentication credentials",
        });
      }

      const functionPath = /^\/functions\/v1\/([^/?]+)/.exec(path);
      if (functionPath) {
        const answer = fake.serveFunction(functionPath[1]);
        if (answer === undefined) {
          return json(res, 404, {
            code: "NOT_FOUND",
            message: "Requested function was not found",
          });
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end(answer);
      }

      if (path === "/auth/v1/settings" && req.method === "GET") {
        if (keyOf(req) !== anonKey && keyOf(req) !== serviceKey) {
          return json(res, 401, {
            message: "Invalid authentication credentials",
          });
        }
        return json(res, 200, {
          external: { email: true },
          disable_signup: false,
          mailer_autoconfirm: fake.mailerAutoconfirm,
        });
      }

      if (path === "/auth/v1/health" && req.method === "GET") {
        return json(res, 200, { version: "fake", name: "GoTrue" });
      }

      if (path === "/pg/query" && req.method === "POST") {
        if (key === anonKey && !fake.anonCanQuery) {
          return mode === "coolify"
            ? json(res, 403, { message: "You cannot consume this service" })
            : json(res, 403, "RBAC: access denied");
        }
        const query = String((body as { query?: unknown })?.query ?? "");
        const override = fake.onQuery(query);
        if (override) return json(res, override.status, override.body);
        return json(res, 200, [{ "?column?": 1 }]);
      }

      if (path === "/auth/v1/admin/users" && req.method === "POST") {
        if (!isService(req)) {
          return json(res, mode === "coolify" ? 401 : 403, {
            code: 403,
            error_code: "not_admin",
            msg: "User not allowed",
          });
        }
        const id = `00000000-0000-4000-8000-${String(nextUserId++).padStart(12, "0")}`;
        fake.liveUserIds.add(id);
        return json(res, 200, {
          id,
          email: (body as { email?: string }).email,
        });
      }

      const userMatch = path.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
      if (userMatch && req.method === "DELETE") {
        if (!isService(req)) return json(res, 403, { msg: "User not allowed" });
        fake.liveUserIds.delete(decodeURIComponent(userMatch[1]));
        return json(res, 200, {});
      }

      return json(res, 404, { message: "no Route matched with those values" });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  fake.url = `http://127.0.0.1:${port}`;
  fake.close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  return fake;
}
