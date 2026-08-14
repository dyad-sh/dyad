import log from "electron-log";

import {
  decrypt,
  encrypt,
  readSettings,
  writeSettings,
} from "../../main/settings";

import { createTypedHandler } from "./base";
import { stockImageContracts } from "../types/stock_images";
import {
  PixabayError,
  buildPixabayUrl,
  parsePixabayResponse,
  redactKey,
} from "@/lib/stock_images/pixabay";

const logger = log.scope("stock_image_handlers");

/**
 * The stored key, decrypted, or null.
 *
 * Main process only. The renderer is told whether a key exists, never what it
 * is, so the key cannot leak through a devtools console or a crash report.
 */
function storedPixabayKey(): string | null {
  const stored = readSettings().pixabayApiKey;
  if (!stored) return null;
  try {
    return decrypt(stored);
  } catch {
    // An undecryptable secret is a secret we do not have.
    return null;
  }
}

/** What went wrong, in words, without the status code jargon. */
function describeFailure(status: number): string {
  if (status === 400) {
    return "Pixabay rejected that search. Check the API key in the gallery settings.";
  }
  if (status === 429) {
    return "Pixabay is rate limiting this key. Wait a minute and search again.";
  }
  return `Pixabay returned an error (${status}).`;
}

export function registerStockImageHandlers() {
  createTypedHandler(stockImageContracts.authState, async () => {
    return { hasKey: Boolean(storedPixabayKey()) };
  });

  createTypedHandler(stockImageContracts.saveApiKey, async (_event, input) => {
    writeSettings({ pixabayApiKey: encrypt(input.apiKey.trim()) });
  });

  createTypedHandler(stockImageContracts.clearApiKey, async () => {
    writeSettings({ pixabayApiKey: undefined });
  });

  createTypedHandler(stockImageContracts.search, async (_event, input) => {
    const key = storedPixabayKey();
    if (!key) {
      throw new Error(
        "No Pixabay API key is saved. Add one to search for stock images.",
      );
    }

    const url = buildPixabayUrl({
      key,
      query: input.query,
      page: input.page,
      orientation: input.orientation,
    });

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      // The URL is redacted before it is logged: it carries the key.
      logger.error(
        `Could not reach ${redactKey(url)}:`,
        error instanceof Error ? error.message : error,
      );
      throw new Error("Could not reach Pixabay. Check the network connection.");
    }

    if (!response.ok) {
      logger.warn(`${redactKey(url)} returned ${response.status}`);
      throw new Error(describeFailure(response.status));
    }

    try {
      return parsePixabayResponse(await response.json());
    } catch (error) {
      if (error instanceof PixabayError) throw error;
      logger.error("Could not read the Pixabay response:", error);
      throw new Error("Pixabay sent something this app could not read.");
    }
  });
}
