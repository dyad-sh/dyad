import { describe, expect, it } from "vitest";
import { buildPoolConfig } from "../src/db/connect.js";
import { assertSupportedPostgresVersion } from "../src/db/introspect.js";
import { diffLists } from "../src/diff/listDiff.js";
import { DuplicateIdentifierError } from "../src/errors.js";
import { toPublicStatement } from "../src/plan/classify.js";
import { generatePlan, toSchemaDiffResult } from "../src/plan/generate.js";
import type { InternalStatement, MigrationHazard } from "../src/plan/types.js";
import { randomPostgresIdentifierToken } from "../src/schema/randomIdentifier.js";
import {
  escapeIdentifier,
  procName,
  schemaQualifiedName,
} from "../src/schema/identifiers.js";
import {
  emptySchema,
  type Column,
  type ForeignKeyConstraint,
  type FunctionSchema,
  type Index,
  type MaterializedView,
  type Procedure,
  type Schema,
  type Sequence,
  type Table,
  type Trigger,
  type View,
} from "../src/schema/model.js";

describe("identifier escaping", () => {
  it("always quotes and escapes embedded quotes", () => {
    expect(escapeIdentifier("simple")).toBe('"simple"');
    expect(escapeIdentifier('a"b')).toBe('"a""b"');
  });
});

describe("diffLists", () => {
  it("returns adds, alters, and name-sorted deletes", () => {
    const diff = diffLists({
      oldObjects: ["z", "a", "b"],
      newObjects: ["b", "c"],
      getName: (value) => value,
      buildDiff: (oldValue, newValue) => ({
        diff: `${oldValue}:${newValue}`,
        requiresRecreation: false,
      }),
    });

    expect(diff).toEqual({
      adds: ["c"],
      alters: ["b:b"],
      deletes: ["a", "z"],
    });
  });

  it("throws on duplicate new object names", () => {
    expect(() =>
      diffLists({
        oldObjects: [],
        newObjects: ["duplicate", "duplicate"],
        getName: (value) => value,
        buildDiff: (oldValue, newValue) => ({
          diff: `${oldValue}:${newValue}`,
          requiresRecreation: false,
        }),
      }),
    ).toThrow(DuplicateIdentifierError);
  });
});

