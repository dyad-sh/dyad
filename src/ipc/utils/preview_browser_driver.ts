import log from "electron-log/main";
import { getRunningTestBaseUrl } from "@/ipc/handlers/tests_handlers";

const logger = log.scope("preview_browser_driver");

/**
 * A long-lived Chromium page per running app, pointed at that app's preview
 * proxy. Dyad already runs Playwright against the same proxy URL for
 * `run_tests`; this reuses that base URL so ad-hoc inspection and
 * interaction see exactly the app the user is looking at, and so it works
 * for any dev server (Vite, Next.js, ...) rather than a specific framework.
 */

type ConsoleEntry = { type: string; text: string };

interface Session {
  page: any;
  consoleLog: ConsoleEntry[];
  close: () => Promise<void>;
}

const sessions = new Map<number, Session>();
/** In-flight launches, so two concurrent tool calls for one app share a page. */
const launching = new Map<number, Promise<Session | null>>();
const NAV_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 10_000;

async function launchPage() {
  // Resolved lazily: the browser binary is only needed once an agent actually
  // drives the preview, and a failure here must not break app startup.
  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(
      "Could not start the preview browser. Playwright's Chromium is not " +
        "installed on this machine — run `npx playwright install chromium` " +
        `in the Dyad source tree. Underlying error: ${(error as Error).message}`,
    );
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  return {
    page,
    close: () => browser.close(),
  };
}

/**
 * Client-rendered dev servers (Vite, Next.js) paint a splash or empty shell
 * before hydration finishes. Acting during that window sees zero elements and
 * reports a false "page is empty", so settle before observing or interacting.
 */
async function settle(page: any) {
  await page
    .waitForLoadState("networkidle", { timeout: 8_000 })
    .catch(() => undefined);
  // React/TanStack commit after the network goes quiet; give the paint a beat.
  await page.waitForTimeout(400);
}

async function getSession(appId: number): Promise<Session | null> {
  const existing = sessions.get(appId);
  if (existing) return existing;

  const inFlight = launching.get(appId);
  if (inFlight) return inFlight;

  const baseUrl = getRunningTestBaseUrl(appId);
  if (!baseUrl) {
    logger.debug("No running preview proxy for app", appId);
    return null;
  }

  const promise = launchSession(appId, baseUrl);
  launching.set(appId, promise);
  try {
    return await promise;
  } finally {
    launching.delete(appId);
  }
}

async function launchSession(appId: number, baseUrl: string): Promise<Session | null> {

  try {
    const { page, close } = await launchPage();
    const consoleLog: ConsoleEntry[] = [];
    page.on("console", (msg: any) => {
      consoleLog.push({ type: msg.type(), text: msg.text() });
      // Keep the buffer bounded; long agent sessions otherwise grow it without
      // limit and the console read becomes unusable.
      if (consoleLog.length > 200) consoleLog.splice(0, consoleLog.length - 200);
    });
    page.on("pageerror", (err: Error) => {
      consoleLog.push({ type: "pageerror", text: err.message });
    });

    const session: Session = { page, consoleLog, close };
    sessions.set(appId, session);
    logger.info("Preview browser session opened for app", appId, baseUrl);
    return session;
  } catch (error) {
    logger.error("Failed to open preview browser session", error);
    return null;
  }
}

export async function closePreviewBrowserSession(appId: number): Promise<void> {
  const session = sessions.get(appId);
  if (!session) return;
  sessions.delete(appId);
  await session.close().catch(() => undefined);
}

export async function closeAllPreviewBrowserSessions(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => closePreviewBrowserSession(id)));
}

const NO_PREVIEW_MESSAGE =
  "The app is not currently running, so there is no preview to drive. Start the app first (preview the app), then retry.";

async function currentPage(appId: number) {
  const session = await getSession(appId);
  if (!session) return null;
  return { session, baseUrl: getRunningTestBaseUrl(appId)! };
}

export async function previewNavigate(appId: number, path: string) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session, baseUrl } = resolved;
  const target = /^https?:\/\//.test(path) ? path : new URL(path, baseUrl).toString();
  await session.page.goto(target, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  session.consoleLog.length = 0;
  await settle(session.page);
  return describePage(session.page, target);
}

export async function previewClick(appId: number, selector: string) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const locator = session.page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await locator.click({ timeout: ACTION_TIMEOUT_MS });
  await settle(session.page);
  return `Clicked ${selector}. ${await describePage(session.page, session.page.url())}`;
}

export async function previewType(
  appId: number,
  selector: string,
  text: string,
  submit: boolean,
) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { session } = resolved;
  const locator = session.page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
  if (submit) {
    await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
    await settle(session.page);
  }
  return `Typed into ${selector}${submit ? " and pressed Enter" : ""}. ${await describePage(
    session.page,
    session.page.url(),
  )}`;
}

/** Read the rendered page: title, url, and the text a user would actually see. */
export async function previewRead(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  await settle(resolved.session.page);
  return describePage(resolved.session.page, resolved.session.page.url());
}

export async function previewConsole(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const { consoleLog } = resolved.session;
  if (consoleLog.length === 0) return "The preview has logged no console output.";
  return consoleLog
    .map((entry) => `[${entry.type}] ${entry.text}`)
    .join("\n")
    .slice(0, 8000);
}

/**
 * Screenshots are returned as a data URL and saved through the same path the
 * test-runner uses, so the agent can attach them without a new transport.
 */
/**
 * The screenshot travels as a TEXT tool result, so its size is paid for
 * repeatedly: it is retained in the SDK step state, the persisted transcript
 * and every later request of the turn. Cap it so a single retina PNG cannot
 * dominate the context window.
 */
const MAX_PREVIEW_SCREENSHOT_CHARS = 60_000;

export async function previewScreenshot(appId: number) {
  const resolved = await currentPage(appId);
  if (!resolved) return NO_PREVIEW_MESSAGE;
  const dataUrl = (await resolved.session.page.screenshot({
    type: "png",
    fullPage: false,
  })) as unknown as string;
  const dataUrlWithPrefix = `data:image/png;base64,${dataUrl
    .toString()
    .replace(/^data:image\/png;base64,/, "")}`;
  if (dataUrlWithPrefix.length > MAX_PREVIEW_SCREENSHOT_CHARS) {
    return `Screenshot omitted: the image data (${dataUrlWithPrefix.length} characters) exceeds the ${MAX_PREVIEW_SCREENSHOT_CHARS}-character context budget.`;
  }
  return dataUrlWithPrefix;
}

async function describePage(page: any, url: string) {
  const title = await page.title().catch(() => "");
  const text = (await page.evaluate(() => document.body?.innerText ?? ""))
    .toString()
    .replace(/\s+/g, " ")
    .trim();
  return [
    `URL: ${url}`,
    `Title: ${title}`,
    `Visible text: ${text.slice(0, 4000)}`,
  ].join("\n");
}
