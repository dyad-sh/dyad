import { useState, useEffect } from "react";
import { X, Move, Maximize2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComponentSelection } from "@/ipc/ipc_types";

interface VisualEditingSidebarProps {
  selectedComponent: ComponentSelection | null;
  onClose: () => void;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

export function VisualEditingSidebar({
  selectedComponent,
  onClose,
  iframeRef,
}: VisualEditingSidebarProps) {
  // Visual editing current values state - using x/y axis instead of individual sides
  const [currentMargin, setCurrentMargin] = useState({ x: "", y: "" });
  const [currentPadding, setCurrentPadding] = useState({ x: "", y: "" });
  const [currentDimensions, setCurrentDimensions] = useState({
    width: "",
    height: "",
  });

  // Function to get current styles from selected element
  const getCurrentElementStyles = () => {
    if (!iframeRef.current?.contentWindow || !selectedComponent) return;

    try {
      // Send message to iframe to get current styles
      iframeRef.current.contentWindow.postMessage(
        {
          type: "get-dyad-component-styles",
          data: {
            elementId: selectedComponent.id,
          },
        },
        "*",
      );
    } catch (error) {
      console.error("Failed to get element styles:", error);
    }
  };

  // Get current styles when component changes
  useEffect(() => {
    if (selectedComponent) {
      getCurrentElementStyles();
    }
  }, [selectedComponent]);

  // Listen for style responses from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "dyad-component-styles") {
        const { margin, padding, dimensions } = event.data.data;

        // Convert individual sides to x/y axis values
        // For x/y, we use the value if left/right or top/bottom are the same, otherwise leave empty
        const marginX = margin?.left === margin?.right ? margin.left : "";
        const marginY = margin?.top === margin?.bottom ? margin.top : "";
        const paddingX = padding?.left === padding?.right ? padding.left : "";
        const paddingY = padding?.top === padding?.bottom ? padding.top : "";

        setCurrentMargin({ x: marginX, y: marginY });
        setCurrentPadding({ x: paddingX, y: paddingY });
        setCurrentDimensions(dimensions || { width: "", height: "" });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Handle margin changes
  const handleMarginChange = (axis: "x" | "y", value: string) => {
    setCurrentMargin((prev) => ({ ...prev, [axis]: value }));

    if (iframeRef.current?.contentWindow && value) {
      // Auto-append 'px' if not present and value is numeric
      const processedValue = /^\d+$/.test(value) ? `${value}px` : value;

      // Convert x/y to left/right or top/bottom
      const marginData =
        axis === "x"
          ? { left: processedValue, right: processedValue }
          : { top: processedValue, bottom: processedValue };

      iframeRef.current.contentWindow.postMessage(
        {
          type: "modify-dyad-component-margin",
          data: {
            elementId: selectedComponent?.id,
            margin: marginData,
          },
        },
        "*",
      );

      // Update overlay positions after style change
      iframeRef.current.contentWindow.postMessage(
        {
          type: "update-dyad-overlay-positions",
        },
        "*",
      );
    }
  };

  // Handle padding changes
  const handlePaddingChange = (axis: "x" | "y", value: string) => {
    setCurrentPadding((prev) => ({ ...prev, [axis]: value }));

    if (iframeRef.current?.contentWindow && value) {
      // Auto-append 'px' if not present and value is numeric
      const processedValue = /^\d+$/.test(value) ? `${value}px` : value;

      // Convert x/y to left/right or top/bottom
      const paddingData =
        axis === "x"
          ? { left: processedValue, right: processedValue }
          : { top: processedValue, bottom: processedValue };

      iframeRef.current.contentWindow.postMessage(
        {
          type: "modify-dyad-component-padding",
          data: {
            elementId: selectedComponent?.id,
            padding: paddingData,
          },
        },
        "*",
      );

      // Update overlay positions after style change
      iframeRef.current.contentWindow.postMessage(
        {
          type: "update-dyad-overlay-positions",
        },
        "*",
      );
    }
  };

  // Handle dimension changes
  const handleDimensionChange = (
    property: "width" | "height",
    value: string,
  ) => {
    setCurrentDimensions((prev) => ({ ...prev, [property]: value }));

    if (iframeRef.current?.contentWindow && value) {
      // Auto-append 'px' if not present, value is numeric, and doesn't contain % or other units
      const processedValue =
        /^\d+$/.test(value) && !/%|auto|inherit|initial|unset/.test(value)
          ? `${value}px`
          : value;

      iframeRef.current.contentWindow.postMessage(
        {
          type: "modify-dyad-component-dimension",
          data: {
            elementId: selectedComponent?.id,
            dimensions: { [property]: processedValue },
          },
        },
        "*",
      );

      // Update overlay positions after style change
      iframeRef.current.contentWindow.postMessage(
        {
          type: "update-dyad-overlay-positions",
        },
        "*",
      );
    }
  };

  if (!selectedComponent) return null;

  return (
    <div className="absolute top-4 right-4 w-14 h-1/2 bg-[var(--background)] border-l border-[var(--border)] rounded-md shadow-lg z-50 flex flex-col items-center py-2 gap-1">
      {/* Close button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 dark:text-gray-300"
            >
              <X size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>Close</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <div className="w-8 border-t border-[var(--border)] my-1" />

      {/* Margin Control */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            style={{ color: "#7f22fe" }}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Move size={16} />
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Margin</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </button>
        </PopoverTrigger>
        <PopoverContent side="left" className="w-64">
          <div className="space-y-3">
            <h4 className="font-medium text-sm" style={{ color: "#7f22fe" }}>
              Margin
            </h4>
            <div className="grid grid-cols-1 gap-2">
              <div>
                <Label htmlFor="margin-x" className="text-xs">
                  Horizontal (X)
                </Label>
                <Input
                  id="margin-x"
                  type="number"
                  placeholder="10"
                  className="mt-1 h-8 text-xs"
                  value={currentMargin.x.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handleMarginChange("x", e.target.value)}
                  step="1"
                />
              </div>
              <div>
                <Label htmlFor="margin-y" className="text-xs">
                  Vertical (Y)
                </Label>
                <Input
                  id="margin-y"
                  type="number"
                  placeholder="10"
                  className="mt-1 h-8 text-xs"
                  value={currentMargin.y.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handleMarginChange("y", e.target.value)}
                  step="1"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Padding Control */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            style={{ color: "#7f22fe" }}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <rect x="7" y="7" width="10" height="10" rx="1" />
                  </svg>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Padding</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </button>
        </PopoverTrigger>
        <PopoverContent side="left" className="w-64">
          <div className="space-y-3">
            <h4 className="font-medium text-sm" style={{ color: "#7f22fe" }}>
              Padding
            </h4>
            <div className="grid grid-cols-1 gap-2">
              <div>
                <Label htmlFor="padding-x" className="text-xs">
                  Horizontal (X)
                </Label>
                <Input
                  id="padding-x"
                  type="number"
                  placeholder="10"
                  className="mt-1 h-8 text-xs"
                  value={currentPadding.x.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handlePaddingChange("x", e.target.value)}
                  step="1"
                  min="0"
                />
              </div>
              <div>
                <Label htmlFor="padding-y" className="text-xs">
                  Vertical (Y)
                </Label>
                <Input
                  id="padding-y"
                  type="number"
                  placeholder="10"
                  className="mt-1 h-8 text-xs"
                  value={currentPadding.y.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handlePaddingChange("y", e.target.value)}
                  step="1"
                  min="0"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Dimensions Control */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            style={{ color: "#7f22fe" }}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Maximize2 size={16} />
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Dimensions</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </button>
        </PopoverTrigger>
        <PopoverContent side="left" className="w-64">
          <div className="space-y-3">
            <h4 className="font-medium text-sm" style={{ color: "#7f22fe" }}>
              Dimensions
            </h4>
            <div className="space-y-2">
              <div>
                <Label htmlFor="width" className="text-xs">
                  Width
                </Label>
                <Input
                  id="width"
                  type="number"
                  placeholder="100"
                  className="mt-1 h-8 text-xs"
                  value={currentDimensions.width.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) =>
                    handleDimensionChange("width", e.target.value)
                  }
                  step="1"
                  min="0"
                />
              </div>
              <div>
                <Label htmlFor="height" className="text-xs">
                  Height
                </Label>
                <Input
                  id="height"
                  type="number"
                  placeholder="100"
                  className="mt-1 h-8 text-xs"
                  value={currentDimensions.height.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) =>
                    handleDimensionChange("height", e.target.value)
                  }
                  step="1"
                  min="0"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
