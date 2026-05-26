import { deepEqual } from "./equality.js";
import { diffLists, type ListDiff } from "./listDiff.js";
import { fqName } from "../schema/identifiers.js";
import { normalizeSchema } from "../schema/normalize.js";
import { objectName } from "../schema/objectName.js";
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
  Procedure,
  Schema,
  SchemaObject,
  Sequence,
  Table,
  TablePrivilege,
  Trigger,
  View,
} from "../schema/model.js";

export type NamedSchemaDiff = {
  readonly old: NamedSchema;
  readonly next: NamedSchema;
};

export type EnumDiff = {
  readonly old: Enum;
  readonly next: Enum;
};

export type ExtensionDiff = {
  readonly old: Extension;
  readonly next: Extension;
};

export type ColumnDiff = {
  readonly old: Column;
  readonly next: Column;
  readonly oldOrdering: number;
  readonly newOrdering: number;
};

export type CheckConstraintDiff = {
  readonly old: CheckConstraint;
  readonly next: CheckConstraint;
};

export type PolicyDiff = {
  readonly old: Policy;
  readonly next: Policy;
};

export type PrivilegeDiff = {
  readonly old: TablePrivilege;
  readonly next: TablePrivilege;
};

export type TableDiff = {
  readonly old: Table;
  readonly next: Table;
  readonly columnsDiff: ListDiff<Column, ColumnDiff>;
  readonly checkConstraintDiff: ListDiff<CheckConstraint, CheckConstraintDiff>;
  readonly policiesDiff: ListDiff<Policy, PolicyDiff>;
  readonly privilegesDiff: ListDiff<TablePrivilege, PrivilegeDiff>;
};

export type SchemaDiff = {
  readonly old: Schema;
  readonly next: Schema;
  readonly namedSchemaDiffs: ListDiff<NamedSchema, NamedSchemaDiff>;
  readonly extensionDiffs: ListDiff<Extension, ExtensionDiff>;
  readonly enumDiffs: ListDiff<Enum, EnumDiff>;
  readonly tableDiffs: ListDiff<Table, TableDiff>;
  readonly indexDiffs: ListDiff<Index, DiffPair<Index>>;
  readonly foreignKeyConstraintDiffs: ListDiff<ForeignKeyConstraint, DiffPair<ForeignKeyConstraint>>;
  readonly sequenceDiffs: ListDiff<Sequence, DiffPair<Sequence>>;
  readonly functionDiffs: ListDiff<FunctionSchema, DiffPair<FunctionSchema>>;
  readonly procedureDiffs: ListDiff<Procedure, DiffPair<Procedure>>;
  readonly triggerDiffs: ListDiff<Trigger, DiffPair<Trigger>>;
  readonly viewDiffs: ListDiff<View, DiffPair<View>>;
  readonly materializedViewDiffs: ListDiff<MaterializedView, DiffPair<MaterializedView>>;
};

export function buildSchemaDiff(oldSchema: Schema, newSchema: Schema): SchemaDiff {
  const oldNormalized = normalizeSchema(oldSchema);
  const newNormalized = normalizeSchema(newSchema);
  const newTablesByName = new Map(newNormalized.tables.map((table) => [objectName(table), table]));
  const tableDiffs = diffLists({
    oldObjects: oldNormalized.tables,
    newObjects: newNormalized.tables,
    getName: objectName,
    buildDiff: buildTableDiff,
  });

  return {
    old: oldNormalized,
    next: newNormalized,
    namedSchemaDiffs: diffLists({
      oldObjects: oldNormalized.namedSchemas,
      newObjects: newNormalized.namedSchemas,
      getName: objectName,
      buildDiff: (oldObject, newObject) => ({
        diff: { old: oldObject, next: newObject },
        requiresRecreation: false,
      }),
    }),
    extensionDiffs: diffLists({
      oldObjects: oldNormalized.extensions,
      newObjects: newNormalized.extensions,
      getName: objectName,
      buildDiff: (oldObject, newObject) => ({
        diff: { old: oldObject, next: newObject },
        requiresRecreation: false,
      }),
    }),
    enumDiffs: diffLists({
      oldObjects: oldNormalized.enums,
      newObjects: newNormalized.enums,
      getName: objectName,
      buildDiff: (oldObject, newObject) => ({
        diff: { old: oldObject, next: newObject },
        requiresRecreation: !isSubsequence(oldObject.labels, newObject.labels),
      }),
    }),
    tableDiffs,
    indexDiffs: diffLists({
      oldObjects: oldNormalized.indexes,
      newObjects: newNormalized.indexes,
      getName: objectName,
      buildDiff: (oldObject, newObject) => buildIndexDiff(oldObject, newObject, newTablesByName),
    }),
    foreignKeyConstraintDiffs: diffLists({
      oldObjects: oldNormalized.foreignKeyConstraints,
      newObjects: newNormalized.foreignKeyConstraints,
      getName: objectName,
      buildDiff: (oldObject, newObject) => {
        const oldValidAsNew = { ...oldObject, isValid: newObject.isValid, constraintDef: stripNotValid(oldObject.constraintDef) };
        const newComparable = { ...newObject, constraintDef: stripNotValid(newObject.constraintDef) };
        return {
          diff: { old: oldObject, next: newObject },
          requiresRecreation: !deepEqual(oldValidAsNew, newComparable),
        };
      },
    }),
    sequenceDiffs: diffLists({
      oldObjects: oldNormalized.sequences,
      newObjects: newNormalized.sequences,
      getName: objectName,
      buildDiff: (oldObject, newObject) => ({
        diff: { old: oldObject, next: newObject },
        requiresRecreation: false,
      }),
    }),
    functionDiffs: diffObjectList(oldNormalized.functions, newNormalized.functions),
    procedureDiffs: diffObjectList(oldNormalized.procedures, newNormalized.procedures),
    triggerDiffs: diffTriggerList(oldNormalized.triggers, newNormalized.triggers),
    viewDiffs: diffTableDependentObjectList(oldNormalized.views, newNormalized.views, tableDiffs),
    materializedViewDiffs: diffTableDependentObjectList(
      oldNormalized.materializedViews,
      newNormalized.materializedViews,
      tableDiffs,
    ),
  };
}

