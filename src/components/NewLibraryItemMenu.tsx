import { Palette, FileText, Plus, ChevronDown, ImagePlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NewLibraryItemMenu({
  onNewPrompt,
  onNewTheme,
  onNewImage,
}: {
  onNewPrompt: () => void;
  onNewTheme: () => void;
  onNewImage: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors">
        <Plus className="h-4 w-4" />
        New
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onNewPrompt}>
          <FileText className="mr-2 h-4 w-4" />
          New Prompt
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewTheme}>
          <Palette className="mr-2 h-4 w-4" />
          New Theme
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewImage}>
          <ImagePlus className="mr-2 h-4 w-4" />
          Generate Image
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
