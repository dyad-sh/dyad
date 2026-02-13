import { defineSchema } from "convex/server";
import { authTables } from "@convex-dev/auth/server";

const applicationTables = {};

export default defineSchema({
  ...authTables,
  ...applicationTables,
});
