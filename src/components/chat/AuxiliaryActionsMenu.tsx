import { Plus, Paperclip, ChartColumnIncreasing } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ContextFilesPicker } from "@/components/ContextFilesPicker";
import { FileAttachmentDropdown } from "./FileAttachmentDropdown";

interface AuxiliaryActionsMenuProps {
  onFileSelect: (
    files: FileList,
    type: "chat-context" | "upload-to-codebase",
  ) => void;
  disabled?: boolean;
  showTokenBar: boolean;
  setShowTokenBar: (show: boolean) => void;
}

export function AuxiliaryActionsMenu({
  onFileSelect,
  disabled,
  showTokenBar,
  setShowTokenBar,
}: AuxiliaryActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="has-[>svg]:px-2 hover:bg-muted bg-primary/10 text-primary cursor-pointer rounded-xl"
          data-testid="auxiliary-actions-menu"
        >
          <Plus size={20} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Codebase Context */}
        <ContextFilesPicker />

        {/* Attach Files Submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-2 px-3">
            <Paperclip size={16} className="mr-2" />
            Attach files
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <FileAttachmentDropdown
              onFileSelect={onFileSelect}
              renderAsMenuItems={true}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Toggle Token Usage */}
        <DropdownMenuItem
          onClick={() => setShowTokenBar(!showTokenBar)}
          className={`py-2 px-3 group ${showTokenBar ? "bg-primary/10 text-primary" : ""}`}
        >
          <ChartColumnIncreasing
            size={16}
            className={
              showTokenBar
                ? "text-primary group-hover:text-accent-foreground"
                : ""
            }
          />
          <span className="flex-1">
            {showTokenBar ? "Hide" : "Show"} token usage
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
