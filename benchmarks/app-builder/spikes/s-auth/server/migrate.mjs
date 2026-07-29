import { getMigrations } from "better-auth/db";
import { auth } from "./auth-server.mjs";

const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(
  auth.options,
);
console.log(
  "[migrate] creating:",
  toBeCreated.map((t) => t.table),
  "adding:",
  toBeAdded.map((t) => t.table),
);
await runMigrations();
console.log("[migrate] done");
process.exit(0);
