import { escapeIdentifier, fqName } from "./identifiers.js";
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
  SchemaObject,
  Sequence,
  Table,
  TablePrivilege,
  Trigger,
  View,
} from "./model.js";

export function objectName(obj: SchemaObject): string {
  switch (obj.kind) {
    case "namedSchema":
      return namedSchemaName(obj);
    case "extension":
      return extensionName(obj);
    case "enum":
      return enumName(obj);
    case "table":
      return tableName(obj);
    case "column":
      return columnName(obj);
    case "tablePrivilege":
      return tablePrivilegeName(obj);
    case "checkConstraint":
      return checkConstraintName(obj);
    case "policy":
      return policyName(obj);
    case "index":
      return indexName(obj);
    case "foreignKeyConstraint":
      return foreignKeyConstraintName(obj);
    case "sequence":
      return sequenceName(obj);
    case "function":
      return functionName(obj);
    case "procedure":
      return procedureName(obj);
    case "trigger":
      return triggerName(obj);
    case "view":
      return viewName(obj);
    case "materializedView":
      return materializedViewName(obj);
    default:
      return assertNever(obj);
  }
}

export function namedSchemaName(obj: NamedSchema): string {
  return obj.name;
}

export function extensionName(obj: Extension): string {
  return fqName(obj.name);
}

export function enumName(obj: Enum): string {
  return fqName(obj.name);
}

export function tableName(obj: Table): string {
  return fqName(obj.name);
}

export function columnName(obj: Column): string {
  return obj.name;
}

export function tablePrivilegeName(obj: TablePrivilege): string {
  const grantee = obj.grantee === "" ? "PUBLIC" : obj.grantee;
  return `${grantee}:${obj.privilege}`;
}

export function checkConstraintName(obj: CheckConstraint): string {
  return obj.name;
}

export function policyName(obj: Policy): string {
  return obj.escapedName;
}

export function indexName(obj: Index): string {
  return fqName({ schemaName: obj.owningRelName.schemaName, escapedName: escapeIdentifier(obj.name) });
}

export function foreignKeyConstraintName(obj: ForeignKeyConstraint): string {
  return `${fqName(obj.owningTable)}-${obj.escapedName}`;
}

export function sequenceName(obj: Sequence): string {
  return fqName(obj.name);
}

export function functionName(obj: FunctionSchema): string {
  return fqName(obj.name);
}

export function procedureName(obj: Procedure): string {
  return fqName(obj.name);
}

export function triggerName(obj: Trigger): string {
  return `${fqName(obj.owningTable)}-${obj.escapedName}`;
}

export function viewName(obj: View): string {
  return fqName(obj.name);
}

export function materializedViewName(obj: MaterializedView): string {
  return fqName(obj.name);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected schema object: ${String(value)}`);
}
