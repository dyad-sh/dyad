/**
 * API Keys Manager Component
 *
 * User-friendly card-based UI for managing API keys by provider.
 * Non-technical users see familiar brand names, status badges,
 * and one-click "Get Key" links.
 */

import React, { useState, useMemo } from "react";
import {
  useProviderStatus,
  useStoreApiKey,
  useRemoveApiKey,
  useSyncFromSettings,
} from "../../hooks/useApiKeys";
import type { ProviderKeyStatus } from "../../ipc/secrets_vault_client";

// ─── Category filter tabs ────────────────────────────────────────────────────

const CATEGORY_TABS = [
  { id: "all", label: "All", icon: "🗂️" },
  { id: "ai", label: "AI Services", icon: "🤖" },
  { id: "cloud", label: "Cloud", icon: "☁️" },
  { id: "service", label: "Services", icon: "🔧" },
  { id: "database", label: "Database", icon: "🗄️" },
  { id: "personal", label: "Personal", icon: "👤" },
] as const;

type CategoryFilter = (typeof CATEGORY_TABS)[number]["id"];

// ─── Source badge helper ─────────────────────────────────────────────────────

function SourceBadge({ source }: { source: ProviderKeyStatus["source"] }) {
  const styles: Record<string, string> = {
    vault: "bg-green-500/15 text-green-600 dark:text-green-400",
    settings: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    env: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    none: "bg-muted text-muted-foreground",
  };
  const labels: Record<string, string> = {
    vault: "🔐 Vault",
    settings: "⚙️ Settings",
    env: "📄 .env",
    none: "Not set",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[source]}`}>
      {labels[source]}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export function ApiKeyManager() {
  const { data: providers = [], isLoading } = useProviderStatus();
  const storeKey = useStoreApiKey();
  const removeKey = useRemoveApiKey();
  const syncFromSettings = useSyncFromSettings();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");

  // Filter providers
  const filtered = useMemo(() => {
    let list = providers;
    if (categoryFilter !== "all") {
      list = list.filter((p) => p.category === categoryFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.providerId.toLowerCase().includes(q)
      );
    }
    return list;
  }, [providers, categoryFilter, search]);

  // Stats
  const configuredCount = providers.filter((p) => p.configured).length;
  const vaultCount = providers.filter((p) => p.source === "vault").length;

  const handleSave = async (providerId: string) => {
    if (!keyInput.trim()) return;
    await storeKey.mutateAsync({ providerId, apiKey: keyInput.trim() });
    setEditingProvider(null);
    setKeyInput("");
  };

  const handleRemove = async (providerId: string) => {
    await removeKey.mutateAsync(providerId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin text-3xl mb-2">🔑</div>
          <p className="text-muted-foreground text-sm">Loading providers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b space-y-3">
        {/* Stats row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 font-bold text-xs">
                {configuredCount}
              </span>
              <span className="text-muted-foreground">configured</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                {vaultCount}
              </span>
              <span className="text-muted-foreground">in vault</span>
            </div>
          </div>
          <button
            onClick={() => syncFromSettings.mutate()}
            disabled={syncFromSettings.isPending}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
            title="Import API keys from your settings and .env file into the encrypted vault"
          >
            {syncFromSettings.isPending ? "Importing..." : "📥 Import from Settings"}
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search providers..."
          className="w-full px-4 py-2 border rounded-lg bg-background text-sm"
        />

        {/* Category tabs */}
        <div className="flex gap-1 flex-wrap">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCategoryFilter(tab.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                categoryFilter === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Provider Cards Grid ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <div className="text-4xl mb-3">🔍</div>
            <p>No providers match your search</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((provider) => (
              <ProviderCard
                key={provider.providerId}
                provider={provider}
                isEditing={editingProvider === provider.providerId}
                keyInput={editingProvider === provider.providerId ? keyInput : ""}
                isSaving={storeKey.isPending}
                onStartEdit={() => {
                  setEditingProvider(provider.providerId);
                  setKeyInput("");
                }}
                onCancelEdit={() => {
                  setEditingProvider(null);
                  setKeyInput("");
                }}
                onKeyInputChange={setKeyInput}
                onSave={() => handleSave(provider.providerId)}
                onRemove={() => handleRemove(provider.providerId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Footer info ──────────────────────────────────────────────────── */}
      <div className="px-6 py-3 border-t bg-muted/30">
        <p className="text-xs text-muted-foreground text-center">
          🔐 Keys stored in the vault are encrypted with AES-256-GCM &mdash; only accessible with your master password.
          Keys from Settings or .env are used as fallback when vault is locked.
        </p>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PROVIDER CARD
// ═════════════════════════════════════════════════════════════════════════════

function ProviderCard({
  provider,
  isEditing,
  keyInput,
  isSaving,
  onStartEdit,
  onCancelEdit,
  onKeyInputChange,
  onSave,
  onRemove,
}: {
  provider: ProviderKeyStatus;
  isEditing: boolean;
  keyInput: string;
  isSaving: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onKeyInputChange: (v: string) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        provider.configured
          ? "border-green-500/30 bg-green-500/5"
          : "border-border hover:border-primary/30"
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="text-2xl">{provider.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold truncate">{provider.label}</h3>
            <SourceBadge source={provider.source} />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {provider.description}
          </p>
        </div>
      </div>

      {/* Key status */}
      {provider.configured && !isEditing && (
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 px-3 py-1.5 bg-muted rounded text-xs font-mono truncate">
            {provider.maskedKey}
          </code>
          {provider.vaultProtected && (
            <span className="text-green-500 text-sm" title="Protected in vault">🔐</span>
          )}
        </div>
      )}

      {/* Edit form */}
      {isEditing && (
        <div className="mt-3 space-y-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => onKeyInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSave()}
            placeholder={`Paste your ${provider.label} key here...`}
            className="w-full px-3 py-2 border rounded-lg bg-background text-sm font-mono"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={!keyInput.trim() || isSaving}
              className="flex-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSaving ? "Saving..." : "Save to Vault"}
            </button>
            <button
              onClick={onCancelEdit}
              className="px-3 py-1.5 border rounded-lg text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {!isEditing && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={onStartEdit}
            className="flex-1 px-3 py-1.5 border rounded-lg text-sm hover:bg-muted transition-colors"
          >
            {provider.configured ? "✏️ Update Key" : "➕ Add Key"}
          </button>
          <a
            href={provider.helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-muted transition-colors text-primary"
            title="Get an API key from this provider"
          >
            🔗 Get Key
          </a>
          {provider.configured && provider.source === "vault" && (
            <>
              {showConfirmRemove ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      onRemove();
                      setShowConfirmRemove(false);
                    }}
                    className="px-2 py-1.5 bg-destructive text-destructive-foreground rounded-lg text-xs"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowConfirmRemove(false)}
                    className="px-2 py-1.5 border rounded-lg text-xs"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowConfirmRemove(true)}
                  className="px-2 py-1.5 border border-destructive/30 rounded-lg text-sm hover:bg-destructive/10 transition-colors text-destructive"
                  title="Remove key from vault"
                >
                  🗑️
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ApiKeyManager;
