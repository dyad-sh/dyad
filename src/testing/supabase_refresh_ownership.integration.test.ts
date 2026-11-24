// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import { eq } from "drizzle-orm";

vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  delete process.env.E2E_TEST_BUILD;
});

import { h } from "@/testing/hybrid.setup";
import { setupChatFlowHarness } from "@/testing/chat_flow_harness";
import { readSettings, writeSettings } from "@/main/settings";
import { apps } from "@/db/schema";

it.each([200, 404])(
  "continues a linked chat after reconnect supersedes a refresh HTTP %s",
  async (status) => {
    let pendingRefresh: ServerResponse | undefined;
    const apiAuthorizations: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      request.resume();
      if (request.url === "/refresh") {
        pendingRefresh = response;
        return;
      }
      if (request.url === "/v1/projects/synthetic-project/api-keys") {
        apiAuthorizations.push(request.headers.authorization);
        response.writeHead(
          request.headers.authorization === "Bearer reconnected-access"
            ? 200
            : 401,
          { "Content-Type": "application/json" },
        );
        response.end(
          JSON.stringify([{ name: "anon", api_key: "synthetic-public-key" }]),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture listener");
    let harness: Awaited<ReturnType<typeof setupChatFlowHarness>> | undefined;
    try {
      harness = await setupChatFlowHarness({
        electronMock: h,
        settings: {
          supabase: {
            organizations: {
              "org-1": {
                accessToken: { value: "expired-access" },
                refreshToken: { value: "expired-refresh" },
                expiresIn: 1,
                tokenTimestamp: 1,
              },
            },
          },
        },
      });
      await harness.db
        .update(apps)
        .set({
          supabaseProjectId: "synthetic-project",
          supabaseOrganizationSlug: "org-1",
        })
        .where(eq(apps.id, harness.appId));
      const originalFetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = new URL(
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          );
          if (url.origin === "https://supabase-oauth.dyad.sh") {
            return originalFetch(
              `http://127.0.0.1:${address.port}/refresh`,
              init,
            );
          }
          if (url.origin === "https://api.supabase.com") {
            return originalFetch(
              `http://127.0.0.1:${address.port}${url.pathname}${url.search}`,
              init,
            );
          }
          return originalFetch(input, init);
        },
      );

      const turn = harness.streamChat("[increment]");
      await vi.waitFor(() => expect(pendingRefresh).toBeDefined(), {
        timeout: 5000,
      });
      const reconnected = {
        accessToken: { value: "reconnected-access" },
        refreshToken: { value: "reconnected-refresh" },
        expiresIn: 3600,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      };
      writeSettings({
        supabase: {
          ...readSettings().supabase,
          organizations: { "org-1": reconnected },
        },
      });
      pendingRefresh!.writeHead(status, { "Content-Type": "application/json" });
      pendingRefresh!.end(
        JSON.stringify({
          accessToken: "stale-access",
          refreshToken: "stale-refresh",
          expiresIn: 3600,
        }),
      );

      const result = await turn;
      expect(result.eventsFor("chat:response:error")).toEqual([]);
      expect(result.messages.at(-1)?.content).toContain("counter=");
      expect(apiAuthorizations).toEqual(["Bearer reconnected-access"]);
      expect(readSettings().supabase?.organizations?.["org-1"]).toEqual(
        reconnected,
      );
    } finally {
      pendingRefresh?.destroy();
      await harness?.dispose();
      vi.unstubAllGlobals();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  60_000,
);
