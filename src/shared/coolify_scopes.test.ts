import { describe, expect, it } from "vitest";
import { COOLIFY_REQUIRED_SCOPES, COOLIFY_SCOPES } from "./coolify_scopes";

describe("the scopes Dyad asks for", () => {
  it("asks for exactly these four", () => {
    // Written out rather than derived. Every other assertion about scopes in
    // the repo comes from this array, so only a literal notices the array
    // itself losing an entry — dropping `write` here would otherwise pass the
    // whole suite and fail the first deploy.
    expect(COOLIFY_SCOPES).toEqual([
      "read",
      "read:sensitive",
      "write",
      "deploy",
    ]);
  });

  it("keeps read:sensitive, which the deployment log is hidden behind", () => {
    // Coolify's api.sensitive middleware hides a deployment's `logs` and an
    // application's `private_key_id` without it, and the deploy path reads
    // both. Dropping it costs the build output on every failed deploy, and
    // nothing fails — the field simply stops arriving.
    expect(COOLIFY_SCOPES).toContain("read:sensitive");
  });

  it("does not ask for root", () => {
    // Coolify treats root as a bypass of the ability check rather than as a
    // set of abilities, and no route asks for it.
    expect(COOLIFY_REQUIRED_SCOPES).not.toContain("root");
  });
});
