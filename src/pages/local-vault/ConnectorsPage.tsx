// =============================================================================
// Connectors Page — manage data ingestion sources
// =============================================================================

import { useState } from "react";
import {
  useConnectors,
  useAddConnector,
  useRemoveConnector,
  useToggleConnector,
} from "../../hooks/useLocalVault";
import type { ConnectorType } from "../../types/local_vault";
import { VaultNav, VaultLockGate } from "./VaultNav";
import { formatBytes } from "../../lib/vault_utils";
import {
  Cable,
  Plus,
  Trash2,
  Power,
  PowerOff,
  FolderOpen,
  Globe,
  FileArchive,
  MessageSquare,
  Clipboard,
  BookMarked,
  History,
  Monitor,
  Wifi,
  X,
  Search,
} from "lucide-react";

const CONNECTOR_TYPES: Array<{
  type: ConnectorType;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: "safe" | "browser" | "scraper";
}> = [
  { type: "file_import", label: "File Import", description: "Import specific files from your filesystem", icon: <FolderOpen className="w-5 h-5" />, category: "safe" },
  { type: "folder_watch", label: "Folder Watch", description: "Watch a folder for new files and auto-import", icon: <FolderOpen className="w-5 h-5" />, category: "safe" },
  { type: "google_takeout", label: "Google Takeout", description: "Import data from Google Takeout ZIP exports", icon: <FileArchive className="w-5 h-5" />, category: "safe" },
  { type: "apple_export", label: "Apple Export", description: "Import Apple ecosystem data exports", icon: <FileArchive className="w-5 h-5" />, category: "safe" },
  { type: "slack_export", label: "Slack Export", description: "Import conversations from Slack export files", icon: <MessageSquare className="w-5 h-5" />, category: "safe" },
  { type: "discord_export", label: "Discord Export", description: "Import conversations from Discord export files", icon: <MessageSquare className="w-5 h-5" />, category: "safe" },
  { type: "manual_capture", label: "Manual Capture", description: "Manually add notes, prompts, and structured data", icon: <Clipboard className="w-5 h-5" />, category: "safe" },
  { type: "clipboard", label: "Clipboard", description: "Paste content directly from your clipboard", icon: <Clipboard className="w-5 h-5" />, category: "safe" },
  { type: "api_endpoint", label: "API Endpoint", description: "Ingest data from a REST API endpoint", icon: <Globe className="w-5 h-5" />, category: "safe" },
  { type: "web_scraper", label: "Web Scraper", description: "Scrape websites, feeds, and sitemaps with AI extraction and auto-tagging", icon: <Search className="w-5 h-5" />, category: "scraper" },
  { type: "browser_extension", label: "Browser Extension", description: "Save pages to vault via browser extension", icon: <Monitor className="w-5 h-5" />, category: "browser" },
  { type: "bookmarks_import", label: "Bookmarks Import", description: "Import bookmarks from your browser (opt-in)", icon: <BookMarked className="w-5 h-5" />, category: "browser" },
  { type: "history_import", label: "History Import", description: "Import browsing history (opt-in, time-range, preview)", icon: <History className="w-5 h-5" />, category: "browser" },
];

