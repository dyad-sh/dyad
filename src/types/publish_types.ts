/**
 * Unified Publish Types
 * Shared types for the cross-asset publishing wizard and creator dashboard
 */

import type { PricingModel, AssetStatus, AssetCategory } from "./marketplace_types";

// Extended asset type covering all publishable assets
export type PublishableAssetType =
  | "app"
  | "agent"
  | "workflow"
  | "dataset"
  | "model"
  | "template"
  | "component"
  | "plugin";

// Extended category taxonomy
export type UnifiedCategory = AssetCategory | "ai-workflow" | "automation" | "connector";

// License options
export type LicenseType =
  | "mit"
  | "apache-2.0"
  | "gpl-3.0"
  | "proprietary"
  | "cc-by-4.0"
  | "cc-by-sa-4.0"
  | "cc-by-nc-4.0"
  | "custom";

// Unified publish payload — common shape for all asset types
export interface UnifiedPublishPayload {
  // Source reference
  assetType: PublishableAssetType;
  sourceId: string | number;

  // Listing metadata
  name: string;
  shortDescription: string;
  description: string;
  category: UnifiedCategory;
  tags: string[];

  // Pricing
  pricingModel: PricingModel;
  price?: number; // In cents
  currency?: string;

  // License
  license: LicenseType;
  customLicenseUrl?: string;

  // Media
  thumbnail?: string; // base64 or URL
  screenshots?: string[];
  demoUrl?: string;
  videoUrl?: string;

  // Version
  version: string;
  changelog?: string;

  // Asset-type-specific metadata (opaque JSON)
  metadata?: Record<string, unknown>;
}

// Publish result
export interface PublishResult {
  assetId: string;
  assetUrl: string;
  status: AssetStatus;
}

// Creator dashboard overview
export interface CreatorOverview {
  totalApps: number;
  totalAgents: number;
  totalWorkflows: number;
  totalDatasets: number;
  totalModels: number;
  publishedCount: number;
  totalEarnings: number;
  thisMonthEarnings: number;
}

// Unified asset record for creator dashboard
export interface CreatorAssetRecord {
  id: string;
  name: string;
  assetType: PublishableAssetType;
  publishStatus: AssetStatus | "local";
  marketplaceId?: string;
  price?: number;
  pricingModel?: PricingModel;
  downloads?: number;
  rating?: number;
  earnings?: number;
  createdAt: string;
  publishedAt?: string;
  updatedAt: string;
}

// Earnings breakdown
export interface EarningsBreakdown {
  totalEarnings: number;
  thisMonth: number;
  lastMonth: number;
  pendingPayout: number;
  byAsset: {
    assetId: string;
    name: string;
    assetType: PublishableAssetType;
    earnings: number;
    sales: number;
  }[];
  byMonth: {
    month: string; // YYYY-MM
    earnings: number;
    sales: number;
  }[];
}

// Analytics summary
export interface CreatorAnalytics {
  totalDownloads: number;
  totalInstalls: number;
  averageRating: number;
  totalReviews: number;
  topAssets: {
    assetId: string;
    name: string;
    downloads: number;
    rating: number;
  }[];
}

// Marketplace browse params
export interface MarketplaceBrowseParams {
  query?: string;
  category?: UnifiedCategory;
  assetType?: PublishableAssetType;
  pricingModel?: PricingModel;
  sortBy?: "popular" | "recent" | "rating" | "price-low" | "price-high";
  page?: number;
  pageSize?: number;
}

// Marketplace browse result
export interface MarketplaceBrowseResult {
  items: MarketplaceBrowseItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Marketplace browse item (lighter than full MarketplaceAsset)
export interface MarketplaceBrowseItem {
  id: string;
  name: string;
  shortDescription: string;
  category: UnifiedCategory;
  assetType: PublishableAssetType;
  pricingModel: PricingModel;
  price?: number;
  currency: string;
  thumbnailUrl?: string;
  downloads: number;
  rating: number;
  reviewCount: number;
  publisherName: string;
  publisherId: string;
  publishedAt: string;
  tags: string[];
}

// Asset detail for marketplace explorer
export interface MarketplaceAssetDetail {
  id: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  category: UnifiedCategory;
  assetType: PublishableAssetType;
  tags: string[];
  pricingModel: PricingModel;
  price?: number;
  currency: string;
  thumbnailUrl?: string;
  screenshotUrls: string[];
  demoUrl?: string;
  videoUrl?: string;
  techStack: string[];
  features: string[];
  requirements?: string;
  license: LicenseType;
  downloads: number;
  rating: number;
  reviewCount: number;
  status: AssetStatus;
  version: string;
  publisherId: string;
  publisherName: string;
  publisherAvatar?: string;
  publisherVerified: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  changelog?: string;
}

// Install request
export interface InstallAssetRequest {
  assetId: string;
  assetType: PublishableAssetType;
}

// Install result
export interface InstallAssetResult {
  installed: boolean;
  localId?: string | number;
  message: string;
}

// Agent publish bundle metadata
export interface AgentPublishMetadata {
  agentType: string;
  modelId?: string;
  toolCount: number;
  knowledgeBaseCount: number;
  hasCustomUI: boolean;
}

// Workflow publish bundle metadata
export interface WorkflowPublishMetadata {
  nodeCount: number;
  triggerType: string;
  connectionCount: number;
  requiresCredentials: boolean;
  credentialTypes?: string[];
}
