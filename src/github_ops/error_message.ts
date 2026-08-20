export const MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH = 32_000;
export const MAX_GITHUB_OPS_VERIFICATION_ERROR_LENGTH = 1_000;

const TRUNCATION_NOTICE = "\n… [GitHub error output truncated]";

export function truncateGithubOpsErrorMessage(
  message: string,
  maxLength = MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH,
): string {
  if (message.length <= maxLength) return message;
  return (
    message.slice(0, maxLength - TRUNCATION_NOTICE.length) + TRUNCATION_NOTICE
  );
}
