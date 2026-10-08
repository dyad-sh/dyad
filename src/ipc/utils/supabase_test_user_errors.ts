import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** A database-create rejection for which we verified that no auth user exists. */
export class SupabaseTestUserCreationRejectedError extends DyadError {
  constructor() {
    super(
      "Supabase rejected default test-user creation with a database error; verified that no user was created.",
      DyadErrorKind.External,
    );
  }
}
