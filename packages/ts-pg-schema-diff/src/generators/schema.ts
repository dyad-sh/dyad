import { escapeIdentifier, fqName } from "../schema/identifiers.js";
import { deepEqual } from "../diff/equality.js";
import { NotImplementedMigrationError } from "../errors.js";
import { DirectedGraph } from "../graph/graph.js";
import { SqlGraph, sqlPriority } from "../graph/sqlGraph.js";
import {
  constraintsEqualIgnoringLocality,
  stripTrailingNotValid,
} from "../schema/constraints.js";
import { objectName } from "../schema/objectName.js";
import { temporaryIndexName } from "../schema/randomIdentifier.js";
import type {
  CheckConstraint,
  Column,
  Enum,
  Extension,
  ForeignKeyConstraint,
  FunctionSchema,
  Index,
  MaterializedView,
  NamedSchema,
  Policy,
  PolicyCmd,
  Procedure,
  ReplicaIdentity,
  Sequence,
  Table,
  TablePrivilege,
  Trigger,
  View,
} from "../schema/model.js";
import {
  lockTimeoutDefaultMs,
  statementTimeoutConcurrentIndexBuildMs,
  statementTimeoutConcurrentIndexDropMs,
  statementTimeoutDefaultMs,
  statementTimeoutTableDropMs,
  type InternalStatement,
  type MigrationHazard,
} from "../plan/types.js";
import type { SchemaDiff, TableDiff } from "../diff/schemaDiff.js";
import {
  addColumnStatement,
  alterColumnStatements,
  buildColumnDefinition,
  deleteColumnStatement,
} from "./column.js";
import type { GeneratePlanOptions } from "../plan/generate.js";
import type { ListDiff } from "../diff/listDiff.js";

export function generateStatements(
  diff: SchemaDiff,
  options: GeneratePlanOptions = {},
): readonly InternalStatement[] {
  const indexDeletes = diff.indexDiffs.deletes.filter(
    (index) => !indexOwningRelationDroppedOrRecreated(index, diff),
  );
  const indexAdds = [
    ...diff.indexDiffs.adds,
    ...indexesForRecreatedMaterializedViews(diff),
  ];
  const indexRenamesByName = buildReplacementIndexRenames(
    indexDeletes,
    indexAdds,
  );
  const functionAddAlters = orderFunctionsForAddAlter([
    ...diff.functionDiffs.adds,
    ...diff.functionDiffs.alters.map((functionDiff) => functionDiff.next),
  ]);
  const functionDeletes = orderFunctionsForDelete(diff.functionDiffs.deletes);
  const sequenceDeletes = diff.sequenceDiffs.deletes.filter(
    (sequence) => !sequenceDeletedWithOwner(sequence, diff),
  );
  const viewMaterializedViewAdds = orderViewMaterializedViewAdds(
    diff.viewDiffs.adds,
    diff.materializedViewDiffs.adds,
  ).map((add) =>
    add.kind === "view" ? addView(add.view) : addMaterializedView(add.view),
  );
  const enumAddNames = new Set(diff.enumDiffs.adds.map(objectName));
  const enumRecreateNames = new Set(
    diff.enumDiffs.deletes
      .map(objectName)
      .filter((name) => enumAddNames.has(name)),
  );
  const enumRecreateDeletes = diff.enumDiffs.deletes.filter((schemaEnum) =>
    enumRecreateNames.has(objectName(schemaEnum)),
  );
  const enumDeletes = diff.enumDiffs.deletes.filter(
    (schemaEnum) => !enumRecreateNames.has(objectName(schemaEnum)),
  );
  const enumRecreateAdds = diff.enumDiffs.adds.filter((schemaEnum) =>
    enumRecreateNames.has(objectName(schemaEnum)),
  );
  const enumAdds = diff.enumDiffs.adds.filter(
    (schemaEnum) => !enumRecreateNames.has(objectName(schemaEnum)),
  );
  const tableDeletes = diff.tableDiffs.deletes
    .map((table) => deleteTable(table, diff))
    .filter(isStatement);
  const orderedTableAdds = orderTableAdds(diff.tableDiffs.adds);
  for (const schemaEnum of enumRecreateDeletes) {
    assertEnumCanBeRecreated(schemaEnum, diff);
  }
  for (const functionDiff of diff.functionDiffs.alters) {
    assertFunctionCanBeAltered(functionDiff);
  }
  for (const viewDiff of diff.materializedViewDiffs.alters) {
    assertMaterializedViewCanBeRecreated(viewDiff.old, diff);
  }
  const statements = orderStatementSections([
    {
      id: "named-schema:add",
      statements: diff.namedSchemaDiffs.adds.map(addNamedSchema),
    },
    {
      id: "extension:add",
      statements: diff.extensionDiffs.adds.map(addExtension),
    },
    {
      id: "extension:alter",
      statements: diff.extensionDiffs.alters.map(alterExtension).flat(),
    },
    {
      id: "enum:recreate-delete",
      statements: enumRecreateDeletes.map(deleteEnum),
    },
    { id: "enum:recreate-add", statements: enumRecreateAdds.map(addEnum) },
    { id: "enum:add", statements: enumAdds.map(addEnum) },
    {
      id: "enum:alter",
      statements: diff.enumDiffs.alters.map(alterEnum).flat(),
    },
    { id: "view:delete", statements: diff.viewDiffs.deletes.map(deleteView) },
    {
      id: "materialized-view:delete",
      statements: diff.materializedViewDiffs.deletes.map(
        deleteMaterializedView,
      ),
    },
    {
      id: "trigger:delete",
      statements: diff.triggerDiffs.deletes.map(deleteTrigger),
    },
    {
      id: "foreign-key:delete",
      statements: diff.foreignKeyConstraintDiffs.deletes.map(
        deleteForeignKeyConstraint,
      ),
    },
    {
      id: "index:rename-for-replacement",
      statements: [...indexRenamesByName.entries()].map(([, replacement]) =>
        renameIndex(replacement.oldIndex, replacement.temporaryName),
      ),
    },
    {
      id: "index:delete",
      statements: indexDeletes
        .filter((index) => !indexRenamesByName.has(objectName(index)))
        .map((index) => deleteIndex(index, null, options))
        .filter(isStatement),
    },
    { id: "table:delete", statements: tableDeletes },
    {
      id: "sequence:add",
      statements: diff.sequenceDiffs.adds.map(addSequence),
    },
    {
      id: "table:add",
      statements: orderedTableAdds.map(addTable).flat(),
    },
    {
      id: "table:attach-partition",
      statements: orderedTableAdds
        .map(addAttachPartitionStatement)
        .filter(isStatement),
    },
    {
      id: "table:alter",
      statements: diff.tableDiffs.alters
        .map((tableDiff) => alterTable(tableDiff, diff))
        .flat(),
    },
    {
      id: "sequence:delete-owned",
      statements: sequenceDeletes.map(deleteSequence),
    },
    {
      id: "sequence:own",
      statements: diff.sequenceDiffs.adds
        .map(sequenceOwnershipStatement)
        .filter(isStatement),
    },
    {
      id: "sequence:alter",
      statements: diff.sequenceDiffs.alters.map(alterSequence).flat(),
    },
    {
      id: "function:add-alter",
      statements: functionAddAlters.map(addFunction),
    },
    {
      id: "procedure:add",
      statements: diff.procedureDiffs.adds.map(addProcedure),
    },
    {
      id: "procedure:alter",
      statements: diff.procedureDiffs.alters.map((procedureDiff) =>
        addProcedure(procedureDiff.next),
      ),
    },
    { id: "view-materialized-view:add", statements: viewMaterializedViewAdds },
    {
      id: "view:alter",
      statements: diff.viewDiffs.alters.map(alterView).flat(),
    },
    {
      id: "materialized-view:alter",
      statements: diff.materializedViewDiffs.alters
        .map((viewDiff) => [
          deleteMaterializedView(viewDiff.old),
          addMaterializedView(viewDiff.next),
        ])
        .flat(),
    },
    {
      id: "index:add",
      statements: orderIndexAdds(indexAdds)
        .map((index) => addIndex(index, options))
        .flat(),
    },
    {
      id: "index:alter",
      statements: diff.indexDiffs.alters
        .filter(
          (indexDiff) =>
            !indexOwningRelationDroppedOrRecreated(indexDiff.next, diff),
        )
        .map(alterIndex)
        .flat(),
    },
    {
      id: "index:delete-replaced",
      statements: indexDeletes
        .filter((index) => indexRenamesByName.has(objectName(index)))
        .map((index) =>
          deleteIndex(
            index,
            indexRenamesByName.get(objectName(index))?.temporaryName ?? null,
            options,
          ),
        )
        .filter(isStatement),
    },
    {
      id: "foreign-key:alter",
      statements: diff.foreignKeyConstraintDiffs.alters
        .map(alterForeignKeyConstraint)
        .flat(),
    },
    {
      id: "foreign-key:add",
      statements: diff.foreignKeyConstraintDiffs.adds
        .map(addForeignKeyConstraint)
        .flat(),
    },
    {
      id: "trigger:alter",
      statements: diff.triggerDiffs.alters.map(alterTrigger).flat(),
    },
    { id: "trigger:add", statements: diff.triggerDiffs.adds.map(addTrigger) },
    { id: "function:delete", statements: functionDeletes.map(deleteFunction) },
    {
      id: "procedure:delete",
      statements: diff.procedureDiffs.deletes.map(deleteProcedure),
    },
    { id: "enum:delete", statements: enumDeletes.map(deleteEnum) },
    {
      id: "extension:delete",
      statements: diff.extensionDiffs.deletes.map(deleteExtension),
    },
    {
      id: "named-schema:delete",
      statements: diff.namedSchemaDiffs.deletes.map(deleteNamedSchema),
    },
  ]);

  if (options.rejectEnumValueUsageInSameTransaction === true) {
    assertNoEnumValueUsageInSameTransaction(diff);
  }

  return statements;
}

