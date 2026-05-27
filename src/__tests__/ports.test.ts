import { describe, expect, it } from "vitest";

import { getAppPort, getAppProxyPort } from "../../shared/ports";

describe("ports", () => {
  it("keeps proxy ports in a separate range for negative app IDs", () => {
    expect(getAppProxyPort(-5)).toBe(42105);
    expect(getAppProxyPort(-10_005)).toBe(42105);
  });

  it("keeps app and proxy ports in separate deterministic ranges", () => {
    expect(getAppPort(123)).toBe(32223);
    expect(getAppProxyPort(123)).toBe(42223);
  });
});