describe("generatePlan", () => {
  it("generates a public additive statement for a simple table add", () => {
    const current = emptySchema();
    const desired: Schema = {
      ...emptySchema(),
      tables: [table("users", [column("id", "integer", false)])],
    };

    const result = toSchemaDiffResult(generatePlan(current, desired));

    expect(result).toEqual({
      statements: [
        {
          sql: 'CREATE TABLE "public"."users" (\n\t"id" integer NOT NULL\n)',
          type: "additive",
        },
      ],
    });
  });

  it("generates statements for enum label additions and index drops", () => {
    const current: Schema = {
      ...emptySchema(),
      enums: [
        {
          kind: "enum",
          name: schemaQualifiedName("public", "mood"),
          labels: ["sad"],
        },
      ],
      indexes: [index("users_name_idx")],
    };
    const desired: Schema = {
      ...emptySchema(),
      enums: [
        {
          kind: "enum",
          name: schemaQualifiedName("public", "mood"),
          labels: ["sad", "ok"],
        },
      ],
    };

    const result = toSchemaDiffResult(generatePlan(current, desired));

    expect(result.statements).toEqual([
      {
        sql: 'ALTER TYPE "public"."mood" ADD VALUE \'ok\'',
        type: "additive",
      },
      {
        sql: 'DROP INDEX CONCURRENTLY "public"."users_name_idx"',
        type: "destructive",
      },
    ]);
  });

  it("renames a replaced index before creating the new index and dropping the old one", () => {
    const current: Schema = {
      ...emptySchema(),
      indexes: [
        index(
          "users_name_idx",
          "CREATE INDEX users_name_idx ON public.users USING btree (name)",
        ),
      ],
    };
    const desired: Schema = {
      ...emptySchema(),
      indexes: [
        index(
          "users_name_idx",
          "CREATE INDEX users_name_idx ON public.users USING btree (name, id)",
        ),
      ],
    };

    const result = toSchemaDiffResult(generatePlan(current, desired));
    expect(result.statements.map((statement) => statement.sql)).toEqual([
      expect.stringMatching(
        /^ALTER INDEX "public"\."users_name_idx" RENAME TO "pgschemadiff_tmpidx_users_name_idx_[0-9a-f]{16}"$/u,
      ),
      "CREATE INDEX CONCURRENTLY users_name_idx ON public.users USING btree (name, id)",
      expect.stringMatching(
        /^DROP INDEX CONCURRENTLY "public"\."pgschemadiff_tmpidx_users_name_idx_[0-9a-f]{16}"$/u,
      ),
    ]);
  });

  it("can disable concurrent index operations", () => {
    const current: Schema = {
      ...emptySchema(),
      indexes: [index("old_idx")],
    };
    const desired: Schema = {
      ...emptySchema(),
      indexes: [index("new_idx")],
    };

    const result = toSchemaDiffResult(
      generatePlan(current, desired, { noConcurrentIndexOperations: true }),
    );

    expect(result.statements.map((statement) => statement.sql)).toEqual([
      'DROP INDEX "public"."old_idx"',
      "CREATE INDEX new_idx ON public.users USING btree (name)",
    ]);
  });

  it("alters ordinary triggers with CREATE OR REPLACE", () => {
    const current: Schema = {
      ...emptySchema(),
      triggers: [
        trigger(
          "account_touch",
          "CREATE TRIGGER account_touch BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION touch_account()",
        ),
      ],
    };
    const desired: Schema = {
      ...emptySchema(),
      triggers: [
        trigger(
          "account_touch",
          "CREATE TRIGGER account_touch BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION touch_account()",
        ),
      ],
    };

    const result = toSchemaDiffResult(generatePlan(current, desired));

    expect(result.statements.map((statement) => statement.sql)).toEqual([
      "CREATE OR REPLACE TRIGGER account_touch BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION touch_account()",
    ]);
  });

  it("recreates changed constraint triggers", () => {
    const current: Schema = {
      ...emptySchema(),
      triggers: [
        trigger(
          "account_touch",
          "CREATE CONSTRAINT TRIGGER account_touch AFTER INSERT ON public.accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION touch_account()",
          true,
        ),
      ],
    };
    const desired: Schema = {
      ...emptySchema(),
      triggers: [
        trigger(
          "account_touch",
          "CREATE CONSTRAINT TRIGGER account_touch AFTER UPDATE ON public.accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION touch_account()",
          true,
        ),
      ],
    };

    const result = toSchemaDiffResult(generatePlan(current, desired));

    expect(result.statements.map((statement) => statement.sql)).toEqual([
      'DROP TRIGGER "account_touch" ON "public"."accounts"',
      "CREATE CONSTRAINT TRIGGER account_touch AFTER UPDATE ON public.accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION touch_account()",
    ]);
  });

  it("renders view and materialized view options in deterministic order", () => {
    const desired: Schema = {
      ...emptySchema(),
      views: [
        view("secure_accounts", {
          security_invoker: "true",
          security_barrier: "true",
        }),
      ],
      materializedViews: [
        materializedView("account_names", {
          log_autovacuum_min_duration: "1000",
          autovacuum_enabled: "false",
        }),
      ],
    };

    const result = toSchemaDiffResult(generatePlan(emptySchema(), desired));

    expect(result.statements.map((statement) => statement.sql)).toEqual([
      'CREATE VIEW "public"."secure_accounts" WITH (security_barrier=true, security_invoker=true) AS\n SELECT id\n   FROM accounts;',
      'CREATE MATERIALIZED VIEW "public"."account_names" WITH (autovacuum_enabled=false, log_autovacuum_min_duration=1000) AS\n SELECT name\n   FROM accounts;',
    ]);
  });

  it("alters views with CREATE OR REPLACE so dependents do not block the migration", () => {
    const base = view("account_summary");
    const dependent = view("account_summary_public");
    const changedBase: View = {
      ...base,
      viewDefinition: " SELECT id, name\n   FROM accounts;",
      outputColumns: [...base.outputColumns, { name: "name", type: "text" }],
    };

    const result = toSchemaDiffResult(
      generatePlan(
        {
          ...emptySchema(),
          views: [base, dependent],
        },
        {
          ...emptySchema(),
          views: [changedBase, dependent],
        },
      ),
    );

    expect(result.statements.map((statement) => statement.sql)).toEqual([
      'CREATE OR REPLACE VIEW "public"."account_summary" AS\n SELECT id, name\n   FROM accounts;',
    ]);
  });

  it("rejects view output shape changes before using CREATE OR REPLACE", () => {
    const base = view("account_summary", {}, [{ name: "id", type: "integer" }]);
    const changedBase: View = {
      ...base,
      viewDefinition: " SELECT name\n   FROM accounts;",
      outputColumns: [{ name: "name", type: "text" }],
    };

    expect(() =>
      generatePlan(
        {
          ...emptySchema(),
          views: [base],
        },
        {
          ...emptySchema(),
          views: [changedBase],
        },
      ),
    ).toThrow(
      'changing the output columns of view "public"."account_summary" is not supported',
    );
  });

  it("recreates unchanged indexes after materialized view rebuilds", () => {
    const currentView = materializedView("account_names");
    const desiredView: MaterializedView = {
      ...currentView,
      viewDefinition: " SELECT name, id\n   FROM accounts;",
    };
    const viewIndex = materializedViewIndex("account_names_name_idx");

    const result = toSchemaDiffResult(
      generatePlan(
        {
          ...emptySchema(),
          materializedViews: [currentView],
          indexes: [viewIndex],
        },
        {
          ...emptySchema(),
          materializedViews: [desiredView],
          indexes: [viewIndex],
        },
      ),
    );

    expect(result.statements.map((statement) => statement.sql)).toEqual([
      'DROP MATERIALIZED VIEW "public"."account_names"',
      'CREATE MATERIALIZED VIEW "public"."account_names" AS\n SELECT name, id\n   FROM accounts;',
      "CREATE INDEX CONCURRENTLY account_names_name_idx ON public.account_names USING btree (name)",
    ]);
  });

  it("classifies untrackable routine dependencies as destructive", () => {
    const desired: Schema = {
      ...emptySchema(),
      functions: [
        functionSchema("non_sql_func", "plpgsql"),
        functionSchema("sql_func", "sql"),
      ],
      procedures: [procedure("sync_accounts")],
    };

    const result = toSchemaDiffResult(generatePlan(emptySchema(), desired));

    expect(
      result.statements.map((statement) => ({
        sql: statement.sql,
        type: statement.type,
      })),
    ).toEqual([
      {
        sql: 'CREATE FUNCTION "public"."non_sql_func"() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$',
        type: "destructive",
      },
      {
        sql: 'CREATE FUNCTION "public"."sql_func"() RETURNS integer LANGUAGE sql RETURN 1',
        type: "additive",
      },
      {
        sql: 'CREATE PROCEDURE "public"."sync_accounts"() LANGUAGE plpgsql AS $$ BEGIN END; $$',
        type: "destructive",
      },
    ]);
  });

  it("orders function adds before dependents and deletes before dependencies", () => {
    const baseFunction = functionSchema("z_base", "sql");
    const dependentFunction = functionSchema(
      "a_depends",
      "sql",
      [baseFunction.name],
      'CREATE FUNCTION "public"."a_depends"() RETURNS integer LANGUAGE sql RETURN "public"."z_base"()',
    );

    const addResult = toSchemaDiffResult(
      generatePlan(emptySchema(), {
        ...emptySchema(),
        functions: [dependentFunction, baseFunction],
      }),
    );
    expect(addResult.statements.map((statement) => statement.sql)).toEqual([
      'CREATE FUNCTION "public"."z_base"() RETURNS integer LANGUAGE sql RETURN 1',
      'CREATE FUNCTION "public"."a_depends"() RETURNS integer LANGUAGE sql RETURN "public"."z_base"()',
    ]);

    const deleteResult = toSchemaDiffResult(
      generatePlan(
        {
          ...emptySchema(),
          functions: [baseFunction, dependentFunction],
        },
        emptySchema(),
      ),
    );
    expect(deleteResult.statements.map((statement) => statement.sql)).toEqual([
      'DROP FUNCTION "public"."a_depends"()',
      'DROP FUNCTION "public"."z_base"()',
    ]);
  });

  it("alters modified functions without dropping them afterward", () => {
    const currentFunction = functionSchema(
      "answer",
      "sql",
      [],
      'CREATE OR REPLACE FUNCTION "public"."answer"() RETURNS integer LANGUAGE sql RETURN 1',
    );
    const desiredFunction = functionSchema(
      "answer",
      "sql",
      [],
      'CREATE OR REPLACE FUNCTION "public"."answer"() RETURNS integer LANGUAGE sql RETURN 2',
    );

    const result = toSchemaDiffResult(
      generatePlan(
        {
          ...emptySchema(),
          functions: [currentFunction],
        },
        {
          ...emptySchema(),
          functions: [desiredFunction],
        },
      ),
    );

    expect(result.statements.map((statement) => statement.sql)).toEqual([
      desiredFunction.functionDef,
    ]);
  });

  it("rejects function return type changes before using CREATE OR REPLACE", () => {
    const currentFunction = functionSchema("answer", "sql");
    const desiredFunction = functionSchema(
      "answer",
      "sql",
      [],
      'CREATE OR REPLACE FUNCTION "public"."answer"() RETURNS text LANGUAGE sql RETURN \'1\'',
      "text",
    );

    expect(() =>
      generatePlan(
        {
          ...emptySchema(),
          functions: [currentFunction],
        },
        {
          ...emptySchema(),
          functions: [desiredFunction],
        },
      ),
    ).toThrow(
      'changing return type of function "public"."answer"() is not supported',
    );
  });

  it("preserves millisecond precision when converting bigint epochs to timestamp variants", () => {
    const current: Schema = {
      ...emptySchema(),
      tables: [table("events", [column("created_at", "bigint", false)])],
    };
    const desired: Schema = {
      ...emptySchema(),
      tables: [
        table("events", [
          column("created_at", "timestamp(3) with time zone", false),
        ]),
      ],
    };

    const result = toSchemaDiffResult(generatePlan(current, desired));

    expect(result.statements.map((statement) => statement.sql)).toContain(
      'ALTER TABLE "public"."events" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone using to_timestamp("created_at" / 1000.0)',
    );
  });

  it("rejects generated column changes that cannot be emitted as ALTER COLUMN SQL", () => {
    const currentColumn = column("full_name", "text", true);
    const generatedColumn: Column = {
      ...currentColumn,
      isGenerated: true,
      generationExpression: "lower(name)",
    };

    expect(() =>
      generatePlan(
        {
          ...emptySchema(),
          tables: [table("users", [currentColumn])],
        },
        {
          ...emptySchema(),
          tables: [table("users", [generatedColumn])],
        },
      ),
    ).toThrow("changing stored generated columns is not supported");
  });

  it("recreates valid foreign keys when the desired constraint is invalid", () => {
    const currentForeignKey = foreignKeyConstraint({
      constraintDef: 'FOREIGN KEY (user_id) REFERENCES "public"."users"(id)',
      isValid: true,
    });
    const desiredForeignKey = foreignKeyConstraint({
      constraintDef:
        'FOREIGN KEY (user_id) REFERENCES "public"."users"(id) NOT VALID',
      isValid: false,
    });

    const result = toSchemaDiffResult(
      generatePlan(
        {
          ...emptySchema(),
          foreignKeyConstraints: [currentForeignKey],
        },
        {
          ...emptySchema(),
          foreignKeyConstraints: [desiredForeignKey],
        },
      ),
    );

    expect(result.statements.map((statement) => statement.sql)).toEqual([
      'ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_user_id_fkey"',
      'ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY (user_id) REFERENCES "public"."users"(id) NOT VALID',
    ]);
  });

  it("ignores NOT VALID suffix casing and whitespace when comparing foreign keys", () => {
    const currentForeignKey = foreignKeyConstraint({
      constraintDef:
        'FOREIGN KEY (user_id) REFERENCES "public"."users"(id)   not valid',
      isValid: false,
    });
    const desiredForeignKey = foreignKeyConstraint({
      constraintDef:
        'FOREIGN KEY (user_id) REFERENCES "public"."users"(id) NOT VALID',
      isValid: false,
    });

    const result = toSchemaDiffResult(
      generatePlan(
        {
          ...emptySchema(),
          foreignKeyConstraints: [currentForeignKey],
        },
        {
          ...emptySchema(),
          foreignKeyConstraints: [desiredForeignKey],
        },
      ),
    );

    expect(result.statements).toEqual([]);
  });

  it("rejects dropping index partitions that back local constraints", () => {
    const childIndex: Index = {
      ...index("users_2024_name_key"),
      owningRelName: schemaQualifiedName("public", "users_2024"),
      parentIdx: schemaQualifiedName("public", "users_name_key"),
      constraint: {
        type: "u",
        escapedConstraintName: escapeIdentifier("users_2024_name_key"),
        constraintDef: "UNIQUE (name)",
        isLocal: true,
      },
    };

    expect(() =>
      generatePlan(
        {
          ...emptySchema(),
          indexes: [childIndex],
        },
        emptySchema(),
      ),
    ).toThrow(
      "dropping an index partition that backs a local constraint is not supported",
    );
  });

  it("rejects creating invalid indexes", () => {
    const invalidIndex: Index = {
      ...index("users_name_idx"),
      isInvalid: true,
    };

    expect(() =>
      generatePlan(emptySchema(), {
        ...emptySchema(),
        indexes: [invalidIndex],
      }),
    ).toThrow("can't create an invalid index");
  });

  it("classifies unowned sequence adds and drops as destructive", () => {
    const sequence = sequenceSchema("ticket_seq");

    const addResult = toSchemaDiffResult(
      generatePlan(emptySchema(), {
        ...emptySchema(),
        sequences: [sequence],
      }),
    );
    expect(addResult.statements).toEqual([
      {
        sql: 'CREATE SEQUENCE "public"."ticket_seq"\n\tAS bigint\n\tINCREMENT BY 1\n\tMINVALUE 1 MAXVALUE 9223372036854775807\n\tSTART WITH 1 CACHE 1 NO CYCLE',
        type: "destructive",
      },
    ]);

    const dropResult = toSchemaDiffResult(
      generatePlan(
        {
          ...emptySchema(),
          sequences: [sequence],
        },
        emptySchema(),
      ),
    );
    expect(dropResult.statements).toEqual([
      {
        sql: 'DROP SEQUENCE "public"."ticket_seq"',
        type: "destructive",
      },
    ]);
  });
});

