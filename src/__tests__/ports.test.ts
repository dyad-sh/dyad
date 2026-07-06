import { describe, expect, it } from "vitest";

import {
  getAppPort,
  getAppProxyPort,
  getProxyFallbackPortStart,
  PROXY_FALLBACK_PORT_START,
  PROXY_PORT_BASE,
  PROXY_PORT_RANGE,
} from "../../shared/ports";

describe("ports", () => {
  it("places the fallback band above the deterministic proxy range", () => {
    // Every app's proxy port lives in [BASE, BASE + RANGE); the fallback band
    // must start at or above the top so it never steals another app's slot.
    expect(PROXY_FALLBACK_PORT_START).toBe(PROXY_PORT_BASE + PROXY_PORT_RANGE);
    expect(getAppProxyPort(0)).toBe(PROXY_PORT_BASE);
    expect(getAppProxyPort(PROXY_PORT_RANGE - 1)).toBeLessThan(
      PROXY_FALLBACK_PORT_START,
    );
  });

  it("keeps proxy ports in a separate range for negative app IDs", () => {
    expect(getAppProxyPort(-5)).toBe(42105);
    expect(getAppProxyPort(-10_005)).toBe(42105);
  });

  it("keeps app and proxy ports in separate deterministic ranges", () => {
    expect(getAppPort(123)).toBe(32223);
    expect(getAppProxyPort(123)).toBe(42223);
  });

  it("isolates app, proxy, and fallback ports by E2E worker block", () => {
    const previous = process.env.DYAD_E2E_PORT_BLOCK_INDEX;
    try {
      process.env.DYAD_E2E_PORT_BLOCK_INDEX = "0";
      expect(getAppPort(1)).toBe(32101);
      expect(getAppProxyPort(1)).toBe(33101);
      expect(getProxyFallbackPortStart()).toBe(34100);

      process.env.DYAD_E2E_PORT_BLOCK_INDEX = "1";
      expect(getAppPort(1)).toBe(34151);
      expect(getAppProxyPort(1)).toBe(35151);
      expect(getProxyFallbackPortStart()).toBe(36150);
    } finally {
      if (previous == null) {
        delete process.env.DYAD_E2E_PORT_BLOCK_INDEX;
      } else {
        process.env.DYAD_E2E_PORT_BLOCK_INDEX = previous;
      }
    }
  });
});
