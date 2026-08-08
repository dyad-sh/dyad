import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  contentTypeFor,
  injectRuntimeConfig,
  isAuthorisedRequest,
  resolveAssetPath,
  stripNonce,
} from "@/ipc/utils/openworker_gui";

const ROOT = path.resolve("/srv/openworker");

describe("resolveAssetPath", () => {
  it("serves the entry document for the root request", () => {
    expect(resolveAssetPath(ROOT, "/")).toBe(path.join(ROOT, "index.html"));
  });

  it("resolves an asset below the build directory", () => {
    expect(resolveAssetPath(ROOT, "/assets/app.js")).toBe(
      path.join(ROOT, "assets", "app.js"),
    );
  });

  it("ignores the query string and fragment", () => {
    expect(resolveAssetPath(ROOT, "/assets/app.js?v=2#x")).toBe(
      path.join(ROOT, "assets", "app.js"),
    );
  });

  it("refuses to climb out of the build directory", () => {
    expect(resolveAssetPath(ROOT, "/../../etc/passwd")).toBeNull();
  });

  it("refuses an encoded traversal", () => {
    expect(resolveAssetPath(ROOT, "/%2e%2e%2f%2e%2e%2fetc/passwd")).toBeNull();
  });

  it("refuses a sibling directory that merely shares the prefix", () => {
    // "/srv/openworker-evil" must not pass a naive startsWith check.
    expect(resolveAssetPath(ROOT, "/../openworker-evil/secret")).toBeNull();
  });

  it("refuses a NUL byte", () => {
    expect(resolveAssetPath(ROOT, "/index.html%00.png")).toBeNull();
  });

  it("refuses malformed percent-encoding", () => {
    expect(resolveAssetPath(ROOT, "/%E0%A4%A")).toBeNull();
  });
});

describe("injectRuntimeConfig", () => {
  const config = {
    httpBase: "http://127.0.0.1:8765",
    wsBase: "ws://127.0.0.1:8765",
    token: "launch-token",
  };

  it("defines the globals OpenWorker reads", () => {
    const html = injectRuntimeConfig("<html><head></head></html>", config);
    expect(html).toContain('window.__COWORKER_HTTP__="http://127.0.0.1:8765"');
    expect(html).toContain('window.__COWORKER_WS__="ws://127.0.0.1:8765"');
    expect(html).toContain('window.__COWORKER_API_TOKEN__="launch-token"');
  });

  it("runs before the application's own scripts", () => {
    const html = injectRuntimeConfig(
      '<html><head><script src="/assets/app.js"></script></head></html>',
      config,
    );
    expect(html.indexOf("__COWORKER_HTTP__")).toBeLessThan(
      html.indexOf("/assets/app.js"),
    );
  });

  it("keeps the rest of the document intact", () => {
    const html = injectRuntimeConfig(
      "<html><head><title>OpenWorker</title></head><body>hi</body></html>",
      config,
    );
    expect(html).toContain("<title>OpenWorker</title>");
    expect(html).toContain("<body>hi</body>");
  });

  it("handles a head tag carrying attributes", () => {
    const html = injectRuntimeConfig(
      '<html><head lang="en"></head></html>',
      config,
    );
    expect(html).toContain("__COWORKER_HTTP__");
    expect(html).toContain('<head lang="en">');
  });

  it("escapes a token that would otherwise break out of the script", () => {
    const html = injectRuntimeConfig("<html><head></head></html>", {
      ...config,
      token: "</script><script>alert(1)</script>",
    });
    // JSON.stringify escapes the slash sequence, so no second script starts.
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("isAuthorisedRequest", () => {
  it("accepts the nonce root and paths under it", () => {
    expect(isAuthorisedRequest("/abc123", "abc123")).toBe(true);
    expect(isAuthorisedRequest("/abc123/assets/app.js", "abc123")).toBe(true);
  });

  it("rejects a request without the nonce", () => {
    // Any local process can reach the port; the nonce is what stops it.
    expect(isAuthorisedRequest("/", "abc123")).toBe(false);
    expect(isAuthorisedRequest("/index.html", "abc123")).toBe(false);
  });

  it("rejects a nonce that is only a prefix", () => {
    expect(isAuthorisedRequest("/abc123456", "abc123")).toBe(false);
  });
});

describe("stripNonce", () => {
  it("leaves the path within the build directory", () => {
    expect(stripNonce("/abc123/assets/app.js", "abc123")).toBe(
      "/assets/app.js",
    );
  });

  it("maps the nonce root to the entry document", () => {
    expect(stripNonce("/abc123", "abc123")).toBe("/");
  });
});

describe("contentTypeFor", () => {
  it("labels the types a Vite build emits", () => {
    expect(contentTypeFor("/index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("/app.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("/font.woff2")).toBe("font/woff2");
  });

  it("falls back rather than guessing", () => {
    expect(contentTypeFor("/thing.unknown")).toBe("application/octet-stream");
  });
});
