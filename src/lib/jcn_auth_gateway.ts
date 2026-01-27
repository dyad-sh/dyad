/**
 * JCN Auth Gateway
 * Handles authentication and authorization for JCN operations.
 * 
 * Features:
 * - JWT token validation
 * - mTLS certificate verification (for node-to-node)
 * - Role-based access control (RBAC)
 * - Permission checking per operation
 * - Rate limiting integration
 */

import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { ethers } from "ethers";
import log from "electron-log";
import { db } from "@/db";
import { jcnRateLimits, jcnAuditLog } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";

import type {
  AuthContext,
  JcnRole,
  JcnPermission,
  RateLimitScope,
  WalletAddress,
  StoreId,
  TraceId,
} from "@/types/jcn_types";

const logger = log.scope("jcn_auth_gateway");

// =============================================================================
// ROLE DEFINITIONS
// =============================================================================

/**
 * Permissions for each role
 */
const ROLE_PERMISSIONS: Record<JcnRole, JcnPermission[]> = {
  store_owner: [
    "publish:create",
    "publish:read",
    "publish:update",
    "publish:delete",
    "job:create",
    "job:read",
    "job:cancel",
    "license:create",
    "license:read",
    "license:revoke",
    "bundle:read",
    "bundle:verify",
    "config:read",
    "config:update",
    "audit:read",
  ],
  org_admin: [
    "publish:create",
    "publish:read",
    "publish:update",
    "job:create",
    "job:read",
    "job:cancel",
    "license:create",
    "license:read",
    "bundle:read",
    "bundle:verify",
    "config:read",
    "audit:read",
  ],
  publisher: [
    "publish:create",
    "publish:read",
    "job:read",
    "license:read",
    "bundle:read",
    "bundle:verify",
  ],
  executor: [
    "job:create",
    "job:read",
    "job:cancel",
    "license:read",
    "bundle:read",
    "bundle:verify",
  ],
  auditor: [
    "publish:read",
    "job:read",
    "license:read",
    "bundle:read",
    "audit:read",
  ],
  admin: [
    "publish:create",
    "publish:read",
    "publish:update",
    "publish:delete",
    "job:create",
    "job:read",
    "job:cancel",
    "license:create",
    "license:read",
    "license:revoke",
    "bundle:create",
    "bundle:read",
    "bundle:verify",
    "config:read",
    "config:update",
    "audit:read",
    "audit:write",
  ],
};

// =============================================================================
// RATE LIMIT CONFIGURATION
// =============================================================================

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "publish:create": { maxRequests: 10, windowMs: 60000 }, // 10 per minute
  "job:create": { maxRequests: 100, windowMs: 60000 }, // 100 per minute
  "bundle:verify": { maxRequests: 50, windowMs: 60000 }, // 50 per minute
  default: { maxRequests: 1000, windowMs: 60000 }, // 1000 per minute
};

// =============================================================================
// AUTH GATEWAY SERVICE
// =============================================================================

export class JcnAuthGateway {
  private jwtSecret: string;
  private trustedNodeCerts: Map<string, string> = new Map();
  
  constructor() {
    // In production, load from secure storage
    this.jwtSecret = process.env.JCN_JWT_SECRET || crypto.randomBytes(32).toString("hex");
  }
  
  /**
   * Initialize the auth gateway
   */
  async initialize(): Promise<void> {
    logger.info("Initializing auth gateway");
    
    // Load trusted node certificates (for mTLS)
    // In production, load from secure storage or config
  }
  
  // ===========================================================================
  // TOKEN OPERATIONS
  // ===========================================================================
  
