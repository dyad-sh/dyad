import log from "electron-log";

const logger = log.scope("command_validator");

/**
 * Validates shell commands to prevent command injection attacks.
 *
 * This function checks for dangerous shell metacharacters and patterns
 * that could be used for command injection.
 *
 * @param command - The command string to validate
 * @param context - Context description for logging (e.g., "install command")
 * @returns The validated command if safe
 * @throws Error if the command contains dangerous patterns
 */
export function validateShellCommand(
  command: string | null | undefined,
  context: string = "command",
): string {
  if (!command || !command.trim()) {
    throw new Error(`Invalid ${context}: command is empty`);
  }

  const trimmedCommand = command.trim();

  // Check for dangerous shell metacharacters and patterns
  const dangerousPatterns = [
    // Command injection via semicolon (except in safe contexts like for loops)
    /;(?!\s*fi|\s*done|\s*esac)/,
    // Newline command separator
    /\n/,
    // Backticks for command substitution
    /`/,
    // Command substitution $()
    /\$\(/,
    // Pipe to shell
    /\|\s*sh\b/,
    /\|\s*bash\b/,
    /\|\s*zsh\b/,
    // File redirection to sensitive files
    />\s*\/etc\//,
    />\s*\/usr\//,
    />\s*\/bin\//,
    />\s*\/sbin\//,
    // Remote code execution
    /curl.*\|/,
    /wget.*\|/,
    // Background process with dangerous chars
    /&\s*[^&]/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmedCommand)) {
      logger.error(
        `Dangerous pattern detected in ${context}: ${pattern.toString()}`,
      );
      throw new Error(
        `Invalid ${context}: contains potentially dangerous shell metacharacters. ` +
          `Please ensure the command is safe and does not include command injection patterns.`,
      );
    }
  }

  // Additional length check to prevent extremely long commands
  if (trimmedCommand.length > 10000) {
    throw new Error(`Invalid ${context}: command exceeds maximum length`);
  }

  logger.debug(`Validated ${context}: ${trimmedCommand.substring(0, 100)}`);
  return trimmedCommand;
}

/**
 * Sanitizes a container name to ensure it only contains valid Docker container name characters.
 * Docker container names must match: [a-zA-Z0-9][a-zA-Z0-9_.-]*
 *
 * @param name - The container name to sanitize
 * @returns The sanitized container name
 * @throws Error if the name is invalid or cannot be sanitized
 */
export function sanitizeContainerName(name: string): string {
  if (!name || !name.trim()) {
    throw new Error("Container name cannot be empty");
  }

  const trimmed = name.trim();

  // Check if it already matches the valid pattern
  const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
  if (validPattern.test(trimmed)) {
    return trimmed;
  }

  // Try to sanitize: replace invalid chars with hyphens
  let sanitized = trimmed.replace(/[^a-zA-Z0-9_.-]/g, "-");

  // Ensure it starts with alphanumeric
  if (!/^[a-zA-Z0-9]/.test(sanitized)) {
    sanitized = "dyad-" + sanitized;
  }

  // Verify the sanitized name is valid
  if (!validPattern.test(sanitized)) {
    throw new Error(`Cannot sanitize container name: ${name}`);
  }

  if (trimmed !== sanitized) {
    logger.warn(`Sanitized container name from "${trimmed}" to "${sanitized}"`);
  }

  return sanitized;
}

/**
 * Validates that a volume name is safe for Docker volume operations.
 *
 * @param name - The volume name to validate
 * @returns The validated volume name
 * @throws Error if the volume name is invalid
 */
export function validateVolumeName(name: string): string {
  if (!name || !name.trim()) {
    throw new Error("Volume name cannot be empty");
  }

  const trimmed = name.trim();

  // Docker volume names can contain alphanumeric, hyphen, underscore, period
  const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
  if (!validPattern.test(trimmed)) {
    throw new Error(
      `Invalid volume name: ${name}. Must match pattern [a-zA-Z0-9][a-zA-Z0-9_.-]*`,
    );
  }

  return trimmed;
}
