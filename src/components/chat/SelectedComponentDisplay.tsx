import {
  selectedComponentsPreviewAtom,
  previewIframeRefAtom,
  visualEditingSelectedComponentAtom,
} from "@/atoms/previewAtoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Code2, X } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function SelectedComponentsDisplay() {
  const [selectedComponents, setSelectedComponents] = useAtom(
    selectedComponentsPreviewAtom,
  );
  const previewIframeRef = useAtomValue(previewIframeRefAtom);
  const setVisualEditingSelectedComponent = useSetAtom(
    visualEditingSelectedComponentAtom,
  );

  const handleRemoveComponent = (index: number) => {
    const componentToRemove = selectedComponents[index];
    const newComponents = selectedComponents.filter((_, i) => i !== index);
    setSelectedComponents(newComponents);
    setVisualEditingSelectedComponent(null);

    // Remove the specific overlay from the iframe
    if (previewIframeRef?.contentWindow) {
      previewIframeRef.contentWindow.postMessage(
        {
          type: "remove-dyad-component-overlay",
          componentId: componentToRemove.id,
        },
        "*",
      );
    }
  };

  const handleClearAll = () => {
    setSelectedComponents([]);
    setVisualEditingSelectedComponent(null);
    if (previewIframeRef?.contentWindow) {
      previewIframeRef.contentWindow.postMessage(
        { type: "clear-dyad-component-overlays" },
        "*",
      );
    }
  };

  if (!selectedComponents || selectedComponents.length === 0) {
    return null;
  }

  return (
    <div
      className="p-2 pb-1 max-h-[180px] overflow-y-auto"
      data-testid="selected-component-display"
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-medium text-muted-foreground">
          Selected Components ({selectedComponents.length})
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={handleClearAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              />
            }
          >
            Clear all
          </TooltipTrigger>
          <TooltipContent>Clear all selected components</TooltipContent>
        </Tooltip>
      </div>
      {selectedComponents.map((selectedComponent, index) => (
        <div key={selectedComponent.id} className="mb-1 last:mb-0">
          <div className="flex items-center justify-between rounded-md bg-indigo-600/10 px-2 py-1 text-sm">
            <div className="flex items-center gap-2 overflow-hidden">
              <Code2
                size={16}
                className="flex-shrink-0 text-indigo-600 dark:text-indigo-400"
              />
              <div className="flex flex-col overflow-hidden">
                <span
                  className="truncate font-medium text-indigo-800 dark:text-indigo-300"
                  title={selectedComponent.name}
                >
                  {selectedComponent.name}
                </span>
                <span
                  className="truncate text-xs text-indigo-600/80 dark:text-indigo-400/80"
                  title={`${selectedComponent.relativePath}:${selectedComponent.lineNumber}`}
                >
                  {selectedComponent.relativePath}:
                  {selectedComponent.lineNumber}
                </span>
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => handleRemoveComponent(index)}
                    aria-label="Deselect component"
                    className="ml-2 flex-shrink-0 rounded-full p-0.5 hover:bg-indigo-600/20"
                  />
                }
              >
                <X size={18} className="text-indigo-600 dark:text-indigo-400" />
              </TooltipTrigger>
              <TooltipContent>Deselect component</TooltipContent>
            </Tooltip>
          </div>
        </div>
      ))}
    </div>
  );
}
