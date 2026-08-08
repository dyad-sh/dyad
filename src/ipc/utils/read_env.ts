import { shellEnvSync } from "shell-env";

// Need to look up run-time env vars this way
// otherwise it doesn't work as expected in MacOs apps:
// https://github.com/sindresorhus/shell-env

let _env: Record<string, string> | null = null;

export function getEnvVar(key: string) {
  // Cache it
  if (!_env) {
    _env = shellEnvSync();
  }
  return _env[key];
}
