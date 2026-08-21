import { describe, expect, it } from "vitest";
import { COOLIFY_REQUIRED_SCOPES, COOLIFY_SCOPES } from "./coolify_scopes";

describe("the scopes Dyad asks for", () => {
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
