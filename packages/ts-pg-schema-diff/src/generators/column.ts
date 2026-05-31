import { escapeIdentifier, fqName } from "../schema/identifiers.js";
import type {
  Column,
  ColumnIdentity,
  SchemaQualifiedName,
} from "../schema/model.js";
import { temporaryNotNullConstraintName } from "../schema/randomIdentifier.js";
import {
  lockTimeoutDefaultMs,
  statementTimeoutDefaultMs,
  type InternalStatement,
} from "../plan/types.js";
import type { ColumnDiff } from "../diff/schemaDiff.js";

export function buildColumnDefinition(column: Column): string {
  let definition = `${escapeIdentifier(column.name)} ${column.type}`;
  if (column.collation !== null) {
    definition += ` COLLATE ${fqName(column.collation)}`;
  }
  if (column.isGenerated) {
    definition += ` GENERATED ALWAYS AS (${column.generationExpression}) STORED`;
  } else if (column.default.length > 0) {
    definition += ` DEFAULT ${column.default}`;
  }
  if (!column.isNullable) {
    definition += " NOT NULL";
  }
  if (column.identity !== null) {
    definition += ` ${buildColumnIdentityDefinition(column.identity)}`;
  }
  return definition;
}

export function addColumnStatement(
  tableName: SchemaQualifiedName,
  column: Column,
): InternalStatement {
  return {
    sql: `${alterTablePrefix(tableName)} ADD COLUMN ${buildColumnDefinition(column)}`,
    timeoutMs: statementTimeoutDefaultMs,
    lockTimeoutMs: lockTimeoutDefaultMs,
    hazards: column.isGenerated
      ? [
          {
            type: "ACQUIRES_ACCESS_EXCLUSIVE_LOCK",
            message:
              "Adding a generated column requires computing the expression for existing rows.",
          },
        ]
      : [],
    skipValidation: false,
  };
}

export function deleteColumnStatement(
  tableName: SchemaQualifiedName,
  column: Column,
): InternalStatement {
  return {
    sql: `${alterTablePrefix(tableName)} DROP COLUMN ${escapeIdentifier(column.name)}`,
    timeoutMs: statementTimeoutDefaultMs,
    lockTimeoutMs: lockTimeoutDefaultMs,
    hazards: [
      { type: "DELETES_DATA", message: "Deletes all values in the column" },
    ],
    skipValidation: false,
  };
}

export function alterColumnStatements(
  tableName: SchemaQualifiedName,
  diff: ColumnDiff,
): readonly InternalStatement[] {
  const statements: InternalStatement[] = [];
  const prefix = `${alterTablePrefix(tableName)} ALTER COLUMN ${escapeIdentifier(diff.next.name)}`;
  const typeOrCollationChanged = columnTypeOrCollationChanged(
    diff.old,
    diff.next,
  );
  const defaultChanged = diff.old.default !== diff.next.default;

  if (diff.old.isNullable !== diff.next.isNullable && !diff.next.isNullable) {
    statements.push(...onlineNotNullStatements(tableName, diff.next));
  }

  if (
    diff.old.default.length > 0 &&
    (diff.next.default.length === 0 ||
      (typeOrCollationChanged && defaultChanged))
  ) {
    statements.push({
      sql: `${prefix} DROP DEFAULT`,
      timeoutMs: statementTimeoutDefaultMs,
      lockTimeoutMs: lockTimeoutDefaultMs,
      hazards: [],
      skipValidation: false,
    });
  }

  statements.push(...identityStatements(tableName, diff.old, diff.next));

  if (diff.old.isNullable !== diff.next.isNullable && diff.next.isNullable) {
    statements.push({
      sql: `${prefix} DROP NOT NULL`,
      timeoutMs: statementTimeoutDefaultMs,
      lockTimeoutMs: lockTimeoutDefaultMs,
      hazards: [],
      skipValidation: false,
    });
  }

  if (typeOrCollationChanged) {
    statements.push(
      typeTransformationStatement(tableName, diff.old, diff.next),
      analyzeColumnStatement(tableName, diff.next),
    );
  }

  if (defaultChanged && diff.next.default.length > 0) {
    statements.push({
      sql: `${prefix} SET DEFAULT ${diff.next.default}`,
      timeoutMs: statementTimeoutDefaultMs,
      lockTimeoutMs: lockTimeoutDefaultMs,
      hazards: [],
      skipValidation: false,
    });
  }

  return statements;
}

