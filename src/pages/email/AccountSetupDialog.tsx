/**
 * Email Account Setup Dialog
 *
 * Multi-step wizard for adding IMAP/SMTP, Gmail, or Microsoft accounts.
 */

import { useState } from "react";
import { X, Mail, Chrome, Building2, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAddEmailAccount } from "@/hooks/useEmail";
import type {
  EmailProviderType,
  AddEmailAccountPayload,
} from "@/types/email_types";

interface AccountSetupDialogProps {
  open: boolean;
  onClose: () => void;
}

const PROVIDERS: {
  type: EmailProviderType;
  label: string;
  icon: typeof Mail;
  desc: string;
}[] = [
  { type: "imap", label: "IMAP/SMTP", icon: Mail, desc: "Any email provider" },
  { type: "gmail", label: "Gmail", icon: Chrome, desc: "Google account" },
  {
    type: "microsoft",
    label: "Outlook",
    icon: Building2,
    desc: "Microsoft 365 / Outlook",
  },
];

export function AccountSetupDialog({ open, onClose }: AccountSetupDialogProps) {
  const [step, setStep] = useState<"provider" | "config">("provider");
  const [provider, setProvider] = useState<EmailProviderType>("imap");
  const addAccount = useAddEmailAccount();

  const handleSelectProvider = (type: EmailProviderType) => {
    setProvider(type);
    setStep("config");
  };

  const handleBack = () => setStep("provider");

  const handleClose = () => {
    setStep("provider");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "provider" ? "Add Email Account" : `Configure ${provider.toUpperCase()}`}
          </DialogTitle>
        </DialogHeader>

        {step === "provider" ? (
          <div className="space-y-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.type}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-border/50 p-3 text-left transition-colors hover:bg-muted/50"
                onClick={() => handleSelectProvider(p.type)}
              >
                <p.icon className="h-5 w-5 text-emerald-500" />
                <div>
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.desc}</div>
                </div>
              </button>
            ))}
          </div>
        ) : provider === "imap" ? (
          <ImapSetupForm
            onSubmit={(payload) =>
              addAccount.mutate(payload, { onSuccess: handleClose })
            }
            onBack={handleBack}
            isPending={addAccount.isPending}
            error={addAccount.error?.message}
          />
        ) : (
          <OAuthSetupForm
            provider={provider}
            onSubmit={(payload) =>
              addAccount.mutate(payload, { onSuccess: handleClose })
            }
            onBack={handleBack}
            isPending={addAccount.isPending}
            error={addAccount.error?.message}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImapSetupForm({
  onSubmit,
  onBack,
  isPending,
  error,
}: {
  onSubmit: (payload: AddEmailAccountPayload) => void;
  onBack: () => void;
  isPending: boolean;
  error?: string;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [allowInsecure, setAllowInsecure] = useState(false);

  const handleSubmit = () => {
    onSubmit({
      provider: "imap",
      displayName: displayName || email.split("@")[0],
      email,
      config: {
        imapHost,
        imapPort: Number.parseInt(imapPort, 10),
        imapTls: true,
        smtpHost,
        smtpPort: Number.parseInt(smtpPort, 10),
        smtpTls: true,
        username: email,
        accessToken: password,
        allowInsecure,
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Display Name</Label>
          <Input
            className="h-8 text-sm"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="My Email"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Email</Label>
          <Input
            className="h-8 text-sm"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Password</Label>
        <div className="relative">
          <Input
            className="h-8 text-sm pr-8"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-8 w-8"
            type="button"
            onClick={() => setShowPassword((p) => !p)}
          >
            {showPassword ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">IMAP Host</Label>
          <Input
            className="h-8 text-sm"
            value={imapHost}
            onChange={(e) => setImapHost(e.target.value)}
            placeholder="imap.example.com"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">IMAP Port</Label>
          <Input
            className="h-8 text-sm"
            value={imapPort}
            onChange={(e) => setImapPort(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">SMTP Host</Label>
          <Input
            className="h-8 text-sm"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            placeholder="smtp.example.com"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">SMTP Port</Label>
          <Input
            className="h-8 text-sm"
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/50 p-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
          <div>
            <Label className="text-xs">Allow insecure certificates</Label>
            <p className="text-[10px] text-muted-foreground">
              Enable for self-signed or expired server certificates
            </p>
          </div>
        </div>
        <Switch
          checked={allowInsecure}
          onCheckedChange={setAllowInsecure}
        />
      </div>

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={handleSubmit}
          disabled={isPending || !email || !imapHost || !smtpHost}
        >
          {isPending ? "Connecting..." : "Add Account"}
        </Button>
      </div>
    </div>
  );
}

function OAuthSetupForm({
  provider,
  onSubmit,
  onBack,
  isPending,
  error,
}: {
  provider: EmailProviderType;
  onSubmit: (payload: AddEmailAccountPayload) => void;
  onBack: () => void;
  isPending: boolean;
  error?: string;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [tenantId, setTenantId] = useState("");

  const handleSubmit = () => {
    onSubmit({
      provider,
      displayName: displayName || email.split("@")[0],
      email,
      config: {
        clientId,
        clientSecret,
        accessToken,
        refreshToken,
        ...(provider === "microsoft" && { tenantId }),
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Display Name</Label>
          <Input
            className="h-8 text-sm"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Email</Label>
          <Input
            className="h-8 text-sm"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Client ID</Label>
        <Input
          className="h-8 text-sm"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Client Secret</Label>
        <Input
          className="h-8 text-sm"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>

      {provider === "microsoft" && (
        <div className="space-y-1">
          <Label className="text-xs">Tenant ID</Label>
          <Input
            className="h-8 text-sm"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="common"
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Access Token</Label>
        <Input
          className="h-8 text-sm"
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Refresh Token</Label>
        <Input
          className="h-8 text-sm"
          type="password"
          value={refreshToken}
          onChange={(e) => setRefreshToken(e.target.value)}
        />
      </div>

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={handleSubmit}
          disabled={isPending || !email || !accessToken}
        >
          {isPending ? "Connecting..." : "Add Account"}
        </Button>
      </div>
    </div>
  );
}
