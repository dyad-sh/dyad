/**
 * The structured query plan, and the validator that stands between the model
 * and a customer's database.
 *
 * The model never writes SQL. It emits one of these, and this file decides
 * whether it is allowed to become a query. That inversion is the whole
 * security design: a plan can only express things this type can represent, so
 * there is no syntax in which "DROP TABLE" can be written in the first place.
 * Validation is then about whether the named things exist and the shape is
 * sane, not about spotting dangerous strings.
 *
 * Everything here is pure and free of both the database driver and Electron,
 * so the rules can be tested exhaustively without a connection.
 */

/** A table the catalogue knows about, as far as validation is concerned. */
export type KnownColumn = {
  columnName: string;
  dataType: string;
};

export type KnownTable = {
  schemaName: string;
  tableName: string;
  columns: KnownColumn[];
};

export type KnownRelationship = {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
};

/** The catalogue a plan is checked against: what we discovered, nothing more. */
export type SchemaCatalogue = {
  tables: KnownTable[];
  relationships: KnownRelationship[];
};

export const COMPARISON_OPERATORS = [
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "like",
  "ilike",
  "in",
  "is_null",
  "is_not_null",
] as const;

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export const AGGREGATE_FUNCTIONS = [
  "count",
  "count_distinct",
  "sum",
  "avg",
  "min",
  "max",
] as const;

export type AggregateFunction = (typeof AGGREGATE_FUNCTIONS)[number];

export type Filter = {
  column: string;
  operator: ComparisonOperator;
  /** Absent for is_null and is_not_null; an array for `in`. */
  value?: string | number | boolean | null | Array<string | number | boolean>;
};

export type Join = {
  table: string;
  schema?: string;
  type: "inner" | "left";
  on: { left: string; right: string };
};

export type Aggregate = {
  fn: AggregateFunction;
  /** Omitted only for count, which may count rows rather than a column. */
  column?: string;
  alias: string;
};

export type QueryPlan = {
  schema?: string;
  table: string;
  select?: string[];
  filters?: Filter[];
  joins?: Join[];
  aggregates?: Aggregate[];
  groupBy?: string[];
  orderBy?: { column: string; direction: "asc" | "desc" };
  limit?: number;
  offset?: number;
};

/**
 * Ceiling on returned rows.
 *
 * A model that asks for a million rows is not malicious, it is careless, and
 * the cost of that carelessness is paid by the user's database and by the
 * context window. Plans above the ceiling are clamped rather than rejected:
 * the request was reasonable, the number was not.
 */
export const MAX_ROW_LIMIT = 1000;
export const DEFAULT_ROW_LIMIT = 100;

/** Joins beyond this stop being a query and start being an outage. */
export const MAX_JOINS = 4;
export const MAX_FILTERS = 20;
export const MAX_IN_VALUES = 200;

export type ValidationError = {
  /** Machine-readable so callers can react; human text for the user. */
  code:
    | "unknown_table"
    | "unknown_column"
    | "unknown_operator"
    | "invalid_join"
    | "invalid_filter"
    | "invalid_aggregate"
    | "invalid_group_by"
    | "too_complex"
    | "malformed";
  message: string;
};

export type ValidationResult =
  | { ok: true; plan: Required<Pick<QueryPlan, "limit">> & QueryPlan }
  | { ok: false; errors: ValidationError[] };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Splits an optionally qualified reference into its parts. */
function parseColumnRef(reference: string): {
  table?: string;
  column: string;
} | null {
  const parts = reference.split(".");
  if (parts.length === 1) {
    return IDENTIFIER.test(parts[0]!) ? { column: parts[0]! } : null;
  }
  if (parts.length === 2) {
    return IDENTIFIER.test(parts[0]!) && IDENTIFIER.test(parts[1]!)
      ? { table: parts[0]!, column: parts[1]! }
      : null;
  }
  return null;
}

