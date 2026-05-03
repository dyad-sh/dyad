import { createRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rootRoute } from "../root";
import JoyPublishPage from "@/pages/joy/PublishPage";

const publishSearchSchema = z.object({
  type: z.string().optional(),
  assetId: z.string().optional(),
  studio: z.string().optional(),
  contentCid: z.string().optional(),
  name: z.string().optional(),
});

export const joyPublishRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/joy/publish",
  component: JoyPublishPage,
  validateSearch: (search) => publishSearchSchema.parse(search),
});
