type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const EXPLICIT_SOURCE_REFERENCE =
  /\b(?:my|the|selected|connected|our)\s+(?:(?:osint|business|website|app)\s+)?(?:data\s+sources?|sources?|databases?|db|records?|collections?)\b|\b(?:data\s+sources?|database|db)\s+(?:I|we)\s+(?:selected|connected)\b/i;

const STRUCTURED_RECORD_REQUEST =
  /\b(?:code\s*name|codename|investigations?|evidence|orders?|customers?|invoices?|attendees?|registrations?|transactions?|user[_ ]?id|order[_ ]?number|latest\s+(?:sales?|records?|orders?|customers?))\b/i;

const SCHEMA_ONLY_REQUEST =
  /\b(?:what|which|show|list)\s+(?:database\s+)?(?:tables?|columns?|schemas?|relationships?)\b|\b(?:database|connection|schema)\s+status\b/i;

const CONNECTED_BUSINESS_LIST_REQUEST =
  /\b(?:(?:my|our)\s+)?(?:latest|recent|newest)\s+(?:orders?|sales?|customers?|invoices?|transactions?|registrations?)\b/i;

const PERSONAL_PURCHASE_REQUEST =
  /\b(?:orders?\s+I\s+(?:placed|made)|my\s+(?:purchases?|customer\s+account|checkout\s+orders?))\b/i;

const DATA_MUTATION_REQUEST =
  /\b(?:add|create|insert|save|record|update|change|edit|rename|mark|set|delete|remove)\b[\s\S]{0,100}\b(?:records?|rows?|entries?|investigations?|evidence|orders?|customers?|invoices?|attendees?|registrations?|transactions?|database|db|data\s+source)\b|\b(?:records?|rows?|entries?|investigations?|evidence|orders?|customers?|invoices?|attendees?|registrations?|transactions?)\b[\s\S]{0,100}\b(?:add|create|insert|save|update|change|edit|rename|mark|set|delete|remove)\b/i;

/**
 * Selected databases should win over general web search when the conversation
 * refers to private/structured records. Recent user turns are included so a
 * follow-up like "tell me about Geoff" keeps the preceding "my OSINT source"
 * scope without treating an assistant guess as routing evidence.
 */
export function shouldPreferSelectedDataSources(
  messages: ConversationMessage[],
): boolean {
  const recentUserContext = messages
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.content)
    .join("\n");
  return (
    EXPLICIT_SOURCE_REFERENCE.test(recentUserContext) ||
    STRUCTURED_RECORD_REQUEST.test(recentUserContext)
  );
}

/**
 * Record questions must reach an actual read query, not stop after listing the
 * selected database or inspecting its schema. A schema-only question is the
 * exception because rows would not answer it.
 */
export function shouldRequireSelectedDataSourceRows(
  messages: ConversationMessage[],
): boolean {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;
  if (!latestUserMessage || SCHEMA_ONLY_REQUEST.test(latestUserMessage)) {
    return false;
  }
  return STRUCTURED_RECORD_REQUEST.test(latestUserMessage);
}

/** Whether the latest turn explicitly asks to modify selected private data. */
export function shouldMutateSelectedDataSource(
  messages: ConversationMessage[],
): boolean {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;
  return Boolean(
    latestUserMessage && DATA_MUTATION_REQUEST.test(latestUserMessage),
  );
}

/**
 * In this workspace, "my latest orders" normally means the latest rows in the
 * user's connected business database. It does not mean purchases made by the
 * speaker unless they explicitly say that. This guidance prevents the model
 * from inventing an unnecessary email/user-id gate.
 */
export function selectedDataSourceTurnGuidance(
  messages: ConversationMessage[],
): string | null {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;
  if (
    !latestUserMessage ||
    !CONNECTED_BUSINESS_LIST_REQUEST.test(latestUserMessage) ||
    PERSONAL_PURCHASE_REQUEST.test(latestUserMessage)
  ) {
    return null;
  }
  return [
    "Turn-specific connected-data instruction:",
    "- Interpret this as the latest records in the user's selected business database, not purchases personally placed by the speaker.",
    "- Do not ask for an email, user ID, or order number and do not add a customer-identity filter.",
    "- Discover the relevant table, order by the best available creation/order timestamp (or a monotonic primary key) descending, query up to 10 rows, and let the native database result card show them.",
  ].join("\n");
}