function findTable(
  catalogue: SchemaCatalogue,
  tableName: string,
  schemaName?: string,
): KnownTable | undefined {
  return catalogue.tables.find(
    (table) =>
      table.tableName === tableName &&
      (schemaName === undefined || table.schemaName === schemaName),
  );
}

function hasColumn(table: KnownTable, columnName: string): boolean {
  return table.columns.some((column) => column.columnName === columnName);
}

/**
 * Checks a plan against the discovered schema.
 *
 * Returns every problem rather than the first, so a model correcting its plan
 * gets one round trip instead of several.
 */
export function validateQueryPlan(
  plan: QueryPlan,
  catalogue: SchemaCatalogue,
): ValidationResult {
  const errors: ValidationError[] = [];
  const fail = (code: ValidationError["code"], message: string) =>
    errors.push({ code, message });

  if (!plan || typeof plan !== "object" || typeof plan.table !== "string") {
    return {
      ok: false,
      errors: [{ code: "malformed", message: "The query plan has no table." }],
    };
  }
  if (!IDENTIFIER.test(plan.table)) {
    return {
      ok: false,
      errors: [
        {
          code: "malformed",
          message: `"${plan.table}" is not a valid table name.`,
        },
      ],
    };
  }

  const base = findTable(catalogue, plan.table, plan.schema);
  if (!base) {
    return {
      ok: false,
      errors: [
        {
          code: "unknown_table",
          message: `There is no table called "${plan.table}" in this data source.`,
        },
      ],
    };
  }

  // Tables a column reference is allowed to name: the base plus each join.
  const inScope = new Map<string, KnownTable>([[base.tableName, base]]);

  if (plan.joins) {
    if (plan.joins.length > MAX_JOINS) {
      fail(
        "too_complex",
        `A query may join at most ${MAX_JOINS} tables; this plan joins ${plan.joins.length}.`,
      );
    }
    for (const join of plan.joins.slice(0, MAX_JOINS)) {
      const joined = findTable(catalogue, join.table, join.schema);
      if (!joined) {
        fail(
          "unknown_table",
          `There is no table called "${join.table}" to join to.`,
        );
        continue;
      }
      if (join.type !== "inner" && join.type !== "left") {
        fail("invalid_join", `"${join.type}" is not a supported join type.`);
      }
      inScope.set(joined.tableName, joined);

      const left = parseColumnRef(join.on?.left ?? "");
      const right = parseColumnRef(join.on?.right ?? "");
      if (!left || !right) {
        fail(
          "invalid_join",
          `The join onto "${join.table}" does not name both sides.`,
        );
        continue;
      }

      // Both sides must resolve, and the join must correspond to a
      // relationship we actually discovered. Joining on arbitrary equal-looking
      // columns produces answers that are wrong rather than empty, which is
      // the worse failure.
      const leftTable = left.table ? inScope.get(left.table) : base;
      const rightTable = right.table ? inScope.get(right.table) : joined;
      if (!leftTable || !hasColumn(leftTable, left.column)) {
        fail("invalid_join", `"${join.on.left}" is not a column we know.`);
        continue;
      }
      if (!rightTable || !hasColumn(rightTable, right.column)) {
        fail("invalid_join", `"${join.on.right}" is not a column we know.`);
        continue;
      }

      const known = catalogue.relationships.some((relationship) => {
        const forward =
          relationship.sourceTable === leftTable.tableName &&
          relationship.sourceColumn === left.column &&
          relationship.targetTable === rightTable.tableName &&
          relationship.targetColumn === right.column;
        const backward =
          relationship.sourceTable === rightTable.tableName &&
          relationship.sourceColumn === right.column &&
          relationship.targetTable === leftTable.tableName &&
          relationship.targetColumn === left.column;
        return forward || backward;
      });
      if (!known) {
        fail(
          "invalid_join",
          `No foreign key connects ${leftTable.tableName}.${left.column} to ${rightTable.tableName}.${right.column}.`,
        );
      }
    }
  }

  const resolve = (reference: string): boolean => {
    const parsed = parseColumnRef(reference);
    if (!parsed) return false;
    const table = parsed.table ? inScope.get(parsed.table) : base;
    return Boolean(table && hasColumn(table, parsed.column));
  };

  for (const column of plan.select ?? []) {
    // "*" is deliberately not accepted: naming columns is what keeps a result
    // small enough to reason about and stops unknown columns arriving later.
    if (!resolve(column)) {
      fail("unknown_column", `There is no column "${column}" to select.`);
    }
  }

  if (plan.filters) {
    if (plan.filters.length > MAX_FILTERS) {
      fail("too_complex", `A query may have at most ${MAX_FILTERS} filters.`);
    }
    for (const filter of plan.filters) {
      if (!COMPARISON_OPERATORS.includes(filter.operator)) {
        fail(
          "unknown_operator",
          `"${filter.operator}" is not an allowed operator.`,
        );
        continue;
      }
      if (!resolve(filter.column)) {
        fail(
          "unknown_column",
          `There is no column "${filter.column}" to filter on.`,
        );
        continue;
      }
      const needsValue =
        filter.operator !== "is_null" && filter.operator !== "is_not_null";
      if (needsValue && filter.value === undefined) {
        fail(
          "invalid_filter",
          `The filter on "${filter.column}" needs a value.`,
        );
      }
      if (filter.operator === "in") {
        if (!Array.isArray(filter.value)) {
          fail("invalid_filter", `An "in" filter needs a list of values.`);
        } else if (filter.value.length > MAX_IN_VALUES) {
          fail(
            "too_complex",
            `An "in" filter may list at most ${MAX_IN_VALUES} values.`,
          );
        }
      }
    }
  }

  for (const aggregate of plan.aggregates ?? []) {
    if (!AGGREGATE_FUNCTIONS.includes(aggregate.fn)) {
      fail(
        "invalid_aggregate",
        `"${aggregate.fn}" is not a supported function.`,
      );
      continue;
    }
    if (!IDENTIFIER.test(aggregate.alias ?? "")) {
      fail("invalid_aggregate", `"${aggregate.alias}" is not a valid alias.`);
    }
    // Only count may omit a column, because only count means anything without
    // one.
    if (aggregate.column === undefined) {
      if (aggregate.fn !== "count") {
        fail("invalid_aggregate", `${aggregate.fn} needs a column.`);
      }
      continue;
    }
    if (!resolve(aggregate.column)) {
      fail(
        "unknown_column",
        `There is no column "${aggregate.column}" to aggregate.`,
      );
    }
  }

  for (const column of plan.groupBy ?? []) {
    if (!resolve(column)) {
      fail("unknown_column", `There is no column "${column}" to group by.`);
    }
  }

  if (plan.orderBy) {
    if (plan.orderBy.direction !== "asc" && plan.orderBy.direction !== "desc") {
      fail("malformed", `"${plan.orderBy.direction}" is not a sort direction.`);
    }
    // Ordering by an aggregate alias is legitimate, so accept a name the plan
    // itself defines as well as a real column.
    const aliases = new Set((plan.aggregates ?? []).map((each) => each.alias));
    if (!aliases.has(plan.orderBy.column) && !resolve(plan.orderBy.column)) {
      fail(
        "unknown_column",
        `There is no column "${plan.orderBy.column}" to sort by.`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    plan: {
      ...plan,
      // Clamped rather than refused: an oversized limit is a careless number,
      // not a bad request.
      limit: Math.min(
        MAX_ROW_LIMIT,
        Math.max(1, Math.floor(plan.limit ?? DEFAULT_ROW_LIMIT)),
      ),
      offset: Math.max(0, Math.floor(plan.offset ?? 0)),
    },
  };
}

/** Every table a validated plan touches, for the audit log. */
export function tablesTouched(plan: QueryPlan): string[] {
  const names = [
    `${plan.schema ?? "public"}.${plan.table}`,
    ...(plan.joins ?? []).map(
      (join) => `${join.schema ?? plan.schema ?? "public"}.${join.table}`,
    ),
  ];
  return [...new Set(names)];
}
