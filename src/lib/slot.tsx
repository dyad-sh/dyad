import * as React from "react";

/**
 * A simple Slot component that merges its props with its child element.
 * This is a simplified implementation to support the asChild pattern.
 */
function Slot({
  children,
  ...props
}: React.PropsWithChildren<React.HTMLAttributes<HTMLElement>> & {
  [key: string]: unknown;
}) {
  if (React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<Record<string, unknown>>,
      {
        ...props,
        ...(children as React.ReactElement<Record<string, unknown>>).props,
        className: [
          props.className,
          (children as React.ReactElement<{ className?: string }>).props
            .className,
        ]
          .filter(Boolean)
          .join(" "),
      },
    );
  }

  if (React.Children.count(children) > 1) {
    React.Children.only(null);
  }

  return null;
}

/**
 * Helper to convert asChild pattern to Base UI's render prop pattern.
 * For Base UI, when asChild is true, we use the render prop with the child element.
 */
function getRenderProps(
  asChild: boolean | undefined,
  children: React.ReactNode,
): {
  render?: React.ReactElement;
  children?: React.ReactNode;
} {
  if (asChild && React.isValidElement(children)) {
    return { render: children as React.ReactElement };
  }
  return { children };
}

export { Slot, getRenderProps };
