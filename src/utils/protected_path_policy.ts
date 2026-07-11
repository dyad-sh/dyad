import path from "node:path";

/**
 * Paths whose contents must not be exposed to an agent or sandbox.
 * Keep this policy independent of either caller so all read surfaces agree.
 */
export const PROTECTED_PATH_PATTERNS = [
  /(^|[/\\])\.env(?:[/\\]|$)/i,
  /(^|[/\\])\.env\.[^/\\]+(?:[/\\]|$)/i,
  /(^|[/\\])\.envrc(?:[/\\]|$)/i,
  /(^|[/\\])\.git([/\\]|$)/i,
  /(^|[/\\])\.npmrc$/i,
  /(^|[/\\])\.yarnrc(?:\.yml)?$/i,
  /(^|[/\\])\.pypirc$/i,
  /(^|[/\\])\.(?:bash|zsh|fish|python|mysql|psql|sqlite)_history$/i,
  /(^|[/\\])\.ssh([/\\]|$)/i,
  /(^|[/\\])\.aws([/\\]|$)/i,
  /(^|[/\\])\.config([/\\]|$)/i,
  /(^|[/\\])\.netrc$/i,
  /\.key$/i,
  /\.pem$/i,
] as const;

/** Paths restricted by the sandbox runtime, but searchable/readable by agent tools. */
export const SANDBOX_ONLY_DENIED_PATH_PATTERNS = [
  /(^|[/\\])node_modules([/\\]|$)/i,
] as const;

export function normalizeProtectedPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isProtectedPath(filePath: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

/** Negated ripgrep globs, appended after user globs so they cannot be overridden. */
export const PROTECTED_RIPGREP_EXCLUDED_GLOBS = [
  "!**/.env*",
  "!**/.envrc",
  "!**/.git/**",
  "!**/.npmrc",
  "!**/.yarnrc",
  "!**/.yarnrc.yml",
  "!**/.pypirc",
  "!**/.bash_history",
  "!**/.zsh_history",
  "!**/.fish_history",
  "!**/.python_history",
  "!**/.mysql_history",
  "!**/.psql_history",
  "!**/.sqlite_history",
  "!**/.ssh/**",
  "!**/.aws/**",
  "!**/.config/**",
  "!**/.netrc",
  "!**/*.key",
  "!**/*.pem",
] as const;

export function isProtectedRelativePath(rootPath: string, filePath: string) {
  return isProtectedPath(
    normalizeProtectedPath(path.relative(rootPath, filePath)),
  );
}