function buildIndexDiff(
  oldIndex: Index,
  newIndex: Index,
  newTablesByName: ReadonlyMap<string, Table>,
): { readonly diff: DiffPair<Index>; readonly requiresRecreation: boolean } {
  let comparableOld = oldIndex;

  if (!indexIsOnPartitionedTable(newIndex, newTablesByName) && oldIndex.constraint === null && newIndex.constraint !== null) {
    comparableOld = { ...comparableOld, constraint: newIndex.constraint };
  }

  if (oldIndex.parentIdx === null && newIndex.parentIdx !== null) {
    comparableOld = { ...comparableOld, parentIdx: newIndex.parentIdx };
  }

  if (
    oldIndex.parentIdx === null &&
    newIndex.parentIdx !== null &&
    oldIndex.constraint !== null &&
    newIndex.constraint !== null &&
    constraintsEqualIgnoringLocality(oldIndex.constraint, newIndex.constraint)
  ) {
    comparableOld = { ...comparableOld, constraint: newIndex.constraint };
  }

  if (indexIsOnPartitionedTable(newIndex, newTablesByName) && oldIndex.isInvalid && !newIndex.isInvalid) {
    comparableOld = { ...comparableOld, isInvalid: newIndex.isInvalid };
  }

  return {
    diff: { old: oldIndex, next: newIndex },
    requiresRecreation: !deepEqual(comparableOld, newIndex),
  };
}

function indexIsOnPartitionedTable(index: Index, newTablesByName: ReadonlyMap<string, Table>): boolean {
  if (index.owningRelKind === "m") {
    return false;
  }
  const table = newTablesByName.get(fqName(index.owningRelName));
  return table !== undefined && table.partitionKeyDef.length > 0;
}

function constraintsEqualIgnoringLocality(
  left: NonNullable<Index["constraint"]>,
  right: NonNullable<Index["constraint"]>,
): boolean {
  return left.type === right.type &&
    left.escapedConstraintName === right.escapedConstraintName &&
    left.constraintDef === right.constraintDef;
}

function isSubsequence(values: readonly string[], container: readonly string[]): boolean {
  let index = 0;
  for (const value of container) {
    if (values[index] === value) {
      index += 1;
    }
  }
  return index === values.length;
}

type DiffPair<T> = {
  readonly old: T;
  readonly next: T;
};

function diffObjectList<TObject extends SchemaObject>(
  oldObjects: readonly TObject[],
  newObjects: readonly TObject[],
): ListDiff<TObject, DiffPair<TObject>> {
  const diff = diffLists({
    oldObjects,
    newObjects,
    getName: objectName,
    buildDiff: (oldObject, newObject) => ({
      diff: { old: oldObject, next: newObject },
      requiresRecreation: !deepEqual(oldObject, newObject),
    }),
  });
  return {
    ...diff,
    alters: diff.alters.filter((pair) => !deepEqual(pair.old, pair.next)),
  };
}

function diffTriggerList(
  oldObjects: readonly Trigger[],
  newObjects: readonly Trigger[],
): ListDiff<Trigger, DiffPair<Trigger>> {
  const diff = diffLists({
    oldObjects,
    newObjects,
    getName: objectName,
    buildDiff: (oldObject, newObject) => {
      const changed = !deepEqual(oldObject, newObject);
      return {
        diff: { old: oldObject, next: newObject },
        requiresRecreation: changed && (oldObject.isConstraint || newObject.isConstraint),
      };
    },
  });
  return {
    ...diff,
    alters: diff.alters.filter((pair) => !deepEqual(pair.old, pair.next)),
  };
}

