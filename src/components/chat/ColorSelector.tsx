import { Paintbrush, CheckIcon } from "lucide-react";
import { useAtom } from "jotai";
import { selectedColorIdAtom } from "@/atoms/chatAtoms";
import { APP_COLORS } from "@/data/colors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function ColorSelector() {
  const [selectedColorId, setSelectedColorId] = useAtom(selectedColorIdAtom);

  const selectedColor = APP_COLORS.find((c) => c.id === selectedColorId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          data-testid="color-selector-trigger"
        >
          <Paintbrush className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {selectedColor?.name || "Color"}
          </span>
          {selectedColor && (
            <div
              className="w-3 h-3 rounded-full border border-border ml-1"
              style={{ backgroundColor: selectedColor.hex }}
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>Primary Color</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setSelectedColorId(null)}
          className="flex items-center gap-2 py-2"
          data-testid="color-option-none"
        >
          <div className="w-4 h-4 rounded-full border border-dashed border-muted-foreground" />
          <span className="flex-1">Default</span>
          {selectedColorId === null && (
            <CheckIcon className="h-3.5 w-3.5 text-primary" />
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {APP_COLORS.map((color) => (
          <DropdownMenuItem
            key={color.id}
            onClick={() => setSelectedColorId(color.id)}
            className="flex items-center gap-2 py-2"
            data-testid={`color-option-${color.id}`}
          >
            <div
              className="w-4 h-4 rounded-full border border-border"
              style={{ backgroundColor: color.hex }}
            />
            <span className="flex-1">{color.name}</span>
            {color.id === selectedColorId && (
              <CheckIcon className="h-3.5 w-3.5 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
