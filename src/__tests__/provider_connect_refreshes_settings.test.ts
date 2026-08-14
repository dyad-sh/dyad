import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Connecting a provider must refresh the settings the connected flag is read
 * from.
 *
 * Both hooks derive isConnected from settings, but the token is written by the
 * main process, so the renderer's cached settings are stale until they are
 * invalidated. Without that the connect succeeds, the toast says so, and the
 * screen does not change — which reads as the connection having failed.
 *
 * Structural, because exercising it needs a real token and a query client, but
 * it catches the specific omission: invalidating the provider's own keys while
 * leaving the settings key alone.
 */

const hooks = ["useGithubAccount.ts", "useVercelAccount.ts"];

describe("connecting a provider", () => {
  for (const hook of hooks) {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "hooks", hook),
      "utf8",
    );

    it(`${hook} derives its connected flag from settings`, () => {
      // If this stops being true, the rest of this file is checking the wrong
      // thing and should be revisited rather than deleted.
      expect(source).toMatch(/settings\?\.\w+AccessToken/);
    });

    it(`${hook} invalidates settings, not only its own keys`, () => {
      expect(source).toContain("queryKeys.settings.all");

      // Both the connect and the disconnect paths need it: the flag has to go
      // back down as well as up.
      const occurrences = source.split("queryKeys.settings.all").length - 1;
      expect(occurrences, "connect and disconnect both refresh").toBe(2);
    });
  }
});
