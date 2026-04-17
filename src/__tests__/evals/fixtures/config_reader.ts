interface TlsConfig {
  cert?: string;
  key?: string;
  ca?: string;
  rejectUnauthorized?: boolean;
}

interface ServerConfig {
  host?: string;
  port?: number;
  tls?: TlsConfig;
  keepAliveTimeoutMs?: number;
  maxRequestBodyBytes?: number;
}

interface PoolConfig {
  min?: number;
  max?: number;
  idleTimeoutMs?: number;
  acquireTimeoutMs?: number;
}

interface DatabaseConfig {
  url?: string;
  pool?: PoolConfig;
  statementTimeoutMs?: number;
  ssl?: {
    enabled?: boolean;
    rejectUnauthorized?: boolean;
  };
}

interface RedisConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: { enabled?: boolean };
  maxRetriesPerRequest?: number;
}

interface LoggingConfig {
  level?: "debug" | "info" | "warn" | "error";
  format?: "json" | "text";
  destination?: {
    console?: boolean;
    file?: { path?: string; maxSizeMb?: number; maxFiles?: number };
  };
}

interface QueueConfig {
  concurrency?: number;
  maxRetries?: number;
  backoffMs?: number;
  visibilityTimeoutMs?: number;
  deadLetterQueueName?: string;
}

interface RateLimitConfig {
  windowMs?: number;
  maxRequests?: number;
  keyPrefix?: string;
  skipSuccessfulRequests?: boolean;
}

interface FeatureFlagsConfig {
  experimental?: {
    newUi?: boolean;
    betaSearch?: boolean;
    streamingExport?: boolean;
  };
  rollout?: {
    newOnboarding?: number;
    improvedEditor?: number;
  };
}

interface AppConfig {
  server?: ServerConfig;
  database?: DatabaseConfig;
  redis?: RedisConfig;
  logging?: LoggingConfig;
  queue?: QueueConfig;
  rateLimit?: RateLimitConfig;
  features?: FeatureFlagsConfig;
}

// ── Server ─────────────────────────────────────────────────────────────────

export function getServerUrl(cfg: AppConfig): string {
  const host = cfg.server.host;
  const port = cfg.server.port;
  const scheme = cfg.server.tls.cert ? "https" : "http";
  return `${scheme}://${host}:${port}`;
}

export function getDatabasePoolSize(cfg: AppConfig): {
  min: number;
  max: number;
} {
  return {
    min: cfg.database.pool.min,
    max: cfg.database.pool.max,
  };
}

export function isExperimentalUiEnabled(cfg: AppConfig): boolean {
  return cfg.features.experimental.newUi;
}

export function describeServer(cfg: AppConfig): string {
  const certLen = cfg.server.tls.cert.length;
  const keyLen = cfg.server.tls.key.length;
  return `tls cert ${certLen} bytes, key ${keyLen} bytes`;
}

export function getServerKeepAliveMs(cfg: AppConfig): number {
  return cfg.server.keepAliveTimeoutMs;
}

export function getMaxRequestBodyBytes(cfg: AppConfig): number {
  return cfg.server.maxRequestBodyBytes;
}

export function isTlsCaRequired(cfg: AppConfig): boolean {
  return cfg.server.tls.rejectUnauthorized;
}

// ── Database ───────────────────────────────────────────────────────────────

export function getDatabaseUrl(cfg: AppConfig): string {
  return cfg.database.url;
}

export function getDatabaseStatementTimeoutMs(cfg: AppConfig): number {
  return cfg.database.statementTimeoutMs;
}

export function isDatabaseSslEnabled(cfg: AppConfig): boolean {
  return cfg.database.ssl.enabled;
}

export function getDatabasePoolIdleTimeoutMs(cfg: AppConfig): number {
  return cfg.database.pool.idleTimeoutMs;
}

export function getDatabasePoolAcquireTimeoutMs(cfg: AppConfig): number {
  return cfg.database.pool.acquireTimeoutMs;
}

// ── Redis ──────────────────────────────────────────────────────────────────

export function getRedisHost(cfg: AppConfig): string {
  return cfg.redis.host;
}

export function getRedisPort(cfg: AppConfig): number {
  return cfg.redis.port;
}

export function getRedisPassword(cfg: AppConfig): string {
  return cfg.redis.password;
}

export function getRedisDb(cfg: AppConfig): number {
  return cfg.redis.db;
}

export function isRedisTlsEnabled(cfg: AppConfig): boolean {
  return cfg.redis.tls.enabled;
}

export function getRedisMaxRetries(cfg: AppConfig): number {
  return cfg.redis.maxRetriesPerRequest;
}

// ── Logging ────────────────────────────────────────────────────────────────

export function getLogLevel(cfg: AppConfig): string {
  return cfg.logging.level;
}

