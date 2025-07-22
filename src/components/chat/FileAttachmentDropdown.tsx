import { Paperclip, MessageSquare, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useRef } from "react";

interface FileAttachmentDropdownProps {
  onFileSelect: (
    files: FileList,
    type: "chat-context" | "upload-to-codebase",
  ) => void;
  disabled?: boolean;
  className?: string;
}

export function FileAttachmentDropdown({
  onFileSelect,
  disabled,
  className,
}: FileAttachmentDropdownProps) {
  const chatContextFileInputRef = useRef<HTMLInputElement>(null);
  const uploadToCodebaseFileInputRef = useRef<HTMLInputElement>(null);

  const handleChatContextClick = () => {
    chatContextFileInputRef.current?.click();
  };

  const handleUploadToCodebaseClick = () => {
    uploadToCodebaseFileInputRef.current?.click();
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "chat-context" | "upload-to-codebase",
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files, type);
      // Clear the input value so the same file can be selected again
      e.target.value = "";
    }
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  title="Attach files"
                  className={className}
                >
                  <Paperclip size={20} />
                </Button>
              </TooltipTrigger>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuItem
                      onClick={handleChatContextClick}
                      className="py-3 px-4"
                    >
                      <MessageSquare size={16} className="mr-2" />
                      Attach file as chat context
                    </DropdownMenuItem>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Example use case: screenshot of the app to point out a UI
                    issue
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuItem
                      onClick={handleUploadToCodebaseClick}
                      className="py-3 px-4"
                    >
                      <Upload size={16} className="mr-2" />
                      Upload file to codebase
                    </DropdownMenuItem>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Example use case: add an image to use for your app
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipContent>Attach files</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Hidden file inputs */}
      <input
        type="file"
        data-testid="chat-context-file-input"
        ref={chatContextFileInputRef}
        onChange={(e) => handleFileChange(e, "chat-context")}
        className="hidden"
        multiple
        accept=".jpg,.jpeg,.png,.gif,.webp,.txt,.md,.js,.ts,.html,.css,.json,.csv"
      />
      <input
        type="file"
        data-testid="upload-to-codebase-file-input"
        ref={uploadToCodebaseFileInputRef}
        onChange={(e) => handleFileChange(e, "upload-to-codebase")}
        className="hidden"
        multiple
        accept=".jpg,.jpeg,.png,.gif,.webp,.txt,.md,.js,.ts,.html,.css,.json,.csv"
      />
    </>
  );
}
