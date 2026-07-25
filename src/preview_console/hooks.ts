import {
  useKeyedController,
  useKeyedMachineSelector,
} from "@/state_machines/react";
import { useAppRunManager } from "@/app_run/AppRunProvider";

export function useConsoleEntries(appId: number | null) {
  const manager = useAppRunManager();
  const entries = useKeyedController(manager.previewConsole, appId ?? -1);
  return appId === null ? [] : entries;
}

export function useLatestConsoleEntry(appId: number | null) {
  const manager = useAppRunManager();
  return useKeyedMachineSelector(
    manager.previewConsole,
    appId ?? -1,
    (entries) => (appId === null ? undefined : entries.at(-1)),
  );
}
