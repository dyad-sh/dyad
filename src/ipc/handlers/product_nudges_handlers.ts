import fetch from "node-fetch";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { productNudgeContracts } from "../types/product_nudges";
import {
  LOCAL_PRODUCT_NUDGES,
  ProductNudgesResponseSchema,
  type ProductNudgesResponse,
} from "@/lib/productNudges";
import { IS_TEST_BUILD } from "../utils/test_utils";

const logger = log.scope("product_nudges_handlers");

const PRODUCT_NUDGES_URL =
  process.env.DYAD_NUDGES_URL ?? "https://api.dyad.sh/v1/nudges";
const PRODUCT_NUDGES_TIMEOUT_MS = 5000;

export function registerProductNudgeHandlers() {
  createTypedHandler(productNudgeContracts.getProductNudges, async () => {
    return getProductNudges();
  });
}

async function getProductNudges(): Promise<ProductNudgesResponse> {
  if (IS_TEST_BUILD && !process.env.DYAD_NUDGES_URL) {
    return { nudges: LOCAL_PRODUCT_NUDGES };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      PRODUCT_NUDGES_TIMEOUT_MS,
    );

    const response = await fetch(PRODUCT_NUDGES_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`Failed to fetch product nudges: ${response.status}`);
      return { nudges: LOCAL_PRODUCT_NUDGES };
    }

    const parsed = ProductNudgesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      logger.warn(`Invalid product nudges response: ${parsed.error.message}`);
      return { nudges: LOCAL_PRODUCT_NUDGES };
    }

    return parsed.data;
  } catch (error) {
    logger.warn(`Error fetching product nudges: ${error}`);
    return { nudges: LOCAL_PRODUCT_NUDGES };
  }
}
