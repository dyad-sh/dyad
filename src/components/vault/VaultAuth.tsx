import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LogIn,
  LogOut,
  RefreshCw,
  User,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { showSuccess, showError } from "@/lib/toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface VaultAuthStatus {
  isAuthenticated: boolean;
  userEmail?: string;
  expiresAt?: number;
}

interface SignInParams {
  email: string;
  password: string;
  isSignUp?: boolean;
}

interface SignInResult {
  success: boolean;
  error?: string;
  userEmail?: string;
}

export function VaultAuth() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUpMode, setIsSignUpMode] = useState(false);

  // Query auth status
  const { data: authStatus, isLoading: statusLoading } =
    useQuery<VaultAuthStatus>({
      queryKey: ["vault-auth-status"],
      queryFn: async () => {
        const ipcClient = IpcClient.getInstance();
        return ipcClient.invoke<VaultAuthStatus>("vault:auth-status");
      },
      refetchInterval: 60000, // Refresh every minute to check expiry
    });

  // Sign in mutation
  const signInMutation = useMutation({
    mutationFn: async (params: SignInParams) => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<SignInResult>("vault:auth-sign-in", params);
    },
    onSuccess: (result) => {
      if (result.success) {
        showSuccess(
          isSignUpMode
            ? "Account created successfully!"
            : "Signed in to Vault",
        );
        setEmail("");
        setPassword("");
        queryClient.invalidateQueries({ queryKey: ["vault-auth-status"] });
        queryClient.invalidateQueries({ queryKey: ["vault-status"] });
        queryClient.invalidateQueries({ queryKey: ["vault-backups"] });
      } else {
        showError(result.error || "Authentication failed");
      }
    },
    onError: (error: Error) => {
      showError(error.message || "Authentication failed");
    },
  });

  // Sign out mutation
  const signOutMutation = useMutation({
    mutationFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.invoke<{ success: boolean }>("vault:auth-sign-out");
    },
    onSuccess: () => {
      showSuccess("Signed out from Vault");
      queryClient.invalidateQueries({ queryKey: ["vault-auth-status"] });
      queryClient.invalidateQueries({ queryKey: ["vault-status"] });
      queryClient.invalidateQueries({ queryKey: ["vault-backups"] });
    },
    onError: (error: Error) => {
      showError(error.message || "Sign out failed");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      showError("Email and password are required");
      return;
    }

    signInMutation.mutate({
      email: email.trim(),
      password,
      isSignUp: isSignUpMode,
    });
  };

  const handleSignOut = () => {
    signOutMutation.mutate();
  };

  if (statusLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 p-3">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Checking authentication...
      </div>
    );
  }

  // Signed in state
  if (authStatus?.isAuthenticated) {
    return (
      <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-800/50 rounded-full">
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-700 dark:text-green-300">
                Signed in to Vault
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <User className="h-3 w-3" />
                {authStatus.userEmail}
              </p>
            </div>
          </div>
          <Button
            onClick={handleSignOut}
            variant="outline"
            size="sm"
            disabled={signOutMutation.isPending}
            className="flex items-center gap-2"
          >
            {signOutMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  // Sign in form
  return (
    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
      <div className="flex items-start gap-2 mb-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Sign in to Vault to enable cloud backups
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
            Create an account or sign in with your existing Vault credentials.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="text-sm"
            disabled={signInMutation.isPending}
          />
        </div>
        <div>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="text-sm"
            disabled={signInMutation.isPending}
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button
            type="submit"
            size="sm"
            disabled={signInMutation.isPending}
            className="flex items-center gap-2"
          >
            {signInMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {isSignUpMode ? "Create Account" : "Sign In"}
          </Button>

          <button
            type="button"
            onClick={() => setIsSignUpMode(!isSignUpMode)}
            className="text-xs text-amber-700 dark:text-amber-300 hover:underline"
          >
            {isSignUpMode
              ? "Already have an account? Sign in"
              : "Need an account? Sign up"}
          </button>
        </div>
      </form>
    </div>
  );
}
