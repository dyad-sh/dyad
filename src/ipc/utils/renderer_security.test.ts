// @vitest-environment node

import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { router } from "@/router";
import {
  assertTrustedRenderer,
  configureTrustedRenderer,
  isTrustedRendererUrl,
} from "./renderer_security";

const PACKAGED_RENDERER_URL = "file:///app/renderer/main_window/index.html";

describe("renderer trust configuration", () => {
  it("reports when IPC is checked before the trust policy is configured", () => {
    const frame = { url: "file:///chat" };

    expect(() =>
      assertTrustedRenderer({
        sender: { mainFrame: frame },
        senderFrame: frame,
      } as IpcMainInvokeEvent),
    ).toThrow("Renderer trust policy is not configured");

    try {
      assertTrustedRenderer({
        sender: { mainFrame: frame },
        senderFrame: frame,
      } as IpcMainInvokeEvent);
    } catch (error) {
      expect(error).toMatchObject({ kind: DyadErrorKind.Internal });
    }
  });

  it("allows idempotent configuration but rejects policy changes outside tests", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      configureTrustedRenderer({ packagedRendererUrl: PACKAGED_RENDERER_URL });
      expect(() =>
        configureTrustedRenderer({
          packagedRendererUrl: PACKAGED_RENDERER_URL,
        }),
      ).not.toThrow();
      expect(() =>
        configureTrustedRenderer({
          devServerUrl: "http://localhost:5173",
          packagedRendererUrl: PACKAGED_RENDERER_URL,
        }),
      ).toThrow("renderer trust policy cannot be reconfigured");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

describe("packaged renderer route coverage", () => {
  it("trusts every static route registered with TanStack Router", () => {
    configureTrustedRenderer({ packagedRendererUrl: PACKAGED_RENDERER_URL });

    const staticRoutePaths = router.flatRoutes
      .map((route) => route.fullPath)
      .filter((routePath) => !routePath.includes("$"));

    expect(staticRoutePaths.length).toBeGreaterThan(0);
    for (const routePath of staticRoutePaths) {
      expect(isTrustedRendererUrl(`file://${routePath}`), routePath).toBe(true);
    }
  });

  it("trusts plugin detail routes with numeric ids only", () => {
    configureTrustedRenderer({ packagedRendererUrl: PACKAGED_RENDERER_URL });

    expect(isTrustedRendererUrl("file:///plugins/1")).toBe(true);
    expect(isTrustedRendererUrl("file:///plugins/42/")).toBe(true);
    expect(isTrustedRendererUrl("file:///plugins/abc")).toBe(false);
    expect(isTrustedRendererUrl("file:///plugins/1/extra")).toBe(false);
  });
});
