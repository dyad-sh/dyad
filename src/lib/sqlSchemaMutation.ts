import {
  detectSqlSchemaMutation,
  type SqlSchemaMutationAnalysis,
} from "pg-schema-classifier";

export function getSqlSchemaMutationAnalysis(
  sql: string,
): SqlSchemaMutationAnalysis {
  return detectSqlSchemaMutation(sql);
}

export function doesSqlMutateSchema(sql: string): boolean {
  return getSqlSchemaMutationAnalysis(sql).mutatesSchema;
}
