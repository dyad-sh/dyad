export class PgSchemaDiffError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PgSchemaDiffError";
  }
}

export class NotImplementedMigrationError extends PgSchemaDiffError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NotImplementedMigrationError";
  }
}

export class DuplicateIdentifierError extends PgSchemaDiffError {
  public constructor(identifier: string) {
    super(`multiple objects have identifier ${identifier}`);
    this.name = "DuplicateIdentifierError";
  }
}

export class UnsupportedPostgresVersionError extends PgSchemaDiffError {
  public constructor(versionNumber: number) {
    super(`PostgreSQL server version ${versionNumber} is not supported; PostgreSQL 14 or newer is required`);
    this.name = "UnsupportedPostgresVersionError";
  }
}
