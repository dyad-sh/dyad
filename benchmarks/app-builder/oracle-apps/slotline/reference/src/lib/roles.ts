import { sql } from "@/db";
import { ForbiddenError, requiredString } from "@/lib/validate";

export type Role = "patient" | "staff";

/** The clinic access code that turns a patient into staff. */
export const STAFF_ACCESS_CODE = "slotline-staff-2026";

/**
 * A user's own role. Everyone is a `patient` until they claim staff, so sign-up
 * writes nothing and a missing row is simply "patient" — there is no window in
 * which a new account has no role at all.
 */
export async function roleOf(userId: string): Promise<Role> {
  const rows = (await sql`
    SELECT role FROM user_roles WHERE user_id = ${userId}
  `) as { role: Role }[];
  return rows[0]?.role === "staff" ? "staff" : "patient";
}

/**
 * The only way a role is ever written. It takes the code and nothing else — no
 * request body can name a user or a target role, so a role cannot be smuggled
 * through any other endpoint.
 */
export async function claimStaffRole(
  userId: string,
  code: unknown,
): Promise<Role> {
  const submitted = requiredString(code, "The clinic access code");
  if (submitted !== STAFF_ACCESS_CODE) {
    throw new ForbiddenError("That clinic access code is not valid.");
  }
  await sql`
    INSERT INTO user_roles (user_id, role)
    VALUES (${userId}, 'staff')
    ON CONFLICT (user_id)
    DO UPDATE SET role = 'staff', updated_at = now()
  `;
  return "staff";
}
