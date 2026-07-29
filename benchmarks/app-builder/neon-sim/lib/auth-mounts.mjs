// Per-(project, branch) better-auth instances standing in for Managed Neon Auth.
// Config requirements validated by the S-AUTH spike (spikes/s-auth/README.md):
// better-auth 1.4.18 (the version @neondatabase/auth pins), cookiePrefix
// "neon-auth" + useSecureCookies so upstream cookies are named
// __Secure-neon-auth.*, email verification off. Tables live in the neon_auth
// schema OF THE BRANCH'S OWN DATABASE (like managed Neon Auth), via a pool
// whose search_path is pinned to neon_auth.
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { getMigrations } from "better-auth/db";
import pg from "pg";
import { SIM_ROLE, SIM_ROLE_PASSWORD } from "./state.mjs";

const PG_HOST = process.env.SIM_PG_HOST ?? "127.0.0.1";
const PG_PORT = Number(process.env.SIM_PG_PORT ?? 5432);

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// mountKey = `${projectId}/${branchId}` -> { handler, pool, dbName }
const mounts = new Map();

async function bootstrapDb(dbName) {
  // Schema + migrations run as simuser (the db owner) so table ownership is
  // consistent with what generated apps can query.
  const bootstrapPool = new pg.Pool({
    host: PG_HOST,
    port: PG_PORT,
    user: SIM_ROLE,
    password: SIM_ROLE_PASSWORD,
    database: dbName,
    max: 1,
  });
  await bootstrapPool.query("CREATE SCHEMA IF NOT EXISTS neon_auth");
  await bootstrapPool.end();
}

export async function getAuthMount({ projectId, branchId, dbName, baseUrl }) {
  const key = `${projectId}/${branchId}`;
  if (mounts.has(key)) return mounts.get(key);

  await bootstrapDb(dbName);

  const pool = new pg.Pool({
    host: PG_HOST,
    port: PG_PORT,
    user: SIM_ROLE,
    password: SIM_ROLE_PASSWORD,
    database: dbName,
    max: 5,
    options: "-csearch_path=neon_auth",
  });

  const auth = betterAuth({
    baseURL: baseUrl,
    basePath: new URL(baseUrl).pathname,
    secret: `neon-sim-${projectId}-secret-0123456789abcdef0123456789abcdef`,
    database: pool,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    // Benchmark apps run on arbitrary localhost ports; trust any local origin.
    // (better-auth also invokes this at init time with no request — guard it.)
    trustedOrigins: (request) => {
      const origin = request?.headers?.get?.("origin");
      return origin && LOCAL_ORIGIN.test(origin) ? [origin] : [];
    },
    advanced: {
      cookiePrefix: "neon-auth",
      useSecureCookies: true,
    },
  });

  // Idempotent: template-copied branch DBs already have the tables; on a fresh
  // main DB this creates user/session/account/verification in neon_auth.
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  // Managed Neon Auth reports schema_name neon_auth / table_name "users";
  // better-auth's table is "user" — expose the documented name as a view so
  // model-written JOINs against neon_auth.users work.
  await pool.query(
    `CREATE OR REPLACE VIEW neon_auth.users AS SELECT * FROM neon_auth."user"`,
  );

  const mount = { handler: toNodeHandler(auth), pool, dbName, key };
  mounts.set(key, mount);
  return mount;
}

export function findMountByPath(pathname) {
  // /authsvc/<projectId>/<branchId>/...
  const m = pathname.match(/^\/authsvc\/([^/]+)\/([^/]+)(\/|$)/);
  if (!m) return null;
  return mounts.get(`${m[1]}/${m[2]}`) ?? null;
}

export async function closeMountsForDb(dbName) {
  for (const [key, mount] of mounts) {
    if (mount.dbName === dbName) {
      await mount.pool.end().catch(() => {});
      mounts.delete(key);
    }
  }
}

export async function closeAllMounts() {
  for (const [, mount] of mounts) await mount.pool.end().catch(() => {});
  mounts.clear();
}