export function getLogFormat(cfg: AppConfig): string {
  return cfg.logging.format;
}

export function isConsoleLoggingEnabled(cfg: AppConfig): boolean {
  return cfg.logging.destination.console;
}

export function getLogFilePath(cfg: AppConfig): string {
  return cfg.logging.destination.file.path;
}

export function getLogFileMaxSizeMb(cfg: AppConfig): number {
  return cfg.logging.destination.file.maxSizeMb;
}

export function getLogFileMaxFiles(cfg: AppConfig): number {
  return cfg.logging.destination.file.maxFiles;
}

// ── Queue ──────────────────────────────────────────────────────────────────

export function getQueueConcurrency(cfg: AppConfig): number {
  return cfg.queue.concurrency;
}

export function getQueueMaxRetries(cfg: AppConfig): number {
  return cfg.queue.maxRetries;
}

export function getQueueBackoffMs(cfg: AppConfig): number {
  return cfg.queue.backoffMs;
}

export function getQueueVisibilityTimeoutMs(cfg: AppConfig): number {
  return cfg.queue.visibilityTimeoutMs;
}

export function getDeadLetterQueueName(cfg: AppConfig): string {
  return cfg.queue.deadLetterQueueName;
}

// ── Rate limit ─────────────────────────────────────────────────────────────

export function getRateLimitWindowMs(cfg: AppConfig): number {
  return cfg.rateLimit.windowMs;
}

export function getRateLimitMaxRequests(cfg: AppConfig): number {
  return cfg.rateLimit.maxRequests;
}

export function getRateLimitKeyPrefix(cfg: AppConfig): string {
  return cfg.rateLimit.keyPrefix;
}

export function isSkipSuccessfulRequestsEnabled(cfg: AppConfig): boolean {
  return cfg.rateLimit.skipSuccessfulRequests;
}

// ── Feature flags ──────────────────────────────────────────────────────────

export function isBetaSearchEnabled(cfg: AppConfig): boolean {
  return cfg.features.experimental.betaSearch;
}

export function isStreamingExportEnabled(cfg: AppConfig): boolean {
  return cfg.features.experimental.streamingExport;
}

export function getNewOnboardingRolloutPct(cfg: AppConfig): number {
  return cfg.features.rollout.newOnboarding;
}

export function getImprovedEditorRolloutPct(cfg: AppConfig): number {
  return cfg.features.rollout.improvedEditor;
}

// ── Composite helpers ──────────────────────────────────────────────────────

export function describeConfig(cfg: AppConfig): string {
  const host = cfg.server.host;
  const port = cfg.server.port;
  const dbUrl = cfg.database.url;
  const logLevel = cfg.logging.level;
  const redisHost = cfg.redis.host;
  return `server=${host}:${port} db=${dbUrl} log=${logLevel} redis=${redisHost}`;
}

export function getEffectiveLogDestinations(cfg: AppConfig): string[] {
  const destinations: string[] = [];
  if (cfg.logging.destination.console) {
    destinations.push("console");
  }
  const filePath = cfg.logging.destination.file.path;
  if (filePath) {
    destinations.push(`file:${filePath}`);
  }
  return destinations;
}

export function isProductionLike(cfg: AppConfig): boolean {
  const level = cfg.logging.level;
  return level === "warn" || level === "error";
}

export function getFullRedisConnectionString(cfg: AppConfig): string {
  const host = cfg.redis.host;
  const port = cfg.redis.port;
  const db = cfg.redis.db;
  const useTls = cfg.redis.tls.enabled;
  const scheme = useTls ? "rediss" : "redis";
  return `${scheme}://${host}:${port}/${db}`;
}

export function getDatabaseSslRejectUnauthorized(cfg: AppConfig): boolean {
  return cfg.database.ssl.rejectUnauthorized;
}

export function getTlsCaPath(cfg: AppConfig): string {
  return cfg.server.tls.ca;
}

export function getRateLimitConfig(cfg: AppConfig): {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  skipSuccessful: boolean;
} {
  return {
    windowMs: cfg.rateLimit.windowMs,
    maxRequests: cfg.rateLimit.maxRequests,
    keyPrefix: cfg.rateLimit.keyPrefix,
    skipSuccessful: cfg.rateLimit.skipSuccessfulRequests,
  };
}

export function getQueueConfig(cfg: AppConfig): {
  concurrency: number;
  maxRetries: number;
  backoffMs: number;
  visibilityTimeoutMs: number;
} {
  return {
    concurrency: cfg.queue.concurrency,
    maxRetries: cfg.queue.maxRetries,
    backoffMs: cfg.queue.backoffMs,
    visibilityTimeoutMs: cfg.queue.visibilityTimeoutMs,
  };
}
