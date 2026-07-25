import { useMemo, useSyncExternalStore } from "react";
import { useAtomValue, useStore } from "jotai";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { integrationProviderSelectionAtom } from "@/atoms/integrationAtoms";
import {
  getUserInputReadModel,
  type UserInputReadModelSnapshot,
  type UserInputRequests,
} from "./read_model";
import {
  selectPendingIntegrations,
  selectPendingQuestionnaires,
  selectPendingToolConsents,
} from "./selectors";

export function useUserInputReadModel(): ReturnType<
  typeof getUserInputReadModel
> {
  return getUserInputReadModel({ store: useStore() });
}

export function useUserInputSnapshot(): UserInputReadModelSnapshot {
  const readModel = useUserInputReadModel();
  return useSyncExternalStore(readModel.subscribe, readModel.getSnapshot);
}

export function useUserInputRequests(): UserInputRequests {
  const readModel = useUserInputReadModel();
  return useSyncExternalStoreWithSelector(
    readModel.subscribe,
    readModel.getSnapshot,
    undefined,
    (snapshot) => snapshot.requests,
  );
}

export function useRespondingRequestIds(): ReadonlySet<string> {
  const readModel = useUserInputReadModel();
  return useSyncExternalStoreWithSelector(
    readModel.subscribe,
    readModel.getSnapshot,
    undefined,
    (snapshot) => snapshot.respondingRequestIds,
  );
}

export function usePendingQuestionnaires() {
  const readModel = useUserInputReadModel();
  return useSyncExternalStoreWithSelector(
    readModel.subscribe,
    readModel.getSnapshot,
    undefined,
    selectPendingQuestionnaires,
  );
}

export function usePendingIntegrations() {
  const requests = useUserInputRequests();
  const selectedProviders = useAtomValue(integrationProviderSelectionAtom);
  return useMemo(
    () => selectPendingIntegrations(requests, selectedProviders),
    [requests, selectedProviders],
  );
}

export function usePendingToolConsents(chatId: number | undefined) {
  const readModel = useUserInputReadModel();
  return useSyncExternalStoreWithSelector(
    readModel.subscribe,
    readModel.getSnapshot,
    undefined,
    (snapshot) => selectPendingToolConsents(snapshot, chatId),
  );
}
