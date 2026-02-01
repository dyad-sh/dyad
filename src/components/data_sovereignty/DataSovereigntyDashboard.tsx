/**
 * DataSovereigntyDashboard.tsx
 * 
 * Complete UI for users to protect their data from harvesting,
 * contain it securely, and monetize it through NFT-gated access.
 * 
 * Features:
 * - Overview dashboard with protection stats
 * - One-click data protection workflow
 * - Anti-harvesting configuration
 * - Monetization settings
 * - Access control management
 * - Revenue tracking
 */

import React, { useState, useMemo } from "react";
import {
  useDataSovereigntyDashboard,
  useProtectionWorkflow,
  useQuickProtectAndMonetize,
  useUpdateAntiHarvesting,
  useBlockedHarvesters,
  useAccessLogs,
} from "@/hooks/use_data_sovereignty";
import type {
  ProtectedDataAsset,
  ProtectionLevel,
  DataMonetization,
  AntiHarvestingConfig,
} from "@/types/data_sovereignty_types";

// =============================================================================
// TYPES
// =============================================================================

interface DataSovereigntyDashboardProps {
  walletAddress: string;
  onOpenFile?: (path: string) => void;
}

// =============================================================================
// PROTECTION LEVEL BADGE
// =============================================================================

const protectionLevelColors: Record<ProtectionLevel, { bg: string; text: string; label: string }> = {
  unprotected: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "Unprotected" },
  encrypted: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-300", label: "Encrypted" },
  sealed: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", label: "Sealed" },
  sovereign: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300", label: "Sovereign" },
  monetized: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", label: "Monetized" },
};

function ProtectionBadge({ level }: { level: ProtectionLevel }) {
  const colors = protectionLevelColors[level];
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
      {colors.label}
    </span>
  );
}

// =============================================================================
// STAT CARD
// =============================================================================

function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon,
  trend,
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: number; positive: boolean };
}) {
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow-sm border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{title}</p>
          <p className="text-2xl font-semibold mt-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{subtitle}</p>
          )}
          {trend && (
            <div className={`flex items-center gap-1 mt-1 text-xs ${
              trend.positive ? 'text-green-600' : 'text-red-600'
            }`}>
              <span>{trend.positive ? '↑' : '↓'}</span>
              <span>{trend.value}%</span>
            </div>
          )}
        </div>
        <div className="text-2xl text-zinc-300 dark:text-zinc-600">
          {icon}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PROTECTION PROGRESS RING
// =============================================================================

function ProtectionProgressRing({ percent }: { percent: number }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;
  
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg className="transform -rotate-90" width="100" height="100">
        <circle
          className="text-zinc-200 dark:text-zinc-700"
          strokeWidth="8"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="50"
          cy="50"
        />
        <circle
          className="text-green-500"
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="50"
          cy="50"
        />
      </svg>
      <span className="absolute text-lg font-semibold">{percent}%</span>
    </div>
  );
}

// =============================================================================
// QUICK PROTECT MODAL
// =============================================================================

