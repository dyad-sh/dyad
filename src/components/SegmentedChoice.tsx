import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A two-or-more-way choice rendered as one joined row of buttons.
 *
 * Extracted because the same markup had been copied three times — the
 * provider choice and both connectors' create/existing toggles — and none of
 * the copies told a screen reader which side was selected. The selection is
 * the whole point of the control: it decides the form rendered below it, and
 * carrying it in a background colour alone left that invisible to anyone
 * using a screen reader, high contrast, or forced colors. Fixing that once
 * here is the reason to have a component rather than a fourth copy.
 */
export interface SegmentedChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  testId?: string;
  disabled?: boolean;
}

export function SegmentedChoice<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  testId,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedChoiceOption<T>>;
  /** Names the choice for assistive technology, e.g. "Repository provider". */
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className="flex rounded-md border border-gray-200 dark:border-gray-700"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Button
            key={option.value}
            type="button"
            // Toggle buttons rather than a radiogroup: these keep the button
            // role every existing selector and screen-reader habit expects,
            // and aria-pressed is what carries the selection either way.
            aria-pressed={selected}
            variant={selected ? "default" : "ghost"}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            data-testid={option.testId}
            className={cn(
              "flex-1 rounded-none border-0",
              index === 0 && "rounded-l-md",
              index === options.length - 1 && "rounded-r-md",
              index > 0 && "border-l border-gray-200 dark:border-gray-700",
              selected
                ? "bg-primary text-primary-foreground"
                : "hover:bg-gray-50 dark:hover:bg-gray-800",
            )}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
