import { useState } from "react";
import { ExternalLink, Info, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type App } from "@/ipc/types";
import { getErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "@/hooks/useSettings";
import { sendsKeysUnencrypted } from "@/shared/supabase_self_hosted_url";
import {
  useAddSupabaseSelfHostedInstance,
  useRemoveSupabaseSelfHostedInstance,
  useSupabaseSelfHostedInstances,
} from "@/hooks/useSupabaseSelfHosted";

// Experimental UI: English only, like the other experiment surfaces.

const EMAIL_NOTE =
  "Email isn't set up by default on self-hosted Supabase. To use email sign-up, configure SMTP on your instance.";

const FUNCTIONS_HELP: Record<"enabled" | "notEnabled", HelpLine[]> = {
  enabled: [
    {
      text: "Dyad deploys this app's edge functions to the instance over SSH.",
    },
    {
      text: "An update can take a few minutes to go live, longer than on Supabase Cloud.",
    },
  ],
  notEnabled: [
    {
      text: "The instance was added without SSH access, so edge function code is saved but doesn't run.",
    },
    {
      text: "To enable them, remove the instance in Settings and add it again with edge functions turned on.",
    },
  ],
};

const SMTP_HELP: HelpLine[] = [
  {
    text: "Sign-up confirmation emails, magic links and password resets need a mail server.",
  },
  {
    install: "Docker Compose",
    text: "set the SMTP_ variables in your .env file, then run docker compose up -d auth.",
  },
  {
    install: "Coolify",
    text: "set the SMTP_ variables in the Supabase service's Environment Variables, then restart the service.",
  },
  {
    text: "For testing, ENABLE_EMAIL_AUTOCONFIRM=true signs new users in without email, but skips verifying their address.",
  },
];

type EmailStatus = Awaited<
  ReturnType<typeof ipc.supabase.getSelfHostedEmailStatus>
>;

/** The email row's value and explanation; null shows the requirement instead. */
function emailRow(
  status: EmailStatus | undefined,
): { value: string; help: HelpLine[] } | null {
  switch (status?.kind) {
    case undefined:
      return { value: "Checking", help: SMTP_HELP };
    case "autoconfirm":
      return {
        value: "Sign-ups confirm without email",
        help: [
          {
            text: "ENABLE_EMAIL_AUTOCONFIRM is on, so new users are signed in without confirming their email address.",
          },
          { text: "Magic links and password resets still need SMTP." },
        ],
      };
    case "not-configured":
      return { value: "SMTP not configured", help: SMTP_HELP };
    case "configured":
      if (status.brokenLinkOrigin) {
        return {
          value: "SMTP configured, but email links won't work",
          help: [
            {
              text: `Links in emails point to ${status.brokenLinkOrigin}, which isn't this instance's URL, so confirmation links, magic links and password resets won't open.`,
            },
            {
              install: "Docker Compose",
              text: "set API_EXTERNAL_URL in your .env file to the instance's public URL, then run docker compose up -d auth.",
            },
            {
              install: "Coolify",
              text: "set API_EXTERNAL_URL in the Supabase service's Environment Variables to SERVICE_URL_SUPABASEKONG, then restart the service.",
            },
          ],
        };
      }
      return {
        value: `SMTP configured (${status.host})`,
        help: [
          {
            text: "A mail server is set. Dyad can't check that its emails arrive.",
          },
        ],
      };
    case "unknown":
      return null;
  }
}

function InstanceDetails({
  projectId,
  ssh,
}: {
  projectId: string;
  ssh: NonNullable<App["supabaseSelfHosted"]>["ssh"];
}) {
  const { data: emailStatus, isError } = useQuery({
    queryKey: queryKeys.supabase.selfHostedEmailStatus({ projectId }),
    queryFn: () => ipc.supabase.getSelfHostedEmailStatus({ projectId }),
    // The server can change at any time, so this is never cached for long.
    staleTime: 0,
    retry: false,
  });
  const email = emailRow(isError ? { kind: "unknown" } : emailStatus);
  return (
    <div
      className="space-y-2 text-sm"
      data-testid="supabase-self-hosted-details"
    >
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">Edge functions</dt>
        <dd className="flex items-center gap-1.5">
          {ssh ? "Enabled" : "Not enabled"}
          <FieldHelp
            label="Edge functions"
            lines={ssh ? FUNCTIONS_HELP.enabled : FUNCTIONS_HELP.notEnabled}
          />
        </dd>
        {email && (
          <>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{email.value}</span>
              <FieldHelp label="Email" lines={email.help} />
            </dd>
          </>
        )}
      </dl>
      {!email && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Email sign-up requires SMTP to be configured on your server.
          <FieldHelp label="Email" lines={SMTP_HELP} />
        </p>
      )}
    </div>
  );
}

