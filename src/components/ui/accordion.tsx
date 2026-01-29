import * as React from "react";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Wrapper to provide backward compatibility with Radix UI props
function Accordion({
  type = "single",
  collapsible: _collapsible,
  defaultValue,
  value,
  onValueChange,
  ...props
}: Omit<
  React.ComponentProps<typeof AccordionPrimitive.Root>,
  "defaultValue" | "value" | "onValueChange"
> & {
  type?: "single" | "multiple";
  collapsible?: boolean;
  // Radix uses string for single, string[] for multiple
  defaultValue?: string | string[];
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
}) {
  // Convert Radix-style value (string for single, string[] for multiple) to Base UI style (always array)
  const baseUiDefaultValue = React.useMemo(() => {
    if (defaultValue === undefined) return undefined;
    if (typeof defaultValue === "string") {
      // Empty string should become empty array, not [""]
      return defaultValue === "" ? [] : [defaultValue];
    }
    return defaultValue;
  }, [defaultValue]);

  const baseUiValue = React.useMemo(() => {
    if (value === undefined) return undefined;
    if (typeof value === "string") {
      // Empty string should become empty array, not [""]
      return value === "" ? [] : [value];
    }
    return value;
  }, [value]);

  // Convert Base UI callback to Radix-style callback
  const handleValueChange = React.useCallback(
    (newValue: (string | null)[]) => {
      if (!onValueChange) return;
      const filteredValue = newValue.filter((v): v is string => v !== null);
      if (type === "single") {
        onValueChange(filteredValue[0] || "");
      } else {
        onValueChange(filteredValue);
      }
    },
    [onValueChange, type],
  );

  // Base UI is collapsible by default, so we don't need to handle that prop
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      multiple={type === "multiple"}
      defaultValue={baseUiDefaultValue}
      value={baseUiValue}
      onValueChange={onValueChange ? handleValueChange : undefined}
      {...props}
    />
  );
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b last:border-b-0", className)}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-panel-open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Panel>) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="data-[ending-style]:animate-accordion-up data-[starting-style]:animate-accordion-down overflow-hidden text-sm"
      {...props}
    >
      <div className={cn("pt-0 pb-4", className)}>{children}</div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