describe("buildPoolConfig", () => {
  it("maps typed connection options to pg pool config", () => {
    expect(
      buildPoolConfig("postgres://user:pass@example.test/db", {
        maxConnections: 2,
        connectionTimeoutMs: 1_000,
        queryTimeoutMs: 2_000,
        statementTimeoutMs: 3_000,
        lockTimeoutMs: 4_000,
        ssl: true,
      }),
    ).toEqual({
      connectionString: "postgres://user:pass@example.test/db",
      max: 2,
      connectionTimeoutMillis: 1_000,
      query_timeout: 2_000,
      options: "-c statement_timeout=3000 -c lock_timeout=4000",
      ssl: true,
    });
  });
});

describe("randomPostgresIdentifierToken", () => {
  it("uses SQL-parser-friendly hex characters", () => {
    expect(randomPostgresIdentifierToken()).toMatch(/^[0-9a-f]{16}$/u);
  });
});

describe("assertSupportedPostgresVersion", () => {
  it("allows PostgreSQL 14 or newer", () => {
    expect(() => assertSupportedPostgresVersion(140_000)).not.toThrow();
    expect(() => assertSupportedPostgresVersion(170_006)).not.toThrow();
  });

  it("rejects PostgreSQL versions older than 14", () => {
    expect(() => assertSupportedPostgresVersion(130_012)).toThrow(
      "PostgreSQL server version 130012 is not supported",
    );
  });
});

