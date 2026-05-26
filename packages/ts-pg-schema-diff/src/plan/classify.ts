import type { InternalStatement, MigrationHazardType, SchemaDiffStatement } from "./types.js";

const destructiveHazardTypes = new Set<MigrationHazardType>([
  "ACQUIRES_ACCESS_EXCLUSIVE_LOCK",
  "CORRECTNESS",
  "DELETES_DATA",
  "HAS_UNTRACKABLE_DEPENDENCIES",
  "INDEX_DROPPED",
  "IS_USER_GENERATED",
  "AUTHZ_UPDATE",
]);

const destructiveSqlPattern = /^\s*(DROP|REVOKE|ALTER\s+TABLE\b.*\bDROP\b|ALTER\s+TYPE\b.*\bDROP\b)/iu;

export function toPublicStatement(statement: InternalStatement): SchemaDiffStatement {
  const hasDestructiveHazard = statement.hazards.some((hazard) => destructiveHazardTypes.has(hazard.type));
  return {
    sql: statement.sql,
    type: hasDestructiveHazard || destructiveSqlPattern.test(statement.sql) ? "destructive" : "additive",
  };
}
