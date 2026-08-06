import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { queryKeysForInvalidationScope } from "./query_keys";

describe("the coolify scope", () => {
  it("reaches the status query, which apps and app do not", () => {
    // A contract can declare an invalidation for a scope this function does
    // not map, and nothing complains: the event fires, resolves to no keys,
    // and the panel in the other window stays exactly as stale as before.
    // That is what the coolify contracts did until this scope existed.
    expect(
      queryKeysForInvalidationScope({ family: "coolify", appId: 7 }),
    ).toEqual([queryKeys.coolify.status({ appId: 7 })]);

    expect(queryKeysForInvalidationScope({ family: "coolify" })).toEqual([
      queryKeys.coolify.all,
    ]);

    // The other scopes those contracts declare reach the list and the detail,
    // neither of which is where the connection is read from.
    const others = [
      ...queryKeysForInvalidationScope({ family: "apps" }),
      ...queryKeysForInvalidationScope({ family: "app", appId: 7 }),
    ];
    expect(others).not.toContainEqual(queryKeys.coolify.status({ appId: 7 }));
  });
});
