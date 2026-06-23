import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import log from "electron-log";

const logger = log.scope("linux_libcurl_shim");

/**
 * The bundled dugite git http helpers (git-remote-https/git-remote-http) are
 * dynamically linked against `libcurl-gnutls.so.4`. Debian/Ubuntu ship that
 * exact soname, but RHEL-based distros (Fedora, RHEL, CentOS, ...) ship only
 * the OpenSSL flavor `libcurl.so.4`, so the helper fails to start with:
 *   "error while loading shared libraries: libcurl-gnutls.so.4: cannot open
 *    shared object file"
 *
 * The public curl API is identical across the two builds, so pointing the
 * loader at the OpenSSL libcurl under the gnutls soname resolves the helper.
 * We do this purely at runtime, only when the gnutls soname is genuinely
 * missing, so systems that already have it are never touched.
 *
 * https://github.com/dyad-sh/dyad/issues/2975
 */

const SONAME = "libcurl-gnutls.so.4";

// Computed once per process. `undefined` means "no shim needed / possible".
let cachedShimDir: string | undefined | "uncomputed" = "uncomputed";

/**
 * Returns the directory to prepend to LD_LIBRARY_PATH so the bundled git http
 * helpers can find a libcurl under the `libcurl-gnutls.so.4` soname, or
 * `undefined` when no shim is needed (gnutls present, not Linux, or no usable
 * libcurl found).
 */
export function ensureLibcurlShim(): string | undefined {
  if (cachedShimDir !== "uncomputed") {
    return cachedShimDir;
  }
  cachedShimDir = computeShimDir();
  return cachedShimDir;
}

/**
 * Does the actual work behind ensureLibcurlShim (which caches the result).
 * Returns undefined when no shim is needed or possible: non-Linux, the gnutls
 * soname is already present, or no usable libcurl.so.4 was found. Otherwise
 * (re)creates the symlink and returns the directory containing it. Never
 * throws; failures are logged and treated as "no shim".
 */
function computeShimDir(): string | undefined {
  if (process.platform !== "linux") {
    return undefined;
  }

  try {
    const libs = listSystemLibs();

    // gnutls soname already present: nothing to do, leave the system alone.
    if (libs.has(SONAME)) {
      return undefined;
    }

    const realLibcurl = libs.get("libcurl.so.4");
    if (!realLibcurl) {
      // No usable libcurl found. Can't fix it here; let the real loader error
      // surface so the user sees an actionable message.
      logger.warn(
        `${SONAME} missing and no libcurl.so.4 found; git over https may fail`,
      );
      return undefined;
    }

    const shimDir = path.join(app.getPath("userData"), "native-shims");
    fs.mkdirSync(shimDir, { recursive: true });

    const link = path.join(shimDir, SONAME);
    if (readlinkSafe(link) !== realLibcurl) {
      fs.rmSync(link, { force: true });
      fs.symlinkSync(realLibcurl, link);
      logger.info(`Created libcurl shim: ${link} -> ${realLibcurl}`);
    }

    return shimDir;
  } catch (error) {
    logger.error("Failed to set up libcurl shim:", error);
    return undefined;
  }
}

/**
 * Lists system libraries via `ldconfig -p`, as a map of soname -> absolute
 * path restricted to the running process's architecture so we never hand a
 * 32-bit (i386) library to a 64-bit binary. A GUI-launched app may have a
 * minimal PATH that omits /sbin, so we try known absolute locations before a
 * bare PATH lookup.
 */
function listSystemLibs(): Map<string, string> {
  const archTag = ldconfigArchTag();
  const ldconfigCandidates = [
    "/usr/sbin/ldconfig",
    "/sbin/ldconfig",
    "ldconfig",
  ];

  for (const bin of ldconfigCandidates) {
    try {
      const out = execFileSync(bin, ["-p"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const parsed = parseLdconfig(out, archTag);
      if (parsed.size > 0) {
        return parsed;
      }
    } catch {
      // Not at this path / not executable; try the next candidate.
    }
  }

  logger.warn("ldconfig not found or returned no libraries");
  return new Map();
}

/**
 * Parses the output of `ldconfig -p` into a map of soname -> absolute path,
 * keeping only entries whose architecture annotation includes `archTag` (when
 * provided). The first path listed for a soname wins, matching ldconfig's
 * preferred-first ordering.
 *
 * Lines look like:
 *   libcurl.so.4 (libc6,x86-64) => /lib/x86_64-linux-gnu/libcurl.so.4
 */
export function parseLdconfig(
  output: string,
  archTag: string | undefined,
): Map<string, string> {
  const result = new Map<string, string>();
  const lineRe = /^\s*(\S+)\s+\(([^)]*)\)\s+=>\s+(\S+)\s*$/;
  for (const line of output.split("\n")) {
    const m = lineRe.exec(line);
    if (!m) continue;
    const [, soname, tags, libPath] = m;
    if (archTag && !tags.includes(archTag)) continue;
    if (!result.has(soname)) {
      result.set(soname, libPath);
    }
  }
  return result;
}

/**
 * Reads a symlink's target, returning undefined if the path is missing or not
 * a symlink.
 */
function readlinkSafe(p: string): string | undefined {
  try {
    return fs.readlinkSync(p);
  } catch {
    return undefined;
  }
}

/**
 * The architecture tag ldconfig uses in its parenthesized annotations. Dyad
 * ships only an x64 Linux build, so we only map that; any other arch returns
 * undefined and the arch filter is simply skipped.
 */
function ldconfigArchTag(): string | undefined {
  return process.arch === "x64" ? "x86-64" : undefined;
}
