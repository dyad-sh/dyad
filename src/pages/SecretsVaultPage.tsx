/**
 * Secrets Vault Page
 * Secure local storage for API keys, passwords, and credentials
 */

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  useSecretsVaultManager,
  useSecrets,
  useSecret,
  useBackups,
} from "../hooks/useSecretsVault";
import type {
  SecretId,
  SecretType,
  SecretCategory,
} from "../ipc/secrets_vault_client";

// =============================================================================
// CONSTANTS
// =============================================================================

const SECRET_TYPES: { value: SecretType; label: string; icon: string }[] = [
  { value: "api_key", label: "API Key", icon: "🔑" },
  { value: "password", label: "Password", icon: "🔒" },
  { value: "token", label: "Token", icon: "🎟️" },
  { value: "certificate", label: "Certificate", icon: "📜" },
  { value: "ssh_key", label: "SSH Key", icon: "🔐" },
  { value: "oauth", label: "OAuth", icon: "🔓" },
  { value: "custom", label: "Custom", icon: "⚙️" },
];

const SECRET_CATEGORIES: { value: SecretCategory; label: string; color: string }[] = [
  { value: "ai", label: "AI Services", color: "bg-purple-500" },
  { value: "cloud", label: "Cloud", color: "bg-blue-500" },
  { value: "database", label: "Database", color: "bg-green-500" },
  { value: "service", label: "Service", color: "bg-yellow-500" },
  { value: "personal", label: "Personal", color: "bg-pink-500" },
  { value: "other", label: "Other", color: "bg-gray-500" },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function SecretsVaultPage() {
  const vault = useSecretsVaultManager();
  const [activeTab, setActiveTab] = useState<"secrets" | "backups" | "settings">("secrets");

  // Show unlock screen if vault is locked
  if (vault.isLoading) {
    return <LoadingScreen />;
  }

  if (!vault.hasVault) {
    return <CreateVaultScreen vault={vault} />;
  }

  if (vault.isLocked) {
    return <UnlockVaultScreen vault={vault} />;
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            🔐 Secrets Vault
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Secure local storage for your credentials
          </p>
        </div>
        <div className="flex items-center gap-2">
          {vault.stats && (
            <span className="text-sm text-muted-foreground">
              {vault.stats.totalSecrets} secrets stored
            </span>
          )}
          <button
            onClick={() => vault.lockVault()}
            disabled={vault.isLocking}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
          >
            {vault.isLocking ? "Locking..." : "Lock Vault"}
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b px-6">
        <nav className="flex gap-4">
          {[
            { id: "secrets" as const, label: "Secrets", icon: "🔑" },
            { id: "backups" as const, label: "Backups", icon: "💾" },
            { id: "settings" as const, label: "Settings", icon: "⚙️" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "secrets" && <SecretsTab vault={vault} />}
        {activeTab === "backups" && <BackupsTab vault={vault} />}
        {activeTab === "settings" && <SettingsTab vault={vault} />}
      </div>
    </div>
  );
}

// =============================================================================
// SCREENS
// =============================================================================

function LoadingScreen() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin text-4xl mb-4">🔐</div>
        <p className="text-muted-foreground">Loading vault...</p>
      </div>
    </div>
  );
}

function CreateVaultScreen({ vault }: { vault: ReturnType<typeof useSecretsVaultManager> }) {
  const [name, setName] = useState("My Vault");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleCreate = async () => {
    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    try {
      await vault.createVault({ name, masterPassword: password });
      toast.success("Vault created successfully");
    } catch (error) {
      toast.error("Failed to create vault");
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="text-6xl mb-4">🔐</div>
          <h1 className="text-3xl font-bold">Create Your Vault</h1>
          <p className="text-muted-foreground mt-2">
            Set up a secure vault to store your credentials locally with AES-256 encryption
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Vault Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background"
              placeholder="My Vault"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Master Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background"
              placeholder="••••••••"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Minimum 8 characters. This password encrypts all your secrets.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background"
              placeholder="••••••••"
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={vault.isCreatingVault || !password || !confirmPassword}
            className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {vault.isCreatingVault ? "Creating..." : "Create Vault"}
          </button>
        </div>

        <div className="text-center text-sm text-muted-foreground">
          <p>⚠️ If you forget your master password, your data cannot be recovered.</p>
        </div>
      </div>
    </div>
  );
}

function UnlockVaultScreen({ vault }: { vault: ReturnType<typeof useSecretsVaultManager> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleUnlock = async () => {
    setError("");
    try {
      const success = await vault.unlockVault(password);
      if (!success) {
        setError("Invalid password");
      }
    } catch {
      setError("Failed to unlock vault");
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-3xl font-bold">Unlock Vault</h1>
          <p className="text-muted-foreground mt-2">
            {vault.config?.name || "Your vault"} is locked. Enter your master password to access your secrets.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Master Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              className={`w-full px-4 py-2 border rounded-lg bg-background ${
                error ? "border-destructive" : ""
              }`}
              placeholder="••••••••"
              autoFocus
            />
            {error && <p className="text-sm text-destructive mt-1">{error}</p>}
          </div>

          <button
            onClick={handleUnlock}
            disabled={vault.isUnlocking || !password}
            className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {vault.isUnlocking ? "Unlocking..." : "Unlock Vault"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// TABS
// =============================================================================

function SecretsTab({ vault }: { vault: ReturnType<typeof useSecretsVaultManager> }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<SecretType | "">("");
  const [categoryFilter, setCategoryFilter] = useState<SecretCategory | "">("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [selectedSecret, setSelectedSecret] = useState<SecretId | null>(null);

  const { data: secrets = [], isLoading } = useSecrets({
    search: search || undefined,
    type: typeFilter || undefined,
    category: categoryFilter || undefined,
  });

  return (
    <div className="h-full flex">
      {/* Secret List */}
      <div className="w-1/2 border-r flex flex-col">
        {/* Filters */}
        <div className="p-4 border-b space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search secrets..."
            className="w-full px-4 py-2 border rounded-lg bg-background"
          />
          <div className="flex gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as SecretType | "")}
              className="flex-1 px-3 py-1.5 border rounded-lg bg-background text-sm"
            >
              <option value="">All Types</option>
              {SECRET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.icon} {t.label}
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as SecretCategory | "")}
              className="flex-1 px-3 py-1.5 border rounded-lg bg-background text-sm"
            >
              <option value="">All Categories</option>
              {SECRET_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground">Loading...</div>
          ) : secrets.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <div className="text-4xl mb-2">🔑</div>
              <p>No secrets yet</p>
              <button
                onClick={() => setShowNewDialog(true)}
                className="mt-2 text-primary hover:underline"
              >
                Add your first secret
              </button>
            </div>
          ) : (
            <div className="divide-y">
              {secrets.map((secret) => {
                const typeInfo = SECRET_TYPES.find((t) => t.value === secret.type);
                const categoryInfo = SECRET_CATEGORIES.find((c) => c.value === secret.category);
                return (
                  <button
                    key={secret.id}
                    onClick={() => setSelectedSecret(secret.id)}
                    className={`w-full p-4 text-left hover:bg-muted/50 transition-colors ${
                      selectedSecret === secret.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{typeInfo?.icon || "🔑"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{secret.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {secret.metadata.service || typeInfo?.label}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs text-white ${categoryInfo?.color}`}
                          >
                            {categoryInfo?.label}
                          </span>
                          {secret.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-block px-2 py-0.5 rounded-full text-xs bg-muted"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Add Button */}
        <div className="p-4 border-t">
          <button
            onClick={() => setShowNewDialog(true)}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            + Add Secret
          </button>
        </div>
      </div>

      {/* Secret Detail */}
      <div className="w-1/2">
        {selectedSecret ? (
          <SecretDetail
            secretId={selectedSecret}
            vault={vault}
            onClose={() => setSelectedSecret(null)}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="text-4xl mb-2">👈</div>
              <p>Select a secret to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* New Secret Dialog */}
      {showNewDialog && (
        <NewSecretDialog vault={vault} onClose={() => setShowNewDialog(false)} />
      )}
    </div>
  );
}

function SecretDetail({
  secretId,
  vault,
  onClose,
}: {
  secretId: SecretId;
  vault: ReturnType<typeof useSecretsVaultManager>;
  onClose: () => void;
}) {
  const { data: secret, isLoading } = useSecret(secretId);
  const [showValue, setShowValue] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    if (secret) {
      setEditValue(secret.value);
    }
  }, [secret]);

  if (isLoading || !secret) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const typeInfo = SECRET_TYPES.find((t) => t.value === secret.type);
  const categoryInfo = SECRET_CATEGORIES.find((c) => c.value === secret.category);

  const handleCopy = () => {
    navigator.clipboard.writeText(secret.value);
    toast.success("Copied to clipboard");
  };

  const handleSave = async () => {
    try {
      await vault.updateSecret({ secretId, updates: { value: editValue } });
      setIsEditing(false);
      toast.success("Secret updated");
    } catch {
      toast.error("Failed to update secret");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this secret?")) return;
    try {
      await vault.deleteSecret(secretId);
      onClose();
      toast.success("Secret deleted");
    } catch {
      toast.error("Failed to delete secret");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b">
        <div className="flex items-start gap-4">
          <span className="text-4xl">{typeInfo?.icon || "🔑"}</span>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{secret.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs text-white ${categoryInfo?.color}`}
              >
                {categoryInfo?.label}
              </span>
              <span className="text-sm text-muted-foreground">{typeInfo?.label}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-y-auto space-y-6">
        {/* Value */}
        <div>
          <label className="block text-sm font-medium mb-2">Value</label>
          <div className="relative">
            {isEditing ? (
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg bg-background font-mono text-sm min-h-[100px]"
              />
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type={showValue ? "text" : "password"}
                  value={secret.value}
                  readOnly
                  className="flex-1 px-4 py-2 border rounded-lg bg-muted font-mono text-sm"
                />
                <button
                  onClick={() => setShowValue(!showValue)}
                  className="px-3 py-2 border rounded-lg hover:bg-muted transition-colors"
                  title={showValue ? "Hide" : "Show"}
                >
                  {showValue ? "🙈" : "👁️"}
                </button>
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 border rounded-lg hover:bg-muted transition-colors"
                  title="Copy"
                >
                  📋
                </button>
              </div>
            )}
          </div>
          {isEditing && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleSave}
                disabled={vault.isUpdatingSecret}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditValue(secret.value);
                }}
                className="px-4 py-1.5 border rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Metadata */}
        {secret.metadata.service && (
          <div>
            <label className="block text-sm font-medium mb-1">Service</label>
            <p className="text-muted-foreground">{secret.metadata.service}</p>
          </div>
        )}

        {secret.metadata.username && (
          <div>
            <label className="block text-sm font-medium mb-1">Username</label>
            <p className="text-muted-foreground">{secret.metadata.username}</p>
          </div>
        )}

        {secret.metadata.url && (
          <div>
            <label className="block text-sm font-medium mb-1">URL</label>
            <a
              href={secret.metadata.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {secret.metadata.url}
            </a>
          </div>
        )}

        {secret.metadata.notes && (
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <p className="text-muted-foreground whitespace-pre-wrap">
              {secret.metadata.notes}
            </p>
          </div>
        )}

        {/* Tags */}
        {secret.tags.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">Tags</label>
            <div className="flex flex-wrap gap-2">
              {secret.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 bg-muted rounded-full text-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="text-sm text-muted-foreground space-y-1">
          <p>Created: {new Date(secret.createdAt).toLocaleString()}</p>
          <p>Updated: {new Date(secret.updatedAt).toLocaleString()}</p>
          {secret.lastAccessedAt && (
            <p>Last accessed: {new Date(secret.lastAccessedAt).toLocaleString()}</p>
          )}
          {secret.expiresAt && (
            <p className="text-warning">
              Expires: {new Date(secret.expiresAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t flex gap-2">
        <button
          onClick={() => setIsEditing(true)}
          className="flex-1 px-4 py-2 border rounded-lg hover:bg-muted transition-colors"
        >
          ✏️ Edit
        </button>
        <button
          onClick={handleDelete}
          disabled={vault.isDeletingSecret}
          className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
        >
          🗑️ Delete
        </button>
      </div>
    </div>
  );
}

function NewSecretDialog({
  vault,
  onClose,
}: {
  vault: ReturnType<typeof useSecretsVaultManager>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<SecretType>("api_key");
  const [category, setCategory] = useState<SecretCategory>("ai");
  const [value, setValue] = useState("");
  const [service, setService] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");

  const handleCreate = async () => {
    if (!name || !value) {
      toast.error("Name and value are required");
      return;
    }

    try {
      await vault.createSecret({
        name,
        type,
        category,
        value,
        metadata: {
          service: service || undefined,
          username: username || undefined,
          url: url || undefined,
          notes: notes || undefined,
        },
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast.success("Secret created");
      onClose();
    } catch {
      toast.error("Failed to create secret");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">Add New Secret</h2>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background"
              placeholder="e.g., OpenAI API Key"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as SecretType)}
                className="w-full px-4 py-2 border rounded-lg bg-background"
              >
                {SECRET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.icon} {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SecretCategory)}
                className="w-full px-4 py-2 border rounded-lg bg-background"
              >
                {SECRET_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Value *</label>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background font-mono text-sm min-h-[80px]"
              placeholder="Your secret value..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Service</label>
            <input
              type="text"
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background"
              placeholder="e.g., OpenAI, AWS, GitHub"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background"
              placeholder="Associated username or email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background text-sm min-h-[60px]"
              placeholder="Additional notes..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-background"
              placeholder="Comma-separated tags"
            />
          </div>
        </div>

        <div className="p-6 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={vault.isCreatingSecret || !name || !value}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {vault.isCreatingSecret ? "Creating..." : "Create Secret"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BackupsTab({ vault }: { vault: ReturnType<typeof useSecretsVaultManager> }) {
  const { data: backups = [], isLoading } = useBackups();

  const handleCreateBackup = async () => {
    try {
      await vault.createBackup();
      toast.success("Backup created");
    } catch {
      toast.error("Failed to create backup");
    }
  };

  const handleRestore = async (backupPath: string) => {
    if (!confirm("This will replace all current secrets with the backup. Continue?")) {
      return;
    }
    try {
      const success = await vault.restoreBackup(backupPath);
      if (success) {
        toast.success("Backup restored");
      } else {
        toast.error("Failed to restore backup");
      }
    } catch {
      toast.error("Failed to restore backup");
    }
  };

  const handleDelete = async (backupPath: string) => {
    if (!confirm("Delete this backup?")) return;
    try {
      await vault.deleteBackup(backupPath);
      toast.success("Backup deleted");
    } catch {
      toast.error("Failed to delete backup");
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Backups</h2>
          <p className="text-muted-foreground text-sm">
            Create and restore encrypted backups of your vault
          </p>
        </div>
        <button
          onClick={handleCreateBackup}
          disabled={vault.isCreatingBackup}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          {vault.isCreatingBackup ? "Creating..." : "+ Create Backup"}
        </button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading backups...</p>
      ) : backups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <div className="text-4xl mb-2">💾</div>
          <p>No backups yet</p>
          <p className="text-sm">Create your first backup to protect your secrets</p>
        </div>
      ) : (
        <div className="space-y-4">
          {backups.map((backup) => (
            <div
              key={backup.id}
              className="p-4 border rounded-lg flex items-center justify-between"
            >
              <div>
                <div className="font-medium">
                  {new Date(backup.timestamp).toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">
                  {backup.secretCount} secrets • {backup.checksum.slice(0, 8)}...
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleRestore(backup.filePath)}
                  disabled={vault.isRestoringBackup}
                  className="px-3 py-1.5 border rounded-lg hover:bg-muted transition-colors text-sm"
                >
                  Restore
                </button>
                <button
                  onClick={() => handleDelete(backup.filePath)}
                  className="px-3 py-1.5 border border-destructive text-destructive rounded-lg hover:bg-destructive/10 transition-colors text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab({ vault }: { vault: ReturnType<typeof useSecretsVaultManager> }) {
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [autoLockMinutes, setAutoLockMinutes] = useState(
    vault.config?.autoLockTimeout || 15
  );

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    try {
      const success = await vault.changePassword({ currentPassword, newPassword });
      if (success) {
        toast.success("Password changed");
        setShowChangePassword(false);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        toast.error("Current password is incorrect");
      }
    } catch {
      toast.error("Failed to change password");
    }
  };

  const handleDeleteVault = async () => {
    if (
      !confirm(
        "Are you absolutely sure? This will delete all your secrets permanently. This action cannot be undone."
      )
    ) {
      return;
    }
    if (!confirm("Type DELETE to confirm")) {
      return;
    }

    try {
      await vault.deleteVault();
      toast.success("Vault deleted");
    } catch {
      toast.error("Failed to delete vault");
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-bold mb-6">Vault Settings</h2>

      <div className="space-y-8">
        {/* Auto-lock */}
        <div className="p-4 border rounded-lg">
          <h3 className="font-medium mb-2">Auto-Lock</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Automatically lock the vault after a period of inactivity
          </p>
          <div className="flex items-center gap-4">
            <select
              value={autoLockMinutes}
              onChange={async (e) => {
                const minutes = parseInt(e.target.value);
                setAutoLockMinutes(minutes);
                try {
                  await vault.setAutoLockTimeout?.(minutes);
                  toast.success("Auto-lock setting updated");
                } catch {
                  toast.error("Failed to update setting");
                }
              }}
              className="px-4 py-2 border rounded-lg bg-background"
            >
              <option value={0}>Never</option>
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
            </select>
          </div>
        </div>

        {/* Change Password */}
        <div className="p-4 border rounded-lg">
          <h3 className="font-medium mb-2">Master Password</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Change your vault's master password
          </p>

          {showChangePassword ? (
            <div className="space-y-4">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="w-full px-4 py-2 border rounded-lg bg-background"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full px-4 py-2 border rounded-lg bg-background"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full px-4 py-2 border rounded-lg bg-background"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleChangePassword}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
                >
                  Change Password
                </button>
                <button
                  onClick={() => {
                    setShowChangePassword(false);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                  }}
                  className="px-4 py-2 border rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowChangePassword(true)}
              className="px-4 py-2 border rounded-lg hover:bg-muted transition-colors"
            >
              Change Password
            </button>
          )}
        </div>

        {/* Stats */}
        {vault.stats && (
          <div className="p-4 border rounded-lg">
            <h3 className="font-medium mb-2">Vault Statistics</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Total Secrets:</span>
                <span className="ml-2 font-medium">{vault.stats.totalSecrets}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Storage Size:</span>
                <span className="ml-2 font-medium">
                  {(vault.stats.storageSize / 1024).toFixed(2)} KB
                </span>
              </div>
              {vault.stats.lastBackup && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Last Backup:</span>
                  <span className="ml-2 font-medium">
                    {new Date(vault.stats.lastBackup).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Danger Zone */}
        <div className="p-4 border border-destructive rounded-lg">
          <h3 className="font-medium text-destructive mb-2">Danger Zone</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Permanently delete your vault and all secrets. This cannot be undone.
          </p>
          <button
            onClick={handleDeleteVault}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
          >
            Delete Vault
          </button>
        </div>
      </div>
    </div>
  );
}

export default SecretsVaultPage;