/** The API URL's host, which is usually the server to SSH into. */
function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return "";
  }
}

async function linkApp(appId: number, projectId: string) {
  await ipc.supabase.setAppProject({
    appId,
    projectId,
    organizationSlug: null,
  });
}

/** Shown in place of the Cloud connector when the app uses a self-hosted instance. */
export function SupabaseSelfHostedConnectedCard({
  app,
  onChanged,
}: {
  app: App & { supabaseSelfHosted: NonNullable<App["supabaseSelfHosted"]> };
  onChanged: () => Promise<unknown>;
}) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const queryClient = useQueryClient();
  const instance = app.supabaseSelfHosted;

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await ipc.supabase.unsetAppProject({ app: app.id });
      // Each instance's list of linked apps has changed.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.selfHostedInstances,
      });
      toast.success("Disconnected the self-hosted Supabase instance");
      await onChanged();
    } catch (error) {
      toast.error(`Failed to disconnect: ${getErrorMessage(error)}`);
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <Card
      key="supabase-self-hosted-connected"
      className="mt-1"
      data-testid="supabase-self-hosted-connected-card"
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Supabase (self-hosted)
          {instance.studioUrl && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => ipc.system.openExternalUrl(instance.studioUrl!)}
            >
              Studio
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </CardTitle>
        <CardDescription className="flex flex-col gap-1.5 text-sm">
          Connected to instance
          <Badge variant="secondary" className="w-fit text-base font-bold">
            {instance.name}
          </Badge>
          <span className="break-all text-xs">{instance.url}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <InstanceDetails
          projectId={app.supabaseProjectId!}
          ssh={instance.ssh}
        />
        <Button
          variant="destructive"
          onClick={handleDisconnect}
          disabled={isDisconnecting}
        >
          Disconnect instance
        </Button>
      </CardContent>
    </Card>
  );
}

type HelpLine = { install?: "Docker Compose" | "Coolify"; text: string };

/** What each field is and where to find it on the two installs Dyad supports. */
const FIELD_HELP: Partial<Record<keyof typeof EMPTY_FORM, HelpLine[]>> = {
  url: [
    {
      install: "Docker Compose",
      text: "SUPABASE_PUBLIC_URL in your .env file, for example http://your-server:8000.",
    },
    {
      install: "Coolify",
      text: "SERVICE_URL_SUPABASEKONG in the Supabase service's Environment Variables.",
    },
  ],
  anonKey: [
    { install: "Docker Compose", text: "ANON_KEY in your .env file." },
    {
      install: "Coolify",
      text: "SERVICE_SUPABASEANON_KEY in the Supabase service's Environment Variables.",
    },
  ],
  serviceKey: [
    { install: "Docker Compose", text: "SERVICE_ROLE_KEY in your .env file." },
    {
      install: "Coolify",
      text: "SERVICE_SUPABASESERVICE_KEY in the Supabase service's Environment Variables.",
    },
  ],
  studioUrl: [
    {
      text: "Lets you open your instance's dashboard from Dyad. Usually the same as the API URL.",
    },
    {
      install: "Docker Compose",
      text: "sign in with DASHBOARD_USERNAME and DASHBOARD_PASSWORD from your .env file.",
    },
    {
      install: "Coolify",
      text: "sign in with SERVICE_USER_ADMIN and SERVICE_PASSWORD_ADMIN from the service's Environment Variables.",
    },
  ],
  sshHost: [
    {
      text: "The server Supabase runs on. Leave it empty to use the API URL's host.",
    },
  ],
  sshUsername: [
    {
      text: "A user that can run docker without sudo: root, or a user in the docker group (usermod -aG docker <user>).",
    },
  ],
  sshPrivateKey: [
    {
      text: "A private key without a passphrase, whose public key is in the user's ~/.ssh/authorized_keys on the server.",
    },
    {
      install: "Coolify",
      text: "the server's key is under Keys & Tokens, then Private Keys.",
    },
  ],
};

