import { describe, expect, it } from "vitest";
import {
  buildInstallCommand,
  dashboardUrl,
  generateAdminCredentials,
  generateAdminPassword,
} from "./coolify_install";

describe("generateAdminPassword", () => {
  it("meets Coolify's complexity rules", () => {
    for (let i = 0; i < 50; i++) {
      const password = generateAdminPassword();
      expect(password.length).toBeGreaterThanOrEqual(8);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#%^*_\-+=]/);
    }
  });

  it("never includes characters that would break the shell quoting", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateAdminPassword()).not.toMatch(/['\\$`"]/);
    }
  });

  it("avoids characters that a .env parser would mishandle", () => {
    // Installers commonly write these values into a .env file, where # starts
    // a comment and would silently truncate the password.
    for (let i = 0; i < 50; i++) {
      expect(generateAdminPassword()).not.toMatch(/[#!]/);
    }
  });

  it("does not simply place the required characters first", () => {
    // A predictable prefix would weaken an otherwise random password.
    const prefixes = new Set(
      Array.from({ length: 30 }, () => generateAdminPassword().slice(0, 4)),
    );
    expect(prefixes.size).toBeGreaterThan(1);
  });
});

describe("generateAdminCredentials", () => {
  it("uses the address it was given rather than inventing one", () => {
    // An invented address on a reserved domain fails validation that checks
    // the domain resolves, and is not an address the user can be reached at.
    const { email } = generateAdminCredentials("someone@example.com");
    expect(email).toBe("someone@example.com");
  });

  it("still generates a usable password", () => {
    const { password } = generateAdminCredentials("someone@example.com");
    expect(password.length).toBeGreaterThanOrEqual(8);
  });
});

describe("buildInstallCommand", () => {
  it("passes the seeded credentials to the installer", () => {
    const command = buildInstallCommand({
      username: "dyad-admin",
      email: "admin@example.invalid",
      password: "Abcdef1!xyz",
    });
    expect(command).toContain("ROOT_USERNAME='dyad-admin'");
    expect(command).toContain("ROOT_USER_EMAIL='admin@example.invalid'");
    expect(command).toContain("ROOT_USER_PASSWORD='Abcdef1!xyz'");
    expect(command).toContain("cdn.coollabs.io/coolify/install.sh");
  });

  it("refuses a value that would escape the quoting", () => {
    // Escaping this wrongly would run arbitrary text on the user's server.
    expect(() =>
      buildInstallCommand({
        username: "x'; rm -rf / #",
        email: "a@b.invalid",
        password: "Abcdef1!",
      }),
    ).toThrow(/cannot be passed safely/);
    expect(() =>
      buildInstallCommand({
        username: "ok",
        email: "a@b.invalid",
        password: "back\\slash",
      }),
    ).toThrow(/cannot be passed safely/);
  });
});

describe("dashboardUrl", () => {
  it("points at Coolify's port", () => {
    expect(dashboardUrl("203.0.113.7")).toBe("http://203.0.113.7:8000");
  });
});