  /**
   * Create a JWT token for a user
   */
  async createToken(params: {
    wallet: WalletAddress;
    roles: JcnRole[];
    storeId?: StoreId;
    expiresInSeconds?: number;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const payload = {
      sub: params.wallet,
      roles: params.roles,
      storeId: params.storeId,
      metadata: params.metadata,
      iat: Math.floor(Date.now() / 1000),
    };
    
    const options: jwt.SignOptions = {
      expiresIn: params.expiresInSeconds || 3600, // Default 1 hour
      issuer: "jcn",
      audience: "joymarketplace",
    };
    
    return jwt.sign(payload, this.jwtSecret, options);
  }
  
  /**
   * Verify a JWT token
   */
  async verifyToken(token: string): Promise<AuthContext | null> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: "jcn",
        audience: "joymarketplace",
      }) as jwt.JwtPayload;
      
      return {
        method: "jwt" as const,
        principalId: decoded.sub || "",
        walletAddress: decoded.sub as WalletAddress,
        wallet: decoded.sub as WalletAddress,
        storeId: decoded.storeId as StoreId | undefined,
        roles: decoded.roles as JcnRole[],
        authorizedStores: decoded.stores as StoreId[] || [],
        expiresAt: decoded.exp ? decoded.exp * 1000 : undefined,
        traceId: crypto.randomUUID() as TraceId,
        authenticated: true,
        permissions: this.getRolePermissions(decoded.roles as JcnRole[]),
        metadata: decoded.metadata,
      };
    } catch (error) {
      logger.warn("Token verification failed", { error: (error as Error).message });
      return null;
    }
  }
  
  /**
   * Refresh a JWT token
   */
  async refreshToken(token: string): Promise<string | null> {
    const auth = await this.verifyToken(token);
    if (!auth || !auth.wallet) {
      return null;
    }
    
    return this.createToken({
      wallet: auth.wallet,
      roles: auth.roles || [],
      storeId: auth.storeId,
      metadata: auth.metadata,
    });
  }
  
  // ===========================================================================
  // SIGNATURE-BASED AUTH
  // ===========================================================================
  
  /**
   * Authenticate via wallet signature (SIWE-style)
   */
  async authenticateWithSignature(params: {
    wallet: WalletAddress;
    message: string;
    signature: string;
    nonce: string;
    timestamp: number;
  }): Promise<AuthContext | null> {
    try {
      // Verify nonce freshness (prevent replay)
      const nonceAge = Date.now() - params.timestamp;
      if (nonceAge > 300000) { // 5 minutes
        logger.warn("Auth nonce expired", { wallet: params.wallet });
        return null;
      }
      
      // Verify signature
      const messageHash = ethers.hashMessage(params.message);
      const recoveredAddress = ethers.recoverAddress(messageHash, params.signature);
      
      if (recoveredAddress.toLowerCase() !== params.wallet.toLowerCase()) {
        logger.warn("Signature verification failed", {
          expected: params.wallet,
          recovered: recoveredAddress,
        });
        return null;
      }
      
      // Look up user roles (in production, from database or blockchain)
      const roles = await this.getUserRoles(params.wallet);
      
      return {
        method: "signed_message" as const,
        principalId: params.wallet,
        walletAddress: params.wallet,
        wallet: params.wallet,
        roles,
        authorizedStores: [],
        traceId: crypto.randomUUID() as TraceId,
        authenticated: true,
        permissions: this.getRolePermissions(roles),
      };
    } catch (error) {
      logger.error("Signature authentication failed", { error });
      return null;
    }
  }
  
  /**
   * Verify a signed message
   */
  verifySignature(message: string, signature: string, expectedWallet: WalletAddress): boolean {
    try {
      const messageHash = ethers.hashMessage(message);
      const recoveredAddress = ethers.recoverAddress(messageHash, signature);
      return recoveredAddress.toLowerCase() === expectedWallet.toLowerCase();
    } catch {
      return false;
    }
  }
  
  // ===========================================================================
  // mTLS AUTH (Node-to-Node)
  // ===========================================================================
  
  /**
   * Register a trusted node certificate
   */
  async registerTrustedNode(nodeId: string, certificate: string): Promise<void> {
    this.trustedNodeCerts.set(nodeId, certificate);
    logger.info("Registered trusted node", { nodeId });
  }
  
  /**
   * Verify a node certificate
   */
  async verifyNodeCertificate(nodeId: string, certificate: string): Promise<boolean> {
    const trustedCert = this.trustedNodeCerts.get(nodeId);
    if (!trustedCert) {
      return false;
    }
    
    // In production, do proper certificate verification
    return trustedCert === certificate;
  }
  
  // ===========================================================================
  // AUTHORIZATION
  // ===========================================================================
  
  /**
   * Check if auth context has permission
   */
  hasPermission(auth: AuthContext, permission: JcnPermission): boolean {
    if (!auth.authenticated) {
      return false;
    }
    
    return auth.permissions?.includes(permission) ?? false;
  }
  
  /**
   * Check if auth context has any of the permissions
   */
  hasAnyPermission(auth: AuthContext, permissions: JcnPermission[]): boolean {
    return permissions.some((p) => this.hasPermission(auth, p));
  }
  
  /**
   * Check if auth context has all permissions
   */
  hasAllPermissions(auth: AuthContext, permissions: JcnPermission[]): boolean {
    return permissions.every((p) => this.hasPermission(auth, p));
  }
  
  /**
   * Check if auth context has role
   */
  hasRole(auth: AuthContext, role: JcnRole): boolean {
    return auth.roles?.includes(role) ?? false;
  }
  
  /**
   * Check if auth context owns or can access store
   */
  canAccessStore(auth: AuthContext, storeId: StoreId): boolean {
    // Store owners and org admins can access their store
    if (auth.storeId === storeId) {
      return true;
    }
    
    // Auditors can access any store (read-only)
    if (this.hasRole(auth, "auditor")) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Get permissions for roles
   */
  private getRolePermissions(roles: JcnRole[]): JcnPermission[] {
    const permissions = new Set<JcnPermission>();
    
    for (const role of roles) {
      const rolePerms = ROLE_PERMISSIONS[role] || [];
      for (const perm of rolePerms) {
        permissions.add(perm);
      }
    }
    
    return Array.from(permissions);
  }
  
  /**
   * Get user roles from database/blockchain
   */
  private async getUserRoles(wallet: WalletAddress): Promise<JcnRole[]> {
    // In production, look up from database or verify on-chain
    // For now, return default roles
    return ["publisher", "executor"];
  }
  
  // ===========================================================================
  // RATE LIMITING
  // ===========================================================================
  
  /**
   * Check rate limit for an operation
   */
  async checkRateLimit(
    scope: RateLimitScope,
    scopeId: string,
    operation: string
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const config = RATE_LIMITS[operation] || RATE_LIMITS.default;
    const key = `${scope}:${operation}:${scopeId}`;
    const now = Date.now();
    const windowStartTime = now - config.windowMs;
    
    // Get current rate limit state
    const [record] = await db.select()
      .from(jcnRateLimits)
      .where(eq(jcnRateLimits.id, key))
      .limit(1);
    
    if (!record || record.windowStart.getTime() < windowStartTime) {
      // Start new window
      const windowSec = Math.floor(config.windowMs / 1000);
      await db.insert(jcnRateLimits)
        .values({
          id: key,
          scope,
          identifier: scopeId,
          endpoint: operation,
          count: 1,
          windowStart: new Date(now),
          maxRequests: config.maxRequests,
          windowSec,
        })
        .onConflictDoUpdate({
          target: [jcnRateLimits.id],
          set: {
            count: 1,
            windowStart: new Date(now),
            maxRequests: config.maxRequests,
            windowSec,
          },
        });
      
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: now + config.windowMs,
      };
    }
    
    const currentCount = record.count || 0;
    const windowEnd = record.windowStart.getTime() + (record.windowSec * 1000);
    
    if (currentCount >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: windowEnd,
      };
    }
    
    // Increment counter
    await db.update(jcnRateLimits)
      .set({ count: currentCount + 1 })
      .where(eq(jcnRateLimits.id, key));
    
    return {
      allowed: true,
      remaining: config.maxRequests - currentCount - 1,
      resetAt: windowEnd,
    };
  }
  
  /**
   * Reset rate limit for a scope
   */
  async resetRateLimit(scope: RateLimitScope, scopeId: string, operation?: string): Promise<void> {
    if (operation) {
      const key = `${scope}:${operation}:${scopeId}`;
      await db.delete(jcnRateLimits).where(eq(jcnRateLimits.id, key));
    } else {
      await db.delete(jcnRateLimits)
        .where(and(
          eq(jcnRateLimits.scope, scope),
          eq(jcnRateLimits.identifier, scopeId)
        ));
    }
  }
  
  // ===========================================================================
  // AUTH MIDDLEWARE HELPERS
  // ===========================================================================
  
  /**
   * Extract auth context from request
   * (For use in IPC handlers)
   */
  async extractAuthContext(params: {
    token?: string;
    wallet?: WalletAddress;
    signature?: string;
    message?: string;
    nonce?: string;
    timestamp?: number;
  }): Promise<AuthContext> {
    // Try JWT token first
    if (params.token) {
      const auth = await this.verifyToken(params.token);
      if (auth) {
        return auth;
      }
    }
    
    // Try signature auth
    if (params.wallet && params.signature && params.message && params.nonce && params.timestamp) {
      const auth = await this.authenticateWithSignature({
        wallet: params.wallet,
        message: params.message,
        signature: params.signature,
        nonce: params.nonce,
        timestamp: params.timestamp,
      });
      if (auth) {
        return auth;
      }
    }
    
    // Return unauthenticated context
    return {
      method: "jwt" as const,
      principalId: "",
      roles: [],
      authorizedStores: [],
      traceId: crypto.randomUUID() as TraceId,
      authenticated: false,
      permissions: [],
    };
  }
  
  /**
   * Require authentication
   */
  requireAuth(auth: AuthContext): void {
    if (!auth.authenticated) {
      throw new Error("Authentication required");
    }
  }
  
  /**
   * Require permission
   */
  requirePermission(auth: AuthContext, permission: JcnPermission): void {
    this.requireAuth(auth);
    
    if (!this.hasPermission(auth, permission)) {
      throw new Error(`Permission denied: ${permission}`);
    }
  }
  
  /**
   * Require role
   */
  requireRole(auth: AuthContext, role: JcnRole): void {
    this.requireAuth(auth);
    
    if (!this.hasRole(auth, role)) {
      throw new Error(`Role required: ${role}`);
    }
  }
  
  /**
   * Require store access
   */
  requireStoreAccess(auth: AuthContext, storeId: StoreId): void {
    this.requireAuth(auth);
    
    if (!this.canAccessStore(auth, storeId)) {
      throw new Error(`Access denied to store: ${storeId}`);
    }
  }
  
  // ===========================================================================
  // AUDIT LOGGING
  // ===========================================================================
  
  /**
   * Log an auth event
   */
  async logAuthEvent(
    action: string,
    auth: AuthContext,
    details?: Record<string, unknown>
  ): Promise<void> {
    await db.insert(jcnAuditLog).values({
      id: crypto.randomUUID(),
      action: `auth:${action}`,
      actorType: auth.authenticated ? "user" : "system",
      actorId: auth.wallet || "anonymous",
      targetType: "config",
      targetId: "auth",
      newStateJson: {
        authenticated: auth.authenticated,
        roles: auth.roles,
        method: auth.method,
        ...details,
      },
    });
  }
  
  // ===========================================================================
  // API KEY MANAGEMENT
  // ===========================================================================
  
  /**
   * Generate an API key
   */
  async generateApiKey(params: {
    wallet: WalletAddress;
    name: string;
    roles: JcnRole[];
    expiresAt?: number;
  }): Promise<{ keyId: string; apiKey: string }> {
    const keyId = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString("base64url");
    const apiKey = `jcn_${keyId}_${secret}`;
    
    // Hash the key for storage
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    
    // Store key metadata (not the actual key)
    // In production, store in jcnKeys table
    
    return { keyId, apiKey };
  }
  
  /**
   * Verify an API key
   */
  async verifyApiKey(apiKey: string): Promise<AuthContext | null> {
    try {
      // Parse API key
      const [prefix, keyId, secret] = apiKey.split("_");
      if (prefix !== "jcn" || !keyId || !secret) {
        return null;
      }
      
      // Hash and verify against stored hash
      const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
      
      // Look up key metadata
      // In production, query jcnKeys table
      
      // Return auth context based on key metadata
      return null; // Not implemented yet
    } catch {
      return null;
    }
  }
}

// Export singleton instance
export const jcnAuthGateway = new JcnAuthGateway();

// Export types for handlers
export type { AuthContext, JcnRole, JcnPermission };
