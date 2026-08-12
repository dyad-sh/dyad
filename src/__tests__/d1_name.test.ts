import { describe, expect, it } from "vitest";

import {
  InvalidD1NameError,
  sanitiseD1DatabaseName,
} from "@/lib/data_sources/d1_name";

/**
 * This name becomes a command-line argument and a Cloudflare resource, so the
 * tests are about what it refuses and about the name staying recognisable:
 * a sanitiser that quietly turns "Client Work" into something else leaves the
 * user unable to find their database in the dashboard.
 */
describe("D1 database names", () => {
  it("keeps a good name as it is", () => {
    expect(sanitiseD1DatabaseName("customers")).toBe("customers");
    expect(sanitiseD1DatabaseName("my-app_2")).toBe("my-app_2");
  });

  it("makes a typed name usable without disguising it", () => {
    expect(sanitiseD1DatabaseName("Client Work")).toBe("Client-Work");
    expect(sanitiseD1DatabaseName("  spaced  out  ")).toBe("spaced-out");
    expect(sanitiseD1DatabaseName("café's data")).toBe("cafs-data");
  });

  it("strips characters that have meaning elsewhere", () => {
    // Not because a shell would see them — arguments are passed as an array —
    // but because Cloudflare rejects them and the failure would be remote.
    expect(sanitiseD1DatabaseName("db; rm -rf /")).toBe("db-rm-rf");
    expect(sanitiseD1DatabaseName("../../etc/passwd")).toBe("etcpasswd");
    expect(sanitiseD1DatabaseName("$(whoami)")).toBe("whoami");
  });

  it("refuses a name with nothing left in it", () => {
    for (const name of ["", "   ", "!!!", "---", "___"]) {
      expect(() => sanitiseD1DatabaseName(name), name).toThrow(
        InvalidD1NameError,
      );
    }
  });

  it("refuses a name that is too long", () => {
    expect(() => sanitiseD1DatabaseName("a".repeat(65))).toThrow(
      InvalidD1NameError,
    );
    expect(sanitiseD1DatabaseName("a".repeat(64))).toHaveLength(64);
  });
});
