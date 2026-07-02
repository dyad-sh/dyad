// On Windows, the PATH environment variable can be stored with different
// casings (e.g., "PATH", "Path", "path"). We need to find the actual key used
// to avoid creating duplicate entries with different casings.
export function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
}
