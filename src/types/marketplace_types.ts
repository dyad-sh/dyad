/**
 * JoyMarketplace Types
 * Types for app publishing and marketplace integration
 */

// Pricing models for marketplace assets
export type PricingModel = "free" | "one-time" | "subscription" | "pay-what-you-want";

// Asset categories
export type AssetCategory =
  | "web-app"
  | "mobile-app"
  | "dashboard"
  | "e-commerce"
  | "portfolio"
  | "landing-page"
  | "saas"
  | "tool"
  | "game"
  | "ai-agent"
  | "template"
  | "other";

// Asset status in marketplace
export type AssetStatus = "draft" | "pending-review" | "published" | "rejected" | "archived";

// Marketplace user/publisher info
export interface PublisherProfile {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  website?: string;
  verified: boolean;
  totalSales: number;
  totalEarnings: number;
  joinedAt: string;
}

// Asset listing for marketplace
export interface MarketplaceAsset {
  id: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  category: AssetCategory;
  tags: string[];
  
  // Pricing
  pricingModel: PricingModel;
  price?: number; // In cents
  currency: string;
  
  // Media
  thumbnailUrl?: string;
  screenshotUrls: string[];
  demoUrl?: string;
  videoUrl?: string;
  
  // Technical
  techStack: string[];
  features: string[];
  requirements?: string;
  
  // Stats
  downloads: number;
  rating: number;
  reviewCount: number;
  
  // Status
  status: AssetStatus;
  version: string;
  
  // Publisher
  publisherId: string;
  publisherName: string;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

// Request to publish an app
export interface PublishAppRequest {
  appId: number;
  
  // Listing info
  name: string;
  shortDescription: string;
  description: string;
  category: AssetCategory;
  tags: string[];
  
  // Pricing
  pricingModel: PricingModel;
  price?: number;
  
  // Media (base64 or URLs)
  thumbnail?: string;
  screenshots?: string[];
  demoUrl?: string;
  
  // Technical
  techStack?: string[];
  features?: string[];
  
  // Version
  version: string;
  changelog?: string;
}

// Response from publish
export interface PublishAppResponse {
  success: boolean;
  assetId?: string;
  assetUrl?: string;
  status: AssetStatus;
  message: string;
}

// Marketplace API credentials
export interface MarketplaceCredentials {
  apiKey: string;
  publisherId: string;
}

// Deployment target options
export interface DeploymentTarget {
  id: string;
  name: string;
  icon: string;
  description: string;
  enabled: boolean;
}

// Deployment status
export interface DeploymentStatus {
  target: string;
  status: "idle" | "building" | "deploying" | "success" | "failed";
  message?: string;
  url?: string;
  startedAt?: string;
  completedAt?: string;
}

// App bundle for upload
export interface AppBundle {
  appId: number;
  appName: string;
  files: BundleFile[];
  totalSize: number;
  createdAt: string;
}

export interface BundleFile {
  path: string;
  content: string; // base64 encoded
  size: number;
}

// Earnings/analytics
export interface EarningsReport {
  totalEarnings: number;
  thisMonth: number;
  lastMonth: number;
  pendingPayout: number;
  salesCount: number;
  topAssets: {
    assetId: string;
    name: string;
    earnings: number;
    sales: number;
  }[];
}

// Review from buyers
export interface AssetReview {
  id: string;
  assetId: string;
  userId: string;
  userName: string;
  rating: number;
  title: string;
  content: string;
  helpful: number;
  createdAt: string;
}