describe("toPublicStatement", () => {
  it("classifies non-removal statements as additive", () => {
    expect(
      toPublicStatement(
        internalStatement(
          "CREATE INDEX CONCURRENTLY users_name_idx ON public.users (name)",
        ),
      ).type,
    ).toBe("additive");
    expect(
      toPublicStatement(
        internalStatement(
          'ALTER TABLE "public"."users" VALIDATE CONSTRAINT "users_name_check"',
        ),
      ).type,
    ).toBe("additive");
  });

  it("classifies destructive hazards and removal-shaped SQL as destructive", () => {
    expect(
      toPublicStatement(
        internalStatement("GRANT SELECT ON TABLE public.users TO app", [
          { type: "AUTHZ_UPDATE", message: "Grants table privileges." },
        ]),
      ).type,
    ).toBe("destructive");
    expect(
      toPublicStatement(
        internalStatement(
          'ALTER TABLE "public"."users" DROP COLUMN "old_name"',
        ),
      ).type,
    ).toBe("destructive");
    expect(
      toPublicStatement(
        internalStatement('DROP INDEX CONCURRENTLY "public"."users_name_idx"'),
      ).type,
    ).toBe("destructive");
  });
});

function table(name: string, columns: readonly Column[]): Table {
  return {
    kind: "table",
    name: schemaQualifiedName("public", name),
    columns,
    checkConstraints: [],
    policies: [],
    privileges: [],
    replicaIdentity: "d",
    rlsEnabled: false,
    rlsForced: false,
    partitionKeyDef: "",
    parentTable: null,
    forValues: "",
  };
}

