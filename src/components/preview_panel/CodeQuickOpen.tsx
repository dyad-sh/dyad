import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { FileTypeIcon } from "./FileTypeIcon";

interface CodeQuickOpenProps {
  files: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}

const getFileName = (path: string) => path.split("/").pop() ?? path;
const getDirectory = (path: string) => {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
};

export function CodeQuickOpen({
  files,
  open,
  onOpenChange,
  onSelect,
}: CodeQuickOpenProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quick open"
      description="Search for a file by name or path"
      className="max-w-2xl"
      data-testid="code-quick-open-dialog"
    >
      <CommandInput
        autoFocus
        placeholder="Go to file…"
        data-testid="code-quick-open-input"
      />
      <CommandList className="max-h-[min(420px,60vh)] scrollbar-on-hover">
        <CommandEmpty>No matching files.</CommandEmpty>
        <CommandGroup heading={`${files.length} files`}>
          {files.map((path) => {
            const directory = getDirectory(path);
            return (
              <CommandItem
                key={path}
                value={path}
                onSelect={() => {
                  onSelect(path);
                  onOpenChange(false);
                }}
                data-testid={`code-quick-open-item-${path}`}
              >
                <FileTypeIcon path={path} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {getFileName(path)}
                </span>
                {directory && (
                  <span className="max-w-[50%] truncate text-xs text-muted-foreground">
                    {directory}
                  </span>
                )}
                <CommandShortcut>↵</CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