function QuickProtectModal({
  isOpen,
  onClose,
  onProtect,
}: {
  isOpen: boolean;
  onClose: () => void;
  onProtect: (file: string, options: {
    price: number;
    currency: "USDC" | "MATIC" | "ETH" | "JOY";
    royaltyPercent: number;
    listOnMarketplace: boolean;
  }) => void;
}) {
  const [filePath, setFilePath] = useState("");
  const [price, setPrice] = useState("10");
  const [currency, setCurrency] = useState<"USDC" | "MATIC" | "ETH" | "JOY">("USDC");
  const [royalty, setRoyalty] = useState("10");
  const [listOnMarketplace, setListOnMarketplace] = useState(true);
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-xl font-semibold mb-4">Quick Protect & Monetize</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">File Path</label>
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="/path/to/your/data"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-transparent"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Price</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                min="0"
                step="0.01"
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-transparent"
              >
                <option value="USDC">USDC</option>
                <option value="MATIC">MATIC</option>
                <option value="ETH">ETH</option>
                <option value="JOY">JOY</option>
              </select>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Royalty %</label>
            <input
              type="number"
              value={royalty}
              onChange={(e) => setRoyalty(e.target.value)}
              min="0"
              max="100"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-transparent"
            />
          </div>
          
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={listOnMarketplace}
              onChange={(e) => setListOnMarketplace(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">List on JoyMarketplace</span>
          </label>
        </div>
        
        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onProtect(filePath, {
                price: Number.parseFloat(price),
                currency,
                royaltyPercent: Number.parseFloat(royalty),
                listOnMarketplace,
              });
              onClose();
            }}
            disabled={!filePath || !price}
            className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white font-medium disabled:opacity-50"
          >
            Protect & Monetize
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ASSET LIST
// =============================================================================

function AssetList({ 
  assets, 
  title,
  onSelect,
}: { 
  assets: ProtectedDataAsset[];
  title: string;
  onSelect?: (asset: ProtectedDataAsset) => void;
}) {
  if (assets.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        No {title.toLowerCase()} found
      </div>
    );
  }
  
  // Map data types to icons
  const getIcon = (dataType: string) => {
    switch (dataType) {
      case "text": return "📄";
      case "image": return "🖼️";
      case "model": return "🤖";
      case "dataset": return "📊";
      case "code": return "💻";
      case "video": return "🎬";
      case "audio": return "🎵";
      default: return "📁";
    }
  };
  
  return (
    <div className="space-y-2">
      {assets.map((asset) => (
        <button
          key={asset.id}
          onClick={() => onSelect?.(asset)}
          className="w-full flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-left"
          type="button"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{getIcon(asset.dataType)}</span>
            <div>
              <p className="font-medium truncate max-w-[200px]">{asset.name}</p>
              <p className="text-xs text-zinc-500">
                {(asset.originalSizeBytes / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {asset.monetization?.enabled && (
              <span className="text-sm text-green-600 font-medium">
                {asset.monetization.price} {asset.monetization.currency}
              </span>
            )}
            <ProtectionBadge level={asset.protectionLevel} />
          </div>
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// ANTI-HARVESTING PANEL
// =============================================================================

function AntiHarvestingPanel({
  vaultId,
  config,
}: {
  vaultId: string;
  config?: AntiHarvestingConfig;
}) {
  const updateConfig = useUpdateAntiHarvesting();
  const { data: blocklist } = useBlockedHarvesters();
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 shadow-sm border border-zinc-200 dark:border-zinc-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
        type="button"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">🛡️</span>
          <span className="font-semibold">Anti-Harvesting Protection</span>
        </div>
        <span className={`transform transition-transform ${expanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>
      
      {expanded && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm">Protection Enabled</label>
            <input
              type="checkbox"
              checked={config?.enabled ?? true}
              onChange={(e) => updateConfig.mutate({
                vaultId,
                config: { enabled: e.target.checked },
              })}
              className="rounded"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <label className="text-sm">Watermarking</label>
            <input
              type="checkbox"
              checked={config?.watermarkEnabled ?? true}
              onChange={(e) => updateConfig.mutate({
                vaultId,
                config: { watermarkEnabled: e.target.checked },
              })}
              className="rounded"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <label className="text-sm">Fingerprinting</label>
            <input
              type="checkbox"
              checked={config?.fingerprintEnabled ?? true}
              onChange={(e) => updateConfig.mutate({
                vaultId,
                config: { fingerprintEnabled: e.target.checked },
              })}
              className="rounded"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <label className="text-sm">Anomaly Detection</label>
            <input
              type="checkbox"
              checked={config?.anomalyDetection?.enabled ?? true}
              onChange={(e) => updateConfig.mutate({
                vaultId,
                config: { 
                  anomalyDetection: { 
                    ...config?.anomalyDetection,
                    enabled: e.target.checked,
                    detectRapidAccess: true,
                    detectBulkDownloads: true,
                    detectPatternScanning: true,
                    detectAutomatedAccess: true,
                    sensitivityThreshold: 50,
                    actionOnDetection: "rate-limit",
                  } 
                },
              })}
              className="rounded"
            />
          </div>
          
          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-600">
            <p className="text-sm text-zinc-500 mb-2">
              Blocked Harvesters: {blocklist?.length ?? 0}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN DASHBOARD
// =============================================================================

export function DataSovereigntyDashboard({ walletAddress, onOpenFile }: DataSovereigntyDashboardProps) {
  const dashboard = useDataSovereigntyDashboard(walletAddress);
  const { protect, status, error } = useProtectionWorkflow();
  const quickProtect = useQuickProtectAndMonetize();
  
  const [showProtectModal, setShowProtectModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<ProtectedDataAsset | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "assets" | "security" | "revenue">("overview");
  
  // Group assets by protection level
  const assetsByLevel = useMemo(() => {
    const grouped: Record<ProtectionLevel, ProtectedDataAsset[]> = {
      unprotected: [],
      encrypted: [],
      sealed: [],
      sovereign: [],
      monetized: [],
    };
    for (const asset of dashboard.assets) {
      grouped[asset.protectionLevel].push(asset);
    }
    return grouped;
  }, [dashboard.assets]);
  
  if (dashboard.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Data Sovereignty</h1>
          <p className="text-sm text-zinc-500">Protect, contain, and monetize your data</p>
        </div>
        <button
          onClick={() => setShowProtectModal(true)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
        >
          <span>🔒</span>
          <span>Protect & Monetize</span>
        </button>
      </div>
      
      {/* Tabs */}
      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-700">
        {(["overview", "assets", "security", "revenue"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              activeTab === tab 
                ? "text-green-600 border-b-2 border-green-600" 
                : "text-zinc-500 hover:text-zinc-700"
            }`}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>
      
      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              title="Total Assets"
              value={dashboard.counts.total}
              icon="📁"
            />
            <StatCard
              title="Protected"
              value={`${dashboard.sizes.protectionPercent}%`}
              subtitle={`${dashboard.counts.total - dashboard.counts.unprotected} of ${dashboard.counts.total}`}
              icon="🔐"
            />
            <StatCard
              title="Monetized"
              value={dashboard.counts.monetized}
              subtitle="Earning revenue"
              icon="💰"
            />
            <StatCard
              title="Revenue"
              value={`$${dashboard.revenue.total.toFixed(2)}`}
              icon="📈"
            />
          </div>
          
          {/* Protection Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
              <h3 className="font-semibold mb-4">Protection Status</h3>
              <div className="flex items-center justify-center">
                <ProtectionProgressRing percent={dashboard.sizes.protectionPercent} />
              </div>
              <div className="mt-4 space-y-2">
                {Object.entries(dashboard.counts).filter(([k]) => k !== "total").map(([level, count]) => (
                  <div key={level} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{level}</span>
                    <span className="font-medium">{count as number}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
              <h3 className="font-semibold mb-4">Access Statistics</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Total Accesses</span>
                  <span className="font-semibold">{dashboard.access.total}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Granted</span>
                  <span className="font-semibold text-green-600">{dashboard.access.granted}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Denied</span>
                  <span className="font-semibold text-red-600">{dashboard.access.denied}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Harvesting Blocked</span>
                  <span className="font-semibold text-purple-600">{dashboard.access.harvestingBlocked}</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Unprotected Warning */}
          {dashboard.counts.unprotected > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <h4 className="font-semibold text-red-700 dark:text-red-300">
                    {dashboard.counts.unprotected} Unprotected Assets
                  </h4>
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                    These assets are vulnerable to harvesting. Click to protect them now.
                  </p>
                  <button
                    onClick={() => setActiveTab("assets")}
                    className="mt-2 text-sm font-medium text-red-700 dark:text-red-300 underline"
                  >
                    View Unprotected Assets →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Assets Tab */}
      {activeTab === "assets" && (
        <div className="space-y-6">
          {Object.entries(assetsByLevel).map(([level, assets]) => (
            <div key={level}>
              <div className="flex items-center gap-2 mb-3">
                <ProtectionBadge level={level as ProtectionLevel} />
                <span className="text-sm text-zinc-500">({assets.length})</span>
              </div>
              <AssetList 
                assets={assets} 
                title={level} 
                onSelect={setSelectedAsset}
              />
            </div>
          ))}
        </div>
      )}
      
      {/* Security Tab */}
      {activeTab === "security" && dashboard.vault && (
        <div className="space-y-6">
          <AntiHarvestingPanel
            vaultId={dashboard.vault.id}
            config={dashboard.vault.antiHarvesting}
          />
          
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
            <h3 className="font-semibold mb-4">Encryption Settings</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Algorithm</span>
                <span className="font-mono text-sm">
                  {dashboard.vault.defaultEncryption?.algorithm?.toUpperCase() ?? "AES-256-GCM"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Key Storage</span>
                <span className="capitalize">
                  {(dashboard.vault.defaultEncryption?.keyStorage ?? "local-vault").replace("-", " ")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Status</span>
                <span className="text-green-600">Active</span>
              </div>
            </div>
          </div>
          
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
            <h3 className="font-semibold mb-4">Access Control Defaults</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">NFT Gated</span>
                <span>{dashboard.vault.defaultAccessControl.nftGated ? "Yes" : "No"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Require Signature</span>
                <span>{dashboard.vault.defaultAccessControl.requireSignature ? "Yes" : "No"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Metering Enabled</span>
                <span>{dashboard.vault.defaultAccessControl.meteringEnabled ? "Yes" : "No"}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Revenue Tab */}
      {activeTab === "revenue" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              title="Total Revenue"
              value={`$${dashboard.revenue.total.toFixed(2)}`}
              icon="💵"
            />
            <StatCard
              title="Top Earning Asset"
              value={dashboard.revenue.topAssets[0]?.assetId.slice(0, 8) || "N/A"}
              subtitle={dashboard.revenue.topAssets[0] 
                ? `$${dashboard.revenue.topAssets[0].revenue.toFixed(2)}`
                : undefined}
              icon="🏆"
            />
            <StatCard
              title="Monetized Assets"
              value={dashboard.counts.monetized}
              icon="💰"
            />
          </div>
          
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
            <h3 className="font-semibold mb-4">Revenue by Currency</h3>
            {Object.entries(dashboard.revenue.byCurrency).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(dashboard.revenue.byCurrency).map(([currency, amount]) => (
                  <div key={currency} className="flex items-center justify-between">
                    <span className="font-medium">{currency}</span>
                    <span>{(amount as number).toFixed(4)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 text-center py-4">No revenue yet</p>
            )}
          </div>
          
          <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
            <h3 className="font-semibold mb-4">Top Earning Assets</h3>
            {dashboard.revenue.topAssets.length > 0 ? (
              <div className="space-y-2">
                {dashboard.revenue.topAssets.map((item, i) => (
                  <div key={item.assetId} className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400">#{i + 1}</span>
                      <span className="font-mono text-sm">{item.assetId.slice(0, 12)}...</span>
                    </div>
                    <span className="font-semibold text-green-600">${item.revenue.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 text-center py-4">No earnings yet</p>
            )}
          </div>
        </div>
      )}
      
      {/* Quick Protect Modal */}
      <QuickProtectModal
        isOpen={showProtectModal}
        onClose={() => setShowProtectModal(false)}
        onProtect={(file, opts) => {
          quickProtect(file, opts);
        }}
      />
      
      {/* Status Indicator */}
      {status !== "idle" && (
        <div className="fixed bottom-4 right-4 bg-white dark:bg-zinc-800 rounded-xl p-4 shadow-lg border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3">
            {status === "protecting" && (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-500" />
                <span>Protecting data...</span>
              </>
            )}
            {status === "monetizing" && (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-500" />
                <span>Enabling monetization...</span>
              </>
            )}
            {status === "complete" && (
              <>
                <span className="text-xl">✅</span>
                <span>Protection complete!</span>
              </>
            )}
            {status === "error" && (
              <>
                <span className="text-xl">❌</span>
                <span className="text-red-600">{error}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default DataSovereigntyDashboard;
