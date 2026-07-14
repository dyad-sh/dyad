function escapeSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function renderTestDatabaseSchema(tableName = "users"): string {
  return `CREATE TABLE "public".${escapeSqlIdentifier(tableName)} (\n\t"id" bigint NOT NULL\n);`;
}
