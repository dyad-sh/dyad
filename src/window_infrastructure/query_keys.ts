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
    case "provider-status":
      return [
        queryKeys.settings.all,
        scope.provider === "github"
          ? queryKeys.github.all
          : scope.provider === "supabase"
            ? queryKeys.supabase.all
            : queryKeys.neon.all,
      ];
    case "mcp-servers":
      return [queryKeys.mcp.servers];
    case "mcp-catalog":
      return [queryKeys.mcp.catalog];
    case "mcp-tools":
      // Tool discovery is currently batched by the complete server-ID set.
      // A server-scoped durable event therefore invalidates the family root.
      return [queryKeys.mcp.toolsByServer.all];
  }
}
