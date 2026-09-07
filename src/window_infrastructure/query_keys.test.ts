import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { queryKeysForInvalidationScope } from "./query_keys";

describe("the app-name scope", () => {
  it("reaches both the check and folder-preview caches", () => {
    // Both the name-check and folder-preview hooks disable every React Query
    // refetch trigger and share no key prefix with {family:"apps"} or
    // {family:"app"}, so without this scope no lifecycle invalidation could
    // reach them. The scope maps to both roots so a single delete/rename
    // clears every name's cached verdict.
    expect(queryKeysForInvalidationScope({ family: "app-name" })).toEqual([
      queryKeys.appName.checkAll,
      queryKeys.appName.folderPreviewAll,
    ]);
  });

  it("is not reached by the apps or app scopes", () => {
    // The roots are intentionally distinct from the apps family: ["apps"] is
    // not a prefix of ["checkAppName", ...] or ["appFolderPreview", ...], so
    // an {family:"apps"} invalidation alone cannot clear a stale preview.
    const appsKeys = [
      ...queryKeysForInvalidationScope({ family: "apps" }),
      ...queryKeysForInvalidationScope({ family: "app", appId: 7 }),
    ];
    for (const key of appsKeys) {
      expect(key).not.toEqual(queryKeys.appName.checkAll);
      expect(key).not.toEqual(queryKeys.appName.folderPreviewAll);
    }
  });

  it("prefixes the per-name keys the hooks cache under", () => {
    // invalidateQueries/removeQueries are prefix matches: invalidating the
    // root must cover every per-name/per-appId entry the hooks create.
    const checkEntry = queryKeys.appName.check({ name: "my-app" });
    const folderEntry = queryKeys.appName.folderPreview({
      name: "my-app",
      appId: 7,
    });
    expect(checkEntry.slice(0, queryKeys.appName.checkAll.length)).toEqual(
      queryKeys.appName.checkAll,
    );
    expect(
      folderEntry.slice(0, queryKeys.appName.folderPreviewAll.length),
    ).toEqual(queryKeys.appName.folderPreviewAll);
  });
});

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
