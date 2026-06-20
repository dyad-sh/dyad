import type { Index } from "./model.js";

export function constraintsEqualIgnoringLocality(
  left: NonNullable<Index["constraint"]>,
  right: NonNullable<Index["constraint"]>,
): boolean {
  return (
    left.type === right.type &&
    left.escapedConstraintName === right.escapedConstraintName &&
    left.constraintDef === right.constraintDef
  );
}

export function stripTrailingNotValid(definition: string): string {
  return definition.replace(/\s+NOT VALID$/iu, "");
}
