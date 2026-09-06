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
    case "app-name":
      // Covers both the folder-preview and name-check caches. The hooks that
      // own these keys disable refetch-on-mount/focus/reconnect, so the
      // consumer purges their entries rather than just marking them stale.
      return [queryKeys.appName.checkAll, queryKeys.appName.folderPreviewAll];
    case "media":
      return [queryKeys.media.all];
    case "token-count":
      return [queryKeys.tokenCount.all];
    case "user-budget":
      return [queryKeys.userBudget.info];
    case "free-agent-quota":
      return [queryKeys.freeAgentQuota.status];
    case "free-model-quota":
      return [queryKeys.freeModelQuota.status];
    case "app":
      return [queryKeys.apps.detail({ appId: scope.appId })];
    case "coolify":
      return [
        scope.appId === undefined
          ? queryKeys.coolify.all
          : queryKeys.coolify.status({ appId: scope.appId }),
      ];
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
    case "uncommitted-files":
      return [
        scope.appId === undefined
          ? queryKeys.uncommittedFiles.all
          : queryKeys.uncommittedFiles.byApp({ appId: scope.appId }),
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
