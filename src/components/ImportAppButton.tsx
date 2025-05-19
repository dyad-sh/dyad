import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { useState } from "react";
import { ImportAppDialog } from "./ImportAppDialog";

export function ImportAppButton() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <div className="px-4 pb-1 flex justify-center">
        <Button
          variant="default"
          size="default"
          onClick={() => setIsDialogOpen(true)}
        >
          <Upload className="mr-2 h-4 w-4" />
          Import App
        </Button>
      </div>
      <ImportAppDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
      />
    </>
  );
}
