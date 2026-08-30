import { describe, expect, it } from "vitest";
import { adminEmailRefusal } from "./coolify_admin_email";

describe("reserved domains", () => {
  it("refuses a subdomain of a documentation domain", () => {
    // RFC 2606 reserves everything under these, so Coolify's seeder will
    // refuse the address minutes into an install.
    expect(adminEmailRefusal("admin@mail.example.com")).not.toBeNull();
    expect(adminEmailRefusal("admin@notexample.com")).toBeNull();
  });
});

describe("addresses Coolify would turn down", () => {
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
  ])("reads %s as %s (%s)", (email, usable) => {
    expect(adminEmailRefusal(email) === null).toBe(usable);
  });

  it("does not reject a domain merely for containing a reserved word", () => {
    // The check looks at the last label; a stricter rule would turn away
    // addresses that work perfectly well.
    expect(adminEmailRefusal("admin@test-lab.com")).toBeNull();
    expect(adminEmailRefusal("admin@example-corp.io")).toBeNull();
  });
});

describe("adminEmailRefusal", () => {
  it("does not call an address Dyad cannot send undeliverable", () => {
    // `!` and `#` are legal in a local part, so this address may work
    // perfectly well — the refusal is Dyad's, and saying the domain does not
    // resolve sends the user to check something that was never wrong.
    const refusal = adminEmailRefusal("will!s@gmail.com");

    expect(refusal).toMatch(/can't send/);
    expect(refusal).not.toMatch(/receive mail at/);
  });

  it("names every character it turns an address down for", () => {
    // The message lists them, so the list has to be the one the check uses.
    // Being told to remove a character you did not type leaves you with
    // nothing to change, which is the whole of what this message is for.
    const refusal = adminEmailRefusal("will!s@gmail.com") ?? "";
    for (const named of ["quote", "backslash", "`", "$", "#", "!"]) {
      expect(refusal).toContain(named);
    }

    // And every one of them really does land on that message rather than on
    // the one about mail. A newline cannot reach it — the shape check reads
    // it as whitespace first — so it is not among these.
    for (const address of [
      "will's@gmail.com",
      'will"s@gmail.com',
      "will\\s@gmail.com",
      "will`s@gmail.com",
      "will$s@gmail.com",
      "will#s@gmail.com",
      "will!s@gmail.com",
    ]) {
      expect(adminEmailRefusal(address)).toBe(refusal);
    }
  });

  it("does not blame characters for an address that is not one yet", () => {
    // The branch a half-typed address lands on, which is most of the
    // keystrokes anyone makes here — so the wrong message on it is the one a
    // user sees most. `foo..com` is the same: a shape Coolify will not
    // resolve, not a character Dyad cannot send.
    const undeliverable = adminEmailRefusal("admin@dyad.test");

    expect(adminEmailRefusal("adm")).toBe(undeliverable);
    expect(adminEmailRefusal("admin@nodomain")).toBe(undeliverable);
    expect(adminEmailRefusal("admin@foo..com")).toBe(undeliverable);
    // Reserved for documentation, which is a fact about where mail goes and
    // not about anything Dyad cannot send.
    expect(adminEmailRefusal("admin@example.com")).toBe(undeliverable);
    expect(adminEmailRefusal("admin@mail.example.net")).toBe(undeliverable);
  });

  it("still says what a domain nobody can reach is", () => {
    expect(adminEmailRefusal("admin@dyad.test")).toMatch(/receive mail at/);
  });

  it("says nothing about an address it takes", () => {
    expect(adminEmailRefusal("me@gmail.com")).toBeNull();
  });
});
