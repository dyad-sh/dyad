import { describe, expect, it } from "vitest";
import { AddSupabaseSelfHostedInstanceParamsSchema } from "./supabase";

describe("AddSupabaseSelfHostedInstanceParamsSchema", () => {
  const params = (keys: object) => ({
    name: "Home lab",
    url: "https://supabase.example.com",
    studioUrl: null,
    anonKey: "anon",
    serviceKey: "service",
    ssh: { host: "203.0.113.7", port: 22, username: "root", ...keys },
  });

  it("takes either a pasted key or a Coolify key", () => {
    for (const keys of [
      { privateKey: "pasted" },
      { coolifyKeyUuid: "key-1" },
    ]) {
      expect(
        AddSupabaseSelfHostedInstanceParamsSchema.safeParse(params(keys))
          .success,
      ).toBe(true);
    }
  });

  it("refuses neither or both", () => {
    for (const keys of [
      {},
      { privateKey: "pasted", coolifyKeyUuid: "key-1" },
    ]) {
      expect(
        AddSupabaseSelfHostedInstanceParamsSchema.safeParse(params(keys))
          .success,
      ).toBe(false);
    }
  });
});
