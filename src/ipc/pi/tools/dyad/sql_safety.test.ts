// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isSqlSafeForAutoApproval } from "./sql_safety";

describe("SQL auto-approval safety", () => {
  it.each([
    "SELECT 1",
    "SELECT count(*) FROM users",
    "SHOW search_path",
    "INSERT INTO users (name) VALUES ('Ada')",
  ])("accepts a proven safe statement: %s", (sql) => {
    expect(isSqlSafeForAutoApproval(sql)).toBe(true);
  });

  it.each([
    "",
    "SELECT ",
    "SELECT 'unterminated",
    "garbage",
    "SELECT dangerous()",
    "DO $$ BEGIN DELETE FROM users; END $$",
    "CALL dangerous()",
    "PREPARE dangerous AS DELETE FROM users",
    "EXECUTE dangerous",
    "EXPLAIN ANALYZE SELECT dangerous()",
    "UPDATE users SET admin = true",
    "CREATE TABLE audit_log (id bigint)",
  ])("fails closed for an unsafe or unproven statement: %s", (sql) => {
    expect(isSqlSafeForAutoApproval(sql)).toBe(false);
  });
});
