// S-AUTH spike browser test. Run: node test-browser.mjs
// Uses the dyad repo's playwright install (chromium already downloaded for e2e).
import { chromium } from "/Users/mini/dyad-2/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3100";
const email = `sauth-${Date.now()}@example.com`;
const password = "Passw0rd!Spike1";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

// 1. Sign-up via custom form
await page.goto(BASE);
await page.getByTestId("signup-name").fill("Spike User");
await page.getByTestId("signup-email").fill(email);
await page.getByTestId("signup-password").fill(password);
await page.getByTestId("signup-submit").click();
await page.getByTestId("user-menu").waitFor({ timeout: 15000 });
check(
  "signup-creates-session",
  (await page.getByTestId("user-menu").textContent()) === email,
);

// 2. Cookie inspection: the __Secure- question
const cookies = await context.cookies(BASE);
const sessionCookie = cookies.find((c) =>
  c.name.startsWith("__Secure-neon-auth.session_token"),
);
const dataCookie = cookies.find(
  (c) =>
    c.name.startsWith("__Secure-neon-auth.") && c.name.includes("session_data"),
);
check(
  "secure-prefix-cookie-set-on-http-localhost",
  Boolean(sessionCookie),
  JSON.stringify(
    cookies.map((c) => ({ n: c.name, secure: c.secure, sameSite: c.sameSite })),
  ),
);
check("session-data-cookie-minted", Boolean(dataCookie));

// 3. Session survives reload
await page.reload();
await page.getByTestId("user-menu").waitFor({ timeout: 15000 });
check(
  "session-survives-reload",
  (await page.getByTestId("user-menu").textContent()) === email,
);

// 4. Server-side session via /api/me (benchmark's pinned contract)
const meResp = await page.request.get(`${BASE}/api/me`);
const me = meResp.ok() ? await meResp.json() : null;
check(
  "api-me-server-side-session",
  meResp.ok() && me?.email === email && typeof me?.id === "string",
  `status=${meResp.status()} body=${JSON.stringify(me)}`,
);

// 5. Unauthenticated /api/me → 401
const anonContext = await browser.newContext();
const anonResp = await anonContext.request.get(`${BASE}/api/me`);
check("api-me-unauthed-401", anonResp.status() === 401);
await anonContext.close();

// 6. Sign out
await page.getByTestId("sign-out-button").click();
await page.getByTestId("signin-email").waitFor({ timeout: 15000 });
const cookiesAfter = (await context.cookies(BASE)).filter(
  (c) => c.name.startsWith("__Secure-neon-auth.session_token") && c.value,
);
check("signout-clears-session", cookiesAfter.length === 0);

// 7. Sign back in
await page.getByTestId("signin-email").fill(email);
await page.getByTestId("signin-password").fill(password);
await page.getByTestId("signin-submit").click();
await page.getByTestId("user-menu").waitFor({ timeout: 15000 });
check(
  "signin-works",
  (await page.getByTestId("user-menu").textContent()) === email,
);

// 8. Wrong password shows error in pinned error element
await page.getByTestId("sign-out-button").click();
await page.getByTestId("signin-email").waitFor({ timeout: 15000 });
await page.getByTestId("signin-email").fill(email);
await page.getByTestId("signin-password").fill("WrongPassword1!");
await page.getByTestId("signin-submit").click();
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="signin-error"]')?.textContent
      ?.length > 0,
  { timeout: 15000 },
);
check("bad-password-shows-error", true);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
process.exit(failed.length ? 1 : 0);
