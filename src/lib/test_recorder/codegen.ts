import { draftIncludesSignIn, type RecordedTestDraft } from "./draft";
import type { LocatorDescriptor, RecordedAction } from "./types";

/** JS/JSON string literal — safe against quotes, backslashes, newlines. */
function q(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render a locator descriptor as a Playwright locator chain WITHOUT the leading
 * `page.` (the caller prepends it), including any `.nth(...)` disambiguation.
 *
 * `exact` matters on every name-matching getter, not just `getByText`:
 * getByRole/getByLabel/getByPlaceholder all match case-insensitive substrings by
 * default. The recorder decides uniqueness by exact string equality, so a
 * locator it called unique — "Save", with no `.nth()` — would otherwise also
 * match "Save draft" at replay and fail Playwright's strict mode.
 */
export function locatorToCode(locator: LocatorDescriptor): string {
  const exact = locator.exact ? ", exact: true" : "";
  let call: string;
  switch (locator.kind) {
    case "testid":
      call = `getByTestId(${q(locator.value)})`;
      break;
    case "role":
      call = locator.name
        ? `getByRole(${q(locator.value)}, { name: ${q(locator.name)}${exact} })`
        : `getByRole(${q(locator.value)})`;
      break;
    case "placeholder":
      call = locator.exact
        ? `getByPlaceholder(${q(locator.value)}, { exact: true })`
        : `getByPlaceholder(${q(locator.value)})`;
      break;
    case "label":
      call = locator.exact
        ? `getByLabel(${q(locator.value)}, { exact: true })`
        : `getByLabel(${q(locator.value)})`;
      break;
    case "text":
      call = locator.exact
        ? `getByText(${q(locator.value)}, { exact: true })`
        : `getByText(${q(locator.value)})`;
      break;
    case "dyadId":
      call = `locator(${q(`[data-dyad-id="${locator.value}"]`)})`;
      break;
    case "css":
    default:
      call = `locator(${q(locator.value)})`;
      break;
  }
  if (locator.nth != null) call += `.nth(${locator.nth})`;
  return call;
}

/**
 * Render a single recorded action as its Playwright statement WITHOUT leading
 * indentation or trailing newline — the line the recorder's step list shows for
 * that step, and the exact statement `generateSpecSource` indents into the spec.
 */
export function actionToCodeLine(action: RecordedAction): string {
  if (action.kind === "navigate") {
    return `await page.goto(${q(action.path)});`;
  }

  const target = `page.${locatorToCode(action.locator)}`;
  switch (action.kind) {
    case "click":
      return `await ${target}.click();`;
    case "dblclick":
      return `await ${target}.dblclick();`;
    case "fill":
      return `await ${target}.fill(${q(action.value)});`;
    case "press":
      return `await ${target}.press(${q(action.key)});`;
    case "check":
      return `await ${target}.check();`;
    case "uncheck":
      return `await ${target}.uncheck();`;
    case "select": {
      const arg =
        action.values.length === 1
          ? q(action.values[0])
          : `[${action.values.map(q).join(", ")}]`;
      return `await ${target}.selectOption(${arg});`;
    }
  }
}

/**
 * The spec body a draft replays, as one trimmed statement per line: the
 * preamble (`signIn`, then `goto("/")`) followed by the recorded interactions.
 *
 * This is the numbering everything downstream agrees on — what the recorder
 * lists for the user, what the model describes and attaches assertions to, and
 * what `generateSpecSource` writes. Derived from the draft rather than stored,
 * so a proposal and the file it eventually produces can never disagree.
 */
export function recordedBodyStatements(draft: RecordedTestDraft): string[] {
  const statements: string[] = [];
  if (draftIncludesSignIn(draft)) statements.push(`await signIn(page);`);
  // The base URL is configured by Dyad's Playwright bootstrap.
  statements.push(`await page.goto("/");`);
  for (const action of draft.actions) {
    statements.push(actionToCodeLine(action));
  }
  return statements;
}

/**
 * Generate a complete Playwright spec from the final body statements — the
 * recorded steps with any approved assertions already interleaved, in the order
 * they should run.
 *
 * This is the ONLY place a recorded spec is written: no model ever produces the
 * file, so approving a plan and re-approving the same plan give the same bytes.
 */
export function generateSpecSource({
  testName,
  includeSignIn,
  bodyStatements,
}: {
  /** The Playwright test title. */
  testName: string;
  /** Emit `await signIn(page)` and import the auth fixture. */
  includeSignIn: boolean;
  bodyStatements: string[];
}): string {
  const lines: string[] = [];
  lines.push(`import { test, expect } from "@playwright/test";`);
  if (includeSignIn) {
    lines.push(`import { signIn } from "./fixtures/test-user";`);
  }
  lines.push("");
  lines.push(`test(${q(testName)}, async ({ page }) => {`);
  for (const statement of bodyStatements) {
    lines.push(`  ${statement}`);
  }
  lines.push(`});`);
  lines.push("");
  return lines.join("\n");
}

/** Generate the spec exactly as recorded, with no assertions. */
export function generateDraftSpecSource(draft: RecordedTestDraft): string {
  return generateSpecSource({
    testName: draft.testName,
    includeSignIn: draftIncludesSignIn(draft),
    bodyStatements: recordedBodyStatements(draft),
  });
}

/**
 * Filename for a recorded test, e.g. `recorded-add-item.spec.ts`. `index` (2+)
 * disambiguates when that name is already taken — a re-recording, or two flows
 * whose names slugify the same, must never clobber an existing spec.
 */
export function recordedSpecFileName(testName: string, index?: number): string {
  const slug =
    testName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "test";
  return `recorded-${slug}${index && index > 1 ? `-${index}` : ""}.spec.ts`;
}
