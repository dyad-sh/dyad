import { objectName } from "./objectName.js";
import type {
  CheckConstraint,
  FunctionSchema,
  MaterializedView,
  Policy,
  Schema,
  SchemaObject,
  SchemaQualifiedName,
  Table,
  TableDependency,
  View,
} from "./model.js";

export function normalizeSchema(schema: Schema): Schema {
  return {
    namedSchemas: sortByName(schema.namedSchemas),
    extensions: sortByName(schema.extensions),
    enums: sortByName(schema.enums),
    tables: sortByName(schema.tables).map(normalizeTable),
    indexes: sortByName(schema.indexes),
    foreignKeyConstraints: sortByName(schema.foreignKeyConstraints),
    sequences: sortByName(schema.sequences),
    functions: sortByName(schema.functions).map(normalizeFunction),
    procedures: sortByName(schema.procedures),
    triggers: sortByName(schema.triggers),
    views: sortByName(schema.views).map(normalizeView),
    materializedViews: sortByName(schema.materializedViews).map(
      normalizeMaterializedView,
    ),
  };
}

export function sortByName<T extends SchemaObject>(
  values: readonly T[],
): readonly T[] {
  return [...values].sort((a, b) =>
    compareStrings(objectName(a), objectName(b)),
  );
}

function normalizeTable(table: Table): Table {
  return {
    ...table,
    checkConstraints: sortByName(table.checkConstraints).map(
      normalizeCheckConstraint,
    ),
    policies: sortByName(table.policies).map(normalizePolicy),
    privileges: sortByName(table.privileges),
  };
}

function normalizeCheckConstraint(
  checkConstraint: CheckConstraint,
): CheckConstraint {
  return {
    ...checkConstraint,
    keyColumns: sortedStrings(checkConstraint.keyColumns),
    dependsOnFunctions: sortQualifiedNames(checkConstraint.dependsOnFunctions),
  };
}

function normalizePolicy(policy: Policy): Policy {
  return {
    ...policy,
    appliesTo: sortedStrings(policy.appliesTo),
    columns: sortedStrings(policy.columns),
  };
}

function normalizeFunction(fn: FunctionSchema): FunctionSchema {
  return {
    ...fn,
    dependsOnFunctions: sortQualifiedNames(fn.dependsOnFunctions),
  };
}

function normalizeView(view: View): View {
  return {
    ...view,
    options: sortRecord(view.options),
    tableDependencies: normalizeTableDependencies(view.tableDependencies),
  };
}

function normalizeMaterializedView(view: MaterializedView): MaterializedView {
  return {
    ...view,
    options: sortRecord(view.options),
    tableDependencies: normalizeTableDependencies(view.tableDependencies),
  };
}

function normalizeTableDependencies(
  dependencies: readonly TableDependency[],
): readonly TableDependency[] {
  return [...dependencies]
    .map((dependency) => ({
      ...dependency,
      columns: sortedStrings(dependency.columns),
    }))
    .sort((a, b) => {
      const aName = `${a.name.schemaName}.${a.name.escapedName}`;
      const bName = `${b.name.schemaName}.${b.name.escapedName}`;
      return compareStrings(aName, bName);
    });
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort(compareStrings);
}

function sortRecord(
  record: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const entries = Object.entries(record).sort(([a], [b]) =>
    compareStrings(a, b),
  );
  return Object.fromEntries(entries);
}

function sortQualifiedNames(
  names: readonly SchemaQualifiedName[],
): readonly SchemaQualifiedName[] {
  return [...names].sort((a, b) =>
    compareStrings(
      `${a.schemaName}.${a.escapedName}`,
      `${b.schemaName}.${b.escapedName}`,
    ),
  );
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
