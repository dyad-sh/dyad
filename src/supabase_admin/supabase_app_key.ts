import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { getFileWriteKey, withLock } from "@/ipc/utils/lock_utils";
import { assertMutationPathAllowed, safeJoin } from "@/ipc/utils/path_utils";
import { gitAdd, gitCommit, isGitPathClean } from "@/ipc/utils/git_utils";
import { getProjectApiKeys } from "./supabase_management_client";

const logger = log.scope("supabase_app_key");

/**
 * Where the AI is told to write the generated Supabase client
 * (`src/prompts/supabase_prompt.ts`). That prompt allows "the most appropriate
 * path for the project structure", so a miss here is expected and stays silent
 * rather than guessing at other locations.
 */
const CLIENT_FILE_RELATIVE_PATH = path.join(
  "src",
  "integrations",
  "supabase",
  "client.ts",
);

const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";
/** `{"alg":…` base64url-encoded — the opening of every JWS header. */
const JWT_PREFIX = "eyJ";

/** The claims a Supabase legacy key carries, as far as we rely on them. */
interface LegacyKeyClaims {
  role?: unknown;
  ref?: unknown;
}

function decodeJwtClaims(key: string): LegacyKeyClaims | undefined {
  const segments = key.split(".");
  if (!key.startsWith(JWT_PREFIX) || segments.length !== 3) {
    return undefined;
  }
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    // A JSON payload that isn't an object tells us nothing; treat it as
    // undecodable rather than reading properties off a string or number.
    return claims && typeof claims === "object"
      ? (claims as LegacyKeyClaims)
      : undefined;
  } catch {
    // Not a decodable JWT — that alone disqualifies it below.
    return undefined;
  }
}

/**
 * Whether a value is recognisably THIS project's legacy `anon` key, judged from
 * the key's own claims.
 *
 * Only ever a fallback for a key the project no longer lists: a listed key is
 * classified by what Supabase says it is, never by how it looks. But shape
 * alone would be far too loose here, because the switch overwrites the value —
 * a `service_role` JWT is the same shape, and so is another project's `anon`
 * key, so either could be silently downgraded or repointed. Both claims are
 * therefore required:
 *
 * - `role` must be `anon`, which excludes every secret/service_role key.
 * - `ref` must be this project's ref, which excludes other projects' keys.
 *
 * Supabase issues both claims on legacy keys, so a key missing either is not
 * one we can vouch for and is left alone. The verification is deliberately
 * NOT cryptographic: this decides whether to OFFER a replacement, and the
 * claims are the app's own generated code, not an attacker-supplied token.
 */
function isProjectLegacyAnonKey(key: string, projectId: string): boolean {
  const claims = decodeJwtClaims(key);
  return claims?.role === "anon" && claims.ref === projectId;
}
/**
 * The key literal the app authenticates with, as an assignment
 * (`const SUPABASE_PUBLISHABLE_KEY = "…"`) or an object property
 * (`SUPABASE_PUBLISHABLE_KEY: "…"`).
 *
 * Anchored to the start of a line so prose that merely mentions the constant
 * can't be taken for the live declaration. The value is allowed to sit on a
 * following line, because Prettier wraps exactly that way once the key pushes
 * the declaration past the print width — a formatting choice must not decide
 * whether an app gets migrated.
 *
 * Group 1 spans everything up to the opening quote, so a rewrite restores the
 * keyword, indentation and any line break verbatim.
 */
