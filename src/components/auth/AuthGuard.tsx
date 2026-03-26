/**
 * AuthGuard — wraps any route that requires authentication.
 *
 * In Electron mode (no web auth): always renders children.
 * In web mode: redirects to /login if not authenticated.
 */

import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";

const IS_WEB = import.meta.env.PROTEAAI_WEB_MODE === "true";

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function AuthGuard({ children, requireAdmin = false }: AuthGuardProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!IS_WEB || isLoading) return;

    if (!isAuthenticated) {
      navigate({ to: "/login" as string, replace: true });
      return;
    }

    if (requireAdmin && user?.role !== "admin") {
      navigate({ to: "/" as string, replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, requireAdmin, user]);

  // Not in web mode — always show children
  if (!IS_WEB) return <>{children}</>;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return null;
  if (requireAdmin && user?.role !== "admin") return null;

  return <>{children}</>;
}
