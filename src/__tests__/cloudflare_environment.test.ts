import { describe, expect, it } from "vitest";

import {
  parseWhoami,
  parseWranglerVersion,
} from "@/ipc/utils/cloudflare/environment";

/**
 * Both of these read command output whose shape Cloudflare changes between
 * versions, so they are parsers rather than contracts and will rot silently.
 *
 * The case that matters most is telling "not signed in" from "signed in, output
 * I could not parse". Getting that backwards would either block a user who is
 * authenticated or report a connection that does not exist.
 */
describe("wrangler version parsing", () => {
  it("reads the version out of the shapes wrangler prints", () => {
    expect(parseWranglerVersion("⛅️ wrangler 3.90.0")).toBe("3.90.0");
    expect(parseWranglerVersion("wrangler 4.0.1")).toBe("4.0.1");
    expect(parseWranglerVersion("4.20.5-beta.2")).toBe("4.20.5-beta.2");
    expect(
      parseWranglerVersion(" ⛅️ wrangler 3.114.0\n-------------------\n"),
    ).toBe("3.114.0");
  });

  it("is null when there is no version to read", () => {
    expect(parseWranglerVersion("command not found: wrangler")).toBeNull();
    expect(parseWranglerVersion("")).toBeNull();
  });
});

describe("wrangler whoami parsing", () => {
  it("reads an authenticated account", () => {
    const output = [
      "Getting User settings...",
      "👋 You are logged in with an OAuth Token, associated with the email",
      "person@example.com!",
      "┌──────────────┬──────────────────────────────────┐",
      "│ Account Name │ Account ID                       │",
      "│ Example Inc  │ 0123456789abcdef0123456789abcdef │",
      "└──────────────┴──────────────────────────────────┘",
    ].join("\n");

    expect(parseWhoami(output)).toEqual({
      email: "person@example.com",
      accountId: "0123456789abcdef0123456789abcdef",
    });
  });

  it("is null when not signed in", () => {
    // The distinction the UI depends on: absent, not merely unparsed.
    expect(parseWhoami("You are not authenticated.")).toBeNull();
    expect(
      parseWhoami("Getting User settings...\nYou are not logged in."),
    ).toBeNull();
  });

  it("is null when nothing identifying is present", () => {
    expect(parseWhoami("Getting User settings...")).toBeNull();
  });
});
