import { DEAL_STAGES, type DealStage } from "@/lib/types";

export const MAX_STRING_LENGTH = 500;

export function validationError(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function clampString(
  value: unknown,
  fieldName: string,
  options?: { required?: boolean },
): string | Response {
  const raw = value === undefined || value === null ? "" : String(value);
  const trimmed = raw.trim();
  if (options?.required && !trimmed) {
    return validationError(`${fieldName} is required`);
  }
  if (trimmed.length > MAX_STRING_LENGTH) {
    return validationError(`${fieldName} must be at most ${MAX_STRING_LENGTH} characters`);
  }
  return trimmed;
}

export function validateOptionalEmail(value: unknown): string | Response {
  const emailResult = clampString(value, "Email");
  if (emailResult instanceof Response) return emailResult;
  if (!emailResult) return "";
  // Practical email shape check (not full RFC)
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(emailResult)) {
    return validationError("Email is invalid");
  }
  return emailResult;
}

export function validateRequiredName(value: unknown): string | Response {
  return clampString(value, "Name", { required: true });
}

export function validateDealAmount(value: unknown): number | Response {
  if (value === undefined || value === null || value === "") {
    return validationError("Amount is required");
  }
  const amountRaw = typeof value === "string" ? Number(value) : value;
  if (typeof amountRaw !== "number" || !Number.isFinite(amountRaw)) {
    return validationError("Amount must be a number");
  }
  const amount = Math.round(amountRaw);
  if (!Number.isFinite(amount) || amount < 0) {
    return validationError("Amount must be a non-negative whole number");
  }
  if (String(amount).length > MAX_STRING_LENGTH) {
    return validationError("Amount is invalid");
  }
  return amount;
}

export function validateDealStage(value: unknown): DealStage | Response {
  const stage = String(value ?? "").trim();
  if (!(DEAL_STAGES as string[]).includes(stage)) {
    return validationError("Invalid stage");
  }
  return stage as DealStage;
}

/** Strip fields clients must never control on create/update bodies. */
export function sanitizeWriteBody<T extends Record<string, unknown>>(
  body: T,
): Omit<
  T,
  | "id"
  | "workspace_id"
  | "workspaceId"
  | "membership_id"
  | "membershipId"
  | "role"
  | "user_id"
  | "userId"
  | "created_by"
  | "createdBy"
  | "owner_id"
  | "ownerId"
> {
  const {
    id: _id,
    workspace_id: _workspace_id,
    workspaceId: _workspaceId,
    membership_id: _membership_id,
    membershipId: _membershipId,
    role: _role,
    user_id: _user_id,
    userId: _userId,
    created_by: _created_by,
    createdBy: _createdBy,
    owner_id: _owner_id,
    ownerId: _ownerId,
    ...rest
  } = body;
  return rest;
}
