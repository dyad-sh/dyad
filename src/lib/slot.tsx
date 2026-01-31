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
    const childProps = (children as React.ReactElement<Record<string, unknown>>)
      .props;
    // Destructure children and ref from childProps
    const {
      children: childChildren,
      ref: childRef,
      ...restChildProps
    } = childProps as {
      children?: React.ReactNode;
      ref?: React.Ref<unknown>;
      [key: string]: unknown;
    };

    // Extract ref from props if it exists
    const { ref: propsRef, ...restProps } = props as {
      ref?: React.Ref<unknown>;
      [key: string]: unknown;
    };

    // Compose refs - child props override parent props, but refs need to be merged
    const composedRef = React.useMemo(() => {
      if (!propsRef && !childRef) return undefined;
      return (node: unknown) => {
        // Call parent ref first
        if (typeof propsRef === "function") {
          propsRef(node);
        } else if (
          propsRef &&
          typeof propsRef === "object" &&
          "current" in propsRef
        ) {
          (propsRef as React.MutableRefObject<unknown>).current = node;
        }
        // Then call child ref
        if (typeof childRef === "function") {
          childRef(node);
        } else if (
          childRef &&
          typeof childRef === "object" &&
          "current" in childRef
        ) {
          (childRef as React.MutableRefObject<unknown>).current = node;
        }
      };
    }, [propsRef, childRef]);

    return React.cloneElement(
      children as React.ReactElement<Record<string, unknown>>,
      {
        ...restProps,
        ...restChildProps,
        ref: composedRef,
        className: [
          restProps.className,
          (children as React.ReactElement<{ className?: string }>).props
            .className,
        ]
          .filter(Boolean)
          .join(" "),
      },
      childChildren,
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
