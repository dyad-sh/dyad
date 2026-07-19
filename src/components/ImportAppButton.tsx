import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { useState } from "react";
import { ImportAppDialog } from "./ImportAppDialog";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export function ImportAppButton({
  className,
  variant = "default",
  size = "default",
}: {
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const { t } = useTranslation("home");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <div className={cn("px-4 pb-1 flex justify-center", className)}>
        <Button
          variant={variant}
          size={size}
          onClick={() => setIsDialogOpen(true)}
        >
          <Upload className="mr-2 h-4 w-4" />
          {t("importApp")}
        </Button>
      </div>
      <ImportAppDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
      />
    </>
  );
}
