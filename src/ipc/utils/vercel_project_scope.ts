import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Vercel's accountId identifies the owner; personal projects have no team scope. */
export function getVercelProjectTeamId(project: {
  accountId?: string;
}): string | null {
  if (!project.accountId) {
    throw new DyadError(
      "Vercel did not return the project's owner.",
      DyadErrorKind.External,
    );
  }
  return project.accountId.startsWith("team_") ? project.accountId : null;
}

/** Older app rows saved the first team, which may not own the linked project. */
export async function withVercelTeamScope<T>(
  teamId: string | null,
  request: (teamId: string | undefined) => Promise<T>,
): Promise<T> {
  try {
    return await request(teamId ?? undefined);
  } catch (error) {
    // Retry only an explicit scope/access rejection, never an ambiguous write
    // failure (timeouts, network errors, 5xx) that could duplicate a deployment.
    if (
      !teamId ||
      !error ||
      typeof error !== "object" ||
      !("statusCode" in error) ||
      (error.statusCode !== 403 && error.statusCode !== 404)
    )
      throw error;
    return request(undefined);
  }
}