function FieldHelp({ label, lines }: { label: string; lines: HelpLine[] }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`About ${label}`}
          />
        }
      >
        <Info className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm space-y-1">
        {lines.map((line) => (
          <p key={`${line.install}:${line.text}`}>
            {line.install && <strong>{line.install}:</strong>} {line.text}
          </p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function FieldLabel({
  htmlFor,
  label,
  field,
}: {
  htmlFor: string;
  label: string;
  field: keyof typeof EMPTY_FORM;
}) {
  const lines = FIELD_HELP[field];
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {lines && <FieldHelp label={label} lines={lines} />}
    </div>
  );
}

type CoolifyImport = Awaited<
  ReturnType<typeof ipc.supabase.importCoolifySupabaseService>
>;

function importNote(imported: CoolifyImport): string {
  if (!imported.ssh) {
    return "Filled in from Coolify. Dyad couldn't tell which server runs this service, so enter SSH details yourself to enable edge functions.";
  }
  const target = `${imported.ssh.username}@${imported.ssh.host}`;
  return imported.ssh.privateKey
    ? `Filled in from Coolify. Edge functions will connect as ${target} with Coolify's SSH key for that server.`
    : `Filled in from Coolify. None of Coolify's SSH keys logged in as ${target}, so paste a key to enable edge functions. Reading keys needs a Coolify API token with the root permission.`;
}

/** Fills the add form from a Supabase service deployed with Coolify. */
function CoolifyImportPicker({
  onImported,
}: {
  onImported: (imported: CoolifyImport) => void;
}) {
  const servicesQuery = useQuery({
    queryKey: queryKeys.supabase.coolifyServices,
    queryFn: () => ipc.supabase.listCoolifySupabaseServices(),
    retry: false,
  });
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const services = servicesQuery.data ?? [];

  const choose = async (serviceUuid: string) => {
    setImporting(true);
    setError(null);
    try {
      onImported(
        await ipc.supabase.importCoolifySupabaseService({ serviceUuid }),
      );
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      setImporting(false);
    }
  };

  const message = servicesQuery.error
    ? getErrorMessage(servicesQuery.error)
    : servicesQuery.isSuccess && services.length === 0
      ? "No Supabase services found on your Coolify instance."
      : error;

  return (
    <div
      className="space-y-1 rounded-md border p-3"
      data-testid="supabase-self-hosted-coolify-import"
    >
      <Label htmlFor="supabase-self-hosted-coolify-service">
        Import from Coolify
      </Label>
      <div className="flex items-center gap-2">
        <Select
          value=""
          onValueChange={(value) => value && void choose(value)}
          disabled={importing || services.length === 0}
        >
          <SelectTrigger
            id="supabase-self-hosted-coolify-service"
            className="flex-1"
          >
            <SelectValue>
              {() =>
                servicesQuery.isLoading
                  ? "Loading services"
                  : "Select a Supabase service"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {services.map((service) => (
              <SelectItem key={service.uuid} value={service.uuid}>
                {service.url
                  ? `${service.name} (${service.url})`
                  : service.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {importing && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}

const EMPTY_FORM = {
  name: "",
  url: "",
  anonKey: "",
  serviceKey: "",
  studioUrl: "",
  sshHost: "",
  sshPort: "22",
  sshUsername: "",
  sshPrivateKey: "",
};

/** Lets an unlinked app connect to an existing or new self-hosted instance. */
export function SupabaseSelfHostedLinkSection({
  appId,
  onLinked,
}: {
  appId: number;
  onLinked: () => Promise<unknown>;
}) {
  const instancesQuery = useSupabaseSelfHostedInstances({ enabled: true });
  const addInstance = useAddSupabaseSelfHostedInstance();
  const instances = instancesQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const sharedWith =
    instances.find((instance) => instance.id === selectedId)?.linkedApps ?? [];
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [useSsh, setUseSsh] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importedNote, setImportedNote] = useState<string | null>(null);
  // The user@host an SSH key imported from Coolify logs in as. That key is
  // kept out of view, since the user never pasted it.
  const [coolifyKeyTarget, setCoolifyKeyTarget] = useState<string | null>(null);
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  // Import is part of the Coolify experiment, so it stays hidden while that is off.
  const canImportFromCoolify =
    !!settings?.enableOwnServerDeployment &&
    !!settings.coolify?.instanceUrl &&
    !!settings.coolify.accessToken?.value;

  const applyImport = (imported: CoolifyImport) => {
    setForm({
      name: imported.name,
      url: imported.url,
      anonKey: imported.anonKey,
      serviceKey: imported.serviceKey,
      studioUrl: imported.studioUrl,
      sshHost: imported.ssh?.host ?? "",
      sshPort: String(imported.ssh?.port ?? 22),
      sshUsername: imported.ssh?.username ?? "",
      sshPrivateKey: imported.ssh?.privateKey ?? "",
    });
    setUseSsh(!!imported.ssh?.privateKey);
    setCoolifyKeyTarget(
      imported.ssh?.privateKey
        ? `${imported.ssh.username}@${imported.ssh.host}`
        : null,
    );
    setImportedNote(importNote(imported));
    setFormError(null);
  };

  const link = async (projectId: string) => {
    setIsLinking(true);
    try {
      await linkApp(appId, projectId);
      // Each instance's list of linked apps has changed.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.selfHostedInstances,
      });
      toast.success("Connected to the self-hosted Supabase instance");
      await onLinked();
    } catch (error) {
      toast.error(`Failed to connect: ${getErrorMessage(error)}`);
    } finally {
      setIsLinking(false);
    }
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const sshPort = Number(form.sshPort);
    if (
      useSsh &&
      !(Number.isInteger(sshPort) && sshPort > 0 && sshPort < 65536)
    ) {
      setFormError("Enter an SSH port between 1 and 65535.");
      return;
    }
    try {
      const { instance } = await addInstance.mutateAsync({
        name: form.name,
        url: form.url,
        anonKey: form.anonKey,
        serviceKey: form.serviceKey,
        studioUrl: form.studioUrl.trim() || null,
        ssh: useSsh
          ? {
              host: form.sshHost.trim() || hostOf(form.url),
              port: sshPort,
              username: form.sshUsername,
              privateKey: form.sshPrivateKey,
            }
          : null,
      });
      setForm(EMPTY_FORM);
      setImportedNote(null);
      setCoolifyKeyTarget(null);
      setIsFormOpen(false);
      await link(instance.id);
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  };

  const field = (
    key: keyof typeof EMPTY_FORM,
    label: string,
    options: {
      placeholder?: string;
      secret?: boolean;
      optional?: boolean;
    },
  ) => (
    <div className="space-y-1">
      <FieldLabel
        htmlFor={`supabase-self-hosted-${key}`}
        label={label}
        field={key}
      />
      <Input
        id={`supabase-self-hosted-${key}`}
        type={options.secret ? "password" : "text"}
        autoComplete="off"
        placeholder={options.placeholder}
        required={!options.optional}
        value={form[key]}
        onChange={(event) => {
          setForm((current) => ({ ...current, [key]: event.target.value }));
          setFormError(null);
        }}
      />
    </div>
  );

  return (
    <div className="space-y-4" data-testid="supabase-self-hosted-link-section">
      <p className="text-sm text-muted-foreground">
        Connect this app to a Supabase instance you run yourself. This feature
        supports instances deployed with Docker Compose or Coolify; other
        instances may not work as intended.
      </p>
      {instances.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="supabase-self-hosted-select">Instance</Label>
            <Select
              value={selectedId ?? ""}
              onValueChange={(value) => setSelectedId(value || null)}
            >
              <SelectTrigger id="supabase-self-hosted-select">
                <SelectValue>
                  {(value) =>
                    instances.find((instance) => instance.id === value)?.name ??
                    "Select an instance"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {instances.map((instance) => (
                  <SelectItem key={instance.id} value={instance.id}>
                    {instance.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => selectedId && link(selectedId)}
            disabled={!selectedId || isLinking}
          >
            Connect
          </Button>
        </div>
      )}
      {sharedWith.length > 0 && (
        <p
          className="text-xs text-amber-700 dark:text-amber-400"
          data-testid="supabase-self-hosted-shared-note"
        >
          Also used by {sharedWith.map((app) => app.name).join(", ")}. Apps on
          one instance share its database and edge functions, so tables or
          functions with the same name will overwrite each other.
        </p>
      )}

      {isFormOpen ? (
        <form className="space-y-3" onSubmit={handleAdd}>
          {canImportFromCoolify && (
            <CoolifyImportPicker onImported={applyImport} />
          )}
          {importedNote && (
            <Alert data-testid="supabase-self-hosted-import-note">
              <Info className="h-4 w-4" />
              <AlertDescription>{importedNote}</AlertDescription>
            </Alert>
          )}
          {field("name", "Name", { placeholder: "My Supabase" })}
          {field("url", "API URL", {
            placeholder: "https://supabase.example.com",
          })}
          {sendsKeysUnencrypted(form.url) && (
            <p
              className="text-xs text-amber-700 dark:text-amber-400"
              data-testid="supabase-self-hosted-http-note"
            >
              This URL uses plain HTTP, so Dyad will send the instance's keys
              unencrypted. Use HTTPS if the server is reachable from the
              internet.
            </p>
          )}
          {field("anonKey", "Anon key", { secret: true })}
          {field("serviceKey", "Service role key", { secret: true })}
          {field("studioUrl", "Studio URL (optional)", { optional: true })}
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Switch
                id="supabase-self-hosted-use-ssh"
                aria-label="Enable edge functions"
                checked={useSsh}
                onCheckedChange={setUseSsh}
              />
              <Label htmlFor="supabase-self-hosted-use-ssh">
                Enable edge functions
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Enable this if you intend to run edge functions on your Supabase
              instance. This will require SSH credentials.
            </p>
            {useSsh && (
              <>
                <div className="flex gap-2">
                  <div className="flex-1">
                    {field("sshHost", "SSH host", {
                      placeholder: hostOf(form.url) || "supabase.example.com",
                      optional: true,
                    })}
                  </div>
                  <div className="w-24">{field("sshPort", "Port", {})}</div>
                </div>
                {field("sshUsername", "SSH user", { placeholder: "root" })}
                <div className="space-y-1">
                  <FieldLabel
                    htmlFor="supabase-self-hosted-sshPrivateKey"
                    label="Private key"
                    field="sshPrivateKey"
                  />
                  {coolifyKeyTarget ? (
                    <div
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs"
                      data-testid="supabase-self-hosted-coolify-key"
                    >
                      <span>
                        Using Coolify's SSH key for {coolifyKeyTarget}.
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCoolifyKeyTarget(null);
                          setForm((current) => ({
                            ...current,
                            sshPrivateKey: "",
                          }));
                        }}
                      >
                        Use a different key
                      </Button>
                    </div>
                  ) : (
                    <Textarea
                      id="supabase-self-hosted-sshPrivateKey"
                      required
                      rows={4}
                      className="font-mono text-xs"
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      value={form.sshPrivateKey}
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          sshPrivateKey: event.target.value,
                        }));
                        setFormError(null);
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{EMAIL_NOTE}</p>
          {formError && (
            <Alert
              variant="destructive"
              data-testid="supabase-self-hosted-form-error"
            >
              <Info className="h-4 w-4" />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={addInstance.isPending}>
              {addInstance.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {addInstance.isPending ? "Checking instance" : "Add and connect"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setIsFormOpen(false);
                setFormError(null);
                setImportedNote(null);
                setCoolifyKeyTarget(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setIsFormOpen(true)}
          data-testid="supabase-self-hosted-add-button"
        >
          <Plus className="h-4 w-4" />
          Add self-hosted instance
        </Button>
      )}
    </div>
  );
}

type InstanceListItem = NonNullable<
  ReturnType<typeof useSupabaseSelfHostedInstances>["data"]
>[number];

/** Settings list of saved instances, for removing ones no longer needed. */
export function SupabaseSelfHostedInstancesSettings() {
  const instancesQuery = useSupabaseSelfHostedInstances({ enabled: true });
  const removeInstance = useRemoveSupabaseSelfHostedInstance();
  const instances = instancesQuery.data ?? [];
  // The instances a confirmed Remove or Remove all will remove.
  const [confirming, setConfirming] = useState<InstanceListItem[] | null>(null);

  const remove = async (targets: InstanceListItem[]) => {
    for (const instance of targets) {
      await removeInstance.mutateAsync(instance.id);
    }
    toast.success(
      targets.length === 1
        ? `Removed ${targets[0].name}`
        : `Removed ${targets.length} instances`,
    );
  };
  // Asks first only when removing would disconnect apps.
  const requestRemove = (targets: InstanceListItem[]) => {
    if (targets.some((instance) => instance.linkedApps.length > 0)) {
      setConfirming(targets);
    } else {
      void remove(targets).catch(() => {});
    }
  };

  if (instances.length === 0) return null;

  const linkedApps = (confirming ?? []).flatMap(
    (instance) => instance.linkedApps,
  );

  return (
    <div data-testid="supabase-self-hosted-settings">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Self-hosted Supabase
        </h3>
        <Button
          variant="destructive"
          size="sm"
          className="flex items-center gap-2"
          disabled={removeInstance.isPending}
          onClick={() => requestRemove(instances)}
        >
          Remove all
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-3 space-y-1">
        {instances.map((instance) => (
          <div
            key={instance.id}
            className="flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2 text-sm"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{instance.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {instance.url}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {instance.ssh
                  ? "Edge functions enabled"
                  : "Edge functions not enabled"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-muted-foreground hover:text-destructive"
              disabled={removeInstance.isPending}
              onClick={() => requestRemove([instance])}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              <span className="text-xs">Remove</span>
            </Button>
          </div>
        ))}
      </div>
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming?.length === 1
                ? `Remove ${confirming[0].name}?`
                : "Remove all self-hosted instances?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect the following apps:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc pl-6 text-sm">
            {linkedApps.map((app) => (
              <li key={app.id}>{app.name}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) void remove(confirming).catch(() => {});
                setConfirming(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
