import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Context menu using Base UI Menu primitives.
 * Opens on right-click instead of left-click.
 */

interface ContextMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorPosition: { x: number; y: number } | null;
  setAnchorPosition: (pos: { x: number; y: number } | null) => void;
}

const ContextMenuContext = React.createContext<ContextMenuContextValue | null>(
  null,
);

function useContextMenu() {
  const ctx = React.useContext(ContextMenuContext);
  if (!ctx)
    throw new Error("ContextMenu components must be used within ContextMenu");
  return ctx;
}

function ContextMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [anchorPosition, setAnchorPosition] = React.useState<{
    x: number;
    y: number;
  } | null>(null);

  const contextValue = React.useMemo(
    () => ({ open, setOpen, anchorPosition, setAnchorPosition }),
    [open, anchorPosition],
  );

  return (
    <ContextMenuContext.Provider value={contextValue}>
      <MenuPrimitive.Root
        open={open}
        onOpenChange={setOpen}
        data-slot="context-menu"
      >
        {children}
      </MenuPrimitive.Root>
    </ContextMenuContext.Provider>
  );
}

interface ContextMenuTriggerProps {
  children: React.ReactElement;
  asChild?: boolean;
}

function ContextMenuTrigger({ children, asChild }: ContextMenuTriggerProps) {
  const { setOpen, setAnchorPosition } = useContextMenu();

  const handleContextMenu = React.useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setAnchorPosition({ x: event.clientX, y: event.clientY });
      setOpen(true);
    },
    [setOpen, setAnchorPosition],
  );

  // When asChild is true, we clone the child element and add our context menu handler
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onContextMenu: (event: React.MouseEvent) => {
        handleContextMenu(event);
        // Call the original handler if it exists
        const originalHandler = (children as React.ReactElement<any>).props
          ?.onContextMenu;
        if (originalHandler) originalHandler(event);
      },
    });
  }

  return (
    <div data-slot="context-menu-trigger" onContextMenu={handleContextMenu}>
      {children}
    </div>
  );
}

function ContextMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="context-menu-portal" {...props} />;
}

interface ContextMenuContentProps extends MenuPrimitive.Popup.Props {
  sideOffset?: number;
}

function ContextMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ContextMenuContentProps) {
  const { anchorPosition } = useContextMenu();

  // Custom anchor that positions at mouse cursor
  const anchor = React.useMemo(() => {
    if (!anchorPosition) return undefined;
    return {
      getBoundingClientRect: () => ({
        x: anchorPosition.x,
        y: anchorPosition.y,
        width: 0,
        height: 0,
        top: anchorPosition.y,
        right: anchorPosition.x,
        bottom: anchorPosition.y,
        left: anchorPosition.x,
        toJSON: () => ({}),
      }),
    };
  }, [anchorPosition]);

  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function ContextMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-1 rounded-sm px-2 py-1 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function ContextMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />
  );
}

function ContextMenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & {
  inset?: boolean;
}) {
  return (
    <div
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />;
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      openOnHover={false}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function ContextMenuSubContent({
  className,
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="context-menu-sub-content"
          className={cn(
            "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border p-1 shadow-lg",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
};
