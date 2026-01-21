import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { toggleVariants } from "@/components/ui/toggle";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
});

// Wrapper to provide backward compatibility with Radix UI props
function ToggleGroup({
  className,
  variant,
  size,
  children,
  type = "single",
  value,
  onValueChange,
  ...props
}: Omit<
  React.ComponentProps<typeof ToggleGroupPrimitive>,
  "value" | "onValueChange"
> &
  VariantProps<typeof toggleVariants> & {
    type?: "single" | "multiple";
    value?: string | string[];
    onValueChange?: (value: string | string[]) => void;
  }) {
  // Convert Radix-style value (string for single, string[] for multiple) to Base UI style (always array)
  const baseUiValue = React.useMemo(() => {
    if (value === undefined) return undefined;
    if (type === "single") {
      return value ? [value as string] : [];
    }
    return value as string[];
  }, [value, type]);

  // Convert Base UI callback to Radix-style callback
  const handleValueChange = React.useCallback(
    (groupValue: string[]) => {
      if (!onValueChange) return;
      if (type === "single") {
        // For single mode, return the first value or empty string
        onValueChange(groupValue[0] || "");
      } else {
        onValueChange(groupValue);
      }
    },
    [onValueChange, type],
  );

  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        "group/toggle-group flex w-fit items-center rounded-md data-[variant=outline]:shadow-xs",
        className,
      )}
      multiple={type === "multiple"}
      value={baseUiValue}
      onValueChange={handleValueChange}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l",
        className,
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
