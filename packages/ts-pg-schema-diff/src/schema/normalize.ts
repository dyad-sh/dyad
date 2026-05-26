import { objectName } from "./objectName.js";
import type {
  CheckConstraint,
  FunctionSchema,
  MaterializedView,
  Policy,
  Schema,
  SchemaObject,
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
    materializedViews: sortByName(schema.materializedViews).map(normalizeMaterializedView),
  };
}

export function sortByName<T extends SchemaObject>(values: readonly T[]): readonly T[] {
  return [...values].sort((a, b) => objectName(a).localeCompare(objectName(b)));
}

function normalizeTable(table: Table): Table {
  return {
    ...table,
    checkConstraints: sortByName(table.checkConstraints).map(normalizeCheckConstraint),
    policies: sortByName(table.policies).map(normalizePolicy),
    privileges: sortByName(table.privileges),
  };
}

function normalizeCheckConstraint(checkConstraint: CheckConstraint): CheckConstraint {
  return {
    ...checkConstraint,
    keyColumns: sortedStrings(checkConstraint.keyColumns),
    dependsOnFunctions: sortByName(checkConstraint.dependsOnFunctions.map((name) => ({ kind: "function" as const, name, functionDef: "", language: "", dependsOnFunctions: [] }))).map(
      (fn) => fn.name,
    ),
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
    dependsOnFunctions: sortByName(fn.dependsOnFunctions.map((name) => ({ kind: "function" as const, name, functionDef: "", language: "", dependsOnFunctions: [] }))).map(
      (dep) => dep.name,
    ),
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

function normalizeTableDependencies(dependencies: readonly TableDependency[]): readonly TableDependency[] {
  return [...dependencies]
    .map((dependency) => ({ ...dependency, columns: sortedStrings(dependency.columns) }))
    .sort((a, b) => {
      const aName = `${a.name.schemaName}.${a.name.escapedName}`;
      const bName = `${b.name.schemaName}.${b.name.escapedName}`;
      return aName.localeCompare(bName);
    });
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sortRecord(record: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const entries = Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}
