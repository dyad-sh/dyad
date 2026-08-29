import { describe, expect, it } from "vitest";
import { isPlausibleInstanceDomain } from "./coolify_domain";

/**
 * Pinned directly, not only through the panel and the script builder.
 *
 * What this decides ends up inside a command that runs as root on the user's
 * server, so the characters it lets through are the point — and a rule with
 * no test of its own is a rule that can be widened without anyone noticing.
 */
describe("what Coolify will be given as a domain", () => {
  it("takes a name however the user pasted it", () => {
    for (const written of [
      "coolify.example.com",
      "https://coolify.example.com",
      "http://coolify.example.com",
      "https://coolify.example.com/",
      "  coolify.example.com  ",
    ]) {
      expect(isPlausibleInstanceDomain(written)).toBe(true);
    }
  });

  it("refuses anything that could end the quoting around it", () => {
    // Each of these would leave the script saying something other than what
    // it was built to say. Refused rather than escaped: escaping is a thing
    // to get subtly wrong once, on someone else's machine, as root.
    for (const hostile of [
      "coolify.example.com'",
      'coolify.example.com"',
      "coolify.example.com`id`",
      "coolify.example.com$(id)",
      "coolify.example.com;id",
      "coolify.example.com id",
      "coolify.example.com\nid",
      "coolify.example.com\\",
      "coolify.example.com&&id",
      "coolify.example.com|id",
      "coolify.example.com#",
      "$HOME.example.com",
    ]) {
      expect(
        isPlausibleInstanceDomain(hostile),
        `${JSON.stringify(hostile)} should be refused`,
      ).toBe(false);
    }
  });

  it("refuses a value with nothing left once the scheme is off", () => {
    for (const empty of ["", "   ", "https://", "https:///"]) {
      expect(isPlausibleInstanceDomain(empty)).toBe(false);
    }
  });
});