const APP_KEY_RE =
  /^([^\S\r\n]*(?:export[^\S\r\n]+)?(?:(?:const|let|var)[^\S\r\n]+)?SUPABASE_PUBLISHABLE_KEY[^\S\r\n]*[:=](?:(?:[^\S\r\n]*\r?\n)*[^\S\r\n]*))(["'`])([^"'`]+)\2/m;

/**
 * What a switch attempt actually did.
 *
 * Deliberately three-valued rather than a boolean: "didn't switch" covers both
 * an app that was already migrated and half a dozen ways the switch couldn't
 * proceed (no readable client, a client that resolves outside the app, a key
 * the project doesn't recognise, no publishable key to move to, the file
 * changing under the lock). Collapsing those into one `false` told a user whose
 * key is still legacy that it was "already up to date".
 */
export type SwitchKeyOutcome =
  /** The client was rewritten to the publishable key. */
  | "switched"
  /** The client already held a new-format key — nothing to do. */
  | "already-current"
  /** Nothing was switched and nothing can be: the app is out of scope. */
  | "not-applicable";

/** An app running on a legacy key, with the publishable key that replaces it. */
export interface LegacyAppKey {
  /** Absolute path of the generated client holding the key. */
  clientFilePath: string;
  /** The legacy key currently baked into that file. */
  legacyKey: string;
  /** The new-format key to switch to. */
  publishableKey: string;
}

/**
 * Blank out comment bodies and multiline template literals, preserving every
 * byte offset (and every newline), so a match found in the result indexes
 * straight back into the original.
 *
 * The anchor in `APP_KEY_RE` alone isn't enough: a block-commented example can
 * start at a line boundary just like the real declaration. Matching one would
 * rewrite the documentation and leave the live key legacy — and worse, silently,
 * because the rewritten comment then matches first and reads as `sb_publishable_`,
 * so detection goes quiet and never offers the fix again.
 *
 * A multiline template literal is the same hazard wearing different clothes —
 * embedded docs, a usage example, a code sample rendered by the app — because
 * its contents also carry real line breaks for `^` to anchor to. Only MULTILINE
 * templates are masked: the key's own value is a single-line token, so a
 * one-line backtick literal is still a legitimate declaration to find, while a
 * literal spanning lines can never be one.
 *
 * Deliberately a scanner rather than a parser: it only needs to tell code from
 * comments and template prose (string literals are tracked so a `//` inside one
 * isn't mistaken for a comment), and the rewrite still splices into the
 * untouched original.
 */
function maskComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      const closing = source.indexOf("*/", i + 2);
      const stop = closing === -1 ? source.length : closing + 2;
      while (i < stop) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      // Consume the whole literal first, then decide whether to keep it: a
      // template's line count isn't known until its closing backtick.
      const start = i;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        i++;
        if (source[i - 1] === char) {
          break;
        }
      }
      i = Math.min(i, source.length);
      const literal = source.slice(start, i);
      if (char === "`" && literal.includes("\n")) {
        // Keep the delimiters so the scanner's view stays byte-aligned, blank
        // the prose between them. A template left unterminated at EOF has no
        // closing backtick to echo.
        const closed = literal.length > 1 && literal.endsWith("`");
        const bodyEnd = closed ? literal.length - 1 : literal.length;
        out += "`";
        for (let at = 1; at < bodyEnd; at++) {
          out += literal[at] === "\n" ? "\n" : " ";
        }
        out += closed ? "`" : "";
      } else {
        out += literal;
      }
      continue;
    }

    out += char;
    i++;
  }
  return out;
}

/**
 * The generated client's path, canonicalized and confirmed to stay inside the
 * app, or undefined when it doesn't.
 *
 * Detection and the rewrite share this so they can never disagree: an app whose
 * `client.ts` is a symlink out of the app tree is not one we can rewrite, so it
 * must not be reported as having a legacy key either — otherwise the UI offers
 * an "Update key" button whose only possible outcome is a refusal.
 */
async function resolveClientFilePath(
  appPath: string,
): Promise<string | undefined> {
  try {
    const relativePath = await assertMutationPathAllowed({
      appPath,
      relativePath: CLIENT_FILE_RELATIVE_PATH,
    });
    return safeJoin(appPath, relativePath);
  } catch (error) {
    logger.warn(
      `Not checking the Supabase key for ${appPath}: its generated client does not resolve inside the app (${error})`,
    );
    return undefined;
  }
}

/** Read the key the generated app authenticates with. */
function readAppKey(clientFilePath: string): string | undefined {
  try {
    const contents = fs.readFileSync(clientFilePath, "utf8");
    return APP_KEY_RE.exec(maskComments(contents))?.[3];
  } catch {
    // No generated client (or an unreadable one) is normal — the app may not
    // use Supabase auth, or may keep its client somewhere else.
    return undefined;
  }
}

/**
 * Resolve whether an app's generated Supabase client still authenticates with a
 * legacy (`anon`) key, letting failures out.
 *
 * The key is written into the app's source once, at generation time, and never
 * refreshed — the prompt tells the AI to create that file only if it doesn't
 * already exist. So the key outlives the format Dyad writes today, and keeps
 * working right up until the project disables legacy keys, at which point every
 * request the app makes fails with "Legacy API keys are disabled".
 *
 * Reports only when there is a publishable key to switch to, so the caller
 * never has to raise a problem it can't offer a fix for. A non-`legacy` result
 * means "nothing to switch" and nothing else — callers that act on the answer
 * need to tell that apart from a check that couldn't complete, which is why
 * this throws rather than swallowing failures.
 *
 * `already-current` is kept distinct from `not-applicable` so the switch can
 * tell the user their key is up to date only when it actually is.
 */
type ResolvedAppKey =
  | { kind: "legacy"; legacy: LegacyAppKey }
  | { kind: "already-current" }
  | { kind: "not-applicable" };

const NOT_APPLICABLE = { kind: "not-applicable" } as const;

