/** Included in the generated Playwright shim; no dependency on Dyad at runtime. */
export function buildTestSignInRetrySource(): string {
  return String.raw`
// Retry only the app's email sign-in endpoint. Other failures and application
// requests must remain visible to the test.
// Rate-limit tests can opt out for both browser and API requests with:
// test.info().annotations.push({ type: "dyad-no-sign-in-retry" });
function isSignInRetryDisabled(testInfo: pw.TestInfo): boolean {
  return !!testInfo.annotations?.some(({ type }) => type === "dyad-no-sign-in-retry");
}

function isDyadSignIn(url: string, method: string, baseUrl: string): boolean {
  const parsed = new URL(url, baseUrl);
  return method.toUpperCase() === "POST" &&
    parsed.origin === new URL(baseUrl).origin &&
    parsed.pathname === "/api/auth/sign-in/email";
}

function signInRetryDelay(headers: Record<string, string>, attempt: number): number {
  let serverDelay: number | undefined;
  for (const name of ["retry-after", "x-retry-after"]) {
    const value = headers[name]?.trim();
    if (!value) continue;
    const seconds = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
    const date = name === "retry-after" && /[a-z]/i.test(value) && !Number.isFinite(seconds)
      ? Date.parse(value) : NaN;
    const delay = Number.isFinite(seconds) ? seconds * 1000
      : Number.isFinite(date) ? Math.max(0, date - Date.now()) : NaN;
    if (Number.isFinite(delay)) {
      serverDelay = delay;
      break;
    }
  }
  // Never shorten the server's cooldown. Jitter is additional, including when
  // several workers receive the same Retry-After value.
  return (serverDelay ?? Math.min(1000 * 2 ** attempt, 8000)) +
    100 + Math.floor(Math.random() * 400);
}

function createSignInRetry(testInfo: pw.TestInfo) {
  const controller = new AbortController();
  const signal = controller.signal;
  const cancel = () => controller.abort();
  async function run(
    send: (timeout: number) => Promise<pw.APIResponse>,
    requestedTimeout?: number,
  ): Promise<pw.APIResponse> {
    // Teardown cancels at the actual test deadline (including setTimeout and
    // Stop). The additional cap also bounds tests with timeout: 0. All attempts
    // share the caller's request budget rather than restarting it per retry.
    const budget = Math.min(60_000,
      requestedTimeout && requestedTimeout > 0 ? requestedTimeout : Infinity,
      testInfo.timeout > 0 ? testInfo.timeout : Infinity);
    const deadline = Date.now() + budget;
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Dyad sign-in retry timed out.");
      const response = await send(remaining);
      if (signal.aborted) {
        await response.dispose();
        signal.throwIfAborted();
      }
      if (response.status() !== 429 || attempt >= 4 || isSignInRetryDisabled(testInfo)) return response;
      const delay = signInRetryDelay(response.headers(), attempt);
      // Return the real 429 if its cooldown cannot fit; never retry early.
      if (delay >= deadline - Date.now()) return response;
      console.warn("[Dyad] Sign-in returned HTTP 429; retry " + (attempt + 1) +
        "/4 in " + delay + " ms. Add the dyad-no-sign-in-retry test annotation to inspect rate limits unchanged.");
      await response.dispose();
      await new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, delay);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
  return { run, cancel, signal };
}

function installSignInApiRetry(api: pw.APIRequestContext, baseUrl: string, testInfo: pw.TestInfo) {
  const retry = createSignInRetry(testInfo);
  const original = api.fetch;
  // Playwright's get/post/etc. delegate to fetch, so wrapping it once also
  // covers page.request and avoids nesting retries for post -> fetch.
  api.fetch = async (url, options = {}) => {
    const requestUrl = typeof url === "string" ? url : url.url();
    const method = options.method ?? (typeof url === "string" ? "GET" : url.method());
    if (isSignInRetryDisabled(testInfo) || !isDyadSignIn(requestUrl, method, baseUrl)) {
      return original.call(api, url, options);
    }
    const response = await retry.run(
      (timeout) => original.call(api, url, {
        ...options, timeout, failOnStatusCode: false, maxRetries: 0,
      }), options.timeout,
    );
    if (options.failOnStatusCode && response.status() >= 400) {
      const status = response.status();
      await response.dispose();
      throw new Error("Sign-in failed (" + status + ").");
    }
    return response;
  };
  return () => {
    retry.cancel();
    api.fetch = original;
  };
}

async function installSignInContextRetry(context: pw.BrowserContext, baseUrl: string, testInfo: pw.TestInfo) {
  const retry = createSignInRetry(testInfo);
  const restoreApi = installSignInApiRetry(context.request, baseUrl, testInfo);
  const matches = (url: URL) => isDyadSignIn(url.href, "POST", baseUrl);
  const activeRoutes = new Set<pw.Route>();
  const handler = async (route: pw.Route) => {
    if (isSignInRetryDisabled(testInfo) || route.request().method() !== "POST") return route.fallback();
    activeRoutes.add(route);
    let response: pw.APIResponse | undefined;
    try {
      response = await retry.run((timeout) => route.fetch({
        timeout, maxRetries: 0, maxRedirects: 0,
      }));
      await route.fulfill({ response });
    } catch {
      await route.abort(retry.signal.aborted ? "aborted" : "failed").catch(() => {});
    } finally {
      activeRoutes.delete(route);
      await response?.dispose().catch(() => {});
    }
  };
  let closed = false;
  const onClose = () => {
    closed = true;
    retry.cancel();
    restoreApi();
  };
  context.on("close", onClose);
  try {
    await context.route(matches, handler);
  } catch (error) {
    context.off("close", onClose);
    restoreApi();
    throw error;
  }
  return async () => {
    retry.cancel();
    restoreApi();
    // Disabling interception can resume the original paused browser request.
    // Abort it first, even if route.fetch is still waiting for response headers.
    await Promise.allSettled([...activeRoutes].map((route) => route.abort("aborted")));
    try {
      if (!closed) await context.unroute(matches, handler);
    } catch (error) {
      if (!closed) throw error;
    } finally {
      context.off("close", onClose);
    }
  };
}
`;
}
