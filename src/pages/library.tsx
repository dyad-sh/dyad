import { usePrompts } from "@/hooks/usePrompts";
import { useAddPromptDeepLink } from "@/hooks/useAddPromptDeepLink";
import { CreatePromptDialog } from "@/components/CreatePromptDialog";
import { LibraryCard } from "@/components/LibraryCard";
import { useTranslation } from "react-i18next";

export default function LibraryPage() {
  const { t } = useTranslation(["home", "common"]);
  const { prompts, isLoading, createPrompt, updatePrompt, deletePrompt } =
    usePrompts();
  const { prefillData, dialogOpen, handleDialogClose } = useAddPromptDeepLink();

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold sm:text-3xl">
            {t("library.promptsTitle")}
          </h1>
          <div className="shrink-0">
            <CreatePromptDialog
              onCreatePrompt={createPrompt}
              prefillData={prefillData}
              isOpen={dialogOpen}
              onOpenChange={handleDialogClose}
            />
          </div>
        </div>

        {isLoading ? (
          <div>{t("common:loading")}</div>
        ) : prompts.length === 0 ? (
          <div className="text-muted-foreground">
            {t("library.noPromptsCreateOne")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {prompts.map((p) => (
              <LibraryCard
                key={p.id}
                item={{ type: "prompt", data: p }}
                onUpdatePrompt={updatePrompt}
                onDeletePrompt={deletePrompt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
