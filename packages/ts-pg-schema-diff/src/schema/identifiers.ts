import type { EscapedIdentifier, SchemaQualifiedName } from "./model.js";

export function escapeIdentifier(name: string): EscapedIdentifier {
  return `"${name.replaceAll('"', '""')}"` as EscapedIdentifier;
}

export function fqName(name: SchemaQualifiedName): string {
  return `${escapeIdentifier(name.schemaName)}.${name.escapedName}`;
}

export function schemaQualifiedName(
  schemaName: string,
  unescapedName: string,
): SchemaQualifiedName {
  return {
    schemaName,
    escapedName: escapeIdentifier(unescapedName),
  };
}

export function procName(
  schemaName: string,
  unescapedName: string,
  identityArguments: string,
): SchemaQualifiedName {
  return {
    schemaName,
    escapedName:
      `"${unescapedName.replaceAll('"', '""')}"(${identityArguments})` as EscapedIdentifier,
  };
}

export function fqColumnName(
  table: SchemaQualifiedName,
  columnName: string,
): string {
  return `${fqName(table)}.${escapeIdentifier(columnName)}`;
}
