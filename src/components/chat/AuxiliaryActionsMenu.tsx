import { useState } from "react";
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
  showTokenBar?: boolean;
  toggleShowTokenBar?: () => void;
  showContextFilesPicker?: boolean;
  isStreaming?: boolean;
}

export function AuxiliaryActionsMenu({
  onFileSelect,
  showTokenBar,
  toggleShowTokenBar,
  showContextFilesPicker = true,
  isStreaming = false,
}: AuxiliaryActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="has-[>svg]:px-2 hover:bg-muted bg-primary/10 text-primary cursor-pointer rounded-xl"
          data-testid="auxiliary-actions-menu"
        >
          <Plus
            size={20}
            className={`transition-transform duration-200 ${isOpen ? "rotate-45" : "rotate-0"}`}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Codebase Context */}
        {showContextFilesPicker && <ContextFilesPicker />}

        {/* Attach Files Submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-2 px-3" disabled={isStreaming}>
            <Paperclip size={16} className="mr-2" />
            Attach files
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <FileAttachmentDropdown
              onFileSelect={onFileSelect}
              onMenuClose={() => setIsOpen(false)}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Toggle Token Usage */}
        {toggleShowTokenBar !== undefined && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={toggleShowTokenBar}
              className={`py-2 px-3 group ${showTokenBar ? "bg-primary/10 text-primary" : ""}`}
              data-testid="token-bar-toggle"
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
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
