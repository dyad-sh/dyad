import { describe, expect, it } from "vitest";
import { isPlausibleAdminEmail } from "./coolify_admin_email";

describe("isPlausibleAdminEmail", () => {
  // Coolify resolves the domain, so these fail on the server however
  // well-formed they look. Catching them here means the user finds out while
  // typing rather than after a multi-minute install that seeds nothing.
  it.each([
    ["admin@dyad.test", false, "a reserved TLD that cannot resolve"],
    ["admin@my.localhost", false, "reserved for loopback"],
    ["admin@thing.invalid", false, "reserved to always fail"],
    ["admin@example.com", false, "reserved for documentation"],
    ["admin", false, "not an address at all"],
    ["admin@nodomain", false, "no dot, so no resolvable domain"],
    ["admin@ dyad.sh", false, "a space is not allowed"],
    ["someone@gmail.com", true, "an ordinary address"],
    ["dev+coolify@sub.domain.co.uk", true, "tagging and subdomains are fine"],
  ])("reads %s as %s (%s)", (email, expected) => {
    expect(isPlausibleAdminEmail(email)).toBe(expected);
  });

  it("does not reject a domain merely for containing a reserved word", () => {
    // The check looks at the last label; a stricter rule would turn away
    // addresses that work perfectly well.
    expect(isPlausibleAdminEmail("admin@test-lab.com")).toBe(true);
    expect(isPlausibleAdminEmail("admin@example-corp.io")).toBe(true);
  });
});
