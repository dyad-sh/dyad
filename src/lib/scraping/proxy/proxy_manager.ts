/**
 * Proxy Manager — Rotation, health checking, and failover.
 */

import { net } from "electron";
import log from "electron-log";
import type { ProxyConfig, ProxyHealth, ProxyManagerConfig, ProxyRotation } from "../types";

const logger = log.scope("scraping:proxy");

export class ProxyManager {
  private proxies: ProxyHealth[] = [];
  private rotation: ProxyRotation;
  private currentIndex = 0;
  private domainMap = new Map<string, number>(); // domain → proxy index
  private failoverThreshold: number;

  constructor(config: ProxyManagerConfig) {
    this.rotation = config.rotation;
    this.failoverThreshold = config.failoverThreshold ?? 3;
    this.proxies = config.proxies.map((p) => ({
      proxy: p,
      isHealthy: true,
      latencyMs: 0,
      lastChecked: new Date(),
      failCount: 0,
    }));
  }

  /**
   * Get the next proxy based on rotation strategy.
   */
  getProxy(domain?: string): ProxyConfig | null {
    const healthy = this.proxies.filter((p) => p.isHealthy);
    if (healthy.length === 0) return null;

    switch (this.rotation) {
      case "round-robin": {
        const idx = this.currentIndex % healthy.length;
        this.currentIndex++;
        return healthy[idx].proxy;
      }
      case "random": {
        const idx = Math.floor(Math.random() * healthy.length);
        return healthy[idx].proxy;
      }
      case "per-domain": {
        if (domain && this.domainMap.has(domain)) {
          const idx = this.domainMap.get(domain)!;
          if (idx < healthy.length) return healthy[idx].proxy;
        }
        const idx = this.currentIndex % healthy.length;
        if (domain) this.domainMap.set(domain, idx);
        this.currentIndex++;
        return healthy[idx].proxy;
      }
      case "on-block": {
        // Use first healthy proxy; switch on failure via reportFailure
        return healthy[0].proxy;
      }
      default:
        return healthy[0]?.proxy ?? null;
    }
  }

  /**
   * Report a successful request through a proxy.
   */
  reportSuccess(proxy: ProxyConfig, latencyMs: number): void {
    const health = this.findHealth(proxy);
    if (health) {
      health.isHealthy = true;
      health.latencyMs = latencyMs;
      health.lastChecked = new Date();
      health.failCount = 0;
    }
  }

  /**
   * Report a failed request through a proxy.
   */
  reportFailure(proxy: ProxyConfig): void {
    const health = this.findHealth(proxy);
    if (health) {
      health.failCount++;
      health.lastChecked = new Date();
      if (health.failCount >= this.failoverThreshold) {
        health.isHealthy = false;
        logger.warn(
          `Proxy ${proxy.host}:${proxy.port} marked unhealthy after ${health.failCount} failures`,
        );
      }
    }
  }

  /**
   * Re-check all proxies' health status.
   */
  async healthCheck(): Promise<void> {
    for (const entry of this.proxies) {
      const start = Date.now();
      try {
        await this.testProxy(entry.proxy);
        entry.isHealthy = true;
        entry.latencyMs = Date.now() - start;
        entry.failCount = 0;
      } catch {
        entry.isHealthy = false;
        entry.latencyMs = Date.now() - start;
      }
      entry.lastChecked = new Date();
    }
  }

  /**
   * Get health status of all proxies.
   */
  getHealthReport(): ProxyHealth[] {
    return [...this.proxies];
  }

  /**
   * Get count of healthy proxies.
   */
  get healthyCount(): number {
    return this.proxies.filter((p) => p.isHealthy).length;
  }

  /**
   * Format proxy for Playwright browser launch arg.
   */
  static toPlaywrightProxy(config: ProxyConfig): {
    server: string;
    username?: string;
    password?: string;
  } {
    return {
      server: `${config.type}://${config.host}:${config.port}`,
      username: config.username,
      password: config.password,
    };
  }

  /**
   * Format proxy as URL string.
   */
  static toUrl(config: ProxyConfig): string {
    const auth =
      config.username && config.password
        ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
        : "";
    return `${config.type}://${auth}${config.host}:${config.port}`;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private findHealth(proxy: ProxyConfig): ProxyHealth | undefined {
    return this.proxies.find(
      (p) => p.proxy.host === proxy.host && p.proxy.port === proxy.port,
    );
  }

  private testProxy(proxy: ProxyConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = net.request({
        url: "https://httpbin.org/ip",
        method: "GET",
      });

      const timeout = setTimeout(() => {
        req.abort();
        reject(new Error("Proxy health check timed out"));
      }, 10_000);

      req.on("response", (res) => {
        clearTimeout(timeout);
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`Proxy returned ${res.statusCode}`));
        }
        // Drain the response
        res.on("data", () => {});
      });

      req.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.end();
    });
  }
}
