import { describe, expect, it } from "vitest";
import { renderTestDatabaseSchema } from "./test_database_schema";

describe("renderTestDatabaseSchema", () => {
  it("quotes embedded double quotes in table names", () => {
    expect(renderTestDatabaseSchema('user"data')).toBe(
      'CREATE TABLE "public"."user""data" (\n\t"id" bigint NOT NULL\n);',
    );
  });

  it("uses the users table by default", () => {
    expect(renderTestDatabaseSchema()).toContain('"public"."users"');
  });
});
