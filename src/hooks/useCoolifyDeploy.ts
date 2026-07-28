import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ipc,
  coolifyEventClient,
  type CoolifyConnection,
  type CoolifyDeploySnapshot,
  type CoolifyInstallSnapshot,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

const IDLE_INSTALL: CoolifyInstallSnapshot = {
  status: "idle",
  log: "",
  error: null,
  dashboardUrl: null,
  credentials: null,
};

const IDLE: CoolifyDeploySnapshot = {
  status: "idle",
  stage: null,
  error: null,
  log: "",
  url: null,
  startedAt: null,
  finishedAt: null,
};

export function useCoolifyDeploy(appId: number | null) {
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState<CoolifyDeploySnapshot>(IDLE);

  const { data: status, isLoading: isStatusLoading } = useQuery({
    queryKey: queryKeys.coolify.status({ appId: appId ?? -1 }),
    queryFn: async () => ipc.coolify.getStatus({ appId: appId! }),
    enabled: appId !== null,
  });

  // The main process owns deploy state, so re-fetch on mount to survive a
  // renderer reload mid-deploy, then follow pushed updates.
  useEffect(() => {
    if (appId === null) return;
    let disposed = false;
    void ipc.coolify.getDeploySnapshot({ appId }).then((current) => {
      if (!disposed) setSnapshot(current);
    });
    const unsubscribe = coolifyEventClient.onDeployStatus((payload) => {
      if (payload.appId === appId) setSnapshot(payload.snapshot);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [appId]);

  const invalidate = () => {
    if (appId !== null) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.coolify.status({ appId }),
      });
    }
  };

  const [installSnapshot, setInstallSnapshot] =
    useState<CoolifyInstallSnapshot>(IDLE_INSTALL);

  // The main process owns install state, so re-read it on mount and then
  // follow pushed updates; an install outlives this component.
  useEffect(() => {
    let disposed = false;
    void ipc.coolify.getInstallSnapshot().then((current) => {
      if (!disposed) setInstallSnapshot(current);
    });
    const unsubscribe = coolifyEventClient.onInstallStatus((payload) => {
      setInstallSnapshot(payload.snapshot);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const install = useMutation({
    mutationFn: async (input: {
      adminEmail: string;
      sshHost: string;
      sshUser: string;
      sshPort: number;
    }) => ipc.coolify.install(input),
  });

  const saveToken = useMutation({
    mutationFn: async (input: { instanceUrl: string; token: string }) =>
      ipc.coolify.saveToken(input),
    onSuccess: invalidate,
  });

  const discovery = useQuery({
    queryKey: queryKeys.coolify.discovery,
    queryFn: async () => ipc.coolify.discover(),
    enabled: Boolean(status?.hasToken),
  });

  const clearToken = useMutation({
    mutationFn: async () => ipc.coolify.clearToken(),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.coolify.discovery,
      });
    },
  });

  const createProject = useMutation({
    mutationFn: async (name: string) => ipc.coolify.createProject({ name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.coolify.discovery,
      });
    },
  });

  const generateSshKey = useMutation({
    mutationFn: async () => ipc.coolify.generateSshKey(),
    onSuccess: invalidate,
  });

  const regenerateSshKey = useMutation({
    mutationFn: async () => ipc.coolify.regenerateSshKey(),
    onSuccess: invalidate,
  });

  const testSsh = useMutation({
    mutationFn: async (input: {
      sshHost: string;
      sshUser: string;
      sshPort: number;
    }) => ipc.coolify.testSsh(input),
  });

  const saveConnection = useMutation({
    mutationFn: async (connection: Omit<CoolifyConnection, "instanceUrl">) =>
      ipc.coolify.saveConnection({ appId: appId!, connection }),
    onSuccess: invalidate,
  });

  const deploy = useMutation({
    mutationFn: async () => ipc.coolify.deploy({ appId: appId! }),
  });

  const disconnect = useMutation({
    mutationFn: async () => ipc.coolify.disconnect({ appId: appId! }),
    onSuccess: invalidate,
  });

  return {
    status: status ?? null,
    isStatusLoading,
    snapshot,
    discovery: discovery.data ?? null,
    isDiscovering: discovery.isFetching,
    discoveryError: discovery.error,
    refetchDiscovery: discovery.refetch,
    clearToken: clearToken.mutateAsync,
    isClearingToken: clearToken.isPending,
    createProject: createProject.mutateAsync,
    isCreatingProject: createProject.isPending,
    installSnapshot,
    install: install.mutateAsync,
    saveToken: saveToken.mutateAsync,
    isSavingToken: saveToken.isPending,
    generateSshKey: generateSshKey.mutateAsync,
    regenerateSshKey: regenerateSshKey.mutateAsync,
    isRegeneratingSshKey: regenerateSshKey.isPending,
    isGeneratingSshKey: generateSshKey.isPending,
    testSsh: testSsh.mutateAsync,
    isTestingSsh: testSsh.isPending,
    sshTestResult: testSsh.data ?? null,
    saveConnection: saveConnection.mutateAsync,
    isSavingConnection: saveConnection.isPending,
    deploy: deploy.mutateAsync,
    disconnect: disconnect.mutateAsync,
  };
}
