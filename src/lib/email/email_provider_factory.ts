/**
 * Email Provider Factory
 *
 * Creates the appropriate IEmailProvider implementation
 * based on the account's provider type.
 */

import type { EmailAccountConfig, IEmailProvider, EmailProviderType } from "@/types/email_types";
import { ImapSmtpProvider } from "./imap_smtp_provider";
import { GmailProvider } from "./gmail_provider";
import { MicrosoftProvider } from "./microsoft_provider";

const activeProviders = new Map<string, IEmailProvider>();

/**
 * Create (or retrieve cached) email provider for a given account.
 */
export function getProvider(
  accountId: string,
  providerType: EmailProviderType,
  config: EmailAccountConfig,
): IEmailProvider {
  const existing = activeProviders.get(accountId);
  if (existing?.isConnected()) return existing;

  let provider: IEmailProvider;
  switch (providerType) {
    case "gmail":
      provider = new GmailProvider(accountId, config);
      break;
    case "microsoft":
      provider = new MicrosoftProvider(accountId, config);
      break;
    case "imap":
    default:
      provider = new ImapSmtpProvider(accountId, config);
      break;
  }

  activeProviders.set(accountId, provider);
  return provider;
}

/**
 * Disconnect and remove a cached provider.
 */
export async function removeProvider(accountId: string): Promise<void> {
  const provider = activeProviders.get(accountId);
  if (provider) {
    await provider.disconnect();
    activeProviders.delete(accountId);
  }
}

/**
 * Disconnect all active providers.
 */
export async function disconnectAll(): Promise<void> {
  for (const [id, provider] of activeProviders) {
    try {
      await provider.disconnect();
    } catch { /* best-effort */ }
    activeProviders.delete(id);
  }
}
