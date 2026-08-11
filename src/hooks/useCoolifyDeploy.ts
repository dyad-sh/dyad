import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { CoolifyDeploySnapshot } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

const IDLE: CoolifyDeploySnapshot = { type: "idle" };

/**
 * Renderer binding for one app's Coolify deployment machine.
 *
 * The snapshot is owned by the main process. Subscribing happens before the
 * initial read so a deployment that finishes mid-mount is not missed, and a
 * late-arriving initial read never overwrites an event already applied.
 */
export function useCoolifyDeploy(appId: number | null) {
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState<CoolifyDeploySnapshot>(IDLE);
  const receivedEvent = useRef(false);

  const status = useQuery({
    queryKey: queryKeys.coolify.status({ appId: appId ?? -1 }),
    queryFn: () => ipc.coolify.getStatus({ appId: appId! }),
    enabled: appId !== null,
  });

  const discovery = useQuery({
    queryKey: queryKeys.coolify.discovery(
      status.data?.instanceUrl ?? null,
      status.data?.tokenId ?? null,
    ),
    queryFn: () => ipc.coolify.discover(),
    enabled: appId !== null && Boolean(status.data?.hasToken),
  });

  const refreshStatus = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.coolify.status({ appId: appId ?? -1 }),
    });
  }, [appId, queryClient]);

  /**
   * Signing out and repointing the instance change every app's status, not
   * just this one: the token they share is what makes a connection readable.
   */
  const refreshAllStatuses = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.coolify.all });
  }, [queryClient]);

  useEffect(() => {
    if (appId === null) return;
    receivedEvent.current = false;
    setSnapshot(IDLE);

    const unsubscribe = ipc.events.coolify.onDeployStatus((payload) => {
      if (payload.appId !== appId) return;
      receivedEvent.current = true;
      setSnapshot(payload.snapshot);
      // A finished deployment writes the app's URL and application id in the
      // main process; nothing else tells this query they changed.
      if (
        payload.snapshot.type === "succeeded" ||
        payload.snapshot.type === "failed"
      ) {
        void refreshStatus();
      }
    });

    let cancelled = false;
    ipc.coolify
      .getDeploySnapshot({ appId })
      .then((initial) => {
        // An event that arrived while this was in flight is newer.
        if (!cancelled && !receivedEvent.current) setSnapshot(initial);
      })
      .catch(() => {
        // A transient read failure just leaves the panel idle; the next event
        // corrects it.
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [appId, refreshStatus]);

  /**
   * Drops every cached server and project list, rather than marking it stale.
   *
   * The key carries a token fingerprint read from the status query, and that
   * lags the write — so a refetch triggered by the change still runs under the
   * outgoing token's key while asking with the incoming one, leaving that
   * entry holding the wrong team's list for anyone who switches back. Removing
   * leaves nothing to serve; the lists are refetched, which the pickers
   * already show as loading.
   */
  const forgetDiscovery = useCallback(() => {
    queryClient.removeQueries({ queryKey: queryKeys.coolify.discoveryAll });
  }, [queryClient]);

  const saveToken = useMutation({
    mutationFn: (input: {
      instanceUrl: string;
      token: string;
      acknowledgedInsecure: boolean;
    }) => ipc.coolify.saveToken(input),
    onSuccess: async () => {
      forgetDiscovery();
      await refreshAllStatuses();
    },
  });

  const clearToken = useMutation({
    mutationFn: () => ipc.coolify.clearToken(),
    onSuccess: async () => {
      setSnapshot(IDLE);
      forgetDiscovery();
      await refreshAllStatuses();
    },
  });

  const saveConnection = useMutation({
    mutationFn: (connection: {
      serverUuid: string;
      projectUuid: string;
      environmentName: string;
      domain: string | null;
    }) => ipc.coolify.saveConnection({ appId: appId!, connection }),
    onSuccess: refreshStatus,
  });

  const createProject = useMutation({
    mutationFn: (name: string) => ipc.coolify.createProject({ name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.coolify.discoveryAll,
      });
    },
  });

  const checkDomain = useMutation({
    mutationFn: (input: { serverUuid: string; domain: string }) =>
      ipc.coolify.checkDomain(input),
  });

  const deploy = useMutation({
    mutationFn: () => ipc.coolify.deploy({ appId: appId! }),
  });

  const disconnect = useMutation({
    mutationFn: () => ipc.coolify.disconnect({ appId: appId! }),
    onSuccess: async () => {
      // Otherwise reconnecting shows the previous server's result.
      setSnapshot(IDLE);
      await refreshStatus();
    },
  });

  return {
    status: status.data,
    isStatusLoading: status.isLoading,
    statusError: status.error,
    refetchStatus: status.refetch,
    discovery: discovery.data,
    discoveryError: discovery.error,
    isDiscovering: discovery.isFetching,
    /**
     * No list yet and none refused — still loading, or paused because the
     * renderer is offline. isFetching is false while paused, so it cannot tell
     * "waiting" from "answered with nothing".
     */
    isDiscoveryPending: discovery.isPending && !discovery.error,
    refetchDiscovery: discovery.refetch,
    snapshot,
    saveToken,
    clearToken,
    saveConnection,
    createProject,
    checkDomain,
    deploy,
    disconnect,
  };
}
