import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "jotai";
import { useManagerLifecycle } from "@/state_machines/react";
import { AppRunManager } from "./manager";

const AppRunContext = createContext<AppRunManager | null>(null);

export function AppRunProvider({
  children,
  manager: providedManager,
}: {
  children: ReactNode;
  manager?: AppRunManager;
}) {
  if (providedManager) {
    return (
      <ProvidedAppRunProvider manager={providedManager}>
        {children}
      </ProvidedAppRunProvider>
    );
  }
  return <OwnedAppRunProvider>{children}</OwnedAppRunProvider>;
}

function ProvidedAppRunProvider({
  children,
  manager,
}: {
  children: ReactNode;
  manager: AppRunManager;
}) {
  useManagerLifecycle(manager);
  return (
    <AppRunContext.Provider value={manager}>{children}</AppRunContext.Provider>
  );
}

function OwnedAppRunProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const [manager] = useState(() => new AppRunManager(store));

  useManagerLifecycle(manager);

  return (
    <AppRunContext.Provider value={manager}>{children}</AppRunContext.Provider>
  );
}

export function useAppRunManager(): AppRunManager {
  const manager = useContext(AppRunContext);
  if (!manager) {
    throw new Error("useAppRunManager requires AppRunProvider");
  }
  return manager;
}
