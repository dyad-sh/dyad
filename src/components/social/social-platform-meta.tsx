import type { ComponentProps } from "react";
import { Facebook } from "lucide-react";

import type { SocialPlatform } from "@/ipc/types/social_media";
import { cn } from "@/lib/utils";

/** The X (Twitter) wordmark logo — lucide only ships the legacy bird. */
export function XLogoIcon({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn("size-4", className)}
      {...props}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

export function FacebookIcon({
  className,
  ...props
}: ComponentProps<typeof Facebook>) {
  return <Facebook className={cn("size-4", className)} {...props} />;
}

export const SOCIAL_PLATFORM_META: Record<
  SocialPlatform,
  {
    label: string;
    accent: string;
    chipClass: string;
    iconWrapClass: string;
  }
> = {
  facebook: {
    label: "Facebook",
    accent: "#4267F5",
    chipClass: "border-blue-400/30 bg-blue-500/10 text-blue-200",
    iconWrapClass:
      "border-blue-400/25 bg-blue-500/10 text-blue-300 shadow-[0_0_18px_rgba(66,103,245,0.25)]",
  },
  x: {
    label: "X",
    accent: "#e7e9ea",
    chipClass: "border-white/25 bg-white/10 text-white",
    iconWrapClass:
      "border-white/20 bg-white/10 text-white shadow-[0_0_18px_rgba(255,255,255,0.15)]",
  },
};

export function SocialPlatformIcon({
  platform,
  className,
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  return platform === "facebook" ? (
    <FacebookIcon className={className} />
  ) : (
    <XLogoIcon className={className} />
  );
}