async function resolveLegacyAppKey({
  appPath,
  projectId,
  organizationSlug,
}: {
  appPath: string;
  projectId: string;
  organizationSlug: string | null;
}): Promise<ResolvedAppKey> {
  if (IS_TEST_BUILD) {
    return NOT_APPLICABLE;
  }

  const clientFilePath = await resolveClientFilePath(appPath);
  if (!clientFilePath) {
    return NOT_APPLICABLE;
  }

  const appKey = readAppKey(clientFilePath);
  if (!appKey) {
    return NOT_APPLICABLE;
  }
  // Already on a new-format key: nothing to fetch, nothing to say.
  if (appKey.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    return { kind: "already-current" };
  }

  const keys = await getProjectApiKeys({ projectId, organizationSlug });
  // Classify against the project's own list rather than the key's shape: it
  // proves the key is this project's legacy `anon` key, not a rotated value
  // or one belonging to a different project.
  const listed = keys.find((key) => key.api_key === appKey);
  const isLegacy = listed
    ? listed.type === "legacy" || listed.name === "anon"
    : // Not listed at all. Disabling is only the first half of Supabase's
      // migration — the end state is deletion, and a rotated key leaves the
      // same trace. Going quiet here would drop the warning at exactly the
      // moment the app is fully broken, so a key the project no longer knows
      // about still counts — but only when its own claims identify it as THIS
      // project's anon key, since the switch overwrites whatever it matches.
      isProjectLegacyAnonKey(appKey, projectId);
  if (!isLegacy) {
    return NOT_APPLICABLE;
  }
  const publishable = keys.find(
    (key) =>
      key.type === "publishable" &&
      key.api_key?.startsWith(PUBLISHABLE_KEY_PREFIX),
  );
  if (!publishable?.api_key) {
    // The project has no publishable key yet, so there's nothing to switch
    // to. Staying silent beats a warning whose only advice is "go make one".
    return NOT_APPLICABLE;
  }
  return {
    kind: "legacy",
    legacy: {
      clientFilePath,
      legacyKey: appKey,
      publishableKey: publishable.api_key,
    },
  };
}

/**
 * The passive check behind the warning banners: does this app still run on a
 * legacy key?
 *
 * Never throws — a failure to check is not a reason to interrupt the caller,
 * and the only cost of a missed detection is that the offer doesn't appear.
 * The switch path deliberately does NOT use this (see
 * `switchAppToPublishableKey`): an action the user asked for has to be able to
 * report that it couldn't check, rather than claim there was nothing to do.
 */
export async function detectLegacyAppKey(params: {
  appPath: string;
  projectId: string;
  organizationSlug: string | null;
}): Promise<LegacyAppKey | undefined> {
  try {
    const resolved = await resolveLegacyAppKey(params);
    return resolved.kind === "legacy" ? resolved.legacy : undefined;
  } catch (error) {
    logger.warn(`Could not check the app's Supabase key: ${error}`);
    return undefined;
  }
}

/**
 * Read/write the client file, translating filesystem failures into classified
 * errors on the way out.
 *
 * Detection tolerates an unreadable client (see `readAppKey`), but the switch
 * runs because the user pressed a button: if the file was deleted, made
 * unreadable, or is read-only between detection and the locked rewrite, that
 * has to reach the renderer as a `DyadError` with a kind, not as a raw `ENOENT`
 * that PostHog then files as an unclassified product exception
 * (`rules/dyad-errors.md`).
 */
async function readClientFile(clientFilePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(clientFilePath, "utf8");
  } catch (error) {
    throw new DyadError(
      `Couldn't read the app's Supabase client at ${clientFilePath}: ${error instanceof Error ? error.message : error}`,
      DyadErrorKind.External,
    );
  }
}

async function writeClientFile(
  clientFilePath: string,
  contents: string,
): Promise<void> {
  try {
    await fs.promises.writeFile(clientFilePath, contents);
  } catch (error) {
    throw new DyadError(
      `Couldn't update the app's Supabase client at ${clientFilePath}: ${error instanceof Error ? error.message : error}`,
      DyadErrorKind.External,
    );
  }
}

/**
 * Was the client file untouched before Dyad rewrote it?
 *
 * Decides whether the rewrite may be auto-committed. `git commit -- <path>`
 * records the whole working-tree version of that path, not the single hunk Dyad
 * changed, so committing a file the user was already editing would fold their
 * in-progress work into a commit labelled as a key swap. It answers false on
 * any failure (not a repo, git unavailable): "can't prove it was clean" has to
 * mean "don't commit".
 */