function internalStatement(
  sql: string,
  hazards: readonly MigrationHazard[] = [],
): InternalStatement {
  return {
    sql,
    hazards,
    timeoutMs: 3_000,
    lockTimeoutMs: 3_000,
    skipValidation: false,
  };
}

function column(name: string, type: string, isNullable: boolean): Column {
  return {
    kind: "column",
    name,
    type,
    collation: null,
    default: "",
    isGenerated: false,
    generationExpression: "",
    isNullable,
    hasMissingValOptimization: false,
    size: 4,
    identity: null,
  };
}

function index(
  name: string,
  getIndexDefStmt = `CREATE INDEX ${name} ON public.users USING btree (name)`,
): Index {
  return {
    kind: "index",
    name,
    owningRelName: schemaQualifiedName("public", "users"),
    owningRelKind: "r",
    columns: ["name"],
    isInvalid: false,
    isUnique: false,
    constraint: null,
    getIndexDefStmt,
    parentIdx: null,
  };
}

function materializedViewIndex(name: string): Index {
  return {
    ...index(
      name,
      `CREATE INDEX ${name} ON public.account_names USING btree (name)`,
    ),
    owningRelName: schemaQualifiedName("public", "account_names"),
    owningRelKind: "m",
  };
}

function foreignKeyConstraint(options: {
  readonly constraintDef: string;
  readonly isValid: boolean;
}): ForeignKeyConstraint {
  return {
    kind: "foreignKeyConstraint",
    escapedName: escapeIdentifier("orders_user_id_fkey"),
    owningTable: schemaQualifiedName("public", "orders"),
    foreignTable: schemaQualifiedName("public", "users"),
    constraintDef: options.constraintDef,
    isValid: options.isValid,
  };
}

