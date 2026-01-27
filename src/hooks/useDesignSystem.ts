/**
 * React hooks for the Design System Generator
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  designSystemClient,
  type DesignSystem,
  type DesignSystemId,
  type Component,
  type ComponentId,
  type DesignTokens,
  type GenerateSystemParams,
  type GenerateComponentParams,
  type ExportOptions,
  type DesignSystemEvent,
} from "../ipc/design_system_client.js";

// Query keys
const DESIGN_SYSTEM_KEYS = {
  all: ["design-system"] as const,
  systems: () => [...DESIGN_SYSTEM_KEYS.all, "systems"] as const,
  system: (id: DesignSystemId) => [...DESIGN_SYSTEM_KEYS.systems(), id] as const,
};

// ---------------------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------------------

export function useDesignSystemInit() {
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    designSystemClient
      .initialize()
      .then(() => setInitialized(true))
      .catch((err) => setError(String(err)));
  }, []);

  return { initialized, error };
}

// ---------------------------------------------------------------------------
// SYSTEMS
// ---------------------------------------------------------------------------

export function useDesignSystems() {
  const { initialized } = useDesignSystemInit();

  return useQuery({
    queryKey: DESIGN_SYSTEM_KEYS.systems(),
    queryFn: () => designSystemClient.listSystems(),
    enabled: initialized,
  });
}

export function useDesignSystem(systemId: DesignSystemId | null) {
  const { initialized } = useDesignSystemInit();

  return useQuery({
    queryKey: DESIGN_SYSTEM_KEYS.system(systemId!),
    queryFn: () => designSystemClient.getSystem(systemId!),
    enabled: initialized && !!systemId,
    refetchInterval: (query) => {
      // Refetch frequently while generating
      const system = query.state.data;
      return system?.status === "generating" ? 1000 : false;
    },
  });
}

export function useCreateDesignSystem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: GenerateSystemParams) => designSystemClient.createSystem(params),
    onSuccess: (system) => {
      queryClient.invalidateQueries({ queryKey: DESIGN_SYSTEM_KEYS.systems() });
      toast.success(`Design system "${system.name}" created`);
    },
    onError: (error) => {
      toast.error(`Failed to create design system: ${error}`);
    },
  });
}

export function useGenerateDesignSystem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (systemId: DesignSystemId) => designSystemClient.generateSystem(systemId),
    onSuccess: (system) => {
      queryClient.invalidateQueries({ queryKey: DESIGN_SYSTEM_KEYS.system(system.id) });
      toast.success(`Design system "${system.name}" generated`);
    },
    onError: (error) => {
      toast.error(`Failed to generate design system: ${error}`);
    },
  });
}

export function useDeleteDesignSystem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (systemId: DesignSystemId) => designSystemClient.deleteSystem(systemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DESIGN_SYSTEM_KEYS.systems() });
      toast.success("Design system deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete design system: ${error}`);
    },
  });
}

export function useUpdateTokens() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ systemId, tokens }: { systemId: DesignSystemId; tokens: Partial<DesignTokens> }) =>
      designSystemClient.updateTokens(systemId, tokens),
    onSuccess: (system) => {
      queryClient.invalidateQueries({ queryKey: DESIGN_SYSTEM_KEYS.system(system.id) });
      toast.success("Tokens updated");
    },
    onError: (error) => {
      toast.error(`Failed to update tokens: ${error}`);
    },
  });
}

// ---------------------------------------------------------------------------
// COMPONENTS
// ---------------------------------------------------------------------------

export function useGenerateComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: GenerateComponentParams) => designSystemClient.generateComponent(params),
    onSuccess: (component, { systemId }) => {
      queryClient.invalidateQueries({ queryKey: DESIGN_SYSTEM_KEYS.system(systemId) });
      toast.success(`Component "${component.name}" generated`);
    },
    onError: (error) => {
      toast.error(`Failed to generate component: ${error}`);
    },
  });
}

export function useUpdateComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      systemId,
      componentId,
      updates,
    }: {
      systemId: DesignSystemId;
      componentId: ComponentId;
      updates: Partial<Component>;
    }) => designSystemClient.updateComponent(systemId, componentId, updates),
    onSuccess: (component, { systemId }) => {
      queryClient.invalidateQueries({ queryKey: DESIGN_SYSTEM_KEYS.system(systemId) });
      toast.success(`Component "${component.name}" updated`);
    },
    onError: (error) => {
      toast.error(`Failed to update component: ${error}`);
    },
  });
}

export function useDeleteComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ systemId, componentId }: { systemId: DesignSystemId; componentId: ComponentId }) =>
      designSystemClient.deleteComponent(systemId, componentId),
    onSuccess: (_, { systemId }) => {
      queryClient.invalidateQueries({ queryKey: DESIGN_SYSTEM_KEYS.system(systemId) });
      toast.success("Component deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete component: ${error}`);
    },
  });
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

export function useExportDesignSystem() {
  return useMutation({
    mutationFn: ({ systemId, options }: { systemId: DesignSystemId; options: ExportOptions }) =>
      designSystemClient.exportSystem(systemId, options),
    onSuccess: (outputDir) => {
      toast.success(`Design system exported to ${outputDir}`);
    },
    onError: (error) => {
      toast.error(`Failed to export design system: ${error}`);
    },
  });
}

// ---------------------------------------------------------------------------
// EVENTS
// ---------------------------------------------------------------------------

export function useDesignSystemEvents(systemId?: DesignSystemId) {
  const [events, setEvents] = useState<DesignSystemEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<DesignSystemEvent | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const handleEvent = (event: DesignSystemEvent) => {
      setLatestEvent(event);
      setEvents((prev) => [...prev.slice(-49), event]); // Keep last 50 events
    };

    const subscribe = async () => {
      if (systemId) {
        unsubscribeRef.current = await designSystemClient.subscribeToSystem(systemId, handleEvent);
      } else {
        unsubscribeRef.current = await designSystemClient.subscribe(handleEvent);
      }
    };

    subscribe();

    return () => {
      unsubscribeRef.current?.();
    };
  }, [systemId]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  return { events, latestEvent, clearEvents };
}

// ---------------------------------------------------------------------------
// COMBINED HOOK
// ---------------------------------------------------------------------------

export function useDesignSystemGenerator() {
  const { initialized, error: initError } = useDesignSystemInit();
  const { data: systems, isLoading: isLoadingSystems } = useDesignSystems();
  const [selectedSystemId, setSelectedSystemId] = useState<DesignSystemId | null>(null);
  const { data: selectedSystem } = useDesignSystem(selectedSystemId);

  const createSystem = useCreateDesignSystem();
  const generateSystem = useGenerateDesignSystem();
  const deleteSystem = useDeleteDesignSystem();
  const updateTokens = useUpdateTokens();
  const generateComponent = useGenerateComponent();
  const updateComponent = useUpdateComponent();
  const deleteComponent = useDeleteComponent();
  const exportSystem = useExportDesignSystem();

  const { events, latestEvent } = useDesignSystemEvents(selectedSystemId ?? undefined);

  // Handle events
  useEffect(() => {
    if (!latestEvent) return;

    switch (latestEvent.type) {
      case "system:generating":
        toast.loading("Generating design system...");
        break;
      case "system:ready":
        toast.dismiss();
        toast.success("Design system ready!");
        break;
      case "system:error":
        toast.dismiss();
        toast.error(`Generation failed: ${latestEvent.data?.error}`);
        break;
      case "export:started":
        toast.loading("Exporting design system...");
        break;
      case "export:completed":
        toast.dismiss();
        break;
      case "export:error":
        toast.dismiss();
        toast.error(`Export failed: ${latestEvent.data?.error}`);
        break;
    }
  }, [latestEvent]);

  return {
    // State
    initialized,
    initError,
    systems: systems || [],
    selectedSystem,
    selectedSystemId,
    events,
    latestEvent,

    // Actions
    setSelectedSystemId,
    createSystem: createSystem.mutateAsync,
    generateSystem: generateSystem.mutateAsync,
    deleteSystem: deleteSystem.mutateAsync,
    updateTokens: (systemId: DesignSystemId, tokens: Partial<DesignTokens>) =>
      updateTokens.mutateAsync({ systemId, tokens }),
    generateComponent: generateComponent.mutateAsync,
    updateComponent: (systemId: DesignSystemId, componentId: ComponentId, updates: Partial<Component>) =>
      updateComponent.mutateAsync({ systemId, componentId, updates }),
    deleteComponent: (systemId: DesignSystemId, componentId: ComponentId) =>
      deleteComponent.mutateAsync({ systemId, componentId }),
    exportSystem: (systemId: DesignSystemId, options: ExportOptions) =>
      exportSystem.mutateAsync({ systemId, options }),

    // Loading states
    isLoadingSystems,
    isCreating: createSystem.isPending,
    isGenerating: generateSystem.isPending,
    isExporting: exportSystem.isPending,
  };
}
