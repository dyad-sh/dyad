import { z } from "zod";

/**
 * Git revisions passed as positional command arguments must not be parsed as
 * command-line options by native Git.
 */
export const SafeGitRefSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("-"), {
    message: "git ref must not start with '-'",
  });
