import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/**
 * Docker mode is the isolated runtime: every command that executes app code
 * (package installs, dev server, builds, type checks, tests) runs in a
 * container, never on the host. Call sites that would otherwise run such a
 * command on the host branch on this.
 */
export function isDockerRuntimeActive(): boolean {
  return (readSettings().runtimeMode2 ?? "host") === "docker";
}

/**
 * Features that would have to execute app code on the host, and so are not
 * offered in Docker mode.
 */
export type DockerUnsupportedFeature =
  | "pre-commit-hooks"
  | "preview-test-watching"
  | "capacitor";

const UNSUPPORTED_MESSAGES: Record<DockerUnsupportedFeature, string> = {
  "pre-commit-hooks":
    "Pre-commit hooks aren't supported in Docker mode: they would run the repository's scripts on your computer instead of inside the container. Switch the runtime to Local to use them.",
  "preview-test-watching":
    "Watching tests in the preview isn't supported in Docker mode. Tests run headless inside the container.",
  capacitor:
    "Capacitor commands aren't supported in Docker mode: they run the app's build tooling on your computer instead of inside the container. Switch the runtime to Local to use Capacitor.",
};

export function dockerUnsupportedMessage(
  feature: DockerUnsupportedFeature,
): string {
  return UNSUPPORTED_MESSAGES[feature];
}

export function assertSupportedOutsideDocker(
  feature: DockerUnsupportedFeature,
): void {
  if (isDockerRuntimeActive()) {
    throw new DyadError(
      dockerUnsupportedMessage(feature),
      DyadErrorKind.Precondition,
    );
  }
}