function columnTypeOrCollationChanged(
  oldColumn: Column,
  newColumn: Column,
): boolean {
  return (
    oldColumn.type.toLowerCase() !== newColumn.type.toLowerCase() ||
    schemaName(oldColumn.collation) !== schemaName(newColumn.collation)
  );
}

function schemaName(name: SchemaQualifiedName | null): string {
  return name === null ? "" : fqName(name);
}

function typeTransformationStatement(
  tableName: SchemaQualifiedName,
  oldColumn: Column,
  newColumn: Column,
): InternalStatement {
  const prefix = `${alterTablePrefix(tableName)} ALTER COLUMN ${escapeIdentifier(newColumn.name)}`;
  const newType = newColumn.type.toLowerCase();
  const isTimestampTarget =
    newType.startsWith("timestamp") || newType.startsWith("timestamptz");
  const usingExpression =
    oldColumn.type.toLowerCase() === "bigint" && isTimestampTarget
      ? `to_timestamp(${escapeIdentifier(newColumn.name)} / 1000.0)`
      : `${escapeIdentifier(newColumn.name)}::${newColumn.type}`;
  const collation =
    newColumn.collation === null
      ? ""
      : `COLLATE ${fqName(newColumn.collation)} `;
  return {
    sql: `${prefix} SET DATA TYPE ${newColumn.type} ${collation}using ${usingExpression}`,
    timeoutMs: statementTimeoutDefaultMs,
    lockTimeoutMs: lockTimeoutDefaultMs,
    hazards: [
      {
        type: "ACQUIRES_ACCESS_EXCLUSIVE_LOCK",
        message:
          "This will lock the table while data is rewritten if the conversion is not trivial.",
      },
    ],
    skipValidation: false,
  };
}

function analyzeColumnStatement(
  tableName: SchemaQualifiedName,
  column: Column,
): InternalStatement {
  return {
    sql: `ANALYZE ${fqName(tableName)} (${escapeIdentifier(column.name)})`,
    timeoutMs: statementTimeoutDefaultMs,
    lockTimeoutMs: lockTimeoutDefaultMs,
    hazards: [
      {
        type: "IMPACTS_DATABASE_PERFORMANCE",
        message:
          "Running analyze reads rows from the table and may affect query performance.",
      },
    ],
    skipValidation: false,
  };
}

function identityStatements(
  tableName: SchemaQualifiedName,
  oldColumn: Column,
  newColumn: Column,
): readonly InternalStatement[] {
  if (identityEqual(oldColumn.identity, newColumn.identity)) {
    return [];
  }

  const prefix = `${alterTablePrefix(tableName)} ALTER COLUMN ${escapeIdentifier(newColumn.name)}`;
  if (newColumn.identity === null) {
    return [standardColumnStatement(`${prefix} DROP IDENTITY`)];
  }
  if (oldColumn.identity === null) {
    return [
      standardColumnStatement(
        `${prefix} ADD ${buildColumnIdentityDefinition(newColumn.identity)}`,
      ),
    ];
  }

  const modifications: string[] = [];
  if (oldColumn.identity.type !== newColumn.identity.type) {
    modifications.push(
      `SET GENERATED ${columnIdentityTypeModifier(newColumn.identity.type)}`,
    );
  }
  if (oldColumn.identity.increment !== newColumn.identity.increment) {
    modifications.push(`SET INCREMENT BY ${newColumn.identity.increment}`);
  }
  if (oldColumn.identity.minValue !== newColumn.identity.minValue) {
    modifications.push(`SET MINVALUE ${newColumn.identity.minValue}`);
  }
  if (oldColumn.identity.maxValue !== newColumn.identity.maxValue) {
    modifications.push(`SET MAXVALUE ${newColumn.identity.maxValue}`);
  }
  if (oldColumn.identity.startValue !== newColumn.identity.startValue) {
    modifications.push(`SET START ${newColumn.identity.startValue}`);
  }
  if (oldColumn.identity.cacheSize !== newColumn.identity.cacheSize) {
    modifications.push(`SET CACHE ${newColumn.identity.cacheSize}`);
  }
  if (oldColumn.identity.cycle !== newColumn.identity.cycle) {
    modifications.push(`SET ${newColumn.identity.cycle ? "" : "NO "}CYCLE`);
  }

  return modifications.map((modification) =>
    standardColumnStatement(`${prefix} ${modification}`),
  );
}

