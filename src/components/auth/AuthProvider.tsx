import React, { createContext, useContext, useMemo } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import { useQuery } from "@tanstack/react-query";

interface User {
  id: string;
  email?: string;
  name?: string;
}

interface AuthContextValue {
  user: User | null;
}

const AuthContext = createContext<AuthContextValue>({ user: null });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: user } = useQuery<User | null>({
    queryKey: ["auth-user"],
    queryFn: async () => {
      try {
        const ipc = IpcClient.getInstance();
        const settings = await ipc.invoke("settings:get-all");
        // Derive a stable user id from available settings
        const id = settings?.userId ?? settings?.telemetryUserId ?? "local-user";
        return { id, name: settings?.username ?? undefined };
      } catch {
        return { id: "local-user" };
      }
    },
    staleTime: 300_000,
    initialData: { id: "local-user" },
  });

  const value = useMemo(() => ({ user: user ?? null }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