type TableDependentSchemaObject = View | MaterializedView;

function diffTableDependentObjectList<TObject extends TableDependentSchemaObject>(
  oldObjects: readonly TObject[],
  newObjects: readonly TObject[],
  tableDiffs: ListDiff<Table, TableDiff>,
): ListDiff<TObject, DiffPair<TObject>> {
  const diff = diffLists({
    oldObjects,
    newObjects,
    getName: objectName,
    buildDiff: (oldObject, newObject) => ({
      diff: { old: oldObject, next: newObject },
      requiresRecreation: !deepEqual(oldObject, newObject) || hasDeletedTableDependency(oldObject, tableDiffs),
    }),
  });
  return {
    ...diff,
    alters: diff.alters.filter((pair) => !deepEqual(pair.old, pair.next)),
  };
}

function hasDeletedTableDependency(object: TableDependentSchemaObject, tableDiffs: ListDiff<Table, TableDiff>): boolean {
  const deletedTablesByName = new Set(tableDiffs.deletes.map(objectName));
  const tableAltersByOldName = new Map(tableDiffs.alters.map((tableDiff) => [objectName(tableDiff.old), tableDiff]));

  for (const dependency of object.tableDependencies) {
    const tableName = fqName(dependency.name);
    if (deletedTablesByName.has(tableName)) {
      return true;
    }

    const tableDiff = tableAltersByOldName.get(tableName);
    if (tableDiff === undefined) {
      continue;
    }

    const deletedColumns = new Set(tableDiff.columnsDiff.deletes.map((column) => column.name));
    if (dependency.columns.some((column) => deletedColumns.has(column))) {
      return true;
    }
  }

  return false;
}

function buildTableDiff(oldTable: Table, newTable: Table): { readonly diff: TableDiff; readonly requiresRecreation: boolean } {
  const requiresRecreation =
    tableIsPartitioned(oldTable) !== tableIsPartitioned(newTable) ||
    oldTable.partitionKeyDef !== newTable.partitionKeyDef ||
    !deepEqual(oldTable.parentTable, newTable.parentTable);

  return {
    requiresRecreation,
    diff: {
      old: oldTable,
      next: newTable,
      columnsDiff: diffLists({
        oldObjects: oldTable.columns,
        newObjects: newTable.columns,
        getName: objectName,
        buildDiff: (oldColumn, newColumn, oldOrdering, newOrdering) => ({
          diff: { old: oldColumn, next: newColumn, oldOrdering, newOrdering },
          requiresRecreation: false,
        }),
      }),
      checkConstraintDiff: diffLists({
        oldObjects: oldTable.checkConstraints,
        newObjects: newTable.checkConstraints,
        getName: objectName,
        buildDiff: (oldConstraint, newConstraint) => ({
          diff: { old: oldConstraint, next: newConstraint },
          requiresRecreation:
            oldConstraint.expression !== newConstraint.expression ||
            oldConstraint.isInheritable !== newConstraint.isInheritable ||
            (oldConstraint.isValid && !newConstraint.isValid),
        }),
      }),
      policiesDiff: diffLists({
        oldObjects: oldTable.policies,
        newObjects: newTable.policies,
        getName: objectName,
        buildDiff: (oldPolicy, newPolicy) => ({
          diff: { old: oldPolicy, next: newPolicy },
          requiresRecreation: !policyCanBeAltered(oldPolicy, newPolicy),
        }),
      }),
      privilegesDiff: diffLists({
        oldObjects: oldTable.privileges,
        newObjects: newTable.privileges,
        getName: objectName,
        buildDiff: (oldPrivilege, newPrivilege) => ({
          diff: { old: oldPrivilege, next: newPrivilege },
          requiresRecreation: oldPrivilege.isGrantable !== newPrivilege.isGrantable,
        }),
      }),
    },
  };
}

function policyCanBeAltered(oldPolicy: Policy, newPolicy: Policy): boolean {
  let comparableOld = oldPolicy;
  if (!deepEqual(comparableOld.appliesTo, newPolicy.appliesTo)) {
    comparableOld = { ...comparableOld, appliesTo: newPolicy.appliesTo };
  }
  if (comparableOld.usingExpression !== newPolicy.usingExpression && newPolicy.usingExpression.length > 0) {
    comparableOld = { ...comparableOld, usingExpression: newPolicy.usingExpression };
  }
  if (comparableOld.checkExpression !== newPolicy.checkExpression && newPolicy.checkExpression.length > 0) {
    comparableOld = { ...comparableOld, checkExpression: newPolicy.checkExpression };
  }
  comparableOld = { ...comparableOld, columns: newPolicy.columns };
  return deepEqual(comparableOld, newPolicy);
}

function tableIsPartitioned(table: Table): boolean {
  return table.partitionKeyDef.length > 0;
}

function stripNotValid(value: string): string {
  return value.endsWith(" NOT VALID") ? value.slice(0, -" NOT VALID".length) : value;
}
