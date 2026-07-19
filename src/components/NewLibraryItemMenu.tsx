import { Palette, FileText, Plus, ChevronDown, ImagePlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";

export function NewLibraryItemMenu({
  onNewPrompt,
  onNewTheme,
  onNewImage,
}: {
  onNewPrompt: () => void;
  onNewTheme: () => void;
  onNewImage: () => void;
}) {
  const { t } = useTranslation("home");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors">
        <Plus className="h-4 w-4" />
        {t("library.new")}
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onNewPrompt}>
          <FileText className="mr-2 h-4 w-4" />
          {t("library.newPrompt")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewTheme}>
          <Palette className="mr-2 h-4 w-4" />
          {t("library.newTheme")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewImage}>
          <ImagePlus className="mr-2 h-4 w-4" />
          {t("library.generateImage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
