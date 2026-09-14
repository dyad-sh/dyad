import { Readable } from "node:stream";
import fetch from "node-fetch";
import { z } from "zod";

export const UserInfoResponseSchema = z.object({
  usedCredits: z.number().finite().nonnegative(),
  totalCredits: z.number().finite().nonnegative(),
  budgetResetDate: z.string(),
  userId: z.string(),
  isTrial: z.boolean().optional().default(false),
});
export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;
export class UserInfoApiError extends Error {
  constructor(readonly status: number) {
    super(`Account usage API returned HTTP ${status}`);
  }
}

/** Fresh main-process lookup, with no UI cache or test-build positive-balance bypass. */
export async function fetchUserInfo(
  apiKey: string,
  signal?: AbortSignal,
): Promise<UserInfoResponse> {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(
    process.env.DYAD_USER_INFO_URL ?? "https://api.dyad.sh/v1/user/info",
    {
      method: "GET",
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Cache-Control": "no-cache",
      },
    },
  );
  if (!response.ok) {
    if (response.body instanceof Readable) response.body.destroy();
    throw new UserInfoApiError(response.status);
  }
  return UserInfoResponseSchema.parse(await response.json());
}
