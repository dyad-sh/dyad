import { buildSchemaDiff } from "../diff/schemaDiff.js";
import { generateStatements } from "../generators/schema.js";
import type { Schema } from "../schema/model.js";
import { schemaHash } from "../schema/hash.js";
import { toPublicStatement } from "./classify.js";
import type { InternalStatement, SchemaDiffResult } from "./types.js";

export type GeneratePlanOptions = {
  readonly noConcurrentIndexOperations?: boolean;
  /** Allow valid live states that are unsafe for ordinary migration plans. */
  readonly schemaRendering?: boolean;
};

export type InternalPlan = {
  readonly statements: readonly InternalStatement[];
  readonly currentSchemaHash: string;
};

export function generatePlan(
  currentSchema: Schema,
  desiredSchema: Schema,
  options: GeneratePlanOptions = {},
): InternalPlan {
  const diff = buildSchemaDiff(currentSchema, desiredSchema);
  return {
    statements: generateStatements(diff, options),
    currentSchemaHash: schemaHash(currentSchema),
  };
}

export function toSchemaDiffResult(plan: InternalPlan): SchemaDiffResult {
  return {
    statements: plan.statements.map(toPublicStatement),
  };
}
