import { describe, expect, it } from "vitest";
import {
  buildAdminCredentials,
  generateAdminPassword,
  isShellSafe,
} from "./admin_credentials";

describe("generateAdminPassword", () => {
  it("meets every rule Coolify checks", () => {
    // Its validator wants length, mixed case, a digit and a symbol. Failing any
    // of them leaves the install finished with no account on it.
    for (let i = 0; i < 200; i++) {
      const pw = generateAdminPassword();
      expect(pw.length).toBe(24);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[@%^*_\-+=]/);
    }
  });

  it("never produces a character that would break out of its quoting", () => {
    // The value crosses a shell assignment and lands in a .env file. A quote or
    // a backslash ends the quoting; # starts a comment and would truncate it.
    for (let i = 0; i < 200; i++) {
      expect(isShellSafe(generateAdminPassword())).toBe(true);
    }
  });

  it("does not always put the required characters first", () => {
    // They are appended before shuffling, so a missing shuffle would leave the
    // first four positions perfectly predictable.
    const firstFour = new Set(
      Array.from({ length: 60 }, () => generateAdminPassword().slice(0, 4)),
    );
    expect(firstFour.size).toBeGreaterThan(1);
  });
});

describe("buildAdminCredentials", () => {
  it("keeps the address it was given rather than inventing one", () => {
    const creds = buildAdminCredentials("  someone@gmail.com  ");
    expect(creds.email).toBe("someone@gmail.com");
    expect(creds.username).toBe("dyad-admin");
    expect(isShellSafe(creds.password)).toBe(true);
  });
});
