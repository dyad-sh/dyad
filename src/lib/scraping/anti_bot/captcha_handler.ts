/**
 * CAPTCHA Handler — Multi-strategy CAPTCHA solving.
 *
 * Strategies:
 * 1. Manual solve via IPC (pause + show CAPTCHA to user)
 * 2. Local AI vision model (Ollama multimodal)
 * 3. Audio CAPTCHA transcription
 */

import type { Page } from "playwright-core";
import { BrowserWindow } from "electron";
import log from "electron-log";
import type { CaptchaDetection } from "../types";

const logger = log.scope("scraping:captcha");

/**
 * Detect CAPTCHA presence on a page.
 */
export async function detectCaptcha(page: Page): Promise<CaptchaDetection> {
  return page.evaluate(() => {
    const result: { detected: boolean; type?: string; selector?: string; siteKey?: string } = {
      detected: false,
    };

    // reCAPTCHA v2
    const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]');
    const recaptchaDiv = document.querySelector(".g-recaptcha");
    if (recaptchaFrame || recaptchaDiv) {
      result.detected = true;
      result.type = "recaptcha-v2";
      result.selector = recaptchaFrame ? 'iframe[src*="recaptcha"]' : ".g-recaptcha";
      const siteKey = recaptchaDiv?.getAttribute("data-sitekey");
      if (siteKey) result.siteKey = siteKey;
      return result;
    }

    // reCAPTCHA v3 (invisible)
    const recaptchaV3 = document.querySelector('script[src*="recaptcha/api.js?render="]');
    if (recaptchaV3) {
      result.detected = true;
      result.type = "recaptcha-v3";
      const src = recaptchaV3.getAttribute("src") ?? "";
      const match = src.match(/render=([^&]+)/);
      if (match) result.siteKey = match[1];
      return result;
    }

    // hCaptcha
    const hcaptcha = document.querySelector(".h-captcha, iframe[src*=\"hcaptcha\"]");
    if (hcaptcha) {
      result.detected = true;
      result.type = "hcaptcha";
      result.selector = ".h-captcha";
      const siteKey = (hcaptcha as HTMLElement).getAttribute?.("data-sitekey");
      if (siteKey) result.siteKey = siteKey;
      return result;
    }

    // Cloudflare Turnstile
    const turnstile = document.querySelector(".cf-turnstile, [data-turnstile-callback]");
    if (turnstile) {
      result.detected = true;
      result.type = "cloudflare-turnstile";
      result.selector = ".cf-turnstile";
      return result;
    }

    // Generic image CAPTCHA
    const captchaImages = document.querySelectorAll(
      'img[src*="captcha"], img[alt*="captcha"], img[id*="captcha"]'
    );
    if (captchaImages.length > 0) {
      result.detected = true;
      result.type = "image";
      result.selector = 'img[src*="captcha"]';
      return result;
    }

    return result;
  }) as Promise<CaptchaDetection>;
}

/**
 * Request manual CAPTCHA solve from the user via IPC.
 * Sends a notification to the renderer and waits for user input.
 */
export async function requestManualSolve(
  page: Page,
  captcha: CaptchaDetection,
  jobId: string,
): Promise<boolean> {
  logger.info(`CAPTCHA detected (${captcha.type}), requesting manual solve for job ${jobId}`);

  // Take screenshot of the CAPTCHA area
  let screenshotBase64: string | undefined;
  try {
    const screenshot = await page.screenshot({ fullPage: false });
    screenshotBase64 = screenshot.toString("base64");
  } catch { /* continue without screenshot */ }

  // Notify renderer
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("scraping:captcha-required", {
      jobId,
      type: captcha.type,
      screenshotBase64,
      url: page.url(),
    });
  }

  // Wait for the CAPTCHA to disappear (user solved it in the visible browser)
  // or timeout after 5 minutes
  try {
    if (captcha.selector) {
      await page.waitForSelector(captcha.selector, {
        state: "detached",
        timeout: 300_000, // 5 min
      });
      return true;
    }
  } catch {
    logger.warn("CAPTCHA solve timeout");
  }

  return false;
}
