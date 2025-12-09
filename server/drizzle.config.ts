import type { Config } from "drizzle-kit";
import path from "node:path";

export default {
    schema: "../src/db/schema.ts",
    out: "./drizzle",
    dialect: "sqlite",
    dbCredentials: {
        url: process.env.DATABASE_URL || "./data/sqlite.db",
    },
} satisfies Config;
