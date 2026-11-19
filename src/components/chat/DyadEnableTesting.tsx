import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import { FlaskConical } from "lucide-react";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { Button } from "@/components/ui/button";
import {
  usePendingEnableTesting,
  useUserInputReadModel,
} from "@/user_input/hooks";
import type { PendingEnableTesting } from "@/user_input/selectors";
import { DyadCard, DyadCardHeader } from "./DyadCardPrimitives";

export interface DyadEnableTestingProps {
  requestId?: string;
  outcome?: "pending" | "enabled" | "declined" | "dismissed";
}

export function DyadEnableTesting({
  requestId,
  outcome,
}: DyadEnableTestingProps) {
  const { t } = useTranslation("chat");
  const chatId = useAtomValue(selectedChatIdAtom);
  const requests = usePendingEnableTesting();
  const pending = chatId != null ? requests.get(chatId) : undefined;

  if (outcome === "enabled" || outcome === "declined") {
    return (
      <DyadCard
        state="finished"
        accentColor={outcome === "enabled" ? "green" : "slate"}
      >
        <DyadCardHeader
          icon={<FlaskConical size={15} />}
          accentColor={outcome === "enabled" ? "green" : "slate"}
        >
          <span className="text-sm font-medium text-foreground">
            {outcome === "enabled"
              ? t("enableTesting.enabled")
              : t("enableTesting.declined")}
          </span>
        </DyadCardHeader>
      </DyadCard>
    );
  }
  if (outcome !== "pending" || !pending || pending.requestId !== requestId)
    return null;
  return <PendingTestingCard key={requestId} pending={pending} />;
}

function PendingTestingCard({ pending }: { pending: PendingEnableTesting }) {
  const { t } = useTranslation("chat");
  const readModel = useUserInputReadModel();
  const [failed, setFailed] = useState(false);
  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      readModel.respond(pending.requestId, { kind: "enable-testing", enabled }),
    onMutate: () => setFailed(false),
    onSuccess: (responded) => setFailed(!responded),
    onError: () => setFailed(true),
  });
  const busy = pending.isResponding || mutation.isPending;
  return (
    <DyadCard data-testid="enable-testing-card" showAccent={false}>
      <DyadCardHeader icon={<FlaskConical size={15} />}>
        <span className="text-sm font-semibold text-foreground">
          {t("enableTesting.title")}
        </span>
      </DyadCardHeader>
      <div className="flex flex-col gap-3 px-3 pb-3">
        <p className="text-sm text-foreground">
          {t("enableTesting.description")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("enableTesting.scope")}
        </p>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t("enableTesting.failed")}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => mutation.mutate(false)}
          >
            {t("enableTesting.notNow")}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => mutation.mutate(true)}
          >
            {busy && mutation.variables
              ? t("enableTesting.enabling")
              : t("enableTesting.enable")}
          </Button>
        </div>
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {busy ? t("enableTesting.saving") : t("enableTesting.waiting")}
        </p>
      </div>
    </DyadCard>
  );
}
