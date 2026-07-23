import type { LocatorDescriptor, RecordedAction } from "./types";

export interface CodegenOptions {
  /** The Playwright test title. */
  testName: string;
  /** Emit `await signIn(page)` and import the auth fixture. */
  includeSignIn: boolean;
}

/** JS/JSON string literal — safe against quotes, backslashes, newlines. */
function q(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render a locator descriptor as a Playwright locator chain WITHOUT the leading
 * `page.` (the caller prepends it), including any `.nth(...)` disambiguation.
 */
export function locatorToCode(locator: LocatorDescriptor): string {
  let call: string;
  switch (locator.kind) {
    case "testid":
      call = `getByTestId(${q(locator.value)})`;
      break;
    case "role":
      call = locator.name
        ? `getByRole(${q(locator.value)}, { name: ${q(locator.name)} })`
        : `getByRole(${q(locator.value)})`;
      break;
    case "placeholder":
      call = `getByPlaceholder(${q(locator.value)})`;
      break;
    case "label":
      call = `getByLabel(${q(locator.value)})`;
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

function actionToCode(action: RecordedAction): string {
  if (action.kind === "navigate") {
    return `  await page.goto(${q(action.path)});`;
  }

  const target = `page.${locatorToCode(action.locator)}`;
  switch (action.kind) {
    case "click":
      return `  await ${target}.click();`;
    case "dblclick":
      return `  await ${target}.dblclick();`;
    case "fill":
      return `  await ${target}.fill(${q(action.value)});`;
    case "press":
      return `  await ${target}.press(${q(action.key)});`;
    case "check":
      return `  await ${target}.check();`;
    case "uncheck":
      return `  await ${target}.uncheck();`;
    case "select": {
      const arg =
        action.values.length === 1
          ? q(action.values[0])
          : `[${action.values.map(q).join(", ")}]`;
      return `  await ${target}.selectOption(${arg});`;
    }
  }
}

/**
 * Generate a complete Playwright spec from a collapsed action list. The spec
 * navigates to `/` (the base URL is configured by Dyad's Playwright bootstrap)
 * and replays each action. When `includeSignIn` is set it first establishes an
 * authenticated session through the generated `tests/fixtures/test-user.ts`
 * helper. Assertions are added later by the optional AI pass.
 */
export function generateSpecSource(
  actions: RecordedAction[],
  options: CodegenOptions,
): string {
  const lines: string[] = [];
  lines.push(`import { test, expect } from "@playwright/test";`);
  if (options.includeSignIn) {
    lines.push(`import { signIn } from "./fixtures/test-user";`);
  }
  lines.push("");
  lines.push(`test(${q(options.testName)}, async ({ page }) => {`);
  if (options.includeSignIn) {
    lines.push(`  await signIn(page);`);
  }
  lines.push(`  await page.goto("/");`);
  for (const action of actions) {
    lines.push(actionToCode(action));
  }
  lines.push(`});`);
  lines.push("");
  return lines.join("\n");
}
