import { NextResponse } from "next/server";
import {
  LanguageModelCatalogResponseSchema,
  buildLanguageModelCatalogResponse,
} from "./catalog-data";

export async function GET() {
  const body = buildLanguageModelCatalogResponse();
  const validatedBody = LanguageModelCatalogResponseSchema.parse(body);

  return NextResponse.json(validatedBody, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
