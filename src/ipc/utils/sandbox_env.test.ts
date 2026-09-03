import { describe, expect, it } from "vitest";

import { withoutInheritedDatabaseEnv } from "./sandbox_env";

describe("withoutInheritedDatabaseEnv", () => {
  it("removes every inherited database credential", () => {
    // `dotenv` will not overwrite a variable that is already set, so anything
    // left here beats the isolated value the sandbox wrote into `.env.local` —
    // for the install's lifecycle scripts, the sandbox server, and any spec
    // that reads `process.env` directly.
    expect(
      withoutInheritedDatabaseEnv({
        DATABASE_URL: "postgres://real/db",
        DIRECT_URL: "postgres://real/db",
        POSTGRES_PRISMA_URL: "postgres://real/db",
        NEXT_PUBLIC_SUPABASE_URL: "https://real.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        NEON_API_KEY: "neon-key",
        PGHOST: "real.example.com",
        PGPASSWORD: "hunter2",
        PATH: "/usr/bin",
        NODE_ENV: "test",
      }),
    ).toEqual({ PATH: "/usr/bin", NODE_ENV: "test" });
  });

  it("keeps variables that merely look adjacent", () => {
    expect(
      withoutInheritedDatabaseEnv({
        PGDATA: "/var/lib/pg",
        HOME: "/home/dyad",
      }),
    ).toEqual({ PGDATA: "/var/lib/pg", HOME: "/home/dyad" });
  });
});
