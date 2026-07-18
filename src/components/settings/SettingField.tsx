import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A consistent settings field: a label + optional description stacked above the
 * control. Used to give every selector on the Settings page the same rhythm,
 * typography, and control width. Keep controls at `w-full sm:w-[240px]` so they
 * align down the column on desktop and go full-width on narrow viewports.
 */
export function SettingField({
  htmlFor,
  label,
  description,
  children,
  className,
}: {
  htmlFor?: string;
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="space-y-1">
        <Label
          htmlFor={htmlFor}
          className="text-sm font-medium text-foreground"
        >
          {label}
        </Label>
        {description && (
          <p
            id={htmlFor ? `${htmlFor}-description` : undefined}
            className="text-[13px] leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
