import { describe, expect, it } from "vitest";

import {
  parseCreatedDatabaseId,
  summariseWranglerError,
} from "@/lib/data_sources/wrangler_output";

/**
 * `wrangler d1 create` has no --json flag. Passing one anyway is what made
 * creation fail, and the generic message that replaced Wrangler's own is what
 * made it hard to see. Both halves are covered here.
 */
describe("reading a created database's id", () => {
  it("takes the id from the binding block", () => {
    const output = [
      "Successfully created DB 'customers-db' in region WEUR",
      "Created your new D1 database.",
      "",
      "[[d1_databases]]",
      'binding = "DB"',
      'database_name = "customers-db"',
      'database_id = "62ac2b5e-9c1f-4a1e-8f2b-2f0a1b3c4d5e"',
    ].join("\n");

    expect(parseCreatedDatabaseId(output)).toBe(
      "62ac2b5e-9c1f-4a1e-8f2b-2f0a1b3c4d5e",
    );
  });

  it("falls back to a bare id elsewhere in the output", () => {
    expect(
      parseCreatedDatabaseId(
        "Created database 62ac2b5e-9c1f-4a1e-8f2b-2f0a1b3c4d5e successfully",
      ),
    ).toBe("62ac2b5e-9c1f-4a1e-8f2b-2f0a1b3c4d5e");
  });

  it("is null when there is no id to read", () => {
    expect(parseCreatedDatabaseId("Something went wrong")).toBeNull();
    expect(parseCreatedDatabaseId("")).toBeNull();
  });
});

describe("summarising a Wrangler failure", () => {
  it("finds the actual complaint among the noise", () => {
    const output = [
      " wrangler 4.20.0",
      "-------------------",
      "",
      "[ERROR] A database with that name already exists",
      "",
      "  at createDatabase (/path/to/wrangler.js:1:1)",
    ].join("\n");

    expect(summariseWranglerError(output)).toBe(
      "A database with that name already exists",
    );
  });

  it("catches an unknown argument, which is what actually broke creation", () => {
    expect(
      summariseWranglerError("Unknown argument: json\nRun with --help"),
    ).toBe("Unknown argument: json");
  });

  it("is null when nothing looks like an error", () => {
    expect(summariseWranglerError("Successfully created DB")).toBeNull();
  });
});
