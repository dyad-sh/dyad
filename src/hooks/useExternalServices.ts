/**
 * External Services Hook
 * 
 * React hook for managing external services (n8n, Celestia, Ollama).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { servicesClient, type ServiceId, type ServiceStatus, type ServiceConfig } from "@/ipc/services_client";
import { toast } from "sonner";

const SERVICES_QUERY_KEY = ["services", "status"];
const SERVICES_LIST_KEY = ["services", "list"];

/**
 * Hook for fetching and managing external services
 */
export function useExternalServices() {
  const queryClient = useQueryClient();

  // Fetch all service statuses
  const statusQuery = useQuery({
    queryKey: SERVICES_QUERY_KEY,
    queryFn: () => servicesClient.getAllStatus(),
    refetchInterval: 10000, // Refresh every 10 seconds
    staleTime: 5000,
  });

  // Fetch service configs
  const configQuery = useQuery({
    queryKey: SERVICES_LIST_KEY,
    queryFn: () => servicesClient.listServices(),
    staleTime: 60000, // Configs don't change often
  });

  // Start service mutation
  const startMutation = useMutation({
    mutationFn: (serviceId: ServiceId) => servicesClient.startService(serviceId),
    onMutate: (serviceId) => {
      toast.loading(`Starting ${serviceId}...`, { id: `service-${serviceId}` });
    },
    onSuccess: (result, serviceId) => {
      if (result.running) {
        toast.success(`${result.name} started successfully`, { id: `service-${serviceId}` });
      } else {
        toast.error(`Failed to start ${result.name}: ${result.error || "Unknown error"}`, { id: `service-${serviceId}` });
      }
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
    onError: (error, serviceId) => {
      toast.error(`Failed to start ${serviceId}: ${error instanceof Error ? error.message : "Unknown error"}`, { id: `service-${serviceId}` });
    },
  });

  // Stop service mutation
  const stopMutation = useMutation({
    mutationFn: (serviceId: ServiceId) => servicesClient.stopService(serviceId),
    onMutate: (serviceId) => {
      toast.loading(`Stopping ${serviceId}...`, { id: `service-${serviceId}` });
    },
    onSuccess: (result, serviceId) => {
      if (!result.running) {
        toast.success(`${result.name} stopped`, { id: `service-${serviceId}` });
      } else {
        toast.warning(`${result.name} may still be running`, { id: `service-${serviceId}` });
      }
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
    onError: (error, serviceId) => {
      toast.error(`Failed to stop ${serviceId}: ${error instanceof Error ? error.message : "Unknown error"}`, { id: `service-${serviceId}` });
    },
  });

  // Restart service mutation
  const restartMutation = useMutation({
    mutationFn: (serviceId: ServiceId) => servicesClient.restartService(serviceId),
    onMutate: (serviceId) => {
      toast.loading(`Restarting ${serviceId}...`, { id: `service-${serviceId}` });
    },
    onSuccess: (result, serviceId) => {
      if (result.running) {
        toast.success(`${result.name} restarted successfully`, { id: `service-${serviceId}` });
      } else {
        toast.error(`Failed to restart ${result.name}`, { id: `service-${serviceId}` });
      }
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
    onError: (error, serviceId) => {
      toast.error(`Failed to restart ${serviceId}: ${error instanceof Error ? error.message : "Unknown error"}`, { id: `service-${serviceId}` });
    },
  });

  // Start all services mutation
  const startAllMutation = useMutation({
    mutationFn: () => servicesClient.startAllServices(),
    onMutate: () => {
      toast.loading("Starting all services...", { id: "services-all" });
    },
    onSuccess: (results) => {
      const running = results.filter((r) => r.running).length;
      toast.success(`Started ${running}/${results.length} services`, { id: "services-all" });
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(`Failed to start services: ${error instanceof Error ? error.message : "Unknown error"}`, { id: "services-all" });
    },
  });

  // Stop all services mutation
  const stopAllMutation = useMutation({
    mutationFn: () => servicesClient.stopAllServices(),
    onMutate: () => {
      toast.loading("Stopping all services...", { id: "services-all" });
    },
    onSuccess: () => {
      toast.success("All services stopped", { id: "services-all" });
      queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(`Failed to stop services: ${error instanceof Error ? error.message : "Unknown error"}`, { id: "services-all" });
    },
  });

  // Get status for a specific service
  const getServiceStatus = (serviceId: ServiceId): ServiceStatus | undefined => {
    return statusQuery.data?.find((s) => s.id === serviceId);
  };

  // Get config for a specific service
  const getServiceConfig = (serviceId: ServiceId): ServiceConfig | undefined => {
    return configQuery.data?.find((c) => c.id === serviceId);
  };

  return {
    // Data
    services: statusQuery.data ?? [],
    configs: configQuery.data ?? [],
    
    // Loading states
    isLoading: statusQuery.isLoading || configQuery.isLoading,
    isRefetching: statusQuery.isRefetching,
    
    // Actions
    startService: startMutation.mutate,
    stopService: stopMutation.mutate,
    restartService: restartMutation.mutate,
    startAllServices: startAllMutation.mutate,
    stopAllServices: stopAllMutation.mutate,
    refetch: () => queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY }),
    
    // Helpers
    getServiceStatus,
    getServiceConfig,
    
    // Mutation states
    isPending: startMutation.isPending || stopMutation.isPending || restartMutation.isPending,
  };
}

export default useExternalServices;
