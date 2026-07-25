import type { QueryKey } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import type { QueryInvalidationScope } from "./types";

export function queryKeysForInvalidationScope(
  scope: QueryInvalidationScope,
): readonly QueryKey[] {
  switch (scope.family) {
    case "apps":
      return [queryKeys.apps.all];
    case "chats":
      return [queryKeys.chats.all];
    case "app-collections":
      return [queryKeys.appCollections.all];
    case "app":
      return [queryKeys.apps.detail({ appId: scope.appId })];
    case "versions":
      return [
        scope.appId === undefined
          ? queryKeys.versions.all
          : queryKeys.versions.list({ appId: scope.appId }),
      ];
    case "branches":
      return [
        scope.appId === undefined
          ? queryKeys.branches.all
          : queryKeys.branches.byApp({ appId: scope.appId }),
      ];
    case "problems":
      return [
        scope.appId === undefined
          ? queryKeys.problems.all
          : queryKeys.problems.byApp({ appId: scope.appId }),
      ];
    case "chat":
      return [queryKeys.chats.detail({ chatId: scope.chatId })];
  }
}