type StatementSection = {
  readonly id: string;
  readonly statements: readonly InternalStatement[];
};

function orderStatementSections(
  sections: readonly StatementSection[],
): readonly InternalStatement[] {
  const graph = new SqlGraph();
  for (const section of sections) {
    graph.addVertex({
      id: section.id,
      priority: sqlPriority.unset,
      statements: section.statements,
    });
  }
  for (let index = 1; index < sections.length; index += 1) {
    const previous = sections[index - 1];
    const current = sections[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    graph.addDependency({ source: previous.id, target: current.id });
  }
  return graph.toOrderedStatements();
}

function sequenceDeletedWithOwner(
  sequence: Sequence,
  diff: SchemaDiff,
): boolean {
  if (sequence.owner === null) {
    return false;
  }

  const ownerTableName = fqName(sequence.owner.tableName);
  if (
    diff.tableDiffs.deletes.some(
      (table) => objectName(table) === ownerTableName,
    )
  ) {
    return true;
  }

  const ownerTableDiff = diff.tableDiffs.alters.find(
    (tableDiff) => objectName(tableDiff.old) === ownerTableName,
  );
  return (
    ownerTableDiff?.columnsDiff.deletes.some(
      (column) => column.name === sequence.owner?.columnName,
    ) ?? false
  );
}

function indexOwningRelationDeleted(index: Index, diff: SchemaDiff): boolean {
  const owningRelationName = fqName(index.owningRelName);
  if (index.owningRelKind === "m") {
    return diff.materializedViewDiffs.deletes.some(
      (view) => objectName(view) === owningRelationName,
    );
  }
  return diff.tableDiffs.deletes.some(
    (table) => objectName(table) === owningRelationName,
  );
}

function indexOwningRelationDroppedOrRecreated(
  index: Index,
  diff: SchemaDiff,
): boolean {
  return (
    indexOwningRelationDeleted(index, diff) ||
    (index.owningRelKind === "m" &&
      diff.materializedViewDiffs.alters.some(
        (viewDiff) => objectName(viewDiff.old) === fqName(index.owningRelName),
      ))
  );
}

function indexesForRecreatedMaterializedViews(
  diff: SchemaDiff,
): readonly Index[] {
  const addedIndexNames = new Set(diff.indexDiffs.adds.map(objectName));
  const alteredViewNames = new Set(
    diff.materializedViewDiffs.alters.map((viewDiff) =>
      objectName(viewDiff.next),
    ),
  );
  return diff.next.indexes.filter(
    (index) =>
      index.owningRelKind === "m" &&
      alteredViewNames.has(fqName(index.owningRelName)) &&
      !addedIndexNames.has(objectName(index)),
  );
}

type ReplacementIndexRename = {
  readonly oldIndex: Index;
  readonly temporaryName: string;
};

function buildReplacementIndexRenames(
  deletedIndexes: readonly Index[],
  addedIndexes: readonly Index[],
): ReadonlyMap<string, ReplacementIndexRename> {
  const deletedByName = new Map(
    deletedIndexes.map((index) => [objectName(index), index]),
  );
  const renames = new Map<string, ReplacementIndexRename>();
  for (const addedIndex of addedIndexes) {
    const name = objectName(addedIndex);
    const oldIndex = deletedByName.get(name);
    if (
      oldIndex !== undefined &&
      oldIndex.constraint === null &&
      addedIndex.constraint === null
    ) {
      renames.set(name, {
        oldIndex,
        temporaryName: temporaryIndexName(oldIndex.name),
      });
    }
  }
  return renames;
}

function renameIndex(index: Index, temporaryName: string): InternalStatement {
  return standardStatement(
    `ALTER INDEX ${indexQualifiedName(index)} RENAME TO ${escapeIdentifier(temporaryName)}`,
  );
}

function assertEnumCanBeRecreated(schemaEnum: Enum, diff: SchemaDiff): void {
  const typeNames = enumTypeNameCandidates(schemaEnum);
  const referencingTable = diff.old.tables.find((table) =>
    table.columns.some((column) => columnUsesType(column, typeNames)),
  );
  if (referencingTable !== undefined) {
    throw new NotImplementedMigrationError(
      `removing labels from enum ${fqName(schemaEnum.name)} is not supported because it is used by table ${fqName(referencingTable.name)}`,
    );
  }
}

type EnumValueAddition = {
  readonly schemaEnum: Enum;
  readonly labels: readonly string[];
  readonly typeNames: ReadonlySet<string>;
};

function assertNoEnumValueUsageInSameTransaction(diff: SchemaDiff): void {
  const additions = enumValueAdditions(diff);
  if (additions.length === 0) {
    return;
  }

  for (const addition of additions) {
    const usage = findSameTransactionEnumValueUsage(diff, addition);
    if (usage === null) {
      continue;
    }
    throw new NotImplementedMigrationError(
      `adding enum value ${usage.label} to ${fqName(addition.schemaEnum.name)} and using it in ${usage.location} is not supported in a single transaction. Apply the enum value change first, then regenerate the migration preview.`,
    );
  }
}

function enumValueAdditions(diff: SchemaDiff): readonly EnumValueAddition[] {
  return diff.enumDiffs.alters
    .map((enumDiff) => {
      const oldLabels = new Set(enumDiff.old.labels);
      const labels = enumDiff.next.labels.filter(
        (label) => !oldLabels.has(label),
      );
      return {
        schemaEnum: enumDiff.next,
        labels,
        typeNames: enumTypeNameCandidates(enumDiff.next),
      };
    })
    .filter((addition) => addition.labels.length > 0);
}

function findSameTransactionEnumValueUsage(
  diff: SchemaDiff,
  addition: EnumValueAddition,
): { readonly label: string; readonly location: string } | null {
  for (const table of diff.tableDiffs.adds) {
    const usage = findEnumValueUsageInTable(table, addition);
    if (usage !== null) {
      return { ...usage, location: `${fqName(table.name)} ${usage.location}` };
    }
  }

  for (const tableDiff of diff.tableDiffs.alters) {
    for (const column of tableDiff.columnsDiff.adds) {
      const label = enumColumnDefaultUsesAddedLabel(column, addition);
      if (label !== null) {
        return {
          label,
          location: `${fqName(tableDiff.next.name)} column ${escapeIdentifier(column.name)} default`,
        };
      }
    }

    for (const columnDiff of tableDiff.columnsDiff.alters) {
      const label = enumColumnDefaultUsesAddedLabel(columnDiff.next, addition);
      if (
        label !== null &&
        columnDiff.old.default !== columnDiff.next.default
      ) {
        return {
          label,
          location: `${fqName(tableDiff.next.name)} column ${escapeIdentifier(columnDiff.next.name)} default`,
        };
      }
    }

    for (const constraint of [
      ...tableDiff.checkConstraintDiff.adds,
      ...tableDiff.checkConstraintDiff.alters.map(
        (constraintDiff) => constraintDiff.next,
      ),
    ]) {
      const label = checkConstraintUsesAddedEnumLabel(
        tableDiff.next,
        constraint,
        addition,
      );
      if (label !== null) {
        return {
          label,
          location: `${fqName(tableDiff.next.name)} check constraint ${escapeIdentifier(constraint.name)}`,
        };
      }
    }
  }

  return null;
}

function findEnumValueUsageInTable(
  table: Table,
  addition: EnumValueAddition,
): { readonly label: string; readonly location: string } | null {
  for (const column of table.columns) {
    const label = enumColumnDefaultUsesAddedLabel(column, addition);
    if (label !== null) {
      return {
        label,
        location: `column ${escapeIdentifier(column.name)} default`,
      };
    }
  }
  for (const constraint of table.checkConstraints) {
    const label = checkConstraintUsesAddedEnumLabel(
      table,
      constraint,
      addition,
    );
    if (label !== null) {
      return {
        label,
        location: `check constraint ${escapeIdentifier(constraint.name)}`,
      };
    }
  }
  return null;
}

function enumColumnDefaultUsesAddedLabel(
  column: Column,
  addition: EnumValueAddition,
): string | null {
  if (!columnUsesType(column, addition.typeNames)) {
    return null;
  }
  return findAddedLabelReference(column.default, addition.labels);
}

function checkConstraintUsesAddedEnumLabel(
  table: Table,
  constraint: CheckConstraint,
  addition: EnumValueAddition,
): string | null {
  if (
    !table.columns.some((column) => columnUsesType(column, addition.typeNames))
  ) {
    return null;
  }
  return findAddedLabelReference(constraint.expression, addition.labels);
}

function findAddedLabelReference(
  expression: string,
  labels: readonly string[],
): string | null {
  for (const label of labels) {
    if (expression.includes(`'${escapeStringLiteral(label)}'`)) {
      return label;
    }
  }
  return null;
}

function columnUsesType(
  column: Column,
  typeNames: ReadonlySet<string>,
): boolean {
  return typeNames.has(column.type);
}

function enumTypeNameCandidates(schemaEnum: Enum): ReadonlySet<string> {
  const unescapedName = unescapeIdentifier(schemaEnum.name.escapedName);
  return new Set([
    unescapedName,
    schemaEnum.name.escapedName,
    `${schemaEnum.name.schemaName}.${unescapedName}`,
    `${escapeIdentifier(schemaEnum.name.schemaName)}.${schemaEnum.name.escapedName}`,
    fqName(schemaEnum.name),
  ]);
}

function unescapeIdentifier(identifier: string): string {
  if (identifier.startsWith('"') && identifier.endsWith('"')) {
    return identifier.slice(1, -1).replaceAll('""', '"');
  }
  return identifier;
}

function addNamedSchema(schema: NamedSchema): InternalStatement {
  return standardStatement(`CREATE SCHEMA ${escapeIdentifier(schema.name)}`);
}

function deleteNamedSchema(schema: NamedSchema): InternalStatement {
  return {
    ...standardStatement(`DROP SCHEMA ${escapeIdentifier(schema.name)}`),
    hazards: [
      {
        type: "DELETES_DATA",
        message:
          "Drops the schema and objects it contains if dependencies allow it.",
      },
    ],
  };
}

function addExtension(extension: Extension): InternalStatement {
  const version =
    extension.version.length === 0
      ? ""
      : ` VERSION ${escapeIdentifier(extension.version)}`;
  return standardStatement(
    `CREATE EXTENSION ${extension.name.escapedName} WITH SCHEMA ${escapeIdentifier(extension.name.schemaName)}${version}`,
  );
}

function alterExtension(diff: {
  readonly old: Extension;
  readonly next: Extension;
}): readonly InternalStatement[] {
  if (diff.old.version === diff.next.version) {
    return [];
  }
  const target =
    diff.next.version.length === 0
      ? ""
      : ` TO ${escapeIdentifier(diff.next.version)}`;
  return [
    {
      ...standardStatement(
        `ALTER EXTENSION ${diff.next.name.escapedName} UPDATE${target}`,
      ),
      hazards: [
        {
          type: "UPGRADING_EXTENSION_VERSION",
          message:
            "This extension's version is being upgraded. Be sure the newer version is backwards compatible.",
        },
      ],
    },
  ];
}

function deleteExtension(extension: Extension): InternalStatement {
  return {
    ...standardStatement(`DROP EXTENSION ${extension.name.escapedName}`),
    hazards: [
      {
        type: "HAS_UNTRACKABLE_DEPENDENCIES",
        message:
          "This extension may be in use by tables, indexes, functions, triggers, or other objects.",
      },
    ],
  };
}

function addEnum(schemaEnum: Enum): InternalStatement {
  const labels = schemaEnum.labels
    .map((label) => `'${label.replaceAll("'", "''")}'`)
    .join(", ");
  return standardStatement(
    `CREATE TYPE ${fqName(schemaEnum.name)} AS ENUM (${labels})`,
  );
}

function deleteEnum(schemaEnum: Enum): InternalStatement {
  return {
    ...standardStatement(`DROP TYPE ${fqName(schemaEnum.name)}`),
    hazards: [{ type: "DELETES_DATA", message: "Drops the enum type." }],
  };
}

function alterEnum(diff: {
  readonly old: Enum;
  readonly next: Enum;
}): readonly InternalStatement[] {
  const oldLabels = new Set(diff.old.labels);
  const statements: InternalStatement[] = [];
  for (let index = diff.next.labels.length - 1; index >= 0; index -= 1) {
    const label = diff.next.labels[index];
    if (label === undefined || oldLabels.has(label)) {
      continue;
    }
    const beforeLabel = diff.next.labels[index + 1];
    const beforeClause =
      beforeLabel === undefined
        ? ""
        : ` BEFORE '${escapeStringLiteral(beforeLabel)}'`;
    statements.push(
      standardStatement(
        `ALTER TYPE ${fqName(diff.next.name)} ADD VALUE '${escapeStringLiteral(label)}'${beforeClause}`,
      ),
    );
  }
  return statements;
}

function escapeStringLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function addTable(table: Table): readonly InternalStatement[] {
  if (table.parentTable !== null) {
    assertSupportedPartition(table);
  }
  const columnDefs = table.columns
    .map((column) => `\t${buildColumnDefinition(column)}`)
    .join(",\n");
  let sql = `CREATE TABLE ${fqName(table.name)} (\n${columnDefs}\n)`;
  if (table.partitionKeyDef.length > 0) {
    sql += ` PARTITION BY ${table.partitionKeyDef}`;
  }
  return [
    standardStatement(sql),
    ...table.checkConstraints
      .map((constraint) =>
        addCheckConstraintStatements(table, constraint, true),
      )
      .flat(),
    ...replicaIdentityStatements(table, "d", table.replicaIdentity),
    ...table.policies.map((policy) => addPolicy(table, policy)),
    ...rlsStatements(table, false, false, table.rlsEnabled, table.rlsForced),
    ...table.privileges.map((privilege) => addPrivilege(table, privilege)),
  ];
}

function orderTableAdds(tables: readonly Table[]): readonly Table[] {
  return [...tables].sort((left, right) => {
    if (left.parentTable === null && right.parentTable !== null) {
      return -1;
    }
    if (left.parentTable !== null && right.parentTable === null) {
      return 1;
    }
    return fqName(left.name).localeCompare(fqName(right.name));
  });
}

function addAttachPartitionStatement(table: Table): InternalStatement | null {
  if (table.parentTable === null) {
    return null;
  }
  return standardStatement(
    `ALTER TABLE ${fqName(table.parentTable)} ATTACH PARTITION ${fqName(table.name)} ${table.forValues}`,
  );
}

function assertSupportedPartition(table: Table): void {
  if (table.partitionKeyDef.length > 0) {
    throw new NotImplementedMigrationError(
      "partitioned partitions are not supported",
    );
  }
  if (table.checkConstraints.length > 0) {
    throw new NotImplementedMigrationError(
      "check constraints on partitions are not supported",
    );
  }
  if (table.policies.length > 0) {
    throw new NotImplementedMigrationError(
      "policies on partitions are not supported",
    );
  }
  if (table.privileges.length > 0) {
    throw new NotImplementedMigrationError(
      "privileges on partitions are not supported",
    );
  }
}

function deleteTable(table: Table, diff: SchemaDiff): InternalStatement | null {
  if (table.parentTable !== null) {
    const parentTable = table.parentTable;
    if (
      diff.tableDiffs.deletes.some(
        (deletedTable) => objectName(deletedTable) === fqName(parentTable),
      )
    ) {
      return null;
    }
    throw new NotImplementedMigrationError(
      "deleting partitions without dropping parent table is not supported",
    );
  }
  return {
    sql: `DROP TABLE ${fqName(table.name)}`,
    timeoutMs: statementTimeoutTableDropMs,
    lockTimeoutMs: lockTimeoutDefaultMs,
    hazards: [
      {
        type: "DELETES_DATA",
        message: "Deletes all rows in the table and the table itself",
      },
    ],
    skipValidation: false,
  };
}

function alterTable(
  diff: TableDiff,
  schemaDiff: SchemaDiff,
): readonly InternalStatement[] {
  if (diff.next.parentTable !== null) {
    return alterPartition(diff, schemaDiff);
  }

  const afterEarlyRlsEnabled = diff.old.rlsEnabled && diff.next.rlsEnabled;
  const afterEarlyRlsForced = diff.old.rlsForced && diff.next.rlsForced;
  const checkConstraintDeletes = diff.checkConstraintDiff.deletes.map(
    (constraint) => deleteCheckConstraint(diff.next, constraint),
  );
  const policyDeletes = diff.policiesDiff.deletes.map((policy) =>
    deletePolicy(diff.next, policy),
  );
  const columnStatements = [
    ...diff.columnsDiff.deletes.map((column) =>
      deleteColumnStatement(diff.next.name, column),
    ),
    ...diff.columnsDiff.adds.map((column) =>
      addColumnStatement(diff.next.name, column),
    ),
    ...diff.columnsDiff.alters
      .map((columnDiff) => alterColumnStatements(diff.next.name, columnDiff))
      .flat(),
  ];
  return [
    ...rlsStatements(
      diff.next,
      diff.old.rlsEnabled,
      diff.old.rlsForced,
      afterEarlyRlsEnabled,
      afterEarlyRlsForced,
    ),
    ...checkConstraintDeletes,
    ...policyDeletes,
    ...columnStatements,
    ...diff.checkConstraintDiff.adds
      .map((constraint) =>
        addCheckConstraintStatements(diff.next, constraint, false),
      )
      .flat(),
    ...diff.checkConstraintDiff.alters
      .map((constraintDiff) => alterCheckConstraint(diff.next, constraintDiff))
      .flat(),
    ...diff.policiesDiff.adds.map((policy) => addPolicy(diff.next, policy)),
    ...diff.policiesDiff.alters
      .map((policyDiff) => alterPolicy(diff.next, policyDiff))
      .flat(),
    ...diff.privilegesDiff.deletes.map((privilege) =>
      deletePrivilege(diff.next, privilege),
    ),
    ...diff.privilegesDiff.adds.map((privilege) =>
      addPrivilege(diff.next, privilege),
    ),
    ...diff.privilegesDiff.alters
      .map((privilegeDiff) => alterPrivilege(diff.next, privilegeDiff))
      .flat(),
    ...replicaIdentityStatements(
      diff.next,
      diff.old.replicaIdentity,
      diff.next.replicaIdentity,
    ),
    ...rlsStatements(
      diff.next,
      afterEarlyRlsEnabled,
      afterEarlyRlsForced,
      diff.next.rlsEnabled,
      diff.next.rlsForced,
    ),
  ];
}

function alterPartition(
  diff: TableDiff,
  schemaDiff: SchemaDiff,
): readonly InternalStatement[] {
  if (diff.old.forValues !== diff.next.forValues) {
    throw new NotImplementedMigrationError(
      "altering partition FOR VALUES is not supported",
    );
  }
  if (!listDiffIsEmpty(diff.checkConstraintDiff)) {
    throw new NotImplementedMigrationError(
      "check constraints on partitions are not supported",
    );
  }
  if (!listDiffIsEmpty(diff.policiesDiff)) {
    throw new NotImplementedMigrationError(
      "policies on partitions are not supported",
    );
  }
  if (!listDiffIsEmpty(diff.privilegesDiff)) {
    throw new NotImplementedMigrationError(
      "privileges on partitions are not supported",
    );
  }

  const parentDiff = schemaDiff.tableDiffs.alters.find(
    (tableDiff) =>
      diff.next.parentTable !== null &&
      objectName(tableDiff.next) === fqName(diff.next.parentTable),
  );
  const alteredParentColumnsByName = new Map(
    parentDiff?.columnsDiff.alters.map((columnDiff) => [
      columnDiff.next.name,
      columnDiff,
    ]) ?? [],
  );
  const statements: InternalStatement[] = [];

  for (const columnDiff of diff.columnsDiff.alters) {
    if (columnDiff.old.isNullable === columnDiff.next.isNullable) {
      continue;
    }

    const parentColumnDiff = alteredParentColumnsByName.get(
      columnDiff.next.name,
    );
    if (
      parentColumnDiff !== undefined &&
      columnDiff.next.isNullable === parentColumnDiff.next.isNullable &&
      parentColumnDiff.next.isNullable !== parentColumnDiff.old.isNullable
    ) {
      continue;
    }

    statements.push(
      standardStatement(
        `ALTER TABLE ${fqName(diff.next.name)} ALTER COLUMN ${escapeIdentifier(columnDiff.next.name)} ${
          columnDiff.next.isNullable ? "DROP NOT NULL" : "SET NOT NULL"
        }`,
      ),
    );
  }

  return statements;
}

function addCheckConstraintStatements(
  table: Table,
  constraint: CheckConstraint,
  isNewTable: boolean,
): readonly InternalStatement[] {
  assertCheckConstraintSupported(constraint);
  if (constraint.isValid && !isNewTable) {
    const invalidConstraint = createCheckConstraintStatement(table, {
      ...constraint,
      isValid: false,
    });
    return [
      invalidConstraint,
      standardStatement(
        `ALTER TABLE ${fqName(table.name)} VALIDATE CONSTRAINT ${escapeIdentifier(constraint.name)}`,
      ),
    ];
  }
  return [createCheckConstraintStatement(table, constraint)];
}

function createCheckConstraintStatement(
  table: Table,
  constraint: CheckConstraint,
): InternalStatement {
  let sql = `ALTER TABLE ${fqName(table.name)} ADD CONSTRAINT ${escapeIdentifier(constraint.name)} CHECK(${constraint.expression})`;
  if (!constraint.isInheritable) {
    sql += " NO INHERIT";
  }
  if (!constraint.isValid) {
    sql += " NOT VALID";
  }
  return {
    ...standardStatement(sql),
    hazards: constraint.isValid
      ? [
          {
            type: "ACQUIRES_ACCESS_EXCLUSIVE_LOCK",
            message:
              "Adding a valid check constraint may lock reads and writes while the constraint is added.",
          },
        ]
      : [],
  };
}

function deleteCheckConstraint(
  table: Table,
  constraint: CheckConstraint,
): InternalStatement {
  assertCheckConstraintSupported(constraint);
  return standardStatement(
    `ALTER TABLE ${fqName(table.name)} DROP CONSTRAINT ${escapeIdentifier(constraint.name)}`,
  );
}

function alterCheckConstraint(
  table: Table,
  diff: { readonly old: CheckConstraint; readonly next: CheckConstraint },
): readonly InternalStatement[] {
  assertCheckConstraintSupported(diff.old);
  assertCheckConstraintSupported(diff.next);
  if (!diff.old.isValid && diff.next.isValid) {
    return [
      standardStatement(
        `ALTER TABLE ${fqName(table.name)} VALIDATE CONSTRAINT ${escapeIdentifier(diff.next.name)}`,
      ),
    ];
  }
  return [];
}

function assertCheckConstraintSupported(constraint: CheckConstraint): void {
  if (constraint.dependsOnFunctions.length > 0) {
    throw new NotImplementedMigrationError(
      "check constraints that depend on user-defined functions are not supported",
    );
  }
}

function rlsStatements(
  table: Table,
  oldEnabled: boolean,
  oldForced: boolean,
  newEnabled: boolean,
  newForced: boolean,
): readonly InternalStatement[] {
  const statements: InternalStatement[] = [];
  if (oldForced && !newForced) {
    statements.push(
      authzStatement(
        `ALTER TABLE ${fqName(table.name)} NO FORCE ROW LEVEL SECURITY`,
      ),
    );
  }
  if (oldEnabled && !newEnabled) {
    statements.push(
      authzStatement(
        `ALTER TABLE ${fqName(table.name)} DISABLE ROW LEVEL SECURITY`,
      ),
    );
  }
  if (!oldEnabled && newEnabled) {
    statements.push(
      authzStatement(
        `ALTER TABLE ${fqName(table.name)} ENABLE ROW LEVEL SECURITY`,
      ),
    );
  }
  if (!oldForced && newForced) {
    statements.push(
      authzStatement(
        `ALTER TABLE ${fqName(table.name)} FORCE ROW LEVEL SECURITY`,
      ),
    );
  }
  return statements;
}

function authzStatement(sql: string): InternalStatement {
  return {
    ...standardStatement(sql),
    hazards: [
      {
        type: "AUTHZ_UPDATE",
        message: "Changes table authorization behavior.",
      },
    ],
  };
}

function replicaIdentityStatements(
  table: Table,
  oldIdentity: ReplicaIdentity,
  newIdentity: ReplicaIdentity,
): readonly InternalStatement[] {
  if (oldIdentity === newIdentity) {
    return [];
  }
  if (newIdentity === "i") {
    throw new NotImplementedMigrationError(
      "index replica identity is not supported",
    );
  }
  return [
    {
      ...standardStatement(
        `ALTER TABLE ${fqName(table.name)} REPLICA IDENTITY ${replicaIdentitySql(newIdentity)}`,
      ),
      hazards: [
        {
          type: "CORRECTNESS",
          message:
            "Changing replica identity may change logical replication behavior.",
        },
      ],
    },
  ];
}

function replicaIdentitySql(identity: Exclude<ReplicaIdentity, "i">): string {
  switch (identity) {
    case "d":
      return "DEFAULT";
    case "f":
      return "FULL";
    case "n":
      return "NOTHING";
    default:
      return assertNever(identity);
  }
}

function addPolicy(table: Table, policy: Policy): InternalStatement {
  const mode = policy.isPermissive ? "PERMISSIVE" : "RESTRICTIVE";
  const roles =
    policy.appliesTo.length === 0
      ? "PUBLIC"
      : policy.appliesTo.map(escapeRoleName).join(", ");
  const using =
    policy.usingExpression.length === 0
      ? ""
      : ` USING (${policy.usingExpression})`;
  const check =
    policy.checkExpression.length === 0
      ? ""
      : ` WITH CHECK (${policy.checkExpression})`;
  return {
    ...standardStatement(
      `CREATE POLICY ${policy.escapedName} ON ${fqName(table.name)} AS ${mode} FOR ${policyCmdSql(policy.cmd)} TO ${roles}${using}${check}`,
    ),
    hazards: [
      { type: "AUTHZ_UPDATE", message: "Creates a row-level security policy." },
    ],
  };
}

function deletePolicy(table: Table, policy: Policy): InternalStatement {
  return {
    ...standardStatement(
      `DROP POLICY ${policy.escapedName} ON ${fqName(table.name)}`,
    ),
    hazards: [
      { type: "AUTHZ_UPDATE", message: "Drops a row-level security policy." },
    ],
  };
}

function alterPolicy(
  table: Table,
  diff: { readonly old: Policy; readonly next: Policy },
): readonly InternalStatement[] {
  if (deepEqual(diff.old, diff.next)) {
    return [];
  }
  const parts: string[] = [];
  if (!deepEqual(diff.old.appliesTo, diff.next.appliesTo)) {
    parts.push(`TO ${policyRoles(diff.next)}`);
  }
  if (
    diff.old.usingExpression !== diff.next.usingExpression &&
    diff.next.usingExpression.length > 0
  ) {
    parts.push(`USING (${diff.next.usingExpression})`);
  }
  if (
    diff.old.checkExpression !== diff.next.checkExpression &&
    diff.next.checkExpression.length > 0
  ) {
    parts.push(`WITH CHECK (${diff.next.checkExpression})`);
  }
  if (parts.length === 0) {
    return [];
  }
  return [
    {
      ...standardStatement(
        `ALTER POLICY ${diff.next.escapedName} ON ${fqName(table.name)}\n\t${parts.join("\n\t")}`,
      ),
      hazards: [
        {
          type: "AUTHZ_UPDATE",
          message: "Alters a row-level security policy.",
        },
      ],
    },
  ];
}

function policyRoles(policy: Policy): string {
  return policy.appliesTo.length === 0
    ? "PUBLIC"
    : policy.appliesTo.map(escapeRoleName).join(", ");
}

function policyCmdSql(cmd: PolicyCmd): string {
  switch (cmd) {
    case "*":
      return "ALL";
    case "r":
      return "SELECT";
    case "a":
      return "INSERT";
    case "w":
      return "UPDATE";
    case "d":
      return "DELETE";
    default:
      return assertNever(cmd);
  }
}

function addPrivilege(
  table: Table,
  privilege: TablePrivilege,
): InternalStatement {
  const grantOption = privilege.isGrantable ? " WITH GRANT OPTION" : "";
  return {
    ...standardStatement(
      `GRANT ${privilege.privilege} ON ${fqName(table.name)} TO ${escapeRoleName(privilege.grantee)}${grantOption}`,
    ),
    hazards: [{ type: "AUTHZ_UPDATE", message: "Grants table privileges." }],
  };
}

function deletePrivilege(
  table: Table,
  privilege: TablePrivilege,
): InternalStatement {
  return {
    ...standardStatement(
      `REVOKE ${privilege.privilege} ON ${fqName(table.name)} FROM ${escapeRoleName(privilege.grantee)}`,
    ),
    hazards: [{ type: "AUTHZ_UPDATE", message: "Revokes table privileges." }],
  };
}

function alterPrivilege(
  table: Table,
  diff: { readonly old: TablePrivilege; readonly next: TablePrivilege },
): readonly InternalStatement[] {
  if (deepEqual(diff.old, diff.next)) {
    return [];
  }
  return [deletePrivilege(table, diff.old), addPrivilege(table, diff.next)];
}

function escapeRoleName(roleName: string): string {
  return roleName === "" || roleName === "PUBLIC"
    ? "PUBLIC"
    : escapeIdentifier(roleName);
}

function addIndex(
  index: Index,
  options: GeneratePlanOptions,
): readonly InternalStatement[] {
  if (index.isInvalid) {
    throw new NotImplementedMigrationError("can't create an invalid index");
  }

  if (index.owningRelKind === "p" && index.constraint !== null) {
    return [
      standardStatement(
        `ALTER TABLE ONLY ${fqName(index.owningRelName)} ADD CONSTRAINT ${index.constraint.escapedConstraintName} ${index.constraint.constraintDef}`,
      ),
    ];
  }

  const concurrently =
    (index.owningRelKind === "r" || index.owningRelKind === "m") &&
    options.noConcurrentIndexOperations !== true;
  const createIndexStatement: InternalStatement = {
    ...standardStatement(
      concurrently
        ? toCreateIndexConcurrently(index.getIndexDefStmt)
        : index.getIndexDefStmt,
    ),
    timeoutMs: concurrently
      ? statementTimeoutConcurrentIndexBuildMs
      : statementTimeoutDefaultMs,
    hazards: [
      {
        type: "INDEX_BUILD",
        message: "Building this index may affect database performance.",
      },
    ],
  };
  if (index.constraint === null) {
    return index.parentIdx === null
      ? [createIndexStatement]
      : [createIndexStatement, attachIndexPartition(index)];
  }
  return index.parentIdx === null
    ? [createIndexStatement, addIndexConstraint(index)]
    : [
        createIndexStatement,
        addIndexConstraint(index),
        attachIndexPartition(index),
      ];
}

function orderIndexAdds(indexes: readonly Index[]): readonly Index[] {
  return [...indexes].sort((left, right) => {
    if (left.parentIdx === null && right.parentIdx !== null) {
      return -1;
    }
    if (left.parentIdx !== null && right.parentIdx === null) {
      return 1;
    }
    return objectName(left).localeCompare(objectName(right));
  });
}

function deleteIndex(
  index: Index,
  renamedTo: string | null,
  options: GeneratePlanOptions,
): InternalStatement | null {
  if (index.parentIdx !== null) {
    if (index.constraint?.isLocal === true) {
      throw new NotImplementedMigrationError(
        "dropping an index partition that backs a local constraint is not supported",
      );
    }
    return null;
  }
  if (index.constraint !== null) {
    return {
      ...standardStatement(
        `ALTER TABLE ${fqName(index.owningRelName)} DROP CONSTRAINT ${index.constraint.escapedConstraintName}`,
      ),
      hazards: [
        {
          type: "ACQUIRES_ACCESS_EXCLUSIVE_LOCK",
          message: "Dropping this constraint drops its backing index.",
        },
        {
          type: "INDEX_DROPPED",
          message: "Dropping this index may make queries perform worse.",
        },
      ],
    };
  }
  const concurrently =
    (index.owningRelKind === "r" || index.owningRelKind === "m") &&
    options.noConcurrentIndexOperations !== true;
  const indexName = renamedTo ?? index.name;
  return {
    ...standardStatement(
      `DROP INDEX${concurrently ? " CONCURRENTLY" : ""} ${fqName({ schemaName: index.owningRelName.schemaName, escapedName: escapeIdentifier(indexName) })}`,
    ),
    timeoutMs: concurrently
      ? statementTimeoutConcurrentIndexDropMs
      : statementTimeoutDefaultMs,
    hazards: [
      {
        type: "INDEX_DROPPED",
        message: "Dropping this index may make queries perform worse.",
      },
    ],
  };
}

function toCreateIndexConcurrently(createIndexSql: string): string {
  const match = /^(CREATE (?:UNIQUE )?INDEX )(.*)$/u.exec(createIndexSql);
  if (match === null) {
    throw new Error(
      `${createIndexSql} follows an unexpected CREATE INDEX structure`,
    );
  }
  const prefix = match[1];
  const rest = match[2];
  if (prefix === undefined || rest === undefined) {
    throw new Error(
      `${createIndexSql} follows an unexpected CREATE INDEX structure`,
    );
  }
  return `${prefix}CONCURRENTLY ${rest}`;
}

function addIndexConstraint(index: Index): InternalStatement {
  return standardStatement(
    `ALTER TABLE ${fqName(index.owningRelName)} ADD CONSTRAINT ${index.constraint?.escapedConstraintName ?? assertMissingConstraint()} ${constraintTypeSql(index)} USING INDEX ${escapeIdentifier(index.name)}`,
  );
}

function alterIndex(diff: {
  readonly old: Index;
  readonly next: Index;
}): readonly InternalStatement[] {
  let comparableOld = diff.old;
  const statements: InternalStatement[] = [];

  if (comparableOld.constraint === null && diff.next.constraint !== null) {
    statements.push(addIndexConstraint(diff.next));
    comparableOld = { ...comparableOld, constraint: diff.next.constraint };
  }

  if (comparableOld.parentIdx === null && diff.next.parentIdx !== null) {
    statements.push(attachIndexPartition(diff.next));
    comparableOld = { ...comparableOld, parentIdx: diff.next.parentIdx };
  }

  if (
    diff.old.parentIdx === null &&
    diff.next.parentIdx !== null &&
    comparableOld.constraint !== null &&
    diff.next.constraint !== null &&
    constraintsEqualIgnoringLocality(
      comparableOld.constraint,
      diff.next.constraint,
    )
  ) {
    comparableOld = { ...comparableOld, constraint: diff.next.constraint };
  }

  if (
    comparableOld.owningRelKind === "p" &&
    comparableOld.isInvalid &&
    !diff.next.isInvalid
  ) {
    comparableOld = { ...comparableOld, isInvalid: diff.next.isInvalid };
  }

  if (!deepEqual(comparableOld, diff.next)) {
    throw new Error(
      `index diff could not be resolved for ${objectName(diff.next)}`,
    );
  }

  return statements;
}

function attachIndexPartition(index: Index): InternalStatement {
  if (index.parentIdx === null) {
    throw new Error("expected index partition parent");
  }
  return standardStatement(
    `ALTER INDEX ${fqName(index.parentIdx)} ATTACH PARTITION ${indexQualifiedName(index)}`,
  );
}

function indexQualifiedName(index: Index): string {
  return fqName({
    schemaName: index.owningRelName.schemaName,
    escapedName: escapeIdentifier(index.name),
  });
}

function constraintTypeSql(index: Index): string {
  const constraint = index.constraint;
  if (constraint === null) {
    return assertMissingConstraint();
  }
  switch (constraint.type) {
    case "p":
      return "PRIMARY KEY";
    case "u":
      return "UNIQUE";
    default:
      return assertNever(constraint.type);
  }
}

function assertMissingConstraint(): never {
  throw new Error("expected index constraint");
}

function addForeignKeyConstraint(
  constraint: ForeignKeyConstraint,
): readonly InternalStatement[] {
  const definition = stripTrailingNotValid(constraint.constraintDef);
  const addNotValidStatement = standardStatement(
    `ALTER TABLE ${fqName(constraint.owningTable)} ADD CONSTRAINT ${constraint.escapedName} ${definition} NOT VALID`,
  );
  if (!constraint.isValid) {
    return [addNotValidStatement];
  }
  return [
    addNotValidStatement,
    standardStatement(
      `ALTER TABLE ${fqName(constraint.owningTable)} VALIDATE CONSTRAINT ${constraint.escapedName}`,
    ),
  ];
}

function deleteForeignKeyConstraint(
  constraint: ForeignKeyConstraint,
): InternalStatement {
  return standardStatement(
    `ALTER TABLE ${fqName(constraint.owningTable)} DROP CONSTRAINT ${constraint.escapedName}`,
  );
}

function alterForeignKeyConstraint(diff: {
  readonly old: ForeignKeyConstraint;
  readonly next: ForeignKeyConstraint;
}): readonly InternalStatement[] {
  if (!diff.old.isValid && diff.next.isValid) {
    return [
      standardStatement(
        `ALTER TABLE ${fqName(diff.next.owningTable)} VALIDATE CONSTRAINT ${diff.next.escapedName}`,
      ),
    ];
  }
  return [];
}

function addSequence(sequence: Sequence): InternalStatement {
  const cycle = sequence.cycle ? "CYCLE" : "NO CYCLE";
  return {
    ...standardStatement(
      `CREATE SEQUENCE ${fqName(sequence.name)}\n\tAS ${sequence.type}\n\tINCREMENT BY ${sequence.increment}\n\tMINVALUE ${sequence.minValue} MAXVALUE ${sequence.maxValue}\n\tSTART WITH ${sequence.startValue} CACHE ${sequence.cacheSize} ${cycle}`,
    ),
    hazards: sequence.owner === null ? [sequenceDependencyHazard()] : [],
  };
}

function alterSequence(diff: {
  readonly old: Sequence;
  readonly next: Sequence;
}): readonly InternalStatement[] {
  const statements: InternalStatement[] = [];
  const oldComparable = { ...diff.old, owner: null };
  const nextComparable = { ...diff.next, owner: null };
  if (!deepEqual(oldComparable, nextComparable)) {
    const cycle = diff.next.cycle ? "CYCLE" : "NO CYCLE";
    statements.push(
      standardStatement(
        `ALTER SEQUENCE ${fqName(diff.next.name)}\n\tAS ${diff.next.type}\n\tINCREMENT BY ${diff.next.increment}\n\tMINVALUE ${diff.next.minValue} MAXVALUE ${diff.next.maxValue}\n\tSTART WITH ${diff.next.startValue} CACHE ${diff.next.cacheSize} ${cycle}`,
      ),
    );
  }
  if (!deepEqual(diff.old.owner, diff.next.owner)) {
    statements.push(
      sequenceOwnershipStatement(diff.next) ??
        standardStatement(
          `ALTER SEQUENCE ${fqName(diff.next.name)} OWNED BY NONE`,
        ),
    );
  }
  return statements;
}

function deleteSequence(sequence: Sequence): InternalStatement {
  return {
    ...standardStatement(`DROP SEQUENCE ${fqName(sequence.name)}`),
    hazards: [
      {
        type: "DELETES_DATA",
        message: "By deleting a sequence, its value will be permanently lost",
      },
      ...(sequence.owner === null ? [sequenceDependencyHazard()] : []),
    ],
  };
}

function sequenceDependencyHazard(): MigrationHazard {
  return {
    type: "HAS_UNTRACKABLE_DEPENDENCIES",
    message: "Dependencies of unowned sequences cannot be tracked.",
  };
}

function sequenceOwnershipStatement(
  sequence: Sequence,
): InternalStatement | null {
  if (sequence.owner === null) {
    return null;
  }
  return standardStatement(
    `ALTER SEQUENCE ${fqName(sequence.name)} OWNED BY ${fqName(sequence.owner.tableName)}.${escapeIdentifier(sequence.owner.columnName)}`,
  );
}

function isStatement(
  statement: InternalStatement | null,
): statement is InternalStatement {
  return statement !== null;
}

function listDiffIsEmpty(diff: ListDiff<unknown, unknown>): boolean {
  return (
    diff.adds.length === 0 &&
    diff.deletes.length === 0 &&
    diff.alters.length === 0
  );
}

function orderFunctionsForAddAlter(
  functions: readonly FunctionSchema[],
): readonly FunctionSchema[] {
  return orderFunctionsByDependency(functions, "dependency-first");
}

function orderFunctionsForDelete(
  functions: readonly FunctionSchema[],
): readonly FunctionSchema[] {
  return orderFunctionsByDependency(functions, "dependent-first");
}

function orderFunctionsByDependency(
  functions: readonly FunctionSchema[],
  direction: "dependency-first" | "dependent-first",
): readonly FunctionSchema[] {
  const graph = new DirectedGraph<{
    readonly id: string;
    readonly fn: FunctionSchema;
  }>();
  for (const fn of functions) {
    graph.addVertex({ id: objectName(fn), fn });
  }

  for (const fn of functions) {
    const functionId = objectName(fn);
    for (const dependency of fn.dependsOnFunctions) {
      const dependencyId = fqName(dependency);
      if (!graph.hasVertex(dependencyId)) {
        continue;
      }
      if (direction === "dependency-first") {
        graph.addEdge(dependencyId, functionId);
      } else {
        graph.addEdge(functionId, dependencyId);
      }
    }
  }

  return graph.topologicallySort().map((vertex) => vertex.fn);
}

function addFunction(fn: FunctionSchema): InternalStatement {
  return {
    ...standardStatement(fn.functionDef.trimEnd()),
    hazards: functionDependencyHazards(fn, "adds"),
  };
}

function assertFunctionCanBeAltered(diff: {
  readonly old: FunctionSchema;
  readonly next: FunctionSchema;
}): void {
  if (diff.old.returnType !== diff.next.returnType) {
    throw new NotImplementedMigrationError(
      `changing return type of function ${fqName(diff.next.name)} is not supported`,
    );
  }
}

function deleteFunction(fn: FunctionSchema): InternalStatement {
  return {
    ...standardStatement(`DROP FUNCTION ${fqName(fn.name)}`),
    hazards: functionDependencyHazards(fn, "drops"),
  };
}

function addProcedure(procedure: Procedure): InternalStatement {
  return {
    ...standardStatement(procedure.def.trimEnd()),
    hazards: [procedureDependencyHazard("adds")],
  };
}

function deleteProcedure(procedure: Procedure): InternalStatement {
  return {
    ...standardStatement(`DROP PROCEDURE ${fqName(procedure.name)}`),
    hazards: [procedureDependencyHazard("drops")],
  };
}

function functionDependencyHazards(
  fn: FunctionSchema,
  operation: "adds" | "drops",
): readonly MigrationHazard[] {
  if (fn.language === "sql") {
    return [];
  }
  const action =
    operation === "adds" ? "created/altered before" : "dropped after";
  return [
    {
      type: "HAS_UNTRACKABLE_DEPENDENCIES",
      message:
        "Dependencies, i.e. other functions used in the function body, of non-sql functions cannot be tracked. " +
        "As a result, we cannot guarantee that function dependencies are ordered properly relative to this statement. " +
        `For ${operation}, this means you need to ensure that all functions this function depends on are ${action} this statement.`,
    },
  ];
}

function procedureDependencyHazard(
  operation: "adds" | "drops",
): MigrationHazard {
  const action = operation === "adds" ? "added before" : "dropped after";
  return {
    type: "HAS_UNTRACKABLE_DEPENDENCIES",
    message:
      "Dependencies of procedures are not tracked by Postgres. " +
      "As a result, we cannot guarantee that this procedure's dependencies are ordered properly relative to this statement. " +
      `For ${operation}, this means you need to ensure that all objects this function depends on are ${action} this statement.`,
  };
}

function addTrigger(trigger: Trigger): InternalStatement {
  return standardStatement(trigger.getTriggerDefStmt);
}

function deleteTrigger(trigger: Trigger): InternalStatement {
  return standardStatement(
    `DROP TRIGGER ${trigger.escapedName} ON ${fqName(trigger.owningTable)}`,
  );
}

function alterTrigger(diff: {
  readonly old: Trigger;
  readonly next: Trigger;
}): readonly InternalStatement[] {
  if (deepEqual(diff.old, diff.next)) {
    return [];
  }
  if (diff.old.isConstraint || diff.next.isConstraint) {
    return [deleteTrigger(diff.old), addTrigger(diff.next)];
  }
  return [
    standardStatement(triggerDefToCreateOrReplace(diff.next.getTriggerDefStmt)),
  ];
}

function triggerDefToCreateOrReplace(getTriggerDefStmt: string): string {
  if (!getTriggerDefStmt.startsWith("CREATE ")) {
    throw new Error(`${getTriggerDefStmt} follows an unexpected structure`);
  }
  return getTriggerDefStmt.replace(/^CREATE /u, "CREATE OR REPLACE ");
}

function addView(view: View): InternalStatement {
  return standardStatement(
    `CREATE VIEW ${fqName(view.name)}${relOptionsClause(view.options)} AS\n${view.viewDefinition}`,
  );
}

function alterView(diff: {
  readonly old: View;
  readonly next: View;
}): readonly InternalStatement[] {
  if (deepEqual(diff.old, diff.next)) {
    return [];
  }
  if (!viewReplacementPreservesOutputColumns(diff.old, diff.next)) {
    throw new NotImplementedMigrationError(
      `changing the output columns of view ${fqName(diff.next.name)} is not supported`,
    );
  }
  return [
    standardStatement(
      `CREATE OR REPLACE VIEW ${fqName(diff.next.name)}${relOptionsClause(diff.next.options)} AS\n${diff.next.viewDefinition}`,
    ),
  ];
}

function viewReplacementPreservesOutputColumns(
  oldView: View,
  nextView: View,
): boolean {
  if (oldView.outputColumns.length > nextView.outputColumns.length) {
    return false;
  }
  return oldView.outputColumns.every((oldColumn, index) => {
    const nextColumn = nextView.outputColumns[index];
    return (
      nextColumn !== undefined &&
      oldColumn.name === nextColumn.name &&
      oldColumn.type === nextColumn.type
    );
  });
}

type ViewMaterializedViewAdd =
  | { readonly kind: "view"; readonly view: View }
  | { readonly kind: "materializedView"; readonly view: MaterializedView };

function orderViewMaterializedViewAdds(
  views: readonly View[],
  materializedViews: readonly MaterializedView[],
): readonly ViewMaterializedViewAdd[] {
  const graph = new DirectedGraph<{
    readonly id: string;
    readonly add: ViewMaterializedViewAdd;
  }>();
  const adds: readonly ViewMaterializedViewAdd[] = [
    ...views.map((view) => ({ kind: "view" as const, view })),
    ...materializedViews.map((view) => ({
      kind: "materializedView" as const,
      view,
    })),
  ];

  for (const add of adds) {
    graph.addVertex({ id: objectName(add.view), add });
  }

  for (const add of adds) {
    const dependentId = objectName(add.view);
    for (const dependency of add.view.tableDependencies) {
      const dependencyId = fqName(dependency.name);
      if (graph.hasVertex(dependencyId)) {
        graph.addEdge(dependencyId, dependentId);
      }
    }
  }

  return graph
    .topologicallySortWithPriority(
      (left, right) => viewAddPriority(left.add) < viewAddPriority(right.add),
    )
    .map((vertex) => vertex.add);
}

function viewAddPriority(add: ViewMaterializedViewAdd): number {
  return add.kind === "view" ? 1 : 0;
}

function deleteView(view: View): InternalStatement {
  return standardStatement(`DROP VIEW ${fqName(view.name)}`);
}

function addMaterializedView(view: MaterializedView): InternalStatement {
  const tablespace =
    view.tablespace.length === 0
      ? ""
      : ` TABLESPACE ${escapeIdentifier(view.tablespace)}`;
  return standardStatement(
    `CREATE MATERIALIZED VIEW ${fqName(view.name)}${relOptionsClause(view.options)}${tablespace} AS\n${view.viewDefinition}`,
  );
}

function deleteMaterializedView(view: MaterializedView): InternalStatement {
  return standardStatement(`DROP MATERIALIZED VIEW ${fqName(view.name)}`);
}

function assertMaterializedViewCanBeRecreated(
  view: MaterializedView,
  diff: SchemaDiff,
): void {
  const viewName = objectName(view);
  for (const dependent of [
    ...diff.next.views,
    ...diff.next.materializedViews,
  ]) {
    if (objectName(dependent) === viewName) {
      continue;
    }
    if (
      dependent.tableDependencies.some(
        (dependency) => fqName(dependency.name) === viewName,
      )
    ) {
      const dependentKind =
        dependent.kind === "view" ? "view" : "materialized view";
      throw new NotImplementedMigrationError(
        `recreating materialized view ${viewName} is not supported because it is referenced by ${dependentKind} ${objectName(dependent)}`,
      );
    }
  }
}

function relOptionsClause(options: Readonly<Record<string, string>>): string {
  const entries = Object.entries(options).map(
    ([key, value]) => `${key}=${value}`,
  );
  entries.sort((left, right) => left.localeCompare(right));
  return entries.length === 0 ? "" : ` WITH (${entries.join(", ")})`;
}

function standardStatement(sql: string): InternalStatement {
  return {
    sql,
    timeoutMs: statementTimeoutDefaultMs,
    lockTimeoutMs: lockTimeoutDefaultMs,
    hazards: [],
    skipValidation: false,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
