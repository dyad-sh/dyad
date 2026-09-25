import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log";
import { getUserDataPath } from "@/paths/paths";
import { PNPM_GLOBAL_INSTALL_PACKAGE } from "@/ipc/utils/socket_firewall";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { assertDockerAvailable, runDockerCli } from "./docker_cli";

const logger = log.scope("docker_runtime_image");

/**
 * The image every Docker-mode guest command runs in. Dyad owns it: nothing is
 * written into the user's repository, and one image is shared by every app, so
 * starting an app no longer runs a per-app `docker build`.
 *
 * glibc (bookworm), not Alpine: Playwright's Chromium does not run on musl.
 */
export const BASE_RUNTIME_DOCKERFILE = `FROM node:22-bookworm-slim
RUN npm install -g ${PNPM_GLOBAL_INSTALL_PACKAGE} && npm cache clean --force
`;

/**
 * Chromium's system libraries, layered on the base image and built only the
 * first time tests run. They must live in the image: guest commands run in
 * throwaway containers, so libraries apt-installed at test time would vanish.
 * The browser binary itself is installed per Playwright version into a shared
 * volume by the test bootstrap.
 */
export const PLAYWRIGHT_DEPS_VERSION = "1.58.2";

export type RuntimeImageKind = "base" | "playwright";

function shortHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export function getBaseRuntimeImageTag(): string {
  return `dyad-runtime:${shortHash(BASE_RUNTIME_DOCKERFILE)}`;
}

export function getPlaywrightRuntimeDockerfile(): string {
  return `FROM ${getBaseRuntimeImageTag()}
RUN npx --yes playwright@${PLAYWRIGHT_DEPS_VERSION} install-deps chromium && rm -rf /var/lib/apt/lists/* /root/.npm
`;
}

export function getRuntimeImageTag(kind: RuntimeImageKind): string {
  return kind === "base"
    ? getBaseRuntimeImageTag()
    : `dyad-runtime-playwright:${shortHash(getPlaywrightRuntimeDockerfile())}`;
}

const inFlightBuilds = new Map<string, Promise<void>>();

async function imageExists(tag: string): Promise<boolean> {
  const result = await runDockerCli(["image", "inspect", tag], {
    timeoutMs: 30_000,
  });
  return result.code === 0;
}

async function buildImage({
  tag,
  dockerfile,
  onOutput,
}: {
  tag: string;
  dockerfile: string;
  onOutput?: (chunk: string) => void;
}): Promise<void> {
  // A Dyad-owned build context holding only the Dockerfile, so no user file is
  // ever sent to the Docker daemon as build context.
  const contextDir = path.join(
    getUserDataPath(),
    "docker-runtime",
    tag.replace(/[^a-zA-Z0-9_.-]/g, "_"),
  );
  await fs.mkdir(contextDir, { recursive: true });
  await fs.writeFile(path.join(contextDir, "Dockerfile"), dockerfile, "utf8");

  logger.info(`Building Docker runtime image ${tag}`);
  onOutput?.(
    `Preparing the Docker runtime image (${tag}). This only happens once...\n`,
  );
  const result = await runDockerCli(["build", "-t", tag, contextDir], {
    timeoutMs: 20 * 60_000,
    onOutput,
  });
  if (result.code !== 0) {
    throw new DyadError(
      `Failed to build the Docker runtime image: ${(result.stderr || result.stdout).slice(-1500)}`,
      DyadErrorKind.External,
    );
  }
}

/** Builds the image on first use; concurrent callers share one build. */
export async function ensureRuntimeImage(
  kind: RuntimeImageKind,
  onOutput?: (chunk: string) => void,
): Promise<string> {
  if (kind === "playwright") {
    await ensureRuntimeImage("base", onOutput);
  }
  const tag = getRuntimeImageTag(kind);
  let pending = inFlightBuilds.get(tag);
  if (!pending) {
    pending = (async () => {
      if (await imageExists(tag)) return;
      // A stopped daemon also fails the inspect; report that as the user's
      // setup problem rather than as a failed image build.
      await assertDockerAvailable();
      await buildImage({
        tag,
        dockerfile:
          kind === "base"
            ? BASE_RUNTIME_DOCKERFILE
            : getPlaywrightRuntimeDockerfile(),
        onOutput,
      });
    })().finally(() => inFlightBuilds.delete(tag));
    inFlightBuilds.set(tag, pending);
  }
  await pending;
  return tag;
}
