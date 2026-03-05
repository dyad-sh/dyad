// =============================================================================
// VaultNav — tab bar for navigating between vault sub-pages
// VaultLockGate — wraps sub-pages; shows lock/init screen if vault isn't ready
// =============================================================================

import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  useVaultStatus,
  useVaultConfig,
  useInitializeVault,
  useUnlockVault,
} from "../../hooks/useLocalVault";
import { VAULT_TABS } from "../../lib/vault_utils";
import {
  Shield,
  Lock,
  RefreshCw,
  HardDrive,
  Cable,
  Wand2,
  Package,
  Search,
  Brain,
} from "lucide-react";

const TAB_ICONS: Record<string, React.ReactNode> = {
  Overview: <HardDrive className="w-4 h-4" />,
  Connectors: <Cable className="w-4 h-4" />,
  "Web Scraper": <Search className="w-4 h-4" />,
  Transform: <Wand2 className="w-4 h-4" />,
  "Package & Publish": <Package className="w-4 h-4" />,
  "Memory & Learning": <Brain className="w-4 h-4" />,
};

/**
 * Tab navigation bar shared across all vault pages
 */
export function VaultNav() {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <nav className="flex items-center gap-1 border-b pb-px mb-6">
      {VAULT_TABS.map((tab) => {
        const isActive = currentPath === tab.path;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg flex items-center gap-1.5 transition-colors ${
              isActive
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {TAB_ICONS[tab.label]}
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Gate component — if the vault isn't initialized or is locked, renders the
 * init / unlock UI instead of the child page content.
 */
export function VaultLockGate({ children }: { children: React.ReactNode }) {
  const { data: status, isLoading } = useVaultStatus();
  const { data: config } = useVaultConfig();
  const initVault = useInitializeVault();
  const unlockVault = useUnlockVault();
  const [passphrase, setPassphrase] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not initialized
  if (!status?.initialized) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Set Up Your Data Vault</h1>
          <p className="text-muted-foreground">
            Your local data vault encrypts and stores your data privately.
            No data leaves your device without your explicit consent.
          </p>
          <div className="space-y-3">
            <input
              type="password"
              placeholder="Create a vault passphrase (optional)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border bg-background"
            />
            <button
              type="button"
              onClick={() => initVault.mutate(passphrase || undefined)}
              disabled={initVault.isPending}
              className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {initVault.isPending ? "Initializing..." : "Initialize Vault"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Locked
  if (!status.unlocked && config?.encryptAtRest) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold">Vault Locked</h1>
          <p className="text-muted-foreground">
            Enter your passphrase to unlock the vault and access your data.
          </p>
          <div className="space-y-3">
            <input
              type="password"
              placeholder="Vault passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") unlockVault.mutate(passphrase);
              }}
              className="w-full px-4 py-2 rounded-lg border bg-background"
            />
            <button
              type="button"
              onClick={() => unlockVault.mutate(passphrase)}
              disabled={unlockVault.isPending}
              className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {unlockVault.isPending ? "Unlocking..." : "Unlock Vault"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Vault ready — render children
  return <>{children}</>;
}