function trigger(
  name: string,
  getTriggerDefStmt: string,
  isConstraint = false,
): Trigger {
  return {
    kind: "trigger",
    escapedName: escapeIdentifier(name),
    owningTable: schemaQualifiedName("public", "accounts"),
    functionName: schemaQualifiedName("public", "touch_account"),
    getTriggerDefStmt,
    isConstraint,
  };
}

function view(
  name: string,
  options: Readonly<Record<string, string>> = {},
  outputColumns: View["outputColumns"] = [{ name: "id", type: "integer" }],
): View {
  return {
    kind: "view",
    name: schemaQualifiedName("public", name),
    viewDefinition: " SELECT id\n   FROM accounts;",
    outputColumns,
    options,
    tableDependencies: [],
  };
}

function materializedView(
  name: string,
  options: Readonly<Record<string, string>> = {},
): MaterializedView {
  return {
    kind: "materializedView",
    name: schemaQualifiedName("public", name),
    viewDefinition: " SELECT name\n   FROM accounts;",
    outputColumns: [{ name: "name", type: "text" }],
    options,
    tablespace: "",
    tableDependencies: [],
  };
}

function functionSchema(
  name: string,
  language: string,
  dependsOnFunctions: readonly FunctionSchema["name"][] = [],
  functionDef?: string,
  returnType = "integer",
): FunctionSchema {
  return {
    kind: "function",
    name: procName("public", name, ""),
    functionDef:
      functionDef ??
      (language === "sql"
        ? `CREATE FUNCTION "public"."${name}"() RETURNS integer LANGUAGE sql RETURN 1`
        : `CREATE FUNCTION "public"."${name}"() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$`),
    returnType,
    language,
    dependsOnFunctions,
  };
}

function procedure(name: string): Procedure {
  return {
    kind: "procedure",
    name: procName("public", name, ""),
    def: `CREATE PROCEDURE "public"."${name}"() LANGUAGE plpgsql AS $$ BEGIN END; $$`,
  };
}

function sequenceSchema(name: string): Sequence {
  return {
    kind: "sequence",
    name: schemaQualifiedName("public", name),
    owner: null,
    type: "bigint",
    startValue: 1n,
    increment: 1n,
    maxValue: 9_223_372_036_854_775_807n,
    minValue: 1n,
    cacheSize: 1n,
    cycle: false,
  };
}
