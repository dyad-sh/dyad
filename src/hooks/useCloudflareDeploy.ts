import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type {
  CloudflareDeploymentStatus,
  ConnectCloudflareWorkerParams,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showWarning } from "@/lib/toast";
import { isDeploymentInProgress } from "@/cloudflare_deploy/build_config";

/** An unsynced app is about to be synced; notice when it has been. */
const SYNC_POLL_MS = 4_000;
/**
 * How often to ask Cloudflare whether it can see the repository yet: quickly
 * while the user is likely mid-grant, then slowly for a prompt left open.
 */
const REPO_ACCESS_POLL_MS = 4_000;
const REPO_ACCESS_SLOW_POLL_MS = 15_000;
const REPO_ACCESS_FAST_WINDOW_MS = 60_000;
/** A push starts a build Dyad is not told about, so an idle card still polls. */
const IDLE_STATUS_POLL_MS = 15_000;
const ACTIVE_STATUS_POLL_MS = 5_000;
/**
 * Everything here reports state that changes outside Dyad: a push, a grant in
 * a browser, a Worker made in the dashboard. The app-wide default keeps a
 * result for a minute, which would show the tab an answer from before the
 * user went and changed it.
 */
const ALWAYS_REFETCH = { staleTime: 0 } as const;

export function useSaveCloudflareToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => ipc.cloudflare.saveToken({ token }),
    onSuccess: () => {
      // Accounts, Workers and statuses fetched with another token are not
      // this token's.
      queryClient.removeQueries({ queryKey: queryKeys.cloudflare.all });
    },
  });
}

export function useCloudflareAccounts() {
  return useQuery({
    queryKey: queryKeys.cloudflare.accounts,
    queryFn: () => ipc.cloudflare.listAccounts(),
    ...ALWAYS_REFETCH,
  });
}

export function useCloudflareWorkers({
  accountId,
}: {
  accountId: string | null;
}) {
  return useQuery({
    queryKey: queryKeys.cloudflare.workers({ accountId }),
    queryFn: () => ipc.cloudflare.listWorkers({ accountId: accountId! }),
    enabled: accountId !== null,
    ...ALWAYS_REFETCH,
  });
}

export function useCloudflareAppStatus({ appId }: { appId: number }) {
  return useQuery({
    queryKey: queryKeys.cloudflare.appStatus({ appId }),
    queryFn: () => ipc.cloudflare.getAppStatus({ appId }),
    ...ALWAYS_REFETCH,
    refetchInterval: (query) =>
      query.state.data?.synced === false ? SYNC_POLL_MS : false,
  });
}

/**
 * Whether Cloudflare can read the app's repository. While it cannot, the user
 * is away granting access in a browser, so this keeps asking until it can.
 */
export function useCloudflareRepoAccess({
  appId,
  accountId,
}: {
  appId: number;
  accountId: string;
}) {
  // Timed from when the prompt appears, so each wait starts out quick.
  const [waitingSince] = useState(() => Date.now());
  return useQuery({
    queryKey: queryKeys.cloudflare.repoAccess({ appId, accountId }),
    queryFn: () => ipc.cloudflare.checkRepoAccess({ appId, accountId }),
    ...ALWAYS_REFETCH,
    // A failed check is not an answer, so it keeps asking until access is seen.
    refetchInterval: (query) =>
      query.state.data?.hasAccess === true
        ? false
        : Date.now() - waitingSince < REPO_ACCESS_FAST_WINDOW_MS
          ? REPO_ACCESS_POLL_MS
          : REPO_ACCESS_SLOW_POLL_MS,
  });
}

export function useCloudflareDeploymentStatus({
  appId,
  rootDirectory,
}: {
  appId: number;
  rootDirectory: string;
}) {
  return useQuery<CloudflareDeploymentStatus>({
    queryKey: queryKeys.cloudflare.deploymentStatus({ appId, rootDirectory }),
    queryFn: () => ipc.cloudflare.getDeploymentStatus({ appId, rootDirectory }),
    ...ALWAYS_REFETCH,
    refetchInterval: (query) =>
      query.state.data && isDeploymentInProgress(query.state.data.state)
        ? ACTIVE_STATUS_POLL_MS
        : IDLE_STATUS_POLL_MS,
  });
}

export function useConnectCloudflareWorker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: ConnectCloudflareWorkerParams) =>
      ipc.cloudflare.connectWorker(params),
    onSuccess: (result, params) => {
      if (result.status !== "connected") return;
      // The form is gone once the folder is connected, so this is the only
      // place left to say the first deployment did not start.
      if (result.warning) showWarning(result.warning);
      forgetDeploymentStatus(queryClient, params);
      queryClient.invalidateQueries({
        queryKey: queryKeys.cloudflare.appStatus({ appId: params.appId }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.cloudflare.workers({ accountId: params.accountId }),
      });
    },
  });
}

export function useDisconnectCloudflareWorker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { appId: number; rootDirectory: string }) =>
      ipc.cloudflare.disconnect(params),
    onSuccess: (_, params) => {
      forgetDeploymentStatus(queryClient, params);
      queryClient.invalidateQueries({
        queryKey: queryKeys.cloudflare.appStatus({ appId: params.appId }),
      });
    },
  });
}

/**
 * A folder's status is cached by folder, not by connection, so without this a
 * reconnected folder would open on the status of the connection it replaced.
 */
function forgetDeploymentStatus(
  queryClient: QueryClient,
  { appId, rootDirectory }: { appId: number; rootDirectory: string },
) {
  queryClient.removeQueries({
    queryKey: queryKeys.cloudflare.deploymentStatus({ appId, rootDirectory }),
  });
}
