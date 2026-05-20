import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";
import { ProductNudgesResponseSchema } from "../../lib/productNudges";

export const productNudgeContracts = {
  getProductNudges: defineContract({
    channel: "product-nudges:get",
    input: z.void(),
    output: ProductNudgesResponseSchema,
  }),
} as const;

export const productNudgeClient = createClient(productNudgeContracts);

export type GetProductNudgesOutput = z.infer<
  (typeof productNudgeContracts)["getProductNudges"]["output"]
>;