async function wasClientFileClean({
  appPath,
  relativePath,
}: {
  appPath: string;
  relativePath: string;
}): Promise<boolean> {
  try {
    return await isGitPathClean({ path: appPath, filepath: relativePath });
  } catch (error) {
    logger.info(
      `Not auto-committing ${relativePath}: could not check its git status (${error})`,
    );
    return false;
  }
}

/**
 * Commit the rewritten client on the app's behalf.
 *
 * Dyad's own edit is not something the user needs to review: leaving it in the
 * working tree only greets them with the "uncommitted changes" banner over a
 * one-line key swap they didn't type and can't meaningfully judge. Committing
 * it also gives the change a version to revert to, which an unstaged edit has.
 *
 * Only runs when the file held nothing but committed content beforehand — see
 * `wasClientFileClean`. A user mid-edit in `client.ts` keeps their work in the
 * working tree, where the key change simply joins it as one more line to
 * review; that is the honest outcome, and far better than an automatic commit
 * that quietly carries their edits.
 *
 * The pathspec scopes the commit to that one file, so edits and staged changes
 * ELSEWHERE in the app are untouched either way.
 *
 * Never throws: the key is already switched by the time this runs, and an app
 * that isn't a git repo (or a client file that's gitignored) is not a reason to
 * report the switch as failed.
 */
async function commitKeySwitch({
  appPath,
  clientFilePath,
}: {
  appPath: string;
  clientFilePath: string;
}): Promise<void> {
  const relativePath = path.relative(appPath, clientFilePath);
  try {
    await gitAdd({ path: appPath, filepath: relativePath });
    await gitCommit({
      path: appPath,
      message: "switch Supabase client to publishable API key",
      noVerify: true,
      paths: [relativePath],
    });
  } catch (error) {
    logger.warn(
      `Switched the Supabase key for ${appPath} but could not commit ${relativePath}: ${error}`,
    );
  }
}

/**
 * Swap an app's generated client from its legacy key to the project's
 * publishable key.
 *
 * Rewrites only the key literal — the rest of the file may have been edited by
 * the user or the agent, and regenerating it wholesale would discard that.
 *
 * Uses the throwing `resolveLegacyAppKey`, not `detectLegacyAppKey`: this runs
 * because the user pressed a button, and a Management API that couldn't be
 * reached has to surface as an error they can retry, not as "already up to
 * date" with the legacy key still baked into the app.
 */
export async function switchAppToPublishableKey({
  appPath,
  projectId,
  organizationSlug,
}: {
  appPath: string;
  projectId: string;
  organizationSlug: string | null;
}): Promise<SwitchKeyOutcome> {
  const resolved = await resolveLegacyAppKey({
    appPath,
    projectId,
    organizationSlug,
  });
  if (resolved.kind !== "legacy") {
    return resolved.kind;
  }
  const { legacy } = resolved;

  // `legacy.clientFilePath` is already canonicalized and confirmed inside the
  // app by resolveClientFilePath, so this write cannot escape the app tree.
  const { clientFilePath } = legacy;
  const relativePath = path.relative(appPath, clientFilePath);

  // The same lock the agent's file-writing tools take, so this read-modify-write
  // can neither clobber nor be clobbered by a concurrent write to this file.
  return withLock(await getFileWriteKey(clientFilePath), async () => {
    // Read git's view BEFORE the rewrite — afterwards every file looks dirty,
    // including the one we just made dirty ourselves.
    const wasClean = await wasClientFileClean({ appPath, relativePath });

    const contents = await readClientFile(clientFilePath);
    // Match against the comment-masked copy, then splice into the original by
    // offset — maskComments preserves them, so the two line up exactly.
    const match = APP_KEY_RE.exec(maskComments(contents));
    if (!match || match[3] !== legacy.legacyKey) {
      // The file changed between the check and the lock. Nothing was switched,
      // and we can't claim the key is current — we no longer know what it is.
      return "not-applicable";
    }

    const start = match.index;
    const quote = match[2];
    const assignment = contents.slice(start, start + match[1].length);
    const updated =
      contents.slice(0, start) +
      `${assignment}${quote}${legacy.publishableKey}${quote}` +
      contents.slice(start + match[0].length);
    if (updated === contents) {
      return "already-current";
    }

    await writeClientFile(clientFilePath, updated);
    logger.info(
      `Switched app at ${appPath} to the publishable key for project ${projectId}`,
    );
    if (wasClean) {
      // Inside the file lock: the commit has to capture the key we just wrote,
      // not whatever a concurrent writer might put there next.
      await commitKeySwitch({ appPath, clientFilePath });
    } else {
      logger.info(
        `Left the Supabase key change in ${relativePath} uncommitted: the file already had uncommitted edits, which a scoped commit would have swept in.`,
      );
    }
    return "switched";
  });
}