export default function ConnectorsPage() {
  const { data: connectors = [], isLoading } = useConnectors();
  const addConnector = useAddConnector();
  const removeConnector = useRemoveConnector();
  const toggleConnector = useToggleConnector();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedType, setSelectedType] = useState<ConnectorType | null>(null);
  const [newName, setNewName] = useState("");
  const [newSourcePath, setNewSourcePath] = useState("");

  const handleAdd = () => {
    if (!selectedType || !newName) return;
    addConnector.mutate({
      type: selectedType,
      name: newName,
      sourcePath: newSourcePath || undefined,
    });
    setShowAddDialog(false);
    setSelectedType(null);
    setNewName("");
    setNewSourcePath("");
  };

  return (
    <VaultLockGate>
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Vault Tab Navigation */}
      <VaultNav />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cable className="w-7 h-7 text-primary" />
            Connectors
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your data ingestion sources — your data, your choice
          </p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm flex items-center gap-2 hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          Add Connector
        </button>
      </div>

      {/* Active Connectors */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Active Connectors ({connectors.length})</h2>
        {connectors.length === 0 ? (
          <div className="text-center py-12 border rounded-lg text-muted-foreground">
            <Cable className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No connectors configured</p>
            <p className="text-sm">Add a connector to start ingesting your data</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {connectors.map((conn) => {
              const typeDef = CONNECTOR_TYPES.find((t) => t.type === conn.type);
              return (
                <div key={conn.id} className="border rounded-lg p-4 flex items-center gap-4 hover:bg-muted/30">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    {typeDef?.icon ?? <Cable className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{conn.name}</div>
                    <div className="text-sm text-muted-foreground">{typeDef?.label ?? conn.type}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                      <span>{conn.totalImported} items imported</span>
                      <span>·</span>
                      <span>{formatBytes(conn.totalBytes)}</span>
                      {conn.lastSyncAt && (
                        <>
                          <span>·</span>
                          <span>Last sync: {new Date(conn.lastSyncAt).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ConnectorStatusBadge status={conn.status} />
                    <button
                      onClick={() =>
                        toggleConnector.mutate({
                          id: conn.id,
                          enable: conn.status === "disabled",
                        })
                      }
                      className="p-2 rounded-lg hover:bg-muted"
                      title={conn.status === "disabled" ? "Enable" : "Disable"}
                    >
                      {conn.status === "disabled" ? (
                        <PowerOff className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <Power className="w-4 h-4 text-green-500" />
                      )}
                    </button>
                    <button
                      onClick={() => removeConnector.mutate(conn.id)}
                      className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Connector Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background border rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Add Connector</h2>
              <button onClick={() => setShowAddDialog(false)} className="p-1 rounded hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!selectedType ? (
              <>
                {/* Safe Connectors */}
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-2">
                    Recommended Connectors
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {CONNECTOR_TYPES.filter((t) => t.category === "safe").map((t) => (
                      <button
                        key={t.type}
                        onClick={() => {
                          setSelectedType(t.type);
                          setNewName(t.label);
                        }}
                        className="p-3 border rounded-lg text-left hover:bg-muted/50 flex items-start gap-3"
                      >
                        <div className="text-primary mt-0.5">{t.icon}</div>
                        <div>
                          <div className="font-medium text-sm">{t.label}</div>
                          <div className="text-xs text-muted-foreground">{t.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Browser Connectors */}
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-2">
                    <Monitor className="w-4 h-4" />
                    Browser Data (User-Owned, Opt-In)
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {CONNECTOR_TYPES.filter((t) => t.category === "browser").map((t) => (
                      <button
                        key={t.type}
                        onClick={() => {
                          setSelectedType(t.type);
                          setNewName(t.label);
                        }}
                        className="p-3 border rounded-lg text-left hover:bg-muted/50 flex items-start gap-3 border-amber-500/30"
                      >
                        <div className="text-amber-500 mt-0.5">{t.icon}</div>
                        <div>
                          <div className="font-medium text-sm">{t.label}</div>
                          <div className="text-xs text-muted-foreground">{t.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                    <Wifi className="w-3 h-3" />
                    Browser data stays local — transported via localhost bridge, never sent to remote servers
                  </p>
                </div>

                {/* Web Scraper */}
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-2">
                    <Search className="w-4 h-4" />
                    Web Scraping (AI-Powered)
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {CONNECTOR_TYPES.filter((t) => t.category === "scraper").map((t) => (
                      <button
                        key={t.type}
                        onClick={() => {
                          setSelectedType(t.type);
                          setNewName(t.label);
                        }}
                        className="p-3 border rounded-lg text-left hover:bg-muted/50 flex items-start gap-3 border-blue-500/30"
                      >
                        <div className="text-blue-500 mt-0.5">{t.icon}</div>
                        <div>
                          <div className="font-medium text-sm">{t.label}</div>
                          <div className="text-xs text-muted-foreground">{t.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    Scrape any website with cheerio DOM parsing, Playwright JS rendering, AI extraction, and auto-tagging
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Connector Name</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Source Path (optional)</label>
                  <input
                    value={newSourcePath}
                    onChange={(e) => setNewSourcePath(e.target.value)}
                    placeholder="e.g., C:\Users\...\Downloads"
                    className="w-full px-3 py-2 rounded-lg border bg-background mt-1"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setSelectedType(null)}
                    className="px-4 py-2 rounded-lg border text-sm hover:bg-muted"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleAdd}
                    disabled={!newName}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                  >
                    Add Connector
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </VaultLockGate>
  );
}

function ConnectorStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    enabled: "bg-green-500/10 text-green-500",
    disabled: "bg-muted text-muted-foreground",
    syncing: "bg-blue-500/10 text-blue-500",
    paused: "bg-amber-500/10 text-amber-500",
    error: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? styles.disabled}`}>
      {status}
    </span>
  );
}


