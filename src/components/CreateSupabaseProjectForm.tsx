import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  DEFAULT_SUPABASE_REGION,
  SUPABASE_REGIONS,
  type CreateSupabaseProjectParams,
  type SupabaseOrganizationInfo,
  type SupabaseProject,
  type SupabaseRegionId,
} from "@/ipc/types";
import { getErrorMessage } from "@/lib/errors";

/**
 * Creates a Supabase project from inside an app. The organization picker
 * appears only when more than one is connected, matching Supabase's own
 * new-project flow.
 */
export function CreateSupabaseProjectForm({
  appId,
  organizations,
  defaultName,
  createProject,
  isCreatingProject,
  onCreated,
  onCancel,
}: {
  appId: number;
  organizations: SupabaseOrganizationInfo[];
  defaultName: string;
  // Threaded in from the connector's `useSupabase` rather than mounting a
  // second copy, which would duplicate its queries and put the pending flag in
  // a different instance than the parent reads.
  createProject: (
    params: CreateSupabaseProjectParams,
  ) => Promise<SupabaseProject>;
  isCreatingProject: boolean;
  // Carries the app the create was launched for, which is not necessarily the
  // app on screen when it settles.
  onCreated: (
    createdForAppId: number,
    project: SupabaseProject,
  ) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["home", "common"]);

  const [name, setName] = useState(defaultName);
  const [organizationSlug, setOrganizationSlug] = useState(
    organizations[0]?.organizationSlug ?? "",
  );
  const [region, setRegion] = useState<SupabaseRegionId>(
    DEFAULT_SUPABASE_REGION,
  );
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSubmit = !!trimmedName && !!organizationSlug && !isCreatingProject;

  const handleCreate = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      const project = await createProject({
        appId,
        name: trimmedName,
        organizationSlug,
        region,
      });
      await onCreated(appId, project);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-3" data-testid="supabase-create-project-form">
      <div className="space-y-2">
        <Label htmlFor="supabase-new-project-name">
          {t("integrations.supabase.projectName")}
        </Label>
        <Input
          id="supabase-new-project-name"
          data-testid="supabase-new-project-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder="my-app"
          maxLength={64}
          autoFocus
          disabled={isCreatingProject}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleCreate();
          }}
        />
      </div>

      {organizations.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor="supabase-new-project-org">
            {t("integrations.supabase.organization")}
          </Label>
          <Select
            value={organizationSlug}
            onValueChange={(value) => setOrganizationSlug(value ?? "")}
            disabled={isCreatingProject}
          >
            <SelectTrigger
              id="supabase-new-project-org"
              data-testid="supabase-new-project-org"
            >
              <SelectValue
                placeholder={t("integrations.supabase.selectOrganization")}
              />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((org) => (
                <SelectItem
                  key={org.organizationSlug}
                  value={org.organizationSlug}
                >
                  {org.name ||
                    `Organization ${org.organizationSlug.slice(0, 8)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="supabase-new-project-region">
          {t("integrations.supabase.region")}
        </Label>
        <Select
          value={region}
          onValueChange={(value) => setRegion(value as SupabaseRegionId)}
          disabled={isCreatingProject}
        >
          <SelectTrigger
            id="supabase-new-project-region"
            data-testid="supabase-new-project-region"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPABASE_REGIONS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("integrations.supabase.regionDescription")}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={!canSubmit}
          data-testid="supabase-create-project-submit"
        >
          {isCreatingProject && (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          )}
          {isCreatingProject
            ? t("integrations.supabase.creatingProject")
            : t("integrations.supabase.createProject")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={isCreatingProject}
        >
          {t("common:cancel")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("integrations.supabase.createProjectDescription")}
      </p>
    </div>
  );
}
