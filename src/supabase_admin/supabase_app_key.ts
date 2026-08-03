import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { getFileWriteKey, withLock } from "@/ipc/utils/lock_utils";
import { assertMutationPathAllowed, safeJoin } from "@/ipc/utils/path_utils";
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
 * Blank out comment bodies, preserving every byte offset (and every newline),
 * so a match found in the result indexes straight back into the original.
 *
 * The anchor in `APP_KEY_RE` alone isn't enough: a block-commented example can
 * start at a line boundary just like the real declaration. Matching one would
 * rewrite the documentation and leave the live key legacy — and worse, silently,
 * because the rewritten comment then matches first and reads as `sb_publishable_`,
 * so detection goes quiet and never offers the fix again.
 *
 * Deliberately a scanner rather than a parser: it only needs to tell code from
 * comments (string literals are tracked so a `//` inside one isn't mistaken for
 * a comment), and the rewrite still splices into the untouched original.
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
      out += char;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        i++;
        if (source[i - 1] === char) {
          break;
        }
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
 * never has to raise a problem it can't offer a fix for. `undefined` here means
 * "nothing to switch" and nothing else — callers that act on the answer need to
 * tell that apart from a check that couldn't complete.
 */
async function resolveLegacyAppKey({
  appPath,
  projectId,
  organizationSlug,
}: {
  appPath: string;
  projectId: string;
  organizationSlug: string | null;
}): Promise<LegacyAppKey | undefined> {
  if (IS_TEST_BUILD) {
    return undefined;
  }

  const clientFilePath = await resolveClientFilePath(appPath);
  if (!clientFilePath) {
    return undefined;
  }

  const appKey = readAppKey(clientFilePath);
  if (!appKey) {
    return undefined;
  }
  // Already on a new-format key: nothing to fetch, nothing to say.
  if (appKey.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    return undefined;
  }

  const keys = await getProjectApiKeys({ projectId, organizationSlug });
  // Classify against the project's own list rather than the key's shape: it
  // proves the key is this project's legacy `anon` key, not a rotated value
  // or one belonging to a different project.
  const isLegacy = keys.some(
    (key) =>
      key.api_key === appKey && (key.type === "legacy" || key.name === "anon"),
  );
  if (!isLegacy) {
    return undefined;
  }
  const publishable = keys.find(
    (key) =>
      key.type === "publishable" &&
      key.api_key?.startsWith(PUBLISHABLE_KEY_PREFIX),
  );
  if (!publishable?.api_key) {
    // The project has no publishable key yet, so there's nothing to switch
    // to. Staying silent beats a warning whose only advice is "go make one".
    return undefined;
  }
  return {
    clientFilePath,
    legacyKey: appKey,
    publishableKey: publishable.api_key,
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
    return await resolveLegacyAppKey(params);
  } catch (error) {
    logger.warn(`Could not check the app's Supabase key: ${error}`);
    return undefined;
  }
}

/**
 * Swap an app's generated client from its legacy key to the project's
 * publishable key.
 *
 * Rewrites only the key literal — the rest of the file may have been edited by
 * the user or the agent, and regenerating it wholesale would discard that.
 * Returns false when there was nothing to switch.
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
}): Promise<boolean> {
  const legacy = await resolveLegacyAppKey({
    appPath,
    projectId,
    organizationSlug,
  });
  if (!legacy) {
    return false;
  }

  // `legacy.clientFilePath` is already canonicalized and confirmed inside the
  // app by resolveClientFilePath, so this write cannot escape the app tree.
  const { clientFilePath } = legacy;

  // The same lock the agent's file-writing tools take, so this read-modify-write
  // can neither clobber nor be clobbered by a concurrent write to this file.
  return withLock(getFileWriteKey(clientFilePath), async () => {
    const contents = await fs.promises.readFile(clientFilePath, "utf8");
    // Match against the comment-masked copy, then splice into the original by
    // offset — maskComments preserves them, so the two line up exactly.
    const match = APP_KEY_RE.exec(maskComments(contents));
    if (!match || match[3] !== legacy.legacyKey) {
      return false;
    }

    const start = match.index;
    const quote = match[2];
    const assignment = contents.slice(start, start + match[1].length);
    const updated =
      contents.slice(0, start) +
      `${assignment}${quote}${legacy.publishableKey}${quote}` +
      contents.slice(start + match[0].length);
    if (updated === contents) {
      return false;
    }

    await fs.promises.writeFile(clientFilePath, updated);
    logger.info(
      `Switched app at ${appPath} to the publishable key for project ${projectId}`,
    );
    return true;
  });
}
