import {
  validateQueryPlan,
  type Filter,
  type SchemaCatalogue,
} from "./query_plan";

export type DataMutationAction = "insert" | "update" | "delete";

export type DataMutationPlan = {
  action: DataMutationAction;
  table: string;
  values?: Record<string, unknown>;
  filters?: Filter[];
};

export type ValidatedDataMutationPlan = {
  action: DataMutationAction;
  table: string;
  values: Record<string, unknown>;
  filters: Filter[];
};

export type MutationValidationResult =
  | { ok: true; plan: ValidatedDataMutationPlan }
  | { ok: false; errors: string[] };

/**
 * Validates a structured write request against the discovered catalogue.
 * Raw SQL is never accepted. Updates and deletes must identify a record by a
 * primary or unique key so an agent cannot accidentally modify an entire
 * table through a broad filter.
 */
export function validateDataMutationPlan(
  plan: DataMutationPlan,
  catalogue: SchemaCatalogue,
): MutationValidationResult {
  const errors: string[] = [];
  const filters = plan.filters ?? [];
  const values = plan.values ?? {};
  const queryValidation = validateQueryPlan(
    { table: plan.table, filters, limit: 1 },
    catalogue,
  );

  if (!queryValidation.ok) {
    errors.push(...queryValidation.errors.map((error) => error.message));
  }

  const table = catalogue.tables.find(
    (candidate) => candidate.tableName === plan.table,
  );
  const knownColumns = new Set(
    table?.columns.map((column) => column.columnName) ?? [],
  );

  if (plan.action === "insert" || plan.action === "update") {
    const fields = Object.keys(values);
    if (fields.length === 0) {
      errors.push(`${plan.action} requires at least one field value.`);
    }
    if (fields.length > 100) {
      errors.push("A single write may contain at most 100 fields.");
    }
    for (const field of fields) {
      if (!knownColumns.has(field)) {
        errors.push(`There is no column "${field}" to write.`);
      }
    }
  }

  if (plan.action === "insert" && filters.length > 0) {
    errors.push("Insert does not accept record filters.");
  }

  if (plan.action === "update" || plan.action === "delete") {
    const targeted = filters.some((filter) => {
      if (filter.operator !== "=") return false;
      const column = table?.columns.find(
        (candidate) => candidate.columnName === filter.column,
      );
      return Boolean(column?.primaryKey || column?.isUnique);
    });
    if (!targeted) {
      errors.push(
        `${plan.action} requires an equality filter on a discovered primary or unique key.`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return {
    ok: true,
    plan: { action: plan.action, table: plan.table, values, filters },
  };
}
