/**
 * Authentication context for the ProteaAI web app.
 *
 * Provides login, logout, register, and the current user to all components.
 * In Electron mode this is a no-op (no server auth required).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  emailVerified: boolean;
  plan: "free" | "pro";
  subscriptionStatus?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "proteaai_token";
const IS_WEB = import.meta.env.PROTEAAI_WEB_MODE === "true";

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(json.error ?? "Request failed");
  }
  return json.data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY),
  );
  const [isLoading, setIsLoading] = useState(IS_WEB);

  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const data = await apiFetch("/auth/me", {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      setUser(data as AuthUser);
    } catch {
      // Token invalid or expired
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // On mount, validate the stored token
  useEffect(() => {
    if (!IS_WEB) {
      setIsLoading(false);
      return;
    }
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const data = (await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    })) as { token: string; user: AuthUser };

    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const data = (await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      })) as { token: string; user: AuthUser };

      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
    },
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
