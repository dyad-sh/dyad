"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";
import { getRenderProps } from "@/lib/slot";

function TooltipProvider({
  delayDuration: _delayDuration = 0,
  children,
}: {
  delayDuration?: number;
  children: React.ReactNode;
}) {
  // Base UI handles delay at the Root level, so TooltipProvider just passes through children
  // The delay is handled in Tooltip component below
  return <>{children}</>;
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" delay={0} {...props} />;
}

function TooltipTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger> & {
  asChild?: boolean;
}) {
  const renderProps = getRenderProps(asChild, children);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      {...renderProps}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 0,
  side,
  align,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> & {
  sideOffset?: number;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        sideOffset={sideOffset}
        side={side}
        align={align}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
