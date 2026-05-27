export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export type EscapedIdentifier = Brand<string, "EscapedIdentifier">;
export type ObjectName = Brand<string, "ObjectName">;

export type ReplicaIdentity = "d" | "n" | "f" | "i";
export type ColumnIdentityType = "a" | "d";
export type IndexConstraintType = "p" | "u";
export type RelKind = "r" | "p" | "m";
export type PolicyCmd = "r" | "a" | "w" | "d" | "*";

export type SchemaQualifiedName = {
  readonly schemaName: string;
  readonly escapedName: EscapedIdentifier;
};

export type NamedSchema = {
  readonly kind: "namedSchema";
  readonly name: string;
};

export type Extension = {
  readonly kind: "extension";
  readonly name: SchemaQualifiedName;
  readonly version: string;
};

export type Enum = {
  readonly kind: "enum";
  readonly name: SchemaQualifiedName;
  readonly labels: readonly string[];
};

export type ColumnIdentity = {
  readonly type: ColumnIdentityType;
  readonly minValue: bigint;
  readonly maxValue: bigint;
  readonly startValue: bigint;
  readonly increment: bigint;
  readonly cacheSize: bigint;
  readonly cycle: boolean;
};

export type Column = {
  readonly kind: "column";
  readonly name: string;
  readonly type: string;
  readonly collation: SchemaQualifiedName | null;
  readonly default: string;
  readonly isGenerated: boolean;
  readonly generationExpression: string;
  readonly isNullable: boolean;
  readonly hasMissingValOptimization: boolean;
  readonly size: number;
  readonly identity: ColumnIdentity | null;
};

export type TablePrivilege = {
  readonly kind: "tablePrivilege";
  readonly grantee: string;
  readonly privilege: string;
  readonly isGrantable: boolean;
};

export type CheckConstraint = {
  readonly kind: "checkConstraint";
  readonly name: string;
  readonly keyColumns: readonly string[];
  readonly expression: string;
  readonly isValid: boolean;
  readonly isInheritable: boolean;
  readonly dependsOnFunctions: readonly SchemaQualifiedName[];
};

export type Policy = {
  readonly kind: "policy";
  readonly escapedName: EscapedIdentifier;
  readonly isPermissive: boolean;
  readonly appliesTo: readonly string[];
  readonly cmd: PolicyCmd;
  readonly checkExpression: string;
  readonly usingExpression: string;
  readonly columns: readonly string[];
};

export type Table = {
  readonly kind: "table";
  readonly name: SchemaQualifiedName;
  readonly columns: readonly Column[];
  readonly checkConstraints: readonly CheckConstraint[];
  readonly policies: readonly Policy[];
  readonly privileges: readonly TablePrivilege[];
  readonly replicaIdentity: ReplicaIdentity;
  readonly rlsEnabled: boolean;
  readonly rlsForced: boolean;
  readonly partitionKeyDef: string;
  readonly parentTable: SchemaQualifiedName | null;
  readonly forValues: string;
};

export type IndexConstraint = {
  readonly type: IndexConstraintType;
  readonly escapedConstraintName: EscapedIdentifier;
  readonly constraintDef: string;
  readonly isLocal: boolean;
};

export type Index = {
  readonly kind: "index";
  readonly name: string;
  readonly owningRelName: SchemaQualifiedName;
  readonly owningRelKind: RelKind;
  readonly columns: readonly string[];
  readonly isInvalid: boolean;
  readonly isUnique: boolean;
  readonly constraint: IndexConstraint | null;
  readonly getIndexDefStmt: string;
  readonly parentIdx: SchemaQualifiedName | null;
};

export type ForeignKeyConstraint = {
  readonly kind: "foreignKeyConstraint";
  readonly escapedName: EscapedIdentifier;
  readonly owningTable: SchemaQualifiedName;
  readonly foreignTable: SchemaQualifiedName;
  readonly constraintDef: string;
  readonly isValid: boolean;
};

export type SequenceOwner = {
  readonly tableName: SchemaQualifiedName;
  readonly columnName: string;
};

export type Sequence = {
  readonly kind: "sequence";
  readonly name: SchemaQualifiedName;
  readonly owner: SequenceOwner | null;
  readonly type: string;
  readonly startValue: bigint;
  readonly increment: bigint;
  readonly maxValue: bigint;
  readonly minValue: bigint;
  readonly cacheSize: bigint;
  readonly cycle: boolean;
};

export type FunctionSchema = {
  readonly kind: "function";
  readonly name: SchemaQualifiedName;
  readonly functionDef: string;
  readonly language: string;
  readonly dependsOnFunctions: readonly SchemaQualifiedName[];
};

export type Procedure = {
  readonly kind: "procedure";
  readonly name: SchemaQualifiedName;
  readonly def: string;
};

export type Trigger = {
  readonly kind: "trigger";
  readonly escapedName: EscapedIdentifier;
  readonly owningTable: SchemaQualifiedName;
  readonly functionName: SchemaQualifiedName;
  readonly getTriggerDefStmt: string;
  readonly isConstraint: boolean;
};

export type TableDependency = {
  readonly name: SchemaQualifiedName;
  readonly columns: readonly string[];
};

export type View = {
  readonly kind: "view";
  readonly name: SchemaQualifiedName;
  readonly viewDefinition: string;
  readonly options: Readonly<Record<string, string>>;
  readonly tableDependencies: readonly TableDependency[];
};

export type MaterializedView = {
  readonly kind: "materializedView";
  readonly name: SchemaQualifiedName;
  readonly viewDefinition: string;
  readonly options: Readonly<Record<string, string>>;
  readonly tablespace: string;
  readonly tableDependencies: readonly TableDependency[];
};

export type Schema = {
  readonly namedSchemas: readonly NamedSchema[];
  readonly extensions: readonly Extension[];
  readonly enums: readonly Enum[];
  readonly tables: readonly Table[];
  readonly indexes: readonly Index[];
  readonly foreignKeyConstraints: readonly ForeignKeyConstraint[];
  readonly sequences: readonly Sequence[];
  readonly functions: readonly FunctionSchema[];
  readonly procedures: readonly Procedure[];
  readonly triggers: readonly Trigger[];
  readonly views: readonly View[];
  readonly materializedViews: readonly MaterializedView[];
};

export type SchemaObject =
  | NamedSchema
  | Extension
  | Enum
  | Table
  | Column
  | TablePrivilege
  | CheckConstraint
  | Policy
  | Index
  | ForeignKeyConstraint
  | Sequence
  | FunctionSchema
  | Procedure
  | Trigger
  | View
  | MaterializedView;

export function emptySchema(): Schema {
  return {
    namedSchemas: [],
    extensions: [],
    enums: [],
    tables: [],
    indexes: [],
    foreignKeyConstraints: [],
    sequences: [],
    functions: [],
    procedures: [],
    triggers: [],
    views: [],
    materializedViews: [],
  };
}
