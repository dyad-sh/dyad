export type MigrationHazardType =
  | "ACQUIRES_ACCESS_EXCLUSIVE_LOCK"
  | "ACQUIRES_SHARE_LOCK"
  | "ACQUIRES_SHARE_ROW_EXCLUSIVE_LOCK"
  | "CORRECTNESS"
  | "DELETES_DATA"
  | "HAS_UNTRACKABLE_DEPENDENCIES"
  | "INDEX_BUILD"
  | "INDEX_DROPPED"
  | "IMPACTS_DATABASE_PERFORMANCE"
  | "IS_USER_GENERATED"
  | "UPGRADING_EXTENSION_VERSION"
  | "AUTHZ_UPDATE";

export type MigrationHazard = {
  readonly type: MigrationHazardType;
  readonly message: string;
};

export type InternalStatement = {
  readonly sql: string;
  readonly timeoutMs: number;
  readonly lockTimeoutMs: number;
  readonly hazards: readonly MigrationHazard[];
  readonly skipValidation: boolean;
};

export type SchemaDiffStatement = {
  readonly sql: string;
  readonly type: "destructive" | "additive";
};

export type SchemaDiffResult = {
  readonly statements: readonly SchemaDiffStatement[];
};

export const statementTimeoutDefaultMs = 3_000;
export const lockTimeoutDefaultMs = statementTimeoutDefaultMs;
export const statementTimeoutTableDropMs = 1_200_000;
export const statementTimeoutConcurrentIndexBuildMs = 1_200_000;
export const statementTimeoutConcurrentIndexDropMs = 1_200_000;