function standardColumnStatement(sql: string): InternalStatement {
  return {
    sql,
    timeoutMs: statementTimeoutDefaultMs,
    lockTimeoutMs: lockTimeoutDefaultMs,
    hazards: [],
    skipValidation: false,
  };
}

function identityEqual(
  left: ColumnIdentity | null,
  right: ColumnIdentity | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.type === right.type &&
    left.minValue === right.minValue &&
    left.maxValue === right.maxValue &&
    left.startValue === right.startValue &&
    left.increment === right.increment &&
    left.cacheSize === right.cacheSize &&
    left.cycle === right.cycle
  );
}

function onlineNotNullStatements(
  tableName: SchemaQualifiedName,
  column: Column,
): readonly InternalStatement[] {
  const constraintName = temporaryNotNullConstraintName();
  const escapedConstraintName = escapeIdentifier(constraintName);
  const table = fqName(tableName);
  return [
    {
      sql: `ALTER TABLE ${table} ADD CONSTRAINT ${escapedConstraintName} CHECK(${escapeIdentifier(column.name)} IS NOT NULL) NOT VALID`,
      timeoutMs: statementTimeoutDefaultMs,
      lockTimeoutMs: lockTimeoutDefaultMs,
      hazards: [],
      skipValidation: false,
    },
    {
      sql: `ALTER TABLE ${table} VALIDATE CONSTRAINT ${escapedConstraintName}`,
      timeoutMs: statementTimeoutDefaultMs,
      lockTimeoutMs: lockTimeoutDefaultMs,
      hazards: [],
      skipValidation: false,
    },
    {
      sql: `ALTER TABLE ${table} ALTER COLUMN ${escapeIdentifier(column.name)} SET NOT NULL`,
      timeoutMs: statementTimeoutDefaultMs,
      lockTimeoutMs: lockTimeoutDefaultMs,
      hazards: [],
      skipValidation: false,
    },
    {
      sql: `ALTER TABLE ${table} DROP CONSTRAINT ${escapedConstraintName}`,
      timeoutMs: statementTimeoutDefaultMs,
      lockTimeoutMs: lockTimeoutDefaultMs,
      hazards: [],
      skipValidation: false,
    },
  ];
}

function buildColumnIdentityDefinition(identity: ColumnIdentity): string {
  const cycleModifier = identity.cycle ? "CYCLE" : "NO CYCLE";
  return `GENERATED ${columnIdentityTypeModifier(identity.type)} AS IDENTITY (INCREMENT BY ${identity.increment} MINVALUE ${identity.minValue} MAXVALUE ${identity.maxValue} START WITH ${identity.startValue} CACHE ${identity.cacheSize} ${cycleModifier})`;
}

function columnIdentityTypeModifier(type: ColumnIdentity["type"]): string {
  switch (type) {
    case "a":
      return "ALWAYS";
    case "d":
      return "BY DEFAULT";
    default:
      return assertNever(type);
  }
}

export function alterTablePrefix(tableName: SchemaQualifiedName): string {
  return `ALTER TABLE ${fqName(tableName)}`;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected column identity type: ${String(value)}`);
}
