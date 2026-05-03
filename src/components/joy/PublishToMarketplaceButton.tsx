/**
 * PublishToMarketplaceButton — universal "Publish to Joy Marketplace" entry point
 * dropped into each studio (Image, Video, Agent, Model, Document).
 *
 * Deep-links to /joy/publish with `?type=…&studio=…&assetId=…` so the
 * Universal Asset Wizard can pre-populate.
 */

import { Link } from "@tanstack/react-router";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface Props extends Omit<ButtonProps, "asChild"> {
  /** image | video | agent | model | document — matches the wizard. */
  assetType: "image" | "video" | "agent" | "model" | "document";
  /** Display name in the sidebar/route — purely for analytics. */
  studio: string;
  /** Optional id of the asset being published (passes through). */
  assetId?: string;
  /** Optional pre-pinned content CID. */
  contentCid?: string;
  /** Optional default name. */
  name?: string;
  /** Override the button label. */
  label?: string;
}

export function PublishToMarketplaceButton({
  assetType,
  studio,
  assetId,
  contentCid,
  name,
  label,
  variant = "default",
  size = "sm",
  ...rest
}: Props) {
  const search: Record<string, string> = {
    type: assetType,
    studio,
  };
  if (assetId) search.assetId = assetId;
  if (contentCid) search.contentCid = contentCid;
  if (name) search.name = name;

  return (
    <Link
      to="/joy/publish"
      search={search}
    >
      <Button variant={variant} size={size} {...rest}>
        <Sparkles className="w-4 h-4 mr-1.5" />
        {label ?? "Publish to Marketplace"}
      </Button>
    </Link>
  );
}

export default PublishToMarketplaceButton;
