import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { getDb } from "@/db";
import { emailAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getProvider } from "@/lib/email/email_provider_factory";
import type { EmailProviderType, EmailAccountConfig } from "@/types/email_types";

const logger = log.scope("send_email_tool");

const sendEmailSchema = z.object({
  to: z
    .string()
    .describe(
      "Comma-separated recipient email addresses (e.g. 'eli@example.com' or 'a@x.com, b@x.com')"
    ),
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Plain text email body. Write the full email content."),
  cc: z
    .string()
    .optional()
    .describe("Optional comma-separated CC addresses"),
  bcc: z
    .string()
    .optional()
    .describe("Optional comma-separated BCC addresses"),
  accountId: z
    .string()
    .optional()
    .describe(
      "Optional email account ID to send from. If omitted, uses the default/first configured account."
    ),
});

export const sendEmailTool: ToolDefinition<z.infer<typeof sendEmailSchema>> = {
  name: "send_email",
  description:
    "Send an email from the user's configured email account. Use this when the user asks you to send, email, or message someone via email. The email will be sent via the configured IMAP/SMTP, Gmail, or Microsoft provider.",
  inputSchema: sendEmailSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    `Send email to ${args.to}: "${args.subject}"`,

  buildXml: (args, isComplete) => {
    if (!args.to || !args.subject) return undefined;
    let xml = `<joy-email to="${escapeXmlAttr(args.to)}" subject="${escapeXmlAttr(args.subject)}">`;
    if (isComplete) xml += `</joy-email>`;
    return xml;
  },

  execute: async (args, _ctx: AgentContext) => {
    const db = getDb();

    try {
      // Find the email account to use
      let account: any;

      if (args.accountId) {
        account = db
          .select()
          .from(emailAccounts)
          .where(eq(emailAccounts.id, args.accountId))
          .get();
      } else {
        // Use the first available account (or default)
        const accounts = db.select().from(emailAccounts).all();
        if (!accounts || accounts.length === 0) {
          return "Error: No email accounts configured. Please add an email account in JoyCreate Email Hub settings first.";
        }
        // Prefer the default account
        account =
          accounts.find((a: any) => a.isDefault) || accounts[0];
      }

      if (!account) {
        return "Error: Email account not found. Please check your email configuration.";
      }

      logger.info(
        `Sending email from ${account.email} to ${args.to}: "${args.subject}"`
      );

      // Get the email provider and connect
      const provider = getProvider(
        account.id,
        account.provider as EmailProviderType,
        account.config as unknown as EmailAccountConfig
      );

      if (!provider.isConnected()) {
        await provider.connect();
      }

      // Parse comma-separated addresses into EmailAddress objects
      const parseAddresses = (str: string) =>
        str
          .split(",")
          .map((a: string) => a.trim())
          .filter(Boolean)
          .map((a: string) => ({ address: a }));

      const toAddresses = parseAddresses(args.to);
      const ccAddresses = args.cc ? parseAddresses(args.cc) : [];
      const bccAddresses = args.bcc ? parseAddresses(args.bcc) : [];

      // Send the email via the provider's sendMessage
      await provider.sendMessage({
        accountId: account.id,
        from: account.email as string,
        to: toAddresses,
        cc: ccAddresses,
        bcc: bccAddresses,
        subject: args.subject,
        body: args.body,
        aiGenerated: true,
      } as any);

      logger.info(`Email sent successfully to ${args.to}`);

      return `Email sent successfully!\n- From: ${account.email}\n- To: ${args.to}${ccAddresses.length ? `\n- CC: ${ccAddresses.join(", ")}` : ""}\n- Subject: ${args.subject}`;
    } catch (error) {
      logger.error("Failed to send email:", error);
      const msg =
        error instanceof Error ? error.message : String(error);
      return `Failed to send email: ${msg}. Please check your email account settings in JoyCreate.`;
    }
  },
};
